import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { QUEUE_DIR } from '../../paths.js';

// Up to eight demand-driven windows per UTC day; empty windows stay empty.
// A broad EU/US experiment, not an anti-spam or recommendation guarantee.
export const YOUTUBE_UTC_HOURS = [1, 4, 7, 10, 13, 16, 19, 22];
export function nextYouTubeSlot(now, reservations = []) {
  const earliest = now + 60 * 60 * 1000; // Upload/processing lead time.
  const last = Math.max(0, ...reservations.map(item => Date.parse(item.publishAt)));
  if (!Number.isFinite(last)) throw new Error('Lịch YouTube bị lỗi; cần kiểm tra trước khi xếp lịch');
  const start = new Date(Math.max(earliest, last));
  for (let day = 0; day < 370; day++) {
    for (const hour of YOUTUBE_UTC_HOURS) {
      const candidate = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate() + day, hour);
      // Also protect spacing when upgrading from the previous four-slot schedule.
      if (candidate >= earliest && candidate >= last + 2 * 60 * 60 * 1000) return new Date(candidate).toISOString();
    }
  }
  throw new Error('Không tìm được lịch YouTube phù hợp');
}

export function reserveYouTubeSlot({ statePath = path.join(QUEUE_DIR, 'youtube-schedule.json'), now = Date.now() } = {}) {
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  const lock = `${statePath}.lock`;
  const fd = fs.openSync(lock, 'wx');
  try {
    const entries = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, 'utf8')).entries : [];
    if (!Array.isArray(entries)) throw new Error('Lịch YouTube không hợp lệ');
    const reservation = { id: randomUUID(), publishAt: nextYouTubeSlot(now, entries), reservedAt: new Date(now).toISOString() };
    // Retain uncertain reservations after upload failures, rather than risk two videos sharing a slot.
    const retained = entries.filter(item => Date.parse(item.publishAt) > now - 86400000);
    fs.writeFileSync(`${statePath}.tmp`, JSON.stringify({ utcHours: YOUTUBE_UTC_HOURS, entries: [...retained, reservation] }, null, 2));
    fs.renameSync(`${statePath}.tmp`, statePath);
    return reservation;
  } finally {
    fs.closeSync(fd);
    fs.unlinkSync(lock);
  }
}

export function scheduledYouTubeStatus(publishAt) {
  if (!(Date.parse(publishAt) > Date.now())) throw new Error('Giờ công khai YouTube phải ở tương lai');
  return { privacyStatus: 'private', publishAt, selfDeclaredMadeForKids: false };
}
