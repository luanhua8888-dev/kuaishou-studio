import fs from 'node:fs';
import { SETTINGS_FILE } from '../paths.js';

// A short, honest follow invitation appended to generated captions and descriptions.
const DEFAULTS = {
  tiktok: { vi: 'Follow để xem thêm những khoảnh khắc như thế này mỗi ngày.', en: 'Follow for more moments like this every day.' },
  instagram: { vi: 'Theo dõi để xem thêm những khoảnh khắc như thế này mỗi ngày.', en: 'Follow for more moments like this every day.' },
  youtube: { vi: 'Đăng ký kênh để xem thêm những khoảnh khắc như thế này mỗi ngày.', en: 'Subscribe for more moments like this every day.' },
};

/**
 * Settings (config/settings.json): "callToAction": false turns it off;
 * an object such as { "youtube": { "en": "..." } } replaces the default text for a platform/language.
 */
export function callToAction(platform, lang = 'vi', settingsPath = SETTINGS_FILE) {
  let custom;
  try { custom = fs.existsSync(settingsPath) ? JSON.parse(fs.readFileSync(settingsPath, 'utf8')).callToAction : undefined; } catch {}
  if (custom === false) return '';
  const language = lang === 'en' ? 'en' : 'vi';
  const override = custom && typeof custom === 'object' ? custom[platform]?.[language] : undefined;
  return typeof override === 'string' ? override.trim() : DEFAULTS[platform]?.[language] || '';
}

/** Insert the invitation between the caption body and its hashtag line, once. */
export function withCallToAction(caption, cta) {
  const text = String(caption || '').trim();
  if (!cta || text.includes(cta)) return text;
  const match = text.match(/\n\n((?:#[\p{L}\p{N}_]+\s*)+)$/u);
  if (!match) return [text, cta].filter(Boolean).join('\n\n');
  return `${text.slice(0, match.index).trim()}\n\n${cta}\n\n${match[1].trim()}`;
}
