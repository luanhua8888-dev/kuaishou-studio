import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { generateKeyPairSync } from 'node:crypto';
import { createGoogleSheet, colToLetter } from '../src/queue/google-sheet.js';

test('colToLetter converts 1-based column indices to letters', () => {
  assert.equal(colToLetter(1), 'A');
  assert.equal(colToLetter(2), 'B');
  assert.equal(colToLetter(3), 'C');
  assert.equal(colToLetter(4), 'D');
  assert.equal(colToLetter(5), 'E');
  assert.equal(colToLetter(26), 'Z');
  assert.equal(colToLetter(27), 'AA');
  assert.equal(colToLetter(28), 'AB');
});

test('moveLinkAndCheck writes to B:C when empty, but pushes to D:E when B:C is occupied', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'google-sheet-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const settingsPath = path.join(dir, '.setting');
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  fs.writeFileSync(path.join(dir, 'key.json'), JSON.stringify({
    client_email: 'test@example.iam.gserviceaccount.com',
    private_key: privateKey.export({ type: 'pkcs8', format: 'pem' })
  }));

  let rowValues = [];
  const putCalls = [];
  const fetchImpl = async (url, options) => {
    if (url.includes('/token')) return { ok: true, json: async () => ({ access_token: 'test-token', expires_in: 3600 }) };
    if (url.includes('?fields=')) return { ok: true, json: async () => ({ sheets: [{ properties: { sheetId: 0, title: 'My Sheet' } }] }) };
    if (url.endsWith(':clear')) return { ok: true, json: async () => ({}) };
    if (options?.method === 'PUT') {
      putCalls.push({ url, body: JSON.parse(options.body) });
      return { ok: true, json: async () => ({}) };
    }
    return { ok: true, json: async () => ({ values: [rowValues] }) };
  };

  const sheet = createGoogleSheet({ settingsPath, fetchImpl });
  const settings = { sheetId: 'abc', sheetGid: 0, serviceAccountKeyFile: 'key.json' };

  // Case 1: B and C are empty -> writes to B2:C2
  rowValues = [];
  await sheet.moveLinkAndCheck(settings, 2, 'https://v.kuaishou.com/link1');
  assert.equal(putCalls.length, 1);
  assert.match(decodeURIComponent(putCalls[0].url), /'My Sheet'!B2:C2/);
  assert.deepEqual(putCalls[0].body.values, [['https://v.kuaishou.com/link1', true]]);

  // Case 2: B and C are already occupied -> writes to D2:E2
  rowValues = ['https://v.kuaishou.com/link1', 'TRUE'];
  await sheet.moveLinkAndCheck(settings, 2, 'https://v.kuaishou.com/link2');
  assert.equal(putCalls.length, 2);
  assert.match(decodeURIComponent(putCalls[1].url), /'My Sheet'!D2:E2/);
  assert.deepEqual(putCalls[1].body.values, [['https://v.kuaishou.com/link2', true]]);

  // Case 3: B, C, D, E are all occupied -> writes to F2:G2
  rowValues = ['https://v.kuaishou.com/link1', 'TRUE', 'https://v.kuaishou.com/link2', 'TRUE'];
  await sheet.moveLinkAndCheck(settings, 2, 'https://v.kuaishou.com/link3');
  assert.equal(putCalls.length, 3);
  assert.match(decodeURIComponent(putCalls[2].url), /'My Sheet'!F2:G2/);
  assert.deepEqual(putCalls[2].body.values, [['https://v.kuaishou.com/link3', true]]);
});

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
