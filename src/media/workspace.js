import fs from 'fs';
import path from 'path';
import { DOWNLOADS_DIR } from '../paths.js';

export function removeDownloadDirectory(target) {
  const root = DOWNLOADS_DIR;
  const resolved = path.resolve(target);
  const relative = path.relative(root, resolved);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Đường dẫn dọn dẹp nằm ngoài downloads');
  }
  fs.rmSync(resolved, { recursive: true, force: true });
}

export function sanitizeFileName(name) {
  const normalized = (name || 'kuaishou').normalize('NFKD').replace(/[^\w\s-]/g, '').trim();
  return (normalized || 'kuaishou').replace(/[\r\n\t]/g, ' ');
}

// Each post gets one working folder under downloads/, named by author and photo ID.
export function postOutputDir(post) {
  const outputDir = path.join(DOWNLOADS_DIR, sanitizeFileName(`${post.author}_${post.photoId || Date.now()}`).slice(0, 50));
  fs.mkdirSync(outputDir, { recursive: true });
  return outputDir;
}
