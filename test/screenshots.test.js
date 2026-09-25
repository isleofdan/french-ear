'use strict';
// Screenshots of the transcript in, end to end against the mocks: the server,
// the stand-in YouTube and the stand-in OpenRouter (which reads the picture
// fixtures in test/fixtures/pictures/ from answers.json).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { freePort, up, start } = require('./helpers');

const dir = path.join(__dirname, 'fixtures', 'pictures');
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
    PORT: String(port), DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'fe-shots-')), COOKIE_INSECURE: '1',
    APP_PASSWORD: 'pw', COOKIE_SECRET: 'x'.repeat(64), OPENROUTER_API_KEY: 'k',
    OPENROUTER_URL: `http://127.0.0.1:${orPort}/v1/chat/completions`, YT_BASE: `http://127.0.0.1:${ytPort}`,
  }));
  base = `http://127.0.0.1:${port}`;
  await up(`${base}/health`);
  const r = await fetch(`${base}/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ passphrase: 'pw' }) });
  cookie = r.headers.get('set-cookie').split(';')[0];
});

function form(fields, pictures = []) {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.append(k, v);
  for (const name of pictures) f.append('screenshots', new Blob([fs.readFileSync(path.join(dir, name))], { type: 'image/png' }), name);
  return f;
}
async function send(fields, pictures) {
  const r = await fetch(`${base}/api/screenshots`, { method: 'POST', headers: { cookie, accept: 'application/json' }, body: form(fields, pictures) });
  return { status: r.status, body: await r.json() };
}
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

test('two overlapping screenshots: one video, lines joined into sentences, the "as said" pass run, the counts per picture', async () => {
  // emptyText02's captions are refused: only the screenshots can give lines
  const r = await send({ link: 'https://youtu.be/emptyText02' }, ['shot-1.png', 'shot-2.png']);
  assert.equal(r.status, 201);
  assert.equal(r.body.caption_track, 'screenshots');
  assert.equal(r.body.title, 'Refused track (mock)', 'the title still comes from YouTube');
  assert.deepEqual(r.body.read.pictures.map((p) => [p.name, p.read, p.fresh, p.dropped]), [['shot-1.png', 7, 7, 0], ['shot-2.png', 8, 5, 1]]);
  assert.equal(r.body.read.lines, 12);
  const v = await worked(r.body.id);
  assert.deepEqual(v.lines.slice(0, 3).map((l) => l.written), [
    "Bonjour les amis et bienvenue dans un nouvel épisode d'iz French.",
    "Aujourd'hui, nous allons simplement demander aux passants si ils sont heureux.",
    "C'est parti.",
  ]);
  assert.equal(v.lines[0].start_s, 0);
  assert.ok(v.lines.every((l) => l.status === 'worked'), 'the "as said" pass ran on every line');
  assert.equal((await call('GET', '/api/youtube/emptyText02')).body.video_id, r.body.id);
});

test('screenshots again for a saved video replace its lines; kept lines stay kept', async () => {
  const link = 'https://www.youtube.com/watch?v=unknownVid7';
  const first = await send({ link }, ['shot-1.png', 'shot-2.png']);
  assert.equal(first.status, 201);
  const v1 = await worked(first.body.id);
  const opening = v1.lines[0];
  const later = v1.lines.find((l) => /Parfaitement/.test(l.written));
  for (const l of [opening, later]) assert.equal((await call('POST', `/api/lines/${l.id}/keep`)).status, 200);
  const videosBefore = (await call('GET', '/api/videos')).body.items.length;

  const again = await send({ link }, ['shot-1.png']);
  assert.equal(again.status, 200);
  assert.equal(again.body.id, first.body.id, 'the same video');
  assert.equal(again.body.replaced, true);
  const v2 = await worked(again.body.id);
  assert.equal(v2.lines.length, 5, 'only the first picture\'s lines now, not added to the old ones');
  assert.equal((await call('GET', '/api/videos')).body.items.length, videosBefore, 'no second video');
  const kept = (await call('GET', '/api/kept')).body.items.filter((k) => k.video.id === first.body.id);
  assert.equal(kept.find((k) => k.written === opening.written).earlier, false, 'a kept line still there stays on the new line');
  assert.equal(kept.find((k) => k.written === later.written).earlier, true, 'a kept line gone from the new lines is kept from before');
});

test('screenshots replace a pasted transcript the same way', async () => {
  const link = 'https://www.youtube.com/watch?v=unknownVid8';
  const pasted = await call('POST', '/api/videos', { link, transcript: '0:00\nBonjour à tous.' });
  const r = await send({ link }, ['shot-1.png']);
  assert.equal(r.body.id, pasted.body.id);
  assert.equal(r.body.caption_track, 'screenshots');
});

test('a picture with no transcript: refused in plain words, nothing saved', async () => {
  const before = (await call('GET', '/api/videos')).body.items.length;
  const r = await send({ link: 'https://youtu.be/unknownVid9' }, ['no-transcript.png']);
  assert.equal(r.status, 400);
  assert.equal(r.body.error, "I couldn't find a transcript in this picture.");
  assert.equal((await call('GET', '/api/videos')).body.items.length, before);
  assert.equal((await call('GET', '/api/youtube/unknownVid9')).body.video_id, null);
});

test('no link, or no pictures: each named in plain words', async () => {
  const noLink = await send({ link: '' }, ['shot-1.png']);
  assert.equal(noLink.status, 400);
  assert.equal(noLink.body.error, "Paste the video's link too.");
  const noPics = await send({ link: 'https://youtu.be/unknownVid9' }, []);
  assert.equal(noPics.status, 400);
  assert.match(noPics.body.error, /Add at least one screenshot/);
  const notPic = new FormData();
  notPic.append('link', 'https://youtu.be/unknownVid9');
  notPic.append('screenshots', new Blob(['0:00 Bonjour'], { type: 'image/png' }), 'fake.png');
  const r = await fetch(`${base}/api/screenshots`, { method: 'POST', headers: { cookie, accept: 'application/json' }, body: notPic });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /fake\.png isn't a picture I can read/);
});

test('behind the passphrase like everything else', async () => {
  const r = await fetch(`${base}/api/screenshots`, { method: 'POST', headers: { accept: 'application/json' }, body: form({ link: 'https://youtu.be/unknownVid9' }, ['shot-1.png']) });
  assert.equal(r.status, 401);
});

test('Android Share with a screenshot: held for the home page, then sent with the link', async () => {
  const shared = form({ title: 'Screenshot' }, []);
  shared.append('screenshots', new Blob([fs.readFileSync(path.join(dir, 'shot-1.png'))], { type: 'image/png' }), 'Screenshot_20260924.png');
  const r = await fetch(`${base}/share`, { method: 'POST', headers: { cookie }, body: shared, redirect: 'manual' });
  assert.equal(r.status, 303);
  const to = new URL(r.headers.get('location'), base);
  assert.equal(to.pathname, '/');
  const token = to.searchParams.get('pictures');
  assert.match(token, /^[0-9a-f]{24}$/);
  assert.equal(to.searchParams.get('shared'), 'Screenshot', 'the shared title comes along as text');
  assert.equal((await call('GET', `/api/shared/${token}`)).body.count, 1);

  const noLink = await send({ link: '', shared: token });
  assert.equal(noLink.body.error, "Paste the video's link too.");
  const ok = await send({ link: 'https://youtu.be/unknownVid6', shared: token });
  assert.equal(ok.status, 201);
  assert.deepEqual(ok.body.read.pictures.map((p) => [p.name, p.read]), [['Screenshot_20260924.png', 7]]);
  assert.equal((await call('GET', `/api/shared/${token}`)).body.count, 0, 'used once, then let go');
  const late = await send({ link: 'https://youtu.be/unknownVid5', shared: token });
  assert.match(late.body.error, /no longer here/);
});

test('Android Share with a link still lands in the link box, by POST and by GET', async () => {
  const post = form({ url: '', text: 'https://youtu.be/frManual001?si=abc', title: 'A video' });
  const r = await fetch(`${base}/share`, { method: 'POST', headers: { cookie }, body: post, redirect: 'manual' });
  const to = new URL(r.headers.get('location'), base);
  assert.equal(to.searchParams.get('shared'), 'https://youtu.be/frManual001?si=abc A video');
  assert.equal(to.searchParams.get('pictures'), null);
  const g = await fetch(`${base}/share?text=${encodeURIComponent('https://youtu.be/frManual001')}`, { headers: { cookie }, redirect: 'manual' });
  assert.equal(new URL(g.headers.get('location'), base).searchParams.get('shared'), 'https://youtu.be/frManual001');
});
