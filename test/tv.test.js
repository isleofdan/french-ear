'use strict';
// Photos from the TV, end to end against the mocks: the photo in, the
// subtitle read, "Save for later", the French worked out, the tally. And the
// checks on the model's answers, alone.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { freePort, up, start } = require('./helpers');
const { checkSubtitleLine } = require('../lib/pictures');
const { checkWorkOut, guessLanguage, budget } = require('../lib/tv');

const dir = path.join(__dirname, 'fixtures', 'pictures');
const kids = [];
let base, cookie, dataDir;
after(() => kids.forEach((k) => k.kill()));

before(async () => {
  const [ytPort, orPort, port] = [await freePort(), await freePort(), await freePort()];
  kids.push(start(['scripts/mock-youtube.mjs', String(ytPort)]));
  kids.push(start(['scripts/mock-openrouter.mjs', String(orPort)]));
  await up(`http://127.0.0.1:${ytPort}/`);
  await up(`http://127.0.0.1:${orPort}/calls`);
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fe-tv-'));
  kids.push(start(['server.js'], {
    PORT: String(port), DATA_DIR: dataDir, COOKIE_INSECURE: '1',
    APP_PASSWORD: 'pw', COOKIE_SECRET: 'x'.repeat(64), OPENROUTER_API_KEY: 'k',
    OPENROUTER_URL: `http://127.0.0.1:${orPort}/v1/chat/completions`, YT_BASE: `http://127.0.0.1:${ytPort}`,
  }));
  base = `http://127.0.0.1:${port}`;
  await up(`${base}/health`);
  const r = await fetch(`${base}/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ passphrase: 'pw' }) });
  cookie = r.headers.get('set-cookie').split(';')[0];
});

async function call(method, p, body) {
  const r = await fetch(`${base}${p}`, { method, headers: { cookie, 'content-type': 'application/json', accept: 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json() };
}
async function addPhoto(name) {
  const f = new FormData();
  f.append('photo', new Blob([fs.readFileSync(path.join(dir, name))], { type: 'image/png' }), name);
  const r = await fetch(`${base}/api/moments`, { method: 'POST', headers: { cookie, accept: 'application/json' }, body: f });
  return { status: r.status, body: await r.json() };
}
async function until(id, done) {
  for (let i = 0; i < 200; i++) {
    const m = (await call('GET', `/api/moments/${id}`)).body;
    if (done(m) && !m.busy) return m;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`moment ${id} never got there`);
}
const read = (id) => until(id, (m) => m.read_status !== 'reading');
const settled = (id) => until(id, (m) => !['waiting', 'working'].includes(m.work_status));
async function gotPastMe() {
  const p = (await call('GET', '/api/patterns')).body.patterns;
  return Object.fromEntries(p.map((x) => [x.id, x.counts.got_past_me]));
}

test('a French subtitle: read off the photo, then the ordinary "as said" pass; got past me recorded once', async () => {
  const before = await gotPastMe();
  const r = await addPhoto('tv-french.png');
  assert.equal(r.status, 201);
  assert.equal(r.body.saved, false, 'the moment is kept from the moment the photo is in');
  const m = await read(r.body.id);
  assert.equal(m.read_status, 'read');
  assert.equal(m.subtitle, 'Je ne sais pas ce que tu veux dire.');
  assert.equal(m.subtitle_lang, 'fr');
  const photo = await fetch(`${base}/api/moments/${m.id}/photo`, { headers: { cookie } });
  assert.equal(photo.status, 200);
  assert.equal(photo.headers.get('content-type'), 'image/png');
  const files = fs.readdirSync(path.join(dataDir, 'photos'));
  assert.ok(files.length >= 1, 'the photo is on the volume, in photos/');

  assert.equal((await call('POST', `/api/moments/${m.id}`, { heard_note: 'shay pa', scene_note: 'He is annoyed with her' })).status, 200);
  const done = await settled(m.id);
  assert.equal(done.work_status, 'worked');
  assert.equal(done.sure, 'high');
  assert.equal(done.line.written, 'Je ne sais pas ce que tu veux dire.');
  assert.equal(done.line.spoken, "Chais pas c'que tu veux dire.");
  assert.deepEqual(done.line.patterns.sort(), ['e-dropped', 'je-ch', 'ne-dropped']);
  assert.equal(done.heard_note, 'shay pa');
  const after = await gotPastMe();
  for (const p of ['je-ch', 'ne-dropped', 'e-dropped']) assert.equal(after[p], (before[p] || 0) + 1, p);

  // Saved again (the notes edited): worked out again, but the tally counts a moment once.
  await call('POST', `/api/moments/${m.id}`, { scene_note: 'He is annoyed' });
  await settled(m.id);
  assert.deepEqual(await gotPastMe(), after);
});

test('an English subtitle and his notes: one call, a French line with valid spans, got past me recorded', async () => {
  const before = await gotPastMe();
  const { body } = await addPhoto('tv-english.png');
  const m = await read(body.id);
  assert.equal(m.subtitle, "There's something wrong.");
  assert.equal(m.subtitle_lang, 'en');
  await call('POST', `/api/moments/${m.id}`, { heard_note: 'ya kelk shoz', scene_note: 'The car will not start' });
  const done = await settled(m.id);
  assert.equal(done.work_status, 'worked');
  assert.equal(done.sure, 'medium');
  assert.equal(done.line.written, 'Il y a quelque chose qui ne va pas.');
  assert.equal(done.line.spoken, 'Y a quelque chose qui va pas.');
  for (const s of done.line.spans) assert.ok(s.start >= 0 && s.end <= done.line.spoken.length && s.start < s.end);
  assert.equal(done.line.spoken.slice(done.line.spans[1].start, done.line.spans[1].end), 'qui va pas', 'a miscounted offset is moved to where its text is');
  assert.equal(done.line.status, 'worked');
  const after = await gotPastMe();
  assert.equal(after['il-y-a'], (before['il-y-a'] || 0) + 1);
  assert.equal(after['ne-dropped'], (before['ne-dropped'] || 0) + 1);

  // Its line keeps like any other, and shows in the kept list as from the TV.
  assert.equal((await call('POST', `/api/lines/${done.line.id}/keep`)).status, 200);
  const kept = (await call('GET', '/api/kept')).body.items.find((k) => k.id === done.line.id);
  assert.equal(kept.moment_id, m.id);
  assert.equal(kept.video.caption_track, 'tv');
  // Moments are not videos: the home page's videos leave them out, its moments list them.
  const home = (await call('GET', '/api/home')).body;
  assert.ok(home.videos.every((v) => v.youtube_id));
  assert.equal(home.moments[0].id, m.id);
});

test('sure = low: the line shows, and nothing is recorded to the tally', async () => {
  const before = await gotPastMe();
  const { body } = await addPhoto('tv-english.png');
  await read(body.id);
  await call('POST', `/api/moments/${body.id}`, { heard_note: 'DOUTE' });
  const done = await settled(body.id);
  assert.equal(done.work_status, 'worked');
  assert.equal(done.sure, 'low');
  assert.ok(done.line.spoken);
  assert.deepEqual(await gotPastMe(), before);
  assert.equal(done.tallied, false);
});

test('no subtitle on the photo: the moment is saved with his notes and no line', async () => {
  const { body } = await addPhoto('tv-none.png');
  const m = await read(body.id);
  assert.equal(m.read_status, 'none');
  assert.equal(m.subtitle, null);
  await call('POST', `/api/moments/${m.id}`, { heard_note: '', scene_note: 'Two women arguing in a kitchen' });
  const done = await settled(m.id);
  assert.equal(done.work_status, 'nothing');
  assert.equal(done.line, null);
  assert.equal(done.scene_note, 'Two women arguing in a kitchen');
  assert.ok((await call('GET', '/api/moments')).body.items.some((x) => x.id === m.id));
});

test('no subtitle, but what it sounded like: worked out from the sound note', async () => {
  const { body } = await addPhoto('tv-none.png');
  await read(body.id);
  await call('POST', `/api/moments/${body.id}`, { heard_note: 'shay pa', scene_note: '' });
  const done = await settled(body.id);
  assert.equal(done.work_status, 'worked');
  assert.equal(done.line.spoken, 'Chais pas.');
});

test('a bad model answer leaves the moment saved and retriable; try again after a fix works it out', async () => {
  const { body } = await addPhoto('tv-english.png');
  await read(body.id);
  await call('POST', `/api/moments/${body.id}`, { heard_note: 'MAUVAIS', scene_note: 'at the station' });
  const bad = await settled(body.id);
  assert.equal(bad.work_status, 'unworked');
  assert.match(bad.work_reason, /unknown pattern id "liaison-magique"/);
  assert.equal(bad.heard_note, 'MAUVAIS');
  assert.equal(bad.scene_note, 'at the station');

  // both models down: the same, with the reason
  await call('POST', `/api/moments/${body.id}`, { heard_note: 'PANNE-TV' });
  const down = await settled(body.id);
  assert.equal(down.work_status, 'unworked');
  assert.match(down.work_reason, /500/);

  // the note corrected and saved again: worked out
  await call('POST', `/api/moments/${body.id}`, { heard_note: 'ya' });
  assert.equal((await settled(body.id)).work_status, 'worked');
  // "try again" on a worked moment reruns without harm
  assert.equal((await call('POST', `/api/moments/${body.id}/retry`)).status, 202);
  assert.equal((await settled(body.id)).work_status, 'worked');
});

test('a subtitle he corrects is used, and its language guessed from the words', async () => {
  const { body } = await addPhoto('tv-none.png');
  await read(body.id);
  await call('POST', `/api/moments/${body.id}`, { subtitle: 'Je ne sais pas ce que tu veux dire.', heard_note: '' });
  const done = await settled(body.id);
  assert.equal(done.subtitle_lang, 'fr');
  assert.equal(done.subtitle_edited, true);
  assert.equal(done.line.spoken, "Chais pas c'que tu veux dire.", 'a French subtitle goes through the "as said" pass');
});

test('what is not a photo is refused; a photo too big is refused', async () => {
  const f = new FormData();
  f.append('photo', new Blob([Buffer.from('not a picture at all')], { type: 'image/png' }), 'x.png');
  const r = await fetch(`${base}/api/moments`, { method: 'POST', headers: { cookie, accept: 'application/json' }, body: f });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /JPEG or PNG/);
  const big = Buffer.alloc(9 * 1024 * 1024); big.set([0xff, 0xd8, 0xff, 0xe0]);
  const g = new FormData();
  g.append('photo', new Blob([big], { type: 'image/jpeg' }), 'big.jpg');
  const r2 = await fetch(`${base}/api/moments`, { method: 'POST', headers: { cookie, accept: 'application/json' }, body: g });
  assert.equal(r2.status, 413);
});

// --- the checks alone ---------------------------------------------------------

test('the subtitle check: a subtitle, none, and answers it refuses', () => {
  assert.deepEqual(checkSubtitleLine({ subtitle: true, text: '  Il y a  quelque chose\nqui ne va pas. ', language: 'fr' }), { ok: true, none: false, written: 'Il y a quelque chose qui ne va pas.', language: 'fr' });
  assert.equal(checkSubtitleLine({ subtitle: true, text: "There's something wrong.", language: 'English' }).language, 'en');
  assert.deepEqual(checkSubtitleLine({ subtitle: false, text: '', language: null }), { ok: true, none: true });
  assert.deepEqual(checkSubtitleLine({ transcript: false, lines: [] }), { ok: true, none: true });
  assert.equal(checkSubtitleLine({ subtitle: true, text: '', language: 'fr' }).ok, false);
  assert.equal(checkSubtitleLine({ subtitle: true, text: 'Hola, ¿qué tal?', language: 'es' }).ok, false);
  assert.equal(checkSubtitleLine(null).ok, false);
});

test('the work-out gate refuses what the "as said" gate refuses, and a missing line or sure word', () => {
  const good = { written: 'Il y a un problème.', spoken: 'Y a un problème.', spans: [{ start: 0, end: 3, text: 'Y a', pattern: 'il-y-a' }], patterns: ['il-y-a'], sure: 'high', why: 'Clear.' };
  assert.equal(checkWorkOut(good).ok, true);
  assert.match(checkWorkOut({ ...good, spans: [{ start: 0, end: 3, pattern: 'liaison-magique' }] }).reason, /unknown pattern id/);
  assert.match(checkWorkOut({ ...good, spans: [{ start: 5, end: 99, pattern: 'il-y-a' }] }).reason, /outside the spoken line/);
  assert.match(checkWorkOut({ ...good, written: '' }).reason, /no French line/);
  assert.match(checkWorkOut({ ...good, sure: 'certain' }).reason, /high, medium or low/);
  assert.match(checkWorkOut({ ...good, spoken: '' }).reason, /no spoken form/);
});

test('false rejection: a right answer with its labels imperfect is accepted', () => {
  // The substance is right; the wrapping is sloppy the way real models are:
  // offsets miscounted (the text is right), the pattern given as a one-item
  // list, a pattern missing from "patterns" though its span names it, the sure
  // word capitalised with a space, no "why", the spoken line with a curly
  // apostrophe.
  const r = checkWorkOut({
    written: "Tu as vu ce qu'il a fait ?",
    spoken: 'T’as vu c’qu’il a fait ?',
    spans: [{ start: 2, end: 6, text: "T'as", pattern: ['tu-t'] }, { start: 30, end: 40, text: "c'qu'il", pattern: 'e-dropped' }],
    patterns: ['tu-t'],
    sure: ' Medium',
  });
  assert.equal(r.ok, true, r.reason);
  assert.equal(r.sure, 'medium');
  assert.equal(r.spoken, "T'as vu c'qu'il a fait ?");
  assert.deepEqual(r.patterns.sort(), ['e-dropped', 'tu-t']);
  assert.deepEqual(r.spans.map((s) => r.spoken.slice(s.start, s.end)), ["T'as", "c'qu'il"]);
  assert.equal(r.why, '');
  // and a line with no pattern at all, said as written, is a right answer too
  const plain = checkWorkOut({ written: 'Bonjour à tous.', spoken: 'Bonjour à tous.', spans: [], patterns: [], sure: 'high', why: 'Nothing changes.' });
  assert.equal(plain.ok, true);
  assert.deepEqual(plain.patterns, []);
});

test('the language of a typed subtitle, and the time limit from the answer size', () => {
  assert.equal(guessLanguage('Je ne sais pas.'), 'fr');
  assert.equal(guessLanguage("I don't know what you mean."), 'en');
  assert.equal(guessLanguage('Ok.', 'fr'), 'fr');
  const b = budget();
  assert.ok(b.timeoutMs >= 30000 && b.timeoutMs <= 60000, `${b.timeoutMs}`);
  assert.ok(b.maxTokens >= 1000);
});
