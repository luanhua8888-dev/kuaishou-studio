import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { addYouTubeHook } from '../../src/media/youtube-short.js';
import { ARTIFACTS_DIR } from '../../src/paths.js';

const run = promisify(execFile);
const dir = fs.mkdtempSync(path.join(ARTIFACTS_DIR, 'youtube-edit-qa-'));
const source = path.join(dir, 'source.mp4');
const output = path.join(dir, 'hook.mp4');
await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y',
  '-f', 'lavfi', '-i', 'color=c=0x344b43:s=540x960:r=30:d=4',
  '-f', 'lavfi', '-i', 'sine=frequency=220:duration=4',
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', source]);
await addYouTubeHook(source, output, 'A quiet moment, just for you.');
const { stdout } = await run('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', output]);
const info = JSON.parse(stdout);
const video = info.streams.find(s => s.codec_type === 'video');
assert.equal(video.width, 1080);
assert.equal(video.height, 1920);
assert.ok(info.streams.some(s => s.codec_type === 'audio'));
assert.ok(Math.abs(Number(info.format.duration) - 4) < 0.15);
for (const [name, time] of [['opening', '0.5'], ['after-hook', '3.5']]) {
  await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-ss', time, '-i', output, '-frames:v', '1', path.join(dir, `${name}.png`)]);
}
console.log(`PASS: 1080x1920, audio preserved, duration 4s. Preview: ${dir}`);
