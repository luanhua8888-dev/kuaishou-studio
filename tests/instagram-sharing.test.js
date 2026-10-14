import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { disableInstagramThreadsSharing } from '../src/platforms/instagram/sharing.js';

let browser;
before(async () => { browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

async function fixture(html, run) {
  const page = await browser.newPage();
  page.setDefaultTimeout(1500);
  try {
    await page.setContent(`<div role="dialog">${html}</div>`);
    await run(page, page.getByRole('dialog'));
  } finally { await page.close(); }
}

test('does not wait for a missing third switch after sharing controls rerender', async () => {
  await fixture(`
    <div>Threads <button role="switch" aria-checked="true" onclick="this.parentElement.remove()">Toggle</button></div>
    <div>Facebook <button role="switch" aria-checked="true">Toggle</button></div>
    <div>Other <button role="switch" aria-checked="false">Toggle</button></div>
  `, async (page, dialog) => {
    await disableInstagramThreadsSharing(dialog);
    assert.equal(await dialog.getByRole('switch').count(), 2);
    assert.equal(await dialog.getByRole('switch').first().getAttribute('aria-checked'), 'true');
  });
});

test('turns off Threads identified by its accessible label', async () => {
  await fixture('<button role="switch" aria-label="Share to Threads" aria-checked="true" onclick="this.setAttribute(\'aria-checked\', \'false\')">Toggle</button>', async (page, dialog) => {
    await disableInstagramThreadsSharing(dialog);
    assert.equal(await dialog.getByRole('switch').getAttribute('aria-checked'), 'false');
  });
});

test('checks replacement nodes and blocks publishing if Threads remains on', async () => {
  await fixture('<div>Threads <button role="switch" aria-checked="true" onclick="this.outerHTML = this.outerHTML">Toggle</button></div>', async (page, dialog) => {
    await assert.rejects(disableInstagramThreadsSharing(dialog), /Không tắt được chia sẻ Threads/);
  });
});

test('handles a dialog without Threads controls', async () => {
  await fixture('<div>Facebook <button role="switch" aria-checked="true">Toggle</button></div>', async (page, dialog) => {
    await disableInstagramThreadsSharing(dialog);
    assert.equal(await dialog.getByRole('switch').getAttribute('aria-checked'), 'true');
  });
});

test('confirms stopping Threads for this post and restores the composer', async () => {
  const page = await browser.newPage();
  try {
    await page.setContent(`<div role="dialog" id="composer">
      <div role="textbox" contenteditable="true">Caption</div>
      <button role="switch" aria-label="Share to Threads" aria-checked="true">Threads</button>
      <button id="share">Chia sẻ</button>
    </div>`);
    await page.evaluate(() => {
      window.globalSettingChanged = false;
      document.querySelector('[role="switch"]').onclick = () => {
        const composer = document.querySelector('#composer');
        composer.hidden = true;
        setTimeout(() => {
          const popup = document.createElement('div');
          popup.setAttribute('role', 'dialog');
          popup.id = 'confirmation';
          popup.innerHTML = '<h2>Dừng chia sẻ lên Threads?</h2><button id="postOnly">Không chia sẻ bài viết này</button><button id="allPosts">Dừng chia sẻ tất cả bài viết</button>';
          popup.querySelector('#postOnly').onclick = () => {
            composer.querySelector('[role="switch"]').setAttribute('aria-checked', 'false');
            popup.remove();
            composer.hidden = false;
          };
          popup.querySelector('#allPosts').onclick = () => { window.globalSettingChanged = true; };
          document.body.prepend(popup);
        }, 150);
      };
    });
    const composer = page.getByRole('dialog').filter({ has: page.getByRole('textbox') });
    await disableInstagramThreadsSharing(composer);
    assert.equal(await page.locator('#confirmation').count(), 0);
    assert.equal(await composer.getByRole('switch').getAttribute('aria-checked'), 'false');
    assert.equal(await composer.getByRole('button', { name: 'Chia sẻ', exact: true }).isVisible(), true);
    assert.equal(await page.evaluate(() => window.globalSettingChanged), false);
  } finally { await page.close(); }
});
