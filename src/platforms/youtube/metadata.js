// Editorial target, not a YouTube ranking threshold. Keep hashtags out of the headline.
export const YOUTUBE_TITLE_TARGET = 50;

export function cleanYouTubeText(value) {
  return String(value ?? '').toWellFormed().replace(/[<>\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
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

export function buildYouTubeMetadata(caption, { description = '', language = 'en', callToAction = '' } = {}) {
  const text = cleanYouTubeText(caption);
  const seen = new Set();
  const tags = (text.match(/#[\p{L}\p{N}_]+/gu) || []).filter(tag => {
    const key = tag.toLowerCase();
    if (seen.has(key) || tag.length > 40) return false;
    seen.add(key);
    return true;
  }).slice(0, 3);
  const lines = text.replace(/#[\p{L}\p{N}_]+/gu, '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const hashtags = tags.length ? `\n\n${tags.join(' ')}` : '';
  const heading = lines[0] || (language === 'vi' ? 'Khoảnh khắc đáng nhớ' : 'A memorable moment');
  const title = shortHeading(heading);
  const details = cleanYouTubeText(description).replace(/#[\p{L}\p{N}_]+/gu, '').trim();
  const fallback = language === 'vi'
    ? `Video ngắn ghi lại: ${heading}.`
    : `A short video featuring: ${heading}.`;
  const body = details && details !== heading ? details : lines.slice(1).join('\n') || fallback;
  const suffix = [callToAction, hashtags.trim()].filter(Boolean).join('\n\n');
  const ending = suffix ? '\n\n' + suffix : '';
  const budget = 5000 - Buffer.byteLength(ending, 'utf8');
  const shortened = truncateYouTubeBytes(body, budget);
  return { youtubeTitle: title, youtubeDescription: shortened.trimEnd() + ending };
}
