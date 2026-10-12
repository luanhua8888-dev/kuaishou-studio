import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, createHash } from 'node:crypto';

const root = path.dirname(fileURLToPath(import.meta.url));
export const CLIENT_FILE = path.join(root, '.x-client.json');
export const X_SCOPES = ['tweet.read', 'tweet.write', 'users.read', 'media.write', 'offline.access'];

export function createXOAuth({ clientId, authFile, fetchImpl = fetch, now = Date.now }) {
  const pending = new Map();
  let refreshing = null;
  function read() { try { return JSON.parse(fs.readFileSync(authFile, 'utf8')); } catch { return {}; } }
  function save(data) {
    fs.writeFileSync(`${authFile}.tmp`, JSON.stringify(data), { mode: 0o600 });
    fs.renameSync(`${authFile}.tmp`, authFile);
  }
  async function tokenRequest(fields) {
    let response, result;
    try {
      response = await fetchImpl('https://api.x.com/2/oauth2/token', {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ ...fields, client_id: clientId }),
        signal: AbortSignal.timeout(30000), redirect: 'error'
      });
      result = await response.json();
    } catch { throw new Error('Không nhận được token từ X. Bấm Đăng nhập X để thử lại.'); }
    if (!response.ok || !result.access_token || result.token_type?.toLowerCase() !== 'bearer') {
      throw new Error(`X không cấp token (${response.status}). Kiểm tra Client ID, loại Native App và callback đã lưu trên X Developer.`);
    }
    return result;
  }
  function tokenData(result, previous = {}) {
    const grantedScope = result.scope || previous.scope || '';
    const scopes = String(grantedScope).split(' ');
    if (X_SCOPES.filter(scope => scope !== 'offline.access').some(scope => !scopes.includes(scope))) {
      throw new Error('X chưa cấp đủ quyền đọc tài khoản, đăng bài và tải media. Kết nối lại để cấp đủ quyền.');
    }
    const expiresIn = Number(result.expires_in);
    if (!Number.isFinite(expiresIn) || expiresIn <= 0) throw new Error('X trả về thời hạn token không hợp lệ.');
    return { ...previous, accessToken: result.access_token, refreshToken: result.refresh_token || previous.refreshToken,
      expiresAt: now() + expiresIn * 1000, scope: grantedScope, clientId };
  }
  return {
    status() {
      const saved = read();
      return { loggedIn: Boolean(saved.accessToken && (!saved.expiresAt || saved.expiresAt > now() || saved.refreshToken)),
        username: saved.username || null, oauthConfigured: Boolean(clientId) };
    },
    begin(port) {
      if (!clientId) throw new Error('Chưa cấu hình Client ID OAuth 2.0 của X.');
      if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Cổng callback không hợp lệ.');
      for (const [key, value] of pending) if (value.expiresAt <= now()) pending.delete(key);
      if (pending.size >= 20) throw new Error('Có nhiều lượt đăng nhập X đang chờ. Hãy thử lại sau.');
      const state = randomBytes(32).toString('base64url');
      const verifier = randomBytes(48).toString('base64url');
      const redirectUri = `http://127.0.0.1:${port}/api/x/callback`;
      pending.set(state, { verifier, redirectUri, expiresAt: now() + 10 * 60 * 1000 });
      const params = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: redirectUri,
        scope: X_SCOPES.join(' '), state, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' });
      return { url: `https://x.com/i/oauth2/authorize?${params}`, state };
    },
    async finish({ code, state, browserState, error, verify }) {
      const entry = pending.get(state);
      if (!entry || state !== browserState || entry.expiresAt <= now()) throw new Error('Phiên đăng nhập X không khớp hoặc đã hết hạn. Bấm Đăng nhập X để bắt đầu lại.');
      pending.delete(state);
      if (error || !code) throw new Error('Bạn chưa cấp quyền cho ứng dụng trên X.');
      const token = tokenData(await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: entry.redirectUri, code_verifier: entry.verifier }));
      const user = await verify(token.accessToken);
      if (!user?.id || !user?.username) throw new Error('Không xác minh được tài khoản X.');
      save({ ...token, username: user.username, userId: user.id });
      return { success: true, username: user.username };
    },
    async credentials() {
      const saved = read();
      if (!saved.accessToken) throw new Error('Chưa kết nối X. Bấm Đăng nhập X trên giao diện.');
      if (!saved.expiresAt || saved.expiresAt > now() + 60000) return saved;
      if (!saved.refreshToken || saved.clientId !== clientId) throw new Error('Token X hết hạn. Bấm Đăng nhập X để kết nối lại.');
      if (!refreshing) refreshing = (async () => {
        const updated = tokenData(await tokenRequest({ grant_type: 'refresh_token', refresh_token: saved.refreshToken }), saved);
        if (read().accessToken !== saved.accessToken) return read();
        save(updated);
        return updated;
      })().finally(() => { refreshing = null; });
      return refreshing;
    }
  };
}

let clientId = process.env.X_CLIENT_ID;
try { clientId ||= JSON.parse(fs.readFileSync(CLIENT_FILE, 'utf8')).clientId; } catch {}
export const xOAuth = createXOAuth({ clientId, authFile: path.join(root, 'x_auth.json') });
