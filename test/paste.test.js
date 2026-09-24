'use strict';
// The pasted-transcript path, end to end against the mocks: the server, the
// stand-in YouTube and the stand-in OpenRouter.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { freePort, up, start } = require('./helpers');

const kids = [];
let base, cookie;
after(() => kids.forEach((k) => k.kill()));

before(async () => {
  const [ytPort, orPort, port] = [await freePort(), await freePort(), await freePort()];
  kids.push(start(['scripts/mock-youtube.mjs', String(ytPort)]));
  kids.push(start(['scripts/mock-openrouter.mjs', String(orPort)]));
  await up(`http://127.0.0.1:${ytPort}/`);
  await up(`http://127.0.0.1:${orPort}/calls`);
  kids.push(start(['server.js'], {
    PORT: String(port), DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'fe-paste-')), COOKIE_INSECURE: '1',
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

async function worked(id) {
  for (let i = 0; i < 100; i++) {
    const v = (await call('GET', `/api/videos/${id}`)).body;
    if (!v.counts.pending && !v.working) return v;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('never worked out');
}

test('a failed caption fetch saves nothing and names the page to paste on, with the tracks', async () => {
  const r = await call('POST', '/api/videos', { link: 'https://www.youtube.com/watch?v=emptyText02' });
  assert.equal(r.status, 502);
  assert.equal(r.body.page, '/watch?yt=emptyText02');
  assert.match(r.body.error, /Captions the video offers: English \(auto-generated\), French \(auto-generated\), French\./);
  const page = (await call('GET', '/api/youtube/emptyText02')).body;
  assert.equal(page.video_id, null);
  assert.match(page.failure.error, /gave no text/);
  assert.deepEqual(page.failure.tracks, ['English (auto-generated)', 'French (auto-generated)', 'French']);
  // "Try YouTube again" runs the fetch once more: the same refusal here
  const again = await call('POST', '/api/youtube/emptyText02/retry');
  assert.equal(again.status, 502);
  assert.equal((await call('GET', '/api/home')).body.videos.length, 0, 'nothing saved');
});

test('"Try YouTube again" saves the video when the captions come this time', async () => {
  const r = await call('POST', '/api/youtube/frManual001/retry');
  assert.equal(r.status, 201);
  assert.equal(r.body.caption_track, 'French [fr]');
  assert.equal((await call('GET', '/api/youtube/frManual001')).body.video_id, r.body.id);
});

test('a link with a pasted transcript skips the caption fetch and uses the paste; the "as said" pass runs on it', async () => {
  const transcript = 'Transcript\n0:00\nBonjour à tous.\n0:04\nJe ne sais pas ce que tu veux dire.\n0:08\nIl y a un problème avec la voiture.';
  // emptyText02's captions are refused: only a skipped fetch can succeed
  const r = await call('POST', '/api/videos', { link: 'https://youtu.be/emptyText02', transcript });
  assert.equal(r.status, 201);
  assert.equal(r.body.caption_track, 'pasted');
  assert.equal(r.body.title, 'Refused track (mock)', 'the title still comes from YouTube');
  const v = await worked(r.body.id);
  assert.deepEqual(v.lines.map((l) => [l.start_s, l.end_s, l.written]), [
    [0, 4, 'Bonjour à tous.'], [4, 8, 'Je ne sais pas ce que tu veux dire.'], [8, 14, 'Il y a un problème avec la voiture.'],
  ]);
  assert.equal(v.lines[1].spoken, "Chais pas c'que tu veux dire.");
  assert.ok(v.lines[1].spans.length > 0, 'a tinted part');
  assert.equal((await call('GET', '/api/youtube/emptyText02')).body.failure, null, 'the failure is forgotten once lines exist');
});

test('a paste with no timestamps: lines with no times; the link is the title when YouTube gives none', async () => {
  const r = await call('POST', '/api/videos', { link: 'https://www.youtube.com/watch?v=unknownVid1', transcript: 'Il faut que je te parle.\nVoilà le problème.' });
  assert.equal(r.status, 201);
  assert.equal(r.body.title, 'https://www.youtube.com/watch?v=unknownVid1');
  assert.equal(r.body.duration_s, null);
  const v = await worked(r.body.id);
  assert.deepEqual(v.lines.map((l) => [l.start_s, l.end_s]), [[null, null], [null, null]]);
  assert.equal(v.lines[0].spoken, "Faut qu'j'te parle.");
});

test('a paste with no lines in it is refused in plain words', async () => {
  const r = await call('POST', '/api/videos', { link: 'https://www.youtube.com/watch?v=unknownVid2', transcript: 'Transcript\n\n' });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /couldn't find any lines in that paste/);
});
