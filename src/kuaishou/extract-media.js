import { videoDownloadUrls } from '../media/download.js';

export function extractUrl(input) {
  const match = (input || '').match(/https?:\/\/[^\s]+/);
  return match ? match[0] : null;
}

export function extractMedia(postData, html = '') {
  const photo = postData.photo || {};
  const images = [];
  let videoUrl = null;

  // 1. Detect video URLs from various Kuaishou photo fields
  if (photo.mainMvUrls && Array.isArray(photo.mainMvUrls) && photo.mainMvUrls.length > 0) {
    const item = photo.mainMvUrls[0];
    videoUrl = typeof item === 'string' ? item : (item?.url || null);
  } else if (typeof photo.mainMvUrls === 'string') {
    videoUrl = photo.mainMvUrls;
  }

  if (!videoUrl && photo.srcNoMark) {
    videoUrl = photo.srcNoMark;
  }

  if (!videoUrl && photo.videoUrl) {
    videoUrl = photo.videoUrl;
  }

  if (!videoUrl && photo.playUrl) {
    videoUrl = photo.playUrl;
  }

  if (!videoUrl && Array.isArray(photo.playUrls) && photo.playUrls.length > 0) {
    const item = photo.playUrls[0];
    videoUrl = typeof item === 'string' ? item : (item?.url || null);
  }

  if (!videoUrl && photo.photoUrl && (
    photo.photoType === 'VIDEO' ||
    photo.photoType === 'MV' ||
    photo.photoType === 'VERTICAL' ||
    photo.photoUrl.includes('.mp4') ||
    photo.photoUrl.includes('mov')
  )) {
    videoUrl = photo.photoUrl;
  }

  if (!videoUrl && photo.manifest) {
    try {
      const manifest = typeof photo.manifest === 'string' ? JSON.parse(photo.manifest) : photo.manifest;
      if (manifest?.adaptationSet) {
        for (const set of manifest.adaptationSet) {
          if (set.representation && set.representation.length > 0) {
            const rep = set.representation[0];
            if (rep.url) {
              videoUrl = rep.url;
              break;
            }
          }
        }
      }
    } catch {}
  }

  // Fallback: search in HTML for mp4 link
  if (!videoUrl && html) {
    const mp4Match = html.match(/https?:\/\/[a-zA-Z0-9_\-\.]+(?:yximgs\.com|kwimgs\.com|kwaicdn\.com|kuaishou\.com)[^"'\s<>\\]+\.mp4[^"'\s<>\\]*/i);
    if (mp4Match) {
      videoUrl = mp4Match[0];
    }
  }

  // 2. Multi-image atlas
  const atlas = photo.atlas || (photo.ext_params && photo.ext_params.atlas);
  const isAtlas = Boolean(atlas && Array.isArray(atlas.list) && atlas.list.length > 0);

  if (isAtlas) {
    const cdnList = (atlas.cdnList && atlas.cdnList.length > 0)
      ? atlas.cdnList.map(c => (typeof c === 'string' ? c : c.cdn || 'p2.a.yximgs.com'))
      : ['p2.a.yximgs.com', 'p23.a.yximgs.com'];

    const defaultCdn = cdnList[0] || 'p2.a.yximgs.com';

    for (let i = 0; i < atlas.list.length; i++) {
      let item = atlas.list[i];
      if (typeof item === 'string') {
        if (item.startsWith('http')) {
          images.push(item);
        } else {
          const path = item.startsWith('/') ? item : `/${item}`;
          images.push(`https://${defaultCdn}${path}`);
        }
      } else if (item && item.url) {
        images.push(item.url);
      }
    }
  }

  // 3. Single image / cover
  let coverUrl = null;
  if (photo.coverUrls && photo.coverUrls.length > 0) {
    const best = photo.coverUrls[0];
    coverUrl = typeof best === 'string' ? best : best?.url;
  } else if (photo.coverUrl) {
    coverUrl = typeof photo.coverUrl === 'string' ? photo.coverUrl : photo.coverUrl?.url;
  }

  if (!isAtlas && !videoUrl && images.length === 0) {
    if (coverUrl) images.push(coverUrl);
    if (images.length === 0 && photo.ext_params?.single?.imageUrl) {
      images.push(photo.ext_params.single.imageUrl);
    }
  }

  // If native video, also add coverUrl into images so thumbnail is present
  if (videoUrl && !isAtlas && coverUrl && images.length === 0) {
    images.push(coverUrl);
  }

  const isVideo = Boolean(videoUrl && (!isAtlas || photo.photoType === 'VIDEO' || photo.photoType === 'MV' || photo.photoType === 'VERTICAL'));

  let musicUrl = null;
  let musicName = null;
  let musicArtist = null;

  // 1. Check soundTrack (standard for Kuaishou photos & videos)
  if (photo.soundTrack) {
    musicName = photo.soundTrack.name || null;
    musicArtist = photo.soundTrack.artist || null;
    if (Array.isArray(photo.soundTrack.audioUrls) && photo.soundTrack.audioUrls.length > 0) {
      const first = photo.soundTrack.audioUrls[0];
      musicUrl = typeof first === 'string' ? first : (first?.url || null);
    } else if (photo.soundTrack.audioUrl) {
      musicUrl = photo.soundTrack.audioUrl;
    }
  }

  // 2. Check photo.music
  if (!musicUrl && photo.music) {
    musicName = musicName || photo.music.name || null;
    musicArtist = musicArtist || photo.music.artist || null;
    if (Array.isArray(photo.music.audioUrls) && photo.music.audioUrls.length > 0) {
      const first = photo.music.audioUrls[0];
      musicUrl = typeof first === 'string' ? first : (first?.url || null);
    } else {
      musicUrl = photo.music.url || photo.music.playUrl || null;
    }
  }

  // 3. Check single / atlas ext_params
  if (!musicUrl && photo.ext_params?.single?.music) {
    const musicCdn = photo.ext_params.single.musicCdnList?.[0]?.cdn || 'tymov2.a.kwimgs.com';
    const musicPath = photo.ext_params.single.music;
    musicUrl = `https://${musicCdn}${musicPath.startsWith('/') ? musicPath : '/' + musicPath}`;
    musicName = musicName || 'BGM';
  }

  if (!musicUrl && (photo.atlas?.music || photo.ext_params?.atlas?.music)) {
    const musicPath = photo.atlas?.music || photo.ext_params?.atlas?.music;
    const cdn = photo.atlas?.cdnList?.[0] || 'p2.a.yximgs.com';
    musicUrl = `https://${cdn}${musicPath.startsWith('/') ? musicPath : '/' + musicPath}`;
  }

  // 4. Fallback search in HTML
  if (!musicUrl && html) {
    const audioMatch = html.match(/https?:\/\/[a-zA-Z0-9_\-\.]+(?:yximgs\.com|kwimgs\.com|kwaicdn\.com)[^"'<>\s]+\.(?:m4a|mp3|aac)[^"'<>\s]*/i);
    if (audioMatch) {
      musicUrl = audioMatch[0];
    }
  }

  const avatar = photo.headUrl || photo.headUrls?.[0]?.url || null;

  return {
    title: photo.caption || `kuaishou_${photo.photoId || Date.now()}`,
    author: photo.userName || 'unknown_author',
    authorAvatar: avatar,
    photoId: photo.photoId || '',
    images,
    isVideo,
    videoUrl: isVideo ? videoUrl : null,
    videoUrls: isVideo ? videoDownloadUrls(photo, videoUrl) : [],
    coverUrl,
    musicUrl,
    musicName,
    musicArtist
  };
}
