import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createYouTubeUploadQueue, YOUTUBE_UPLOAD_COOLDOWN_MS } from '../../src/platforms/youtube/upload-queue.js';
import { publishPlatforms } from '../../src/platforms/publish.js';

const limited = () => Object.assign(new Error('uploadLimitExceeded'), { uploadNotStarted: true, reasons: ['uploadLimitExceeded'] });
function setup(t, post) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yt-queue-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const videoPath = path.join(root, 'source.mp4');
  fs.writeFileSync(videoPath, 'video-content');
  let time = Date.UTC(2026, 10, 12);
  let key = 'account-a';
  const options = { directory: path.join(root, 'queue'), accountKey: () => key, now: () => time, post, report: () => {} };
  return {
    options, input: { videoPath, title: 'Quiet leaves', description: 'A fall day', publishMode: 'scheduled' },
    queue: createYouTubeUploadQueue(options),
    advance: (ms = YOUTUBE_UPLOAD_COOLDOWN_MS) => { time += ms; },
    switchAccount: value => { key = value; },
    state: () => JSON.parse(fs.readFileSync(path.join(options.directory, 'state.json'), 'utf8'))
  };
}

test('limit creates durable owned copy, deduplicates and retries after cooldown without rerendering', async t => {
  let calls = 0;
  const env = setup(t, async input => {
    if (++calls === 1) throw limited();
    assert.equal(fs.readFileSync(input.videoPath, 'utf8'), 'video-content');
    assert.equal(input.title, 'Quiet leaves');
    assert.equal(input.publishMode, 'scheduled');
    return { success: true, url: 'https://youtube.com/shorts/example' };
  });
  const queued = await env.queue.publish(env.input);
  assert.equal(queued.queued, true);
  assert.equal(queued.success, false);
  assert.equal(queued.retryAt, Date.UTC(2026, 10, 13));
  assert.equal((await env.queue.publish(env.input)).queueId, queued.queueId);
  assert.equal(calls, 1);
  assert.equal(env.state().jobs.length, 1);
  const savedVideo = env.state().jobs[0].videoPath;
  fs.unlinkSync(env.input.videoPath);
  const restarted = createYouTubeUploadQueue(env.options);
  await restarted.tick();
  assert.equal(calls, 1);
  env.advance();
  await restarted.tick();
  assert.equal(calls, 2);
  assert.equal(restarted.status().jobs[0].status, 'done');
  assert.equal(fs.existsSync(savedVideo), false);
  await restarted.tick();
  assert.equal(calls, 2);
});

test('explicit retry bypasses local cooldown without replaying completed uploads', async t => {
  let calls = 0;
  const env = setup(t, async () => {
    if (++calls === 1) throw limited();
    return { success: true, url: 'https://youtube.com/shorts/example' };
  });
  await env.queue.publish(env.input);
  await env.queue.tick();
  assert.equal(calls, 1);
  await env.queue.tick({ force: true });
  assert.equal(calls, 2);
  assert.equal(env.queue.status().jobs[0].status, 'done');
  await env.queue.tick({ force: true });
  assert.equal(calls, 2);
});

test('channel cooldown queues new videos without another API call; rejections renew cooldown', async t => {
  let calls = 0;
  const env = setup(t, async () => { calls++; throw limited(); });
  await env.queue.publish(env.input);
  await env.queue.publish({ ...env.input, title: 'Another video' });
  assert.equal(calls, 1);
  assert.equal(env.queue.status().pending, 2);
  env.advance();
  await env.queue.tick();
  assert.equal(calls, 2);
  assert.equal(env.queue.status().pending, 2);
  await env.queue.tick();
  assert.equal(calls, 2);
});

test('only explicit pre-upload limit errors are queued, not network or metadata failures', async t => {
  for (const error of [new Error('Network timeout'), Object.assign(new Error('invalidTitle'), { uploadNotStarted: true, reasons: ['invalidTitle'] }), Object.assign(limited(), { uploadNotStarted: false })]) {
    const env = setup(t, async () => { throw error; });
    await assert.rejects(env.queue.publish(env.input), error);
    assert.equal(env.queue.status().pending, 0);
  }
});

test('recovering a confirmed old rejection queues without calling the API or touching the source', async t => {
  const env = setup(t, async () => assert.fail('Recovery must not call YouTube'));
  const result = await env.queue.deferAfterLimit(env.input, limited());
  assert.equal(result.queued, true);
  assert.equal(fs.readFileSync(env.input.videoPath, 'utf8'), 'video-content');
  assert.equal(env.queue.status().pending, 1);
  await assert.rejects(env.queue.deferAfterLimit(env.input, new Error('Network timeout')), /Chỉ xếp hàng/);
});

test('worker stops on known metadata failures without repeatedly submitting the same job', async t => {
  let calls = 0;
  const env = setup(t, async () => {
    if (++calls === 1) throw limited();
    throw Object.assign(new Error('invalidDescription'), { uploadNotStarted: true, reasons: ['invalidDescription'] });
  });
  await env.queue.publish(env.input);
  env.advance();
  await env.queue.tick();
  assert.equal(env.queue.status().jobs[0].status, 'failed');
  assert.equal(fs.existsSync(env.state().jobs[0].videoPath), true);
  await env.queue.tick();
  assert.equal(calls, 2);
});

test('a live transaction lock never permits another process to overwrite the queue', async t => {
  let calls = 0;
  const env = setup(t, async () => { calls++; throw limited(); });
  await env.queue.publish(env.input);
  env.advance();
  const lock = path.join(env.options.directory, 'state.json.lock');
  fs.writeFileSync(lock, JSON.stringify({ pid: process.pid }));
  await env.queue.tick();
  assert.equal(calls, 1);
  assert.equal(env.state().jobs[0].status, 'pending');
  fs.unlinkSync(lock);
});

test('uncertain worker uploads are retained for inspection and never automatically replayed', async t => {
  let calls = 0;
  const env = setup(t, async () => { if (++calls === 1) throw limited(); throw new Error('Connection lost after upload'); });
  await env.queue.publish(env.input);
  env.advance();
  await env.queue.tick();
  assert.equal(env.queue.status().attention, 1);
  assert.equal(env.queue.status().jobs[0].status, 'uncertain');
  assert.equal(fs.existsSync(env.state().jobs[0].videoPath), true);
  await createYouTubeUploadQueue(env.options).tick();
  assert.equal(calls, 2);
  await assert.rejects(env.queue.publish(env.input), /Connection lost/);
});

test('account changes pause old jobs and multiple workers cannot claim the same upload', async t => {
  let calls = 0;
  let release;
  let started;
  const ready = new Promise(resolve => { started = resolve; });
  const env = setup(t, async () => {
    if (++calls === 1) throw limited();
    started();
    await new Promise(resolve => { release = resolve; });
    return { success: true, url: 'https://youtube.com/shorts/example' };
  });
  await env.queue.publish(env.input);
  env.advance();
  env.switchAccount('account-b');
  await env.queue.tick();
  assert.equal(calls, 1);
  assert.equal(env.queue.status().otherAccountPending, 1);
  env.switchAccount('account-a');
  const first = env.queue.tick();
  await ready;
  await createYouTubeUploadQueue(env.options).tick();
  assert.equal(calls, 2);
  release();
  await first;
});

test('a persisted interrupted upload becomes uncertain rather than retried after restart', async t => {
  const env = setup(t, async () => { throw limited(); });
  await env.queue.publish(env.input);
  const state = env.state();
  state.jobs[0].status = 'uploading';
  state.jobs[0].startedAt = Date.UTC(2026, 10, 12);
  fs.writeFileSync(path.join(env.options.directory, 'state.json'), JSON.stringify(state));
  env.advance();
  await createYouTubeUploadQueue(env.options).tick();
  assert.equal(env.queue.status().jobs[0].status, 'uncertain');
  assert.equal(env.state().jobs[0].attempts, 0);
});

test('publisher distinguishes locally queued from uploaded and does not repeat other platforms', async () => {
  const result = await publishPlatforms({ autoPostYouTube: true, autoPostTikTok: true }, {
    youtubeVideoPath: 'youtube.mp4', videoPath: 'tiktok.mp4'
  }, {
    youtube: async () => ({ queued: true, success: false, queueId: 'id', retryAt: 123, message: 'Chờ tải trên máy' }),
    tiktok: async () => ({ success: true })
  });
  assert.equal(result.success, true);
  assert.equal(result.youtubePosted, false);
  assert.equal(result.youtubeQueued, true);
  assert.equal(result.youtubeQueueId, 'id');
  assert.equal(result.tiktokPosted, true);
  assert.deepEqual(result.errors, []);
});
