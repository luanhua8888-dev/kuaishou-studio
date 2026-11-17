// Recover an existing rendered video after a confirmed pre-upload channel-limit rejection.
// No network calls are made here. Run only for a failure already confirmed by YouTube.
import fs from 'node:fs';
import path from 'node:path';
import { DOWNLOADS_DIR } from '../../src/paths.js';
import { youtubeOAuth } from '../../src/platforms/youtube/oauth.js';
import { createYouTubeUploadQueue } from '../../src/platforms/youtube/upload-queue.js';
import { buildYouTubeMetadata } from '../../src/platforms/youtube/metadata.js';

const [source, confirmation, mode = 'scheduled'] = process.argv.slice(2);
if (!source || confirmation !== '--confirmed-upload-limit' || !['scheduled', 'now'].includes(mode)) {
  throw new Error('Usage: node scripts/cli/defer-youtube-upload.mjs <download-folder> --confirmed-upload-limit [scheduled|now]');
}
const directory = path.resolve(source);
const relative = path.relative(DOWNLOADS_DIR, directory);
if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Chỉ phục hồi video trong thư mục downloads.');
const videoPath = path.join(directory, 'youtube_with_audio.mp4');
if (!fs.statSync(videoPath).isFile() || !fs.statSync(videoPath).size) throw new Error('Không có video riêng cho YouTube để giữ trong hàng chờ.');
const info = fs.readFileSync(path.join(directory, 'info.txt'), 'utf8');
const caption = info.match(/Caption[^\r\n]*:\r?\n([\s\S]*?)\r?\nLink:/)?.[1]?.trim();
if (!caption) throw new Error('Không tìm thấy caption đã tạo; không tự bịa metadata.');
const metadata = buildYouTubeMetadata(caption);
const queue = createYouTubeUploadQueue({
  accountKey: () => youtubeOAuth.queueAccountKey(),
  post: async () => { throw new Error('Recovery command must never upload.'); }
});
const result = await queue.deferAfterLimit({ videoPath, title: metadata.youtubeTitle, description: metadata.youtubeDescription, publishMode: mode },
  { uploadNotStarted: true, reasons: ['uploadLimitExceeded'] });
console.log(JSON.stringify({ queued: result.queued, queueId: result.queueId, retryAt: result.retryAt, message: result.message }, null, 2));
