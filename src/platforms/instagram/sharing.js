function inspectThreadsSwitch(element) {
  if (!element.isConnected) return { threads: false, checked: false };
  let threads = /Threads/i.test(element.getAttribute('aria-label') || '');
  let parent = element.parentElement;
  for (let i = 0; !threads && parent && i < 5; i++, parent = parent.parentElement) {
    const text = parent.innerText || '';
    threads = /Threads/i.test(text) && !/Facebook|Instagram/i.test(text)
      && parent.querySelectorAll('[role="switch"]').length === 1;
  }
  return { threads, checked: element.checked === true || element.getAttribute('aria-checked') === 'true' };
}

// Keep element identities: Locator.all() creates nth() locators that can move or
// disappear when Instagram rerenders the sharing controls after a click.
export async function disableInstagramThreadsSharing(dialog) {
  const page = dialog.page();
  const switches = dialog.getByRole('switch');
  const handles = await switches.elementHandles();
  try {
    for (const toggle of handles) {
      const state = await toggle.evaluate(inspectThreadsSwitch);
      if (state.threads && state.checked) {
        await toggle.click({ timeout: 5000 });
        // Instagram can replace the composer with a confirmation dialog.
        // Change sharing for this post only, keeping account defaults intact.
        const confirmation = page.getByRole('dialog')
          .filter({ hasText: /Dừng chia sẻ lên Threads|Stop sharing (?:to|on) Threads/i }).last();
        try {
          await confirmation.waitFor({ state: 'visible', timeout: 2000 });
        } catch (error) {
          if (error.name !== 'TimeoutError') throw error;
        }
        if (await confirmation.isVisible()) {
          await confirmation.getByRole('button', {
            name: /^(Không chia sẻ (?:bài viết|thước phim) này|Don['’]t share this (?:post|reel)|Do not share this (?:post|reel))$/i
          }).click({ timeout: 5000 });
          await confirmation.waitFor({ state: 'hidden', timeout: 10000 });
          await dialog.waitFor({ state: 'visible', timeout: 10000 });
        }
      }
    }
  } finally {
    await Promise.all(handles.map(handle => handle.dispose()));
  }

  // Verify current DOM, including replacement nodes created by Instagram.
  const current = await switches.elementHandles();
  try {
    for (const toggle of current) {
      const state = await toggle.evaluate(inspectThreadsSwitch);
      if (state.threads && state.checked) {
        throw new Error('Không tắt được chia sẻ Threads trong Instagram; chưa đăng để tránh tạo bài trùng.');
      }
    }
  } finally {
    await Promise.all(current.map(handle => handle.dispose()));
  }
}
