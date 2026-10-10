import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createSheetQueue, rowLink } from './sheet-queue.js';
import { publishPlatforms } from './publish-platforms.js';
import { waitForInstagramUpload } from './instagram-upload.js';

function fixture(t, cells, pipeline = async () => ({ success: true })) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sheet-queue-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const settingsPath = path.join(dir, '.setting');
  fs.writeFileSync(settingsPath, JSON.stringify({ intervalSeconds: 5 }));
  const cleared = [], calls = [];
  const queue = createSheetQueue({
    statePath: path.join(dir, 'state.json'), settingsPath,
    sheet: {
      readColumn: async () => cells,
      clearCell: async (_, row) => { cleared.push(row); cells[row - 1] = ''; }
    },
    runPipeline: async (url, options) => { calls.push(url); return pipeline(url, options); }
  });
  queue.configure({ enabled: true });
  return { queue, cleared, calls, settingsPath };
}

test('accepts only Kuaishou URLs', () => {
  assert.equal(rowLink('Share https://v.kuaishou.com/abc'), 'https://v.kuaishou.com/abc');
  assert.equal(rowLink('https://docs.google.com/example'), null);
});

test('Instagram file input timeout clears the row and continues without restarting', async t => {
  const cells = ['https://v.kuaishou.com/no-input', 'https://v.kuaishou.com/next'];
  let attempts = 0;
  const { queue, cleared, calls } = fixture(t, cells, async (_, options) => publishPlatforms(options, {}, {
    instagram: async () => {
      attempts++;
      await waitForInstagramUpload({ waitFor: async () => {
        throw Object.assign(new Error('locator.waitFor: Timeout 20000ms exceeded'), { name: 'TimeoutError' });
      } });
    },
    tiktok: async () => ({ success: true }),
    threads: async () => ({ success: true })
  }));
  queue.configure({ options: { autoPostTikTok: false } });
  await queue.tick();
  const snapshot = queue.snapshot();
  assert.equal(snapshot.enabled, true);
  assert.equal(snapshot.cursor, 2);
  assert.equal(snapshot.error, null);
  assert.equal(snapshot.items[0].published.igPosted, false);
  assert.deepEqual(snapshot.items[0].skippedPlatforms, ['instagram', 'facebook']);
  assert.match(snapshot.items[0].warning, /bỏ qua/);
  await queue.tick();
  assert.equal(attempts, 2);
  assert.equal(calls.length, 2);
  assert.deepEqual(cleared, [1, 2]);
});

test('retrying another failed platform does not retry skipped Instagram/Facebook', async t => {
  const received = [];
  const { queue } = fixture(t, ['https://v.kuaishou.com/skipped'], async (_, options) => {
    received.push(options);
    return received.length === 1
      ? { success: false, partialFailure: true, skippedPlatforms: ['instagram', 'facebook'], skipWarning: 'Đã bỏ qua', error: 'Threads failed' }
      : { success: true, threadsPosted: true };
  });
  await queue.tick();
  queue.configure({ enabled: true });
  await queue.tick();
  assert.equal(received[1].autoPostIG, false);
  assert.equal(received[1].autoPostFB, false);
  assert.match(queue.snapshot().items[0].warning, /bỏ qua/);
});

test('keeps the row and stops after a network failure without clearing or replaying', async t => {
  const cells = ['https://v.kuaishou.com/network', 'https://v.kuaishou.com/next'];
  const { queue, calls, cleared } = fixture(t, cells, async () => { throw new Error('fetch failed'); });
  await queue.tick();
  await queue.tick();
  assert.equal(queue.snapshot().enabled, false);
  assert.equal(queue.snapshot().cursor, 1);
  assert.equal(queue.snapshot().items[0].status, 'partial');
  assert.match(queue.snapshot().error, /Link được giữ lại/);
  assert.deepEqual(cleared, []);
  assert.equal(calls.length, 1);
  assert.equal(cells[0], 'https://v.kuaishou.com/network');
});

test('keeps a link after partial failure and retries only the missing platform', async t => {
  const cells = ['https://v.kuaishou.com/all-platforms'];
  const received = [];
  const { queue, cleared } = fixture(t, cells, async (_, options) => {
    received.push(options);
    if (received.length === 1) return { success: false, partialFailure: true, igPosted: true, fbPosted: true, tiktokPosted: true, threadsPosted: false, error: 'Threads failed' };
    return { success: true, threadsPosted: true };
  });
  await queue.tick();
  assert.equal(received[0].autoPostIG && received[0].autoPostFB && received[0].autoPostTikTok && received[0].autoPostThreads, true);
  assert.equal(queue.snapshot().enabled, false);
  assert.equal(queue.snapshot().items[0].status, 'partial');
  assert.equal(cells[0], 'https://v.kuaishou.com/all-platforms');
  assert.deepEqual(cleared, []);
  queue.configure({ enabled: true });
  await queue.tick();
  assert.equal(received[1].autoPostIG, false);
  assert.equal(received[1].autoPostFB, false);
  assert.equal(received[1].autoPostTikTok, false);
  assert.equal(received[1].autoPostThreads, true);
  assert.equal(queue.snapshot().items[0].published.threadsPosted, true);
  assert.deepEqual(cleared, [1]);
});

test('runs one link per tick, clears it, and skips a blank row', async t => {
  const cells = ['https://v.kuaishou.com/first', '', 'https://v.kuaishou.com/second'];
  const { queue, cleared, calls } = fixture(t, cells);
  await queue.tick();
  assert.deepEqual(calls, ['https://v.kuaishou.com/first']);
  assert.deepEqual(cleared, [1]);
  await queue.tick();
  assert.deepEqual(calls, ['https://v.kuaishou.com/first', 'https://v.kuaishou.com/second']);
  assert.deepEqual(cleared, [1, 3]);
});

test('stops when column A has no links and starts again from A1', async t => {
  const cells = ['', '', ''];
  const { queue } = fixture(t, cells);
  await queue.tick();
  assert.equal(queue.snapshot().enabled, false);
  assert.equal(queue.snapshot().cursor, 1);
  cells[0] = 'https://v.kuaishou.com/new';
  queue.configure({ enabled: true });
  await queue.tick();
  assert.equal(queue.snapshot().cursor, 2);
  assert.equal(cells[0], '');
});

test('clears saved queue history after all links are processed', async t => {
  const cells = ['https://v.kuaishou.com/first'];
  const { queue } = fixture(t, cells);
  await queue.tick();
  assert.equal(queue.snapshot().items[0].status, 'done');
  await queue.tick();
  assert.equal(queue.snapshot().enabled, false);
  assert.deepEqual(queue.snapshot().items, []);
});

test('Start resets an old cursor and skips cleared rows before the next link', async t => {
  const cells = ['', '', '', 'https://v.kuaishou.com/fourth'];
  const { queue, calls, cleared } = fixture(t, cells);
  await queue.tick();
  assert.equal(queue.snapshot().cursor, 5);
  cells[0] = 'https://v.kuaishou.com/new-first';
  queue.configure({ enabled: false });
  queue.start();
  queue.configure({ enabled: true, runNow: true });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, ['https://v.kuaishou.com/fourth', 'https://v.kuaishou.com/new-first']);
  assert.deepEqual(cleared, [4, 1]);
  queue.stop();
});

test('clears a failed link and continues with the next row', async t => {
  const cells = ['https://v.kuaishou.com/fail', 'https://v.kuaishou.com/next'];
  const { queue, cleared, calls } = fixture(t, cells, async url => {
    if (url.endsWith('/fail')) throw new Error('upload failed');
    return { success: true };
  });
  await queue.tick();
  assert.equal(queue.snapshot().enabled, true);
  assert.equal(queue.snapshot().cursor, 2);
  assert.equal(queue.snapshot().items.find(item => item.row === 1).status, 'failed');
  assert.match(queue.snapshot().items.find(item => item.row === 1).error, /upload failed/);
  assert.equal(cells[0], '');
  await queue.tick();
  assert.deepEqual(calls, ['https://v.kuaishou.com/fail', 'https://v.kuaishou.com/next']);
  assert.deepEqual(cleared, [1, 2]);
});

test('clears an invalid link and continues', async t => {
  const cells = ['https://example.com/wrong', 'https://v.kuaishou.com/next'];
  const { queue, cleared, calls } = fixture(t, cells);
  await queue.tick();
  assert.equal(queue.snapshot().items.find(item => item.row === 1).status, 'failed');
  assert.equal(queue.snapshot().enabled, true);
  assert.equal(cells[0], '');
  await queue.tick();
  assert.deepEqual(calls, ['https://v.kuaishou.com/next']);
  assert.deepEqual(cleared, [1, 2]);
});

test('waits the configured interval after a failed link', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sheet-queue-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const settingsPath = path.join(dir, '.setting');
  fs.writeFileSync(settingsPath, JSON.stringify({ intervalSeconds: 3600 }));
  const cells = ['https://v.kuaishou.com/fail', 'https://v.kuaishou.com/next'];
  const calls = [], scheduled = [];
  const queue = createSheetQueue({
    statePath: path.join(dir, 'state.json'), settingsPath,
    sheet: { readColumn: async () => cells, clearCell: async (_, row) => { cells[row - 1] = ''; } },
    runPipeline: async url => {
      calls.push(url);
      return url.endsWith('/fail') ? { success: false, error: 'upload failed' } : { success: true };
    },
    schedule: (callback, delay) => { scheduled.push({ callback, delay }); return { unref() {} }; }
  });
  queue.start();
  queue.configure({ enabled: true, runNow: true });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, ['https://v.kuaishou.com/fail']);
  assert.deepEqual(scheduled.map(item => item.delay), [3600000]);
  assert.equal(queue.snapshot().enabled, true);
  assert.equal(cells[0], '');
  queue.stop();
});

test('clears a failed link once and does not retry its pipeline', async t => {
  const cells = ['https://v.kuaishou.com/fail', 'https://v.kuaishou.com/next'];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sheet-queue-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const settingsPath = path.join(dir, '.setting');
  fs.writeFileSync(settingsPath, JSON.stringify({ intervalSeconds: 5 }));
  let clearCalls = 0, postCalls = 0;
  const queue = createSheetQueue({
    statePath: path.join(dir, 'state.json'), settingsPath,
    sheet: {
      readColumn: async () => cells,
      clearCell: async (_, row) => {
        clearCalls++;
        cells[row - 1] = '';
      }
    },
    runPipeline: async () => { postCalls++; throw new Error('upload failed'); }
  });
  queue.configure({ enabled: true });
  await queue.tick();
  assert.equal(queue.snapshot().items.find(item => item.row === 1).status, 'failed');
  await queue.tick();
  assert.equal(postCalls, 2);
  assert.equal(clearCalls, 2);
  assert.equal(queue.snapshot().items.find(item => item.row === 1).status, 'failed');
  assert.equal(queue.snapshot().cursor, 3);
  assert.equal(cells[0], '');
});

test('retries only clearing after a successful post when clearing fails', async t => {
  const cells = ['https://v.kuaishou.com/first'];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sheet-queue-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const settingsPath = path.join(dir, '.setting');
  fs.writeFileSync(settingsPath, JSON.stringify({ intervalSeconds: 5 }));
  let clearCalls = 0, postCalls = 0;
  const queue = createSheetQueue({
    statePath: path.join(dir, 'state.json'), settingsPath,
    sheet: {
      readColumn: async () => cells,
      clearCell: async () => {
        clearCalls++;
        if (clearCalls === 1) throw new Error('Sheets unavailable');
        cells[0] = '';
      }
    },
    runPipeline: async () => { postCalls++; return { success: true }; }
  });
  queue.configure({ enabled: true });
  await queue.tick();
  assert.equal(queue.snapshot().items[0].status, 'awaiting_clear');
  await queue.tick();
  assert.equal(postCalls, 1);
  assert.equal(clearCalls, 2);
  assert.equal(queue.snapshot().items[0].status, 'done');
});

test('Start runs the next link immediately, then schedules the following run', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sheet-queue-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const settingsPath = path.join(dir, '.setting');
  fs.writeFileSync(settingsPath, JSON.stringify({ intervalSeconds: 3600 }));
  const calls = [], delays = [];
  const cells = ['https://v.kuaishou.com/first', 'https://v.kuaishou.com/second'];
  const queue = createSheetQueue({
    statePath: path.join(dir, 'state.json'), settingsPath,
    sheet: { readColumn: async () => cells, clearCell: async (_, row) => { cells[row - 1] = ''; } },
    runPipeline: async url => { calls.push(url); return { success: true }; },
    schedule: (_, delay) => { delays.push(delay); return { unref() {} }; }
  });
  queue.start();
  queue.configure({ enabled: true, runNow: true });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, ['https://v.kuaishou.com/first']);
  assert.deepEqual(delays, [3600000]);
  const nextRunAt = queue.snapshot().nextRunAt;
  assert.ok(Date.parse(nextRunAt) > Date.now() + 3590000);
  queue.stop();
  assert.equal(queue.snapshot().nextRunAt, null);
});

test('repeated Start requests keep the existing interval and do not post again', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sheet-queue-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const settingsPath = path.join(dir, '.setting');
  fs.writeFileSync(settingsPath, JSON.stringify({ intervalSeconds: 1800 }));
  const cells = ['https://v.kuaishou.com/first', 'https://v.kuaishou.com/second'];
  const calls = [], scheduled = [];
  const queue = createSheetQueue({
    statePath: path.join(dir, 'state.json'), settingsPath,
    sheet: { readColumn: async () => cells, clearCell: async (_, row) => { cells[row - 1] = ''; } },
    runPipeline: async url => { calls.push(url); return { success: true }; },
    schedule: (callback, delay) => { scheduled.push({ callback, delay }); return { unref() {} }; }
  });
  queue.start();
  queue.configure({ enabled: true, runNow: true });
  await new Promise(resolve => setImmediate(resolve));
  const nextRunAt = queue.snapshot().nextRunAt;
  queue.configure({ enabled: true, runNow: true });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, ['https://v.kuaishou.com/first']);
  assert.equal(queue.snapshot().nextRunAt, nextRunAt);
  assert.deepEqual(scheduled.map(item => item.delay), [1800000]);
  queue.stop();
});

test('runNextNow runs next link immediately skipping delay', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sheet-queue-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const settingsPath = path.join(dir, '.setting');
  fs.writeFileSync(settingsPath, JSON.stringify({ intervalSeconds: 3600 }));
  const cells = ['https://v.kuaishou.com/first', 'https://v.kuaishou.com/second'];
  const calls = [];
  const queue = createSheetQueue({
    statePath: path.join(dir, 'state.json'), settingsPath,
    sheet: { readColumn: async () => cells, clearCell: async (_, row) => { cells[row - 1] = ''; } },
    runPipeline: async url => { calls.push(url); return { success: true }; },
    schedule: (callback, delay) => { return { unref() {} }; }
  });
  queue.start();
  queue.configure({ enabled: true, runNow: true });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, ['https://v.kuaishou.com/first']);

  // Call runNextNow - should immediately execute the next link
  queue.configure({ runNextNow: true });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, ['https://v.kuaishou.com/first', 'https://v.kuaishou.com/second']);
  queue.stop();
});
