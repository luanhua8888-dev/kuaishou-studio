import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import assert from 'node:assert/strict';

const run = promisify(execFile);
const video = path.resolve(process.argv[2] || 'artifacts/tiktok-landscape-sample.mp4');
const story = JSON.parse(fs.readFileSync(`${video}.story.json`, 'utf8'));
const { stdout } = await run('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', video]);
const probe = JSON.parse(stdout);
const stream = probe.streams.find(s => s.codec_type === 'video');
assert.equal(stream.width, 1080); assert.equal(stream.height, 1920);
assert.equal(stream.avg_frame_rate, '30/1'); assert.equal(stream.sample_aspect_ratio, '1:1');
assert.ok(Math.abs(Number(probe.format.duration) - story.duration) <= 1 / 30 + 0.01);
assert.ok(story.captions.every(c => c.text.split('\n').length <= 2));
// Decode all frames; errors anywhere in a dissolve fail verification.
await run('ffmpeg', ['-v', 'error', '-xerror', '-i', video, '-f', 'null', '-'], { maxBuffer: 8 * 1024 * 1024 });
const dir = path.join(path.dirname(video), 'slideshow-qa'); fs.mkdirSync(dir, { recursive: true });
const points = { start: 0.5, middle: story.duration / 2, end: story.duration - 0.5 };
for (const scene of story.scenes.slice(1)) points[`transition-${scene.index}`] = (scene.start + story.transitionFrames / 2) / 30;
for (const [label, seconds] of Object.entries(points)) {
  await run('ffmpeg', ['-v', 'error', '-y', '-ss', String(seconds), '-i', video, '-frames:v', '1', path.join(dir, `${label}.png`)]);
}
const report = { dimensions: [stream.width, stream.height], fps: stream.avg_frame_rate, duration: probe.format.duration, fullDecode: 'passed', extractedFrames: points, captions: story.captions };
fs.writeFileSync(path.join(dir, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
