import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import util from 'node:util';
import { exec, execFileSync } from 'node:child_process';
import { normalizeCaptionText } from './caption-text.js';

const root = path.resolve('downloads');
const work = path.join(root, `verify-reel-${process.pid}`);
fs.mkdirSync(work, { recursive: true });
try {
  const images = [0, 1].map(index => path.join(work, `image_${index}.jpg`));
  for (let i = 0; i < images.length; i++) {
    execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `color=c=${i ? '0x3c7659' : '0x304c7a'}:s=320x480:d=1`, '-frames:v', '1', '-update', '1', images[i]]);
  }
  const source = fs.readFileSync('server.js', 'utf8');
  const context = vm.createContext({ fs, path, console, normalizeCaptionText, execPromise: util.promisify(exec) });
  vm.runInContext(source.slice(source.indexOf('function cleanPureText'), source.indexOf('function extractUrl')), context);
  context.images = images;
  context.work = work;
  const begin = Date.now();
  await vm.runInContext("createCinematicReel(images, null, path.join(work, 'clean.mp4'), '', path.join(work, 'cache'))", context);
  const baseFrames = images.map((_, i) => path.join(work, 'cache', `frame_${String(i).padStart(2, '0')}.png`));
  const baseMtimes = baseFrames.map(file => fs.statSync(file).mtimeMs);
  const cleanSeconds = ((Date.now() - begin) / 1000).toFixed(1);
  await vm.runInContext("createCinematicReel(images, null, path.join(work, 'caption.mp4'), 'Khoảnh khắc bình yên giữa cuộc đời', path.join(work, 'cache'))", context);
  for (let i = 0; i < baseFrames.length; i++) {
    if (fs.statSync(baseFrames[i]).mtimeMs !== baseMtimes[i]) throw new Error('Frame cache was rebuilt');
  }
  for (const name of ['clean.mp4', 'caption.mp4']) {
    const file = path.join(work, name);
    if (fs.statSync(file).size < 1000) throw new Error(`${name} is empty`);
    const duration = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', file], { encoding: 'utf8' }).trim());
    if (duration < 3) throw new Error(`${name} is too short: ${duration}`);
  }
  console.log(`PASS: two 1080p reels rendered; shared frames reused; clean reel ${cleanSeconds}s, total ${((Date.now() - begin) / 1000).toFixed(1)}s`);
} finally {
  const relative = path.relative(root, work);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Cleanup path escaped downloads');
  fs.rmSync(work, { recursive: true, force: true });
}
