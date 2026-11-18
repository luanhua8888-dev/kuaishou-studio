import fs from 'node:fs';
import { youtubeOAuth } from './oauth.js';
import { createYouTubeThumbnail, applyYouTubeThumbnail } from './thumbnail.js';
import { reserveYouTubeSlot, releaseYouTubeSlot, scheduledYouTubeStatus } from './schedule.js';

export async function postToYouTubeShort({ videoPath, title, description = '', tags = [], onProgress = () => {} }) {
  if (!videoPath || !fs.existsSync(videoPath)) throw new Error('Không tìm thấy video để tải lên YouTube Shorts.');
  const stat = fs.statSync(videoPath);
  if (!stat.size) throw new Error('Video YouTube Shorts rỗng.');
  const token = await youtubeOAuth.accessToken();
  const safeTitle = String(title || 'Video mới').trim().slice(0, 100);
  const cleanTags = Array.isArray(tags) ? tags.map(t => String(t).replace(/^#/, '').trim()).filter(Boolean).slice(0, 15) : [];
  const { id: slotId, publishAt } = reserveYouTubeSlot();
  onProgress(`Đang tải YouTube và hẹn công khai: ${publishAt} (UTC)…`);
  const metadata = {
    snippet: {
      title: safeTitle,
      description: String(description).slice(0, 5000),
      categoryId: '19',
      defaultLanguage: 'en',
      ...(cleanTags.length ? { tags: cleanTags } : {})
    },
    status: scheduledYouTubeStatus(publishAt)
  };
  let init;
  try {
    init = await fetch('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Length': String(stat.size), 'X-Upload-Content-Type': 'video/mp4' },
      body: JSON.stringify(metadata), signal: AbortSignal.timeout(30000), redirect: 'error'
    });
  } catch {
    releaseYouTubeSlot(slotId);
    throw new Error('Không bắt đầu được lượt tải YouTube. Kiểm tra YouTube Studio trước khi thử lại.');
  }
  if (!init.ok) {
    releaseYouTubeSlot(slotId);
    const errBody = await init.json().catch(() => ({}));
    const reason = errBody?.error?.errors?.[0]?.reason || '';
    if (reason === 'quotaExceeded' || reason === 'uploadLimitExceeded') {
      throw new Error(`Đã đạt giới hạn tải YouTube trong ngày (${reason} - mặc định Google Cloud cho phép ~6 video/ngày). Chờ qua ngày mới hoặc xin nâng quota.`);
    }
    throw new Error(`YouTube từ chối tạo video (${init.status}). Kiểm tra quyền tải video, API và trạng thái kênh.`);
  }
  const uploadUrl = init.headers.get('location');
  if (!uploadUrl || new URL(uploadUrl).origin !== 'https://www.googleapis.com') {
    releaseYouTubeSlot(slotId);
    throw new Error('YouTube không trả URL tải lên an toàn.');
  }
  onProgress('Đang tải video lên YouTube…');
  const bytes = await fs.promises.readFile(videoPath);
  let response;
  try { response = await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(bytes.length) }, body: bytes, signal: AbortSignal.timeout(10 * 60 * 1000), redirect: 'error' }); }
  catch { throw new Error('Mất kết nối khi tải video YouTube. Hãy kiểm tra YouTube Studio trước khi thử lại.'); }
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.id) throw new Error(`YouTube chưa xác nhận video đã tải xong (${response.status}).`);
  let thumbnailApplied = false;
  let thumbnailWarning;
  try {
    onProgress('Đang chọn hình thu nhỏ nổi bật cho YouTube…');
    const thumbnail = await createYouTubeThumbnail(videoPath);
    await applyYouTubeThumbnail(result.id, thumbnail, token);
    thumbnailApplied = true;
  } catch (error) {
    thumbnailWarning = `Video đã tải lên, nhưng chưa gắn được thumbnail: ${error.message}. Không cần đăng lại video.`;
  }
  const confirmedSchedule = result.status?.privacyStatus === 'private' && Date.parse(result.status?.publishAt) === Date.parse(publishAt);
  const scheduleMessage = confirmedSchedule
    ? `Đã lên lịch công khai ${new Date(publishAt).toLocaleString('vi-VN', { timeZone: 'Asia/Bangkok' })} (UTC+7).`
    : 'Video đã tải lên nhưng YouTube chưa xác nhận lịch công khai; kiểm tra YouTube Studio, không đăng lại.';
  return { success: true, videoId: result.id, url: `https://www.youtube.com/shorts/${result.id}`, scheduledAt: confirmedSchedule ? publishAt : null, thumbnailApplied, thumbnailWarning: [scheduleMessage, thumbnailWarning].filter(Boolean).join(' ') };
}
