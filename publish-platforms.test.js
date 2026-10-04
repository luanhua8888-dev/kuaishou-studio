import test from 'node:test';
import assert from 'node:assert/strict';
import { publishPlatforms } from './publish-platforms.js';

const options = { autoPostIG: true, autoPostFB: true, autoPostTikTok: true, autoPostThreads: true };
const media = { imagePaths: ['video.mp4'], videoPath: 'video.mp4', caption: 'Một khoảnh khắc' };

test('Threads receives its own optimized caption without changing other platforms', async () => {
  await publishPlatforms(options, { ...media, threadsCaption: 'A quiet moment\n#nature' }, {
    instagram: async input => { assert.equal(input.caption, media.caption); return { success: true, facebookShared: true }; },
    tiktok: async input => { assert.equal(input.caption, media.caption); return { success: true }; },
    threads: async input => { assert.equal(input.caption, 'A quiet moment\n#nature'); return { success: true }; }
  });
});

test('one sheet link posts Instagram with Facebook sharing, TikTok and Threads', async () => {
  const calls = [];
  const result = await publishPlatforms(options, media, {
    instagram: async input => { calls.push('ig/fb'); assert.equal(input.shareToFacebook, true); return { success: true, facebookShared: true }; },
    tiktok: async () => { calls.push('tiktok'); return { success: true }; },
    threads: async () => { calls.push('threads'); return { success: true }; }
  });
  assert.deepEqual(calls, ['ig/fb', 'tiktok', 'threads']);
  assert.equal(result.success, true);
  assert.equal(result.igPosted && result.fbPosted && result.tiktokPosted && result.threadsPosted, true);
});

test('Instagram success alone does not count as Facebook success', async () => {
  const result = await publishPlatforms(options, media, {
    instagram: async () => ({ success: true, facebookShared: false }),
    tiktok: async () => ({ success: true }),
    threads: async () => ({ success: true })
  });
  assert.equal(result.igPosted, true);
  assert.equal(result.fbPosted, false);
  assert.equal(result.partialFailure, true);
});

test('Instagram failure does not prevent TikTok and Threads attempts', async () => {
  const result = await publishPlatforms(options, media, {
    instagram: async () => { throw new Error('upload failed'); },
    tiktok: async () => ({ success: true }),
    threads: async () => ({ success: true })
  });
  assert.equal(result.partialFailure, true);
  assert.equal(result.igPosted, false);
  assert.equal(result.fbPosted, false);
  assert.equal(result.tiktokPosted, true);
  assert.equal(result.threadsPosted, true);
});
