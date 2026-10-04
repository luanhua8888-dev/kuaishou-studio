import test from 'node:test';
import assert from 'node:assert/strict';
import { relevantHashtags, ensureCaptionHashtags } from './relevance-tags.js';

test('uses only topic tags supported by the title', () => {
  const vi = relevantHashtags('Một chú mèo trong vườn hoa', 'vi').split(' ');
  const en = relevantHashtags('Cat in the garden', 'en').split(' ');
  assert.equal(vi.length, 5);
  assert.equal(en.length, 5);
  assert.ok(vi.includes('#meo') && vi.includes('#vuonhoa'));
  assert.ok(en.includes('#cat') && en.includes('#garden'));
  assert.ok(!en.includes('#food'));
});

test('unknown content still gets five broad tags without invented subject or viral claims', () => {
  const tags = relevantHashtags('Một khoảnh khắc', 'vi').split(' ');
  assert.equal(tags.length, 5);
  assert.ok(!tags.includes('#meo') && !tags.includes('#viral'));
  assert.equal(relevantHashtags('', 'en').split(' ').length, 5);
});

test('recognizes Chinese source tags and translated mood/daily life topics', () => {
  assert.match(relevantHashtags('读书 听歌 #日常碎片', 'en'), /#music #reading/);
  assert.ok(relevantHashtags('今日份悲哀', 'vi').startsWith('#tamtrang'));
  const landscape = relevantHashtags('#风景 A peaceful landscape', 'en');
  assert.ok(landscape.includes('#nature') && landscape.includes('#quietmoments'));
  assert.ok(!relevantHashtags('Hoàn thành', 'vi').includes('#vuonhoa'));
});

test('every topic and language generates exactly five distinct tags', () => {
  for (const title of ['cat', 'dog', 'food', 'travel', 'nature', 'garden', 'ocean', 'sunrise', 'rain', 'music', 'reading', 'love', 'peaceful', 'sad', 'daily life', 'anime', 'unknown']) {
    for (const lang of ['en', 'vi', 'both', 'raw']) {
      const tags = relevantHashtags(title, lang).split(' ');
      assert.equal(tags.length, 5, `${title}/${lang}`);
      assert.equal(new Set(tags).size, 5);
    }
  }
});

test('custom captions keep tags, fill missing slots and deduplicate case variants', () => {
  const text = ensureCaptionHashtags('My caption #Music #music');
  const tags = text.match(/#[\p{L}\p{N}_]+/gu);
  assert.equal(tags.length, 5);
  assert.equal(new Set(tags.map(tag => tag.toLowerCase())).size, 5);
  assert.ok(tags.some(tag => tag.toLowerCase() === '#music'));
  assert.ok(!text.includes('#moments'));
});
