import test from 'node:test';
import assert from 'node:assert/strict';
import { buildYouTubeMetadata, YOUTUBE_TITLE_TARGET } from '../../src/platforms/youtube/metadata.js';

test('keeps headline readable and moves up to three unique hashtags to description', () => {
  const result = buildYouTubeMetadata('A quiet walk in Osaka\n#Japan #japan #Osaka #night #travel', { description: 'An evening walk. #unrelated' });
  assert.equal(result.youtubeTitle, 'A quiet walk in Osaka');
  assert.equal(result.youtubeDescription, 'An evening walk.\n\n#Japan #Osaka #night');
});

test('shortens at word boundaries without inventing a clickbait headline', () => {
  const result = buildYouTubeMetadata('An evening walk through the quiet streets of Osaka reveals a different side of the city after sunset');
  assert.ok(result.youtubeTitle.length <= YOUTUBE_TITLE_TARGET);
  assert.equal(result.youtubeTitle, 'An evening walk through the quiet streets of…');
});

test('handles empty captions and languages without spaces', () => {
  assert.equal(buildYouTubeMetadata('', { language: 'vi' }).youtubeTitle, 'Khoảnh khắc đáng nhớ');
  const result = buildYouTubeMetadata('秋'.repeat(120));
  assert.equal(result.youtubeTitle, '秋'.repeat(YOUTUBE_TITLE_TARGET - 1) + '…');
});

test('preserves complete Unicode characters and hashtags within metadata budgets', () => {
  const result = buildYouTubeMetadata('🌿'.repeat(100) + ' #nature #' + 'x'.repeat(80), { description: '🌿'.repeat(3000) });
  assert.ok(result.youtubeTitle.length <= YOUTUBE_TITLE_TARGET);
  assert.ok(result.youtubeDescription.length <= 5000);
  assert.ok(result.youtubeDescription.endsWith('\n\n#nature'));
  assert.equal(result.youtubeTitle.isWellFormed(), true);
  assert.equal(result.youtubeDescription.isWellFormed(), true);
});
