import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';

const run = promisify(execFile);
const inFlight = new Map();

// Legacy name: remove unverified source audio, never alter fingerprints.
// This does not grant rights to the remaining images or video.
export async function sanitizeVideoAudioForCopyright(videoPath, { runImpl = run } = {}) {
  if (!videoPath || !fs.existsSync(videoPath)) throw new Error('Không tìm thấy video để loại âm thanh nguồn.');
  const source = path.resolve(videoPath);
  if (inFlight.has(source)) return inFlight.get(source);
  const job = (async () => {
    const probe = async file => {
      const { stdout } = await runImpl('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'json', file]);
      const streams = JSON.parse(stdout).streams;
      if (!Array.isArray(streams) || !streams.some(s => s.codec_type === 'video')) throw new Error('Video không hợp lệ.');
      return streams.some(s => s.codec_type === 'audio');
    };
    if (!await probe(source)) return videoPath;
    // Old *_safe files may still contain pitch-shifted music. Never trust them.
    const output = path.join(path.dirname(source), `${path.parse(source).name}_no_source_audio_${randomUUID()}.mp4`);
    try {
      await runImpl('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', source,
        '-map', '0:v:0', '-c:v', 'copy', '-an', '-sn', '-dn', '-map_metadata', '-1', '-movflags', '+faststart', output],
      { timeout: 10 * 60 * 1000, maxBuffer: 1024 * 1024 });
      if (!fs.statSync(output).size || await probe(output)) throw new Error('Không xác nhận được việc loại âm thanh nguồn.');
      return output;
    } catch (error) {
      fs.rmSync(output, { force: true });
      throw new Error(`Dừng đăng: không loại được âm thanh nguồn. ${error.message}`);
    }
  })();
  inFlight.set(source, job);
  try { return await job; } finally { inFlight.delete(source); }
}
