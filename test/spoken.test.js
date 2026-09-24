'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { freePort, up, start } = require('./helpers');

let mock, port, db, spoken;
before(async () => {
  port = await freePort();
  mock = start(['scripts/mock-openrouter.mjs', String(port)]);
  await up(`http://127.0.0.1:${port}/calls`);
  process.env.OPENROUTER_URL = `http://127.0.0.1:${port}/v1/chat/completions`;
  process.env.OPENROUTER_API_KEY = 'test-key';
  db = require('../lib/db');
  db.open(fs.mkdtempSync(path.join(os.tmpdir(), 'fe-spoken-')));
  spoken = require('../lib/spoken');
});
after(() => mock && mock.kill());

function video(lines) {
  const id = db.addVideo({ youtube_id: null, title: 't', lines: lines.map((written) => ({ written })) });
  return db.getVideo(id);
}
const calls = async () => (await fetch(`http://127.0.0.1:${port}/calls`)).json();

test('a good batch: every line worked, the spans on the right words', async () => {
  const v = video(['Je ne sais pas ce que tu veux dire.', 'Il y a un problème avec la voiture.', 'Bonjour à tous.', 'Nous ne savons pas encore.']);
  const r = await spoken.workBatch(v.lines);
  assert.deepEqual([r.worked, r.unworked], [4, 0]);
  const [a, b, c, d] = db.getVideo(v.id).lines;
  assert.equal(a.status, 'worked');
  assert.equal(a.spoken, "Chais pas c'que tu veux dire.");
  assert.deepEqual(a.spans.map((s) => a.spoken.slice(s.start, s.end)), ['Chais pas', 'Chais pas', "c'que"]);
  assert.deepEqual(a.patterns.sort(), ['e-dropped', 'je-ch', 'ne-dropped']);
  assert.equal(b.spoken.slice(b.spans[0].start, b.spans[0].end), 'Y a');
  assert.equal(c.spoken, 'Bonjour à tous.', 'a line with no pattern is said as written');
  assert.deepEqual(c.spans, []);
  assert.deepEqual(d.spans.map((s) => d.spoken.slice(s.start, s.end)), ['On sait', 'sait pas'], 'overlapping spans kept');
});

test('a batch with one bad pattern id: that line saved unworked with the reason, the rest worked', async () => {
  const v = video(['Il y a un problème avec la voiture.', 'Tu vois IDINVENTE', 'Voilà le problème.']);
  const r = await spoken.workBatch(v.lines);
  assert.deepEqual([r.worked, r.unworked], [2, 1]);
  const bad = db.getVideo(v.id).lines[1];
  assert.equal(bad.status, 'unworked');
  assert.match(bad.status_reason, /unknown pattern id "liaison-magique"/);
  assert.equal(bad.written, 'Tu vois IDINVENTE', 'the written line is kept');
});

test('a batch with offsets out of range: that line unworked, never dropped', async () => {
  const v = video(['Je ne sais pas HORSLIMITE', 'Il y a un problème avec la voiture.']);
  await spoken.workBatch(v.lines);
  const [bad, good] = db.getVideo(v.id).lines;
  assert.equal(bad.status, 'unworked');
  assert.match(bad.status_reason, /outside the spoken line/);
  assert.equal(good.status, 'worked');
});

test('a truncated answer: the lines that arrived whole are kept, the rest unworked as cut off', async () => {
  const v = video(['Je ne sais pas ce que tu veux dire. COUPE', 'Il y a un problème avec la voiture.', "Tu as vu ce qu'il a fait ?", 'Voilà le problème.']);
  const r = await spoken.workBatch(v.lines);
  const lines = db.getVideo(v.id).lines;
  assert.deepEqual(lines.map((l) => l.status), ['worked', 'worked', 'unworked', 'unworked']);
  assert.match(lines[3].status_reason, /cut off/);
  assert.deepEqual([r.worked, r.unworked], [2, 2]);
});

test('when the first model fails, the fallback answers the same batch', async () => {
  const before = (await calls()).calls;
  const v = video(['Il y a un problème avec la voiture. PANNE']);
  const r = await spoken.workBatch(v.lines);
  assert.equal(r.model, spoken.FALLBACK_MODEL);
  const after = await calls();
  assert.deepEqual(after.models.slice(before), [spoken.MODEL, spoken.FALLBACK_MODEL]);
  assert.equal(db.getVideo(v.id).lines[0].status, 'worked');
});

test('retry reruns only the lines not yet worked out', async () => {
  const v = video(['Voilà le problème.', 'Tu vois IDINVENTE']);
  await spoken.workBatch(v.lines);
  const before = (await calls()).calls;
  assert.equal(spoken.retryVideo(v.id), 1);
  await spoken.workVideo(v.id);
  const after = await calls();
  assert.equal(after.calls - before, 1);
  assert.equal(db.getVideo(v.id).lines[0].status, 'worked');
});

// --- the gate on each line, by itself --------------------------------------

test('false rejection: a valid answer with accents and apostrophes inside spans is accepted', () => {
  // As a model writes it: typographic apostrophes, accented letters, and
  // offsets miscounted by two — the span texts are right.
  const written = 'Ils sont déjà partis, je crois. Cela ne va pas.';
  const spokenLine = 'I sont déjà partis, j’crois. Ça va pas.';
  const item = {
    i: 0,
    spoken: spokenLine,
    spans: [
      { start: 0, end: 6, text: 'I sont', pattern: 'il-i' },
      { start: 22, end: 29, text: 'j’crois', pattern: 'e-dropped' },
      { start: 31, end: 41, text: 'Ça va pas', pattern: 'ca-for-cela' },
      { start: 31, end: 38, text: 'va pas', pattern: 'ne-dropped' },
    ],
    patterns: ['il-i', 'e-dropped', 'ca-for-cela', 'ne-dropped'],
  };
  const r = spoken.checkLine(item, written);
  assert.equal(r.ok, true, r.reason);
  assert.deepEqual(r.spans.map((s) => r.spoken.slice(s.start, s.end)), ['I sont', "j'crois", 'Ça va pas', 'va pas']);
  // written in decomposed form (e + combining accent), offsets exact for it
  const nfd = 'déjà vu'.normalize('NFD');
  const r2 = spoken.checkLine({ spoken: nfd, spans: [{ start: 0, end: nfd.length, text: nfd, pattern: 'run-together' }], patterns: ['run-together'] }, 'déjà vu');
  assert.equal(r2.ok, true, r2.reason);
  assert.equal(r2.spoken.slice(r2.spans[0].start, r2.spans[0].end), 'déjà vu');
});

test('the gate refuses what it must, and names why', () => {
  const ok = (item) => spoken.checkLine(item, 'x');
  assert.match(ok({ spoken: '' }).reason, /no spoken form/);
  assert.match(ok({ spoken: 'y a', spans: [{ start: 0, end: 3, pattern: 'il-y-a' }], patterns: ['nope'] }).reason, /unknown pattern id "nope"/);
  assert.match(ok({ spoken: 'y a', spans: [{ start: 0, end: 3, pattern: ['il-y-a', 'e-dropped'] }] }).reason, /exactly one pattern/);
  assert.match(ok({ spoken: 'y a', spans: [{ start: 2, end: 2, pattern: 'il-y-a' }] }).reason, /outside/);
  assert.equal(ok({ spoken: 'y a', spans: [{ start: 0, end: 3, pattern: 'il-y-a' }] }).ok, true, 'patterns may be left out; they come from the spans');
});

test('the answer reader salvages whole lines from a cut-off answer, and reads a fenced one', () => {
  const cut = '{"lines": [{"i": 0, "spoken": "y a", "spans": []}, {"i": 1, "spoken": "chais p';
  assert.deepEqual(spoken.readAnswer(cut), { items: [{ i: 0, spoken: 'y a', spans: [] }], truncated: true });
  assert.equal(spoken.readAnswer('```json\n{"lines": [{"i": 0, "spoken": "a"}]}\n```').items.length, 1);
});

test('time limits come from the expected answer size', () => {
  const small = spoken.budget([{ written: 'Oui.' }]);
  const big = spoken.budget(Array.from({ length: 40 }, () => ({ written: 'x'.repeat(60) })));
  assert.ok(big.timeoutMs > small.timeoutMs);
  assert.ok(big.maxTokens >= 40 * 110, 'room for forty lines');
  assert.ok(big.timeoutMs >= 100000 && big.timeoutMs <= 300000, `forty lines get ${big.timeoutMs} ms`);
});
