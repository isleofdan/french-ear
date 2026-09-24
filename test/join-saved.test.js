'use strict';
// A video saved before lines were joined into sentences is joined when the
// server starts: its lines become sentences and the "as said" pass runs again.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { freePort, up, start } = require('./helpers');
const db = require('../lib/db');

const kids = [];
after(() => kids.forEach((k) => k.kill()));

test('a video saved as caption fragments is joined into sentences at start', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fe-join-'));
  db.open(dir);
  const id = db.addVideo({
    youtube_id: 'savedFrag01', title: 'Saved before (mock)', caption_track: 'pasted',
    lines: [
      { start_s: 0, end_s: 2, written: 'Je ne sais pas ce que' },
      { start_s: 2, end_s: 4, written: 'tu veux dire.' },
      { start_s: 4, end_s: 8, written: 'Il y a un problème avec la voiture.' },
    ],
  });
  const lines = db.getVideo(id).lines;
  db.setLineWorked(lines[2].id, { spoken: 'Y a un problème avec la voiture.', spans: [{ start: 0, end: 3, pattern: 'il-y-a' }], patterns: ['il-y-a'] });
  db.keepLine(lines[2].id);
  db.handle().prepare('UPDATE videos SET joined = 0').run();
  db.handle().close();

  const [orPort, port] = [await freePort(), await freePort()];
  kids.push(start(['scripts/mock-openrouter.mjs', String(orPort)]));
  await up(`http://127.0.0.1:${orPort}/calls`);
  kids.push(start(['server.js'], {
    PORT: String(port), DATA_DIR: dir, COOKIE_INSECURE: '1', APP_PASSWORD: 'pw', COOKIE_SECRET: 'x'.repeat(64),
    OPENROUTER_API_KEY: 'k', OPENROUTER_URL: `http://127.0.0.1:${orPort}/v1/chat/completions`, YT_BASE: 'http://127.0.0.1:9',
  }));
  const base = `http://127.0.0.1:${port}`;
  await up(`${base}/health`);
  const login = await fetch(`${base}/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ passphrase: 'pw' }) });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const get = async (p) => (await fetch(`${base}${p}`, { headers: { cookie, accept: 'application/json' } })).json();

  let v;
  for (let i = 0; i < 100; i++) {
    v = await get(`/api/videos/${id}`);
    if (!v.counts.pending && !v.working) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.deepEqual(v.lines.map((l) => [l.start_s, l.end_s, l.written]), [
    [0, 4, 'Je ne sais pas ce que tu veux dire.'],
    [4, 8, 'Il y a un problème avec la voiture.'],
  ]);
  assert.equal(v.lines[0].spoken, "Chais pas c'que tu veux dire.");
  const kept = (await get('/api/kept')).items;
  assert.equal(kept.length, 1);
  assert.equal(kept[0].id, v.lines[1].id, 'the kept line is kept on the same sentence');
  assert.equal(kept[0].earlier, false);
});
