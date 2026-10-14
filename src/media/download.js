import fs from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';

// Use only alternate URLs supplied for the same video by Kuaishou.
export function videoDownloadUrls(photo, primaryUrl) {
  const alternates = Array.isArray(photo.mainMvUrls) ? photo.mainMvUrls : [];
  return [...new Set([primaryUrl, ...alternates.map(item => typeof item === 'string' ? item : item?.url)].filter(Boolean))];
}

export async function downloadMediaFile(urls, destPath, {
  headers, fetchImpl = fetch, timeoutMs = 30000, maxDurationMs = 30 * 60 * 1000,
  attempts = 3, retryDelayMs = 1000, onProgress = () => {},
} = {}) {
  if (fs.existsSync(destPath) && fs.statSync(destPath).size > 0) return;
  const candidates = [...new Set((Array.isArray(urls) ? urls : [urls]).filter(Boolean))];
  if (!candidates.length) throw new Error('Không có URL để tải media');
  const partPath = `${destPath}.part`;
  const deadline = Date.now() + maxDurationMs;
  let lastError;
  let lastHost;
  for (const url of candidates) {
    let received = 0, total = null, validator = null;
    lastHost = new URL(url).hostname;
    for (let attempt = 0; attempt < attempts && Date.now() < deadline; attempt++) {
      const controller = new AbortController();
      let idleTimer;
      const resetIdle = () => {
        clearTimeout(idleTimer);
        idleTimer = setTimeout(() => controller.abort(new Error('CDN ngừng truyền dữ liệu')), timeoutMs);
      };
      const totalTimer = setTimeout(() => controller.abort(new Error('Quá thời gian tải media')), Math.max(1, deadline - Date.now()));
      let response, file, diskFailure = false;
      // Resume only on the same URL with a validator; never splice different CDN files.
      const offset = validator && total !== null ? received : 0;
      const requestHeaders = new Headers(headers);
      requestHeaders.set('Accept-Encoding', 'identity');
      if (offset) {
        requestHeaders.set('Range', `bytes=${offset}-`);
        requestHeaders.set('If-Range', validator);
      }
      try {
        resetIdle();
        response = await fetchImpl(url, { headers: requestHeaders, redirect: 'follow', signal: controller.signal });
        if (!response.ok) {
          const error = new Error(`HTTP ${response.status}`);
          error.retryable = response.status === 408 || response.status === 429 || response.status >= 500;
          throw error;
        }
        const contentType = response.headers.get('content-type') || '';
        if (/text\/html|application\/json/i.test(contentType)) throw new Error('CDN trả về trang lỗi thay vì media');
        if (response.headers.get('content-encoding') && response.headers.get('content-encoding') !== 'identity') {
          throw new Error('CDN trả về dữ liệu nén không hỗ trợ tải tiếp');
        }
        if (response.status === 206) {
          const range = response.headers.get('content-range')?.match(/^bytes (\d+)-(\d+)\/(\d+)$/);
          if (!range || Number(range[1]) !== offset || Number(range[2]) < offset || Number(range[2]) >= Number(range[3]) || (offset && Number(range[3]) !== total)) {
            received = 0; validator = null; total = null;
            throw new Error('CDN trả về khoảng dữ liệu không khớp');
          }
          total = Number(range[3]);
          received = offset;
        } else {
          // If-Range mismatch or a CDN ignoring Range requires a clean restart.
          received = 0;
          const length = response.headers.get('content-length');
          total = length && /^\d+$/.test(length) ? Number(length) : null;
        }
        const etag = response.headers.get('etag');
        const nextValidator = etag && !etag.startsWith('W/') ? etag : response.headers.get('last-modified');
        if (response.status === 206 && offset && nextValidator && nextValidator !== validator) {
          received = 0; validator = null; total = null;
          throw new Error('Media trên CDN đã thay đổi khi tải tiếp');
        }
        validator = nextValidator;
        try { file = await fs.promises.open(partPath, received ? 'a' : 'w'); }
        catch (error) { diskFailure = true; throw error; }
        resetIdle();
        for await (const chunk of response.body) {
          resetIdle();
          try { await file.writeFile(chunk); }
          catch (error) { diskFailure = true; throw error; }
          received += chunk.byteLength;
          onProgress({ host: lastHost, received, total, attempt: attempt + 1 });
        }
        if (!received || (total !== null && received !== total)) throw new Error('CDN ngắt kết nối trước khi tải đủ media');
        try {
          await file.close(); file = null;
          fs.renameSync(partPath, destPath);
        } catch (error) { diskFailure = true; throw error; }
        return;
      } catch (error) {
        if (diskFailure) throw error;
        lastError = error;
        // A dead host gets one connection attempt before moving to its alternate.
        if (error.retryable === false || (!received && candidates.length > 1)) break;
      } finally {
        clearTimeout(idleTimer);
        clearTimeout(totalTimer);
        controller.abort();
        await file?.close();
        if (response?.body && !response.body.locked) await response.body.cancel().catch(() => {});
      }
      if (attempt + 1 < attempts) await delay(Math.min(retryDelayMs * (attempt + 1), Math.max(0, deadline - Date.now())));
    }
    if (Date.now() >= deadline) break;
  }
  // Only complete files are eligible for the cache or upload.
  fs.rmSync(partPath, { force: true });
  const error = new Error(`Không tải được ${lastHost}: ${lastError?.cause?.code || lastError?.message || 'Quá thời gian tải media'}`, { cause: lastError });
  error.code = 'NETWORK_READ_FAILED';
  throw error;
}
