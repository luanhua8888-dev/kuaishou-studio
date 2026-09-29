import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const USER_AGENT = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36';

/**
 * Clean illegal characters for directory/file names
 */
function sanitizeFileName(name) {
  return name.replace(/[\\/:*?"<>|]/g, '_').replace(/[\r\n\t]/g, ' ').trim();
}

/**
 * Extract share URL from text
 */
function extractUrl(input) {
  const match = input.match(/https?:\/\/[^\s]+/);
  return match ? match[0] : null;
}

/**
 * Get final redirect URL and HTML
 */
async function getFinalUrl(shareUrl) {
  try {
    const res = await fetch(shareUrl, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      }
    });
    return { finalUrl: res.url, html: await res.text() };
  } catch (err) {
    throw new Error(`Không thể kết nối đến URL: ${err.message}`);
  }
}

/**
 * Parse window.INIT_STATE from HTML
 */
function parseInitState(html) {
  const idx = html.indexOf('window.INIT_STATE');
  if (idx === -1) {
    return null;
  }
  const endIdx = html.indexOf('</script>', idx);
  if (endIdx === -1) {
    return null;
  }
  const scriptContent = html.slice(idx, endIdx);
  const match = scriptContent.match(/window\.INIT_STATE\s*=\s*(\{[\s\S]*\})/);
  if (!match) {
    return null;
  }

  try {
    return JSON.parse(match[1]);
  } catch {
    try {
      const fn = new Function(`return ${match[1]};`);
      return fn();
    } catch (e) {
      console.error('Lỗi phân tích INIT_STATE:', e.message);
      return null;
    }
  }
}

/**
 * Recursively find the photo object in INIT_STATE
 */
function findPhotoData(state) {
  if (!state || typeof state !== 'object') return null;

  if (state.photo && typeof state.photo === 'object') {
    return state;
  }

  for (const key of Object.keys(state)) {
    const res = findPhotoData(state[key]);
    if (res) return res;
  }

  return null;
}

/**
 * Extract media (video or images) and details from post data
 */
function extractMedia(postData, html = '') {
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

  if (!videoUrl && html) {
    const mp4Match = html.match(/https?:\/\/[a-zA-Z0-9_\-\.]+(?:yximgs\.com|kwimgs\.com|kwaicdn\.com|kuaishou\.com)[^"'\s<>\\]+\.mp4[^"'\s<>\\]*/i);
    if (mp4Match) {
      videoUrl = mp4Match[0];
    }
  }

  // 2. Multi-image atlas (Album / Slide show)
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

  // 3. Single image / Cover URLs
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

  if (videoUrl && !isAtlas && coverUrl && images.length === 0) {
    images.push(coverUrl);
  }

  const isVideo = Boolean(videoUrl && (!isAtlas || photo.photoType === 'VIDEO' || photo.photoType === 'MV' || photo.photoType === 'VERTICAL'));

  // Extract music/audio if available
  let musicUrl = null;
  if (photo.soundTrack) {
    if (Array.isArray(photo.soundTrack.audioUrls) && photo.soundTrack.audioUrls.length > 0) {
      const first = photo.soundTrack.audioUrls[0];
      musicUrl = typeof first === 'string' ? first : (first?.url || null);
    } else if (photo.soundTrack.audioUrl) {
      musicUrl = photo.soundTrack.audioUrl;
    }
  }
  if (!musicUrl && photo.music && photo.music.url) {
    musicUrl = photo.music.url;
  } else if (!musicUrl && photo.ext_params && photo.ext_params.single && photo.ext_params.single.music) {
    const musicCdn = (photo.ext_params.single.musicCdnList && photo.ext_params.single.musicCdnList[0]?.cdn) || 'tymov2.a.kwimgs.com';
    const musicPath = photo.ext_params.single.music;
    musicUrl = `https://${musicCdn}${musicPath.startsWith('/') ? musicPath : '/' + musicPath}`;
  } else if (!musicUrl && (photo.atlas?.music || photo.ext_params?.atlas?.music)) {
    const musicPath = photo.atlas?.music || photo.ext_params?.atlas?.music;
    const cdn = photo.atlas?.cdnList?.[0] || 'p2.a.yximgs.com';
    musicUrl = `https://${cdn}${musicPath.startsWith('/') ? musicPath : '/' + musicPath}`;
  } else if (!musicUrl && html) {
    const audioMatch = html.match(/https?:\/\/[a-zA-Z0-9_\-\.]+(?:yximgs\.com|kwimgs\.com|kwaicdn\.com)[^"'<>\s]+\.(?:m4a|mp3|aac)[^"'<>\s]*/i);
    if (audioMatch) {
      musicUrl = audioMatch[0];
    }
  }

  return {
    title: photo.caption || `kuaishou_${photo.photoId || Date.now()}`,
    author: photo.userName || 'unknown_author',
    photoId: photo.photoId || '',
    images,
    isVideo,
    videoUrl: isVideo ? videoUrl : null,
    coverUrl,
    musicUrl
  };
}

function extractImages(postData, html = '') {
  return extractMedia(postData, html);
}

/**
 * Download a file from URL to disk
 */
async function downloadFile(url, destPath) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      'Referer': 'https://www.kuaishou.com/'
    }
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  fs.writeFileSync(destPath, Buffer.from(arrayBuffer));
}

/**
 * Main handler to download media from a Kuaishou link
 */
export async function downloadKuaishou(inputUrl, outputDir = path.join(__dirname, 'downloads')) {
  const rawUrl = extractUrl(inputUrl);
  if (!rawUrl) {
    console.error('[Lỗi] Không tìm thấy URL hợp lệ trong chuỗi nhập vào!');
    return false;
  }

  console.log(`\n========================================`);
  console.log(`[Phân tích] Đang xử lý link: ${rawUrl}`);
  const { finalUrl, html } = await getFinalUrl(rawUrl);
  console.log(`[Link gốc] ${finalUrl}`);

  const initState = parseInitState(html);
  if (!initState) {
    console.error('[Lỗi] Không tìm thấy INIT_STATE. Link có thể đã hết hạn hoặc bị hạn chế.');
    return false;
  }

  const postContainer = findPhotoData(initState);
  if (!postContainer || !postContainer.photo) {
    console.error('[Lỗi] Không tìm thấy dữ liệu photo trong bài viết.');
    return false;
  }

  const post = extractMedia(postContainer, html);

  console.log(`\nTác giả: ${post.author}`);
  console.log(`Tiêu đề: ${post.title.split('\n')[0]}`);
  console.log(`Photo ID: ${post.photoId}`);

  // Create output directory for this post
  const folderTitle = sanitizeFileName(`${post.author}_${post.photoId || 'media'}`).slice(0, 50);
  const targetDir = path.join(outputDir, folderTitle);
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  // Save metadata
  fs.writeFileSync(
    path.join(targetDir, 'info.txt'),
    `Tác giả: ${post.author}\nPhoto ID: ${post.photoId}\nLoại: ${post.isVideo ? 'Video gốc' : 'Bộ ảnh'}\nTiêu đề:\n${post.title}\nLink: ${rawUrl}\n`
  );

  if (post.isVideo && post.videoUrl) {
    console.log(`Loại bài đăng: Video gốc Kuaishou (Không logo watermark)`);
    process.stdout.write(`  Đang tải video gốc (video.mp4)... `);
    try {
      await downloadFile(post.videoUrl, path.join(targetDir, 'video.mp4'));
      console.log('Xong');
    } catch (err) {
      console.log(`Lỗi: ${err.message}`);
    }

    if (post.coverUrl) {
      try {
        await downloadFile(post.coverUrl, path.join(targetDir, 'cover.jpg'));
      } catch {}
    }
  } else if (post.images.length > 0) {
    console.log(`Loại bài đăng: Bộ sưu tập ảnh (${post.images.length} ảnh chất lượng gốc)`);
    for (let i = 0; i < post.images.length; i++) {
      const imgUrl = post.images[i];
      const ext = imgUrl.includes('.webp') ? '.webp' : '.jpg';
      const fileName = `image_${String(i + 1).padStart(2, '0')}${ext}`;
      const filePath = path.join(targetDir, fileName);

      process.stdout.write(`  [${i + 1}/${post.images.length}] Tải: ${fileName}... `);
      try {
        await downloadFile(imgUrl, filePath);
        console.log('Xong');
      } catch (err) {
        console.log(`Lỗi: ${err.message}`);
      }
    }
  } else {
    console.log('[Thông báo] Không tìm thấy ảnh hoặc video nào trong bài đăng này.');
    return false;
  }

  // Download music if exists
  if (post.musicUrl) {
    process.stdout.write(`  Đang tải nhạc nền (audio.m4a)... `);
    try {
      await downloadFile(post.musicUrl, path.join(targetDir, 'audio.m4a'));
      console.log('Xong');
    } catch (err) {
      console.log(`Lỗi: ${err.message}`);
    }
  }

  console.log(`\nTải hoàn tất! Thư mục lưu:`);
  console.log(`${targetDir}\n========================================\n`);
  return true;
}

// Interactive CLI Runner
async function main() {
  const args = process.argv.slice(2);
  if (args.length > 0) {
    for (const link of args) {
      await downloadKuaishou(link);
    }
    return;
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  console.log('--- TOOL TẢI KUAISHOU (NO WATERMARK) ---');
  console.log('Nhập link Kuaishou (hoặc gõ exit để thoát):');

  const promptUser = () => {
    rl.question('\nNhập link: ', async (answer) => {
      const trimmed = answer.trim();
      if (!trimmed || trimmed.toLowerCase() === 'exit') {
        rl.close();
        return;
      }
      await downloadKuaishou(trimmed);
      promptUser();
    });
  };

  promptUser();
}

main().catch(err => {
  console.error('Fatal error:', err);
});
