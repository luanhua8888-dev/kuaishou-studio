import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTikTokSlideshow } from './tiktok-slideshow.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const source = path.resolve(process.argv[2] || path.join(root, 'downloads/_5216575952998412128'));
const configPath = path.resolve(process.argv[3] || path.join(root, 'tiktok-slideshow.norway.example.json'));
const output = path.resolve(process.argv[4] || path.join(root, 'artifacts/tiktok-landscape-sample.mp4'));
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const files = fs.readdirSync(source).filter(f => /^image_.*\.(jpg|jpeg|png|webp)$/i.test(f)).sort();
if (!files.length) throw new Error(`Không có ảnh trong ${source}`);
// Keep a local QA copy; the running downloader can clean its download directory.
const sampleSources = path.join(path.dirname(output), 'slideshow-sample-sources');
fs.mkdirSync(sampleSources, { recursive: true });
const images = files.map(file => {
  const target = path.join(sampleSources, file);
  if (path.resolve(path.join(source, file)) !== path.resolve(target)) fs.copyFileSync(path.join(source, file), target);
  return target;
});
let audio = null;
if (fs.existsSync(path.join(source, 'audio.m4a'))) {
  audio = path.join(sampleSources, 'audio.m4a');
  if (path.resolve(path.join(source, 'audio.m4a')) !== path.resolve(audio)) fs.copyFileSync(path.join(source, 'audio.m4a'), audio);
}
await createTikTokSlideshow(images, audio, output, config);
fs.writeFileSync(`${output}.caption.txt`, config.caption || '', 'utf8');
console.log(`Đã render mẫu: ${output}. Ảnh có sẵn dùng để kiểm tra bố cục, chưa xác minh là Na Uy. Script chỉ render, không đăng bài.`);
