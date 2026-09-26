'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const db = require('../lib/db');

// Three videos: two YouTube videos with timed lines (one older, one newer)
// and one pasted without timings; plus a typed line and a photo from the TV,
// neither of which has a clip.
function fixture() {
  db.open(fs.mkdtempSync(path.join(os.tmpdir(), 'fe-drills-')));
  const work = (videoId, rows) => {
    const lines = db.getVideo(videoId).lines;
    rows.forEach((patterns, i) => db.setLineWorked(lines[i].id, { spoken: lines[i].written, spans: [], patterns }));
    return lines.map((l) => l.id);
  };
  const older = db.addVideo({ youtube_id: 'olderVideo1', title: 'Older', caption_track: 'fr', lines: [
    { start_s: 0, end_s: 3, written: 'Il y a un problème avec la voiture.' },
    { start_s: 3, end_s: 6, written: 'Je ne sais pas ce que tu veux dire.' },
    { start_s: 6, end_s: 9, written: 'Bonjour à tous.' },
  ] });
  const olderIds = work(older, [['il-y-a'], ['je-ch', 'ne-dropped'], []]);
  const untimed = db.addVideo({ youtube_id: 'untimedVid1', title: 'Untimed', caption_track: 'pasted', lines: [
    { written: 'Il y a du monde ce soir.' },
    { written: 'Tu as vu ça ?' },
  ] });
  work(untimed, [['il-y-a'], ['tu-t']]);
  const newer = db.addVideo({ youtube_id: 'newerVideo1', title: 'Newer', caption_track: 'fr', lines: [
    { start_s: 10, end_s: 14, written: 'Il y a personne ici.' },
    { start_s: 14, end_s: 17, written: 'Tu as faim ?' },
    { start_s: 17, end_s: 20, written: 'Il faut que je te parle.' },
  ] });
  const newerIds = work(newer, [['il-y-a'], ['tu-t'], ['il-dropped', 'e-dropped']]);
  // a typed line and a photo from the TV: lines with patterns, no clip
  const typed = db.addVideo({ youtube_id: null, title: 'typed', lines: [{ written: 'Il y a un chat.' }] });
  work(typed, [['il-y-a']]);
  const tv = db.addVideo({ youtube_id: null, title: 'tv', caption_track: 'tv', lines: [{ start_s: 1, end_s: 2, written: 'Il y a eu un bruit.' }] });
  work(tv, [['il-y-a']]);
  return { olderIds, newerIds };
}

test('clips per pattern: timed lines of his YouTube videos only, newest video first', () => {
  const { olderIds, newerIds } = fixture();
  const ilya = db.clips('il-y-a');
  assert.deepEqual(ilya.map((c) => c.id), [newerIds[0], olderIds[0]], 'the newer video first; untimed, typed and TV lines left out');
  assert.equal(ilya[0].video.title, 'Newer');
  assert.equal(ilya[0].video.youtube_id, 'newerVideo1');
  assert.equal(ilya[1].start_s, 0);
  assert.equal(ilya[1].end_s, 3);
  assert.deepEqual(db.clips('tu-t').map((c) => c.id), [newerIds[1]]);
  assert.deepEqual(db.clips('oui-non'), []);
});

test('clip counts for all twenty in one call; Mix counts each clip once', () => {
  fixture();
  assert.deepEqual(db.clipCounts(), { 'il-y-a': 2, 'je-ch': 1, 'ne-dropped': 1, 'tu-t': 1, 'il-dropped': 1, 'e-dropped': 1 });
  assert.equal(db.clips().length, 5, 'a line with no pattern ("Bonjour à tous.") is no clip');
});

// --- a round ---------------------------------------------------------------

const { makeRound, wrongChoices, norm } = require('../lib/drills');
const { IDS } = require('../lib/patterns');

// A seeded stand-in for Math.random, so a failure can be run again.
function seeded(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}
const clip = (id, written, patterns = ['il-y-a']) => ({ id, written, patterns, start_s: id, end_s: id + 2, video: { id: 1, youtube_id: 'x', title: 't' } });
const SENTENCES = Array.from({ length: 30 }, (_, i) => `Phrase numéro ${i} avec ${'des mots '.repeat(i % 5)}ici.`);

test('a round never repeats a clip, and stops at 10', () => {
  const clips = SENTENCES.map((w, i) => clip(i + 1, w));
  for (let seed = 1; seed <= 50; seed++) {
    const round = makeRound({ clips, pool: clips, rand: seeded(seed) });
    assert.equal(round.length, 10);
    assert.equal(new Set(round.map((it) => it.clip.id)).size, 10, `seed ${seed}`);
  }
  // fewer clips than ten: the round is the clips there are
  assert.equal(makeRound({ clips: clips.slice(0, 4), pool: clips, rand: seeded(7) }).length, 4);
  // the same clip twice in the list, or two clips with the same words, count once
  const dup = [clip(1, 'Il y a un problème.'), clip(1, 'Il y a un problème.'), clip(2, 'il y a un problème'), clip(3, 'Y a personne.')];
  assert.equal(makeRound({ clips: dup, pool: SENTENCES.map((w) => ({ written: w })), rand: seeded(3) }).length, 2);
});

test('the wrong choices never equal the real line, and the real one is among the three', () => {
  const pool = [...SENTENCES, 'Phrase numéro 3 avec des mots des mots des mots ici', '[Musique]'].map((w) => ({ written: w }));
  for (let seed = 1; seed <= 50; seed++) {
    const real = SENTENCES[3];
    const round = makeRound({ clips: [clip(9, real)], pool, rand: seeded(seed) });
    const { choices } = round[0];
    assert.equal(choices.length, 3);
    assert.ok(choices.includes(real));
    assert.equal(choices.filter((c) => norm(c) === norm(real)).length, 1, 'the same words with other punctuation are not a wrong choice');
    assert.ok(!choices.includes('[Musique]'), 'a sound in brackets is never a choice');
    assert.equal(new Set(choices.map(norm)).size, 3);
  }
});

test('wrong choices are of about the same length', () => {
  const real = 'Il y a un problème avec la voiture ce matin.';
  const pool = ['Oui.', 'Non.', 'Bon.', 'Tu viens ce soir chez nous avec les enfants ?', 'On sait pas encore quand ils vont arriver ici.', 'Ah.']
    .map((w) => ({ written: w }));
  const got = wrongChoices(real, pool, seeded(1));
  assert.ok(got.every((w) => w.length > 20), got.join(' | '));
});

test('with fewer than three lines to draw from, "What was said?" is left out', () => {
  const clips = [clip(1, 'Il y a un problème.'), clip(2, 'Y a personne.')];
  const round = makeRound({ clips, pool: clips, rand: seeded(1) });
  assert.equal(round.length, 2);
  assert.ok(round.every((it) => it.choices === null));
  // one pattern: no "Which pattern?" either; Mix still asks it
  assert.ok(round.every((it) => it.pattern_choices === null));
  const mix = makeRound({ clips, pool: clips, mix: true, rand: seeded(1) });
  assert.ok(mix.every((it) => it.choices === null && it.pattern_choices.length === 4));
});

test('Mix: four pattern names, the line\'s own among them; shaky clips drawn more often', () => {
  const clips = SENTENCES.slice(0, 20).map((w, i) => clip(i + 1, w, i < 10 ? ['je-ch', 'ne-dropped'] : ['il-y-a']));
  const round = makeRound({ clips, pool: clips, mix: true, rand: seeded(5) });
  for (const it of round) {
    assert.equal(it.pattern_choices.length, 4);
    assert.equal(new Set(it.pattern_choices).size, 4);
    assert.ok(it.pattern_choices.every((id) => IDS.includes(id)));
    assert.ok(it.clip.patterns.every((p) => it.pattern_choices.includes(p)));
  }
  let shakyFirst = 0;
  for (let seed = 1; seed <= 200; seed++) {
    const r = makeRound({ clips, pool: clips, mix: true, shaky: new Set(['je-ch']), rand: seeded(seed), size: 5 });
    shakyFirst += r.filter((it) => it.clip.patterns.includes('je-ch')).length;
  }
  assert.ok(shakyFirst / (200 * 5) > 0.65, `shaky clips were ${(100 * shakyFirst / 1000).toFixed(0)}% of the picks (half the clips are shaky)`);
});
