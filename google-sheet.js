import fs from 'node:fs';
import path from 'node:path';
import { createSign } from 'node:crypto';

const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
const API = 'https://sheets.googleapis.com/v4/spreadsheets';

export function createGoogleSheet({ settingsPath, fetchImpl = fetch }) {
  let token = null, expiresAt = 0;
  async function accessToken(settings) {
    if (token && Date.now() < expiresAt - 60000) return token;
    const keyPath = path.resolve(path.dirname(settingsPath), settings.serviceAccountKeyFile || 'google-service-account.json');
    if (!fs.existsSync(keyPath)) throw new Error(`Thiếu file xác thực Google: ${keyPath}`);
    const key = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
    if (!key.client_email || !key.private_key) throw new Error('File service account không hợp lệ');
    const now = Math.floor(Date.now() / 1000);
    const encode = object => Buffer.from(JSON.stringify(object)).toString('base64url');
    const unsigned = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({ iss: key.client_email, scope: SCOPE, aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 })}`;
    const signer = createSign('RSA-SHA256');
    signer.update(unsigned); signer.end();
    const assertion = `${unsigned}.${signer.sign(key.private_key).toString('base64url')}`;
    const response = await fetchImpl('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
      signal: AbortSignal.timeout(15000)
    });
    const data = await response.json();
    if (!response.ok || !data.access_token) throw new Error(`Google OAuth: ${data.error_description || data.error || response.status}`);
    token = data.access_token;
    expiresAt = Date.now() + (data.expires_in || 3600) * 1000;
    return token;
  }

  async function api(settings, endpoint, method = 'GET') {
    const response = await fetchImpl(endpoint, {
      method, headers: { Authorization: `Bearer ${await accessToken(settings)}` },
      signal: AbortSignal.timeout(15000)
    });
    const data = await response.json();
    if (!response.ok) throw new Error(`Google Sheets: ${data.error?.message || `HTTP ${response.status}`}`);
    return data;
  }

  async function sheetTitle(settings) {
    const id = settings.sheetId;
    if (!id) throw new Error('.setting thiếu sheetId');
    const data = await api(settings, `${API}/${encodeURIComponent(id)}?fields=sheets.properties(sheetId,title)`);
    const found = data.sheets?.find(sheet => sheet.properties?.sheetId === (settings.sheetGid ?? 0));
    if (!found) throw new Error(`Không tìm thấy trang tính gid=${settings.sheetGid ?? 0}`);
    return found.properties.title;
  }

  return {
    async readColumn(settings) {
      const title = await sheetTitle(settings);
      const range = `'${title.replace(/'/g, "''")}'!A:A`;
      const data = await api(settings, `${API}/${encodeURIComponent(settings.sheetId)}/values/${encodeURIComponent(range)}`);
      return (data.values || []).map(row => row[0] || '');
    },
    async clearCell(settings, row) {
      const title = await sheetTitle(settings);
      const range = `'${title.replace(/'/g, "''")}'!A${row}`;
      await api(settings, `${API}/${encodeURIComponent(settings.sheetId)}/values/${encodeURIComponent(range)}:clear`, 'POST');
    }
  };
}
