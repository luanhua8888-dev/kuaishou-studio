import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { PROJECT_ROOT } from '../src/paths.js';
import { AUTH_FILE as instagramAuth } from '../src/platforms/instagram/poster.js';
import { AUTH_FILE as tiktokAuth } from '../src/platforms/tiktok/poster.js';
import { AUTH_FILE as threadsAuth } from '../src/platforms/threads/poster.js';
import { AUTH_FILE as xAuth } from '../src/platforms/x/poster.js';
import { CLIENT_FILE } from '../src/platforms/x/oauth.js';
import { readTikTokSlideshowConfig } from '../src/media/tiktok-slideshow.js';

test('platform modules still resolve existing sessions and configuration at the project root', () => {
  for (const [actual, filename] of [
    [instagramAuth, 'ig_auth.json'], [tiktokAuth, 'tiktok_auth.json'],
    [threadsAuth, 'threads_auth.json'], [xAuth, 'x_auth.json'], [CLIENT_FILE, '.x-client.json'],
  ]) assert.equal(actual, path.join(PROJECT_ROOT, filename));
  const configPath = path.join(PROJECT_ROOT, 'tiktok-slideshow.config.json');
  const config = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf8')) : {};
  assert.deepEqual(readTikTokSlideshowConfig(), { ...config, text: { ...config.text }, audio: { ...config.audio } });
});

test('the stable server entry point serves UI and configuration from a different working directory', async t => {
  const listener = net.createServer();
  await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  // Threads-only mode cannot start the shared publishing queue.
  const child = spawn(process.execPath, [path.join(PROJECT_ROOT, 'server.js'), `--port=${port}`, '--threads-only', '--no-browser'], {
    cwd: os.tmpdir(), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  t.after(async () => {
    if (child.exitCode !== null) return;
    const exited = new Promise(resolve => child.once('exit', resolve));
    child.kill();
    await exited;
  });
  const base = `http://127.0.0.1:${port}`;
  let response;
  for (let i = 0; i < 100; i++) {
    assert.equal(child.exitCode, null, output);
    try { response = await fetch(base); break; } catch { await delay(100); }
  }
  assert.ok(response, output);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), fs.readFileSync(path.join(PROJECT_ROOT, 'public/index.html'), 'utf8'));
  const queueResponse = await fetch(`${base}/api/sheet-queue`);
  assert.equal(queueResponse.status, 200);
  const queue = await queueResponse.json();
  assert.equal(queue.running, false);
  assert.equal(queue.threadsOnly, true);
  const aiSettingsResponse = await fetch(`${base}/api/ai-settings`);
  assert.equal(aiSettingsResponse.status, 200);
  const aiSettings = await aiSettingsResponse.json();
  if (fs.existsSync(path.join(PROJECT_ROOT, '.setting'))) {
    const settings = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, '.setting'), 'utf8'));
    // Check the path without printing credentials even if the assertion fails.
    assert.equal(aiSettings.hasKey, Boolean(settings.geminiApiKey || settings.aiApiKey));
  }
});
