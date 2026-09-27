'use strict';
// The transcript read straight from a YouTube link by Gemini through
// OpenRouter: the checks on its answer, then end to end against the mocks
// (the server, the stand-in YouTube and the stand-in OpenRouter).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { freePort, up, start } = require('./helpers');
const linkread = require('../lib/linkread');

// --- the checks on the answer -----------------------------------------------

test('a right answer is accepted: accents, both kinds of apostrophe, hours, fractions, a missing end', () => {
  const items = [
    { start: '0:00', end: '0:03', text: "Qu’est-ce qu'il y a là-bas, à côté de l’église ?" },
    { start: '0:03', end: '0:03', text: 'Ça, c’est très étrange… « Où êtes-vous ? »' },
    { start: '0:07.5', text: "Aujourd'hui, nous allons demander aux passants s'ils sont heureux." },
    { start: '1:02:03', end: '1:02:07', text: '  Il  y a   un problème. ' },
    { start: 3730, end: '1:02:12', text: 'Euh, je ne sais pas.' },
  ];
  const { lines, dropped } = linkread.checkLinkLines(items);
  assert.deepEqual(dropped, {});
  assert.equal(lines.length, 5, 'every line kept');
  assert.equal(lines[0].written, "Qu’est-ce qu'il y a là-bas, à côté de l’église ?", 'the text exactly, apostrophes as written');
  assert.equal(lines[1].end_s, 3, 'an end equal to its start is allowed');
  assert.equal(lines[2].start_s, 7.5);
  assert.equal(lines[2].end_s, 3723, 'a missing end is filled from the next line\'s start');
  assert.equal(lines[3].start_s, 3723);
  assert.equal(lines[3].written, 'Il y a un problème.');
  assert.equal(lines[4].start_s, 3730, 'a plain number of seconds reads as a time');
});

test('a bad line is dropped with its reason counted, never guessed', () => {
  const { lines, dropped } = linkread.checkLinkLines([
    { start: '0:01', end: '0:03', text: 'Bonjour.' },
    { start: 'soon', end: '0:05', text: 'No time.' },
    { start: '0:06', end: '0:04', text: 'The end before the start.' },
    { start: '0:07', end: '0:09', text: '   ' },
    { start: '0:00', end: '0:02', text: 'Backwards.' },
    'not an object',
    { start: '0:61', end: '1:02', text: 'Sixty-one seconds.' },
    { start: '0:10', end: '0:12', text: 'Au revoir.' },
  ]);
  assert.deepEqual(lines.map((l) => l.written), ['Bonjour.', 'Au revoir.']);
  assert.deepEqual(dropped, {
    'the start did not read as a time': 2, 'the end came before the start': 1, 'no text': 1, 'the time went backwards': 1, 'not an object': 1,
  });
});

test('the answer is read with or without a code fence; not JSON is null', () => {
  assert.equal(linkread.readLinkAnswer('```json\n{"lines":[{"start":"0:01","text":"Oui."}]}\n```').items.length, 1);
  assert.deepEqual(linkread.readLinkAnswer('{"lines": []}').items, []);
  assert.equal(linkread.readLinkAnswer('I cannot watch videos.'), null);
  assert.equal(linkread.readLinkAnswer('[1, 2]'), null);
});

test('the time limit comes from the expected answer: a ten-minute video is ~120 lines, under five minutes', () => {
  const ten = linkread.linkBudget(600);
  assert.equal(ten.lines, 120);
  assert.ok(ten.timeoutMs >= 150000 && ten.timeoutMs <= 300000, `${ten.timeoutMs}`);
  assert.ok(ten.maxTokens >= 120 * 35 * 2, 'room for every line, and for thinking');
  const unknown = linkread.linkBudget(null);
  assert.equal(unknown.lines, 180, 'length unknown: fifteen minutes assumed');
  assert.ok(linkread.linkBudget(3 * 3600).lines <= 600, 'capped');
});

test('the request: the instruction and the watch link as a video part, Gemini, pinned to Google AI Studio', () => {
  const r = linkread.linkRequest('Zq2KsoD8vJI', linkread.linkBudget(600));
  assert.equal(r.model, 'google/gemini-2.5-flash');
  assert.deepEqual(r.provider, { only: ['google-ai-studio'], allow_fallbacks: false });
  assert.deepEqual(r.messages[1].content[1], { type: 'video_url', video_url: { url: 'https://www.youtube.com/watch?v=Zq2KsoD8vJI' } });
  assert.match(r.messages[0].content, /"je ne sais pas", not "chais pas"/);
  assert.match(r.messages[0].content, /Ignore text shown on the screen/);
});

// --- end to end --------------------------------------------------------------

const kids = [];
let base, cookie, orBase;
after(() => kids.forEach((k) => k.kill()));

before(async () => {
  const [ytPort, orPort, port] = [await freePort(), await freePort(), await freePort()];
  kids.push(start(['scripts/mock-youtube.mjs', String(ytPort)]));
  kids.push(start(['scripts/mock-openrouter.mjs', String(orPort)]));
  orBase = `http://127.0.0.1:${orPort}`;
  await up(`http://127.0.0.1:${ytPort}/`);
  await up(`${orBase}/calls`);
  kids.push(start(['server.js'], {
    PORT: String(port), DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'fe-link-')), COOKIE_INSECURE: '1',
    APP_PASSWORD: 'pw', COOKIE_SECRET: 'x'.repeat(64), OPENROUTER_API_KEY: 'k',
    OPENROUTER_URL: `${orBase}/v1/chat/completions`, YT_BASE: `http://127.0.0.1:${ytPort}`,
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
// The video's page asks until the read is done: saved, or refused.
async function readDone(yt) {
  for (let i = 0; i < 200; i++) {
    const info = (await call('GET', `/api/youtube/${yt}`)).body;
    if (!info.reading) return info;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('the read never finished');
}
async function worked(id) {
  for (let i = 0; i < 100; i++) {
    const v = (await call('GET', `/api/videos/${id}`)).body;
    if (!v.counts.pending && !v.working) return v;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('never worked out');
}

test('a link alone: Gemini reads the video; its lines come with times, a bad one dropped, then the "as said" pass', async () => {
  const r = await call('POST', '/api/videos', { link: 'https://www.youtube.com/watch?v=geminiGood1&t=42' });
  assert.equal(r.status, 202, 'answered at once: the read runs in the background');
  assert.deepEqual(r.body, { youtube_id: 'geminiGood1', reading: true, page: '/watch?yt=geminiGood1&t=42', start_s: 42 });
  assert.equal((await call('GET', '/api/youtube/geminiGood1')).body.reading, true, 'the page can say "Reading the video…"');
  const info = await readDone('geminiGood1');
  assert.ok(info.video_id, 'saved');
  assert.equal(info.failure, null);
  const v = await worked(info.video_id);
  assert.equal(v.caption_track, 'gemini');
  assert.deepEqual(v.lines.map((l) => l.written), [
    'Bonjour à tous.', 'Je ne sais pas ce que tu veux dire.', 'Il y a un problème avec la voiture.', "Tu as vu ce qu'il a fait ?", 'Il faut que je te parle.',
    "Qu’est-ce qu'il y a là-bas, à côté de l’église ?",
  ], 'the line with no time is gone; the rest in order');
  assert.deepEqual(v.lines.slice(0, 3).map((l) => [l.start_s, l.end_s]), [[0, 3], [4, 7], [7, 10]], 'times as Gemini gave them');
  assert.ok(v.lines.every((l) => l.status === 'worked'), 'the "as said" pass ran on every line');
  const { videos } = await (await fetch(`${orBase}/calls`)).json();
  const asked = videos.find((c) => /geminiGood1/.test(c.url));
  assert.deepEqual(asked, { model: 'google/gemini-2.5-flash', provider: { only: ['google-ai-studio'], allow_fallbacks: false }, url: 'https://www.youtube.com/watch?v=geminiGood1' });
  const again = await call('POST', '/api/videos', { link: 'https://youtu.be/geminiGood1' });
  assert.equal(again.status, 200, 'the same link again opens the saved video, no second read');
  assert.equal(again.body.id, info.video_id);
});

test('too few good lines is a refusal: nothing saved, the reason in plain words, the paste still takes the video', async () => {
  assert.equal((await call('POST', '/api/videos', { link: 'https://youtu.be/geminiFew01' })).status, 202);
  const info = await readDone('geminiFew01');
  assert.equal(info.video_id, null, 'nothing saved');
  assert.equal(info.failure.kind, 'link-read');
  assert.equal(info.failure.from, 'checks');
  assert.equal(info.failure.error, "Gemini couldn't read this video: only 2 of its 4 lines passed my checks (1 the end came before the start, 1 no text).");
  const pasted = await call('POST', '/api/videos', { link: 'https://youtu.be/geminiFew01', transcript: '0:00\nBonjour à tous.\n0:04\nIl y a un problème avec la voiture.' });
  assert.equal(pasted.status, 201, 'the paste controls still work after a refusal');
  assert.equal(pasted.body.caption_track, 'pasted');
});

test('a refusal from OpenRouter, or no French heard, says where it came from', async () => {
  await call('POST', '/api/videos', { link: 'https://youtu.be/emptyText02' });
  const routed = await readDone('emptyText02');
  assert.equal(routed.video_id, null);
  assert.equal(routed.failure.from, 'openrouter');
  assert.equal(routed.failure.error, "Gemini couldn't read this video: OpenRouter answered 404 (No endpoints found that support video input (mock)).");
  // "Try YouTube again" still asks YouTube for its captions
  const yt = await call('POST', '/api/youtube/emptyText02/retry');
  assert.equal(yt.status, 502);
  assert.match(yt.body.error, /Captions the video offers: English \(auto-generated\), French \(auto-generated\), French\./);
  await call('POST', '/api/videos', { link: 'https://youtu.be/geminiNone1' });
  const none = await readDone('geminiNone1');
  assert.equal(none.failure.from, 'gemini');
  assert.equal(none.failure.error, "Gemini couldn't read this video: it found no French speech in it.");
  assert.equal((await call('GET', '/api/videos')).body.items.filter((v) => /emptyText02|geminiNone1/.test(v.youtube_id || '')).length, 0, 'nothing saved');
});

test('a link YouTube says is unavailable is refused before Gemini is asked: nothing to hear, nothing invented', async () => {
  const before = (await (await fetch(`${orBase}/calls`)).json()).videos.length;
  assert.equal((await call('POST', '/api/videos', { link: 'https://www.youtube.com/watch?v=goneVideo01' })).status, 202);
  const info = await readDone('goneVideo01');
  assert.equal(info.video_id, null);
  assert.equal(info.failure.from, 'youtube');
  assert.equal(info.failure.error, 'Gemini couldn\'t read this video: YouTube says this video is unavailable ("Video unavailable"), so there is nothing to hear.');
  assert.equal((await (await fetch(`${orBase}/calls`)).json()).videos.length, before, 'Gemini was not asked');
});

test('"Read the video again" for a saved video replaces its lines; kept lines stay kept', async () => {
  const id = (await readDone('geminiGood1')).video_id;
  const first = (await call('GET', `/api/videos/${id}`)).body;
  const opening = first.lines[0];
  const later = first.lines.find((l) => /église/.test(l.written));
  for (const l of [opening, later]) assert.equal((await call('POST', `/api/lines/${l.id}/keep`)).status, 200);
  const videosBefore = (await call('GET', '/api/videos')).body.items.length;

  const r = await call('POST', `/api/videos/${id}/read`);
  assert.equal(r.status, 202);
  const info = await readDone('geminiGood1');
  assert.equal(info.video_id, id, 'the same video');
  const v = await worked(id);
  assert.equal(v.caption_track, 'gemini');
  assert.equal(v.lines.length, 4, 'the new read\'s lines, not added to the old ones');
  assert.equal((await call('GET', '/api/videos')).body.items.length, videosBefore, 'no second video');
  const kept = (await call('GET', '/api/kept')).body.items.filter((k) => k.video.id === id);
  assert.equal(kept.find((k) => k.written === opening.written).earlier, false, 'a kept line still there stays on the new line');
  assert.equal(kept.find((k) => k.written === later.written).earlier, true, 'a kept line gone from the new lines is kept from before');
});

test('at start, a video read from its link that YouTube says is unavailable, with no title found, is removed with its tally events', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fe-invented-'));
  const db = require('../lib/db');
  db.open(dir);
  const lines = [{ start_s: 0, end_s: 1, written: 'Bonjour à tous.' }, { start_s: 1, end_s: 3, written: "Aujourd'hui, on va parler de la France." }];
  const invented = db.addVideo({ youtube_id: 'goneVideo02', title: 'https://www.youtube.com/watch?v=goneVideo02', caption_track: 'gemini', lines });
  const real = db.addVideo({ youtube_id: 'geminiGood1', title: 'https://www.youtube.com/watch?v=geminiGood1', caption_track: 'gemini', lines });
  const titled = db.addVideo({ youtube_id: 'goneVideo03', title: 'A video taken down since', caption_track: 'gemini', lines });
  const lineId = db.getVideo(invented).lines[0].id;
  db.addEventRow('looked', 'il-y-a', lineId);
  db.handle().close();

  const [ytPort, port] = [await freePort(), await freePort()];
  kids.push(start(['scripts/mock-youtube.mjs', String(ytPort)]));
  await up(`http://127.0.0.1:${ytPort}/`);
  kids.push(start(['server.js'], {
    PORT: String(port), DATA_DIR: dir, COOKIE_INSECURE: '1', APP_PASSWORD: 'pw', COOKIE_SECRET: 'x'.repeat(64), OPENROUTER_API_KEY: 'k',
    OPENROUTER_URL: `${orBase}/v1/chat/completions`, YT_BASE: `http://127.0.0.1:${ytPort}`,
  }));
  const b2 = `http://127.0.0.1:${port}`;
  await up(`${b2}/health`);
  const c2 = (await fetch(`${b2}/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ passphrase: 'pw' }) })).headers.get('set-cookie').split(';')[0];
  const get = async (p) => (await fetch(`${b2}${p}`, { headers: { cookie: c2, accept: 'application/json' } })).json();
  let ids = [];
  for (let i = 0; i < 100; i++) {
    ids = (await get('/api/videos')).items.map((v) => v.id);
    if (!ids.includes(invented)) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.ok(!ids.includes(invented), 'the invented one is gone');
  assert.ok(ids.includes(real), 'a video YouTube still has stays');
  assert.ok(ids.includes(titled), 'a video with a real title stays, even if YouTube lost it since');
  const pats = await get('/api/patterns');
  assert.equal(pats.patterns.find((p) => p.id === 'il-y-a').counts.looked || 0, 0, 'its tally event went with it');
});
