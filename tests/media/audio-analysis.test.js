import test from 'node:test';
import assert from 'node:assert/strict';
import { energyEnvelope, detectOnsets, findHighlightStart, snapScenesToBeats } from '../../src/media/audio-analysis.js';
import { planSlideshow } from '../../src/media/tiktok-slideshow.js';

const RATE = 11025;

// Quiet tone with short loud bursts ("hits") at the given times; louder between loudFrom and loudTo.
function synth(seconds, hits, { loudFrom = Infinity, loudTo = Infinity } = {}) {
  const samples = new Float32Array(seconds * RATE);
  for (let i = 0; i < samples.length; i++) {
    const t = i / RATE;
    const level = t >= loudFrom && t < loudTo ? 0.3 : 0.05;
    samples[i] = level * Math.sin(2 * Math.PI * 220 * t);
  }
  for (const hit of hits) {
    for (let i = Math.round(hit * RATE); i < Math.min(samples.length, Math.round((hit + 0.08) * RATE)); i++) {
      samples[i] += 0.6 * Math.sin(2 * Math.PI * 90 * i / RATE) * Math.exp(-(i / RATE - hit) * 30);
    }
  }
  return samples;
}

test('detectOnsets finds the hits within one analysis frame', () => {
  const hits = [1, 1.5, 2.25, 3, 4.1];
  const onsets = detectOnsets(energyEnvelope(synth(5, hits), RATE));
  assert.equal(onsets.length, hits.length, JSON.stringify(onsets));
  onsets.forEach((time, i) => assert.ok(Math.abs(time - hits[i]) <= 0.04, `${time} vs ${hits[i]}`));
});

test('findHighlightStart picks the loud section and enters on the hit just before it', () => {
  const hits = Array.from({ length: 50 }, (_, i) => i + 0.5);
  const envelope = energyEnvelope(synth(50, hits, { loudFrom: 20, loudTo: 34 }), RATE);
  const start = findHighlightStart(envelope, 0.02, 14, detectOnsets(envelope));
  assert.ok(start >= 18.4 && start <= 20.1, String(start));
  assert.equal(findHighlightStart(envelope.slice(0, 100), 0.02, 14), 0, 'track shorter than the video starts at 0');
});

test('snapScenesToBeats moves cuts onto nearby onsets and keeps the total length', () => {
  const plan = planSlideshow(6, { durationSeconds: 14, secondsPerImage: 2.6, transitionSeconds: 0.3 });
  const cuts = plan.scenes.slice(1).map(scene => (scene.start + plan.transitionFrames / 2) / 30);
  const onsets = cuts.map(cut => +(cut + 0.3).toFixed(3));
  const synced = snapScenesToBeats(plan, onsets);
  assert.equal(synced.beatSynced, true);
  assert.equal(synced.scenes.at(-1).end, plan.totalFrames);
  synced.scenes.slice(1).forEach((scene, i) => {
    assert.ok(Math.abs((scene.start + plan.transitionFrames / 2) / 30 - onsets[i]) < 0.04);
    assert.equal(synced.scenes[i].end, scene.start + plan.transitionFrames, 'scenes overlap by exactly one dissolve');
  });
  synced.scenes.forEach(scene => assert.equal(scene.frames, scene.end - scene.start));
});

test('snapScenesToBeats leaves cuts alone when no onset is close or a scene would get too short', () => {
  const plan = planSlideshow(4, { durationSeconds: 12 });
  assert.equal(snapScenesToBeats(plan, [0.1]).beatSynced, false);
  assert.equal(snapScenesToBeats(plan, []), plan);
});
