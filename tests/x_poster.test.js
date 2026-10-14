import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import twitterText from 'twitter-text';
import { createXClient, prepareXCaption } from '../src/platforms/x/poster.js';

function fixture(t, responses) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'x-poster-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'video.mp4');
  fs.writeFileSync(file, Buffer.alloc(4 * 1024 * 1024 + 5));
  const calls = [];
  const client = createXClient({ accessToken: 'test-token', sleep: async () => {}, fetchImpl: async (url, options) => {
    calls.push({ url, ...options });
    assert.equal(options.headers.Authorization, 'Bearer test-token');
    const next = responses.shift();
    assert.ok(next, `Unexpected request ${url}`);
    if (next instanceof Error) throw next;
    return { ok: (next.status || 200) < 400, status: next.status || 200, json: async () => next.body || {} };
  } });
  return { file, client, calls };
}

test('X validates weighted caption lengths and only truncates generated captions', () => {
  assert.equal(prepareXCaption('Hello @someone #nature'), 'Hello #nature');
  assert.equal(prepareXCaption('中'.repeat(140)), '中'.repeat(140));
  assert.throws(() => prepareXCaption('中'.repeat(141)), /280/);
  assert.throws(() => prepareXCaption('a'.repeat(281)), /280/);
  const truncated = prepareXCaption('🌄'.repeat(200), { truncate: true });
  assert.equal(twitterText.parseTweet(truncated).valid, true);
  assert.ok(truncated.endsWith('…'));
});

test('X uploads chunks, waits for processing, submits once and returns confirmed URL', async t => {
  const { client, file, calls } = fixture(t, [
    { body: { data: { id: '123' } } }, { status: 204 }, { status: 204 },
    { body: { data: { processing_info: { state: 'pending', check_after_secs: 1 } } } },
    { body: { data: { processing_info: { state: 'succeeded' } } } },
    { body: { data: { id: '456' } } }
  ]);
  const posted = await client.post({ imagePaths: [file], caption: 'Mountain sunrise' });
  assert.equal(posted.postUrl, 'https://x.com/i/status/456');
  assert.equal(calls[1].body.get('segment_index'), '0');
  assert.equal(calls[2].body.get('segment_index'), '1');
  assert.equal(calls[1].body.get('media').size, 4 * 1024 * 1024);
  assert.equal(calls[2].body.get('media').size, 5);
  assert.match(calls[4].url, /command=STATUS&media_id=123/);
  assert.deepEqual(JSON.parse(calls[5].body), { text: 'Mountain sunrise', media: { media_ids: ['123'] } });
});

test('processing failure never publishes a text-only post', async t => {
  const { client, file, calls } = fixture(t, [
    { body: { data: { id: '123' } } }, { status: 204 }, { status: 204 },
    { body: { data: { processing_info: { state: 'failed' } } } }
  ]);
  await assert.rejects(client.post({ imagePaths: [file], caption: 'View' }), /chưa đăng bài/);
  assert.equal(calls.some(call => call.url.endsWith('/tweets')), false);
});

test('ambiguous publish response is not retried', async t => {
  const { client, file, calls } = fixture(t, [
    { body: { data: { id: '123' } } }, { status: 204 }, { status: 204 }, { body: { data: { id: '123' } } }, new Error('socket failed')
  ]);
  await assert.rejects(client.post({ imagePaths: [file], caption: 'View' }), /tránh đăng trùng/);
  assert.equal(calls.filter(call => call.url.endsWith('/tweets')).length, 1);
});

test('X rejects excess photos before making an API request', async t => {
  const { client, file, calls } = fixture(t, []);
  await assert.rejects(client.post({ imagePaths: Array(5).fill(file), caption: 'View' }), /4 ảnh/);
  assert.equal(calls.length, 0);
});

test('X handles authentication errors without exposing the token', async t => {
  const { client } = fixture(t, [{ status: 401, body: { detail: 'test-token' } }]);
  await assert.rejects(client.verify(), error => /401/.test(error.message) && !error.message.includes('test-token'));
});
