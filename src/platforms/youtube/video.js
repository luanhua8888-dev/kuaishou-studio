import fs from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { analyzeAudio } from '../../media/audio-analysis.js';

const run = promisify(execFile);

async function defaultHighlightStart(videoPath, windowSeconds) {
  try { return (await analyzeAudio(videoPath, windowSeconds)).start; } catch { return 0; }
}

/**
 * Ensure YouTube uploads are always true 9:16 vertical Shorts (clean, no text overlay)
 * and capped around 15-24s so viewer retention stays high.
 */
export async function prepareYouTubeShortVideo(videoPath, outputPath, {
  maxSeconds = 24,
  highlightStart = defaultHighlightStart,
  runImpl = run
} = {}) {
  if (!videoPath || !fs.existsSync(videoPath)) return videoPath;
  const { stdout } = await runImpl('ffprobe', [
    '-v', 'error',
    '-show_entries', 'stream=codec_type,width,height,tags:stream_side_data=rotation:format=duration',
    '-of', 'json', videoPath
  ], { timeout: 15000 });
  const parsed = JSON.parse(stdout || '{}');
  const streams = Array.isArray(parsed.streams) ? parsed.streams : [];
  const vStream = streams.find(s => s.codec_type === 'video') || streams[0] || {};
  const hasAudio = streams.length === 1 && !vStream.codec_type ? true : streams.some(s => s.codec_type === 'audio');
  const rawW = Number(vStream.width || 0);
  const rawH = Number(vStream.height || 0);
  const rot = Number(vStream.side_data_list?.find(d => d.rotation !== undefined)?.rotation ?? vStream.tags?.rotate ?? 0);
  const swapped = Math.abs(rot) % 180 === 90;
  const width = swapped ? rawH : rawW;
  const height = swapped ? rawW : rawH;
  const duration = Number(parsed.format?.duration || 0);

  const needsVertical = !(width > 0 && height > 0 && height / width >= 1.5);
  const needsTrim = duration > maxSeconds + 2;
  if (!needsVertical && !needsTrim) return videoPath;

  const targetDur = needsTrim ? maxSeconds : Math.max(1, duration);
  const rawStart = needsTrim ? await highlightStart(videoPath, targetDur) : 0;
  const start = Math.max(0, Math.min(Number(rawStart) || 0, Math.max(0, duration - targetDur)));
  const vf = 'scale=1080:1920:force_original_aspect_ratio=increase:flags=lanczos,crop=1080:1920,setsar=1';

  const args = ['-y', '-v', 'error'];
  if (start > 0) args.push('-ss', String(+start.toFixed(2)));
  if (needsTrim) args.push('-t', String(targetDur));
  args.push('-i', videoPath, '-vf', vf);
  if (hasAudio) {
    args.push('-af', `afade=t=in:d=0.08,afade=t=out:st=${Math.max(0, targetDur - 0.45).toFixed(2)}:d=0.45`, '-c:a', 'aac', '-b:a', '192k');
  } else {
    args.push('-an');
  }
  args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', '30', '-movflags', '+faststart', outputPath);
  await runImpl('ffmpeg', args, { timeout: 180000 });
  return fs.existsSync(outputPath) ? outputPath : videoPath;
}
