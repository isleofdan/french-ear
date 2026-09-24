'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseTranscript } = require('../lib/transcript');

const EXPECTED = [
  { start_s: 0, end_s: 3, written: 'Bonjour à tous.' },
  { start_s: 3, end_s: 12, written: 'Je ne sais pas ce que tu veux dire.' },
  { start_s: 12, end_s: 18, written: "Tu as vu ce qu'il a fait ?" },
];

test('(a) a timestamp on its own line, the text on the next', () => {
  const paste = 'Transcript\n\n0:00\nBonjour à tous.\n0:03\nJe ne sais pas ce que tu veux dire.\n\n0:12\nTu as vu ce qu\'il a fait ?\n';
  assert.deepEqual(parseTranscript(paste), { timed: true, lines: EXPECTED });
});

test('(b) timestamp and text on one line', () => {
  const paste = '0:00 Bonjour à tous.\r\n0:03 Je ne sais pas ce que tu veux dire.\r\n0:12 Tu as vu ce qu\'il a fait ?';
  assert.deepEqual(parseTranscript(paste), { timed: true, lines: EXPECTED });
});

test('(c) h:mm:ss timestamps, in either shape', () => {
  const a = '1:02:03\nIl y a un problème.\n1:02:07\nIl faut que je te parle.';
  const b = '01:02:03 Il y a un problème.\n01:02:07 Il faut que je te parle.';
  for (const paste of [a, b]) {
    assert.deepEqual(parseTranscript(paste).lines, [
      { start_s: 3723, end_s: 3727, written: 'Il y a un problème.' },
      { start_s: 3727, end_s: 3733, written: 'Il faut que je te parle.' },
    ]);
  }
});

test('(d) no timestamps: lines saved without times', () => {
  const paste = 'Transcript\nBonjour à tous.\n\nJe ne sais pas ce que tu veux dire.\n';
  assert.deepEqual(parseTranscript(paste), {
    timed: false,
    lines: [
      { start_s: null, end_s: null, written: 'Bonjour à tous.' },
      { start_s: null, end_s: null, written: 'Je ne sais pas ce que tu veux dire.' },
    ],
  });
});

test('text wrapped over several lines after one timestamp is one line; spoken-length labels go', () => {
  const paste = '0:05\n5 seconds\nAlors, moi je pense\nque c\'est bien.\n1:10\n1 minute, 10 seconds\n[Musique]';
  assert.deepEqual(parseTranscript(paste).lines, [
    { start_s: 5, end_s: 70, written: "Alors, moi je pense que c'est bien." },
    { start_s: 70, end_s: 76, written: '[Musique]' },
  ]);
});

test('a line that is only a number or a time of day in the text is not mistaken for a timestamp', () => {
  const r = parseTranscript('0:01 On se voit à 10:30 demain ?\n0:04 2024 était une bonne année.');
  assert.equal(r.lines[0].written, 'On se voit à 10:30 demain ?');
  assert.equal(r.lines[1].written, '2024 était une bonne année.');
});

test('an empty paste gives no lines', () => {
  assert.deepEqual(parseTranscript('  \n\nTranscript\n'), { timed: false, lines: [] });
});

test('the whole YouTube page copied with Ctrl+A: only the transcript is taken (the shape seen live, 24 Sep 2026)', () => {
  const page = require('node:fs').readFileSync(require('node:path').join(__dirname, 'fixtures', 'youtube-page-copy.txt'), 'utf8');
  const r = parseTranscript(page);
  assert.equal(r.timed, true);
  assert.equal(r.lines.length, 17);
  assert.deepEqual(r.lines.slice(0, 3), [
    { start_s: 0, end_s: 2, written: 'Bonjour les amis et bienvenue dans un' },
    { start_s: 2, end_s: 6, written: "nouvel épisode d'iz French. Aujourd'hui," },
    { start_s: 6, end_s: 7, written: 'nous allons simplement demander aux' },
  ]);
  assert.deepEqual(r.lines.at(-1), { start_s: 526, end_s: 532, written: '[Musique]' }, 'the page after the transcript is not glued on');
  for (const l of r.lines) assert.doesNotMatch(l.written, /New|Channel|Related|ago|Reply/, `no page text in "${l.written}"`);
});
