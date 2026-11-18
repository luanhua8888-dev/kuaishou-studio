import { PROJECT_ROOT, SETTINGS_FILE, QUEUE_DIR } from './paths.js';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { Readable } from 'stream';
import { connectionStatus as xStatus, connectX, postToX, prepareXCaption, createXClient } from './platforms/x/poster.js';
import { xOAuth } from './platforms/x/oauth.js';
import { removeCaptionMentions, readJsonBody } from './content/caption-text.js';
import { relevantHashtags, ensureCaptionHashtags } from './content/relevance-tags.js';
import { buildThreadsCaption } from './content/threads-caption.js';
import { cleanPureText, translateText, generateCaptionAndHashtags } from './content/caption.js';
import { callToAction, withCallToAction } from './content/call-to-action.js';
import { checkLoginStatus, postToInstagram } from './platforms/instagram/poster.js';
import { checkLoginStatus as checkTikTokStatus, postToTikTok } from './platforms/tiktok/poster.js';
import { checkLoginStatus as checkThreadsStatus, startInteractiveLogin as loginThreads, loginState as threadsLoginState, postToThreads } from './platforms/threads/poster.js';
import { createSheetQueue, SHEET_URL, readSettings } from './queue/sheet-queue.js';
import { createGoogleSheet } from './queue/google-sheet.js';
import { getPostPage, findPhotoData } from './kuaishou/page.js';
import { extractUrl, extractMedia } from './kuaishou/extract-media.js';
import { publishPlatforms } from './platforms/publish.js';
import { requestPipeline } from './queue/pipeline-request.js';
import { mapLimit } from './network/network-read.js';
import { USER_AGENT, downloadFile, downloadImageAsJpg } from './media/kuaishou-download.js';
import { removeDownloadDirectory, postOutputDir } from './media/workspace.js';
import { createCinematicReel } from './media/cinematic-reel.js';
import { createTikTokSlideshow, readTikTokSlideshowConfig } from './media/tiktok-slideshow.js';
import { sanitizeVideoAudioForCopyright } from './media/anti-copyright.js';
import { youtubeOAuth } from './platforms/youtube/oauth.js';
import { postToYouTubeShort } from './platforms/youtube/poster.js';
import { createYouTubeUploadQueue } from './platforms/youtube/upload-queue.js';
import { polishYouTubeMetadata } from './platforms/youtube/metadata.js';
import { prepareYouTubeShortVideo } from './platforms/youtube/video.js';

const PORT = Number(process.argv.find(arg => arg.startsWith('--port='))?.slice(7) || 3000);
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) throw new Error('Cổng server không hợp lệ.');
const THREADS_ONLY = process.argv.includes('--threads-only');
const X_ONLY = process.argv.includes('--x-only');
const TIKTOK_ONLY = process.argv.includes('--tiktok-only');
if ([X_ONLY, TIKTOK_ONLY, THREADS_ONLY].filter(Boolean).length > 1) throw new Error('Chỉ chọn một phiên nền tảng riêng.');
const PLATFORM_FLAGS = ['autoPostIG', 'autoPostFB', 'autoPostThreads', 'autoPostTikTok', 'autoPostX', 'autoPostYouTube'];
const SESSION_PLATFORM = X_ONLY ? 'autoPostX' : TIKTOK_ONLY ? 'autoPostTikTok' : null;

// Single-platform sessions (X, TikTok) post only to their own platform.
function applySessionMode(options = {}) {
  if (!SESSION_PLATFORM) return options;
  return { ...options, ...Object.fromEntries(PLATFORM_FLAGS.map(flag => [flag, flag === SESSION_PLATFORM])) };
}

function sendJson(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
  res.end(JSON.stringify(body));
}

const pipelineProgress = new Map();
const pipelinePlatforms = new Map();
const pipelineStageStarted = new Map();
const youtubeUploadQueue = createYouTubeUploadQueue({
  post: postToYouTubeShort, accountKey: () => youtubeOAuth.queueAccountKey()
});
let sheetJobId = null;
const googleSheet = createGoogleSheet({ settingsPath: SETTINGS_FILE });
const sheetQueue = createSheetQueue({
  statePath: path.join(QUEUE_DIR, X_ONLY ? 'sheet-queue-x-state.json' : TIKTOK_ONLY ? 'sheet-queue-tiktok-state.json' : 'sheet-queue-state.json'),
  settingsPath: SETTINGS_FILE,
  sheet: googleSheet,
  tiktokPrimeTime: TIKTOK_ONLY,
  async runPipeline(url, options) {
    const jobId = `sheet-${Date.now()}`;
    sheetJobId = jobId;
    try { return await requestPipeline(PORT, { url, ...applySessionMode(options), jobId }); }
    finally { if (sheetJobId === jobId) sheetJobId = null; }
  }
});

function setPipelineProgress(jobId, message, details) {
  if (typeof jobId === 'string' && /^[a-zA-Z0-9-]{1,64}$/.test(jobId)) {
    if (pipelineProgress.get(jobId) !== message) {
      const started = pipelineStageStarted.get(jobId);
      if (started) console.log(`[Pipeline ${jobId}] ${pipelineProgress.get(jobId)}: ${((Date.now() - started) / 1000).toFixed(1)}s`);
      pipelineStageStarted.set(jobId, Date.now());
    }
    pipelineProgress.set(jobId, message);
    if (details?.platforms) pipelinePlatforms.set(jobId, details.platforms);
  }
}



const server = http.createServer(async (req, res) => {
  const reqUrl = new URL(req.url, `http://${req.headers.host}`);
  if (TIKTOK_ONLY && ['/api/ig/post', '/api/fb/post', '/api/threads/post', '/api/x/post'].includes(reqUrl.pathname)) {
    sendJson(res, 409, { success: false, error: 'Phiên này chỉ đăng TikTok.' });
    return;
  }
  if (THREADS_ONLY && ['/api/ig/post', '/api/fb/post', '/api/tiktok/post', '/api/x/post'].includes(reqUrl.pathname)) {
    sendJson(res, 409, { success: false, error: 'Cửa sổ này chỉ đăng Threads. Dùng ứng dụng chính cho nền tảng khác.' });
    return;
  }

  if (X_ONLY && ['/api/ig/post', '/api/fb/post', '/api/tiktok/post', '/api/threads/post'].includes(reqUrl.pathname)) {
    sendJson(res, 409, { success: false, error: 'Phiên này chỉ đăng X.' });
    return;
  }
  if (reqUrl.pathname === '/api/youtube/status' && req.method === 'GET') {
    sendJson(res, 200, { ...youtubeOAuth.status(), uploadQueue: youtubeUploadQueue.status() }, { 'Cache-Control': 'no-store' });
    return;
  }
  if (reqUrl.pathname === '/api/youtube/oauth/start' && req.method === 'GET') {
    if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress)) { res.writeHead(403); res.end(); return; }
    try {
      const login = youtubeOAuth.begin();
      res.writeHead(302, { Location: login.url, 'Cache-Control': 'no-store', 'Set-Cookie': `youtube_oauth_state=${login.state}; HttpOnly; SameSite=Lax; Path=/; Max-Age=600` });
      res.end();
    } catch (error) { res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end(error.message); }
    return;
  }
  if (req.method === 'GET' && reqUrl.pathname === '/' && reqUrl.searchParams.has('code') && reqUrl.searchParams.has('state')) {
    if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress)) { res.writeHead(403); res.end(); return; }
    try {
      const state = (req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith('youtube_oauth_state='))?.split('=').slice(1).join('=');
      const result = await youtubeOAuth.finish({ code: reqUrl.searchParams.get('code'), state: reqUrl.searchParams.get('state') });
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Set-Cookie': 'youtube_oauth_state=; Path=/; Max-Age=0' });
      res.end(`<meta charset="utf-8"><h1>Đã kết nối YouTube</h1><p>${result.channel.replace(/[&<>"']/g, '')}</p><a href="http://localhost:${PORT}/">Quay lại ứng dụng</a>`);
    } catch (error) { res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end(error.message); }
    return;
  }
  if (['/api/x/oauth/start', '/api/x/callback'].includes(reqUrl.pathname) && req.method === 'GET') {
    const remote = req.socket.remoteAddress;
    if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote)) { res.writeHead(403); res.end(); return; }
    if (req.headers.host !== `127.0.0.1:${PORT}`) {
      res.writeHead(400); res.end('Use the sign-in button at localhost to begin with 127.0.0.1.'); return;
    }
    const cookieName = `x_oauth_state_${PORT}`;
    try {
      if (reqUrl.pathname === '/api/x/oauth/start') {
        const login = xOAuth.begin(PORT);
        res.writeHead(302, { Location: login.url, 'Cache-Control': 'no-store',
          'Set-Cookie': `${cookieName}=${login.state}; HttpOnly; SameSite=Lax; Path=/api/x; Max-Age=600` });
        res.end();
      } else {
        const browserState = (req.headers.cookie || '').split(';').map(part => part.trim()).find(part => part.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
        await xOAuth.finish({ code: reqUrl.searchParams.get('code'), state: reqUrl.searchParams.get('state'), browserState,
          error: reqUrl.searchParams.get('error'), verify: accessToken => createXClient({ accessToken }).verify() });
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer',
          'Set-Cookie': `${cookieName}=; HttpOnly; SameSite=Lax; Path=/api/x; Max-Age=0` });
        res.end(`<html lang="vi"><meta charset="utf-8"><title>Đã kết nối X</title><h1>Đã kết nối X thành công</h1><p>Bạn có thể đóng tab này và bật công tắc X trong ứng dụng.</p><a href="http://localhost:${PORT}/">Quay lại ứng dụng</a></html>`);
      }
    } catch (error) {
      const escaped = error.message.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
      res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer',
        'Set-Cookie': `${cookieName}=; HttpOnly; SameSite=Lax; Path=/api/x; Max-Age=0` });
      res.end(`<html lang="vi"><meta charset="utf-8"><title>Kết nối X chưa hoàn tất</title><h1>Kết nối X chưa hoàn tất</h1><p>${escaped}</p><a href="http://localhost:${PORT}/">Quay lại ứng dụng để thử lại</a></html>`);
    }
    return;
  }
  if (reqUrl.pathname === '/api/x/status' && req.method === 'GET') {
    sendJson(res, 200, { success: true, ...xStatus() }, { 'Cache-Control': 'no-store' });
    return;
  }
  if (reqUrl.pathname === '/api/x/login' && req.method === 'POST') {
    if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress)) { res.writeHead(403); res.end(); return; }
    // Credentials may only be submitted by this local UI, never a foreign origin.
    const origin = req.headers.origin;
    const allowed = [`http://localhost:${PORT}`, `http://127.0.0.1:${PORT}`];
    if (origin && !allowed.includes(origin)) { res.writeHead(403); res.end(); return; }
    try {
      const { accessToken } = await readJsonBody(req);
      const result = await connectX(accessToken);
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, 400, { success: false, error: error.message });
    }
    return;
  }
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // 1. Serve UI
  if (req.method === 'GET' && (reqUrl.pathname === '/' || reqUrl.pathname === '/index.html')) {
    const filePath = path.join(PROJECT_ROOT, 'public', 'index.html');
    if (fs.existsSync(filePath)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      fs.createReadStream(filePath).pipe(res);
      return;
    }
  }

  // 2. API: Extract post data
  if (req.method === 'POST' && reqUrl.pathname === '/api/extract') {
    try {
      const { url, lang = 'en' } = await readJsonBody(req);
      const cleanUrl = extractUrl(url);
      if (!cleanUrl) {
        sendJson(res, 400, { success: false, error: 'Không tìm thấy link Kuaishou hợp lệ' });
        return;
      }

      const { finalUrl, html, initState } = await getPostPage(cleanUrl);
      if (!initState) {
        sendJson(res, 404, { success: false, error: 'Không tìm thấy dữ liệu bài đăng (có thể link bị khóa hoặc hết hạn)' });
        return;
      }

      const postContainer = findPhotoData(initState);
      if (!postContainer || !postContainer.photo) {
        sendJson(res, 404, { success: false, error: 'Bài viết không có thông tin hình ảnh' });
        return;
      }

      const data = extractMedia(postContainer, html);
      const generated = await generateCaptionAndHashtags(data.title, data.author, data.musicName, data.musicArtist, data.musicUrl, lang);
      sendJson(res, 200, { 
        success: true, 
        ...data, 
        generatedCaption: generated.fullText,
        hashtags: generated.hashtags,
        moodQuote: generated.moodQuote,
        moodQuoteVi: generated.moodQuoteVi,
        originalUrl: cleanUrl, 
        finalUrl 
      });
    } catch (err) {
      sendJson(res, 500, { success: false, error: err.message });
    }
    return;
  }

  // 2.5. API: Regenerate Caption with specific language
  if (req.method === 'POST' && reqUrl.pathname === '/api/generate-caption') {
    try {
      const { title, author, musicName, musicArtist, musicUrl, lang = 'vi' } = await readJsonBody(req);
      const generated = await generateCaptionAndHashtags(title, author, musicName, musicArtist, musicUrl, lang);
      sendJson(res, 200, { success: true, ...generated });
    } catch (err) {
      sendJson(res, 500, { success: false, error: err.message });
    }
    return;
  }

  // 3. API: Download media to local machine
  if (req.method === 'POST' && reqUrl.pathname === '/api/download-local') {
    try {
      const { post } = await readJsonBody(req);
      if (!post) {
        sendJson(res, 400, { success: false, error: 'Không có dữ liệu bài viết để tải' });
        return;
      }

      const outputDir = postOutputDir(post);

      // Save info
      fs.writeFileSync(
        path.join(outputDir, 'info.txt'),
        `Tác giả: ${post.author}\nPhoto ID: ${post.photoId}\nLoại: ${post.isVideo ? 'Video gốc' : 'Bộ ảnh'}\nTiêu đề:\n${post.title}\nLink: ${post.originalUrl || ''}\n`
      );

      if (post.isVideo && post.videoUrl) {
        await downloadFile(post.videoUrls, path.join(outputDir, 'video.mp4'));
        if (post.coverUrl) {
          await downloadImageAsJpg(post.coverUrl, path.join(outputDir, 'cover.jpg')).catch(() => {});
        }
      } else if (Array.isArray(post.images) && post.images.length > 0) {
        for (let i = 0; i < post.images.length; i++) {
          const imgUrl = post.images[i];
          const fileName = `image_${String(i + 1).padStart(2, '0')}.jpg`;
          await downloadImageAsJpg(imgUrl, path.join(outputDir, fileName));
        }
      }

      if (post.musicUrl) {
        try {
          await downloadFile(post.musicUrl, path.join(outputDir, 'audio.m4a'));
        } catch {}
      }

      sendJson(res, 200, { 
        success: true, 
        isVideo: Boolean(post.isVideo),
        count: post.isVideo ? 1 : (post.images ? post.images.length : 0), 
        path: outputDir 
      });
    } catch (err) {
      sendJson(res, 500, { success: false, error: err.message });
    }
    return;
  }

  // 4. API: Open folder in Windows File Explorer
  if (req.method === 'POST' && reqUrl.pathname === '/api/open-folder') {
    try {
      const { folder } = await readJsonBody(req);
      if (folder && fs.existsSync(folder)) {
        exec(`explorer.exe "${folder}"`);
      }
      sendJson(res, 200, { success: true });
    } catch {
      sendJson(res, 500, { success: false });
    }
    return;
  }

  // 5. API: Media Proxy (Bypass referrer check for preview, video streaming and downloads)
  if (req.method === 'GET' && reqUrl.pathname === '/api/proxy') {
    const targetUrl = reqUrl.searchParams.get('url');
    const isDownload = reqUrl.searchParams.get('download') === '1';
    const filename = reqUrl.searchParams.get('filename') || 'media';

    if (!targetUrl) {
      res.writeHead(400);
      res.end('Missing url');
      return;
    }

    try {
      const headers = {
        'User-Agent': USER_AGENT,
        'Referer': 'https://www.kuaishou.com/'
      };
      if (req.headers.range) {
        headers['Range'] = req.headers.range;
      }

      const upstream = await fetch(targetUrl, { headers });
      const respHeaders = {
        'Content-Type': upstream.headers.get('content-type') || 'application/octet-stream',
        'Accept-Ranges': 'bytes'
      };
      if (upstream.headers.get('content-length')) {
        respHeaders['Content-Length'] = upstream.headers.get('content-length');
      }
      if (upstream.headers.get('content-range')) {
        respHeaders['Content-Range'] = upstream.headers.get('content-range');
      }
      if (isDownload) {
        respHeaders['Content-Disposition'] = `attachment; filename="${filename}"`;
      }

      res.writeHead(upstream.status, respHeaders);
      if (upstream.body) {
        Readable.fromWeb(upstream.body).pipe(res);
      } else {
        res.end();
      }
    } catch (err) {
      if (!res.headersSent) {
        res.writeHead(502);
        res.end('Failed to proxy media');
      } else {
        res.end();
      }
    }
    return;
  }

  // 6. API: Check Instagram Login Status
  if (req.method === 'GET' && reqUrl.pathname === '/api/ig/status') {
    try {
      const loggedIn = await checkLoginStatus();
      sendJson(res, 200, { success: true, loggedIn });
    } catch (err) {
      sendJson(res, 500, { success: false, error: err.message, loggedIn: false });
    }
    return;
  }

  // 7. API: Trigger Interactive Login
  if (req.method === 'POST' && reqUrl.pathname === '/api/ig/login') {
    try {
      const batPath = path.join(PROJECT_ROOT, 'scripts', 'windows', 'login-instagram.bat');
      exec(`start "" "${batPath}"`);
      sendJson(res, 200, { success: true, message: 'Đang mở cửa sổ đăng nhập Instagram' });
    } catch (err) {
      sendJson(res, 500, { success: false, error: err.message });
    }
    return;
  }

  if (req.method === 'GET' && reqUrl.pathname === '/api/threads/status') {
    sendJson(res, 200, { success: true, loggedIn: await checkThreadsStatus(), ...threadsLoginState() });
    return;
  }

  if (req.method === 'POST' && reqUrl.pathname === '/api/threads/login') {
    try {
      const { alreadyOpen } = await loginThreads();
      sendJson(res, 200, { success: true, message: alreadyOpen ? 'Cửa sổ đăng nhập Threads đang mở.' : 'Đã mở cửa sổ đăng nhập Threads.' });
    } catch (error) {
      sendJson(res, 500, { success: false, error: `Không mở được đăng nhập Threads: ${error.message}` });
    }
    return;
  }

  // Prepare local media for manual posts to Instagram, Facebook or Threads.
  if (req.method === 'POST' && ['/api/ig/post', '/api/fb/post', '/api/threads/post', '/api/x/post'].includes(reqUrl.pathname)) {
    try {
      const { post, customCaption, shareToFacebook, captionLang = 'vi' } = await readJsonBody(req);
      const isFbOnly = reqUrl.pathname === '/api/fb/post';
      const isThreadsOnly = reqUrl.pathname === '/api/threads/post';
      const isXOnly = reqUrl.pathname === '/api/x/post';
      const doShareFB = isFbOnly || Boolean(shareToFacebook);

      if (!post || (!post.isVideo && (!Array.isArray(post.images) || post.images.length === 0))) {
        sendJson(res, 400, { success: false, error: 'Không có dữ liệu bài viết để đăng' });
        return;
      }

      // Download files locally first to ensure paths
      const outputDir = postOutputDir(post);

      let uploadPaths = [];

      if (post.isVideo) {
        const videoPath = path.join(outputDir, 'video.mp4');
        if (!fs.existsSync(videoPath) && post.videoUrl) {
          console.log('[Kuaishou] Đang tải video gốc (không logo watermark)...');
          await downloadFile(post.videoUrls, videoPath);
        }
        uploadPaths = [videoPath];
      } else {
        const localImagePaths = [];
        for (let i = 0; i < (post.images || []).length; i++) {
          const imgUrl = post.images[i];
          const fileName = `image_${String(i + 1).padStart(2, '0')}.jpg`;
          const filePath = path.join(outputDir, fileName);
          await downloadImageAsJpg(imgUrl, filePath);
          localImagePaths.push(filePath);
        }

        uploadPaths = localImagePaths;
        const audioPath = path.join(outputDir, 'audio.m4a');
        if (post.asReel !== false && localImagePaths.length > 0) {
          const reelPath = path.join(outputDir, 'reel.mp4');
          try {
            console.log('[Instagram] Đang tạo video Reel 9:16 sạch chữ cho Instagram/Facebook...');
            // Instagram luôn sử dụng video gốc sạch, tuyệt đối không chèn chữ
            await createCinematicReel(localImagePaths, fs.existsSync(audioPath) ? audioPath : null, reelPath, '');
            uploadPaths = [reelPath];
          } catch (e) {
            console.error('Không thể tạo reel:', e.message);
          }
        }
      }

      // Call Playwright automation to post
      let rawCaption = (customCaption !== undefined && customCaption.trim() !== '') ? customCaption.trim() : '';
      if (!rawCaption) {
        const generated = await generateCaptionAndHashtags(post.title, post.author, post.musicName, post.musicArtist, post.musicUrl, captionLang);
        rawCaption = generated.fullText;
      }
      const captionText = ensureCaptionHashtags(removeCaptionMentions(rawCaption), captionLang, post.title);
      if (isXOnly) {
        const result = await postToX({ imagePaths: uploadPaths, caption: prepareXCaption(captionText, { truncate: !customCaption?.trim() }) });
        sendJson(res, 200, result);
        return;
      }
      if (isThreadsOnly) {
        const result = await postToThreads({ imagePaths: uploadPaths, caption: buildThreadsCaption(captionText, 'en', { prompt: false }) });
        sendJson(res, 200, result);
        return;
      }
      const igPostResult = await postToInstagram({
        imagePaths: uploadPaths,
        caption: captionText,
        headless: true,
        shareToFacebook: doShareFB
      });

      const successMsg = doShareFB 
        ? 'Đã đăng bài thành công lên Instagram & chia sẻ sang Facebook!' 
        : 'Đã đăng bài thành công lên Instagram!';

      sendJson(res, 200, { success: igPostResult.success, message: successMsg });
    } catch (err) {
      sendJson(res, 500, { success: false, error: err.message });
    }
    return;
  }

  // 8.1. API: Check TikTok Login Status
  if (req.method === 'GET' && reqUrl.pathname === '/api/tiktok/status') {
    try {
      const loggedIn = await checkTikTokStatus();
      sendJson(res, 200, { success: true, loggedIn });
    } catch (err) {
      sendJson(res, 500, { success: false, error: err.message, loggedIn: false });
    }
    return;
  }

  // 8.2. API: Trigger Interactive TikTok Login
  if (req.method === 'POST' && reqUrl.pathname === '/api/tiktok/login') {
    try {
      const batPath = path.join(PROJECT_ROOT, 'scripts', 'windows', 'login-tiktok.bat');
      exec(`start "" "${batPath}"`);
      sendJson(res, 200, { success: true, message: 'Đang mở cửa sổ đăng nhập TikTok' });
    } catch (err) {
      sendJson(res, 500, { success: false, error: err.message });
    }
    return;
  }

  // 8.3. API: Post to TikTok
  if (req.method === 'POST' && reqUrl.pathname === '/api/tiktok/post') {
    try {
      const { post, customCaption, slideshowConfig } = await readJsonBody(req);
      if (!post) {
        sendJson(res, 400, { success: false, error: 'Không có dữ liệu bài viết để đăng TikTok' });
        return;
      }

      const outputDir = postOutputDir(post);

      let targetVideo = null;

      if (post.isVideo) {
        const videoPath = path.join(outputDir, 'video.mp4');
        if (!fs.existsSync(videoPath) && post.videoUrl) {
          console.log('[TikTok] Đang tải video gốc Kuaishou...');
          await downloadFile(post.videoUrls, videoPath);
        }
        if (fs.existsSync(videoPath)) {
          targetVideo = videoPath;
        }
      } else {
        const tiktokReelPath = path.join(outputDir, 'tiktok_reel.mp4');
        const jpgs = fs.readdirSync(outputDir).filter(f => f.endsWith('.jpg') && !f.includes('cover')).map(f => path.join(outputDir, f));
        if (jpgs.length > 0) {
          const audioPath = path.join(outputDir, 'audio.m4a');
          const config = readTikTokSlideshowConfig({
            ...slideshowConfig,
            title: post.title,
            moodQuote: post.moodQuote || post.moodQuoteVi || post.title,
            author: post.author,
            musicName: post.musicName,
            musicArtist: post.musicArtist,
            seed: post.photoId || post.originalUrl || post.title
          });
          if (post.enableMoodQuote === false) config.sceneTexts = [];
          await createTikTokSlideshow(jpgs.sort(), fs.existsSync(audioPath) ? audioPath : null, tiktokReelPath, config);
          targetVideo = tiktokReelPath;
        } else {
          const reelPath = path.join(outputDir, 'reel.mp4');
          if (fs.existsSync(reelPath)) {
            targetVideo = reelPath;
          }
        }
      }

      if (!targetVideo) {
        sendJson(res, 400, { success: false, error: 'Chưa có file video nào được tạo để đăng lên TikTok' });
        return;
      }

      const slideshowCaption = readTikTokSlideshowConfig(slideshowConfig).caption;
      let captionText;
      if (customCaption !== undefined && customCaption.trim() !== '') {
        captionText = removeCaptionMentions(customCaption);
      } else if (slideshowCaption !== undefined && slideshowCaption.trim() !== '') {
        captionText = removeCaptionMentions(slideshowCaption);
      } else {
        const generatedVi = await generateCaptionAndHashtags(post.title, post.author, post.musicName, post.musicArtist, post.musicUrl, 'vi');
        captionText = withCallToAction(generatedVi.fullText, callToAction('tiktok', 'vi'));
      }
      await postToTikTok({
        videoPath: targetVideo,
        caption: captionText,
        headless: true
      });

      sendJson(res, 200, { success: true, message: 'Đã đăng video thành công lên TikTok!' });
    } catch (err) {
      sendJson(res, 500, { success: false, error: err.message });
    }
    return;
  }

  // 9. API: 1-Click Run Pipeline (Tải nội dung + Tự động tạo Caption & Hashtag + Tự động đăng IG/TikTok/Facebook)
  if (req.method === 'GET' && reqUrl.pathname === '/api/progress') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    const jobId = reqUrl.searchParams.get('jobId');
    res.end(JSON.stringify({ message: pipelineProgress.get(jobId) || '',
      stageStartedAt: pipelineStageStarted.get(jobId) || null, platforms: pipelinePlatforms.get(jobId) || [] }));
    return;
  }

  if (req.method === 'GET' && reqUrl.pathname === '/api/sheet-column') {
    try {
      const settings = readSettings(SETTINGS_FILE);
      let rows;
      if (typeof googleSheet.readRows === 'function') {
        const allRows = await googleSheet.readRows(settings);
        rows = allRows
          .filter(item => item.colA || item.colB || item.colC || (item.links && Object.keys(item.links).length > 0))
          .map(item => ({
            row: item.row,
            value: item.colA,
            colA: item.colA,
            colB: item.colB,
            colC: item.colC,
            links: item.links || (item.colB ? { B: item.colB } : {})
          }));
      } else {
        const cells = await googleSheet.readColumn(settings);
        rows = cells.map((value, index) => ({ row: index + 1, value: String(value), colA: String(value), colB: '', colC: false, links: {} })).filter(item => item.value.trim());
      }
      sendJson(res, 200, { rows }, { 'Cache-Control': 'no-store' });
    } catch (error) {
      sendJson(res, 502, { error: error.message });
    }
    return;
  }

  if (reqUrl.pathname === '/api/ai-settings') {
    const settingPath = SETTINGS_FILE;
    if (req.method === 'GET') {
      let geminiApiKey = '';
      try {
        if (fs.existsSync(settingPath)) {
          const s = JSON.parse(fs.readFileSync(settingPath, 'utf8'));
          geminiApiKey = s.geminiApiKey || s.aiApiKey || '';
        }
      } catch {}
      sendJson(res, 200, { geminiApiKey, hasKey: Boolean(geminiApiKey) }, { 'Cache-Control': 'no-store' });
      return;
    }
    if (req.method === 'POST') {
      try {
        const body = await readJsonBody(req);
        let settings = {};
        if (fs.existsSync(settingPath)) {
          try { settings = JSON.parse(fs.readFileSync(settingPath, 'utf8')); } catch {}
        }
        settings.geminiApiKey = String(body.geminiApiKey || '').trim();
        fs.mkdirSync(path.dirname(settingPath), { recursive: true });
        fs.writeFileSync(settingPath, JSON.stringify(settings, null, 2), 'utf8');
        sendJson(res, 200, { success: true, hasKey: Boolean(settings.geminiApiKey) });
      } catch (err) {
        sendJson(res, 500, { success: false, error: err.message });
      }
      return;
    }
  }

  if (reqUrl.pathname === '/api/sheet-queue') {
    if (THREADS_ONLY) {
      res.writeHead(req.method === 'GET' ? 200 : 409, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(req.method === 'GET' ? {
        threadsOnly: true, enabled: false, running: false, nextRunAt: null, items: [],
        options: { autoPostIG: false, autoPostTikTok: false, autoPostFB: false, autoPostThreads: true, autoPostX: false, asReel: true, captionLang: 'vi', enableMoodQuote: false },
        error: 'Đăng riêng lên Threads: dán link ở ô phía trên rồi bấm Bắt đầu. Hàng đợi của ứng dụng chính vẫn chạy riêng.'
      } : { error: 'Phiên Threads riêng không chạy hàng đợi Google Sheets.' }));
      return;
    }
    try {
      let result;
      if (req.method === 'GET') result = sheetQueue.snapshot();
      else if (req.method === 'POST') {
        const payload = await readJsonBody(req);
        if (SESSION_PLATFORM) payload.options = applySessionMode(payload.options);
        if (TIKTOK_ONLY && payload.enabled === true && !payload.runNextNow && !payload.restartFromFirst) payload.runNow = false;
        result = sheetQueue.configure(payload);
      }
      else { res.writeHead(405); res.end(); return; }
      sendJson(res, 200, { ...result, sheetUrl: SHEET_URL,
        tiktokOnly: TIKTOK_ONLY, xOnly: X_ONLY,
        ...(SESSION_PLATFORM ? { options: applySessionMode(result.options) } : {}),
        stage: sheetJobId ? pipelineProgress.get(sheetJobId) || null : null,
        stageStartedAt: sheetJobId ? pipelineStageStarted.get(sheetJobId) || null : null,
        platforms: sheetJobId ? pipelinePlatforms.get(sheetJobId) || [] : [],
      }, { 'Cache-Control': 'no-store' });
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (req.method === 'POST' && reqUrl.pathname === '/api/run-pipeline') {
    let jobId = null;
    let publishingStarted = false;
    try {
      let { url, autoPostIG, autoPostTikTok, autoPostFB, autoPostThreads = Boolean(autoPostIG), autoPostX = false, autoPostYouTube = false, youtubePublishMode = 'scheduled', asReel, customCaption, captionLang = 'en', moodQuote, enableMoodQuote = true, slideshowConfig, jobId: requestJobId } = await readJsonBody(req);
      if (SESSION_PLATFORM) ({ autoPostIG, autoPostFB, autoPostThreads, autoPostTikTok, autoPostX, autoPostYouTube } = applySessionMode());
      if (!['scheduled', 'now'].includes(youtubePublishMode)) throw new Error('Invalid YouTube publication mode');
      if (THREADS_ONLY && (autoPostIG || autoPostTikTok || autoPostFB || autoPostX)) throw new Error('Phiên này chỉ đăng Threads.');
      const tikTokConfig = autoPostTikTok ? readTikTokSlideshowConfig(slideshowConfig) : null;
      jobId = requestJobId;
      setPipelineProgress(jobId, 'Đang đọc nội dung Kuaishou…');
      const cleanUrl = extractUrl(url);
      if (!cleanUrl) {
        sendJson(res, 400, { success: false, error: 'Không tìm thấy link Kuaishou hợp lệ' });
        return;
      }

      // Step 1: Extract post
      const { finalUrl, html, initState } = await getPostPage(cleanUrl);
      if (!initState) {
        sendJson(res, 404, { success: false, error: 'Không tìm thấy dữ liệu bài đăng' });
        return;
      }

      const postContainer = findPhotoData(initState);
      if (!postContainer || !postContainer.photo) {
        sendJson(res, 404, { success: false, error: 'Bài viết không có nội dung' });
        return;
      }

      const post = extractMedia(postContainer, html);
      setPipelineProgress(jobId, 'Đang chuẩn bị caption và hashtag…');
      const [generated, generatedViResult] = await Promise.all([
        generateCaptionAndHashtags(post.title, post.author, post.musicName, post.musicArtist, post.musicUrl, captionLang),
        captionLang === 'vi'
          ? Promise.resolve(null)
          : generateCaptionAndHashtags(post.title, post.author, post.musicName, post.musicArtist, post.musicUrl, 'vi')
      ]);
      const generatedVi = generatedViResult || generated;
      const finalCaption = ensureCaptionHashtags(removeCaptionMentions((customCaption !== undefined && customCaption.trim() !== '') ? customCaption : generated.fullText), captionLang, post.title);
      const tiktokCaption = (customCaption !== undefined && customCaption.trim() !== '')
        ? removeCaptionMentions(customCaption)
        : ((tikTokConfig?.caption && tikTokConfig.caption.trim() !== '')
            ? removeCaptionMentions(tikTokConfig.caption)
            : withCallToAction(ensureCaptionHashtags(generatedVi.fullText, 'vi', post.title), callToAction('tiktok', 'vi')));
      // Only generated captions get the follow line; a caption you typed is posted as written.
      const instagramCaption = customCaption?.trim() ? finalCaption : withCallToAction(finalCaption, callToAction('instagram', captionLang));
      const finalMoodQuoteVi = enableMoodQuote !== false 
        ? (moodQuote !== undefined && moodQuote.trim() !== '' ? cleanPureText(moodQuote) : (generated.moodQuoteVi || generated.moodQuote || '')) 
        : '';

      // Step 2: Download media locally
      setPipelineProgress(jobId, 'Đang tải ảnh và nhạc…');
      const outputDir = postOutputDir(post);

      fs.writeFileSync(
        path.join(outputDir, 'info.txt'),
        `Tác giả: ${post.author}\nPhoto ID: ${post.photoId}\nLoại: ${post.isVideo ? 'Video gốc' : 'Bộ ảnh'}\nTiêu đề:\n${post.title}\nQuote: ${finalMoodQuoteVi}\nCaption đã tạo:\n${finalCaption}\nLink: ${cleanUrl}\n`
      );

      let uploadPaths = [];
      let targetVideo = null;
      let youtubeVideoPath = null;

      if (post.isVideo && post.videoUrl) {
        const videoPath = path.join(outputDir, 'video.mp4');
        console.log('[Kuaishou] Đang tải video gốc (không logo watermark)...');
        let lastDownloadProgress = 0;
        await downloadFile(post.videoUrls, videoPath, ({ received, total }) => {
          if (Date.now() - lastDownloadProgress < 5000) return;
          lastDownloadProgress = Date.now();
          const size = `${(received / 1048576).toFixed(1)} MB`;
          setPipelineProgress(jobId, `Đang tải video: ${total ? `${Math.floor(received * 100 / total)}% · ` : ''}${size}…`);
        });
        uploadPaths = [videoPath];
        targetVideo = videoPath;

        try {
          setPipelineProgress(jobId, 'Đang loại âm thanh nguồn chưa xác minh quyền sử dụng…');
          const safeVideoPath = await sanitizeVideoAudioForCopyright(videoPath);
          if (safeVideoPath && fs.existsSync(safeVideoPath) && fs.statSync(safeVideoPath).size > 0) {
            uploadPaths = [safeVideoPath];
            targetVideo = safeVideoPath;
          }
        } catch (sanitizeErr) {
          throw sanitizeErr;
        }

        if (autoPostYouTube) {
          setPipelineProgress(jobId, 'Đang chuẩn hóa khung dọc 9:16 và thời lượng YouTube Shorts, giữ âm thanh gốc…');
          youtubeVideoPath = await prepareYouTubeShortVideo(videoPath, path.join(outputDir, 'youtube_short.mp4'));
        }

        if (post.coverUrl) {
          await downloadImageAsJpg(post.coverUrl, path.join(outputDir, 'cover.jpg')).catch(() => {});
        }
      } else {
        const audioPath = path.join(outputDir, 'audio.m4a');
        const [localImagePaths] = await Promise.all([
          mapLimit(post.images || [], 6, async (imgUrl, i) => {
            const filePath = path.join(outputDir, `image_${String(i + 1).padStart(2, '0')}.jpg`);
            await downloadImageAsJpg(imgUrl, filePath);
            return filePath;
          }),
          post.musicUrl ? downloadFile(post.musicUrl, audioPath).catch(e => {
            console.error('Không thể tải audio:', e.message);
          }) : Promise.resolve(),
        ]);

        uploadPaths = localImagePaths;
        const validAudio = fs.existsSync(audioPath) ? audioPath : null;
        const reelPath = path.join(outputDir, 'reel.mp4');
        const tiktokReelPath = path.join(outputDir, 'tiktok_reel.mp4');
        const frameCacheDir = path.join(outputDir, `temp_frames_${Date.now()}`);
        const shouldRunIG = Boolean(autoPostIG || autoPostFB);
        const noPlatformSelected = !shouldRunIG && !autoPostThreads && !autoPostTikTok && !autoPostX && !autoPostYouTube;
        const shouldCreateCleanReel = asReel !== false && (shouldRunIG || autoPostThreads || noPlatformSelected);

        try {
          if (localImagePaths.length > 0) {
            // Instagram/Facebook use the clean version; skip it for TikTok-only runs.
            if (shouldCreateCleanReel) {
              try {
                setPipelineProgress(jobId, 'Đang ghép Reel cho Instagram và Facebook…');
                console.log('[Instagram] Đang tạo video Reel 9:16 sạch chữ cho Instagram/Facebook...');
                await createCinematicReel(localImagePaths, validAudio, reelPath, '', frameCacheDir);
                uploadPaths = [await sanitizeVideoAudioForCopyright(reelPath)];
              } catch (e) {
                console.error('Không thể tạo Reel Instagram:', e.message);
                throw e;
              }
            }

            // TikTok keeps its own caption, reusing prepared frames when possible.
            if (autoPostYouTube) {
              if (post.musicUrl && !validAudio) {
                throw new Error('Không tải được âm thanh nguồn cho YouTube; chưa đăng video để tránh mất tiếng.');
              }
              setPipelineProgress(jobId, 'Đang dựng YouTube Shorts sạch chữ, zoom mượt theo nhịp nhạc…');
              youtubeVideoPath = path.join(outputDir, 'youtube_with_original_audio.mp4');
              try {
                await createTikTokSlideshow(localImagePaths, validAudio, youtubeVideoPath, {
                  durationSeconds: 15,
                  secondsPerImage: 2.5,
                  zoomAmount: 0.03,
                  sceneTexts: [],
                  beatSync: true,
                  loop: true,
                  imageOrder: undefined,
                  heroImageIndex: undefined,
                  text: { style: 'editorial' },
                  audio: { volume: 1, fadeSeconds: 0.45, startAt: 'auto' },
                  seed: post.photoId || cleanUrl || post.title
                });
              } catch {
                await createCinematicReel(localImagePaths.slice(0, 6), validAudio, youtubeVideoPath, '', frameCacheDir, true);
              }
            }
            if (autoPostTikTok) {
              try {
                setPipelineProgress(jobId, 'Đang ghép video có caption cho TikTok…');
                console.log('[TikTok] Đang dựng slideshow có chuyển động và câu chuyện từng cảnh...');
                const config = {
                  ...tikTokConfig,
                  title: post.title,
                  moodQuote: finalMoodQuoteVi,
                  author: post.author,
                  musicName: post.musicName,
                  musicArtist: post.musicArtist,
                  seed: post.photoId || cleanUrl || post.title
                };
                if (!enableMoodQuote) config.sceneTexts = [];
                await createTikTokSlideshow(localImagePaths, validAudio, tiktokReelPath, config);
                targetVideo = await sanitizeVideoAudioForCopyright(tiktokReelPath);
              } catch (e) {
                console.error('Không thể tạo Video TikTok:', e.message);
                throw e;
              }
            }
          }
        } finally {
          if (fs.existsSync(frameCacheDir)) removeDownloadDirectory(frameCacheDir);
        }
      }

      if (autoPostYouTube && (!youtubeVideoPath || !fs.existsSync(youtubeVideoPath) || fs.statSync(youtubeVideoPath).size === 0)) {
        throw new Error('Chưa có video YouTube không chèn chữ sẵn sàng để đăng');
      }
      if (autoPostTikTok && (!targetVideo || !fs.existsSync(targetVideo) || fs.statSync(targetVideo).size === 0)) {
        throw new Error('Chưa có video sẵn sàng để đăng lên TikTok');
      }
      if ((autoPostIG || autoPostFB || autoPostThreads || autoPostX) && (!uploadPaths || uploadPaths.length === 0)) {
        throw new Error('Chưa có hình ảnh hoặc video để đăng bài');
      }

      let youtubeMetadata = {};
      if (autoPostYouTube) {
        const rawSource = customCaption?.trim() ? finalCaption : (post.title || finalCaption);
        const source = rawSource.replace(/#[\p{L}\p{N}_]+/gu, '').trim();
        const [englishCaption, englishDescription] = await Promise.all([
          translateText(source, 'en', true),
          finalMoodQuoteVi ? translateText(finalMoodQuoteVi, 'en', true) : Promise.resolve('')
        ]);
        youtubeMetadata = await polishYouTubeMetadata({
          rawTitle: post.title,
          englishCaption,
          englishDescription,
          callToAction: callToAction('youtube', 'en')
        });
      }
      publishingStarted = true;
      const published = await publishPlatforms(
        { autoPostIG, autoPostFB, autoPostTikTok, autoPostThreads, autoPostX, autoPostYouTube, youtubePublishMode },
        { imagePaths: uploadPaths, videoPath: targetVideo, youtubeVideoPath, caption: finalCaption, instagramCaption, tiktokCaption, ...youtubeMetadata, threadsCaption: buildThreadsCaption(finalCaption, captionLang, { prompt: !customCaption?.trim() }) },
        { instagram: postToInstagram, tiktok: args => postToTikTok({ ...args, caption: args.caption ?? tiktokCaption }), threads: postToThreads, x: args => postToX({ ...args, caption: prepareXCaption(args.caption, { truncate: !customCaption?.trim() }) }), youtube: youtubeUploadQueue.publish },
        (message, details) => setPipelineProgress(jobId, message, details)
      );

      // Keep media when Threads needs a retry, without reposting other platforms.
      let cleanedUp = false;
      if ((autoPostIG || autoPostFB || autoPostTikTok || autoPostThreads || autoPostX || autoPostYouTube) && published.success && !published.skippedPlatforms?.length) {
        try {
          removeDownloadDirectory(outputDir);
          cleanedUp = true;
          console.log(`[Kuaishou] Đã dọn file tạm sau khi đăng: ${outputDir}`);
        } catch (cleanupError) {
          console.warn(`[Kuaishou] Không dọn được file tạm: ${cleanupError.message}`);
        }
      }

      setPipelineProgress(jobId, 'Hoàn tất.');
      sendJson(res, 200, {
        success: true,
        post: { ...post, originalUrl: cleanUrl, finalUrl, moodQuote: finalMoodQuoteVi, moodQuoteVi: finalMoodQuoteVi },
        caption: finalCaption,
        hashtags: generated.hashtags,
        moodQuote: finalMoodQuoteVi,
        moodQuoteVi: finalMoodQuoteVi,
        downloadPath: cleanedUp ? null : outputDir,
        cleanedUp,
        isVideo: post.isVideo,
        count: post.isVideo ? 1 : post.images.length,
        ...published
      });
    } catch (err) {
      setPipelineProgress(jobId, `Lỗi: ${err.message}`);
      sendJson(res, 500, { success: false, error: err.message, code: err.code, failureStage: publishingStarted ? 'publish' : 'prepare' });
    } finally {
      if (typeof jobId === 'string') {
        const completedJobId = jobId;
        setTimeout(() => {
          pipelineProgress.delete(completedJobId);
          pipelinePlatforms.delete(completedJobId);
          pipelineStageStarted.delete(completedJobId);
        }, 60_000).unref();
      }
    }
    return;
  }

  if (!res.headersSent) {
    res.writeHead(404);
    res.end('Not Found');
  }
});

server.listen(PORT, () => {
  if (!THREADS_ONLY && !X_ONLY && !TIKTOK_ONLY) youtubeUploadQueue.start();
  if (!THREADS_ONLY) sheetQueue.start();
  const url = `http://localhost:${PORT}`;
  console.log(`\n==================================================`);
  console.log(`Kuaishou Downloader UI đang chạy tại:`);
  console.log(`${url}`);
  console.log(`==================================================\n`);

  // Auto open browser on Windows
  if (!process.argv.includes('--no-browser')) exec(`start ${url}`);
});

server.on('error', error => {
  console.error(error.code === 'EADDRINUSE' ? `Cổng ${PORT} đã có server đang chạy. Dừng server cũ trước hoặc dùng npm run ui:threads.` : error.message);
  process.exitCode = 1;
});

server.on('close', () => youtubeUploadQueue.stop());

process.on('uncaughtException', (err) => {
  console.error('Unhandled Exception:', err.message);
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
});
