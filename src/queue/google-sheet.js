import fs from 'node:fs';
import path from 'node:path';
import { createSign } from 'node:crypto';

const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
const API = 'https://sheets.googleapis.com/v4/spreadsheets';

export function colToLetter(colIndex) {
  let temp = colIndex;
  let letter = '';
  while (temp > 0) {
    const mod = (temp - 1) % 26;
    letter = String.fromCharCode(65 + mod) + letter;
    temp = Math.floor((temp - mod) / 26);
  }
  return letter;
}

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

  async function api(settings, endpoint, method = 'GET', body = null) {
    const headers = { Authorization: `Bearer ${await accessToken(settings)}` };
    if (body) headers['Content-Type'] = 'application/json';
    const response = await fetchImpl(endpoint, {
      method, headers,
      body: body ? JSON.stringify(body) : undefined,
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
    async readRows(settings) {
      const title = await sheetTitle(settings);
      const range = `'${title.replace(/'/g, "''")}'!A:Z`;
      const data = await api(settings, `${API}/${encodeURIComponent(settings.sheetId)}/values/${encodeURIComponent(range)}`);
      return (data.values || []).map((row, index) => {
        let colB = '';
        let colC = false;
        for (let c = 1; c < row.length; c += 2) {
          const valLink = String(row[c] || '').trim();
          const valCheck = row[c + 1] === true || String(row[c + 1] || '').trim().toUpperCase() === 'TRUE' || row[c + 1] === '✓';
          if (valLink) colB = valLink;
          if (valCheck) colC = true;
        }
        return {
          row: index + 1,
          colA: String(row[0] || '').trim(),
          colB,
          colC,
          colD: row[3] === true || String(row[3] || '').trim().toUpperCase() === 'TRUE' || row[3] === '✓'
        };
      });
    },
    async clearCell(settings, row) {
      const title = await sheetTitle(settings);
      const range = `'${title.replace(/'/g, "''")}'!A${row}`;
      await api(settings, `${API}/${encodeURIComponent(settings.sheetId)}/values/${encodeURIComponent(range)}:clear`, 'POST');
    },
    async moveLinkAndCheck(settings, row, link) {
      const title = await sheetTitle(settings);
      const safeTitle = `'${title.replace(/'/g, "''")}'`;
      const rangeA = `${safeTitle}!A${row}`;
      await api(settings, `${API}/${encodeURIComponent(settings.sheetId)}/values/${encodeURIComponent(rangeA)}:clear`, 'POST');

      // Check current row values from column B onwards to find the first empty pair of columns (B&C, D&E, F&G...)
      const rangeRow = `${safeTitle}!B${row}:ZZ${row}`;
      const rowData = await api(settings, `${API}/${encodeURIComponent(settings.sheetId)}/values/${encodeURIComponent(rangeRow)}`);
      const rowValues = rowData.values?.[0] || [];

      let colIndex = 2; // Column B is 2
      while (true) {
        const val1 = String(rowValues[colIndex - 2] || '').trim();
        const val2 = String(rowValues[colIndex - 1] || '').trim();
        if (!val1 && !val2) break;
        colIndex += 2;
      }

      const colStart = colToLetter(colIndex);
      const colEnd = colToLetter(colIndex + 1);
      const targetRange = `${safeTitle}!${colStart}${row}:${colEnd}${row}`;
      await api(settings, `${API}/${encodeURIComponent(settings.sheetId)}/values/${encodeURIComponent(targetRange)}?valueInputOption=USER_ENTERED`, 'PUT', {
        range: targetRange,
        values: [[link, true]]
      });
    }
  };
}
