import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile);

// Technical quality heuristic, not a prediction of clicks or semantic relevance.
export function scoreThumbnail(rgb) {
  const count = Math.floor(rgb.length / 3);
  if (!count) return -Infinity;
  let sum = 0, squared = 0, clipped = 0, edges = 0;
  let previous = 0;
  for (let i = 0; i < count; i++) {
    const j = i * 3;
    const luminance = .2126 * rgb[j] + .7152 * rgb[j + 1] + .0722 * rgb[j + 2];
    sum += luminance; squared += luminance * luminance;
    if (luminance < 18 || luminance > 242) clipped++;
    if (i % 96) edges += Math.abs(luminance - previous);
    previous = luminance;
  }
  const mean = sum / count;
  return Math.sqrt(Math.max(0, squared / count - mean * mean)) + edges / count
    - 75 * clipped / count - .18 * Math.abs(mean - 128);
}

export async function createYouTubeThumbnail(videoPath) {
  const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', videoPath], { timeout: 15000 });
  const duration = Number(stdout.trim());
  if (!(duration > 0)) throw new Error('Không đọc được thời lượng video để chọn thumbnail');
  let best = { score: -Infinity, time: 0 };
  for (const fraction of [.05, .17, .29, .41, .53, .65, .77, .89]) {
    const time = duration * fraction;
    const { stdout: pixels } = await run('ffmpeg', ['-v', 'error', '-ss', String(time), '-i', videoPath, '-frames:v', '1', '-vf', 'scale=96:160', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], { encoding: 'buffer', timeout: 20000, maxBuffer: 1024 * 1024 });
    const score = scoreThumbnail(pixels);
    if (score > best.score) best = { score, time };
  }
  if (!Number.isFinite(best.score)) throw new Error('Không lấy được khung hình thumbnail');
  const output = path.join(path.dirname(videoPath), 'youtube-thumbnail.jpg');
  await run('ffmpeg', ['-v', 'error', '-y', '-ss', String(best.time), '-i', videoPath, '-frames:v', '1', '-vf', 'scale=1080:1920:force_original_aspect_ratio=decrease', '-q:v', '2', output], { timeout: 30000 });
  return output;
}

export async function applyYouTubeThumbnail(videoId, thumbnailPath, token, { fetchImpl = fetch, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), attempts = 24 } = {}) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const status = await fetchImpl(`https://www.googleapis.com/youtube/v3/videos?part=processingDetails&id=${encodeURIComponent(videoId)}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000) });
    if (!status.ok) throw new Error(`Không kiểm tra được xử lý YouTube (${status.status})`);
    const body = await status.json();
    const processing = body.items?.[0]?.processingDetails?.processingStatus;
    if (processing === 'succeeded') {
      const bytes = await fs.readFile(thumbnailPath);
      const response = await fetchImpl(`https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${encodeURIComponent(videoId)}`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'image/jpeg' }, body: bytes, signal: AbortSignal.timeout(30000) });
      if (!response.ok) throw new Error(`YouTube chưa cho gắn thumbnail (${response.status}); kiểm tra quyền thumbnail của kênh`);
      return;
    }
    if (['failed', 'terminated'].includes(processing)) throw new Error('YouTube xử lý video thất bại');
    if (attempt + 1 < attempts) await sleep(5000);
  }
  throw new Error('YouTube còn xử lý video; chưa gắn thumbnail');
}
