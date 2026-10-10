import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { confirmInstagramPost, INSTAGRAM_CONFIRMATION_TIMEOUT_MS } from './instagram-confirmation.js';

let browser;
before(async () => { browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

async function fixture(html, run) {
  const page = await browser.newPage();
  try { await page.setContent(html); await run(page); }
  finally { await page.close(); }
}

test('allows ten minutes for Instagram video processing', () => {
  assert.equal(INSTAGRAM_CONFIRMATION_TIMEOUT_MS, 10 * 60 * 1000);
});

test('captures a short-lived confirmation before submission returns', async () => {
  for (const text of ['Đã chia sẻ thước phim.', 'Your post has been shared!', 'Thước phim của bạn đã được chia sẻ', 'Đã chia sẻ']) {
    await fixture('<div role="dialog"><h2 id="status">Đang chia sẻ</h2></div>', async page => {
      await confirmInstagramPost(page, async () => {
        await page.locator('#status').evaluate((el, value) => { el.textContent = value; }, text);
        await page.waitForTimeout(30);
        await page.locator('[role="dialog"]').evaluate(el => el.remove());
      }, { timeoutMs: 1000 });
      assert.equal(await page.evaluate(() => '__instagramConfirmation' in window), false);
    });
  }
});

test('waits through processing until confirmation arrives', async () => {
  await fixture('<div role="dialog"><h2 id="status">Sharing...</h2></div>', async page => {
    let submissions = 0;
    await confirmInstagramPost(page, async () => {
      submissions++;
      await page.evaluate(() => {
        setTimeout(() => { document.querySelector('#status').textContent = 'Your reel has been shared'; }, 250);
      });
    }, { timeoutMs: 1500 });
    assert.equal(submissions, 1);
  });
});

test('pending processing is not a successful post and is never submitted twice', async () => {
  await fixture('<div role="dialog"><h2>Đang chia sẻ</h2></div>', async page => {
    let submissions = 0;
    await assert.rejects(confirmInstagramPost(page, async () => { submissions++; }, { timeoutMs: 100 }),
      { code: 'IG_CONFIRMATION_PENDING', message: /vẫn đang xử lý/ });
    assert.equal(submissions, 1);
    assert.equal(await page.evaluate(() => '__instagramConfirmation' in window), false);
  });
});

test('closing a dialog without confirmation does not claim success', async () => {
  await fixture('<div role="dialog">Sharing</div>', async page => {
    await assert.rejects(confirmInstagramPost(page, () => page.locator('[role="dialog"]').evaluate(el => el.remove()),
      { timeoutMs: 100 }), { code: 'IG_CONFIRMATION_PENDING' });
  });
});

test('ignores stale, hidden, caption and feed success text', async () => {
  await fixture('<div role="status">Your post has been shared</div><div role="dialog"><div hidden>Đã chia sẻ</div><div contenteditable="true" id="caption"></div></div><article id="feed"></article>', async page => {
    await assert.rejects(confirmInstagramPost(page, () => page.evaluate(() => {
      document.querySelector('#caption').innerHTML = '<span>Đã chia sẻ</span>';
      document.querySelector('#feed').innerHTML = '<div role="status">Your reel has been shared</div>';
    }), { timeoutMs: 100 }), { code: 'IG_CONFIRMATION_PENDING' });
  });
});

test('Instagram rejection is reported immediately and observer is cleaned up', async () => {
  await fixture('<div role="dialog"><h2 id="status">Sharing</h2></div>', async page => {
    await assert.rejects(confirmInstagramPost(page, () => page.locator('#status').evaluate(el => {
      el.textContent = "Couldn't share reel";
    }), { timeoutMs: 1000 }), /Couldn't share reel/);
    assert.equal(await page.evaluate(() => '__instagramConfirmation' in window), false);
  });
});
