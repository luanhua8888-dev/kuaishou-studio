import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { nextYouTubeSlot, reserveYouTubeSlot, releaseYouTubeSlot, scheduledYouTubeStatus } from '../../src/platforms/youtube/schedule.js';

test('YouTube uses available windows without catching up missed windows', () => {
  const now = Date.parse('2026-11-12T10:00:00Z');
  const entries = [];
  for (let i = 0; i < 4; i++) entries.push({ publishAt: nextYouTubeSlot(now, entries) });
  assert.deepEqual(entries.map(x => x.publishAt), [
    '2026-11-12T13:00:00.000Z', '2026-11-12T20:00:00.000Z',
    '2026-11-13T02:00:00.000Z', '2026-11-13T13:00:00.000Z'
  ]);
  assert.equal(nextYouTubeSlot(Date.parse('2026-11-12T22:30:00Z')), '2026-11-13T02:00:00.000Z');
});

test('reservations survive restart and uncertain uploads keep their slot', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'youtube-schedule-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const options = { statePath: path.join(dir, 'schedule.json'), now: Date.parse('2026-11-12T10:00:00Z') };
  const first = reserveYouTubeSlot(options);
  assert.equal(first.publishAt, '2026-11-12T13:00:00.000Z');
  assert.equal(reserveYouTubeSlot(options).publishAt, '2026-11-12T20:00:00.000Z');
  releaseYouTubeSlot(first.id, options);
  const saved = JSON.parse(fs.readFileSync(options.statePath, 'utf8'));
  assert.equal(saved.entries.some(e => e.id === first.id), false);
  fs.writeFileSync(options.statePath, '{broken');
  assert.throws(() => reserveYouTubeSlot(options));
  assert.equal(fs.existsSync(`${options.statePath}.lock`), false);
});

test('scheduled uploads are private and cannot accidentally publish a past schedule', () => {
  const future = new Date(Date.now() + 86400000).toISOString();
  assert.deepEqual(scheduledYouTubeStatus(future), { privacyStatus: 'private', publishAt: future, selfDeclaredMadeForKids: false });
  assert.throws(() => scheduledYouTubeStatus('2020-01-01T00:00:00Z'));
});

test('malformed saved timestamps stop scheduling instead of overbooking', () => {
  assert.throws(() => nextYouTubeSlot(Date.now(), [{ publishAt: 'bad' }]));
});

test('caps full days at three prime slots and respects old reservations', () => {
  const now = Date.parse('2026-11-11T23:00:00Z');
  const entries = [];
  for (let i = 0; i < 9; i++) entries.push({ publishAt: nextYouTubeSlot(now, entries) });
  const days = {};
  for (const item of entries) days[item.publishAt.slice(0, 10)] = (days[item.publishAt.slice(0, 10)] || 0) + 1;
  assert.deepEqual(Object.values(days), [3, 3, 3]);
  assert.equal(nextYouTubeSlot(Date.parse('2026-11-12T10:00:00Z'), [{ publishAt: '2026-11-12T23:00:00Z' }]), '2026-11-13T02:00:00.000Z');
});
