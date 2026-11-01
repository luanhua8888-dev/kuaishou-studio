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
    const keyPath = path.resolve(path.dirname(settingsPath), settings.serviceAccountKeyFile || 'credentials/google-service-account.json');
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
    if (!id) throw new Error('config/settings.json thiếu sheetId');
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
      const range = `'${title.replace(/'/g, "''")}'!A:ZZ`;
      const data = await api(settings, `${API}/${encodeURIComponent(settings.sheetId)}/values/${encodeURIComponent(range)}`);
      return (data.values || []).map((row, index) => {
        const colA = String(row[0] || '').trim();
        const valC = row[2];
        const colC = valC === true || String(valC || '').trim().toUpperCase() === 'TRUE' || valC === '✓';

        // Thu thập tất cả các cột link (B, D, E, F, G...; cột C chỉ là true/false)
        const links = {};
        for (let c = 1; c < row.length; c++) {
          if (c === 2) continue; // Cột C dành riêng cho trạng thái hoàn thành true/false
          const val = String(row[c] || '').trim();
          if (val) {
            links[colToLetter(c + 1)] = val;
          }
        }
        const colB = links['B'] || Object.values(links)[0] || '';

        return {
          row: index + 1,
          colA,
          colB,
          colC,
          links
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

      // Đọc các giá trị hiện có từ cột B trở đi
      // Cột C chỉ đánh true/false, các cột còn lại (B, D, E, F, G...) chỉ để link
      const rangeRow = `${safeTitle}!B${row}:ZZ${row}`;
      const rowData = await api(settings, `${API}/${encodeURIComponent(settings.sheetId)}/values/${encodeURIComponent(rangeRow)}`);
      const rowValues = rowData.values?.[0] || [];

      // Tìm cột link trống đầu tiên: B (col 2), D (col 4), E (col 5), F (col 6)...
      let targetColIndex = 2;
      const valB = String(rowValues[0] || '').trim();
      if (!valB) {
        targetColIndex = 2; // Cột B trống
      } else {
        let col = 4; // Bắt đầu tìm từ cột D trở đi
        while (true) {
          const val = String(rowValues[col - 2] || '').trim();
          if (!val) {
            targetColIndex = col;
            break;
          }
          col++;
        }
      }

      if (targetColIndex === 2) {
        // Cột B trống: ghi link vào B, true vào C
        const targetRange = `${safeTitle}!B${row}:C${row}`;
        await api(settings, `${API}/${encodeURIComponent(settings.sheetId)}/values/${encodeURIComponent(targetRange)}?valueInputOption=USER_ENTERED`, 'PUT', {
          range: targetRange,
          values: [[link, true]]
        });
      } else if (targetColIndex === 4) {
        // Cột D trống: C và D liền kề -> ghi true vào C, link vào D
        const targetRange = `${safeTitle}!C${row}:D${row}`;
        await api(settings, `${API}/${encodeURIComponent(settings.sheetId)}/values/${encodeURIComponent(targetRange)}?valueInputOption=USER_ENTERED`, 'PUT', {
          range: targetRange,
          values: [[true, link]]
        });
      } else {
        // Cột E, F, G... trống: ghi true vào C và ghi link vào cột tương ứng
        const rangeC = `${safeTitle}!C${row}`;
        await api(settings, `${API}/${encodeURIComponent(settings.sheetId)}/values/${encodeURIComponent(rangeC)}?valueInputOption=USER_ENTERED`, 'PUT', {
          range: rangeC,
          values: [[true]]
        });
        const colLetter = colToLetter(targetColIndex);
        const targetRange = `${safeTitle}!${colLetter}${row}`;
        await api(settings, `${API}/${encodeURIComponent(settings.sheetId)}/values/${encodeURIComponent(targetRange)}?valueInputOption=USER_ENTERED`, 'PUT', {
          range: targetRange,
          values: [[link]]
        });
      }
    }
  };
}
