import test from 'node:test';
import assert from 'node:assert/strict';
import { buildYouTubeMetadata, youtubeHashtags, polishYouTubeMetadata } from '../../src/platforms/youtube/metadata.js';

test('cleans quotes, Chinese dashes, and literal machine-translated phrases in titles', () => {
  const quoted = buildYouTubeMetadata('“Waiting for an encounter in New Zealand summer”\n#travel #scenery #shorts');
  assert.equal(quoted.youtubeTitle, 'Waiting for an encounter in New Zealand summer #travel #scenery #shorts');

  const dash = buildYouTubeMetadata('The country of tourism——Italy\n#travel #shorts');
  assert.equal(dash.youtubeTitle, 'Exploring Italy #travel #shorts');

  const county = buildYouTubeMetadata('"Later, I stayed in a small county town where the wind slowed down"\n#slowliving #shorts');
  assert.ok(!county.youtubeTitle.includes('"'));
  assert.match(county.youtubeTitle, /quiet small town/);

  const watermark = buildYouTubeMetadata('HONOR Magic9 Pro Max| Red walls in autumn\n#scenery #shorts');
  assert.equal(watermark.youtubeTitle, 'Red walls in autumn #scenery #shorts');
});

test('truncates long titles at word boundaries instead of cutting words in half', () => {
  const longText = 'Later I stayed in a quiet small town where my family could meet me and every peaceful afternoon felt warm #slowliving #peaceful #shorts';
  const meta = buildYouTubeMetadata(longText);
  assert.ok(meta.youtubeTitle.length <= 100);
  assert.ok(meta.youtubeTitle.endsWith('#slowliving #peaceful #shorts'));
  const headingPart = meta.youtubeTitle.replace(/\s+#.*$/, '');
  assert.ok(!/\b[a-z]{1,2}$/i.test(headingPart) || /\b(me|in|on|to|at|by|us)$/i.test(headingPart));
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
  assert.match(meta.youtubeTitle, /#shorts\b/i);
  assert.ok(Array.isArray(meta.youtubeTags) && meta.youtubeTags.includes('shorts'));
  assert.match(meta.youtubeDescription, /Subscribe for daily peaceful scenery\./);
});

