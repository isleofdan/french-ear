// Drives the app in a real browser against the local mocks and captures every
// page on phone (412×915) and computer (1280×800), light and dark, into
// docs/screenshots/. Along the way it checks what a person would see: the
// lines drawn with tints, a tapped line flipped with its pattern named, Ear
// first hiding the lines and "What was that?" showing two and turning their
// patterns shaky, a kept line on the kept page, the typed-line result.
//
// YouTube's player cannot load here (no outside network), so the page's
// request for YouTube's player script is answered by a small stand-in with
// the same methods; its clock is set by this script. Google Fonts are not
// reachable either: the pages fall back to Georgia and the system sans.
//   node scripts/screenshots.mjs
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const out = join(root, 'docs', 'screenshots');
mkdirSync(out, { recursive: true });

const PORT = 8813, YT_PORT = 8811, OR_PORT = 8812;
const PASS = 'open-sesame';
const kids = [];
process.on('exit', () => { for (const k of kids) k.kill(); });
process.on('uncaughtException', (e) => { console.error(e); process.exit(1); });
const start = (args, env = {}) => { const k = spawn('node', args, { cwd: root, env: { ...process.env, ...env }, stdio: ['ignore', 'ignore', 'inherit'] }); kids.push(k); return k; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function up(url) { for (let i = 0; i < 100; i++) { try { await fetch(url); return; } catch { await wait(100); } } throw new Error(`nothing at ${url}`); }

start(['scripts/mock-youtube.mjs', String(YT_PORT)]);
start(['scripts/mock-openrouter.mjs', String(OR_PORT)]);
start(['server.js'], {
  PORT: String(PORT), DATA_DIR: mkdtempSync(join(tmpdir(), 'fe-shots-')), APP_PASSWORD: PASS, COOKIE_SECRET: 'x'.repeat(64), COOKIE_INSECURE: '1',
  OPENROUTER_API_KEY: 'test-key', OPENROUTER_URL: `http://127.0.0.1:${OR_PORT}/v1/chat/completions`, YT_BASE: `http://127.0.0.1:${YT_PORT}`,
});
const base = `http://127.0.0.1:${PORT}`;
await up(`${base}/health`);
await up(`http://127.0.0.1:${YT_PORT}/`);

let failed = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); if (!ok) failed++; };

// The stand-in for YouTube's IFrame Player API. window.__t is the clock,
// window.__state the player state (1 playing, 2 paused).
const PLAYER_STUB = `
window.__t = window.__t || 0; window.__state = 2;
window.YT = { Player: function (id, opts) {
  var el = document.getElementById(id);
  el.style.cssText = 'display:flex;align-items:center;justify-content:center;color:#cfc6b8;font:14px system-ui;background:#111';
  el.textContent = 'YouTube player (stand-in for screenshots)';
  if (opts.playerVars && opts.playerVars.start) window.__t = opts.playerVars.start;
  var self = this;
  setTimeout(function () { opts.events.onReady({ target: self }); }, 10);
} };
YT.Player.prototype.getCurrentTime = function () { return window.__t; };
YT.Player.prototype.getPlayerState = function () { return window.__state; };
YT.Player.prototype.seekTo = function (t) { window.__t = t; };
YT.Player.prototype.playVideo = function () { window.__state = 1; };
YT.Player.prototype.pauseVideo = function () { window.__state = 2; };
YT.Player.prototype.unloadModule = function () {};
setTimeout(function () { window.onYouTubeIframeAPIReady(); }, 0);
`;

const exe = existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined;
const browser = await chromium.launch({ executablePath: exe });

const VIEWS = { phone: { width: 412, height: 915 }, computer: { width: 1280, height: 800 } };

async function context(view, scheme) {
  const ctx = await browser.newContext({ viewport: VIEWS[view], colorScheme: scheme, deviceScaleFactor: 1, isMobile: view === 'phone', hasTouch: view === 'phone' });
  await ctx.route('https://www.youtube.com/iframe_api', (r) => r.fulfill({ contentType: 'text/javascript', body: PLAYER_STUB }));
  await ctx.route(/^https:\/\/fonts\.googleapis\.com\//, (r) => r.fulfill({ contentType: 'text/css', body: '' }));
  const errors = [];
  ctx.on('weberror', (e) => errors.push(e.error().message));
  ctx.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  ctx.on('requestfailed', (r) => { if (!/ERR_ABORTED/.test(r.failure()?.errorText || '')) errors.push('request failed: ' + r.url() + ' ' + (r.failure()?.errorText || '')); });
  return { ctx, errors };
}

async function login(page) {
  await page.goto(`${base}/`);
  await page.fill('#passphrase', PASS);
  await page.click('button[type=submit]');
  await page.waitForURL(`${base}/`);
}

const shot = (page, name) => page.screenshot({ path: join(out, `${name}.png`), fullPage: false });

// --- one full pass, phone light, with the checks ----------------------------
{
  const { ctx, errors } = await context('phone', 'light');
  const page = await ctx.newPage();
  await page.goto(`${base}/`);
  check('login page first', await page.isVisible('#passphrase'));
  await shot(page, 'login-phone-light');
  await login(page);
  await shot(page, 'home-empty-phone-light');

  // the link in; the watch page with the lines
  await page.fill('#link', 'https://www.youtube.com/watch?v=frManual001');
  await page.click('#link-go');
  await page.waitForURL(/\/watch\?id=\d+/);
  await page.waitForSelector('#lines .line mark.tint', { timeout: 15000 });
  const lineCount = await page.locator('#lines .line').count();
  check('the watch page shows every line', lineCount === 16, `${lineCount} lines`);
  const tinted = await page.locator('#lines .line mark.tint').count();
  check('lines carry tints', tinted > 5, `${tinted} tinted parts`);
  check('a tint is visible (not dark on dark)', await page.locator('#lines mark.tint').first().evaluate((m) => {
    const cs = getComputedStyle(m); return cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.color !== cs.backgroundColor;
  }));

  // playing: the current line follows the clock
  await page.evaluate(() => { window.__t = 4.6; window.__state = 1; });
  await page.waitForSelector('#line-1.current');
  check('the current line is highlighted', true);
  await page.evaluate(() => { window.__state = 2; });
  await page.locator('#line-1 .line-main').click();
  const flipped = await page.locator('#line-1 .line-main .written').isVisible();
  const named = await page.locator('#line-1 .why').innerText();
  check('a tapped line flips to the written text', flipped);
  check('and names its patterns in plain words', /je sais → chais/.test(named) && /ne is dropped/.test(named), named.slice(0, 80));
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.locator('#line-1').scrollIntoViewIfNeeded();
  await shot(page, 'watch-follow-tapped-phone-light');

  // keep it
  await page.locator('#line-1 [data-keep]').click();
  await page.waitForSelector('#line-1 [data-keep][aria-pressed="true"]');
  check('Keep turns into Kept', true);

  // Ear first: the lines hide; five lines play through; "What was that?"
  await page.click('#modes [data-mode="ear"]');
  check('Ear first hides the lines', !(await page.isVisible('#lines')));
  await page.evaluate(() => { window.__t = 18; window.__state = 1; });
  for (const t of [18.5, 21, 22.1, 25, 25.6, 28.6, 29.2, 31]) { await page.evaluate((x) => { window.__t = x; }, t); await wait(320); }
  await page.click('#wwt');
  await page.waitForSelector('#revealed .line');
  const shown = await page.locator('#revealed .line').count();
  check('"What was that?" shows the last two lines', shown === 2, `${shown}`);
  await shot(page, 'watch-ear-first-revealed-phone-light');
  const pats = await (await page.request.get(`${base}/api/patterns`)).json();
  const shakyIds = pats.patterns.filter((p) => p.state === 'shaky').map((p) => p.id);
  check('their patterns are now shaky', shakyIds.includes('question-tone') && shakyIds.includes('il-i'), shakyIds.join(', '));
  const cleanCount = pats.patterns.reduce((n, p) => n + p.counts.watched_clean, 0);
  check('lines played through before them count as heard clean', cleanCount > 0, `${cleanCount}`);

  // the mode is remembered on this device
  await page.reload();
  await page.waitForSelector('#ear:not([hidden])');
  check('the mode is remembered after a reload', true);
  await page.click('#modes [data-mode="follow"]');

  // kept page, patterns page, home with counts
  await page.goto(`${base}/kept`);
  await page.waitForSelector('.kept-item');
  check('the kept line is on the kept page', /Chais pas/.test(await page.locator('.kept-item').first().innerText()));
  await shot(page, 'kept-phone-light');
  await page.locator('.kept-item').first().click();
  await page.waitForSelector('#line-1.open');
  check('tapping a kept line opens the watch page at that line', true);

  await page.goto(`${base}/patterns`);
  await page.waitForSelector('.pattern');
  check('the patterns page lists all twenty', (await page.locator('.pattern').count()) === 20);
  check('shaky comes first', /^Shaky/i.test(await page.locator('.group-head').first().innerText()));
  await shot(page, 'patterns-phone-light');

  // the typed line: shown like any line, and nothing recorded to the tally
  const eventsBefore = JSON.stringify((await (await page.request.get(`${base}/api/patterns`)).json()).patterns.map((p) => p.counts));
  await page.goto(`${base}/`);
  await page.fill('#typed', "Tu as vu ce qu'il a fait ?");
  await page.click('#typed-go');
  await page.waitForURL(/\/watch\?id=\d+/);
  await page.waitForSelector('#typed mark.tint');
  check('a typed line shows written, as said and the patterns', /tu → t'/.test(await page.locator('#typed').innerText()));
  await page.locator('#typed .line-main, #typed .why').first().click().catch(() => {});
  const eventsAfter = JSON.stringify((await (await page.request.get(`${base}/api/patterns`)).json()).patterns.map((p) => p.counts));
  check('the typed line records nothing to the tally', eventsBefore === eventsAfter);
  await shot(page, 'typed-phone-light');

  await page.goto(`${base}/`);
  await page.waitForSelector('#recent .item');
  check('home shows the counts', (await page.locator('#n-shaky').innerText()) !== '–');
  await shot(page, 'home-phone-light');
  check('no script errors on the phone pass', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

// --- the rest: every screen, both viewports, both grounds --------------------
const videoId = 1;
for (const view of Object.keys(VIEWS)) {
  for (const scheme of ['light', 'dark']) {
    const { ctx, errors } = await context(view, scheme);
    const page = await ctx.newPage();
    await login(page);
    const tag = `${view}-${scheme}`;
    if (!(view === 'phone' && scheme === 'light')) {
      await shot(page, `home-${tag}`);
    }
    // Follow along with a tapped line
    await page.goto(`${base}/watch?id=${videoId}`);
    await page.waitForSelector('#modes');
    await page.click('#modes [data-mode="follow"]');
    await page.waitForSelector('#lines .line mark.tint');
    await page.evaluate(() => { window.__t = 11.4; window.__state = 1; });
    await page.waitForSelector('#line-3.current');
    await page.evaluate(() => { window.__state = 2; });
    await page.locator('#line-3 .line-main').click();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.locator('#line-3').scrollIntoViewIfNeeded();
    await wait(200);
    await shot(page, `watch-follow-tapped-${tag}`);
    // Ear first, "What was that?"
    await page.click('#modes [data-mode="ear"]');
    await page.evaluate(() => { window.__t = 36; });
    await page.click('#wwt');
    await page.waitForSelector('#revealed .line');
    await shot(page, `watch-ear-first-revealed-${tag}`);
    await page.click('#modes [data-mode="follow"]');
    for (const p of ['kept', 'patterns']) {
      await page.goto(`${base}/${p}`);
      await page.waitForSelector(p === 'kept' ? '.kept-item' : '.pattern');
      await shot(page, `${p}-${tag}`);
    }
    await page.goto(`${base}/watch?id=2`);
    await page.waitForSelector('#typed mark.tint');
    await shot(page, `typed-${tag}`);
    // contrast of the tint and the orange tint against their text
    await page.goto(`${base}/watch?id=${videoId}`);
    await page.waitForSelector('#lines mark.tint');
    const pairs = await page.evaluate(() => [...document.querySelectorAll('#lines mark.tint')].slice(0, 40).map((m) => {
      const cs = getComputedStyle(m); return { shaky: m.classList.contains('shaky'), fg: cs.color, bg: cs.backgroundColor };
    }));
    const rgb = (c) => c.match(/\d+/g).slice(0, 3).map(Number).map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    const L = (c) => { const [r, g, b] = rgb(c); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
    const ratio = (a, b) => { const [x, y] = [L(a), L(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
    const worst = Math.min(...pairs.map((p) => ratio(p.fg, p.bg)));
    check(`tinted text is readable (${tag})`, worst >= 4.5, `worst contrast ${worst.toFixed(1)}:1`);
    check(`orange tints present for shaky patterns (${tag})`, pairs.some((p) => p.shaky));
    check(`no script errors (${tag})`, errors.length === 0, errors.join(' | '));
    await ctx.close();
  }
}

await browser.close();
for (const k of kids) k.kill();
console.log(failed ? `${failed} check(s) FAILED` : 'all browser checks passed');
process.exit(failed ? 1 : 0);
