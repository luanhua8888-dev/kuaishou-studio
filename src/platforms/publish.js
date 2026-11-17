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
  const platforms = new Map();
  function platformProgress(id, label, message, status = 'running') {
    const previous = platforms.get(id);
    if (status === 'running' && previous && previous.status !== 'running') return;
    platforms.set(id, { id, label, message, status,
      startedAt: previous?.startedAt ?? Date.now(), endedAt: status === 'running' ? null : Date.now() });
    const snapshot = [...platforms.values()].map(item => ({ ...item }));
    const active = snapshot.filter(item => item.status === 'running').map(item => item.label);
    const summary = active.length ? `Đang đăng: ${active.join(' + ')}. ${label}: ${message}` : `${label}: ${message}`;
    progress(summary, { platforms: snapshot });
  }

  if (options.autoPostIG || options.autoPostFB) {
    tasks.push((async () => {
      const label = options.autoPostIG && options.autoPostFB ? 'Instagram + Facebook' : options.autoPostIG ? 'Instagram' : 'Facebook (qua Instagram)';
      platformProgress('instagram', label, 'Đang tải và đăng bài…');
      try {
        const posted = await posters.instagram({ imagePaths: media.imagePaths, caption: media.instagramCaption ?? media.caption, headless, shareToFacebook: Boolean(options.autoPostFB) });
        if (!posted?.success) throw new Error(posted?.message || 'Chưa xác nhận đăng thành công');
        result.igPosted = Boolean(options.autoPostIG);
        result.fbPosted = Boolean(options.autoPostFB && posted.facebookShared);
        if (options.autoPostFB && !posted.facebookShared) igErrors.push('Facebook: chưa xác nhận bật chia sẻ từ Instagram');
        platformProgress('instagram', label, igErrors.length ? 'Instagram đã đăng; Facebook chưa xác nhận chia sẻ.' : 'Đã xác nhận đăng thành công.', igErrors.length ? 'warning' : 'done');
      } catch (error) {
        if (error.code === UPLOAD_INPUT_UNAVAILABLE) {
          result.skippedPlatforms = [options.autoPostIG && 'instagram', options.autoPostFB && 'facebook'].filter(Boolean);
          result.skipWarning = error.message;
          igErrors.push(`Instagram/Facebook: ${error.message}`);
        } else {
          igErrors.push(`Instagram/Facebook: ${error.message}`);
        }
        platformProgress('instagram', label, error.message, 'failed');
      }
    })());
  }

  if (options.autoPostTikTok) {
    tasks.push((async () => {
      const update = (message, status) => platformProgress('tiktok', 'TikTok', message, status);
      update('Đang tải và đăng video…');
      try {
        if (!media.videoPath) throw new Error('Không có video để đăng');
        const posted = await posters.tiktok({ videoPath: media.videoPath, caption: media.tiktokCaption ?? media.caption, headless, onProgress: message => update(message) });
        if (!posted?.success) throw new Error(posted?.message || 'Chưa xác nhận đăng thành công');
        result.tiktokPosted = true;
        update('Đã xác nhận đăng thành công.', 'done');
      } catch (error) {
        tiktokErrors.push(`TikTok: ${error.message}`);
        update(error.message, 'failed');
      }
    })());
  }

  if (options.autoPostThreads) {
    tasks.push((async () => {
      const update = (message, status) => platformProgress('threads', 'Threads', message, status);
      update('Đang tải và đăng bài…');
      try {
        const posted = await posters.threads({ imagePaths: media.imagePaths, caption: media.threadsCaption ?? media.caption, headless });
        result.threadsTopic = posted?.topicAttached ? posted.topic : null;
        if (posted?.topic && !posted?.topicAttached) result.threadsWarning = 'Bài đã đăng và giữ hashtag, nhưng chưa gắn được chủ đề Threads.';
        if (!posted?.success) throw new Error(posted?.message || 'Chưa xác nhận đăng thành công');
        result.threadsPosted = true;
        update(result.threadsWarning || 'Đã xác nhận đăng thành công.', result.threadsWarning ? 'warning' : 'done');
      } catch (error) {
        threadsErrors.push(`Threads: ${error.message}`);
        update(error.message, 'failed');
      }
    })());
  }

  if (options.autoPostX) {
    tasks.push((async () => {
      const update = (message, status) => platformProgress('x', 'X', message, status);
      update('Đang tải và đăng bài…');
      try {
        const posted = await posters.x({ imagePaths: media.imagePaths, caption: media.xCaption ?? media.caption, onProgress: message => update(message) });
        if (!posted?.success) throw new Error(posted?.message || 'Chưa xác nhận đăng X thành công');
        result.xPosted = true;
        result.xPostUrl = posted.postUrl;
        update('Đã xác nhận đăng thành công.', 'done');
      } catch (error) {
        xErrors.push(`X: ${error.message}`);
        update(error.message, 'failed');
      }
    })());
  }

  if (options.autoPostYouTube) {
    tasks.push((async () => {
      const update = (message, status) => platformProgress('youtube', 'YouTube Shorts', message, status);
      update('Đang chuẩn bị tải video…');
      try {
        if (!media.youtubeVideoPath) throw new Error('Không có video riêng cho YouTube; không dùng bản TikTok có chữ');
        const posted = await posters.youtube({ videoPath: media.youtubeVideoPath, title: media.youtubeTitle ?? media.caption, description: media.youtubeDescription ?? media.caption, publishMode: options.youtubePublishMode ?? 'scheduled', onProgress: message => update(message) });
        if (posted?.queued) {
          result.youtubeQueued = true;
          result.youtubeQueueId = posted.queueId;
          result.youtubeRetryAt = posted.retryAt;
          result.youtubeWarning = posted.message;
          update(posted.message, 'queued');
          return;
        }
        if (!posted?.success) throw new Error(posted?.message || 'YouTube chưa xác nhận tải video thành công');
        result.youtubePosted = true;
        result.youtubeUrl = posted.url;
        result.youtubeScheduledAt = posted.scheduledAt;
        result.youtubeThumbnailApplied = Boolean(posted.thumbnailApplied);
        result.youtubeWarning = posted.thumbnailWarning;
        update(posted.scheduledAt ? 'Đã tải lên và hẹn giờ công khai.' : 'Đã tải lên; kiểm tra trạng thái công khai trong Studio.', 'done');
      } catch (error) { youtubeErrors.push(`YouTube Shorts: ${error.message}`); update(error.message, 'failed'); }
    })());
  }

  await Promise.all(tasks);
  result.platformProgress = [...platforms.values()];

  result.errors = [...igErrors, ...tiktokErrors, ...threadsErrors, ...xErrors, ...youtubeErrors];
  result.success = result.errors.length === 0;
  result.partialFailure = !result.success;
  result.error = result.errors.join('; ') || null;
  return result;
}
