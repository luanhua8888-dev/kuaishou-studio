import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { confirmThreadsPost } from './threads-confirmation.js';

let browser;
before(async () => { browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

async function fixture(html, run) {
  const page = await browser.newPage();
  try { await page.setContent(html); await run(page); }
  finally { await page.close(); }
}

test('captures a success toast during submission, even when it disappears before click returns', async () => {
  await fixture('<div id="toast"></div>', async page => {
    await confirmThreadsPost(page, async () => {
      await page.evaluate(() => { document.querySelector('#toast').textContent = 'Đã đăng'; });
      await page.waitForTimeout(30);
      await page.evaluate(() => { document.querySelector('#toast').textContent = ''; });
    }, { timeoutMs: 1000 });
    assert.equal(await page.evaluate(() => '__threadsConfirmation' in window), false);
  });
});

test('ignores hidden duplicate text and waits through the posting state', async () => {
  await fixture('<div hidden>Posted</div><div id="toast">Đang đăng...</div>', async page => {
    await confirmThreadsPost(page, () => page.evaluate(() => {
      setTimeout(() => { document.querySelector('#toast').textContent = 'Your thread has been posted!'; }, 100);
    }), { timeoutMs: 1500 });
  });
});

test('reports pending upload without clicking again or claiming success', async () => {
  await fixture('<div>Đang đăng…</div>', async page => {
    let submissions = 0;
    await assert.rejects(confirmThreadsPost(page, async () => { submissions++; }, { timeoutMs: 100 }), /vẫn đang đăng/);
    assert.equal(submissions, 1);
  });
});

test('composer closure alone cannot count as a successful post', async () => {
  await fixture('<div id="composer">New thread</div>', async page => {
    await assert.rejects(confirmThreadsPost(page, () => page.evaluate(() => {
      document.querySelector('#composer').remove();
    }), { timeoutMs: 100 }), /chưa xác nhận đăng thành công/);
  });
});

test('accepts localized completion and whitespace inside a short-lived toast', async () => {
  for (const text of ['Bài viết của bạn đã được đăng!', 'Your post has been posted.', 'Your thread\n has been posted!']) {
    await fixture('<div role="status"><span id="toast"></span><a>View</a></div>', async page => {
      await confirmThreadsPost(page, async () => {
        await page.locator('#toast').evaluate((element, value) => { element.textContent = value; }, text);
        await page.waitForTimeout(30);
        await page.locator('#toast').evaluate(element => { element.textContent = ''; });
      }, { timeoutMs: 1000 });
    });
  }
});

test('does not accept a stale success toast from a previous post', async () => {
  await fixture('<div role="status">Posted</div>', async page => {
    await assert.rejects(confirmThreadsPost(page, async () => {}, { timeoutMs: 100 }), /chưa xác nhận/);
    assert.equal(await page.evaluate(() => '__threadsConfirmation' in window), false);
  });
});

test('a reused toast container confirms only after a new posting cycle', async () => {
  await fixture('<div id="toast">Posted</div>', async page => {
    await confirmThreadsPost(page, async () => {
      await page.locator('#toast').evaluate(element => { element.textContent = 'Posting...'; });
      await page.waitForTimeout(30);
      await page.locator('#toast').evaluate(element => { element.textContent = 'Posted'; });
    }, { timeoutMs: 1000 });
  });
});

test('caption and feed text do not count as publication confirmation', async () => {
  await fixture('<div contenteditable="true" id="editor"></div><article id="feed"></article>', async page => {
    await assert.rejects(confirmThreadsPost(page, () => page.evaluate(() => {
      document.querySelector('#editor').innerHTML = '<span>Posted</span>';
      document.querySelector('#feed').innerHTML = '<p>Thread posted</p>';
    }), { timeoutMs: 100 }), /chưa xác nhận/);
  });
});

test('a wrapper around a caption saying Posted is not a success toast', async () => {
  await fixture('<div><div contenteditable="true" id="editor"></div></div>', async page => {
    await assert.rejects(confirmThreadsPost(page, () => page.evaluate(() => {
      document.querySelector('#editor').textContent = 'Posted';
    }), { timeoutMs: 100 }), /chưa xác nhận/);
  });
});

test('a failed submission disconnects the observer and is never retried', async () => {
  await fixture('<div id="toast"></div>', async page => {
    let submissions = 0;
    await assert.rejects(confirmThreadsPost(page, async () => {
      submissions++;
      throw new Error('Click failed');
    }), /Click failed/);
    assert.equal(submissions, 1);
    assert.equal(await page.evaluate(() => '__threadsConfirmation' in window), false);
  });
});
