'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { states } = require('../lib/tally');

let n = 0;
const ev = (kind, pattern_id, line_id) => ({ id: ++n, kind, pattern_id, line_id });
const stateOf = (events, id) => states(events).patterns.find((p) => p.id === id).state;

test('six clean Ear-first appearances make a pattern solid', () => {
  const events = [1, 2, 3, 4, 5, 6].map((line) => ev('watched_clean', 'il-y-a', line));
  assert.equal(stateOf(events, 'il-y-a'), 'solid');
});

test('one keep makes a pattern shaky, even with six clean appearances', () => {
  const events = [1, 2, 3, 4, 5, 6].map((line) => ev('watched_clean', 'tu-t', line));
  events.push(ev('keep', 'tu-t', 7));
  assert.equal(stateOf(events, 'tu-t'), 'shaky');
});

test('a pattern never seen is not met yet', () => {
  assert.equal(stateOf([ev('looked', 'il-y-a', 1)], 'oui-non'), 'not-met');
});

test('a got past me makes it shaky; it passes out of the last 200 events', () => {
  const events = [ev('got_past_me', 'je-ch', 1)];
  assert.equal(stateOf(events, 'je-ch'), 'shaky');
  for (let i = 0; i < 200; i++) events.push(ev('looked', 'ne-dropped', 100 + i));
  assert.equal(stateOf(events, 'je-ch'), 'seen', 'older than the last 200: seen, no trouble yet');
  for (const line of [11, 12, 13, 14, 15]) events.push(ev('watched_clean', 'je-ch', line));
  assert.equal(stateOf(events, 'je-ch'), 'solid');
});

test('five clean appearances must be five different lines', () => {
  const events = [1, 1, 1, 2, 2, 3].map((line) => ev('watched_clean', 'e-dropped', line));
  assert.equal(stateOf(events, 'e-dropped'), 'seen');
});

test('shaky first, then seen, solid, not met yet; totals add to twenty', () => {
  const events = [ev('looked', 'il-y-a', 1), ev('got_past_me', 'tu-t', 2), ...[1, 2, 3, 4, 5].map((l) => ev('watched_clean', 'je-ch', l))];
  const { patterns, totals } = states(events);
  assert.deepEqual(patterns.slice(0, 3).map((p) => p.state), ['shaky', 'seen', 'solid']);
  assert.equal(patterns[3].state, 'not-met');
  assert.equal(totals.shaky + totals.seen + totals.solid + totals['not-met'], 20);
});

// --- drills (Practice) -------------------------------------------------------

test('ten lines right in drills, no got past me: solid', () => {
  const events = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((line) => ev('drill_clean', 'il-y-a', line));
  assert.equal(stateOf(events, 'il-y-a'), 'solid');
});

test('nine lines right in drills: not solid, unless Ear first is clean too', () => {
  const events = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((line) => ev('drill_clean', 'tu-t', line));
  assert.equal(stateOf(events, 'tu-t'), 'seen');
  events.push(ev('drill_clean', 'tu-t', 9), ev('drill_clean', 'tu-t', 1));
  assert.equal(stateOf(events, 'tu-t'), 'seen', 'the same line right again is still nine lines');
  for (const line of [21, 22, 23, 24, 25]) events.push(ev('watched_clean', 'tu-t', line));
  assert.equal(stateOf(events, 'tu-t'), 'solid', 'five clean Ear-first lines make it solid on their own');
});

test('a wrong drill answer (a got past me) makes it shaky, even after ten right', () => {
  const events = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((line) => ev('drill_clean', 'je-ch', line));
  events.push(ev('got_past_me', 'je-ch', 11));
  assert.equal(stateOf(events, 'je-ch'), 'shaky');
  assert.equal(states(events).patterns.find((p) => p.id === 'je-ch').counts.drill_clean, 10);
});
