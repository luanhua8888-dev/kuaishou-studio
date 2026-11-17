import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { renderWithCache } from './render-cache.js';

const run = promisify(execFile);
const filterPath = file => path.resolve(file).replaceAll('\\', '/').replaceAll(':', '\\:').replaceAll("'", "'\\''");

// Editing defaults, not ranking thresholds. Preserve the author's image order.
export function youtubeSlideshowTiming(imageCount) {
  if (!Number.isInteger(imageCount) || imageCount < 1) throw new Error('Số ảnh YouTube phải là số nguyên dương');
  const transitionDuration = 0.5;
  const totalDuration = imageCount === 1 ? 6 : imageCount * 3.6;
  const slideDuration = (totalDuration + (imageCount - 1) * transitionDuration) / imageCount;
  return { transitionDuration, slideDuration, totalDuration };
}

// Frame-aligned rapid preview: every photo appears before the slower replay.
export function youtubeOpeningTiming(imageCount) {
  youtubeSlideshowTiming(imageCount);
  const framesPerImage = Math.max(3, Math.min(9, Math.round(90 / imageCount)));
  return { framesPerImage, imageDuration: framesPerImage / 30, totalDuration: imageCount === 1 ? 0 : imageCount * framesPerImage / 30 };
}

export function youtubeSceneTransition(sceneIndex) {
  // Alternate directional reveals with quiet dissolves, without zoom or flashes.
  const transitions = ['smoothleft', 'fade', 'wipeup', 'smoothright', 'fade', 'wipedown'];
  return transitions[((sceneIndex - 1) % transitions.length + transitions.length) % transitions.length];
}

export function youtubeHook(caption) {
  const firstLine = String(caption || '').replace(/#[\p{L}\p{N}_]+/gu, '').split(/\r?\n/).find(line => line.trim()) || '';
  const clean = firstLine.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim();
  if (clean.length <= 56) return clean;
  const words = clean.split(' ');
  let text = '';
  for (const word of words) {
    if ((text ? text.length + 1 : 0) + word.length > 53) break;
    text += (text ? ' ' : '') + word;
  }
  // Do not display broken words or unreadably long tokens.
  return text ? text.replace(/[,;:\-–—]+$/u, '').trimEnd() + '…' : '';
}

export async function addYouTubeHook(videoPath, outputPath, caption, { runImpl = run, fontPath } = {}) {
  const hook = youtubeHook(caption);
  if (!hook) return videoPath;
  const font = fontPath || [
    'C:/Windows/Fonts/seguisb.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    '/System/Library/Fonts/Supplemental/Arial.ttf'
  ].find(file => fs.existsSync(file));
  if (!font) throw new Error('Không tìm thấy font cho hook YouTube');
  return renderWithCache(outputPath, [videoPath, font], { hook, version: 2 }, async () => {
    const temp = fs.mkdtempSync(path.join(path.dirname(outputPath), '.youtube-hook-'));
    try {
      const textFile = path.join(temp, 'hook.txt');
      // Wrap into two short lines; FFmpeg reads literal text, not shell/filter syntax.
      const breaks = [...hook.matchAll(/ /g)].map(match => match.index);
      const middle = breaks.sort((a, b) => Math.abs(a - hook.length / 2) - Math.abs(b - hook.length / 2))[0];
      const lines = hook.length > 26 && middle !== undefined
        ? [hook.slice(0, middle), hook.slice(middle + 1)] : [hook];
      fs.writeFileSync(textFile, lines.join('\n'), 'utf8');
      const vf = `scale=1080:1920:force_original_aspect_ratio=decrease:flags=lanczos,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,setsar=1,drawtext=fontfile='${filterPath(font)}':textfile='${filterPath(textFile)}':expansion=none:fontsize=48:fontcolor=white:line_spacing=12:box=1:boxcolor=black@0.45:boxborderw=18:x=(w-text_w)/2:y=300:enable='lt(t,3)'`;
      await runImpl('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', videoPath,
        '-map', '0:v:0', '-map', '0:a?', '-vf', vf, '-c:v', 'libx264', '-preset', 'veryfast',
        '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'copy', '-movflags', '+faststart', outputPath],
      { timeout: 10 * 60 * 1000, maxBuffer: 1024 * 1024 });
    } finally {
      fs.rmSync(temp, { recursive: true, force: true });
    }
  });
}
