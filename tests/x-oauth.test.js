import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { createXOAuth, X_SCOPES } from '../x-oauth.js';

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'x-oauth-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const authFile = path.join(dir, 'auth.json');
  let clock = 1000000;
  const calls = [], replies = [];
  const oauth = createXOAuth({ clientId: 'test-client', authFile, now: () => clock, fetchImpl: async (url, options) => {
    calls.push({ url, ...options });
    const reply = replies.shift();
    assert.ok(reply, 'Unexpected OAuth request');
    return { ok: reply.ok !== false, status: reply.status || 200, json: async () => reply };
  } });
  const token = { access_token: 'access-secret', refresh_token: 'refresh-secret', token_type: 'bearer', expires_in: 7200, scope: X_SCOPES.join(' ') };
  const verify = async accessToken => { assert.equal(accessToken, 'access-secret'); return { id: '123', username: 'demo' }; };
  return { oauth, calls, replies, token, verify, authFile, advance: ms => { clock += ms; } };
}

test('OAuth uses S256, exact loopback callback and exchanges code before saving verified identity', async t => {
  const { oauth, calls, replies, token, verify, authFile } = fixture(t);
  const login = oauth.begin(3000);
  const url = new URL(login.url);
  assert.equal(url.searchParams.get('redirect_uri'), 'http://127.0.0.1:3000/api/x/callback');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('scope'), X_SCOPES.join(' '));
  assert.equal(fs.existsSync(authFile), false);
  replies.push(token);
  await oauth.finish({ code: 'one-use-code', state: login.state, browserState: login.state, verify });
  const verifier = calls[0].body.get('code_verifier');
  assert.equal(createHash('sha256').update(verifier).digest('base64url'), url.searchParams.get('code_challenge'));
  assert.equal(calls[0].body.get('grant_type'), 'authorization_code');
  assert.equal(calls[0].body.get('client_id'), 'test-client');
  assert.equal(oauth.status().username, 'demo');
  assert.equal(JSON.stringify(oauth.status()).includes('secret'), false);
  await assert.rejects(oauth.finish({ code: 'replayed', state: login.state, browserState: login.state, verify }), /không khớp/);
  assert.equal(calls.length, 1);
});

test('OAuth rejects wrong browser, expired state and denied consent without a token request', async t => {
  const { oauth, calls, verify, advance } = fixture(t);
  const login = oauth.begin(3000);
  await assert.rejects(oauth.finish({ code: 'code', state: login.state, browserState: 'another-browser', verify }), /không khớp/);
  await assert.rejects(oauth.finish({ error: 'access_denied', state: login.state, browserState: login.state, verify }), /chưa cấp quyền/);
  const expired = oauth.begin(3000);
  advance(600001);
  await assert.rejects(oauth.finish({ code: 'code', state: expired.state, browserState: expired.state, verify }), /hết hạn/);
  assert.equal(calls.length, 0);
});

test('OAuth refuses insufficient scopes and never persists unverified tokens', async t => {
  const { oauth, replies, token, verify, authFile } = fixture(t);
  const login = oauth.begin(3000);
  replies.push({ ...token, scope: 'tweet.read users.read' });
  await assert.rejects(oauth.finish({ code: 'code', state: login.state, browserState: login.state, verify }), /chưa cấp đủ quyền/);
  assert.equal(fs.existsSync(authFile), false);
});

test('OAuth refreshes once for concurrent posting jobs and persists rotated refresh token', async t => {
  const { oauth, replies, calls, token, verify, advance, authFile } = fixture(t);
  const login = oauth.begin(3000);
  replies.push(token);
  await oauth.finish({ code: 'code', state: login.state, browserState: login.state, verify });
  advance(7200 * 1000);
  replies.push({ ...token, scope: undefined, access_token: 'new-access', refresh_token: 'new-refresh' });
  const [first, second] = await Promise.all([oauth.credentials(), oauth.credentials()]);
  assert.equal(first.accessToken, 'new-access');
  assert.equal(second.accessToken, 'new-access');
  assert.equal(calls.length, 2);
  assert.equal(calls[1].body.get('grant_type'), 'refresh_token');
  assert.equal(calls[1].body.get('refresh_token'), 'refresh-secret');
  assert.equal(JSON.parse(fs.readFileSync(authFile, 'utf8')).refreshToken, 'new-refresh');
});

test('OAuth token errors are sanitized and preserve the existing connection', async t => {
  const { oauth, replies, calls, authFile, verify } = fixture(t);
  fs.writeFileSync(authFile, JSON.stringify({ accessToken: 'old-access', username: 'old' }));
  const login = oauth.begin(3000);
  replies.push({ ok: false, status: 400, access_token: 'secret-from-error' });
  await assert.rejects(oauth.finish({ code: 'code', state: login.state, browserState: login.state, verify }), error => !error.message.includes('secret-from-error'));
  assert.equal(oauth.status().username, 'old');
  assert.equal(calls.length, 1);
});
