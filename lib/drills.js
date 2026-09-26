'use strict';
// A drill round: up to ten clips from his own videos, each with the questions
// asked about it. Everything comes from his data: the clip is a line he
// watched, and the wrong choices for "What was said?" are other lines from his
// videos, of about the same length. No model call, no invented sentence.
//
//   one pattern — its clips, shuffled. "What was said?" only: the pattern is
//                 given.
//   Mix         — every clip of every pattern, clips with a pattern shaky for
//                 him drawn three times as often. "What was said?", then
//                 "Which pattern?" (four names: the line's own and others).
//
// A round never has the same clip twice, nor two clips with the same words.
// With fewer than two other lines to draw wrong choices from, "What was
// said?" is left out for that clip (choices: null).

const { IDS } = require('./patterns');

const ROUND = 10;
const SHAKY_WEIGHT = 3;
const NEAREST = 6; // wrong choices come from the six lines nearest in length

const norm = (s) => String(s || '').toLowerCase().normalize('NFC').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const isSound = (s) => /^\s*\[[^\]]*\]\s*$/.test(s); // "[Musique]"

function shuffle(list, rand) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Draws without putting back, each item as likely as its weight.
function weightedOrder(items, weight, rand) {
  const left = items.map((it) => ({ it, w: weight(it) }));
  const out = [];
  while (left.length) {
    let r = rand() * left.reduce((s, x) => s + x.w, 0);
    let k = 0;
    while (k < left.length - 1 && r >= left[k].w) { r -= left[k].w; k++; }
    out.push(left.splice(k, 1)[0].it);
  }
  return out;
}

// Two other lines of about the same length, or null when there are not two.
function wrongChoices(written, pool, rand) {
  const mine = norm(written);
  const seen = new Set([mine]);
  const others = [];
  for (const p of pool) {
    const n = norm(p.written);
    if (!n || seen.has(n) || isSound(p.written)) continue;
    seen.add(n);
    others.push(p.written);
  }
  if (others.length < 2) return null;
  const byGap = others
    .map((w) => ({ w, d: Math.abs(w.length - written.length) }))
    .sort((a, b) => a.d - b.d);
  // Lines within 40% of its length, when there are two; else the two nearest.
  const close = byGap.filter((x) => x.d <= Math.max(6, written.length * 0.4));
  const near = (close.length >= 2 ? close : byGap).slice(0, NEAREST).map((x) => x.w);
  return shuffle(near, rand).slice(0, 2);
}

// Four pattern ids: the line's own (at most three) and others from the twenty.
function patternChoices(patterns, rand) {
  const own = shuffle([...new Set(patterns)], rand).slice(0, 3);
  const rest = shuffle(IDS.filter((id) => !own.includes(id)), rand).slice(0, 4 - own.length);
  return shuffle([...own, ...rest], rand);
}

// clips: the clips to draw from (db.clips). pool: every line of his videos
// ({ written }) for the wrong choices. mix: true for a Mix round. shaky: a
// Set of pattern ids shaky for him. Answers the round's items.
function makeRound({ clips, pool, mix = false, shaky = new Set(), rand = Math.random, size = ROUND }) {
  const order = mix
    ? weightedOrder(clips, (c) => (c.patterns.some((p) => shaky.has(p)) ? SHAKY_WEIGHT : 1), rand)
    : shuffle(clips, rand);
  const ids = new Set(), texts = new Set(), items = [];
  for (const c of order) {
    if (items.length >= size) break;
    const t = norm(c.written);
    if (ids.has(c.id) || texts.has(t)) continue;
    ids.add(c.id);
    texts.add(t);
    const wrong = wrongChoices(c.written, pool, rand);
    items.push({
      clip: c,
      choices: wrong ? shuffle([c.written, ...wrong], rand) : null,
      pattern_choices: mix ? patternChoices(c.patterns, rand) : null,
    });
  }
  return items;
}

module.exports = { makeRound, wrongChoices, patternChoices, norm, ROUND, SHAKY_WEIGHT };
