import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';

/**
 * Tự động xử lý âm thanh video để lách thuật toán quét bản quyền tự động (Content ID / Meta Rights Manager)
 * - Sử dụng pitch shift nhẹ (+4.5%) qua rubberband/asetrate để làm biến dạng vân âm thanh (acoustic fingerprint)
 * - Giữ nguyên 100% hình ảnh gốc (-c:v copy), xử lý siêu nhanh (< 0.5s), không mất chất lượng
 * - Giữ nguyên thời lượng, đồng bộ 100% hình và tiếng
 */
export async function sanitizeVideoAudioForCopyright(videoPath) {
  if (!videoPath || !fs.existsSync(videoPath)) return videoPath;

  const ext = path.extname(videoPath).toLowerCase();
  if (ext !== '.mp4' && ext !== '.mov') return videoPath;
  if (videoPath.includes('_safe.mp4')) return videoPath;

  const safeVideoPath = videoPath.replace(/\.[^.]+$/, '') + '_safe.mp4';
  if (fs.existsSync(safeVideoPath)) {
    return safeVideoPath;
  }

  try {
    const { stdout: hasAudio } = await new Promise((resolve) => {
      exec(`ffprobe -v error -select_streams a:0 -show_entries stream=codec_name -of csv=p=0 "${videoPath}"`, (err, stdout) => {
        resolve({ stdout: stdout || '' });
      });
    });

    if (!hasAudio || !hasAudio.trim()) {
      return videoPath;
    }

    console.log(`[Bản quyền] Đang áp dụng bộ lọc lách bản quyền âm thanh (pitch shift +4.5%) cho: ${path.basename(videoPath)}...`);
    await new Promise((resolve, reject) => {
      exec(`ffmpeg -y -i "${videoPath}" -c:v copy -af "rubberband=pitch=1.045" -c:a aac -b:a 192k "${safeVideoPath}"`, (err) => {
        if (err) {
          exec(`ffmpeg -y -i "${videoPath}" -c:v copy -af "asetrate=44100*1.045,aresample=44100,atempo=1/1.045" -c:a aac -b:a 192k "${safeVideoPath}"`, (err2) => {
            if (err2) reject(err2);
            else resolve();
          });
        } else {
          resolve();
        }
      });
    });

    console.log(`[Bản quyền] Xử lý âm thanh thành công! Video an toàn: ${path.basename(safeVideoPath)}`);
    return safeVideoPath;
  } catch (err) {
    console.warn(`[Bản quyền] Không thể xử lý âm thanh lách bản quyền, giữ nguyên gốc: ${err.message}`);
    return videoPath;
  }
}
