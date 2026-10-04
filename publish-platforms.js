// Attempt each selected destination even if another destination fails.
export async function publishPlatforms(options, media, posters, progress = () => {}) {
  const result = { igPosted: false, fbPosted: false, tiktokPosted: false, threadsPosted: false, errors: [] };
  if (options.autoPostIG || options.autoPostFB) {
    progress('Đang đăng lên Instagram và Facebook…');
    try {
      const posted = await posters.instagram({ imagePaths: media.imagePaths, caption: media.caption, headless: false, shareToFacebook: Boolean(options.autoPostFB) });
      if (!posted?.success) throw new Error(posted?.message || 'Chưa xác nhận đăng thành công');
      result.igPosted = Boolean(options.autoPostIG);
      result.fbPosted = Boolean(options.autoPostFB && posted.facebookShared);
      if (options.autoPostFB && !posted.facebookShared) result.errors.push('Facebook: chưa xác nhận bật chia sẻ từ Instagram');
    } catch (error) { result.errors.push(`Instagram/Facebook: ${error.message}`); }
  }
  if (options.autoPostTikTok) {
    progress('Đang đăng lên TikTok…');
    try {
      if (!media.videoPath) throw new Error('Không có video để đăng');
      const posted = await posters.tiktok({ videoPath: media.videoPath, caption: media.caption, headless: false });
      if (!posted?.success) throw new Error(posted?.message || 'Chưa xác nhận đăng thành công');
      result.tiktokPosted = true;
    } catch (error) { result.errors.push(`TikTok: ${error.message}`); }
  }
  if (options.autoPostThreads) {
    progress('Đang đăng lên Threads…');
    try {
      const posted = await posters.threads({ imagePaths: media.imagePaths, caption: media.threadsCaption ?? media.caption, headless: false });
      result.threadsTopic = posted.topicAttached ? posted.topic : null;
      if (posted.topic && !posted.topicAttached) result.threadsWarning = 'Bài đã đăng và giữ hashtag, nhưng chưa gắn được chủ đề Threads.';
      if (!posted?.success) throw new Error(posted?.message || 'Chưa xác nhận đăng thành công');
      result.threadsPosted = true;
    } catch (error) { result.errors.push(`Threads: ${error.message}`); }
  }
  result.success = result.errors.length === 0;
  result.partialFailure = !result.success;
  result.error = result.errors.join('; ') || null;
  return result;
}
