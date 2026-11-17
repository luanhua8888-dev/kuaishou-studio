import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ARTIFACTS_DIR } from '../../src/paths.js';
import { addYouTubeHook } from '../../src/media/youtube-short.js';
import { buildYouTubeMetadata } from '../../src/platforms/youtube/metadata.js';

const run = promisify(execFile);
const dir = path.join(ARTIFACTS_DIR, 'youtube-ai-sample');
const image = path.join(dir, 'sage-lakeside-ai.png');
if (!fs.existsSync(image)) throw new Error('Missing generated sample image: ' + image);
const base = path.join(dir, 'sage-lakeside-base.mp4');
const output = path.join(dir, 'sage-ai-preview.mp4');
// A restrained breathing camera move; no externally sourced music.
await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y',
  '-loop', '1', '-framerate', '30', '-i', image,
  '-f', 'lavfi', '-i', 'anoisesrc=color=pink:amplitude=0.025:sample_rate=44100',
  '-vf', "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,zoompan=z='1+0.02*sin(PI*on/180)':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d=1:s=1080x1920:fps=30,setsar=1",
  '-af', 'lowpass=f=700,highpass=f=80,afade=t=in:d=0.1,afade=t=out:st=5.8:d=0.2',
  '-t', '6', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p',
  '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', base],
{ timeout: 180000, maxBuffer: 1024 * 1024 });
await addYouTubeHook(base, output, 'A quiet moment, just for you.');
await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-ss', '0.5', '-i', output, '-frames:v', '1', path.join(dir, 'preview.png')]);
const { stdout } = await run('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', output]);
const probe = JSON.parse(stdout);
const video = probe.streams.find(stream => stream.codec_type === 'video');
assert.equal(video.width, 1080);
assert.equal(video.height, 1920);
assert.ok(Math.abs(Number(probe.format.duration) - 6) < 0.1);
assert.ok(probe.streams.some(stream => stream.codec_type === 'audio'));
const metadata = buildYouTubeMetadata('A quiet moment, just for you. #QuietMoments #SlowLiving #PeacefulScenery', {
  description: 'An imaginary lakeside escape, created with AI imagery and a gentle camera move. The landscape and ambient sound are synthetic, not a recording of a real location.'
});
fs.writeFileSync(path.join(dir, 'metadata.json'), JSON.stringify({ ...metadata, aiGenerated: true, durationSeconds: 6, published: false }, null, 2));
console.log(`PASS: 6s, 1080x1920, 30fps, hook + synthetic ambience. Not published.\n${output}`);
