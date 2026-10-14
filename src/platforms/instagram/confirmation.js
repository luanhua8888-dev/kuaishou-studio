export const INSTAGRAM_CONFIRMATION_TIMEOUT_MS = 600000;

// Arm before Share: Instagram can show and remove its confirmation during click().
export async function confirmInstagramPost(page, submit, { timeoutMs = INSTAGRAM_CONFIRMATION_TIMEOUT_MS } = {}) {
  await page.evaluate(() => {
    const success = /^(?:Your (?:post|reel) has been shared|Đã chia sẻ(?: bài viết| thước phim)?|(?:Bài viết|Thước phim)(?: của bạn)? đã được chia sẻ)[.!]?$/i;
    const pending = /^(?:Sharing|Đang chia sẻ)\s*[.…]*$/i;
    const failure = /^(?:Couldn't share (?:post|reel)|Your (?:post|reel) could not be shared|Không thể chia sẻ(?: bài viết| thước phim)?)[.!]?$/i;
    const state = { posted: false, uploading: false, error: null, armed: false };
    const existing = new WeakMap();
    const candidates = () => document.querySelectorAll('[role="dialog"] div, [role="dialog"] span, [role="dialog"] h1, [role="dialog"] h2, [role="dialog"] p, [role="status"], [role="alert"], [role="status"] span, [role="alert"] span');
    const text = element => (element.textContent || '').replace(/\s+/g, ' ').trim();
    const visible = element => element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden' && getComputedStyle(element).display !== 'none';
    for (const element of candidates()) {
      if (visible(element) && success.test(text(element))) existing.set(element, text(element));
    }
    const scan = () => {
      if (!state.armed) return;
      state.uploading = false;
      for (const element of candidates()) {
        const content = '[contenteditable="true"], [role="textbox"], article, [role="article"]';
        if (element.closest(content) || element.querySelector(content)) continue;
        const value = text(element);
        const shown = visible(element);
        if (shown && success.test(value) && existing.get(element) !== value) state.posted = true;
        if (shown && pending.test(value)) state.uploading = true;
        if (shown && failure.test(value)) state.error = value;
        if (existing.has(element) && (!shown || !success.test(value))) existing.delete(element);
      }
    };
    const observer = new MutationObserver(scan);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true });
    window.__instagramConfirmation = { state, scan, observer };
  });
  try {
    await page.evaluate(() => { window.__instagramConfirmation.state.armed = true; });
    await submit();
    try {
      await page.waitForFunction(() => {
        window.__instagramConfirmation?.scan();
        const state = window.__instagramConfirmation?.state;
        return state?.posted || state?.error;
      }, null, { timeout: timeoutMs });
    } catch (error) {
      if (error.name !== 'TimeoutError') throw error;
      const uploading = await page.evaluate(() => window.__instagramConfirmation?.state.uploading);
      const uncertain = new Error(uploading
        ? 'Instagram vẫn đang xử lý bài đăng sau thời gian chờ. Kiểm tra bài trên tài khoản trước khi thử lại để tránh đăng trùng.'
        : 'Instagram chưa xác nhận hoàn tất bài đăng. Kiểm tra bài trên tài khoản trước khi thử lại để tránh đăng trùng.');
      uncertain.code = 'IG_CONFIRMATION_PENDING';
      throw uncertain;
    }
    const failure = await page.evaluate(() => window.__instagramConfirmation?.state.error);
    if (failure) throw new Error(`Instagram: ${failure}`);
  } finally {
    await page.evaluate(() => {
      window.__instagramConfirmation?.observer.disconnect();
      delete window.__instagramConfirmation;
    }).catch(() => {});
  }
}
