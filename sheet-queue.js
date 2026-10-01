import fs from 'node:fs';
import path from 'node:path';

export const SHEET_URL = 'https://docs.google.com/spreadsheets/d/1UFeWWg3cOwbOEwhZDftC_qUWOE_8UwX49sincJgJl2g/edit?usp=sharing';
const DEFAULT_OPTIONS = { autoPostIG: true, autoPostTikTok: true, autoPostFB: true, asReel: true, captionLang: 'en', enableMoodQuote: true };

export function rowLink(value) {
  const match = String(value || '').match(/https?:\/\/[^\s"<>]+/i);
  if (!match) return null;
  const link = match[0].replace(/[),.;]+$/, '');
  try {
    const host = new URL(link).hostname.toLowerCase();
    return ['kuaishou.com', 'v.kuaishou.com', 'www.kuaishou.com', 'm.kuaishou.com'].includes(host) ? link : null;
  } catch { return null; }
}

export function readSettings(filePath) {
  const settings = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (!Number.isInteger(settings.intervalSeconds) || settings.intervalSeconds < 5) {
    throw new Error('.setting: intervalSeconds phải là số nguyên từ 5 trở lên');
  }
  return settings;
}

export function createSheetQueue({ statePath, settingsPath, sheet, runPipeline, schedule = setTimeout }) {
  let state = { enabled: false, options: { ...DEFAULT_OPTIONS }, cursor: 1, blankCount: 0, items: {}, lastCheck: null, error: null };
  if (fs.existsSync(statePath)) {
    const saved = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    state = { ...state, ...saved, options: { ...DEFAULT_OPTIONS, ...saved.options }, items: saved.items || {} };
    if (Object.values(state.items).some(item => item.status === 'running')) {
      for (const item of Object.values(state.items)) if (item.status === 'running') {
        item.status = 'interrupted';
        item.error = 'Lần chạy trước bị ngắt. Kiểm tra bài đăng trước khi tiếp tục.';
      }
      state.enabled = false;
      state.error = 'Lần chạy trước bị ngắt; cần kiểm tra trước khi tiếp tục.';
    }
  }
  let timer = null, busy = false, started = false, nextRunAt = null;
  const save = () => {
    fs.writeFileSync(`${statePath}.tmp`, JSON.stringify(state, null, 2), 'utf8');
    fs.renameSync(`${statePath}.tmp`, statePath);
  };
  const snapshot = () => {
    let intervalSeconds = null;
    let connectionError = null;
    try {
      const settings = readSettings(settingsPath);
      intervalSeconds = settings.intervalSeconds;
      const keyPath = path.resolve(path.dirname(settingsPath), settings.serviceAccountKeyFile || 'google-service-account.json');
      if (!fs.existsSync(keyPath)) connectionError = `Thiếu file xác thực: ${path.basename(keyPath)}`;
    } catch (error) { connectionError = error.message; }
    return { ...state, intervalSeconds, connectionError, running: busy, nextRunAt, items: Object.values(state.items).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) };
  };
  const plan = () => {
    if (!started || !state.enabled) return;
    try {
      const delay = readSettings(settingsPath).intervalSeconds * 1000;
      nextRunAt = new Date(Date.now() + delay).toISOString();
      timer = schedule(() => { timer = null; nextRunAt = null; void tick().finally(plan); }, delay);
      timer?.unref?.();
    } catch (error) {
      state.error = error.message; save();
      nextRunAt = new Date(Date.now() + 60000).toISOString();
      timer = schedule(() => { timer = null; nextRunAt = null; void tick().finally(plan); }, 60000);
      timer?.unref?.();
    }
  };

  async function tick() {
    if (!state.enabled || busy) return;
    busy = true;
    try {
      const settings = readSettings(settingsPath);
      const cells = await sheet.readColumn(settings);
      state.lastCheck = new Date().toISOString();
      state.error = null;
      let row = state.cursor;
      let raw = String(cells[row - 1] || '').trim();
      const previous = state.items[String(row)];
      if (!raw && ['awaiting_clear', 'failed_awaiting_clear'].includes(previous?.status)) {
        previous.status = previous.status === 'failed_awaiting_clear' ? 'failed' : 'done';
        previous.updatedAt = state.lastCheck;
        state.cursor++; state.blankCount = 0; save(); return;
      }
      while (!raw) {
        state.cursor++;
        if (state.cursor > cells.length) {
          state.cursor = 1;
          state.enabled = false;
          state.items = {};
          state.error = 'Cột A chưa còn link để xử lý; đã tự động dừng.';
          save(); return;
        }
        row = state.cursor;
        raw = String(cells[row - 1] || '').trim();
      }
      const url = rowLink(raw);
      const key = String(row);
      let entry = state.items[key];
      if (!entry || entry.url !== (url || raw)) entry = state.items[key] = { row, url: url || raw, status: 'pending', updatedAt: state.lastCheck };
      if (entry.status === 'interrupted') {
        state.enabled = false; state.error = entry.error; save(); return;
      }
      if (!url && !['awaiting_clear', 'failed_awaiting_clear'].includes(entry.status)) {
        entry.status = 'failed_awaiting_clear';
        entry.error = `Dòng ${row} không phải link Kuaishou`;
        entry.updatedAt = new Date().toISOString();
        state.error = entry.error;
        save();
      } else if (url && !['awaiting_clear', 'failed_awaiting_clear'].includes(entry.status)) {
        entry.status = 'running'; entry.warning = null; entry.updatedAt = new Date().toISOString(); save();
        try {
          const result = await runPipeline(url, { ...state.options });
          if (!result.success) throw new Error(result.error || 'Quy trình thất bại');
          entry.status = 'awaiting_clear'; entry.error = null;
          entry.warning = result.threadsWarning || null;
          entry.updatedAt = new Date().toISOString(); save();
        } catch (error) {
          entry.status = 'failed_awaiting_clear'; entry.error = error.message;
          entry.updatedAt = new Date().toISOString();
          state.error = `Dòng ${row}: ${entry.error}`;
          save();
        }
      }
      const finalStatus = entry.status === 'failed_awaiting_clear' ? 'failed' : 'done';
      const latestCells = await sheet.readColumn(settings);
      const latest = String(latestCells[row - 1] || '').trim();
      if (latest && latest !== raw) {
        entry.status = finalStatus;
        entry.error = [entry.error, 'Ô đã thay đổi trong lúc xử lý; giữ nguyên nội dung mới.'].filter(Boolean).join('; ');
        entry.updatedAt = new Date().toISOString();
        save();
        return;
      }
      if (!latest) {
        entry.status = finalStatus; entry.updatedAt = new Date().toISOString();
        state.cursor++; state.blankCount = 0; save(); return;
      }
      await sheet.clearCell(settings, row);
      entry.status = finalStatus; entry.updatedAt = new Date().toISOString();
      state.cursor++; state.blankCount = 0; save();
    } catch (error) { state.error = error.message; save(); }
    finally { busy = false; }
  }

  return {
    snapshot, tick,
    start() { if (!started) { started = true; plan(); } },
    stop() { started = false; if (timer) clearTimeout(timer); timer = null; nextRunAt = null; },
    configure({ enabled, options, runNow = false }) {
      const wasEnabled = state.enabled;
      const startNow = enabled === true && !wasEnabled && runNow && !busy;
      if (typeof enabled === 'boolean') {
        state.enabled = enabled;
        if (enabled && !wasEnabled && ['failed', 'interrupted'].includes(state.items[String(state.cursor)]?.status)) state.items[String(state.cursor)].status = 'pending';
        if (startNow) state.cursor = 1;
        if (enabled) { state.error = null; state.blankCount = 0; }
      }
      if (options) for (const key of Object.keys(DEFAULT_OPTIONS)) {
        if (key === 'captionLang') {
          if (['en', 'vi', 'both', 'raw'].includes(options[key])) state.options[key] = options[key];
        } else if (typeof options[key] === 'boolean') state.options[key] = options[key];
      }
      save();
      if (started && startNow) {
        if (timer) clearTimeout(timer);
        timer = null; nextRunAt = null;
        void tick().finally(plan);
      } else if (started && state.enabled && !timer && !busy) plan();
      if (!state.enabled && timer) { clearTimeout(timer); timer = null; nextRunAt = null; }
      return snapshot();
    }
  };
}
