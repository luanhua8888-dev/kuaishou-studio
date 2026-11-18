import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { postToYouTubeShort, youtubeUploadError } from '../../src/platforms/youtube/poster.js';
import { buildYouTubeMetadata } from '../../src/platforms/youtube/metadata.js';

test('upload reports API reason, sanitizes metadata and never retries a rejected request', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'youtube-upload-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const videoPath = path.join(dir, 'video.mp4');
  fs.writeFileSync(videoPath, 'test');
  let calls = 0;
  await assert.rejects(postToYouTubeShort({ videoPath, title: ' <>\u0000 ', description: '🌿<>'.repeat(3000), publishMode: 'now' }, {
    accessToken: async () => 'test-token',
    prepareVideo: async file => file,
    reserveSlot: () => assert.fail('Do not reserve for immediate upload'),
    fetchImpl: async (_, options) => {
      calls++;
      const metadata = JSON.parse(options.body);
      assert.equal(metadata.snippet.title, 'Video mới');
      assert.ok(Buffer.byteLength(metadata.snippet.description) <= 5000);
      assert.equal(metadata.snippet.description.isWellFormed(), true);
      assert.doesNotMatch(metadata.snippet.description, /[<>]/);
      return new Response(JSON.stringify({ error: { message: 'Invalid scheduled publishing time.', errors: [{ reason: 'invalidPublishAt' }] } }), { status: 400 });
    }
  }), /400: invalidPublishAt.*Giờ hẹn công khai/);
  assert.equal(calls, 1);
});

test('default preparation preserves the original video bytes and audio', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'youtube-original-audio-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const videoPath = path.join(dir, 'video.mp4');
  fs.writeFileSync(videoPath, 'original video with audio');
  const messages = [];
  await assert.rejects(postToYouTubeShort({ videoPath, publishMode: 'now', onProgress: message => messages.push(message) }, {
    accessToken: async () => 'test-token',
    fetchImpl: async (_, options) => {
      assert.equal(options.headers['X-Upload-Content-Length'], String(fs.statSync(videoPath).size));
      assert.equal(fs.readFileSync(videoPath, 'utf8'), 'original video with audio');
      return new Response('{}', { status: 400 });
    }
  }), /400/);
  assert.ok(messages.some(message => message.includes('giữ nguyên âm thanh gốc')));
});

test('failed audio preparation prevents authentication and upload', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'youtube-audio-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const videoPath = path.join(dir, 'video.mp4');
  fs.writeFileSync(videoPath, 'test');
  await assert.rejects(postToYouTubeShort({ videoPath }, {
    prepareVideo: async () => { throw new Error('audio removal failed'); },
    accessToken: () => assert.fail('must not authenticate'),
    fetchImpl: () => assert.fail('must not upload')
  }), error => error.uploadNotStarted === true && /audio removal failed/.test(error.message));
});

test('non-JSON API errors still include status and do not leak HTML', async () => {
  const error = await youtubeUploadError(new Response('<html>gateway error</html>', { status: 502 }), 'từ chối tạo video');
  assert.match(error.message, /502/);
  assert.doesNotMatch(error.message, /<html>/);
});

test('metadata uses UTF-8 byte budget and removes prohibited characters', () => {
  const result = buildYouTubeMetadata('<A quiet moment> #nature', { description: '秋🌿'.repeat(3000) });
  assert.equal(result.youtubeTitle, 'A quiet moment');
  assert.ok(Buffer.byteLength(result.youtubeDescription) <= 5000);
  assert.ok(result.youtubeDescription.endsWith('#nature'));
  assert.equal(result.youtubeDescription.isWellFormed(), true);
});
