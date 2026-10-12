export const UPLOAD_INPUT_UNAVAILABLE = 'IG_UPLOAD_INPUT_UNAVAILABLE';

export async function waitForInstagramUpload(fileInput) {
  try {
    await fileInput.waitFor({ state: 'attached', timeout: 20000 });
  } catch (error) {
    if (error.name !== 'TimeoutError') throw error;
    const unavailable = new Error('Không mở được ô tải tệp Instagram; Instagram/Facebook chưa đăng. Link được giữ lại để thử lại.');
    unavailable.code = UPLOAD_INPUT_UNAVAILABLE;
    throw unavailable;
  }
}

export async function openInstagramUpload(page) {
  const fileInput = page.locator('input[type="file"]').first();
  // Only retry before selecting files, when no post could have been submitted.
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt) await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded', timeout: 35000 });
    const icon = page.locator('svg[aria-label="Bài viết mới"], svg[aria-label="New post"], svg[aria-label="Tạo"], svg[aria-label="Create"]').first();
    await icon.waitFor({ state: 'visible', timeout: 15000 });
    const create = icon.locator('xpath=ancestor::*[@role="button" or @role="link" or self::a or self::button][1]');
    await create.click({ timeout: 10000 });

    const post = page.getByText(/^(Bài viết|Post)$/).filter({ visible: true }).last();
    // Instagram may open the file input directly or show a delayed Create menu.
    await Promise.any([
      fileInput.waitFor({ state: 'attached', timeout: 10000 }),
      post.waitFor({ state: 'visible', timeout: 10000 })
    ]).catch(() => {});
    if (!(await fileInput.count()) && await post.isVisible()) await post.click({ timeout: 10000 });
    try {
      await waitForInstagramUpload(fileInput);
      return fileInput;
    } catch (error) {
      if (error.code !== UPLOAD_INPUT_UNAVAILABLE || attempt === 1) throw error;
    }
  }
}
