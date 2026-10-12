import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import twitterText from 'twitter-text';
import { removeCaptionMentions } from './caption-text.js';
import { xOAuth } from './x-oauth.js';

const root = path.dirname(fileURLToPath(import.meta.url));
export const AUTH_FILE = path.join(root, 'x_auth.json');
const TYPES = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.mp4': 'video/mp4' };

export function prepareXCaption(value, { truncate = false } = {}) {
  let text = removeCaptionMentions(value).trim();
  if (!text) throw new Error('Mô tả X không được để trống.');
  if (twitterText.parseTweet(text).valid) return text;
  if (!truncate || twitterText.parseTweet(text).weightedLength <= 280) {
    throw new Error('Mô tả X không hợp lệ hoặc vượt 280 ký tự. Hãy rút gọn trước khi đăng.');
  }
  const parts = [...new Intl.Segmenter('vi', { granularity: 'grapheme' }).segment(text)].map(part => part.segment);
  while (parts.length && !twitterText.parseTweet(parts.join('').trimEnd() + '…').valid) parts.pop();
  text = parts.join('').trimEnd() + '…';
  return text;
}

function credentials() {
  try { return JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8')); }
  catch { return {}; }
}

export function connectionStatus() {
  return xOAuth.status();
}

export function createXClient({ accessToken, fetchImpl = fetch, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  if (typeof accessToken !== 'string' || !accessToken.trim() || /\s/.test(accessToken)) throw new Error('User Access Token X không hợp lệ.');
  async function request(endpoint, { method = 'GET', json, body } = {}) {
    let response;
    try {
      response = await fetchImpl(`https://api.x.com/2${endpoint}`, {
        method, headers: { Authorization: `Bearer ${accessToken}`, ...(json ? { 'Content-Type': 'application/json' } : {}) },
        body: json ? JSON.stringify(json) : body, signal: AbortSignal.timeout(120000), redirect: 'error'
      });
    } catch {
      throw new Error('Không nhận được phản hồi từ X. Kiểm tra tài khoản trước khi thử lại để tránh đăng trùng.');
    }
    let result;
    try { result = response.status === 204 ? {} : await response.json(); }
    catch { throw new Error('X trả về phản hồi không hợp lệ. Kiểm tra tài khoản trước khi thử lại để tránh đăng trùng.'); }
    if (!response.ok || result.errors?.length) {
      // Do not echo arbitrary API responses or tokens into logs/UI.
      const reason = response.status === 401 ? 'Token hết hạn hoặc không hợp lệ; kết nối lại X.'
        : response.status === 403 ? 'Thiếu quyền API, quyền đăng bài hoặc quyền media.write.'
        : response.status === 402 ? 'Tài khoản API chưa đủ tín dụng.'
        : response.status === 429 ? 'Đã chạm giới hạn API; hãy thử lại sau.' : 'X từ chối yêu cầu.';
      throw new Error(`X API (${response.status}): ${reason}`);
    }
    return result;
  }
  async function upload(file, onProgress) {
    const type = TYPES[path.extname(file).toLowerCase()];
    if (!type) throw new Error('X hỗ trợ JPG, PNG, WebP hoặc video MP4 trong công cụ này.');
    const stat = fs.statSync(file);
    if (!stat.isFile() || !stat.size) throw new Error('File media X rỗng hoặc không hợp lệ.');
    if (type.startsWith('image/') && stat.size > 5 * 1024 * 1024) throw new Error('Ảnh X vượt 5 MB.');
    const size = 4 * 1024 * 1024;
    if (Math.ceil(stat.size / size) > 1000) throw new Error('Video quá lớn cho lượt tải X này.');
    const initialized = await request('/media/upload/initialize', { method: 'POST', json: {
      media_type: type, total_bytes: stat.size, media_category: type.startsWith('video/') ? 'tweet_video' : 'tweet_image'
    } });
    const id = initialized.data?.id;
    if (typeof id !== 'string' || !/^\d+$/.test(id)) throw new Error('X chưa xác nhận mã media.');
    const handle = await fs.promises.open(file, 'r');
    try {
      for (let offset = 0, index = 0; offset < stat.size; index++) {
        const buffer = Buffer.alloc(Math.min(size, stat.size - offset));
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset);
        if (!bytesRead) throw new Error('File media thay đổi trong khi tải lên X.');
        const form = new FormData();
        form.set('segment_index', String(index));
        form.set('media', new Blob([buffer.subarray(0, bytesRead)], { type }), path.basename(file));
        await request(`/media/upload/${id}/append`, { method: 'POST', body: form });
        offset += bytesRead;
        onProgress(`Đang tải media lên X: ${Math.round(offset / stat.size * 100)}%`);
      }
    } finally { await handle.close(); }
    let result = await request(`/media/upload/${id}/finalize`, { method: 'POST' });
    if (!result.data) throw new Error('X chưa xác nhận tải media hoàn tất.');
    const deadline = Date.now() + 10 * 60 * 1000;
    for (let attempt = 0; result.data?.processing_info; attempt++) {
      const info = result.data.processing_info;
      if (info.state === 'succeeded') break;
      if (info.state === 'failed') throw new Error('X không xử lý được media; chưa đăng bài.');
      if (!['pending', 'in_progress'].includes(info.state) || Date.now() >= deadline || attempt >= 120) {
        throw new Error('X chưa xử lý xong media; chưa đăng bài.');
      }
      onProgress('X đang xử lý media…');
      await sleep(Math.min(30, Math.max(1, Number(info.check_after_secs) || 1)) * 1000);
      result = await request(`/media/upload?command=STATUS&media_id=${id}`);
      if (!result.data?.processing_info) throw new Error('X chưa xác nhận media đã xử lý xong.');
    }
    return id;
  }
  return {
    async verify() {
      const result = await request('/users/me');
      if (!result.data?.id || !result.data?.username) throw new Error('Không xác minh được tài khoản X.');
      return result.data;
    },
    async post({ imagePaths, caption, onProgress = () => {} }) {
      const text = prepareXCaption(caption);
      if (!Array.isArray(imagePaths) || !imagePaths.length || imagePaths.length > 4) throw new Error('X cần 1 video hoặc tối đa 4 ảnh. Chọn dựng Reel khi bộ ảnh nhiều hơn 4 ảnh.');
      if (imagePaths.some(file => typeof file !== 'string' || !fs.existsSync(file) || !TYPES[path.extname(file).toLowerCase()])) throw new Error('Không tìm thấy file media hợp lệ để đăng X.');
      if (imagePaths.some(file => /\.mp4$/i.test(file)) && imagePaths.length !== 1) throw new Error('Chỉ gửi một video cho mỗi bài X.');
      const ids = [];
      for (const file of imagePaths) ids.push(await upload(file, onProgress));
      onProgress('Đang đăng bài lên X…');
      // Submit once. An ambiguous response must never trigger an automatic retry.
      const result = await request('/tweets', { method: 'POST', json: { text, media: { media_ids: ids } } });
      if (typeof result.data?.id !== 'string' || !/^\d+$/.test(result.data.id)) throw new Error('Chưa xác nhận đăng X thành công. Kiểm tra tài khoản trước khi thử lại để tránh đăng trùng.');
      return { success: true, postId: result.data.id, postUrl: `https://x.com/i/status/${result.data.id}`, message: 'Đã đăng lên X.' };
    }
  };
}

export async function connectX(accessToken) {
  const user = await createXClient({ accessToken }).verify();
  fs.writeFileSync(AUTH_FILE, JSON.stringify({ accessToken, username: user.username, userId: user.id }), { mode: 0o600 });
  return { success: true, loggedIn: true, username: user.username };
}

export async function postToX(options) {
  const saved = await xOAuth.credentials();
  try { return await createXClient(saved).post(options); }
  catch (error) {
    if (/401/.test(error.message) && credentials().accessToken === saved.accessToken) {
      try { fs.unlinkSync(AUTH_FILE); } catch {}
    }
    throw error;
  }
}
