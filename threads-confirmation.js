// Observe before submitting so a short-lived success toast cannot be missed.
export async function confirmThreadsPost(page, submit, { timeoutMs = 300000 } = {}) {
  await page.evaluate(() => {
    const success = /^(Posted|Your (?:thread|post) (?:was|has been) posted|(?:Thread|Post) posted|Đã đăng|Đã đăng (?:bài viết|thread)|(?:Bài viết|Thread)(?: của bạn)? đã được đăng)[.!]?$/i;
    const state = { posted: false, armed: false };
    const candidates = () => document.querySelectorAll('div, span, p, [role="status"], [role="alert"]');
    const text = element => (element.textContent || '').replace(/\s+/g, ' ').trim();
    const visible = element => element.getClientRects().length
      && getComputedStyle(element).visibility !== 'hidden'
      && getComputedStyle(element).display !== 'none';
    // A prior post's toast or text in the composer/feed must not confirm this post.
    const existing = new WeakMap();
    for (const element of candidates()) {
      if (visible(element) && success.test(text(element))) existing.set(element, text(element));
    }
    const scan = () => {
      if (!state.armed) return;
      for (const element of candidates()) {
        const postContent = '[contenteditable="true"], [role="textbox"], article, [role="article"]';
        if (element.closest(postContent) || element.querySelector(postContent)) continue;
        const value = text(element);
        if (success.test(value) && visible(element) && existing.get(element) !== value) state.posted = true;
        // Allow an existing toast container to confirm a new posting cycle.
        if (existing.has(element) && (!visible(element) || !success.test(value))) existing.delete(element);
      }
    };
    const observer = new MutationObserver(scan);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true });
    window.__threadsConfirmation = { state, scan, observer };
  });
  try {
    await page.evaluate(() => { window.__threadsConfirmation.state.armed = true; });
    await submit();
    try {
      await page.waitForFunction(() => {
        window.__threadsConfirmation?.scan();
        return window.__threadsConfirmation?.state.posted;
      }, null, { timeout: timeoutMs });
    } catch (error) {
      if (error.name !== 'TimeoutError') throw error;
      const posting = await page.getByText(/^(Đang đăng|Posting|Publishing)\s*[.…]*$/i)
        .evaluateAll(elements => elements.some(element => element.getClientRects().length)).catch(() => false);
      throw new Error(posting
        ? 'Threads vẫn đang đăng sau thời gian chờ; chưa xác nhận hoàn tất. Kiểm tra bài trên tài khoản trước khi thử lại để tránh đăng trùng.'
        : 'Threads chưa xác nhận đăng thành công. Kiểm tra bài trên tài khoản trước khi thử lại để tránh đăng trùng.');
    }
  } finally {
    await page.evaluate(() => {
      window.__threadsConfirmation?.observer.disconnect();
      delete window.__threadsConfirmation;
    }).catch(() => {});
  }
}
