import fs from 'node:fs';
import path from 'node:path';

export function sampleImages(directory) {
  return fs.readdirSync(directory, { withFileTypes: true })
    .filter(entry => entry.isFile() && /^image_.*\.(jpg|jpeg|png|webp)$/i.test(entry.name))
    .map(entry => entry.name).sort();
}

export function resolveSampleSource(explicitSource, downloadsDirectory) {
  if (explicitSource) {
    const source = path.resolve(explicitSource);
    if (!fs.existsSync(source) || !fs.statSync(source).isDirectory()) {
      throw new Error(`Thư mục ảnh không tồn tại: ${source}`);
    }
    if (!sampleImages(source).length) throw new Error(`Không có ảnh image_*.jpg/jpeg/png/webp trong ${source}`);
    return source;
  }

  if (fs.existsSync(downloadsDirectory) && fs.statSync(downloadsDirectory).isDirectory()) {
    const candidates = fs.readdirSync(downloadsDirectory, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => path.join(downloadsDirectory, entry.name))
      .filter(directory => sampleImages(directory).length)
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs || a.localeCompare(b));
    if (candidates.length) return candidates[0];
  }

  throw new Error(`Chưa có ảnh mẫu trong ${downloadsDirectory}. Tải một bài ảnh trước hoặc truyền thư mục ảnh:\nnpm run render:tiktok -- "đường/dẫn/thư/mục/ảnh" [config.json] [output.mp4]\nTên ảnh cần có dạng image_*.jpg/jpeg/png/webp.`);
}
