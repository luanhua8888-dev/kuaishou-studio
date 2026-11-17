import fs from 'fs';
import util from 'util';
import { exec } from 'child_process';
import { networkRead } from '../network/network-read.js';
import { downloadMediaFile } from './download.js';

const execPromise = util.promisify(exec);
export const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

export async function downloadFile(url, destPath, onProgress) {
  await downloadMediaFile(url, destPath, {
    onProgress,
    headers: {
      'User-Agent': USER_AGENT,
      'Referer': 'https://www.kuaishou.com/'
    }
  });
}

export async function downloadImageAsJpg(url, destJpgPath) {
  if (fs.existsSync(destJpgPath)) return destJpgPath;

  // 1. Thử tải trực tiếp file JPG gốc từ CDN Kuaishou (tránh bị nén WebP 2 lần)
  if (url.includes('.webp')) {
    const directJpgUrl = url.replace(/\.webp(\?.*)?$/i, '.jpg$1');
    try {
      const jpgRes = await networkRead(directJpgUrl, {
        format: 'buffer', timeoutMs: 10000, attempts: 1,
        headers: {
          'User-Agent': USER_AGENT,
          'Referer': 'https://www.kuaishou.com/'
        }
      });
      if (jpgRes.contentType.includes('image')) {
        if (jpgRes.data.byteLength > 1000) {
          fs.writeFileSync(destJpgPath, jpgRes.data);
          return destJpgPath;
        }
      }
    } catch {}
  }

  // 2. Tải từ URL gốc
  const { data: buffer } = await networkRead(url, {
    format: 'buffer',
    headers: {
      'User-Agent': USER_AGENT,
      'Referer': 'https://www.kuaishou.com/'
    }
  });

  // Check if buffer is WEBP (starts with 'RIFF' and bytes 8..11 are 'WEBP')
  const isWebp = buffer.length > 12 && buffer.slice(0, 4).toString('ascii') === 'RIFF' && buffer.slice(8, 12).toString('ascii') === 'WEBP';

  if (isWebp) {
    const tempWebp = destJpgPath + '.temp.webp';
    fs.writeFileSync(tempWebp, buffer);
    try {
      await execPromise(`ffmpeg -y -i "${tempWebp}" -qscale:v 1 -qmin 1 -pix_fmt yuvj420p -color_range pc -update 1 -frames:v 1 "${destJpgPath}"`);
    } finally {
      try { fs.unlinkSync(tempWebp); } catch {}
    }
  } else {
    fs.writeFileSync(destJpgPath, buffer);
  }

  return destJpgPath;
}
