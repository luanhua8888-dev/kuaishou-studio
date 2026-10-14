import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { openInstagramUpload } from '../src/platforms/instagram/upload.js';

let browser;
before(async () => { browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

test('waits for a delayed Create menu and clicks the actual create link', async () => {
  const page = await browser.newPage();
  try {
    await page.setContent(`<a role="link" id="create">
      <div><div><div><svg aria-label="Tạo" width="30" height="30"></svg></div></div></div>
      </a><div id="menu"></div><div id="input"></div>`);
    await page.evaluate(() => {
      document.querySelector('#create').onclick = () => setTimeout(() => {
        const button = document.createElement('button');
        button.textContent = 'Bài viết';
        button.onclick = () => {
          document.querySelector('#input').innerHTML = '<input type="file">';
        };
        document.querySelector('#menu').append(button);
      }, 1800);
    });
    const input = await openInstagramUpload(page);
    assert.equal(await input.count(), 1);
  } finally { await page.close(); }
});

test('accepts Create opening the upload input directly without a submenu', async () => {
  const page = await browser.newPage();
  try {
    await page.setContent(`<button onclick="document.querySelector('#input').innerHTML = '<input type=file>'"><svg aria-label="Create" width="30" height="30"></svg></button><div id="input"></div>`);
    const input = await openInstagramUpload(page);
    assert.equal(await input.count(), 1);
  } finally { await page.close(); }
});
