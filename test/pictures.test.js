'use strict';
// Transcript lines read out of pictures (lib/pictures.js), against the
// stand-in OpenRouter and the picture fixtures in test/fixtures/pictures/
// (synthetic screenshots of a transcript panel; answers.json holds what a
// model would say for each).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { freePort, up, start } = require('./helpers');

const dir = path.join(__dirname, 'fixtures', 'pictures');
const pic = (name) => ({ name, bytes: fs.readFileSync(path.join(dir, name)) });

let mock, port, pictures;
before(async () => {
  port = await freePort();
  mock = start(['scripts/mock-openrouter.mjs', String(port)]);
  await up(`http://127.0.0.1:${port}/calls`);
  process.env.OPENROUTER_URL = `http://127.0.0.1:${port}/v1/chat/completions`;
  process.env.OPENROUTER_API_KEY = 'test-key';
  pictures = require('../lib/pictures');
});
after(() => mock && mock.kill());
const calls = async () => (await fetch(`http://127.0.0.1:${port}/calls`)).json();

test('one screenshot: its lines, times and text exactly as the answer gave them', async () => {
  const r = await pictures.readPictures([pic('shot-1.png')]);
  assert.deepEqual(r.lines.map((l) => [l.start_s, l.written]), [
    [0, 'Bonjour les amis et bienvenue dans un'],
    [2, "nouvel épisode d'iz French. Aujourd'hui,"],
    [6, 'nous allons simplement demander aux'],
    [7, "passants si ils sont heureux. C'est"],
    [10, 'parti.'],
    [12, '[Musique]'],
    [19, 'Est-ce que vous êtes heureux ?'],
  ]);
  assert.equal(r.lines[0].end_s, 2, 'a line ends where the next begins');
  assert.equal(r.lines[6].end_s, 25, 'the last lasts six seconds');
  assert.deepEqual(r.pictures.map((p) => [p.name, p.read, p.fresh]), [['shot-1.png', 7, 7]]);
});

test('an overlapping pair merges by time, the first text seen kept, each picture counted', async () => {
  const r = await pictures.readPictures([pic('shot-1.png'), pic('shot-2.png')]);
  assert.deepEqual(r.lines.map((l) => l.start_s), [0, 2, 6, 7, 10, 12, 19, 21, 23, 25, 107, 108]);
  assert.equal(r.lines[6].written, 'Est-ce que vous êtes heureux ?', 'the first picture read "êtes"; the second\'s "etes" is not kept');
  assert.equal(r.lines[10].written, "rend heureux ? Qu'est-ce qui me rend");
  const [a, b] = r.pictures;
  assert.deepEqual([a.read, a.fresh], [7, 7]);
  assert.deepEqual([b.read, b.fresh], [8, 5]);
  assert.deepEqual(b.dropped, { 'no text': 1 }, 'the entry cut off at the bottom edge is dropped and counted');
});

test('the same pair in the other order gives the same times', async () => {
  const r = await pictures.readPictures([pic('shot-2.png'), pic('shot-1.png')]);
  assert.deepEqual(r.lines.map((l) => l.start_s), [0, 2, 6, 7, 10, 12, 19, 21, 23, 25, 107, 108]);
  assert.deepEqual(r.pictures.map((p) => p.fresh), [8, 4]);
});

test('a picture with no transcript: refused in plain words', async () => {
  await assert.rejects(pictures.readPictures([pic('no-transcript.png')]),
    (e) => e.status === 400 && e.message === "I couldn't find a transcript in this picture.");
});

test('a picture with no transcript beside good ones: the good ones stand, that one counted as none', async () => {
  const r = await pictures.readPictures([pic('shot-1.png'), pic('no-transcript.png')]);
  assert.equal(r.lines.length, 7);
  assert.deepEqual(r.pictures.map((p) => [p.read, p.transcript]), [[7, true], [0, false]]);
});

test('false rejection: accents, curly apostrophes, guillemets, h:mm:ss and a leading zero are all accepted as read', async () => {
  const before = (await calls()).calls;
  const r = await pictures.readPictures([pic('shot-accents.png')]);
  assert.deepEqual(r.lines.map((l) => [l.start_s, l.written]), [
    [3723, 'Aujourd’hui, ça va être génial, c’est-à-dire…'],
    [3725, 'Qu’est-ce qu’il a dit ? « Là-bas », à côté.'],
    [3729, "L’hôtel où j’suis allé, c'était pas cher."],
  ]);
  assert.deepEqual(r.pictures[0].dropped, {});
  // the first model failed on this one: the fallback read it
  const after = await calls();
  assert.deepEqual(after.models.slice(before), [pictures.IMAGE_MODEL, pictures.IMAGE_FALLBACK_MODEL]);
  assert.equal(r.pictures[0].model, pictures.IMAGE_FALLBACK_MODEL);
});

test('both models failing: a plain message, nothing guessed', async () => {
  const broken = Buffer.concat([fs.readFileSync(path.join(dir, 'shot-1.png')), Buffer.from('PANNE-TOTALE')]);
  await assert.rejects(pictures.readPictures([{ name: 'x.png', bytes: broken }]),
    (e) => e.status === 502 && /couldn't read the pictures just now/.test(e.message));
});

test('a file that is not a PNG or JPEG is refused before any call', async () => {
  const before = (await calls()).calls;
  await assert.rejects(pictures.readPictures([{ name: 'notes.txt', bytes: Buffer.from('0:00\nBonjour à tous.') }]),
    (e) => e.status === 400 && /notes\.txt isn't a picture I can read/.test(e.message));
  assert.equal((await calls()).calls, before);
});

test('each line checked: bad times, empty text and times going backwards are dropped and counted', () => {
  const { lines, dropped } = pictures.checkPicture([
    { time: '0:05', text: 'Bonjour.' },
    { time: '0:5', text: 'mal lu' },
    { time: '0:07', text: '   ' },
    { time: '0:03', text: 'en arrière' },
    { time: '0:61', text: 'pas une heure' },
    { time: '0:09', text: 'Ça va ?' },
    { time: '0:09', text: 'Même temps, gardé.' },
    'pas un objet',
  ]);
  assert.deepEqual(lines, [
    { start_s: 5, written: 'Bonjour.' },
    { start_s: 9, written: 'Ça va ?' },
    { start_s: 9, written: 'Même temps, gardé.' },
  ]);
  assert.deepEqual(dropped, { 'the time did not read as a time': 2, 'no text': 1, 'the time went backwards': 1, 'not an object': 1 });
});

test('the answer read: fenced JSON, a no-transcript answer, and noise', () => {
  assert.equal(pictures.readPictureAnswer('```json\n{"transcript": true, "lines": [{"time": "0:00", "text": "a"}]}\n```').items.length, 1);
  assert.equal(pictures.readPictureAnswer('{"transcript": false, "lines": []}').transcript, false);
  assert.equal(pictures.readPictureAnswer('I cannot see a transcript.'), null);
});

test('the time limit comes from the answer size, not a guess', () => {
  const { maxTokens, timeoutMs } = pictures.budget();
  assert.ok(maxTokens >= 3000 && maxTokens <= 4000, `${maxTokens}`);
  assert.ok(timeoutMs >= 60000 && timeoutMs <= 90000, `${timeoutMs}`);
});
