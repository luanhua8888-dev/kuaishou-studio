import { removeCaptionMentions } from './caption-text.js';
import { ensureCaptionHashtags } from './relevance-tags.js';

const TAG = /#[\p{L}\p{N}_]+/gu;
const PROMPTS = [
  { pattern: /#(?:cat|dog|pets|meo|cho|thucung)\b/u, vi: 'Khoảnh khắc nào của thú cưng khiến bạn bật cười?', en: 'What does your pet do that always makes you smile?' },
  { pattern: /#(?:food|cooking|amthuc|nauan)\b/u, vi: 'Bạn sẽ thử món này chứ?', en: 'Would you try this?' },
  { pattern: /#(?:nature|landscape|garden|travel|scenery|goldenhour|thiennhien|phongcanh|vuonhoa|dulich|hoanghon)\b/u, vi: 'Bạn muốn ngồi lại ở đây cùng ai?', en: 'Who would you share this moment with?' },
  { pattern: /#(?:music|amnhac)\b/u, vi: 'Bài hát nào hợp với khoảnh khắc này?', en: 'Which song would you pair with this moment?' },
  { pattern: /#(?:reading|docsach)\b/u, vi: 'Bạn đang đọc cuốn sách nào?', en: 'What are you reading lately?' },
  { pattern: /#(?:rainydays|ngaymua|quietmoments|mood|binhyen|tamtrang|feelings|love|tinhyeu)\b/u, vi: 'Khoảnh khắc này gợi bạn nhớ điều gì?', en: 'What does this moment remind you of?' }
];

// Keep the useful tags even when a translated/bilingual caption is too long.
export function buildThreadsCaption(value, lang = 'en', { prompt = true } = {}) {
  const clean = ensureCaptionHashtags(removeCaptionMentions(value), lang);
  const tags = clean.match(TAG) || [];
  let body = clean.replace(TAG, '').replace(/\n{3,}/g, '\n\n').trim();
  const question = PROMPTS.find(item => item.pattern.test(tags.join(' ')));
  const invitation = prompt && question && !/[?？]/u.test(body) ? question[lang === 'en' ? 'en' : 'vi'] : '';
  const tail = [invitation, tags.join(' ')].filter(Boolean).join('\n\n');
  const available = 500 - [...tail].length - (tail && body ? 2 : 0);
  if ([...body].length > available) body = [...body].slice(0, Math.max(0, available - 1)).join('').trimEnd() + '…';
  return [body, tail].filter(Boolean).join('\n\n');
}

export function threadsTopic(value) {
  const tag = String(value).match(TAG)?.[0]?.slice(1);
  const aliases = { thiennhien: 'nature', phongcanh: 'landscape', vuonhoa: 'garden', dulich: 'travel', amnhac: 'music', docsach: 'reading', meo: 'cat', cho: 'dog', thucung: 'pets', binhyen: 'quiet moments', tamtrang: 'mood', tinhyeu: 'love', doithuong: 'daily life', amthuc: 'food', nauan: 'cooking' };
  return aliases[tag] || tag?.replace(/_/g, ' ') || null;
}
