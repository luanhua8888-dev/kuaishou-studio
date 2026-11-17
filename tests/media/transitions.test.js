import test from 'node:test';
import assert from 'node:assert/strict';
import { pickTransitions, TRANSITIONS, ACCENT_TRANSITIONS } from '../../src/media/transitions.js';

test('mixed transitions alternate an accent wipe with a calm dissolve and never use zoom', () => {
  const picks = pickTransitions(9, 'post-123');
  assert.equal(picks.length, 9);
  picks.forEach((name, i) => {
    if (i % 2 === 1) assert.equal(name, 'fade');
    else assert.ok(ACCENT_TRANSITIONS.includes(name), name);
  });
  const accents = picks.filter((_, i) => i % 2 === 0);
  accents.slice(1).forEach((name, i) => assert.notEqual(name, accents[i], 'same accent twice in a row'));
  assert.ok(TRANSITIONS.every(name => !/zoom/.test(name)));
});

test('the same post always gets the same transitions, different posts can differ', () => {
  assert.deepEqual(pickTransitions(6, 'abc'), pickTransitions(6, 'abc'));
  const variants = new Set(Array.from({ length: 20 }, (_, i) => pickTransitions(6, `seed-${i}`).join(',')));
  assert.ok(variants.size > 1);
});

test('a fixed transition style applies to every cut and unknown styles are rejected', () => {
  assert.deepEqual(pickTransitions(3, 'x', 'fade'), ['fade', 'fade', 'fade']);
  assert.deepEqual(pickTransitions(0, 'x'), []);
  assert.throws(() => pickTransitions(2, 'x', 'zoomin'), /transitionStyle/);
});
