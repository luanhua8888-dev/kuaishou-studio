import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { downloadMediaFile, videoDownloadUrls } from '../src/media/download.js';

function destination(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'media-download-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return path.join(dir, 'video.mp4');
}

test('preserves selected video first and deduplicates supplied CDN alternatives', () => {
  assert.deepEqual(videoDownloadUrls({ mainMvUrls: [{ url: 'https://a/video' }, 'https://b/video', {}] }, 'https://a/video'), ['https://a/video', 'https://b/video']);
  assert.deepEqual(videoDownloadUrls({}, 'https://a/video'), ['https://a/video']);
});

test('falls back after a timed out body and writes only the complete video', async t => {
  const dest = destination(t);
  const calls = [];
  await downloadMediaFile(['https://a/video', 'https://b/video'], dest, {
    fetchImpl: async url => {
      calls.push(url);
      return calls.length === 1
        ? new Response(new ReadableStream({ start(controller) { controller.error(new DOMException('timeout', 'TimeoutError')); } }))
        : new Response(Buffer.from('complete video'));
    },
  });
  assert.deepEqual(calls, ['https://a/video', 'https://b/video']);
  assert.equal(fs.readFileSync(dest, 'utf8'), 'complete video');
  assert.equal(fs.existsSync(`${dest}.part`), false);
  await downloadMediaFile('https://a/video', dest, { fetchImpl: () => { throw new Error('must reuse file'); } });
});

test('keeps a network failure when all CDN alternatives fail without caching a partial video', async t => {
  const dest = destination(t);
  await assert.rejects(downloadMediaFile(['https://a/video', 'https://b/video'], dest, {
    fetchImpl: async () => { throw new Error('timeout'); },
  }), error => error.code === 'NETWORK_READ_FAILED');
  assert.equal(fs.existsSync(dest), false);
  assert.equal(fs.existsSync(`${dest}.part`), false);
});

async function serve(t, handler) {
  const server = http.createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  return `http://127.0.0.1:${server.address().port}`;
}

test('a long download continues while bytes arrive within the idle timeout', async t => {
  const dest = destination(t);
  const url = await serve(t, (_, res) => {
    res.writeHead(200, { 'Content-Length': '8' });
    let chunks = 0;
    const timer = setInterval(() => {
      res.write('x');
      if (++chunks === 8) { clearInterval(timer); res.end(); }
    }, 40);
    res.on('close', () => clearInterval(timer));
  });
  const started = Date.now();
  await downloadMediaFile(url, dest, { timeoutMs: 200 });
  assert.ok(Date.now() - started > 200);
  assert.equal(fs.readFileSync(dest, 'utf8'), 'xxxxxxxx');
});

test('resumes a broken transfer with Range and If-Range and preserves exact bytes', async t => {
  const dest = destination(t);
  const calls = [];
  const url = await serve(t, (req, res) => {
    calls.push(req.headers);
    if (calls.length === 1) {
      res.writeHead(200, { 'Content-Length': '10', ETag: '"video-v1"' });
      res.write('abcde');
      setTimeout(() => res.destroy(), 30);
    } else {
      res.writeHead(206, { 'Content-Range': 'bytes 5-9/10', 'Content-Length': '5', ETag: '"video-v1"' });
      res.end('fghij');
    }
  });
  await downloadMediaFile(url, dest, { retryDelayMs: 0 });
  assert.equal(calls.length, 2);
  assert.equal(calls[1].range, 'bytes=5-');
  assert.equal(calls[1]['if-range'], '"video-v1"');
  assert.equal(fs.readFileSync(dest, 'utf8'), 'abcdefghij');
});

test('restarts cleanly when the server ignores Range or the validator has changed', async t => {
  const dest = destination(t);
  let calls = 0;
  const url = await serve(t, (_, res) => {
    if (++calls === 1) {
      res.writeHead(200, { 'Content-Length': '10', ETag: '"old"' });
      res.write('old');
      setTimeout(() => res.destroy(), 30);
    } else {
      res.writeHead(200, { 'Content-Length': '10', ETag: '"new"' });
      res.end('new-video!');
    }
  });
  await downloadMediaFile(url, dest, { retryDelayMs: 0 });
  assert.equal(fs.readFileSync(dest, 'utf8'), 'new-video!');
});

test('switching CDN never appends bytes from a different source', async t => {
  const dest = destination(t);
  const url = await serve(t, (req, res) => {
    if (req.url === '/broken') {
      res.writeHead(200, { 'Content-Length': '10', ETag: '"old"' });
      res.write('old');
      setTimeout(() => res.destroy(), 30);
    } else {
      assert.equal(req.headers.range, undefined);
      res.end('complete');
    }
  });
  await downloadMediaFile([`${url}/broken`, `${url}/good`], dest, { attempts: 1 });
  assert.equal(fs.readFileSync(dest, 'utf8'), 'complete');
});

test('a stalled connection switches CDN and an exhausted transfer never creates a cached file', async t => {
  const dest = destination(t);
  const url = await serve(t, (req, res) => { if (req.url === '/good') res.end('complete'); });
  await downloadMediaFile([`${url}/stalled`, `${url}/good`], dest, { timeoutMs: 50 });
  assert.equal(fs.readFileSync(dest, 'utf8'), 'complete');
  const failedDest = `${dest}.failed`;
  await assert.rejects(downloadMediaFile(`${url}/stalled`, failedDest, { timeoutMs: 50, attempts: 1 }), { code: 'NETWORK_READ_FAILED' });
  assert.equal(fs.existsSync(failedDest), false);
});

test('rejects invalid resumed ranges rather than silently corrupting a video', async t => {
  const dest = destination(t);
  let calls = 0;
  const url = await serve(t, (_, res) => {
    if (++calls === 1) {
      res.writeHead(200, { 'Content-Length': '10', ETag: '"video"' });
      res.write('abcde');
      setTimeout(() => res.destroy(), 30);
    } else {
      res.writeHead(206, { 'Content-Range': 'bytes 0-4/10', 'Content-Length': '5' });
      res.end('abcde');
    }
  });
  await assert.rejects(downloadMediaFile(url, dest, { attempts: 2, retryDelayMs: 0 }), { code: 'NETWORK_READ_FAILED' });
  assert.equal(fs.existsSync(dest), false);
  assert.equal(fs.existsSync(`${dest}.part`), false);
});

test('rejects HTTP error pages even when the CDN returns status 200', async t => {
  const dest = destination(t);
  await assert.rejects(downloadMediaFile('https://a/video', dest, {
    attempts: 1, fetchImpl: async () => new Response('<html>blocked</html>', { headers: { 'Content-Type': 'text/html' } }),
  }), /trang lỗi/);
  assert.equal(fs.existsSync(dest), false);
});

test('rejects a resumed response with a changed ETag and restarts without Range', async t => {
  const dest = destination(t);
  const requests = [];
  const url = await serve(t, (req, res) => {
    requests.push(req.headers);
    if (requests.length === 1) {
      res.writeHead(200, { 'Content-Length': '10', ETag: '"old"' });
      res.write('old');
      setTimeout(() => res.destroy(), 30);
    } else if (requests.length === 2) {
      res.writeHead(206, { 'Content-Range': 'bytes 3-9/10', 'Content-Length': '7', ETag: '"new"' });
      res.end('changed');
    } else {
      res.writeHead(200, { 'Content-Length': '10', ETag: '"new"' });
      res.end('new-video!');
    }
  });
  await downloadMediaFile(url, dest, { retryDelayMs: 0 });
  assert.equal(requests.length, 3);
  assert.equal(requests[2].range, undefined);
  assert.equal(fs.readFileSync(dest, 'utf8'), 'new-video!');
});

test('a continuously active transfer is still bounded by the total deadline', async t => {
  const dest = destination(t);
  const url = await serve(t, (_, res) => {
    const timer = setInterval(() => res.write('x'), 20);
    res.on('close', () => clearInterval(timer));
  });
  await assert.rejects(downloadMediaFile(url, dest, { timeoutMs: 200, maxDurationMs: 150, retryDelayMs: 0 }), { code: 'NETWORK_READ_FAILED' });
  assert.equal(fs.existsSync(dest), false);
  assert.equal(fs.existsSync(`${dest}.part`), false);
});
