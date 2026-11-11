import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreThumbnail, applyYouTubeThumbnail } from '../../src/platforms/youtube/thumbnail.js';

test('thumbnail quality penalizes blank and clipped frames', () => {
  const pixels = Buffer.alloc(96 * 160 * 3);
  for (let i = 0; i < pixels.length; i += 3) pixels.fill((i / 3) % 2 ? 190 : 65, i, i + 3);
  assert.ok(scoreThumbnail(pixels) > scoreThumbnail(Buffer.alloc(pixels.length)));
  assert.ok(scoreThumbnail(pixels) > scoreThumbnail(Buffer.alloc(pixels.length, 255)));
  assert.equal(scoreThumbnail(Buffer.alloc(0)), -Infinity);
});

test('thumbnail timeout never tries to upload before video processing completes', async () => {
  let calls = 0;
  await assert.rejects(applyYouTubeThumbnail('video', 'unused.jpg', 'token', {
    attempts: 2, sleep: async () => {},
    fetchImpl: async url => {
      calls++;
      assert.ok(url.includes('part=processingDetails'));
      return { ok: true, json: async () => ({ items: [{ processingDetails: { processingStatus: 'processing' } }] }) };
    }
  }), /còn xử lý/);
  assert.equal(calls, 2);
});

test('processing API errors are reported instead of uploading a thumbnail', async () => {
  await assert.rejects(applyYouTubeThumbnail('video', 'unused.jpg', 'token', {
    fetchImpl: async () => ({ ok: false, status: 403 })
  }), /403/);
});
