import test from 'node:test';
import assert from 'node:assert/strict';
import { planSlideshow, wrapStory } from './tiktok-slideshow.js';

test('duration includes dissolve overlaps, with exact 30fps boundaries', () => {
  for (const durationSeconds of [12, 13, 14, 15, 13.17]) {
    for (const imageCount of [1, 2, 5, 18]) {
      const plan = planSlideshow(imageCount, { durationSeconds });
      assert.equal(plan.scenes.at(-1).end, plan.totalFrames);
      for (const scene of plan.scenes) assert.ok(Number.isInteger(scene.frames));
      assert.ok(plan.scenes.length <= imageCount);
    }
  }
});

test('text fits two lines without dropping Vietnamese words', () => {
  const input = 'Giữa những vách núi và mặt nước yên như thế này…';
  const result = wrapStory(input, 740, 48, (text, size) => text.length * size * 0.55);
  assert.ok(result.text.split('\n').length <= 2);
  assert.equal(result.text.replaceAll('\n', ' '), input);
  assert.ok(result.fontSize >= 30);
  assert.throws(() => wrapStory('x'.repeat(200), 100, 48, (text, size) => text.length * size), /quá dài/);
});

test('reject invalid or impossible timing rather than truncate content', () => {
  assert.throws(() => planSlideshow(0), /Không có ảnh/);
  assert.throws(() => planSlideshow(20, { durationSeconds: 2, sceneCount: 20 }), /quá ngắn/);
  assert.throws(() => planSlideshow(4, { durationSeconds: '14' }), /phải là số/);
});
