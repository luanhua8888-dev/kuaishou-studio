// Transitions without any zoom: soft dissolves and wipes only.
export const ACCENT_TRANSITIONS = ['smoothleft', 'smoothup', 'smoothright', 'hblur'];
export const TRANSITIONS = ['fade', ...ACCENT_TRANSITIONS];

function seededRandom(seed) {
  // FNV-1a hash of the seed feeds a mulberry32 generator, so a post always renders the same way.
  let h = 2166136261;
  for (const ch of String(seed ?? '')) h = Math.imul(h ^ ch.codePointAt(0), 16777619);
  return () => {
    h = (h + 0x6D2B79F5) | 0;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Pick one xfade transition per cut.
 * "mixed" alternates a calm dissolve with an accent wipe, never the same accent twice in a row,
 * so the pace changes without looking flashy. Any other value uses that transition for every cut.
 */
export function pickTransitions(cuts, seed, style = 'mixed') {
  if (!Number.isInteger(cuts) || cuts <= 0) return [];
  if (style !== 'mixed') {
    if (!TRANSITIONS.includes(style)) throw new Error(`transitionStyle phải là mixed hoặc một trong: ${TRANSITIONS.join(', ')}`);
    return Array(cuts).fill(style);
  }
  const random = seededRandom(seed);
  const result = [];
  let lastAccent = null;
  for (let i = 0; i < cuts; i++) {
    if (i % 2 === 1) { result.push('fade'); continue; }
    const choices = ACCENT_TRANSITIONS.filter(name => name !== lastAccent);
    lastAccent = choices[Math.floor(random() * choices.length)];
    result.push(lastAccent);
  }
  return result;
}
