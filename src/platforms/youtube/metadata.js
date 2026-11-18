import { relevantHashtags } from '../../content/relevance-tags.js';
import { resolveGeminiApiKey, callGeminiApi } from '../../content/ai-story.js';

// Editorial target, not a YouTube ranking threshold. Keep hashtags out of the headline.
export const YOUTUBE_TITLE_TARGET = 50;

const GENERIC_TAGS = new Set(['#moments', '#storytelling', '#sharing', '#perspective', '#creativecontent']);
const YT_FALLBACK_TAGS = ['#slowliving', '#peaceful', '#scenery', '#calm', '#aesthetic'];
const EXTRA_YT_CUES = [
  [/\b(?:new zealand|italy|japan|switzerland|norway|iceland|france|austria|scotland)\b|新西兰|意大利|日本|瑞士|挪威|冰岛/iu, ['#travel', '#scenery']],
  [/\b(?:summer|autumn|fall|winter|spring|fallen leaf|leaves)\b|夏天|秋天|落叶|冬天|春天/iu, ['#seasons', '#nature']],
  [/\b(?:town|village|countryside|county)\b|县城|小镇|乡村|古镇/iu, ['#slowliving', '#countryside']],
  [/\b(?:cloud|clouds|sky|mist|fog|light)\b|云|天空|晨雾|光影/iu, ['#sky', '#aesthetic']]
];

export function cleanYouTubeText(value) {
  return String(value ?? '').toWellFormed().replace(/[<>\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
}

export function cleanYouTubeLine(input) {
  return cleanYouTubeText(input)
    .replace(/^(?:shot on\s+)?(?:honor|xiaomi|redmi|vivo|oppo|huawei|iphone|samsung|oneplus|sony|leica|canon|nikon|fujifilm)[^|｜\n]{0,35}[|｜]\s*/iu, '')
    .replace(/the country of tourism\s*(?:—|-|_)+\s*([\p{L}\s]+)/iu, (_, place) => `Exploring ${place.trim()}`)
    .replace(/[—–]{2,}/g, ' - ')
    .replace(/[，、]/g, ', ')
    .replace(/。/g, '. ')
    .replace(/！/g, '! ')
    .replace(/？/g, '? ')
    .replace(/[“”「」『』"]/g, '')
    .replace(/\bsmall county town\b/gi, 'quiet small town')
    .replace(/\bsmall county\b/gi, 'quiet small town')
    .replace(/\bcounty town\b/gi, 'small town')
    .replace(/^[\s\-–—:;,.]+|[\s\-–—:;]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function truncateYouTubeBytes(value, budget = 5000) {
  let text = '';
  let bytes = 0;
  for (const character of value) {
    bytes += Buffer.byteLength(character, 'utf8');
    if (bytes > budget) break;
    text += character;
  }
  return text;
}

function shortHeading(text) {
  if (text.length <= YOUTUBE_TITLE_TARGET) return text;
  let prefix = '';
  for (const character of text) {
    if (prefix.length + character.length > YOUTUBE_TITLE_TARGET - 1) break;
    prefix += character;
  }
  const boundary = prefix.lastIndexOf(' ');
  if (!/\s$/u.test(prefix) && !/\s/u.test(text[prefix.length] || '') && boundary >= YOUTUBE_TITLE_TARGET / 2) prefix = prefix.slice(0, boundary);
  return prefix.trimEnd().replace(/[,;:\-–—]+$/u, '').trimEnd() + '…';
}

export function youtubeHashtags(context = '') {
  const text = String(context || '');
  const cueTags = EXTRA_YT_CUES.filter(([re]) => re.test(text)).flatMap(([, tags]) => tags);
  const baseTags = relevantHashtags(text, 'en').split(/\s+/).filter(tag => tag && !GENERIC_TAGS.has(tag.toLowerCase()));
  const unique = [];
  const seen = new Set(['#shorts']);
  for (const tag of [...cueTags, ...baseTags, ...YT_FALLBACK_TAGS]) {
    const lower = tag.toLowerCase();
    if (!seen.has(lower)) {
      seen.add(lower);
      unique.push(tag);
    }
  }
  return ['#shorts', unique[0], unique[1]].filter(Boolean).join(' ');
}

export function buildYouTubeMetadata(caption, { description = '', language = 'en', callToAction = '' } = {}) {
  const text = cleanYouTubeText(caption);
  const seen = new Set();
  const tags = (text.match(/#[\p{L}\p{N}_]+/gu) || []).filter(tag => {
    const key = tag.toLowerCase();
    if (seen.has(key) || tag.length > 40) return false;
    seen.add(key);
    return true;
  }).slice(0, 3);
  const lines = text.replace(/#[\p{L}\p{N}_]+/gu, '').split(/\r?\n/).map(cleanYouTubeLine).filter(Boolean);
  const hashtags = tags.length ? `\n\n${tags.join(' ')}` : '';
  const heading = lines[0] || (language === 'vi' ? 'Khoảnh khắc đáng nhớ' : 'A peaceful moment');
  const title = shortHeading(heading);
  const details = cleanYouTubeLine(cleanYouTubeText(description).replace(/#[\p{L}\p{N}_]+/gu, ''));
  const fallback = language === 'vi'
    ? `Video ngắn ghi lại: ${heading}.`
    : `A quiet moment captured on camera: ${heading}.`;
  const body = details && details !== heading ? details : lines.slice(1).join('\n') || fallback;
  const suffix = [callToAction, hashtags.trim()].filter(Boolean).join('\n\n');
  const ending = suffix ? '\n\n' + suffix : '';
  const budget = 5000 - Buffer.byteLength(ending, 'utf8');
  const shortened = truncateYouTubeBytes(body, budget);
  const youtubeTags = [...new Set(tags.map(t => t.slice(1).toLowerCase()))];
  return { youtubeTitle: title, youtubeDescription: shortened.trimEnd() + ending, youtubeTags };
}

export async function polishYouTubeMetadata({ rawTitle = '', englishCaption = '', englishDescription = '', callToAction = '', apiKey } = {}) {
  const tags = youtubeHashtags(`${rawTitle} ${englishCaption}`);
  let heading = cleanYouTubeLine(englishCaption.split(/\r?\n/)[0] || '');
  let desc = cleanYouTubeLine(englishDescription);

  const key = resolveGeminiApiKey(apiKey);
  if (key && (rawTitle || heading)) {
    const prompt = `Write metadata for a calm, aesthetic YouTube Short (scenery / slow living / peaceful daily life).
Source caption: "${rawTitle || heading}"
Literal translation: "${heading}"
Return ONLY JSON: {"title": "<natural, evocative English hook under 48 chars, no quotes, no hashtags, no clickbait>", "description": "<1-2 warm sentences plus 1 short gentle question inviting viewers to share in comments, no hashtags>"}`;
    for (const model of ['gemini-2.5-flash', 'gemini-2.0-flash']) {
      try {
        const raw = await callGeminiApi({ prompt, apiKey: key, model, timeoutMs: 10000 });
        const parsed = JSON.parse(raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim());
        if (parsed?.title?.trim()) heading = cleanYouTubeLine(parsed.title);
        if (parsed?.description?.trim()) desc = cleanYouTubeLine(parsed.description);
        break;
      } catch {}
    }
  }

  return buildYouTubeMetadata(`${heading}\n${tags}`, { description: desc, language: 'en', callToAction });
}
