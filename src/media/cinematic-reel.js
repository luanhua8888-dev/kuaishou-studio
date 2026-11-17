import fs from 'fs';
import path from 'path';
import util from 'util';
import { exec } from 'child_process';
import { renderWithCache } from './render-cache.js';
import { removeDownloadDirectory } from './workspace.js';
import { cleanPureText } from '../content/caption.js';
import { pickTransitions } from './transitions.js';
import { analyzeAudio } from './audio-analysis.js';
import { youtubeSlideshowTiming, youtubeOpeningTiming, youtubeSceneTransition } from './youtube-short.js';

const execPromise = util.promisify(exec);

// Start the source music at its strongest part, so the first seconds already carry the hook.
async function musicStart(audioPath, seconds) {
  if (!audioPath || !fs.existsSync(audioPath)) return 0;
  try { return (await analyzeAudio(audioPath, seconds)).start; } catch { return 0; }
}

/**
 * Format aesthetic mood quote text for TikTok video overlay (pure text only)
 */
export function formatMoodQuote(rawText, maxLineLen = 39, maxLines = 3) {
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

export function roundedCaptionFilter(quoteText, fontPath, textPath) {
  const lines = quoteText.split('\n');
  const longest = Math.max(...lines.map(line => Array.from(line).length));
  const width = Math.min(1000, Math.max(140, Math.ceil(longest * 16 + 40)));
  const height = lines.length * 44 + 36;
  const x = Math.round((1080 - width) / 2);
  const y = Math.round((1920 - height) / 2 + 400);
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
  return `,${shadow},${rim},${panel},drawtext=fontfile='${fontPath}':textfile='${textPath}':fontcolor=white:expansion=none:fontsize=34:line_spacing=16:text_align=center:x=(w-text_w)/2:y=(h-text_h)/2+400:shadowcolor=black@0.45:shadowx=1:shadowy=2`;
}

export function getImageDimensions(filePath) {
  try {
    const buf = fs.readFileSync(filePath);
    if (buf[0] === 0xFF && buf[1] === 0xD8) {
      let offset = 2;
      while (offset < buf.length) {
        if (buf[offset] !== 0xFF) break;
        const marker = buf[offset + 1];
        if (marker === 0xC0 || marker === 0xC2) {
          const h = buf.readUInt16BE(offset + 5);
          const w = buf.readUInt16BE(offset + 7);
          return { width: w, height: h };
        }
        const len = buf.readUInt16BE(offset + 2);
        offset += 2 + len;
      }
    } else if (buf.slice(0, 8).toString('hex') === '89504e470d0a1a0a') {
      return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    }
  } catch {}
  return null;
}

/**
 * Merge images and audio into a cinematic 9:16 vertical 1080x1920 video at 30 fps
 * with ambient blurred backdrop, full original image framing, silky-smooth crossfade transitions,
 * and optional pure text mood quote overlay (for TikTok only)
 */
export async function createCinematicReel(imageInput, audioPath, outputPath, moodQuote = '', frameCacheDir = null, youtubeEdit = false) {
  const validImages = (Array.isArray(imageInput) ? imageInput : [imageInput]).filter(p => fs.existsSync(p));
  const images = youtubeEdit ? validImages : validImages.slice(0, 10);
  return renderWithCache(outputPath, [...images, audioPath && fs.existsSync(audioPath) ? audioPath : null],
    { moodQuote, youtubeEdit, youtubeTiming: youtubeEdit ? youtubeSlideshowTiming(images.length) : null,
      opening: youtubeEdit ? youtubeOpeningTiming(images.length) : null,
      transitions: youtubeEdit ? images.map((_, i) => youtubeSceneTransition(i)) : null,
      renderer: renderCinematicReel.toString() },
    () => renderCinematicReel(images, audioPath, outputPath, moodQuote, frameCacheDir, youtubeEdit));
}

export async function renderCinematicReel(imageInput, audioPath, outputPath, moodQuote = '', frameCacheDir = null, youtubeEdit = false) {
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
    const selectedImages = youtubeEdit ? validImages : validImages.slice(0, 10);
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
      const dims = getImageDimensions(src);
      if (dims && dims.width && dims.height) {
        isFull9x16 = (dims.height / dims.width) >= 1.70;
      } else {
        try {
          const { stdout: dimsOutput } = await execPromise(`ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 "${src}"`);
          const [w, h] = dimsOutput.trim().split(',').map(Number);
          if (w && h) isFull9x16 = (h / w) >= 1.70;
        } catch {}
      }

      let vf;
      if (isFull9x16) {
        // Ảnh dọc chuẩn 9:16: lấp đầy toàn màn hình không viền mờ, sắc nét tối đa
        vf = `scale=1080:1920:force_original_aspect_ratio=increase:flags=lanczos,crop=1080:1920,unsharp=lx=5:ly=5:la=0.4:cx=5:cy=5:ca=0.0${quoteFilter}`;
      } else {
        // Ảnh 4:5, 3:4, vuông 1:1 hoặc ngang: giữ nguyên 100% độ nét và bố cục gốc (không zoom vỡ hạt, không cắt góc)
        // Nền mờ đồng sắc phía sau + ảnh chính nguyên bản sắc nét ở trung tâm
        vf = `split[bg][fg];[bg]scale=1080:1920:force_original_aspect_ratio=increase:flags=lanczos,crop=1080:1920,boxblur=25:5,eq=brightness=-0.12[bg_blur];[fg]scale=1080:1920:force_original_aspect_ratio=decrease:flags=lanczos[fg_fit];[bg_blur][fg_fit]overlay=(W-w)/2:(H-h)/2,unsharp=lx=5:ly=5:la=0.4:cx=5:cy=5:ca=0.0${quoteFilter}`;
      }

      await execPromise(`ffmpeg -y -threads 0 -i "${src}" -vf "${vf}" -frames:v 1 "${framedPath}"`);
      framedImages[i] = framedPath;
    };
    const BATCH_SIZE = 5;
    for (let i = 0; i < numImages; i += BATCH_SIZE) {
      const batch = [];
      for (let j = i; j < Math.min(i + BATCH_SIZE, numImages); j++) batch.push(j);
      await Promise.all(batch.map(prepareFrame));
    }

    // Step 2: Build video from framed images
    const youtubeTiming = youtubeEdit ? youtubeSlideshowTiming(numImages) : null;
    const transitionDuration = youtubeTiming?.transitionDuration ?? 0.65;

    if (numImages === 1) {
      console.log('[Reel] Tạo video từ 1 hình ảnh chất lượng cao chuẩn HD 30fps...');
      const totalDur = youtubeTiming?.totalDuration ?? (audioDuration ? Math.min(Math.max(audioDuration, 6), 30) : 10);
      const start = await musicStart(audioPath, totalDur);
      const audioInput = (audioPath && fs.existsSync(audioPath))
        ? `${start > 0 ? `-ss ${start} ` : ''}-i "${audioPath}"`
        : '-f lavfi -i anullsrc=channel_layout=stereo:sample_rate=44100';
      const cmd = `ffmpeg -y -threads 0 -framerate 30 -loop 1 -t ${totalDur.toFixed(2)} -i "${framedImages[0]}" ${audioInput} ${youtubeEdit ? `-af apad -t ${totalDur.toFixed(2)}` : ''} -c:v libx264 -preset veryfast -crf 18 -profile:v high -level 4.2 -r 30 -g 60 -keyint_min 30 -sc_threshold 0 -b:v 10M -maxrate 14M -bufsize 20M -pix_fmt yuv420p -colorspace bt709 -color_primaries bt709 -color_trc bt709 -color_range tv -movflags +faststart -c:a aac -b:a 256k -ar 44100 -shortest "${outputPath}"`;
      await execPromise(cmd);
      return outputPath;
    }

    let slideDuration = 3.15;
    if (audioDuration) {
      slideDuration = (audioDuration + (numImages - 1) * transitionDuration) / numImages;
      slideDuration = Math.max(2.4, Math.min(3.2, slideDuration)) * 0.9;
    }

    if (youtubeTiming) slideDuration = youtubeTiming.slideDuration;
    const opening = youtubeEdit ? youtubeOpeningTiming(numImages) : null;
    const totalVideoDur = numImages * slideDuration - (numImages - 1) * transitionDuration + (opening?.totalDuration || 0);
    console.log(`[Reel] Tạo video chuyển cảnh mượt mà chuẩn 30fps (xfade ${transitionDuration}s, mỗi ảnh ${slideDuration.toFixed(2)}s, tổng ${totalVideoDur.toFixed(2)}s)...`);

    const inputs = framedImages.map(f => `-framerate 30 -loop 1 -t ${slideDuration.toFixed(2)} -i "${f}"`).join(' ');

    let filterGraph = '';
    if (youtubeEdit) {
      for (let i = 0; i < numImages; i++) {
        filterGraph += `[${i}:v]setsar=1,split=2[fast${i}][photo${i}];`;
        filterGraph += `[fast${i}]trim=end_frame=${opening.framesPerImage},setpts=PTS-STARTPTS[preview${i}];`;
      }
      filterGraph += framedImages.map((_, i) => `[preview${i}]`).join('') + `concat=n=${numImages}:v=1:a=0[opening];`;
    }
    let lastOut = youtubeEdit ? 'photo0' : '0:v';
    let currentOffset = slideDuration - transitionDuration;

    // No fade to black at the end: the last scene loops straight back to the first.
    const transitions = pickTransitions(framedImages.length - 1, selectedImages.map(file => path.basename(file)).join('|'));
    for (let i = 1; i < framedImages.length; i++) {
      const nextOut = i === framedImages.length - 1 ? 'vxfade' : `v${i}`;
      const source = youtubeEdit ? `photo${i}` : `${i}:v`;
      filterGraph += `[${lastOut}][${source}]xfade=transition=${youtubeEdit ? youtubeSceneTransition(i) : transitions[i - 1]}:duration=${transitionDuration.toFixed(2)}:offset=${currentOffset.toFixed(2)}[${nextOut}];`;
      lastOut = nextOut;
      currentOffset += (slideDuration - transitionDuration);
    }

    filterGraph += youtubeEdit ? `[opening][${lastOut}]concat=n=2:v=1:a=0[vfinal]` : `[${lastOut}]null[vfinal]`;

    const start = await musicStart(audioPath, totalVideoDur);
    const audioInput = (audioPath && fs.existsSync(audioPath))
      ? `${start > 0 ? `-ss ${start} ` : ''}-i "${audioPath}"`
      : '-f lavfi -i anullsrc=channel_layout=stereo:sample_rate=44100';

    const encodeCmd = `ffmpeg -y -threads 0 ${inputs} ${audioInput} -filter_complex "${filterGraph}" -map "[vfinal]" -map ${framedImages.length}:a ${youtubeEdit ? `-af apad -t ${totalVideoDur.toFixed(2)}` : ''} -c:v libx264 -preset veryfast -crf 18 -profile:v high -level 4.2 -r 30 -g 60 -keyint_min 30 -sc_threshold 0 -b:v 10M -maxrate 14M -bufsize 20M -pix_fmt yuv420p -colorspace bt709 -color_primaries bt709 -color_trc bt709 -color_range tv -movflags +faststart -c:a aac -b:a 256k -ar 44100 -shortest "${outputPath}"`;
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
