import fs from 'node:fs';
import { createHash } from 'node:crypto';

export async function renderWithCache(outputPath, inputs, settings, render) {
  const sources = inputs.filter(Boolean).map(file => {
    const stat = fs.statSync(file);
    return { file, size: stat.size, modified: stat.mtimeMs };
  });
  const key = createHash('sha256').update(JSON.stringify({ sources, settings })).digest('hex');
  const metadataPath = `${outputPath}.render.json`;
  try {
    const cached = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
    const stat = fs.statSync(outputPath);
    if (cached.key === key && cached.size === stat.size && cached.modified === stat.mtimeMs && stat.size > 0) {
      console.log('[Reel] Dùng lại video đã tạo, không cần ghép lại.');
      return outputPath;
    }
  } catch {}
  // Invalidate first so a failed render cannot reuse metadata from an old file.
  if (fs.existsSync(metadataPath)) fs.unlinkSync(metadataPath);
  await render();
  const stat = fs.statSync(outputPath);
  if (!stat.size) throw new Error('Video được tạo bị rỗng');
  fs.writeFileSync(metadataPath, JSON.stringify({ key, size: stat.size, modified: stat.mtimeMs }));
  return outputPath;
}
