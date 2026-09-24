'use strict';
// Where each pattern stands for him. The one place the rule lives (it is
// written out in words in docs/DESIGN.md, "The tally"):
//
//   not met yet — no event names the pattern: it has appeared in no line he
//                 has opened or watched.
//   shaky       — one or more "got past me" or "keep" events for it among his
//                 last 200 events.
//   solid       — it has appeared in at least five different lines he watched
//                 in Ear first without a "What was that?" on them, and no
//                 "got past me" for it among his last 200 events.
//   seen        — anything else: met, no trouble yet, not yet solid.
//
// Checked in that order: shaky wins over solid. Shown shaky first, then seen,
// solid, not met yet.

const { PATTERNS } = require('./patterns');

const RECENT = 200;
const SOLID_LINES = 5;
const ORDER = ['shaky', 'seen', 'solid', 'not-met'];

// events: every event row, oldest first ({ id, kind, pattern_id, line_id }).
function states(events) {
  const recent = events.slice(-RECENT);
  const out = [];
  for (const p of PATTERNS) {
    const mine = events.filter((e) => e.pattern_id === p.id);
    const mineRecent = recent.filter((e) => e.pattern_id === p.id);
    const cleanLines = new Set(mine.filter((e) => e.kind === 'watched_clean').map((e) => e.line_id));
    const counts = {
      got_past_me: mine.filter((e) => e.kind === 'got_past_me').length,
      keep: mine.filter((e) => e.kind === 'keep').length,
      looked: mine.filter((e) => e.kind === 'looked').length,
      watched_clean: cleanLines.size,
    };
    let state;
    if (mine.length === 0) state = 'not-met';
    else if (mineRecent.some((e) => e.kind === 'got_past_me' || e.kind === 'keep')) state = 'shaky';
    else if (cleanLines.size >= SOLID_LINES && !mineRecent.some((e) => e.kind === 'got_past_me')) state = 'solid';
    else state = 'seen';
    out.push({ id: p.id, name: p.name, explain: p.explain, examples: p.examples, state, counts });
  }
  out.sort((a, b) => ORDER.indexOf(a.state) - ORDER.indexOf(b.state));
  const totals = { solid: 0, shaky: 0, seen: 0, 'not-met': 0 };
  for (const p of out) totals[p.state]++;
  return { patterns: out, totals };
}

module.exports = { states, RECENT, SOLID_LINES };
