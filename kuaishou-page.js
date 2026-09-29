const MOBILE_USER_AGENT = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36';

export function parseInitState(html) {
  const match = html.match(/window\.INIT_STATE\s*=\s*(\{[\s\S]*?\})\s*;?\s*<\/script>/i);
  if (!match) return null;
  try { return JSON.parse(match[1]); }
  catch { return null; }
}

export function findPhotoData(state) {
  if (!state || typeof state !== 'object') return null;
  if (state.photo && typeof state.photo === 'object' && state.photo.photoId) return state;
  for (const value of Object.values(state)) {
    const found = findPhotoData(value);
    if (found) return found;
  }
  return null;
}

function photoIdFromUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.searchParams.get('photoId') || parsed.pathname.match(/\/(?:short-video|fw\/photo)\/([^/?#]+)/)?.[1] || null;
  } catch { return null; }
}

export async function getPostPage(shareUrl, fetchImpl = fetch) {
  const headers = {
    'User-Agent': MOBILE_USER_AGENT,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
  };
  const request = async url => {
    const response = await fetchImpl(url, { method: 'GET', redirect: 'follow', headers });
    if (!response.ok) throw new Error(`Kuaishou trả về HTTP ${response.status}`);
    const html = await response.text();
    return { finalUrl: response.url, html, initState: parseInitState(html) };
  };

  const first = await request(shareUrl);
  if (findPhotoData(first.initState)) return first;

  const photoId = photoIdFromUrl(first.finalUrl) || photoIdFromUrl(shareUrl);
  if (!photoId) return first;
  const mobileUrl = `https://m.kuaishou.com/fw/photo/${encodeURIComponent(photoId)}`;
  if (first.finalUrl === mobileUrl) return first;
  return request(mobileUrl);
}
