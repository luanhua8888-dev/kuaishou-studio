import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { callToAction, withCallToAction } from '../../src/content/call-to-action.js';
import { buildYouTubeMetadata } from '../../src/platforms/youtube/metadata.js';

test('the follow line goes between the caption and its hashtags, only once', () => {
  const caption = withCallToAction('Chiều nay thật yên\n\n#binhyen #phongcanh', 'Follow nhé.');
  assert.equal(caption, 'Chiều nay thật yên\n\nFollow nhé.\n\n#binhyen #phongcanh');
  assert.equal(withCallToAction(caption, 'Follow nhé.'), caption);
  assert.equal(withCallToAction('Không hashtag', 'Follow nhé.'), 'Không hashtag\n\nFollow nhé.');
  assert.equal(withCallToAction('Giữ nguyên', ''), 'Giữ nguyên');
});

test('settings can turn the follow line off or replace its text', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cta-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'settings.json');
  assert.match(callToAction('youtube', 'en', file), /Subscribe/);
  fs.writeFileSync(file, JSON.stringify({ callToAction: false }));
  assert.equal(callToAction('tiktok', 'vi', file), '');
  fs.writeFileSync(file, JSON.stringify({ callToAction: { tiktok: { vi: 'Theo dõi kênh nha!' } } }));
  assert.equal(callToAction('tiktok', 'vi', file), 'Theo dõi kênh nha!');
  assert.match(callToAction('youtube', 'vi', file), /Đăng ký kênh/);
});

test('YouTube description carries the subscribe line and the hashtags', () => {
  const meta = buildYouTubeMetadata('Quiet evening\n#nature #calm', { description: 'A calm sunset.', callToAction: 'Subscribe for more.' });
  assert.equal(meta.youtubeTitle, 'Quiet evening #nature #calm');
  assert.equal(meta.youtubeDescription, 'A calm sunset.\n\nSubscribe for more.\n\n#nature #calm');
});
