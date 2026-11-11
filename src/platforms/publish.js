import { UPLOAD_INPUT_UNAVAILABLE } from './instagram/upload.js';

// Attempt each selected destination concurrently to maximize posting speed.
export async function publishPlatforms(options, media, posters, progress = () => {}) {
  const headless = options.headless ?? true;
  const result = { igPosted: false, fbPosted: false, tiktokPosted: false, threadsPosted: false, xPosted: false, youtubePosted: false, errors: [] };
  const igErrors = [];
  const tiktokErrors = [];
  const threadsErrors = [];
  const xErrors = [];
  const youtubeErrors = [];
  const tasks = [];

  if (options.autoPostIG || options.autoPostFB) {
    tasks.push((async () => {
      progress('Đang đăng lên Instagram và Facebook…');
      try {
        const posted = await posters.instagram({ imagePaths: media.imagePaths, caption: media.caption, headless, shareToFacebook: Boolean(options.autoPostFB) });
        if (!posted?.success) throw new Error(posted?.message || 'Chưa xác nhận đăng thành công');
        result.igPosted = Boolean(options.autoPostIG);
        result.fbPosted = Boolean(options.autoPostFB && posted.facebookShared);
        if (options.autoPostFB && !posted.facebookShared) igErrors.push('Facebook: chưa xác nhận bật chia sẻ từ Instagram');
      } catch (error) {
        if (error.code === UPLOAD_INPUT_UNAVAILABLE) {
          result.skippedPlatforms = [options.autoPostIG && 'instagram', options.autoPostFB && 'facebook'].filter(Boolean);
          result.skipWarning = error.message;
          progress(error.message);
          igErrors.push(`Instagram/Facebook: ${error.message}`);
        } else {
          igErrors.push(`Instagram/Facebook: ${error.message}`);
        }
      }
    })());
  }

  if (options.autoPostTikTok) {
    tasks.push((async () => {
      progress('Đang đăng lên TikTok…');
      try {
        if (!media.videoPath) throw new Error('Không có video để đăng');
        const posted = await posters.tiktok({ videoPath: media.videoPath, caption: media.tiktokCaption ?? media.caption, headless, onProgress: progress });
        if (!posted?.success) throw new Error(posted?.message || 'Chưa xác nhận đăng thành công');
        result.tiktokPosted = true;
      } catch (error) {
        tiktokErrors.push(`TikTok: ${error.message}`);
      }
    })());
  }

  if (options.autoPostThreads) {
    tasks.push((async () => {
      progress('Đang đăng lên Threads…');
      try {
        const posted = await posters.threads({ imagePaths: media.imagePaths, caption: media.threadsCaption ?? media.caption, headless });
        result.threadsTopic = posted?.topicAttached ? posted.topic : null;
        if (posted?.topic && !posted?.topicAttached) result.threadsWarning = 'Bài đã đăng và giữ hashtag, nhưng chưa gắn được chủ đề Threads.';
        if (!posted?.success) throw new Error(posted?.message || 'Chưa xác nhận đăng thành công');
        result.threadsPosted = true;
      } catch (error) {
        threadsErrors.push(`Threads: ${error.message}`);
      }
    })());
  }

  if (options.autoPostX) {
    tasks.push((async () => {
      progress('Đang đăng lên X…');
      try {
        const posted = await posters.x({ imagePaths: media.imagePaths, caption: media.xCaption ?? media.caption, onProgress: progress });
        if (!posted?.success) throw new Error(posted?.message || 'Chưa xác nhận đăng X thành công');
        result.xPosted = true;
        result.xPostUrl = posted.postUrl;
      } catch (error) {
        xErrors.push(`X: ${error.message}`);
      }
    })());
  }

  if (options.autoPostYouTube) {
    tasks.push((async () => {
      progress('Đang tải video lên YouTube Shorts…');
      try {
        if (!media.youtubeVideoPath) throw new Error('Không có video riêng cho YouTube; không dùng bản TikTok có chữ');
        const posted = await posters.youtube({ videoPath: media.youtubeVideoPath, title: media.youtubeTitle ?? media.caption, description: media.youtubeDescription ?? media.caption, onProgress: progress });
        if (!posted?.success) throw new Error(posted?.message || 'YouTube chưa xác nhận tải video thành công');
        result.youtubePosted = true;
        result.youtubeUrl = posted.url;
        result.youtubeScheduledAt = posted.scheduledAt;
        result.youtubeThumbnailApplied = Boolean(posted.thumbnailApplied);
        result.youtubeWarning = posted.thumbnailWarning;
      } catch (error) { youtubeErrors.push(`YouTube Shorts: ${error.message}`); }
    })());
  }

  await Promise.all(tasks);

  result.errors = [...igErrors, ...tiktokErrors, ...threadsErrors, ...xErrors, ...youtubeErrors];
  result.success = result.errors.length === 0;
  result.partialFailure = !result.success;
  result.error = result.errors.join('; ') || null;
  return result;
}
