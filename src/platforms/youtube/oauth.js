import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { AUTH_DIR, PROJECT_ROOT } from '../../paths.js';

const authFile = path.join(AUTH_DIR, 'youtube_auth.json');
const clientFile = fs.readdirSync(PROJECT_ROOT).find(name => /^client_secret_.*\.json$/i.test(name));
const clientPath = clientFile ? path.join(PROJECT_ROOT, clientFile) : null;
function readClient() {
  if (!clientPath) return {};
  const data = JSON.parse(fs.readFileSync(clientPath, 'utf8'));
  return data.web || data.installed || {};
}
const client = readClient();
const pending = new Map();
const callbackUri = 'http://localhost:3000/';
function readAuth() { try { return JSON.parse(fs.readFileSync(authFile, 'utf8')); } catch { return {}; } }
function saveAuth(value) {
  fs.mkdirSync(AUTH_DIR, { recursive: true });
  fs.writeFileSync(`${authFile}.tmp`, JSON.stringify(value, null, 2), { mode: 0o600 });
  fs.renameSync(`${authFile}.tmp`, authFile);
}
async function exchange(fields) {
  const response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ ...fields, client_id: client.client_id, client_secret: client.client_secret }), signal: AbortSignal.timeout(30000) });
  const data = await response.json();
  if (!response.ok || !data.access_token) throw new Error(`Google OAuth không hoàn tất (${response.status}).`);
  return data;
}

export const youtubeOAuth = {
  status() {
    const auth = readAuth();
    return { configured: Boolean(client.client_id && client.client_secret), connected: Boolean(auth.refresh_token), channel: auth.channel || null, redirectUri: callbackUri };
  },
  begin() {
    if (!client.client_id || !client.client_secret) throw new Error('File OAuth client chưa có Client ID/Secret.');
    const state = randomBytes(32).toString('hex');
    pending.set(state, Date.now() + 10 * 60_000);
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.search = new URLSearchParams({ client_id: client.client_id, redirect_uri: callbackUri, response_type: 'code', scope: 'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly', access_type: 'offline', prompt: 'consent', state }).toString();
    return { state, url: url.toString() };
  },
  async finish({ code, state }) {
    if (!pending.has(state) || pending.get(state) < Date.now()) throw new Error('Phiên OAuth YouTube không hợp lệ hoặc đã hết hạn.');
    pending.delete(state);
    const tokens = await exchange({ code, redirect_uri: callbackUri, grant_type: 'authorization_code' });
    const response = await fetch('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', { headers: { Authorization: `Bearer ${tokens.access_token}` }, signal: AbortSignal.timeout(15000) });
    const data = await response.json();
    if (!response.ok || !data.items?.[0]) throw new Error('Không tìm thấy kênh YouTube được cấp quyền.');
    saveAuth({ ...tokens, channel: data.items[0].snippet?.title || 'YouTube' });
    return { success: true, channel: data.items[0].snippet?.title || 'YouTube' };
  },
  async accessToken() {
    const auth = readAuth();
    if (!auth.refresh_token) throw new Error('Chưa kết nối YouTube. Bấm Kết nối cạnh YouTube Shorts.');
    if (auth.access_token && Date.now() < (auth.expires_at || 0) - 60_000) return auth.access_token;
    const updated = await exchange({ grant_type: 'refresh_token', refresh_token: auth.refresh_token });
    saveAuth({ ...auth, ...updated, refresh_token: updated.refresh_token || auth.refresh_token, expires_at: Date.now() + Number(updated.expires_in || 3600) * 1000 });
    return updated.access_token;
  }
};
