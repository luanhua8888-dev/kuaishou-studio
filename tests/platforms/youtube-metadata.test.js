import test from 'node:test';
import assert from 'node:assert/strict';
import { buildYouTubeMetadata, youtubeHashtags, polishYouTubeMetadata, YOUTUBE_TITLE_TARGET } from '../../src/platforms/youtube/metadata.js';

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

test('cleans quotes, Chinese dashes, phone watermarks, and literal machine-translated phrases', () => {
  const quoted = buildYouTubeMetadata('“Waiting for an encounter in New Zealand summer”\n#travel #scenery #shorts');
  assert.equal(quoted.youtubeTitle, 'Waiting for an encounter in New Zealand summer');
  assert.match(quoted.youtubeDescription, /#travel #scenery #shorts$/);

  const dash = buildYouTubeMetadata('The country of tourism——Italy\n#travel #shorts');
  assert.equal(dash.youtubeTitle, 'Exploring Italy');

  const county = buildYouTubeMetadata('"Later, I stayed in a small county town"\n#slowliving #shorts');
  assert.ok(!county.youtubeTitle.includes('"'));
  assert.match(county.youtubeTitle, /quiet small town/);

  const watermark = buildYouTubeMetadata('HONOR Magic9 Pro Max| Red walls in autumn\n#scenery #shorts');
  assert.equal(watermark.youtubeTitle, 'Red walls in autumn');
});

test('generates niche English Shorts hashtags instead of generic #moments #sharing', () => {
  const nz = youtubeHashtags('Waiting for an encounter in New Zealand summer #风景');
  assert.match(nz, /#shorts\b/i);
  assert.match(nz, /#travel\b|#scenery\b|#nature\b/);
  assert.doesNotMatch(nz, /#moments|#sharing|#storytelling/);

  const fallback = youtubeHashtags('I do not need any foreshadowing to like you');
  assert.match(fallback, /#shorts\b/i);
  assert.doesNotMatch(fallback, /#moments|#sharing|#storytelling/);
});

test('polishYouTubeMetadata builds clean English metadata and API tags without requiring Gemini key', async () => {
  const meta = await polishYouTubeMetadata({
    rawTitle: '在小县城的生活很美 #治愈 #慢生活',
    englishCaption: '"Life in a small county is beautiful"',
    englishDescription: 'Life in a small county is beautiful',
    callToAction: 'Subscribe for daily peaceful scenery.',
    apiKey: ''
  });
  assert.ok(!meta.youtubeTitle.includes('"'));
  assert.ok(Array.isArray(meta.youtubeTags) && meta.youtubeTags.includes('shorts'));
  assert.match(meta.youtubeDescription, /Subscribe for daily peaceful scenery\./);
  assert.match(meta.youtubeDescription, /#shorts\b/i);
});
