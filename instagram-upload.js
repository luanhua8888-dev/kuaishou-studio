export const UPLOAD_INPUT_UNAVAILABLE = 'IG_UPLOAD_INPUT_UNAVAILABLE';

export async function waitForInstagramUpload(fileInput) {
  try {
    await fileInput.waitFor({ state: 'attached', timeout: 20000 });
  } catch (error) {
    if (error.name !== 'TimeoutError') throw error;
    const skipped = new Error('Không tìm thấy ô tải tệp Instagram; đã tự động bỏ qua Instagram/Facebook.');
    skipped.code = UPLOAD_INPUT_UNAVAILABLE;
    throw skipped;
  }
}
