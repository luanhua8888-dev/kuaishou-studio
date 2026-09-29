import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { generateKeyPairSync } from 'node:crypto';
import { createGoogleSheet } from './google-sheet.js';

test('reads column A and clears the completed cell with an editor token', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'google-sheet-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const settingsPath = path.join(dir, '.setting');
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  fs.writeFileSync(path.join(dir, 'key.json'), JSON.stringify({
    client_email: 'test@example.iam.gserviceaccount.com',
    private_key: privateKey.export({ type: 'pkcs8', format: 'pem' })
  }));
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url, options });
    if (url.includes('/token')) return { ok: true, json: async () => ({ access_token: 'test-token', expires_in: 3600 }) };
    if (url.includes('?fields=')) return { ok: true, json: async () => ({ sheets: [{ properties: { sheetId: 0, title: 'My Sheet' } }] }) };
    if (url.endsWith(':clear')) return { ok: true, json: async () => ({}) };
    return { ok: true, json: async () => ({ values: [['one'], [], ['three']] }) };
  };
  const sheet = createGoogleSheet({ settingsPath, fetchImpl });
  const settings = { sheetId: 'abc', sheetGid: 0, serviceAccountKeyFile: 'key.json' };
  assert.deepEqual(await sheet.readColumn(settings), ['one', '', 'three']);
  await sheet.clearCell(settings, 3);
  assert.equal(requests.filter(request => request.url.includes('/token')).length, 1);
  assert.ok(requests.some(request => decodeURIComponent(request.url).includes("'My Sheet'!A3:clear") && request.options.method === 'POST'));
  assert.ok(requests.some(request => request.options.headers?.Authorization === 'Bearer test-token'));
});
