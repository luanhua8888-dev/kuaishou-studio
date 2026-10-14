import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveGeminiApiKey,
  buildGeminiPrompt,
  parseGeminiStoryResponse,
  generateAIStoryScenes
} from '../src/content/ai-story.js';

test('resolveGeminiApiKey retrieves explicit key, env var, or empty fallback', () => {
  assert.equal(resolveGeminiApiKey('AIzaSyTest123'), 'AIzaSyTest123');
  
  const oldEnv = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = 'AIzaSyEnvKey';
  try {
    assert.equal(resolveGeminiApiKey(), 'AIzaSyEnvKey');
    assert.equal(resolveGeminiApiKey('AIzaSyExplicit'), 'AIzaSyExplicit');
  } finally {
    if (oldEnv === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = oldEnv;
  }
});

test('buildGeminiPrompt includes title, moodQuote, author and sceneCount', () => {
  const prompt = buildGeminiPrompt({
    title: '海边日落晚霞',
    moodQuote: 'Hoàng hôn rực rỡ bên bờ biển',
    author: 'Nhiếp ảnh gia',
    musicName: 'Biển chiều',
    musicArtist: 'Nhạc sĩ',
    sceneCount: 4
  });

  assert.ok(prompt.includes('海边日落晚霞'));
  assert.ok(prompt.includes('Hoàng hôn rực rỡ bên bờ biển'));
  assert.ok(prompt.includes('Nhiếp ảnh gia'));
  assert.ok(prompt.includes('Biển chiều'));
  assert.ok(prompt.includes('đúng 4 câu'));
  assert.ok(prompt.includes('JSON array'));
});

test('parseGeminiStoryResponse parses JSON arrays and handles markdown blocks', () => {
  // Plain JSON array
  const raw1 = '["Câu 1: Hoàng hôn buông.", "Câu 2: Sóng vỗ bờ cát.", "Câu 3: Gió thổi dịu êm.", "Câu 4: Chúc bạn an yên."]';
  const res1 = parseGeminiStoryResponse(raw1, 4);
  assert.equal(res1.length, 4);
  assert.equal(res1[0], 'Câu 1: Hoàng hôn buông.');

  // Markdown codeblock wrapped JSON
  const raw2 = '```json\n["Ánh chiều tà muộn màng.", "Bình yên nơi góc biển.", "Mọi muộn phiền tan biến."]\n```';
  const res2 = parseGeminiStoryResponse(raw2, 3);
  assert.equal(res2.length, 3);
  assert.equal(res2[1], 'Bình yên nơi góc biển.');

  // Truncates when longer than requested sceneCount
  const raw3 = '["Cảnh 1", "Cảnh 2", "Cảnh 3", "Cảnh 4", "Cảnh 5"]';
  const res3 = parseGeminiStoryResponse(raw3, 3);
  assert.equal(res3.length, 3);
  assert.equal(res3[2], 'Cảnh 3');

  // Throws on invalid input
  assert.throws(() => parseGeminiStoryResponse('Không phải JSON', 4));
});

test('generateAIStoryScenes falls back gracefully to context-aware presets when no API key is provided', async () => {
  const scenes = await generateAIStoryScenes({
    title: '今天又是元气满满的一天',
    moodQuote: 'Hôm nay lại là một ngày tràn đầy năng lượng',
    sceneCount: 4,
    apiKey: ''
  });

  assert.ok(Array.isArray(scenes));
  assert.equal(scenes.length, 4);
  scenes.forEach(line => {
    assert.equal(typeof line, 'string');
    assert.ok(line.trim().length > 0);
  });
});
