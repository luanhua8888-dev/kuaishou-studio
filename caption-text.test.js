import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { normalizeCaptionText, removeCaptionMentions, readJsonBody } from './caption-text.js';

test('removes account mentions from generated and custom captions', () => {
  assert.equal(removeCaptionMentions('Xem @creator và @shop.name #dulich'), 'Xem và #dulich');
  assert.equal(removeCaptionMentions('@tác_giả\n\nCảnh đẹp @旅行'), 'Cảnh đẹp');
  assert.equal(removeCaptionMentions('Liên hệ hello@example.com'), 'Liên hệ');
  assert.equal(removeCaptionMentions('Mèo nhỏ #meo'), 'Mèo nhỏ #meo');
});

test('decorative letters become font-safe text, preserving Vietnamese accents and digits', () => {
  assert.equal(normalizeCaptionText('𝒍𝒐𝒗𝒆 𝒈𝒐𝒆𝒔 𝒂𝒘𝒂𝒚'), 'love goes away');
  assert.equal(normalizeCaptionText('Khoảnh khắc bình yên 2026'), 'Khoảnh khắc bình yên 2026');
  assert.equal(normalizeCaptionText('???? 𝒈𝒐𝒆𝒔 𝒂𝒘𝒂𝒚 □ �'), 'goes away');
  assert.equal(normalizeCaptionText('Vì sao?'), 'Vì sao?');
});

test('JSON preserves Vietnamese and emoji split across every byte boundary', async () => {
  const expected = { moodQuote: 'Khoảnh khắc bình yên 🌿 𝒍𝒐𝒗𝒆' };
  const bytes = Buffer.from(JSON.stringify(expected));
  const stream = Readable.from([...bytes].map(byte => Buffer.from([byte])));
  assert.deepEqual(await readJsonBody(stream), expected);
});

test('invalid JSON reports a parse error', async () => {
  await assert.rejects(readJsonBody(Readable.from([Buffer.from('{bad')])));
});
