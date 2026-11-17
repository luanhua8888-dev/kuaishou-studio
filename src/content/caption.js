import { normalizeCaptionText, removeCaptionMentions } from './caption-text.js';
import { relevantHashtags } from './relevance-tags.js';

/**
 * Clean text to pure words only (strictly NO emojis, icons, gifs, decorative symbols)
 */
export function cleanPureText(str) {
  if (!str) return '';
  return normalizeCaptionText(str)
    .replace(/[\p{Extended_Pictographic}\p{Emoji_Presentation}\uFE0F]/gu, '')
    .replace(/#[\w\u4e00-\u9fa5]+/g, '')
    .replace(/https?:\/\/[^\s]+/g, '')
    .replace(/BGM:.*$/i, '')
    .replace(/[-_—=~*•★☆✦✧▲▼►◄\/\\]{2,}/g, ' ')
    .replace(/^[“"']+|[”"']+$/g, '')
    .replace(/[\r\n\t]+/g, ' ')
    .trim();
}

/**
 * Helper to translate text using free Google Translate API endpoint
 */
export async function translateText(text, targetLang = 'vi', strict = false) {
  text = normalizeCaptionText(text);
  if (!text) return '';
  try {
    const res = await fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${targetLang}&dt=t&q=${encodeURIComponent(text)}`, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error('Translation request failed');
    const data = await res.json();
    if (Array.isArray(data) && Array.isArray(data[0])) {
      const translated = normalizeCaptionText(data[0].map(s => s[0] || '').join(''));
      if (translated) return translated;
    }
  } catch {}
  if (strict) throw new Error('Không dịch được nội dung YouTube sang tiếng Anh; chưa đăng, hãy thử lại.');
  return text;
}

/**
 * Generate viral Instagram caption and targeted hashtags in Vietnamese, English or Bilingual
 */
export async function generateCaptionAndHashtags(rawTitle, author, musicName = null, musicArtist = null, musicUrl = null, lang = 'en') {
  let cleanTitle = removeCaptionMentions(normalizeCaptionText(rawTitle)).replace(/\r\n|\r|\n/g, ' ').trim();
  cleanTitle = cleanTitle.replace(/#[\p{L}\p{N}_]+/gu, '').replace(/\s+/g, ' ').trim();

  let titleLine = cleanTitle || (lang === 'en' ? 'Peaceful moments' : 'Khoảnh khắc bình yên');
  if (cleanTitle) {
    if (lang === 'vi') {
      const vi = await translateText(cleanTitle, 'vi');
      titleLine = vi || 'Khoảnh khắc bình yên';
    } else if (lang === 'en') {
      const en = await translateText(cleanTitle, 'en');
      titleLine = en || 'Peaceful moments';
    } else if (lang === 'both') {
      const [vi, en] = await Promise.all([translateText(cleanTitle, 'vi'), translateText(cleanTitle, 'en')]);
      if (vi && en && vi !== en) {
        titleLine = `${vi}\n   "${en}"`;
      } else {
        titleLine = vi || en || 'Peaceful moments';
      }
    }
  }

  let caption = `${titleLine}\n\n`;

  const hashtags = relevantHashtags(`${removeCaptionMentions(rawTitle)} ${titleLine}`, lang);
  const fullText = hashtags ? `${caption}${hashtags}` : caption.trim();

  // Tạo câu chữ tâm trạng tiếng Việt chuẩn (chỉ chữ thuần túy, không icon/emoji/gif) dành riêng cho video TikTok
  let moodQuoteVi = '';
  if (cleanTitle) {
    const vi = await translateText(cleanTitle, 'vi');
    moodQuoteVi = cleanPureText(vi || cleanTitle);
  }
  if (!moodQuoteVi || /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(moodQuoteVi)) {
    moodQuoteVi = 'Khoảnh khắc bình yên';
  }

  return {
    caption,
    hashtags,
    fullText,
    moodQuoteVi,
    moodQuote: moodQuoteVi
  };
}
