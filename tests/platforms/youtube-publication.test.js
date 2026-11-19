import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { youtubePublication } from '../../src/platforms/youtube/poster.js';
import { publishPlatforms } from '../../src/platforms/publish.js';

test('publish now requests public without reserving or sending a schedule', () => {
  const result = youtubePublication('now', () => assert.fail('Must not reserve a slot'));
  assert.deepEqual(result, { status: { privacyStatus: 'public', selfDeclaredMadeForKids: false }, publishAt: null });
  assert.equal(Object.hasOwn(result.status, 'publishAt'), false);
});

test('default publication retains private scheduled uploads', () => {
  const publishAt = new Date(Date.now() + 86400000).toISOString();
  let calls = 0;
  const result = youtubePublication(undefined, () => { calls++; return { publishAt }; });
  assert.equal(calls, 1);
  assert.deepEqual(result, { status: { privacyStatus: 'private', publishAt, selfDeclaredMadeForKids: false }, publishAt });
});

test('invalid mode fails before reserving a slot', () => {
  assert.throws(() => youtubePublication('typo', () => assert.fail('Must not reserve')), /không hợp lệ/);
});

test('publisher passes the selected mode, with scheduled as the safe default', async () => {
  for (const mode of [undefined, 'now', 'scheduled']) {
    const result = await publishPlatforms({ autoPostYouTube: true, youtubePublishMode: mode }, { youtubeVideoPath: 'clean.mp4' }, {
      youtube: async input => {
        assert.equal(input.publishMode, mode ?? 'scheduled');
        return { success: true, scheduledAt: null };
      }
    });
    assert.equal(result.youtubePosted, true);
  }
});

test('publication mode is included in both manual requests and sheet options', () => {
  const html = fs.readFileSync(new URL('../../public/index.html', import.meta.url), 'utf8');
  assert.match(html, /id="youtubePublishMode"/);
  assert.match(html, /autoPostYouTube: shouldPostYouTube,\s+youtubePublishMode,/);
  const options = html.slice(html.indexOf('function sheetOptions()'), html.indexOf('function renderSheetQueue('));
  assert.match(options, /youtubePublishMode/);
});
