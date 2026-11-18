import { relevantHashtags } from '../../content/relevance-tags.js';
import { resolveGeminiApiKey, callGeminiApi } from '../../content/ai-story.js';

const GENERIC_TAGS = new Set(['#moments', '#storytelling', '#sharing', '#perspective', '#creativecontent']);
const YT_FALLBACK_TAGS = ['#slowliving', '#peaceful', '#scenery', '#calm', '#aesthetic'];
const EXTRA_YT_CUES = [
  [/\b(?:new zealand|italy|japan|switzerland|norway|iceland|france|austria|scotland)\b|新西兰|意大利|日本|瑞士|挪威|冰岛/iu, ['#travel', '#scenery']],
  [/\b(?:summer|autumn|fall|winter|spring|fallen leaf|leaves)\b|夏天|秋天|落叶|冬天|春天/iu, ['#seasons', '#nature']],
  [/\b(?:town|village|countryside|county)\b|县城|小镇|乡村|古镇/iu, ['#slowliving', '#countryside']],
  [/\b(?:cloud|clouds|sky|mist|fog|light)\b|云|天空|晨雾|光影/iu, ['#sky', '#aesthetic']]
];

export function cleanYouTubeLine(input) {
  return String(input || '')
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

function shortenOnWordBoundary(text, maxChars) {
  const chars = Array.from(text);
  if (chars.length <= maxChars) return text.trim();
  const sliced = chars.slice(0, maxChars).join('');
  const trimmed = sliced.replace(/\s+\S*$/, '').replace(/[,;:\-–—\s]+$/, '').trim();
  return trimmed || sliced.trim();
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
  return [unique[0], unique[1], '#shorts', unique[2], unique[3]].filter(Boolean).join(' ');
}

// Keep a readable title with a small set of complete hashtags within 100 characters.
export function buildYouTubeMetadata(caption, { description = '', language = 'en', callToAction = '' } = {}) {
  const text = String(caption || '');
  const tags = [...new Set(text.match(/#[\p{L}\p{N}_]+/gu) || [])].slice(0, 3);
  const lines = text.replace(/#[\p{L}\p{N}_]+/gu, '').split(/\r?\n/).map(cleanYouTubeLine).filter(Boolean);
  // Drop overly long tags rather than cutting a hashtag in half.
  while (tags.join(' ').length > 50) tags.pop();
  const hashtags = tags.length ? ` ${tags.join(' ')}` : '';
  const heading = lines[0] || (language === 'vi' ? 'Khoảnh khắc đáng nhớ' : 'A peaceful moment');
  const title = shortenOnWordBoundary(heading, Math.max(20, 100 - hashtags.length)) + hashtags;
  const details = cleanYouTubeLine(String(description).replace(/#[\p{L}\p{N}_]+/gu, ''));
  const fallback = language === 'vi'
    ? `Video ngắn ghi lại: ${heading}.`
    : `A quiet moment captured on camera: ${heading}.`;
  const body = details && details !== heading ? details : lines.slice(1).join('\n') || fallback;
  // Description hashtags appear above the title on YouTube; the follow line comes before them.
  const allTagList = [...new Set(text.match(/#[\p{L}\p{N}_]+/gu) || [])].slice(0, 5);
  const allTags = allTagList.join(' ');
  const youtubeTags = [...new Set(allTagList.map(t => t.slice(1).toLowerCase()))];
  return {
    youtubeTitle: title,
    youtubeDescription: [body, callToAction, allTags].filter(Boolean).join('\n\n').slice(0, 5000),
    youtubeTags
  };
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
Return ONLY JSON: {"title": "<natural, evocative English hook under 56 chars, no quotes, no hashtags, no clickbait>", "description": "<1-2 warm sentences plus 1 short gentle question inviting viewers to share in comments, no hashtags>"}`;
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
