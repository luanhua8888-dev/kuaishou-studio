import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { QUEUE_DIR } from '../../paths.js';

export const YOUTUBE_UPLOAD_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const MAX_UPLOAD_MS = 30 * 60 * 1000;
const limitedBeforeUpload = error => error?.uploadNotStarted === true && error?.reasons?.includes('uploadLimitExceeded');

export function createYouTubeUploadQueue({
  post, accountKey, directory = path.join(QUEUE_DIR, 'youtube-uploads'), now = Date.now,
  report = message => console.log(`[YouTube queue] ${message}`)
}) {
  const stateFile = path.join(directory, 'state.json');
  let timer;
  let running = false;
  const read = () => {
    if (!fs.existsSync(stateFile)) return { cooldowns: {}, jobs: [] };
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    if (!Array.isArray(state.jobs) || !state.cooldowns || typeof state.cooldowns !== 'object') throw new Error('Hàng chờ YouTube không hợp lệ; giữ nguyên file để kiểm tra.');
    return state;
  };
  // Short synchronous transactions are shared safely by multiple server ports.
  function transaction(change) {
    fs.mkdirSync(directory, { recursive: true });
    const lock = `${stateFile}.lock`;
    let fd;
    try { fd = fs.openSync(lock, 'wx'); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const owner = JSON.parse(fs.readFileSync(lock, 'utf8'));
      if (!Number.isInteger(owner.pid) || owner.pid <= 0) throw error;
      try { process.kill(owner.pid, 0); throw error; }
      catch (check) { if (check.code !== 'ESRCH') throw error; }
      // Recover only a transaction lock whose owning process is known to be gone.
      fs.unlinkSync(lock);
      fd = fs.openSync(lock, 'wx');
    }
    try {
      fs.writeFileSync(fd, JSON.stringify({ pid: process.pid }));
      const state = read();
      const result = change(state);
      fs.writeFileSync(`${stateFile}.tmp`, JSON.stringify(state, null, 2));
      fs.renameSync(`${stateFile}.tmp`, stateFile);
      return result;
    } finally {
      fs.closeSync(fd);
      fs.unlinkSync(lock);
    }
  }

  function queuedResult(job) {
    return {
      success: false, queued: true, queueId: job.id, retryAt: job.retryAt,
      message: `Đã lưu video vào hàng chờ trên máy. Thử tải lại từ ${new Date(job.retryAt).toLocaleString('vi-VN', { timeZone: 'Asia/Bangkok' })} (UTC+7); chưa tải lên hoặc lên lịch trên YouTube. Cần mở app để tiếp tục.`
    };
  }

  async function fingerprint(input, key) {
    const hash = createHash('sha256').update(JSON.stringify([key, input.title, input.description, input.publishMode ?? 'scheduled']));
    for await (const chunk of fs.createReadStream(input.videoPath)) hash.update(chunk);
    return hash.digest('hex');
  }

  async function enqueue(input, key, hash, resetCooldown) {
    return transaction(state => {
      if (resetCooldown) state.cooldowns[key] = now() + YOUTUBE_UPLOAD_COOLDOWN_MS;
      const existing = state.jobs.find(job => job.accountKey === key && job.hash === hash);
      if (existing) {
        if (existing.status === 'done') return existing.result;
        if (['failed', 'uncertain'].includes(existing.status)) throw new Error(existing.error || 'Video cần kiểm tra thủ công.');
        return queuedResult(existing);
      }
      const id = randomUUID();
      const videoPath = path.join(directory, `${id}.mp4`);
      // A dedicated immutable copy survives the pipeline's download cleanup.
      fs.copyFileSync(input.videoPath, videoPath, fs.constants.COPYFILE_EXCL);
      const job = {
        id, hash, accountKey: key, videoPath, title: input.title, description: input.description, tags: input.tags,
        publishMode: input.publishMode ?? 'scheduled', status: 'pending', createdAt: now(),
        retryAt: Math.max(now(), state.cooldowns[key] || 0), attempts: 0
      };
      state.jobs.push(job);
      // Persisted by transaction before the caller can report acceptance.
      return queuedResult(job);
    });
  }

  async function publish(input) {
    const key = accountKey();
    if (!key) throw new Error('Chưa kết nối YouTube. Kết nối lại trước khi tải hoặc xếp hàng chờ.');
    const hash = await fingerprint(input, key);
    const state = read();
    const existing = state.jobs.find(job => job.accountKey === key && job.hash === hash);
    if (existing) {
      if (existing.status === 'done') return existing.result;
      if (['failed', 'uncertain'].includes(existing.status)) throw new Error(existing.error || 'Video trong hàng chờ cần kiểm tra thủ công trước khi đăng lại.');
      return queuedResult(existing);
    }
    if ((state.cooldowns[key] || 0) > now()) return enqueue(input, key, hash, false);
    if (accountKey() !== key) throw new Error('Kết nối YouTube đã thay đổi; hãy kiểm tra lại kênh trước khi đăng.');
    try { return await post(input); }
    catch (error) {
      if (!limitedBeforeUpload(error)) throw error;
      const result = await enqueue(input, key, hash, true);
      input.onProgress?.(result.message);
      return result;
    }
  }

  async function tick({ force = false } = {}) {
    if (running) return;
    running = true;
    let job;
    try {
      const key = accountKey();
      if (!key) return;
      job = transaction(state => {
        for (const entry of state.jobs) {
          if (entry.status === 'uploading' && now() - entry.startedAt >= MAX_UPLOAD_MS) {
            entry.status = 'uncertain';
            entry.error = 'Lượt tải trước bị gián đoạn. Kiểm tra YouTube Studio; không tự đăng lại để tránh trùng video.';
          }
        }
        if ((!force && (state.cooldowns[key] || 0) > now()) || state.jobs.some(entry => entry.accountKey === key && entry.status === 'uploading')) return null;
        const entry = state.jobs.find(entry => entry.accountKey === key && entry.status === 'pending' && (force || entry.retryAt <= now()));
        if (!entry) return null;
        entry.status = 'uploading';
        entry.startedAt = now();
        entry.attempts++;
        return { ...entry };
      });
      if (!job) return;
      // A persisted claim precedes the network call; a crash never causes blind replay.
      let result;
      let failure;
      try {
        if (accountKey() !== job.accountKey) throw new Error('Kết nối YouTube đã thay đổi; không tải lên kênh khác.');
        result = await post({ videoPath: job.videoPath, title: job.title, description: job.description, tags: job.tags, publishMode: job.publishMode });
        if (!result?.success) throw new Error('YouTube chưa xác nhận tải video thành công.');
      } catch (error) { failure = error; }
      transaction(state => {
        const entry = state.jobs.find(entry => entry.id === job.id);
        if (!failure) {
          entry.status = 'done'; entry.result = result; entry.completedAt = now();
          delete state.cooldowns[job.accountKey];
        } else if (limitedBeforeUpload(failure)) {
          state.cooldowns[job.accountKey] = now() + YOUTUBE_UPLOAD_COOLDOWN_MS;
          entry.status = 'pending'; entry.retryAt = state.cooldowns[job.accountKey]; entry.error = failure.message;
        } else {
          entry.status = failure.uploadNotStarted ? 'failed' : 'uncertain';
          entry.error = failure.message;
        }
      });
      // Delete ONLY our owned copy, and only after recording confirmed success.
      if (!failure && path.dirname(path.resolve(job.videoPath)) === path.resolve(directory)
        && path.resolve(job.videoPath) === path.resolve(directory, `${job.id}.mp4`)) {
        fs.rmSync(job.videoPath, { force: true });
      }
      report(!failure ? `Đã tải video ${job.id}: ${result.url}` : `Video ${job.id}: ${failure.message}`);
    } catch (error) {
      // On a persistence failure leave the upload claim intact, not pending.
      report(`Không xử lý được hàng chờ: ${error.message}`);
    } finally { running = false; }
  }

  function status() {
    const key = accountKey();
    const state = read();
    const jobs = state.jobs.filter(job => job.accountKey === key);
    return {
      cooldownUntil: (state.cooldowns[key] || 0) > now() ? state.cooldowns[key] : null,
      pending: jobs.filter(job => job.status === 'pending').length,
      uploading: jobs.filter(job => job.status === 'uploading').length,
      attention: jobs.filter(job => ['failed', 'uncertain'].includes(job.status)).length,
      otherAccountPending: state.jobs.filter(job => job.accountKey !== key && ['pending', 'uploading'].includes(job.status)).length,
      jobs: jobs.map(({ id, title, status, retryAt, error, result }) => ({ id, title, status, retryAt, error, url: result?.url })).slice(-50)
    };
  }

  return {
    publish, tick, status,
    async deferAfterLimit(input, error) {
      if (!limitedBeforeUpload(error)) throw new Error('Chỉ xếp hàng tự động khi YouTube xác nhận chặn giới hạn trước khi tải.');
      const key = accountKey();
      if (!key) throw new Error('Chưa kết nối YouTube.');
      return enqueue(input, key, await fingerprint(input, key), true);
    },
    start() { if (!timer) { timer = setInterval(() => { void tick(); }, 60_000); timer.unref(); void tick(); } },
    stop() { clearInterval(timer); timer = null; }
  };
}
