import { PROJECT_ROOT, ARTIFACTS_DIR, DOWNLOADS_DIR } from '../../src/paths.js';
import fs from 'node:fs';
import path from 'node:path';
import { createTikTokSlideshow } from '../../src/media/tiktok-slideshow.js';
import { resolveSampleSource, sampleImages } from './sample-source.mjs';

async function main() {
  const root = PROJECT_ROOT;
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log('npm run render:tiktok -- [thư-mục-ảnh] [config.json] [output.mp4]\nMặc định: chọn thư mục tải về mới nhất có ảnh image_*.jpg/jpeg/png/webp.');
    return;
  }
  const source = resolveSampleSource(process.argv[2], DOWNLOADS_DIR);
  const configPath = path.resolve(process.argv[3] || path.join(root, 'config/examples/tiktok-slideshow.norway.example.json'));
  const output = path.resolve(process.argv[4] || path.join(ARTIFACTS_DIR, 'tiktok-landscape-sample.mp4'));
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const files = sampleImages(source);
  if (!files.length) throw new Error(`Không có ảnh trong ${source}`);
  // Keep a local QA copy; the running downloader can clean its download directory.
  const sampleSources = path.join(path.dirname(output), 'slideshow-sample-sources');
  fs.mkdirSync(sampleSources, { recursive: true });
  const images = files.map(file => {
    const target = path.join(sampleSources, file);
    if (path.resolve(path.join(source, file)) !== path.resolve(target)) fs.copyFileSync(path.join(source, file), target);
    return target;
  });
  console.log(`Nguồn ảnh: ${source} (${images.length} ảnh)`);
  let audio = null;
  if (fs.existsSync(path.join(source, 'audio.m4a'))) {
    audio = path.join(sampleSources, 'audio.m4a');
    if (path.resolve(path.join(source, 'audio.m4a')) !== path.resolve(audio)) fs.copyFileSync(path.join(source, 'audio.m4a'), audio);
  }
  await createTikTokSlideshow(images, audio, output, config);
  fs.writeFileSync(`${output}.caption.txt`, config.caption || '', 'utf8');
  console.log(`Đã render mẫu: ${output}. Ảnh có sẵn dùng để kiểm tra bố cục, chưa xác minh là Na Uy. Script chỉ render, không đăng bài.`);
}

main().catch(error => {
  console.error(`Không thể render mẫu TikTok: ${error.message}`);
  process.exitCode = 1;
});
