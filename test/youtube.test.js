'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { freePort, up, start, root } = require('./helpers');

let mock, youtube;
before(async () => {
  const port = await freePort();
  mock = start(['scripts/mock-youtube.mjs', String(port)]);
  await up(`http://127.0.0.1:${port}/`);
  process.env.YT_BASE = `http://127.0.0.1:${port}`;
  youtube = require('../lib/youtube');
});
after(() => mock && mock.kill());

test('the link parser reads the four usual forms, with and without a timestamp', () => {
  const p = (s) => youtube.parseLink(s);
  assert.deepEqual(p('https://www.youtube.com/watch?v=flS3MVNXWbw'), { id: 'flS3MVNXWbw', start_s: 0 });
  assert.deepEqual(p('https://youtu.be/flS3MVNXWbw?t=95'), { id: 'flS3MVNXWbw', start_s: 95 });
  assert.deepEqual(p('https://www.youtube.com/shorts/flS3MVNXWbw'), { id: 'flS3MVNXWbw', start_s: 0 });
  assert.deepEqual(p('https://m.youtube.com/watch?v=flS3MVNXWbw&t=1m30s&feature=share'), { id: 'flS3MVNXWbw', start_s: 90 });
  assert.deepEqual(p('youtube.com/watch?v=flS3MVNXWbw'), { id: 'flS3MVNXWbw', start_s: 0 });
  assert.deepEqual(p('https://www.youtube.com/watch?t=12&v=flS3MVNXWbw'), { id: 'flS3MVNXWbw', start_s: 12 });
  assert.deepEqual(p('https://youtube.com/shorts/flS3MVNXWbw?si=abc'), { id: 'flS3MVNXWbw', start_s: 0 });
  // what Android's Share hands over: words around the link
  assert.deepEqual(p('Regarde ça ! https://youtu.be/flS3MVNXWbw?si=x1y2'), { id: 'flS3MVNXWbw', start_s: 0 });
  assert.equal(p('https://vimeo.com/12345'), null);
  assert.equal(p('bonjour'), null);
  assert.equal(p('https://www.youtube.com/watch?v=short'), null);
});

test('a video with a hand-made French track uses it, not the auto-generated one', async () => {
  const v = await youtube.fetchVideo('frManual001');
  assert.equal(v.title, 'Easy French: dans la rue (mock)');
  assert.match(v.caption_track, /^French \[fr\]$/);
  assert.equal(v.lines.length, 16);
  assert.equal(v.lines[1].written, 'Je ne sais pas ce que tu veux dire.');
  assert.equal(v.lines[3].written, "Tu as vu ce qu'il a fait ?", 'entities decoded, apostrophe kept');
  assert.equal(v.lines[1].start_s, 4);
  assert.ok(v.tracks.includes('English (auto-generated)'));
});

test('a video with only the French auto-generated track uses it, lines not overlapping', async () => {
  const v = await youtube.fetchVideo('frAutoOnly1');
  assert.match(v.caption_track, /auto/);
  for (let i = 0; i < v.lines.length - 1; i++) assert.ok(v.lines[i].end_s <= v.lines[i + 1].start_s);
});

test('no French track: a plain message naming the tracks it has, and nothing to save', async () => {
  await assert.rejects(youtube.fetchVideo('enOnly00001'), (e) => e.kind === 'no-french' && /no French captions I can read/.test(e.message) && /English/.test(e.message));
  await assert.rejects(youtube.fetchVideo('noCaption01'), (e) => e.kind === 'no-french');
});

test('a refusal from YouTube is reported as what came back, not as "no captions"', async () => {
  await assert.rejects(youtube.fetchVideo('botBlocked1'), (e) => e.kind === 'fetch' && /not a bot/.test(e.message) && /LOGIN_REQUIRED/.test(e.message));
  await assert.rejects(youtube.fetchVideo('emptyText01'), (e) => e.kind === 'fetch' && /gave no text/.test(e.message));
});

test('"gave no text" names every caption track the video offered, auto-generated ones marked', async () => {
  await assert.rejects(youtube.fetchVideo('emptyText02'), (e) => e.kind === 'fetch' && /gave no text/.test(e.message)
    && /Captions the video offers: English \(auto-generated\), French \(auto-generated\), French\./.test(e.message)
    && e.detail.tracks.length === 3);
});

test('a track that answers only as json3 is still read', async () => {
  const v = await youtube.fetchVideo('json3Only01');
  assert.equal(v.lines.length, 16);
});

test('the three caption formats parse to the same lines', () => {
  const xml = '<transcript><text start="1.5" dur="2">Il y a &amp;#39;un&amp;#39; truc</text></transcript>';
  const srv3 = '<timedtext><body><p t="1500" d="2000"><s>Il y a </s><s>&#39;un&#39; truc</s></p></body></timedtext>';
  const json3 = JSON.stringify({ events: [{ tStartMs: 1500, dDurationMs: 2000, segs: [{ utf8: "Il y a 'un' truc" }] }, { tStartMs: 3500, segs: [{ utf8: '\n' }] }] });
  for (const body of [xml, srv3, json3]) {
    assert.deepEqual(youtube.parseCaptions(body), [{ start_s: 1.5, end_s: 3.5, written: "Il y a 'un' truc" }]);
  }
});

test("the manifest's share target validates", () => {
  const m = JSON.parse(fs.readFileSync(path.join(root, 'public', 'manifest.webmanifest'), 'utf8'));
  for (const k of ['name', 'short_name', 'start_url', 'display', 'icons', 'share_target']) assert.ok(m[k], `manifest has ${k}`);
  assert.ok(['standalone', 'fullscreen', 'minimal-ui'].includes(m.display));
  const st = m.share_target;
  assert.equal(st.method, 'GET');
  assert.ok(st.action.startsWith('/'));
  assert.ok(st.params && (st.params.url || st.params.text), 'share target takes a url or text');
  const sizes = [];
  for (const icon of m.icons) {
    const file = path.join(root, 'public', icon.src);
    const buf = fs.readFileSync(file);
    assert.equal(buf.subarray(1, 4).toString('latin1'), 'PNG', `${icon.src} is a PNG`);
    const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
    assert.equal(`${w}x${h}`, icon.sizes, `${icon.src} is ${icon.sizes}`);
    sizes.push(w);
  }
  assert.ok(sizes.includes(192) && sizes.includes(512), 'icons at 192 and 512');
});
