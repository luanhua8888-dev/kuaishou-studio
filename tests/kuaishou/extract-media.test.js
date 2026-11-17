import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { extractMedia, extractUrl } from '../../src/kuaishou/extract-media.js';
import { cleanPureText } from '../../src/content/caption.js';
import { formatMoodQuote } from '../../src/media/cinematic-reel.js';
import { sanitizeFileName, removeDownloadDirectory } from '../../src/media/workspace.js';
import { DOWNLOADS_DIR, PROJECT_ROOT } from '../../src/paths.js';

test('extractUrl takes the first link from shared text', () => {
  assert.equal(extractUrl('Xem nè https://v.kuaishou.com/abc123 hay lắm'), 'https://v.kuaishou.com/abc123');
  assert.equal(extractUrl('không có link'), null);
  assert.equal(extractUrl(undefined), null);
});

test('extractMedia builds atlas image URLs from the CDN list and reads soundtrack audio', () => {
  const media = extractMedia({
    photo: {
      photoId: '42', caption: 'Hoàng hôn', userName: 'tac_gia',
      atlas: { list: ['/a/1.webp', 'b/2.webp', 'https://cdn.example/3.jpg'], cdnList: [{ cdn: 'p9.a.yximgs.com' }] },
      soundTrack: { name: 'Song', artist: 'Singer', audioUrls: [{ url: 'https://cdn/audio.m4a' }] },
    },
  });
  assert.deepEqual(media.images, ['https://p9.a.yximgs.com/a/1.webp', 'https://p9.a.yximgs.com/b/2.webp', 'https://cdn.example/3.jpg']);
  assert.equal(media.isVideo, false);
  assert.equal(media.musicUrl, 'https://cdn/audio.m4a');
  assert.equal(media.musicName, 'Song');
  assert.equal(media.author, 'tac_gia');
});

test('extractMedia treats a post with a video URL as video and keeps the cover as thumbnail', () => {
  const media = extractMedia({ photo: { photoId: '7', mainMvUrls: [{ url: 'https://cdn/v.mp4' }], coverUrls: [{ url: 'https://cdn/c.jpg' }] } });
  assert.equal(media.isVideo, true);
  assert.equal(media.videoUrl, 'https://cdn/v.mp4');
  assert.deepEqual(media.images, ['https://cdn/c.jpg']);
});

test('extractMedia falls back to an mp4 link found in the page HTML', () => {
  const media = extractMedia({ photo: {} }, '<script>"https://v2.kwaicdn.com/upic/x.mp4?tag=1"</script>');
  assert.equal(media.videoUrl, 'https://v2.kwaicdn.com/upic/x.mp4?tag=1');
});

test('cleanPureText removes emoji, hashtags, links and BGM credits', () => {
  assert.equal(cleanPureText('Chiều nay 🌅 #hoanghon https://x.y/z BGM: abc'), 'Chiều nay');
});

test('formatMoodQuote wraps into at most three balanced lines', () => {
  const quote = formatMoodQuote('Có những ngày chỉ muốn ngồi yên một góc nhìn mây trôi và nghe gió kể chuyện ngày xưa thật lâu');
  const lines = quote.split('\n');
  assert.ok(lines.length >= 2 && lines.length <= 3, quote);
  assert.ok(lines.every(line => line.length <= 39), quote);
});

test('sanitizeFileName keeps a safe folder name', () => {
  assert.equal(sanitizeFileName('a/b:c*d'), 'abcd');
  assert.equal(sanitizeFileName(''), 'kuaishou');
});

test('removeDownloadDirectory refuses paths outside downloads/', () => {
  assert.throws(() => removeDownloadDirectory(PROJECT_ROOT));
  assert.throws(() => removeDownloadDirectory(DOWNLOADS_DIR));
  assert.throws(() => removeDownloadDirectory(path.join(DOWNLOADS_DIR, '..', 'src')));
});
