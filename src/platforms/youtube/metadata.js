// Keep a readable title with a small set of complete hashtags within 100 characters.
export function buildYouTubeMetadata(caption, { description = '', language = 'en', callToAction = '' } = {}) {
  const text = String(caption || '');
  const tags = [...new Set(text.match(/#[\p{L}\p{N}_]+/gu) || [])].slice(0, 3);
  const lines = text.replace(/#[\p{L}\p{N}_]+/gu, '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  // Drop overly long tags rather than cutting a hashtag in half.
  while (tags.join(' ').length > 50) tags.pop();
  const hashtags = tags.length ? ` ${tags.join(' ')}` : '';
  const heading = lines[0] || (language === 'vi' ? 'Khoảnh khắc đáng nhớ' : 'A memorable moment');
  const title = Array.from(heading).slice(0, 100 - hashtags.length).join('').trim() + hashtags;
  const details = String(description).replace(/#[\p{L}\p{N}_]+/gu, '').trim();
  const fallback = language === 'vi'
    ? `Video ngắn ghi lại: ${heading}.`
    : `A short video featuring: ${heading}.`;
  const body = details && details !== heading ? details : lines.slice(1).join('\n') || fallback;
  // Description hashtags appear above the title on YouTube; the follow line comes before them.
  const allTags = [...new Set(text.match(/#[\p{L}\p{N}_]+/gu) || [])].slice(0, 5).join(' ');
  return { youtubeTitle: title, youtubeDescription: [body, callToAction, allTags].filter(Boolean).join('\n\n').slice(0, 5000) };
}
