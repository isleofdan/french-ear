'use strict';
// Caption fragments joined into whole sentences (lib/sentences.js).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { joinFragments } = require('../lib/sentences');
const { parseTranscript } = require('../lib/transcript');

const f = (start_s, end_s, written) => ({ start_s, end_s, written });
const rows = (lines) => lines.map((l) => [l.start_s, l.end_s, l.written]);

test('a run that ends on "?" after two fragments is one line', () => {
  const out = joinFragments([f(0, 2, 'Est-ce que tu viens'), f(2, 4, 'ce soir ?'), f(4, 6, 'Oui, bien sûr.')]);
  assert.deepEqual(rows(out), [[0, 4, 'Est-ce que tu viens ce soir ?'], [4, 6, 'Oui, bien sûr.']]);
});

test('a run that hits the 4-fragment cap closes as is', () => {
  const out = joinFragments([f(0, 1, 'alors je'), f(1, 2, 'pense que'), f(2, 3, 'on va'), f(3, 4, 'partir demain'), f(4, 5, 'matin.')]);
  assert.deepEqual(rows(out), [[0, 4, 'alors je pense que on va partir demain'], [4, 5, 'matin.']]);
});

test('a run that hits the 12-second cap closes as is', () => {
  const out = joinFragments([f(0, 5, 'et puis après'), f(5, 10, 'on est allés'), f(10, 15, 'chez ma tante'), f(15, 20, 'à la campagne.')]);
  assert.deepEqual(rows(out), [[0, 15, 'et puis après on est allés chez ma tante'], [15, 20, 'à la campagne.']]);
});

test('a paste with no times joins by the sentence ends and the fragment cap only', () => {
  const { lines, timed } = parseTranscript('Je ne sais\npas ce que tu\nveux dire.\nIl y a\nun problème\navec la\nvoiture\nce matin');
  assert.equal(timed, false);
  assert.deepEqual(rows(joinFragments(lines)), [
    [null, null, 'Je ne sais pas ce que tu veux dire.'],
    [null, null, 'Il y a un problème avec la voiture'],
    [null, null, 'ce matin'],
  ]);
});

test('the real whole-page copy: sentences, cut where one ends inside a fragment', () => {
  const text = fs.readFileSync(path.join(__dirname, 'fixtures', 'youtube-page-copy.txt'), 'utf8');
  const out = joinFragments(parseTranscript(text).lines);
  // auto-caption spelling kept as is
  assert.deepEqual(out[0], f(0, 4.8, "Bonjour les amis et bienvenue dans un nouvel épisode d'iz French."));
  assert.deepEqual(out.slice(1, 5).map((l) => l.written), [
    "Aujourd'hui, nous allons simplement demander aux passants si ils sont heureux.",
    "C'est parti.",
    '[Musique]',
    'Est-ce que vous êtes heureux ?',
  ]);
  assert.equal(out[1].start_s, 4.8, 'the rest of a cut fragment starts where the sentence before it ended');
  assert.equal(out[out.length - 1].written, '[Musique]', 'a bracketed sound stands alone');
  assert.equal(out.length, 16, '17 caption fragments make 16 lines');
  for (let i = 1; i < out.length; i++) assert.ok(out[i].start_s >= out[i - 1].start_s, 'times never go backwards');
});

test('lines that are already sentences come back unchanged', () => {
  const lines = [f(0.5, 3.7, 'Bonjour à tous.'), f(4, 7.2, '[Musique]'), f(7.5, 10.7, 'Il faut que je te parle.')];
  assert.deepEqual(joinFragments(lines), lines);
});
