'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { freePort, up, start } = require('./helpers');

const kids = [];
after(() => kids.forEach((k) => k.kill()));

async function server(env) {
  const port = await freePort();
  const kid = start(['server.js'], { PORT: String(port), DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'fe-srv-')), COOKIE_INSECURE: '1', APP_PASSWORD: '', COOKIE_SECRET: '', ...env });
  kids.push(kid);
  const base = `http://127.0.0.1:${port}`;
  await up(`${base}/health`);
  return base;
}

test('fails closed without a passphrase set', async () => {
  const base = await server({});
  assert.deepEqual(await (await fetch(`${base}/health`)).json(), { ok: true, configured: false });
  assert.equal((await fetch(`${base}/api/home`)).status, 503);
  assert.equal((await fetch(`${base}/`, { redirect: 'manual' })).status, 503);
});

test('the gate: 401 without the cookie, wrong passphrase refused, right one lets in', async () => {
  const base = await server({ APP_PASSWORD: 'pw', COOKIE_SECRET: 'x'.repeat(64) });
  assert.equal((await fetch(`${base}/api/home`)).status, 401);
  const page = await fetch(`${base}/watch?id=1`, { redirect: 'manual' });
  assert.equal(page.status, 303);
  assert.equal(page.headers.get('location'), '/login?next=%2Fwatch%3Fid%3D1');
  const wrong = await fetch(`${base}/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ passphrase: 'nope' }) });
  assert.equal(wrong.status, 401);
  const right = await fetch(`${base}/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ passphrase: 'pw' }) });
  const cookie = right.headers.get('set-cookie').split(';')[0];
  assert.match(right.headers.get('set-cookie'), /Max-Age=2592000/);
  assert.equal((await fetch(`${base}/api/home`, { headers: { cookie } })).status, 200);
  // the form login goes back to where it was asked for, never off the site
  const form = await fetch(`${base}/login`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'passphrase=pw&next=%2F%2Fevil.example' });
  assert.equal(form.headers.get('location'), '/');
  // what Android's Share sends lands in the link box
  const share = await fetch(`${base}/share?title=Vid&text=${encodeURIComponent('Regarde https://youtu.be/flS3MVNXWbw')}`, { redirect: 'manual', headers: { cookie } });
  assert.match(share.headers.get('location'), /^\/\?shared=.*youtu\.be/);
  // the manifest, the service worker and the icons answer without the cookie
  for (const p of ['/manifest.webmanifest', '/sw.js', '/icons/icon-192.png', '/icons/icon-512.png']) {
    assert.equal((await fetch(`${base}${p}`)).status, 200, p);
  }
  // a link that is not YouTube is refused in plain words
  const bad = await fetch(`${base}/api/videos`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ link: 'https://vimeo.com/1' }) });
  assert.equal(bad.status, 400);
  assert.match((await bad.json()).error, /doesn't look like a YouTube link/);
});
