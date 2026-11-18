import fs from 'node:fs';
import { youtubeOAuth } from './oauth.js';
import { createYouTubeThumbnail, applyYouTubeThumbnail } from './thumbnail.js';
import { reserveYouTubeSlot, releaseYouTubeSlot, scheduledYouTubeStatus } from './schedule.js';
import { cleanYouTubeText, truncateYouTubeBytes } from './metadata.js';

export async function youtubeUploadError(response, stage) {
  const body = await response.json().catch(() => ({}));
  const reasons = [...new Set((Array.isArray(body.error?.errors) ? body.error.errors : [])
    .map(item => item?.reason).filter(value => typeof value === 'string'))];
  const hints = {
    invalidTitle: 'Tiêu đề không hợp lệ.',
    invalidDescription: 'Mô tả không hợp lệ.',
    invalidPublishAt: 'Giờ hẹn công khai không hợp lệ; kiểm tra lịch và đồng hồ máy.',
    uploadLimitExceeded: 'Kênh đã đạt giới hạn tải video; chờ trước khi thử lại.',
    quotaExceeded: 'Dự án đã hết quota YouTube API.',
    youtubeSignupRequired: 'Tài khoản được cấp quyền chưa có kênh YouTube.',
    insufficientPermissions: 'Cần kết nối lại YouTube để cấp quyền tải video.'
  };
  const message = typeof body.error?.message === 'string'
    ? body.error.message.replace(/Bearer\s+\S+/gi, 'Bearer [redacted]').replace(/[\r\n]/g, ' ').slice(0, 400) : '';
  return Object.assign(new Error([`YouTube ${stage} (${response.status}${reasons.length ? `: ${reasons.join(', ')}` : ''}).`,
    ...reasons.map(reason => hints[reason]).filter(Boolean), message,
    'Không tự động đăng lại; kiểm tra YouTube Studio trước khi thử lại.'].filter(Boolean).join(' ')), { reasons });
}

export function youtubePublication(publishMode = 'scheduled', reserveSlot = reserveYouTubeSlot) {
  if (publishMode === 'now') return { status: { privacyStatus: 'public', selfDeclaredMadeForKids: false }, publishAt: null };
  if (publishMode !== 'scheduled') throw new Error('Chế độ đăng YouTube không hợp lệ.');
  const { id, publishAt } = reserveSlot();
  const pub = { status: scheduledYouTubeStatus(publishAt), publishAt };
  if (id) Object.defineProperty(pub, 'slotId', { value: id, enumerable: false });
  return pub;
}

export async function postToYouTubeShort({ videoPath, title, description = '', tags = [], publishMode = 'scheduled', onProgress = () => {} }, {
  fetchImpl = fetch, accessToken = () => youtubeOAuth.accessToken(), reserveSlot = reserveYouTubeSlot,
  prepareVideo = async file => file
} = {}) {
  if (!videoPath || !fs.existsSync(videoPath)) throw new Error('Không tìm thấy video để tải lên YouTube Shorts.');
  onProgress('Đang chuẩn bị video YouTube, giữ nguyên âm thanh gốc…');
  try { videoPath = await prepareVideo(videoPath); }
  catch (error) { error.uploadNotStarted = true; throw error; }
  const stat = fs.statSync(videoPath);
  if (!stat.size) throw new Error('Video YouTube Shorts rỗng.');
  const token = await accessToken();
  const safeTitle = Array.from(cleanYouTubeText(title).replace(/\s+/g, ' ').trim() || 'Video mới').slice(0, 100).join('');
  const cleanTags = Array.isArray(tags) ? tags.map(t => cleanYouTubeText(t).replace(/^#/, '').trim()).filter(Boolean).slice(0, 15) : [];
  const publication = youtubePublication(publishMode, reserveSlot);
  const { status, publishAt, slotId } = publication;
  onProgress(publishAt ? `Đang tải YouTube và hẹn công khai: ${publishAt} (UTC)…` : 'Đang tải YouTube để công khai ngay sau khi xử lý…');
  const metadata = {
    snippet: {
      title: safeTitle,
      description: truncateYouTubeBytes(cleanYouTubeText(description)),
      categoryId: '19',
      defaultLanguage: 'en',
      ...(cleanTags.length ? { tags: cleanTags } : {})
    },
    status
  };
  let init;
  try {
    init = await fetchImpl('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Length': String(stat.size), 'X-Upload-Content-Type': 'video/mp4' },
      body: JSON.stringify(metadata), signal: AbortSignal.timeout(30000), redirect: 'error'
    });
  } catch {
    if (slotId) releaseYouTubeSlot(slotId);
    throw new Error('Không bắt đầu được lượt tải YouTube. Kiểm tra YouTube Studio trước khi thử lại.');
  }
  if (!init.ok) {
    if (slotId) releaseYouTubeSlot(slotId);
    const error = await youtubeUploadError(init, 'từ chối tạo video');
    error.uploadNotStarted = true;
    throw error;
  }
  const uploadUrl = init.headers.get('location');
  if (!uploadUrl || new URL(uploadUrl).origin !== 'https://www.googleapis.com') {
    if (slotId) releaseYouTubeSlot(slotId);
    throw new Error('YouTube không trả URL tải lên an toàn.');
  }
  onProgress('Đang tải video lên YouTube…');
  const bytes = await fs.promises.readFile(videoPath);
  let response;
  try { response = await fetchImpl(uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(bytes.length) }, body: bytes, signal: AbortSignal.timeout(10 * 60 * 1000), redirect: 'error' }); }
  catch { throw new Error('Mất kết nối khi tải video YouTube. Hãy kiểm tra YouTube Studio trước khi thử lại.'); }
  if (!response.ok) throw await youtubeUploadError(response, 'từ chối tải video');
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
  const confirmedSchedule = Boolean(publishAt) && result.status?.privacyStatus === 'private' && Date.parse(result.status?.publishAt) === Date.parse(publishAt);
  const scheduleMessage = !publishAt
    ? (result.status?.privacyStatus === 'public'
      ? 'YouTube đã xác nhận chế độ công khai; video hiển thị khi xử lý hoàn tất.'
      : 'Video đã tải lên nhưng YouTube chưa xác nhận công khai; kiểm tra YouTube Studio, không đăng lại.')
    : confirmedSchedule
    ? `Đã lên lịch công khai ${new Date(publishAt).toLocaleString('vi-VN', { timeZone: 'Asia/Bangkok' })} (UTC+7).`
    : 'Video đã tải lên nhưng YouTube chưa xác nhận lịch công khai; kiểm tra YouTube Studio, không đăng lại.';
  return { success: true, videoId: result.id, url: `https://www.youtube.com/shorts/${result.id}`, scheduledAt: confirmedSchedule ? publishAt : null, thumbnailApplied, thumbnailWarning: [scheduleMessage, thumbnailWarning].filter(Boolean).join(' ') };
}
