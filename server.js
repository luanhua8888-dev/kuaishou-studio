import http from 'http';
import { normalizeCaptionText, readJsonBody } from './caption-text.js';
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { fileURLToPath } from 'url';
import { Readable } from 'stream';
import util from 'util';
import { checkLoginStatus, interactiveLogin, postToInstagram } from './ig_poster.js';
import { checkLoginStatus as checkTikTokStatus, postToTikTok } from './tiktok_poster.js';
import { createSheetQueue, SHEET_URL } from './sheet-queue.js';
import { createGoogleSheet } from './google-sheet.js';
import { getPostPage, findPhotoData } from './kuaishou-page.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const execPromise = util.promisify(exec);

const PORT = 3000;
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
const MOBILE_USER_AGENT = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36';
const pipelineProgress = new Map();
const sheetQueue = createSheetQueue({
  statePath: path.join(__dirname, 'sheet-queue-state.json'),
  settingsPath: path.join(__dirname, '.setting'),
  sheet: createGoogleSheet({ settingsPath: path.join(__dirname, '.setting') }),
  async runPipeline(url, options) {
    const response = await fetch(`http://127.0.0.1:${PORT}/api/run-pipeline`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, ...options, jobId: `sheet-${Date.now()}` })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
    return result;
  }
});

function setPipelineProgress(jobId, message) {
  if (typeof jobId === 'string' && /^[a-zA-Z0-9-]{1,64}$/.test(jobId)) {
    pipelineProgress.set(jobId, message);
  }
}

function removeDownloadDirectory(target) {
  const root = path.resolve(__dirname, 'downloads');
  const resolved = path.resolve(target);
  const relative = path.relative(root, resolved);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Đường dẫn dọn dẹp nằm ngoài downloads');
  }
  fs.rmSync(resolved, { recursive: true, force: true });
}

function sanitizeFileName(name) {
  const normalized = (name || 'kuaishou').normalize('NFKD').replace(/[^\w\s-]/g, '').trim();
  return (normalized || 'kuaishou').replace(/[\r\n\t]/g, ' ');
}

/**
 * Clean text to pure words only (strictly NO emojis, icons, gifs, decorative symbols)
 */
function cleanPureText(str) {
  if (!str) return '';
  return normalizeCaptionText(str)
    .replace(/[\p{Extended_Pictographic}\p{Emoji_Presentation}\uFE0F]/gu, '')
    .replace(/#[\w\u4e00-\u9fa5]+/g, '')
    .replace(/https?:\/\/[^\s]+/g, '')
    .replace(/BGM:.*$/i, '')
    .replace(/[-_—=~*•★☆✦✧▲▼►◄\/\\]{2,}/g, ' ')
    .replace(/^[“"']+|[”"']+$/g, '')
    .replace(/[\r\n\t]+/g, ' ')
    .trim();
}

/**
 * Format aesthetic mood quote text for TikTok video overlay (pure text only)
 */
function formatMoodQuote(rawText, maxLineLen = 39, maxLines = 3) {
  const clean = cleanPureText(rawText);
  if (!clean) return '';

  const words = clean.split(/\s+/);
  const lines = [];
  let currentLine = '';

  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    if (testLine.length <= maxLineLen) {
      currentLine = testLine;
    } else {
      if (currentLine) lines.push(currentLine);
      currentLine = word;
      if (lines.length >= maxLines) {
        currentLine = '';
        break;
      }
    }
  }
  if (currentLine && lines.length < maxLines) {
    lines.push(currentLine);
  }

  // Keep the minimum line count, then balance the visible lines for a cleaner card.
  if (lines.length > 1 && lines.join(' ').split(' ').length === words.length) {
    const target = clean.length / lines.length;
    const memo = new Map();
    function balance(start, remaining) {
      const key = `${start}:${remaining}`;
      if (memo.has(key)) return memo.get(key);
      if (!remaining) return start === words.length ? { cost: 0, lines: [] } : null;
      let best = null;
      for (let end = start + 1; end <= words.length - remaining + 1; end++) {
        const line = words.slice(start, end).join(' ');
        if (line.length > maxLineLen) break;
        const rest = balance(end, remaining - 1);
        if (!rest) continue;
        const cost = (line.length - target) ** 2 + rest.cost;
        if (!best || cost < best.cost) best = { cost, lines: [line, ...rest.lines] };
      }
      memo.set(key, best);
      return best;
    }
    const balanced = balance(0, lines.length);
    if (balanced) return balanced.lines.join('\n');
  }
  return lines.join('\n');
}

function roundedCaptionFilter(quoteText, fontPath, textPath) {
  const lines = quoteText.split('\n');
  const longest = Math.max(...lines.map(line => Array.from(line).length));
  const width = Math.min(1000, Math.max(240, Math.ceil(longest * 24 + 84)));
  const height = lines.length * 64 + 58;
  const x = Math.round((1080 - width) / 2);
  const y = Math.round((1920 - height) / 2 + 280);
  function roundedBox(boxX, boxY, boxWidth, boxHeight, color) {
    const slices = [
      [20, 0, 4], [11, 4, 4], [6, 8, 4], [3, 12, 4], [1, 16, 4],
      [0, 20, boxHeight - 40],
      [1, boxHeight - 20, 4], [3, boxHeight - 16, 4],
      [6, boxHeight - 12, 4], [11, boxHeight - 8, 4], [20, boxHeight - 4, 4]
    ];
    return slices.map(([inset, top, sliceHeight]) =>
      `drawbox=x=${boxX + inset}:y=${boxY + top}:w=${boxWidth - inset * 2}:h=${sliceHeight}:color=${color}:t=fill`
    ).join(',');
  }
  const shadow = roundedBox(x + 3, y + 8, width, height, 'black@0.10');
  const rim = roundedBox(x, y, width, height, 'white@0.04');
  const panel = roundedBox(x + 2, y + 2, width - 4, height - 4, '0x111925@0.52');
  return `,${shadow},${rim},${panel},drawtext=fontfile='${fontPath}':textfile='${textPath}':fontcolor=white:expansion=none:fontsize=42:line_spacing=22:text_align=center:x=(w-text_w)/2:y=(h-text_h)/2+280:shadowcolor=black@0.45:shadowx=1:shadowy=2`;
}

/**
 * Merge images and audio into a cinematic 9:16 vertical 1080x1920 video at 30 fps
 * with ambient blurred backdrop, full original image framing, silky-smooth crossfade transitions,
 * and optional pure text mood quote overlay (for TikTok only)
 */
async function createCinematicReel(imageInput, audioPath, outputPath, moodQuote = '', frameCacheDir = null) {
  const images = Array.isArray(imageInput) ? imageInput : [imageInput];
  const validImages = images.filter(p => fs.existsSync(p));
  if (validImages.length === 0) {
    throw new Error('Không tìm thấy hình ảnh hợp lệ để tạo video');
  }

  // Determine audio duration if available
  let audioDuration = null;
  if (audioPath && fs.existsSync(audioPath)) {
    try {
      const { stdout } = await execPromise(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${audioPath}"`);
      const dur = parseFloat(stdout.trim());
      if (!isNaN(dur) && dur > 0) {
        audioDuration = dur;
      }
    } catch {}
  }

  const tempDir = frameCacheDir || path.join(path.dirname(outputPath), 'temp_reel_' + Date.now());
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  try {
    // Take up to 10 images for optimal slideshow pacing
    const selectedImages = validImages.slice(0, 10);
    const numImages = selectedImages.length;

    // Chuẩn bị filter chèn chữ tâm trạng tiếng Việt với font Monospaced và nền mờ tối dịu mắt
    let quoteFilter = '';
    if (moodQuote && moodQuote.trim()) {
      const quoteText = formatMoodQuote(moodQuote);
      if (quoteText) {
        const quotePath = path.join(tempDir, 'mood_quote.txt');
        fs.writeFileSync(quotePath, quoteText, 'utf-8');
        const escapedQuotePath = quotePath.replace(/\\/g, '/').replace(/:/g, '\\:');

        // A clean, semibold UI font supports Vietnamese without the monospaced look.
        const captionFont = fs.existsSync('C:/Windows/Fonts/seguisb.ttf')
          ? 'C\\:/Windows/Fonts/seguisb.ttf'
          : fs.existsSync('C:/Windows/Fonts/CascadiaMono.ttf')
          ? 'C\\:/Windows/Fonts/CascadiaMono.ttf'
          : (fs.existsSync('C:/Windows/Fonts/consola.ttf') ? 'C\\:/Windows/Fonts/consola.ttf' : 'C\\:/Windows/Fonts/cour.ttf');

        quoteFilter = roundedCaptionFilter(quoteText, captionFont, escapedQuotePath);
      }
    }

    // Step 1: Pre-process each image into an ultra-sharp 1080x1920 9:16 frame
    console.log(`[Reel] Xử lý ${numImages} hình ảnh chất lượng cao chuẩn khung hình 9:16...`);
    const framedImages = new Array(numImages);
    const prepareFrame = async (i) => {
      const src = selectedImages[i];
      const frameName = `frame_${String(i).padStart(2, '0')}.png`;
      const basePath = path.join(tempDir, frameName);
      const framedPath = quoteFilter ? path.join(tempDir, `quote_${frameName}`) : basePath;
      if (fs.existsSync(framedPath)) {
        framedImages[i] = framedPath;
        return;
      }
      // A second platform can reuse the scaled and sharpened frame.
      if (quoteFilter && fs.existsSync(basePath)) {
        await execPromise(`ffmpeg -y -i "${basePath}" -vf "${quoteFilter.slice(1)}" -frames:v 1 "${framedPath}"`);
        framedImages[i] = framedPath;
        return;
      }

      let isFull9x16 = false;
      try {
        const { stdout: dims } = await execPromise(`ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 "${src}"`);
        const [w, h] = dims.trim().split(',').map(Number);
        if (w && h) isFull9x16 = (h / w) >= 1.70;
      } catch {}

      let vf;
      if (isFull9x16) {
        // Ảnh dọc chuẩn 9:16: lấp đầy toàn màn hình không viền mờ, sắc nét tối đa
        vf = `scale=1080:1920:force_original_aspect_ratio=increase:flags=lanczos,crop=1080:1920,unsharp=lx=5:ly=5:la=0.4:cx=5:cy=5:ca=0.0${quoteFilter}`;
      } else {
        // Ảnh 4:5, 3:4, vuông 1:1 hoặc ngang: giữ nguyên 100% độ nét và bố cục gốc (không zoom vỡ hạt, không cắt góc)
        // Nền mờ đồng sắc phía sau + ảnh chính nguyên bản sắc nét ở trung tâm
        vf = `split[bg][fg];[bg]scale=1080:1920:force_original_aspect_ratio=increase:flags=lanczos,crop=1080:1920,boxblur=25:5,eq=brightness=-0.12[bg_blur];[fg]scale=1080:1920:force_original_aspect_ratio=decrease:flags=lanczos[fg_fit];[bg_blur][fg_fit]overlay=(W-w)/2:(H-h)/2,unsharp=lx=5:ly=5:la=0.4:cx=5:cy=5:ca=0.0${quoteFilter}`;
      }

      await execPromise(`ffmpeg -y -i "${src}" -vf "${vf}" -frames:v 1 "${framedPath}"`);
      framedImages[i] = framedPath;
    };
    for (let i = 0; i < numImages; i += 2) {
      await Promise.all([i, i + 1].filter(index => index < numImages).map(prepareFrame));
    }

    // Step 2: Build video from framed images
    const transitionDuration = 0.75; // smooth crossfade duration in seconds

    if (numImages === 1) {
      console.log('[Reel] Tạo video từ 1 hình ảnh chất lượng cao chuẩn HD 30fps...');
      const totalDur = audioDuration ? Math.min(Math.max(audioDuration, 6), 30) : 10;
      const audioInput = (audioPath && fs.existsSync(audioPath))
        ? `-i "${audioPath}"`
        : '-f lavfi -i anullsrc=channel_layout=stereo:sample_rate=44100';
      const vf = `fade=t=out:st=${(totalDur - 0.5).toFixed(2)}:d=0.5`;
      const cmd = `ffmpeg -y -framerate 30 -loop 1 -t ${totalDur.toFixed(2)} -i "${framedImages[0]}" ${audioInput} -vf "${vf}" -c:v libx264 -preset medium -crf 16 -profile:v high -level 4.2 -r 30 -g 60 -keyint_min 30 -sc_threshold 0 -b:v 10M -maxrate 14M -bufsize 20M -pix_fmt yuv420p -colorspace bt709 -color_primaries bt709 -color_trc bt709 -color_range tv -movflags +faststart -c:a aac -b:a 256k -ar 44100 -shortest "${outputPath}"`;
      await execPromise(cmd);
      return outputPath;
    }

    let slideDuration = 3.5;
    if (audioDuration) {
      slideDuration = (audioDuration + (numImages - 1) * transitionDuration) / numImages;
      slideDuration = Math.max(2.4, Math.min(5.0, slideDuration));
    }

    const totalVideoDur = numImages * slideDuration - (numImages - 1) * transitionDuration;
    console.log(`[Reel] Tạo video chuyển cảnh mượt mà chuẩn 30fps (xfade ${transitionDuration}s, mỗi ảnh ${slideDuration.toFixed(2)}s, tổng ${totalVideoDur.toFixed(2)}s)...`);

    const inputs = framedImages.map(f => `-framerate 30 -loop 1 -t ${slideDuration.toFixed(2)} -i "${f}"`).join(' ');

    let filterGraph = '';
    let lastOut = '0:v';
    let currentOffset = slideDuration - transitionDuration;

    for (let i = 1; i < framedImages.length; i++) {
      const nextOut = i === framedImages.length - 1 ? 'vxfade' : `v${i}`;
      filterGraph += `[${lastOut}][${i}:v]xfade=transition=fade:duration=${transitionDuration.toFixed(2)}:offset=${currentOffset.toFixed(2)}[${nextOut}];`;
      lastOut = nextOut;
      currentOffset += (slideDuration - transitionDuration);
    }

    const fadeOutStart = Math.max(0, totalVideoDur - 0.6);
    filterGraph += `[${lastOut}]fade=t=out:st=${fadeOutStart.toFixed(2)}:d=0.6[vfinal]`;

    const audioInput = (audioPath && fs.existsSync(audioPath))
      ? `-i "${audioPath}"`
      : '-f lavfi -i anullsrc=channel_layout=stereo:sample_rate=44100';

    const encodeCmd = `ffmpeg -y ${inputs} ${audioInput} -filter_complex "${filterGraph}" -map "[vfinal]" -map ${framedImages.length}:a -c:v libx264 -preset medium -crf 16 -profile:v high -level 4.2 -r 30 -g 60 -keyint_min 30 -sc_threshold 0 -b:v 10M -maxrate 14M -bufsize 20M -pix_fmt yuv420p -colorspace bt709 -color_primaries bt709 -color_trc bt709 -color_range tv -movflags +faststart -c:a aac -b:a 256k -ar 44100 -shortest "${outputPath}"`;
    await execPromise(encodeCmd);

    console.log('[Reel] Hoàn tất tạo video chất lượng cao!');
    return outputPath;
  } finally {
    try {
      if (!frameCacheDir && fs.existsSync(tempDir)) {
        removeDownloadDirectory(tempDir);
      }
    } catch {}
  }
}

function extractUrl(input) {
  const match = (input || '').match(/https?:\/\/[^\s]+/);
  return match ? match[0] : null;
}

/**
 * Helper to translate text using free Google Translate API endpoint
 */
async function translateText(text, targetLang = 'vi') {
  text = normalizeCaptionText(text);
  if (!text) return '';
  try {
    const res = await fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${targetLang}&dt=t&q=${encodeURIComponent(text)}`, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return text;
    const data = await res.json();
    if (Array.isArray(data) && Array.isArray(data[0])) {
      return normalizeCaptionText(data[0].map(s => s[0] || '').join('')) || text;
    }
  } catch {}
  return text;
}

/**
 * Generate viral Instagram caption and targeted hashtags in Vietnamese, English or Bilingual
 */
async function generateCaptionAndHashtags(rawTitle, author, musicName = null, musicArtist = null, musicUrl = null, lang = 'en') {
  let cleanTitle = normalizeCaptionText(rawTitle).replace(/\r\n|\r|\n/g, ' ').trim();
  cleanTitle = cleanTitle.replace(/#[\w\u4e00-\u9fa5]+/g, '').trim();

  let titleLine = cleanTitle || (lang === 'en' ? 'Peaceful moments' : 'Khoảnh khắc bình yên');
  if (cleanTitle) {
    if (lang === 'vi') {
      const vi = await translateText(cleanTitle, 'vi');
      titleLine = vi || 'Khoảnh khắc bình yên';
    } else if (lang === 'en') {
      const en = await translateText(cleanTitle, 'en');
      titleLine = en || 'Peaceful moments';
    } else if (lang === 'both') {
      const vi = await translateText(cleanTitle, 'vi');
      const en = await translateText(cleanTitle, 'en');
      if (vi && en && vi !== en) {
        titleLine = `${vi}\n   "${en}"`;
      } else {
        titleLine = vi || en || 'Peaceful moments';
      }
    }
  }

  let caption = `${titleLine}\n\n`;

  let generalHashtags = [];
  if (lang === 'vi') {
    generalHashtags = [
      '#binhyen', '#tamtrang', '#thanhxuan', '#chill', '#xuhuong',
      '#aesthetic', '#vibes', '#mood', '#photography', '#photooftheday',
      '#explorepage', '#viral', '#reels', '#cuocsong', '#fyp'
    ];
  } else if (lang === 'en') {
    generalHashtags = [
      '#aesthetic', '#vibes', '#mood', '#photography', '#cinematic',
      '#instamood', '#dailyvibes', '#photooftheday', '#explorepage',
      '#viral', '#visuals', '#artofvisuals', '#reels', '#peaceful', '#fyp'
    ];
  } else if (lang === 'both') {
    generalHashtags = [
      '#binhyen', '#tamtrang', '#chill', '#xuhuong',
      '#aesthetic', '#vibes', '#mood', '#photography', '#cinematic',
      '#instamood', '#dailyvibes', '#photooftheday', '#explorepage',
      '#viral', '#reels', '#fyp'
    ];
  } else {
    // raw (Tiếng Trung)
    generalHashtags = [
      '#aesthetic', '#vibes', '#mood', '#photography', '#explorepage', '#viral'
    ];
  }

  const hashtags = generalHashtags.join(' ');
  const fullText = `${caption}${hashtags}`;

  // Tạo câu chữ tâm trạng tiếng Việt chuẩn (chỉ chữ thuần túy, không icon/emoji/gif) dành riêng cho video TikTok
  let moodQuoteVi = '';
  if (cleanTitle) {
    const vi = await translateText(cleanTitle, 'vi');
    moodQuoteVi = cleanPureText(vi || cleanTitle);
  }
  if (!moodQuoteVi || /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(moodQuoteVi)) {
    moodQuoteVi = 'Khoảnh khắc bình yên';
  }

  return {
    caption,
    hashtags,
    fullText,
    moodQuoteVi,
    moodQuote: moodQuoteVi
  };
}

function extractMedia(postData, html = '') {
  const photo = postData.photo || {};
  const images = [];
  let videoUrl = null;

  // 1. Detect video URLs from various Kuaishou photo fields
  if (photo.mainMvUrls && Array.isArray(photo.mainMvUrls) && photo.mainMvUrls.length > 0) {
    const item = photo.mainMvUrls[0];
    videoUrl = typeof item === 'string' ? item : (item?.url || null);
  } else if (typeof photo.mainMvUrls === 'string') {
    videoUrl = photo.mainMvUrls;
  }

  if (!videoUrl && photo.srcNoMark) {
    videoUrl = photo.srcNoMark;
  }

  if (!videoUrl && photo.videoUrl) {
    videoUrl = photo.videoUrl;
  }

  if (!videoUrl && photo.playUrl) {
    videoUrl = photo.playUrl;
  }

  if (!videoUrl && Array.isArray(photo.playUrls) && photo.playUrls.length > 0) {
    const item = photo.playUrls[0];
    videoUrl = typeof item === 'string' ? item : (item?.url || null);
  }

  if (!videoUrl && photo.photoUrl && (
    photo.photoType === 'VIDEO' ||
    photo.photoType === 'MV' ||
    photo.photoType === 'VERTICAL' ||
    photo.photoUrl.includes('.mp4') ||
    photo.photoUrl.includes('mov')
  )) {
    videoUrl = photo.photoUrl;
  }

  if (!videoUrl && photo.manifest) {
    try {
      const manifest = typeof photo.manifest === 'string' ? JSON.parse(photo.manifest) : photo.manifest;
      if (manifest?.adaptationSet) {
        for (const set of manifest.adaptationSet) {
          if (set.representation && set.representation.length > 0) {
            const rep = set.representation[0];
            if (rep.url) {
              videoUrl = rep.url;
              break;
            }
          }
        }
      }
    } catch {}
  }

  // Fallback: search in HTML for mp4 link
  if (!videoUrl && html) {
    const mp4Match = html.match(/https?:\/\/[a-zA-Z0-9_\-\.]+(?:yximgs\.com|kwimgs\.com|kwaicdn\.com|kuaishou\.com)[^"'\s<>\\]+\.mp4[^"'\s<>\\]*/i);
    if (mp4Match) {
      videoUrl = mp4Match[0];
    }
  }

  // 2. Multi-image atlas
  const atlas = photo.atlas || (photo.ext_params && photo.ext_params.atlas);
  const isAtlas = Boolean(atlas && Array.isArray(atlas.list) && atlas.list.length > 0);

  if (isAtlas) {
    const cdnList = (atlas.cdnList && atlas.cdnList.length > 0)
      ? atlas.cdnList.map(c => (typeof c === 'string' ? c : c.cdn || 'p2.a.yximgs.com'))
      : ['p2.a.yximgs.com', 'p23.a.yximgs.com'];

    const defaultCdn = cdnList[0] || 'p2.a.yximgs.com';

    for (let i = 0; i < atlas.list.length; i++) {
      let item = atlas.list[i];
      if (typeof item === 'string') {
        if (item.startsWith('http')) {
          images.push(item);
        } else {
          const path = item.startsWith('/') ? item : `/${item}`;
          images.push(`https://${defaultCdn}${path}`);
        }
      } else if (item && item.url) {
        images.push(item.url);
      }
    }
  }

  // 3. Single image / cover
  let coverUrl = null;
  if (photo.coverUrls && photo.coverUrls.length > 0) {
    const best = photo.coverUrls[0];
    coverUrl = typeof best === 'string' ? best : best?.url;
  } else if (photo.coverUrl) {
    coverUrl = typeof photo.coverUrl === 'string' ? photo.coverUrl : photo.coverUrl?.url;
  }

  if (!isAtlas && !videoUrl && images.length === 0) {
    if (coverUrl) images.push(coverUrl);
    if (images.length === 0 && photo.ext_params?.single?.imageUrl) {
      images.push(photo.ext_params.single.imageUrl);
    }
  }

  // If native video, also add coverUrl into images so thumbnail is present
  if (videoUrl && !isAtlas && coverUrl && images.length === 0) {
    images.push(coverUrl);
  }

  const isVideo = Boolean(videoUrl && (!isAtlas || photo.photoType === 'VIDEO' || photo.photoType === 'MV' || photo.photoType === 'VERTICAL'));

  let musicUrl = null;
  let musicName = null;
  let musicArtist = null;

  // 1. Check soundTrack (standard for Kuaishou photos & videos)
  if (photo.soundTrack) {
    musicName = photo.soundTrack.name || null;
    musicArtist = photo.soundTrack.artist || null;
    if (Array.isArray(photo.soundTrack.audioUrls) && photo.soundTrack.audioUrls.length > 0) {
      const first = photo.soundTrack.audioUrls[0];
      musicUrl = typeof first === 'string' ? first : (first?.url || null);
    } else if (photo.soundTrack.audioUrl) {
      musicUrl = photo.soundTrack.audioUrl;
    }
  }

  // 2. Check photo.music
  if (!musicUrl && photo.music) {
    musicName = musicName || photo.music.name || null;
    musicArtist = musicArtist || photo.music.artist || null;
    if (Array.isArray(photo.music.audioUrls) && photo.music.audioUrls.length > 0) {
      const first = photo.music.audioUrls[0];
      musicUrl = typeof first === 'string' ? first : (first?.url || null);
    } else {
      musicUrl = photo.music.url || photo.music.playUrl || null;
    }
  }

  // 3. Check single / atlas ext_params
  if (!musicUrl && photo.ext_params?.single?.music) {
    const musicCdn = photo.ext_params.single.musicCdnList?.[0]?.cdn || 'tymov2.a.kwimgs.com';
    const musicPath = photo.ext_params.single.music;
    musicUrl = `https://${musicCdn}${musicPath.startsWith('/') ? musicPath : '/' + musicPath}`;
    musicName = musicName || 'BGM';
  }

  if (!musicUrl && (photo.atlas?.music || photo.ext_params?.atlas?.music)) {
    const musicPath = photo.atlas?.music || photo.ext_params?.atlas?.music;
    const cdn = photo.atlas?.cdnList?.[0] || 'p2.a.yximgs.com';
    musicUrl = `https://${cdn}${musicPath.startsWith('/') ? musicPath : '/' + musicPath}`;
  }

  // 4. Fallback search in HTML
  if (!musicUrl && html) {
    const audioMatch = html.match(/https?:\/\/[a-zA-Z0-9_\-\.]+(?:yximgs\.com|kwimgs\.com|kwaicdn\.com)[^"'<>\s]+\.(?:m4a|mp3|aac)[^"'<>\s]*/i);
    if (audioMatch) {
      musicUrl = audioMatch[0];
    }
  }

  const avatar = photo.headUrl || photo.headUrls?.[0]?.url || null;

  return {
    title: photo.caption || `kuaishou_${photo.photoId || Date.now()}`,
    author: photo.userName || 'unknown_author',
    authorAvatar: avatar,
    photoId: photo.photoId || '',
    images,
    isVideo,
    videoUrl: isVideo ? videoUrl : null,
    coverUrl,
    musicUrl,
    musicName,
    musicArtist
  };
}

function extractImages(postData, html = '') {
  return extractMedia(postData, html);
}

async function downloadFile(url, destPath) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      'Referer': 'https://www.kuaishou.com/'
    }
  });

  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const arrayBuffer = await res.arrayBuffer();
  fs.writeFileSync(destPath, Buffer.from(arrayBuffer));
}

async function downloadImageAsJpg(url, destJpgPath) {
  if (fs.existsSync(destJpgPath)) return destJpgPath;

  // 1. Thử tải trực tiếp file JPG gốc từ CDN Kuaishou (tránh bị nén WebP 2 lần)
  if (url.includes('.webp')) {
    const directJpgUrl = url.replace(/\.webp(\?.*)?$/i, '.jpg$1');
    try {
      const jpgRes = await fetch(directJpgUrl, {
        headers: {
          'User-Agent': USER_AGENT,
          'Referer': 'https://www.kuaishou.com/'
        }
      });
      if (jpgRes.ok && (jpgRes.headers.get('content-type') || '').includes('image')) {
        const ab = await jpgRes.arrayBuffer();
        if (ab.byteLength > 1000) {
          fs.writeFileSync(destJpgPath, Buffer.from(ab));
          return destJpgPath;
        }
      }
    } catch {}
  }

  // 2. Tải từ URL gốc
  const res = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      'Referer': 'https://www.kuaishou.com/'
    }
  });

  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const arrayBuffer = await res.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  // Check if buffer is WEBP (starts with 'RIFF' and bytes 8..11 are 'WEBP')
  const isWebp = buffer.length > 12 && buffer.slice(0, 4).toString('ascii') === 'RIFF' && buffer.slice(8, 12).toString('ascii') === 'WEBP';

  if (isWebp) {
    const tempWebp = destJpgPath + '.temp.webp';
    fs.writeFileSync(tempWebp, buffer);
    try {
      await execPromise(`ffmpeg -y -i "${tempWebp}" -qscale:v 1 -qmin 1 -pix_fmt yuvj420p -color_range pc -update 1 -frames:v 1 "${destJpgPath}"`);
    } finally {
      try { fs.unlinkSync(tempWebp); } catch {}
    }
  } else {
    fs.writeFileSync(destJpgPath, buffer);
  }

  return destJpgPath;
}

const server = http.createServer(async (req, res) => {
  const reqUrl = new URL(req.url, `http://${req.headers.host}`);

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // 1. Serve UI
  if (req.method === 'GET' && (reqUrl.pathname === '/' || reqUrl.pathname === '/index.html')) {
    const filePath = path.join(__dirname, 'public', 'index.html');
    if (fs.existsSync(filePath)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      fs.createReadStream(filePath).pipe(res);
      return;
    }
  }

  // 2. API: Extract post data
  if (req.method === 'POST' && reqUrl.pathname === '/api/extract') {
    try {
      const { url, lang = 'en' } = await readJsonBody(req);
      const cleanUrl = extractUrl(url);
      if (!cleanUrl) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: false, error: 'Không tìm thấy link Kuaishou hợp lệ' }));
        return;
      }

      const { finalUrl, html, initState } = await getPostPage(cleanUrl);
      if (!initState) {
        res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: false, error: 'Không tìm thấy dữ liệu bài đăng (có thể link bị khóa hoặc hết hạn)' }));
        return;
      }

      const postContainer = findPhotoData(initState);
      if (!postContainer || !postContainer.photo) {
        res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: false, error: 'Bài viết không có thông tin hình ảnh' }));
        return;
      }

      const data = extractMedia(postContainer, html);
      const generated = await generateCaptionAndHashtags(data.title, data.author, data.musicName, data.musicArtist, data.musicUrl, lang);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ 
        success: true, 
        ...data, 
        generatedCaption: generated.fullText,
        hashtags: generated.hashtags,
        moodQuote: generated.moodQuote,
        moodQuoteVi: generated.moodQuoteVi,
        originalUrl: cleanUrl, 
        finalUrl 
      }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
    return;
  }

  // 2.5. API: Regenerate Caption with specific language
  if (req.method === 'POST' && reqUrl.pathname === '/api/generate-caption') {
    try {
      const { title, author, musicName, musicArtist, musicUrl, lang = 'vi' } = await readJsonBody(req);
      const generated = await generateCaptionAndHashtags(title, author, musicName, musicArtist, musicUrl, lang);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: true, ...generated }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
    return;
  }

  // 3. API: Download media to local machine
  if (req.method === 'POST' && reqUrl.pathname === '/api/download-local') {
    try {
      const { post } = await readJsonBody(req);
      if (!post) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: false, error: 'Không có dữ liệu bài viết để tải' }));
        return;
      }

      const folderName = sanitizeFileName(`${post.author}_${post.photoId || Date.now()}`).slice(0, 50);
      const outputDir = path.join(__dirname, 'downloads', folderName);
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      // Save info
      fs.writeFileSync(
        path.join(outputDir, 'info.txt'),
        `Tác giả: ${post.author}\nPhoto ID: ${post.photoId}\nLoại: ${post.isVideo ? 'Video gốc' : 'Bộ ảnh'}\nTiêu đề:\n${post.title}\nLink: ${post.originalUrl || ''}\n`
      );

      if (post.isVideo && post.videoUrl) {
        await downloadFile(post.videoUrl, path.join(outputDir, 'video.mp4'));
        if (post.coverUrl) {
          await downloadImageAsJpg(post.coverUrl, path.join(outputDir, 'cover.jpg')).catch(() => {});
        }
      } else if (Array.isArray(post.images) && post.images.length > 0) {
        for (let i = 0; i < post.images.length; i++) {
          const imgUrl = post.images[i];
          const fileName = `image_${String(i + 1).padStart(2, '0')}.jpg`;
          await downloadImageAsJpg(imgUrl, path.join(outputDir, fileName));
        }
      }

      if (post.musicUrl) {
        try {
          await downloadFile(post.musicUrl, path.join(outputDir, 'audio.m4a'));
        } catch {}
      }

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ 
        success: true, 
        isVideo: Boolean(post.isVideo),
        count: post.isVideo ? 1 : (post.images ? post.images.length : 0), 
        path: outputDir 
      }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
    return;
  }

  // 4. API: Open folder in Windows File Explorer
  if (req.method === 'POST' && reqUrl.pathname === '/api/open-folder') {
    try {
      const { folder } = await readJsonBody(req);
      if (folder && fs.existsSync(folder)) {
        exec(`explorer.exe "${folder}"`);
      }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: true }));
    } catch {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false }));
    }
    return;
  }

  // 5. API: Media Proxy (Bypass referrer check for preview, video streaming and downloads)
  if (req.method === 'GET' && reqUrl.pathname === '/api/proxy') {
    const targetUrl = reqUrl.searchParams.get('url');
    const isDownload = reqUrl.searchParams.get('download') === '1';
    const filename = reqUrl.searchParams.get('filename') || 'media';

    if (!targetUrl) {
      res.writeHead(400);
      res.end('Missing url');
      return;
    }

    try {
      const headers = {
        'User-Agent': USER_AGENT,
        'Referer': 'https://www.kuaishou.com/'
      };
      if (req.headers.range) {
        headers['Range'] = req.headers.range;
      }

      const upstream = await fetch(targetUrl, { headers });
      const respHeaders = {
        'Content-Type': upstream.headers.get('content-type') || 'application/octet-stream',
        'Accept-Ranges': 'bytes'
      };
      if (upstream.headers.get('content-length')) {
        respHeaders['Content-Length'] = upstream.headers.get('content-length');
      }
      if (upstream.headers.get('content-range')) {
        respHeaders['Content-Range'] = upstream.headers.get('content-range');
      }
      if (isDownload) {
        respHeaders['Content-Disposition'] = `attachment; filename="${filename}"`;
      }

      res.writeHead(upstream.status, respHeaders);
      if (upstream.body) {
        Readable.fromWeb(upstream.body).pipe(res);
      } else {
        res.end();
      }
    } catch (err) {
      if (!res.headersSent) {
        res.writeHead(502);
        res.end('Failed to proxy media');
      } else {
        res.end();
      }
    }
    return;
  }

  // 6. API: Check Instagram Login Status
  if (req.method === 'GET' && reqUrl.pathname === '/api/ig/status') {
    try {
      const loggedIn = await checkLoginStatus();
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: true, loggedIn }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, error: err.message, loggedIn: false }));
    }
    return;
  }

  // 7. API: Trigger Interactive Login
  if (req.method === 'POST' && reqUrl.pathname === '/api/ig/login') {
    try {
      const batPath = path.join(__dirname, 'login_instagram.bat');
      exec(`start "" "${batPath}"`);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: true, message: 'Đang mở cửa sổ đăng nhập Instagram' }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
    return;
  }

  // 8. API: Post to Instagram / Facebook
  if (req.method === 'POST' && (reqUrl.pathname === '/api/ig/post' || reqUrl.pathname === '/api/fb/post')) {
    try {
      const { post, customCaption, shareToFacebook } = await readJsonBody(req);
      const isFbOnly = reqUrl.pathname === '/api/fb/post';
      const doShareFB = isFbOnly || Boolean(shareToFacebook);

      if (!post || (!post.isVideo && (!Array.isArray(post.images) || post.images.length === 0))) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: false, error: 'Không có dữ liệu bài viết để đăng' }));
        return;
      }

      // Download files locally first to ensure paths
      const folderName = sanitizeFileName(`${post.author}_${post.photoId || Date.now()}`).slice(0, 50);
      const outputDir = path.join(__dirname, 'downloads', folderName);
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      let uploadPaths = [];

      if (post.isVideo) {
        const videoPath = path.join(outputDir, 'video.mp4');
        if (!fs.existsSync(videoPath) && post.videoUrl) {
          console.log('[Kuaishou] Đang tải video gốc (không logo watermark)...');
          await downloadFile(post.videoUrl, videoPath);
        }
        uploadPaths = [videoPath];
      } else {
        const localImagePaths = [];
        for (let i = 0; i < (post.images || []).length; i++) {
          const imgUrl = post.images[i];
          const fileName = `image_${String(i + 1).padStart(2, '0')}.jpg`;
          const filePath = path.join(outputDir, fileName);
          await downloadImageAsJpg(imgUrl, filePath);
          localImagePaths.push(filePath);
        }

        uploadPaths = localImagePaths;
        const audioPath = path.join(outputDir, 'audio.m4a');
        if (post.asReel !== false && localImagePaths.length > 0) {
          const reelPath = path.join(outputDir, 'reel.mp4');
          try {
            console.log('[Instagram] Đang tạo video Reel 9:16 sạch chữ cho Instagram/Facebook...');
            // Instagram luôn sử dụng video gốc sạch, tuyệt đối không chèn chữ
            await createCinematicReel(localImagePaths, fs.existsSync(audioPath) ? audioPath : null, reelPath, '');
            uploadPaths = [reelPath];
          } catch (e) {
            console.error('Không thể tạo reel:', e.message);
          }
        }
      }

      // Call Playwright automation to post
      const captionText = customCaption !== undefined ? customCaption : post.title;
      await postToInstagram({
        imagePaths: uploadPaths,
        caption: captionText,
        headless: false,
        shareToFacebook: doShareFB
      });

      const successMsg = doShareFB 
        ? 'Đã đăng bài thành công lên Instagram & chia sẻ sang Facebook!' 
        : 'Đã đăng bài thành công lên Instagram!';

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: true, message: successMsg }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
    return;
  }

  // 8.1. API: Check TikTok Login Status
  if (req.method === 'GET' && reqUrl.pathname === '/api/tiktok/status') {
    try {
      const loggedIn = await checkTikTokStatus();
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: true, loggedIn }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, error: err.message, loggedIn: false }));
    }
    return;
  }

  // 8.2. API: Trigger Interactive TikTok Login
  if (req.method === 'POST' && reqUrl.pathname === '/api/tiktok/login') {
    try {
      const batPath = path.join(__dirname, 'login_tiktok.bat');
      exec(`start "" "${batPath}"`);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: true, message: 'Đang mở cửa sổ đăng nhập TikTok' }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
    return;
  }

  // 8.3. API: Post to TikTok
  if (req.method === 'POST' && reqUrl.pathname === '/api/tiktok/post') {
    try {
      const { post, customCaption } = await readJsonBody(req);
      if (!post) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: false, error: 'Không có dữ liệu bài viết để đăng TikTok' }));
        return;
      }

      const folderName = sanitizeFileName(`${post.author}_${post.photoId || Date.now()}`).slice(0, 50);
      const outputDir = path.join(__dirname, 'downloads', folderName);
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      let targetVideo = null;

      if (post.isVideo) {
        const videoPath = path.join(outputDir, 'video.mp4');
        if (!fs.existsSync(videoPath) && post.videoUrl) {
          console.log('[TikTok] Đang tải video gốc Kuaishou...');
          await downloadFile(post.videoUrl, videoPath);
        }
        if (fs.existsSync(videoPath)) {
          targetVideo = videoPath;
        }
      } else {
        const tiktokReelPath = path.join(outputDir, 'tiktok_reel.mp4');
        const jpgs = fs.readdirSync(outputDir).filter(f => f.endsWith('.jpg') && !f.includes('cover')).map(f => path.join(outputDir, f));
        if (jpgs.length > 0) {
          const audioPath = path.join(outputDir, 'audio.m4a');
          const quoteText = (post.enableMoodQuote !== false) ? cleanPureText(post.moodQuoteVi || post.moodQuote || '') : '';
          console.log(`[TikTok] Đang tạo video TikTok 9:16 ${quoteText ? 'với chữ tâm trạng tiếng Việt: "' + quoteText + '"' : 'sạch chữ'}...`);
          await createCinematicReel(jpgs, fs.existsSync(audioPath) ? audioPath : null, tiktokReelPath, quoteText);
          targetVideo = tiktokReelPath;
        } else {
          const reelPath = path.join(outputDir, 'reel.mp4');
          if (fs.existsSync(reelPath)) {
            targetVideo = reelPath;
          }
        }
      }

      if (!targetVideo) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: false, error: 'Chưa có file video nào được tạo để đăng lên TikTok' }));
        return;
      }

      const captionText = customCaption !== undefined ? customCaption : post.title;
      await postToTikTok({
        videoPath: targetVideo,
        caption: captionText,
        headless: false
      });

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: true, message: 'Đã đăng video thành công lên TikTok!' }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
    return;
  }

  // 9. API: 1-Click Run Pipeline (Tải nội dung + Tự động tạo Caption & Hashtag + Tự động đăng IG/TikTok/Facebook)
  if (req.method === 'GET' && reqUrl.pathname === '/api/progress') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ message: pipelineProgress.get(reqUrl.searchParams.get('jobId')) || '' }));
    return;
  }

  if (reqUrl.pathname === '/api/sheet-queue') {
    try {
      let result;
      if (req.method === 'GET') result = sheetQueue.snapshot();
      else if (req.method === 'POST') result = sheetQueue.configure(await readJsonBody(req));
      else { res.writeHead(405); res.end(); return; }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ ...result, sheetUrl: SHEET_URL }));
    } catch (error) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: error.message }));
    }
    return;
  }

  if (req.method === 'POST' && reqUrl.pathname === '/api/run-pipeline') {
    let jobId = null;
    try {
      const { url, autoPostIG, autoPostTikTok, autoPostFB, asReel, customCaption, captionLang = 'en', moodQuote, enableMoodQuote = true, jobId: requestJobId } = await readJsonBody(req);
      jobId = requestJobId;
      setPipelineProgress(jobId, 'Đang đọc nội dung Kuaishou…');
      const cleanUrl = extractUrl(url);
      if (!cleanUrl) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: false, error: 'Không tìm thấy link Kuaishou hợp lệ' }));
        return;
      }

      // Step 1: Extract post
      const { finalUrl, html, initState } = await getPostPage(cleanUrl);
      if (!initState) {
        res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: false, error: 'Không tìm thấy dữ liệu bài đăng' }));
        return;
      }

      const postContainer = findPhotoData(initState);
      if (!postContainer || !postContainer.photo) {
        res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: false, error: 'Bài viết không có nội dung' }));
        return;
      }

      const post = extractMedia(postContainer, html);
      setPipelineProgress(jobId, 'Đang chuẩn bị caption và hashtag…');
      const generated = await generateCaptionAndHashtags(post.title, post.author, post.musicName, post.musicArtist, post.musicUrl, captionLang);
      const finalCaption = (customCaption !== undefined && customCaption.trim() !== '') ? customCaption : generated.fullText;
      const finalMoodQuoteVi = enableMoodQuote !== false 
        ? (moodQuote !== undefined && moodQuote.trim() !== '' ? cleanPureText(moodQuote) : (generated.moodQuoteVi || generated.moodQuote || '')) 
        : '';

      // Step 2: Download media locally
      setPipelineProgress(jobId, 'Đang tải ảnh và nhạc…');
      const folderName = sanitizeFileName(`${post.author}_${post.photoId || Date.now()}`).slice(0, 50);
      const outputDir = path.join(__dirname, 'downloads', folderName);
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      fs.writeFileSync(
        path.join(outputDir, 'info.txt'),
        `Tác giả: ${post.author}\nPhoto ID: ${post.photoId}\nLoại: ${post.isVideo ? 'Video gốc' : 'Bộ ảnh'}\nTiêu đề:\n${post.title}\nQuote: ${finalMoodQuoteVi}\nCaption đã tạo:\n${finalCaption}\nLink: ${cleanUrl}\n`
      );

      let uploadPaths = [];
      let targetVideo = null;

      if (post.isVideo && post.videoUrl) {
        const videoPath = path.join(outputDir, 'video.mp4');
        console.log('[Kuaishou] Đang tải video gốc (không logo watermark)...');
        await downloadFile(post.videoUrl, videoPath);
        uploadPaths = [videoPath];
        targetVideo = videoPath;

        if (post.coverUrl) {
          await downloadImageAsJpg(post.coverUrl, path.join(outputDir, 'cover.jpg')).catch(() => {});
        }
      } else {
        const localImagePaths = [];
        for (let i = 0; i < (post.images || []).length; i++) {
          const imgUrl = post.images[i];
          const fileName = `image_${String(i + 1).padStart(2, '0')}.jpg`;
          const filePath = path.join(outputDir, fileName);
          await downloadImageAsJpg(imgUrl, filePath);
          localImagePaths.push(filePath);
        }

        const audioPath = path.join(outputDir, 'audio.m4a');
        if (post.musicUrl) {
          try {
            await downloadFile(post.musicUrl, audioPath);
          } catch (e) {
            console.error('Không thể tải audio:', e.message);
          }
        }

        uploadPaths = localImagePaths;
        const validAudio = fs.existsSync(audioPath) ? audioPath : null;
        const reelPath = path.join(outputDir, 'reel.mp4');
        const tiktokReelPath = path.join(outputDir, 'tiktok_reel.mp4');
        const frameCacheDir = path.join(outputDir, `temp_frames_${Date.now()}`);
        const shouldRunIG = Boolean(autoPostIG || autoPostFB);
        const shouldCreateCleanReel = asReel !== false && (shouldRunIG || !autoPostTikTok);

        try {
          if (localImagePaths.length > 0) {
            // Instagram/Facebook use the clean version; skip it for TikTok-only runs.
            if (shouldCreateCleanReel) {
              try {
                setPipelineProgress(jobId, 'Đang ghép Reel cho Instagram và Facebook…');
                console.log('[Instagram] Đang tạo video Reel 9:16 sạch chữ cho Instagram/Facebook...');
                await createCinematicReel(localImagePaths, validAudio, reelPath, '', frameCacheDir);
                uploadPaths = [reelPath];
              } catch (e) {
                console.error('Không thể tạo Reel Instagram:', e.message);
              }
            }

            // TikTok keeps its own caption, reusing prepared frames when possible.
            if (autoPostTikTok) {
              try {
                setPipelineProgress(jobId, 'Đang ghép video có caption cho TikTok…');
                console.log(`[TikTok] Đang tạo video TikTok 9:16 ${finalMoodQuoteVi ? 'với chữ tâm trạng tiếng Việt: "' + finalMoodQuoteVi + '"' : 'sạch chữ'}...`);
                await createCinematicReel(localImagePaths, validAudio, tiktokReelPath, finalMoodQuoteVi, frameCacheDir);
                targetVideo = tiktokReelPath;
              } catch (e) {
                console.error('Không thể tạo Video TikTok:', e.message);
                if (fs.existsSync(reelPath)) targetVideo = reelPath;
              }
            }
          }
        } finally {
          if (fs.existsSync(frameCacheDir)) removeDownloadDirectory(frameCacheDir);
        }
      }

      // Step 3: Auto Post to IG / Facebook if enabled
      let igResult = null;
      const shouldRunIG = Boolean(autoPostIG || autoPostFB);
      if (shouldRunIG) {
        setPipelineProgress(jobId, 'Đang đăng lên Instagram và Facebook…');
        console.log(`[Instagram] Bắt đầu đăng Instagram (Chia sẻ Facebook: ${autoPostFB ? 'BẬT' : 'TẮT'})...`);
        igResult = await postToInstagram({
          imagePaths: uploadPaths,
          caption: finalCaption,
          headless: false,
          shareToFacebook: Boolean(autoPostFB)
        });
      }

      // Step 4: Auto Post to TikTok if enabled
      let tiktokResult = null;
      if (autoPostTikTok && targetVideo) {
        setPipelineProgress(jobId, 'Đang đăng lên TikTok…');
        console.log('[TikTok] Bắt đầu đăng TikTok...');
        tiktokResult = await postToTikTok({
          videoPath: targetVideo,
          caption: finalCaption,
          headless: false
        });
      }

      if ((shouldRunIG && !igResult?.success) || (autoPostTikTok && !tiktokResult?.success)) {
        const errors = [];
        if (shouldRunIG && !igResult?.success) errors.push(`Instagram/Facebook: ${igResult?.message || 'không đăng được'}`);
        if (autoPostTikTok && !tiktokResult?.success) errors.push(`TikTok: ${tiktokResult?.message || 'không đăng được'}`);
        throw new Error(errors.join('; '));
      }

      // Keep files for download-only runs and failures; completed posts do not need local copies.
      let cleanedUp = false;
      if ((shouldRunIG || autoPostTikTok) && (!shouldRunIG || igResult?.success) && (!autoPostTikTok || tiktokResult?.success)) {
        try {
          removeDownloadDirectory(outputDir);
          cleanedUp = true;
          console.log(`[Kuaishou] Đã dọn file tạm sau khi đăng: ${outputDir}`);
        } catch (cleanupError) {
          console.warn(`[Kuaishou] Không dọn được file tạm: ${cleanupError.message}`);
        }
      }

      setPipelineProgress(jobId, 'Hoàn tất.');
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        success: true,
        post: { ...post, originalUrl: cleanUrl, finalUrl, moodQuote: finalMoodQuoteVi, moodQuoteVi: finalMoodQuoteVi },
        caption: finalCaption,
        hashtags: generated.hashtags,
        moodQuote: finalMoodQuoteVi,
        moodQuoteVi: finalMoodQuoteVi,
        downloadPath: cleanedUp ? null : outputDir,
        cleanedUp,
        isVideo: post.isVideo,
        count: post.isVideo ? 1 : post.images.length,
        igPosted: Boolean(autoPostIG && igResult?.success),
        fbPosted: Boolean(autoPostFB && igResult?.success),
        igMessage: igResult?.message || null,
        tiktokPosted: Boolean(autoPostTikTok && tiktokResult?.success),
        tiktokMessage: tiktokResult?.message || null
      }));
    } catch (err) {
      setPipelineProgress(jobId, `Lỗi: ${err.message}`);
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, error: err.message }));
    } finally {
      if (typeof jobId === 'string') {
        const completedJobId = jobId;
        setTimeout(() => pipelineProgress.delete(completedJobId), 60_000).unref();
      }
    }
    return;
  }

  if (!res.headersSent) {
    res.writeHead(404);
    res.end('Not Found');
  }
});

server.listen(PORT, () => {
  sheetQueue.start();
  const url = `http://localhost:${PORT}`;
  console.log(`\n==================================================`);
  console.log(`Kuaishou Downloader UI đang chạy tại:`);
  console.log(`${url}`);
  console.log(`==================================================\n`);

  // Auto open browser on Windows
  exec(`start ${url}`);
});

process.on('uncaughtException', (err) => {
  console.error('Unhandled Exception:', err.message);
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
});

