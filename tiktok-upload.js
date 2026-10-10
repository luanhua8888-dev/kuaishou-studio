// Retry only before selecting a video; never retry a publish action.
export async function waitForTikTokChecks(page, { timeoutMs = 180000, delayMs = 1000, onProgress = () => {} } = {}) {
  const started = Date.now();
  let reportedAt = -Infinity;
  for (;;) {
    const pathname = new URL(page.url()).pathname;
    if (/\/(login|signup)(?:\/|$)/i.test(pathname)) throw new Error('Phiên đăng nhập TikTok đã hết hạn. Vui lòng đăng nhập lại.');
    if (!/\/upload(?:\/|$)/i.test(pathname)) throw new Error('TikTok đã rời trang tải video trong khi kiểm tra; chưa bấm Đăng. Hãy kiểm tra TikTok Studio trước khi thử lại.');
    const states = [];
    for (const frame of page.frames()) {
      const results = await frame.locator('.status-result').evaluateAll(elements => elements.filter(element => {
        const style = getComputedStyle(element);
        return element.getClientRects().length && style.visibility !== 'hidden' && style.display !== 'none'
          && !element.closest('[data-show="false"], [aria-hidden="true"]');
      }).map(element => ({ text: element.innerText.trim(), pending: element.classList.contains('status-checking'),
        blocked: element.classList.contains('status-error') || element.classList.contains('status-warn') })));
      states.push(...results);
      const fallback = await frame.getByText(/^(Đang kiểm tra|Checking)(?:[.\s…]|$)/i).evaluateAll(elements => elements
        .filter(element => element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden'
          && !element.closest('[data-show="false"], [aria-hidden="true"], [contenteditable="true"], [role="textbox"]'))
        .map(element => ({ text: element.innerText.trim(), pending: true, blocked: false })));
      states.push(...fallback.filter(state => !states.some(existing => existing.text === state.text)));
    }
    const blocked = states.find(state => state.blocked || /đạt giới hạn|daily limit|limit reached/i.test(state.text));
    if (blocked) throw new Error(`TikTok không hoàn tất kiểm tra: ${blocked.text || 'Có cảnh báo bản quyền/nội dung'}. Video chưa được bấm Đăng; kiểm tra trong TikTok Studio.`);
    const pending = states.filter(state => state.pending);
    if (!pending.length) return { checksPending: false };
    const elapsed = Date.now() - started;
    if (elapsed >= timeoutMs) {
      onProgress(`TikTok: kiểm tra chưa xong sau ${Math.round(timeoutMs / 60000)} phút; tiếp tục bấm Đăng…`);
      return { checksPending: true };
    }
    if (elapsed - reportedAt >= 30000) {
      onProgress(`TikTok: đang kiểm tra bản quyền/nội dung (${Math.floor(elapsed / 1000)} giây)…`);
      reportedAt = elapsed;
    }
    await page.waitForTimeout(Math.min(delayMs, timeoutMs - elapsed));
  }
}

export async function fillTikTokCaption(page, caption) {
  const text = String(caption || '');
  const box = page.locator('div[contenteditable="true"]:visible, div[data-e2e="caption-input"]:visible').first();
  await box.waitFor({ state: 'visible', timeout: 30000 });
  await box.fill(text);
  // Close hashtag suggestions and commit the editable field before submitting.
  await box.press('Escape');
  await box.press('Tab');
  const normalize = value => value.replace(/\s+/g, ' ').trim();
  if (normalize(await box.innerText()) !== normalize(text)) {
    throw new Error('TikTok không giữ đúng mô tả/hashtag sau khi nhập. Video chưa được bấm Đăng.');
  }
}

export async function waitForTikTokPostButton(page, { polls = 80, delayMs = 1500 } = {}) {
  for (let poll = 0; poll < polls; poll++) {
    const pathname = new URL(page.url()).pathname;
    if (/\/(login|signup)(?:\/|$)/i.test(pathname)) {
      throw new Error('Phiên đăng nhập TikTok đã hết hạn. Vui lòng đăng nhập lại.');
    }
    if (!/\/upload(?:\/|$)/i.test(pathname)) {
      throw new Error('TikTok đã rời trang tải video trước khi xác nhận thao tác Đăng. Hãy kiểm tra bài gần đây trong TikTok Studio trước khi thử lại để tránh đăng trùng.');
    }
    for (const frame of page.frames()) {
      const buttons = frame.getByRole('button', { name: /^\s*(Post|Đăng)\s*$/i });
      const count = await buttons.count().catch(() => 0);
      for (let index = 0; index < count; index++) {
        const button = buttons.nth(index);
        if (await button.isVisible().catch(() => false)
          && await button.isEnabled().catch(() => false)) return button;
      }
    }
    if (poll + 1 < polls) await page.waitForTimeout(delayMs);
  }
  throw new Error('TikTok chưa hiển thị nút Đăng sẵn sàng sau 120 giây. Video chưa được bấm Đăng; hãy kiểm tra trang tải video và kết nối.');
}

export async function waitForTikTokUpload(page, { attempts = 3, polls = 30 } = {}) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    let retryButton = null;
    for (let poll = 0; poll < polls; poll++) {
      if (/\/(login|signup)(?:[/?#]|$)/i.test(page.url())) {
        throw new Error('Phiên đăng nhập TikTok đã hết hạn. Vui lòng đăng nhập lại trên giao diện tool.');
      }
      // Frames can appear after the initial page load.
      for (const frame of page.frames()) {
        const input = frame.locator('input[type="file"]').first();
        if (await input.count().catch(() => 0)) return input;
      }
      const button = page.getByRole('button', { name: /^(Thử lại|Try again|Retry)$/i }).first();
      if (await button.isVisible().catch(() => false)) {
        retryButton = button;
        break;
      }
      await page.waitForTimeout(1000);
    }
    if (attempt + 1 < attempts) {
      console.log(`[TikTok] Trang tải video chưa sẵn sàng, thử lại ${attempt + 2}/${attempts}...`);
      if (retryButton) {
        await retryButton.click({ timeout: 5000 });
      } else {
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 45000 });
      }
      await page.waitForTimeout(3000);
    }
  }
  throw new Error('TikTok Studio vẫn chưa tải được trang chọn video sau 3 lần thử. Hãy kiểm tra TikTok Studio hoặc đăng nhập lại rồi bấm Bắt đầu. Video chưa được tải lên.');
}
