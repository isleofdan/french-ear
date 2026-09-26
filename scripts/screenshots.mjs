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
import { mkdtempSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { VIDEO_LINES } from './fixtures.mjs';

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
  window.__vid = opts.videoId;
  var self = this;
  setTimeout(function () { opts.events.onReady({ target: self }); }, 10);
} };
YT.Player.prototype.getCurrentTime = function () { return window.__t; };
YT.Player.prototype.getPlayerState = function () { return window.__state; };
YT.Player.prototype.seekTo = function (t) { window.__t = t; };
YT.Player.prototype.playVideo = function () { window.__state = 1; };
YT.Player.prototype.pauseVideo = function () { window.__state = 2; };
YT.Player.prototype.unloadModule = function () {};
YT.Player.prototype.loadVideoById = function (o) { window.__vid = o.videoId; window.__t = o.startSeconds || 0; window.__state = 1; };
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
  // A 502 is the app's own answer when YouTube refuses the captions (the
  // mock refuses emptyText02 and refusedVid2 on purpose), and a 400 its
  // answer to a picture with no transcript in it; the browser logs both.
  ctx.on('console', (m) => { if (m.type() === 'error' && !/status of (502|400)/.test(m.text())) errors.push(m.text()); });
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

// --- the pasted transcript, phone light, with the checks --------------------
// Video 3 is emptyText02 with a pasted transcript (timings); video 4 a paste
// with no timings. refusedVid2 stays unsaved: its page is the no-lines one.
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const TIMED_PASTE = 'Transcript\n' + VIDEO_LINES.map((w, i) => `${mmss(i * 3.5 + 0.5)}\n${w}`).join('\n');
const UNTIMED_PASTE = VIDEO_LINES.slice(1, 6).join('\n');
{
  const { ctx, errors } = await context('phone', 'light');
  const page = await ctx.newPage();
  await login(page);
  check('home has the transcript box under the link box', await page.isVisible('#transcript'));
  check('with the words the brief gives', /Paste the transcript here \(from YouTube's Show transcript panel\)/.test(await page.locator('label[for=transcript]').innerText()));

  // no paste, and YouTube refuses the caption text: the video's page says so
  await page.fill('#link', 'https://www.youtube.com/watch?v=emptyText02');
  await page.click('#link-go');
  await page.waitForURL(/\/watch\?yt=emptyText02/);
  await page.waitForSelector('#nolines:not([hidden])');
  const why = await page.locator('#nolines').innerText();
  check('the failed fetch lands on the video page with the phone instructions', /YouTube wouldn't give me the captions\. On a phone or tablet, open the video in the YouTube app, tap the title, tap Show transcript, take a screenshot of the transcript, scroll and take another until you have it all, then add the screenshots here\./.test(why));
  check('with the screenshot control right there', await page.isVisible('#pick') && /Add screenshots of the transcript/.test(await page.locator('#pick').innerText()));
  check('and not the laptop ones', !/Ctrl\+A/.test(why));
  check('the failure names the caption tracks', /Captions the video offers: English \(auto-generated\), French \(auto-generated\), French\./.test(why));
  check('the paste box is right there', await page.isVisible('#paste'));
  check('and "Try YouTube again"', await page.isVisible('#yt-again'));
  await page.click('#yt-again');
  await page.waitForFunction(() => /Tried again just now/.test(document.getElementById('nolines-why').textContent));
  check('"Try YouTube again" asks once more and says what came back', true);

  // the paste, on that page
  await page.fill('#paste', TIMED_PASTE);
  await page.click('#paste-go');
  await page.waitForURL(/\/watch\?id=3/);
  await page.waitForSelector('#readback:not([hidden])');
  const rb = await page.locator('#readback-lines li').allInnerTexts();
  check('"Here\'s how I read your paste" shows the first three lines', rb.length === 3 && /0:00\s+Bonjour à tous\./.test(rb[0]) && /0:04\s+Je ne sais pas/.test(rb[1]), rb.join(' | '));
  await page.waitForSelector('#lines .line mark.tint', { timeout: 15000 });
  check('the pasted lines are worked out and tinted', (await page.locator('#lines .line mark.tint').count()) > 5);
  check('Ear first is offered for timed lines', await page.isVisible('#modes'));
  await page.evaluate(() => { window.__t = 4.6; window.__state = 1; });
  await page.waitForSelector('#line-1.current');
  check('pasted lines follow the clock', true);
  await page.evaluate(() => { window.__state = 2; window.scrollTo(0, 0); });

  // no timings in the paste: a plain list
  await page.goto(`${base}/`);
  await page.fill('#link', 'https://youtu.be/untimedVid1');
  await page.fill('#transcript', UNTIMED_PASTE);
  await page.click('#link-go');
  await page.waitForURL(/\/watch\?id=4/);
  await page.waitForSelector('#readback:not([hidden])');
  check('a paste with no timings says so', /No timings in this transcript — lines won’t follow the video/.test(await page.locator('#readback').innerText()));
  check('and offers no Ear first', !(await page.isVisible('#modes')) && !(await page.isVisible('#ear')));
  await page.waitForSelector('#lines .line mark.tint', { timeout: 15000 });
  await page.evaluate(() => { window.__t = 9; window.__state = 1; });
  await wait(600);
  check('nothing follows the clock', (await page.locator('#lines .line.current').count()) === 0);
  // the whole YouTube page, as Ctrl+A copies it: only the transcript is read
  await page.goto(`${base}/`);
  await page.fill('#link', 'https://youtu.be/pageCopy001');
  await page.fill('#transcript', readFileSync(join(root, 'test', 'fixtures', 'youtube-page-copy.txt'), 'utf8'));
  await page.click('#link-go');
  await page.waitForURL(/\/watch\?id=5/);
  await page.waitForSelector('#readback:not([hidden])');
  const whole = await page.locator('#readback').innerText();
  check('a whole-page paste is read as its transcript, in sentences', /Bonjour les amis et bienvenue dans un nouvel épisode d'iz French\./.test(whole) && /16 lines in all/.test(whole), whole.replace(/\s+/g, ' ').slice(0, 200));
  await page.waitForFunction(() => document.getElementById('status').hidden, null, { timeout: 15000 });
  check('the watch page shows the joined lines', /nouvel épisode d'iz French\.$/.test((await page.locator('#line-0 .written').textContent()).trim()));

  // the same page pasted again: the lines are replaced, not added to
  const before = (await (await page.request.get(`${base}/api/videos`)).json()).items.length;
  check('"Paste the transcript again" is offered', await page.isVisible('#repaste summary'));
  await page.click('#repaste summary');
  await page.fill('#repaste-text', readFileSync(join(root, 'test', 'fixtures', 'youtube-page-copy.txt'), 'utf8'));
  await Promise.all([page.waitForEvent('framenavigated'), page.click('#repaste-go')]);
  await page.waitForURL(/\/watch\?id=5$/);
  await page.waitForSelector('#readback:not([hidden])');
  check('a re-paste reads back the same opening', /16 lines in all/.test(await page.locator('#readback').innerText()));
  check('and adds no video', (await (await page.request.get(`${base}/api/videos`)).json()).items.length === before);

  // a kept line whose text is gone after a re-paste stays kept, from an earlier paste
  await page.goto(`${base}/watch?id=4`);
  await page.waitForSelector('#lines .line mark.tint', { timeout: 15000 });
  await page.locator('#line-0 .line-main').click();
  await page.locator('#line-0 [data-keep]').click();
  await page.waitForSelector('#line-0 [data-keep][aria-pressed="true"]');
  await page.click('#repaste summary');
  await page.fill('#repaste-text', ['Je ne sais vraiment pas.', ...VIDEO_LINES.slice(2, 6)].join('\n'));
  await Promise.all([page.waitForEvent('framenavigated'), page.click('#repaste-go')]);
  await page.waitForURL(/\/watch\?id=4$/);
  await page.waitForSelector('#readback:not([hidden])');
  await page.goto(`${base}/kept`);
  await page.waitForSelector('.kept-item');
  check('a kept line from an earlier paste says so', /from an earlier paste/.test(await page.locator('.kept-item').first().innerText()));
  check('no script errors on the paste pass', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

// --- screenshots of the transcript, phone light, with the checks -------------
// Video 6 is unknownVid3 from two overlapping screenshots (synthetic, made by
// scripts/make-picture-fixtures.mjs; the stand-in model reads them from
// test/fixtures/pictures/answers.json).
const PICS = join(root, 'test', 'fixtures', 'pictures');
{
  const { ctx, errors } = await context('phone', 'light');
  const page = await ctx.newPage();
  await login(page);
  check('home has "Add screenshots of the transcript" under the link box', await page.isVisible('#pick')
    && (await page.locator('#pick').boundingBox()).y > (await page.locator('#link').boundingBox()).y);
  check('home gives the phone steps for screenshots', /tap Show transcript, take a screenshot of the transcript, scroll and take another/.test(await page.locator('#link-form').innerText()));
  await page.fill('#link', 'https://www.youtube.com/watch?v=unknownVid3');
  await page.setInputFiles('#pictures', [join(PICS, 'shot-1.png'), join(PICS, 'shot-2.png')]);
  check('the control says how many are added', (await page.locator('#picked').innerText()) === '2 screenshots added.');
  await shot(page, 'home-screenshots-added-phone-light');
  await page.click('#link-go');
  await page.waitForURL(/\/watch\?id=6/, { timeout: 15000 });
  await page.waitForSelector('#readback:not([hidden])');
  const head = await page.locator('#readback-head').innerText();
  check('"Here\'s how I read your screenshots"', head === 'Here’s how I read your screenshots', head);
  const rb = await page.locator('#readback-lines li').allInnerTexts();
  check('with the first three lines, joined into sentences', rb.length === 3 && /0:00\s+Bonjour les amis et bienvenue dans un nouvel épisode d'iz French\./.test(rb[0]), rb.join(' | '));
  const counts = await page.locator('#readback-pictures').innerText();
  check('and the lines from each screenshot', /Screenshot 1: 7 lines\. Screenshot 2: 8 lines \(3 already in an earlier screenshot\)\. 1 line I couldn’t read whole left out/.test(counts), counts);
  await page.waitForSelector('#lines .line mark.tint', { timeout: 15000 });
  check('then the lines, tinted, under the player', (await page.locator('#lines .line').count()) > 5);
  check('the page says where the lines came from', /from your screenshots of the transcript/.test(await page.locator('#sub').innerText()));

  // screenshots again, from "Add the transcript again": replaced, same video
  await page.click('#repaste summary');
  await page.setInputFiles('#re-pictures', [join(PICS, 'shot-1.png')]);
  await Promise.all([page.waitForEvent('framenavigated', { timeout: 15000 }), page.click('#re-pics-go')]);
  await page.waitForSelector('#readback:not([hidden])');
  check('screenshots again replace the lines of the same video', /\/watch\?id=6$/.test(page.url()) && (await (await page.request.get(`${base}/api/videos/6`)).json()).counts.total === 5);

  // a picture with no transcript in it: refused, nothing saved
  await page.goto(`${base}/`);
  await page.fill('#link', 'https://www.youtube.com/watch?v=unknownVid4');
  await page.setInputFiles('#pictures', [join(PICS, 'no-transcript.png')]);
  await page.click('#link-go');
  await page.waitForFunction(() => document.getElementById('link-msg').textContent.length > 0, null, { timeout: 15000 });
  check('a picture with no transcript is refused in plain words', (await page.locator('#link-msg').innerText()) === "I couldn't find a transcript in this picture.");
  check('and nothing is saved', (await (await page.request.get(`${base}/api/youtube/unknownVid4`)).json()).video_id === null);

  // Android's Share with a screenshot: lands on the home page's control,
  // the link box empty, "Paste the video's link too"
  const shared = await page.request.post(`${base}/share`, { multipart: { title: 'Screenshot', screenshots: { name: 'Screenshot_20260924.png', mimeType: 'image/png', buffer: readFileSync(join(PICS, 'shot-1.png')) } }, maxRedirects: 0 });
  await page.goto(new URL(shared.headers().location, base).href);
  await page.waitForFunction(() => !document.getElementById('picked').hidden);
  check('a shared screenshot lands on the screenshot control', (await page.locator('#picked').innerText()) === '1 screenshot added.');
  check('with the link box empty and "Paste the video\'s link too"', (await page.inputValue('#link')) === '' && (await page.locator('#link-msg').innerText()) === "Paste the video's link too.");
  await shot(page, 'home-shared-screenshot-phone-light');
  await page.fill('#link', 'https://www.youtube.com/watch?v=unknownVid5');
  await page.click('#link-go');
  await page.waitForURL(/\/watch\?id=7/, { timeout: 15000 });
  await page.waitForSelector('#readback:not([hidden])');
  check('and goes up with the link once it is pasted', /Screenshot 1: 7 lines\./.test(await page.locator('#readback-pictures').innerText()));
  check('no script errors on the screenshots pass', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

// --- photos from the TV, phone light, with the checks ------------------------
// Moments 1–3: an English subtitle with both notes, a French subtitle, and a
// photo with no subtitle (drawn TV photos in test/fixtures/pictures/; the
// stand-in model reads them from answers.json).
async function momentSettled(page, id) {
  for (let i = 0; i < 100; i++) {
    const m = await (await page.request.get(`${base}/api/moments/${id}`)).json();
    if (m.saved && !m.busy && !['waiting', 'working'].includes(m.work_status)) return m;
    await wait(100);
  }
  throw new Error(`moment ${id} never settled`);
}
{
  const { ctx, errors } = await context('phone', 'light');
  const page = await ctx.newPage();
  await login(page);
  check('home has a third way in, "Add a photo from the TV"', (await page.locator('#photo-pick').innerText()).trim() === 'Add a photo from the TV');
  await page.setInputFiles('#photo', join(PICS, 'tv-english.png'));
  await page.waitForURL(/\/moment\?id=1&new=1/, { timeout: 15000 });
  await page.waitForFunction(() => document.getElementById('subtitle') && document.getElementById('subtitle').value.length > 0, null, { timeout: 15000 });
  check('the after-photo screen shows the subtitle as read', (await page.inputValue('#subtitle')) === "There's something wrong.");
  check('with the photo small at the top', await page.locator('.photo-head img.moment-thumb').evaluate((i) => i.complete && i.naturalWidth > 0));
  const labels = await page.locator('.after-photo label').allInnerTexts();
  check('and only the subtitle, the two boxes and one button', labels.join(' | ') === 'The subtitle | What it sounded like | What’s happening'
    && (await page.locator('.after-photo button').allInnerTexts()).join('|') === 'Save for later', labels.join(' | '));
  await shot(page, 'moment-after-photo-phone-light');
  await page.fill('#heard', 'ya kelk shoz');
  await page.fill('#scene', 'The car will not start');
  await page.click('.after-photo button');
  await page.waitForSelector('.saved-note');
  check('"Save for later" says it is saved', /Saved for later\./.test(await page.locator('.saved-note').innerText()));
  await page.waitForSelector('.said-big mark.tint', { timeout: 20000 });
  check('the French as said comes in, tinted', (await page.locator('.said-big').innerText()) === 'Y a quelque chose qui va pas.');
  check('with the sure word in plain English', /^fairly sure/.test(await page.locator('.said-big + .note').innerText()));
  const named = await page.locator('.why').innerText();
  check('and its patterns named', /il y a → y a/.test(named) && /ne is dropped/.test(named), named.slice(0, 80));
  await page.click('.controls [aria-pressed]');
  await page.waitForSelector('.controls [aria-pressed="true"]');
  check('Keep keeps the line', true);
  await page.goto(`${base}/moment?id=1`);
  await page.waitForSelector('.said-big');
  await shot(page, 'moment-open-phone-light');

  // a French subtitle: the ordinary "as said" pass
  await page.goto(`${base}/`);
  await page.setInputFiles('#photo', join(PICS, 'tv-french.png'));
  await page.waitForURL(/\/moment\?id=2&new=1/, { timeout: 15000 });
  await page.waitForFunction(() => document.getElementById('subtitle').value.length > 0, null, { timeout: 15000 });
  await page.click('.after-photo button');
  const fr = await momentSettled(page, 2);
  check('a French subtitle is worked out by the "as said" pass', fr.work_status === 'worked' && fr.line.spoken === "Chais pas c'que tu veux dire." && fr.sure === 'high');

  // no subtitle: saved with the note, no line
  await page.goto(`${base}/`);
  await page.setInputFiles('#photo', join(PICS, 'tv-none.png'));
  await page.waitForURL(/\/moment\?id=3&new=1/, { timeout: 15000 });
  await page.waitForFunction(() => /No subtitle in this photo/.test(document.getElementById('subtitle').placeholder), null, { timeout: 15000 });
  check('a photo with no subtitle says so', true);
  await page.fill('#scene', 'Two women arguing in a kitchen');
  await page.click('.after-photo button');
  const none = await momentSettled(page, 3);
  check('and is saved with the note and no line', none.work_status === 'nothing' && none.line === null && none.scene_note === 'Two women arguing in a kitchen');

  await page.goto(`${base}/tv`);
  await page.waitForSelector('.moment-item');
  const items = await page.locator('.moment-item').allInnerTexts();
  check('"From the TV" lists them newest first', items.length === 3 && /No subtitle in this photo/.test(items[0]) && /There's something wrong\./.test(items[2]), items.map((t) => t.replace(/\s+/g, ' ')).join(' | '));
  check('each with the French as said and the sure word', /Y a quelque chose qui va pas\.\s+fairly sure/.test(items[2]) && /sure/.test(items[1]));
  await shot(page, 'tv-list-phone-light');
  const pats = await (await page.request.get(`${base}/api/patterns`)).json();
  const shaky = pats.patterns.filter((p) => p.state === 'shaky').map((p) => p.id);
  check('the patterns of the photos are now shaky', shaky.includes('il-y-a') && shaky.includes('je-ch'), shaky.join(', '));
  await page.goto(`${base}/kept`);
  await page.waitForSelector('.kept-item');
  check('the kept line from the TV is on the kept page', /From the TV/.test(await page.locator('.kept-item').first().innerText()));
  await page.locator('.kept-item').first().click();
  await page.waitForURL(/\/moment\?id=1$/);
  check('and opens the photo', true);
  await page.goto(`${base}/`);
  await page.waitForSelector('#tv-section:not([hidden]) .moment-item');
  check('home shows the last three photos under the videos', (await page.locator('#moments .moment-item').count()) === 3);
  check('the thumbnails are drawn', await page.locator('#moments img').first().evaluate((i) => i.complete && i.naturalWidth > 0));
  check('no script errors on the TV pass', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

// --- practice: the drills, phone light, with the checks ---------------------
// The clip playing is found from the stand-in player's video and clock, and
// its written line from the clips route: the page itself never marks which
// choice is right.
async function playingClip(page, pattern) {
  const { vid, t } = await page.evaluate(() => ({ vid: window.__vid, t: window.__t }));
  const ids = pattern === 'mix' ? (await (await page.request.get(`${base}/api/drills`)).json()).patterns.filter((p) => p.clips).map((p) => p.id) : [pattern];
  const all = [];
  for (const id of ids) all.push(...(await (await page.request.get(`${base}/api/drills/clips/${id}`)).json()).items);
  return all.find((c) => c.video.youtube_id === vid && Math.abs(c.start_s - t) < 0.01);
}
async function pick(page, clip, right) {
  const labels = await page.locator('#card .choices').first().locator('.choice').allInnerTexts();
  const i = labels.findIndex((l) => (l.trim() === clip.written.trim()) === right);
  await page.locator('#card .choices').first().locator('.choice').nth(i).click();
}
{
  const { ctx, errors } = await context('phone', 'light');
  const page = await ctx.newPage();
  await login(page);
  check('"Practice" is in the top navigation', await page.isVisible('header.top nav a[href="/practice"]'));
  await page.goto(`${base}/practice`);
  await page.waitForSelector('.drill-entry');
  const entries = await page.locator('.drill-entry').allInnerTexts();
  check('the drills home lists Mix and the twenty patterns', entries.length === 21 && /^Mix/.test(entries[0]), `${entries.length}`);
  const drills = await (await page.request.get(`${base}/api/drills`)).json();
  const pats = await (await page.request.get(`${base}/api/patterns`)).json();
  check('in the patterns page\'s order, shaky first', drills.patterns.map((p) => p.id).join() === pats.patterns.map((p) => p.id).join() && drills.patterns[0].state === 'shaky');
  const jech = drills.patterns.find((p) => p.id === 'je-ch');
  check('a pattern with clips says how many', entries.some((e) => new RegExp(`je sais → chais[\\s\\S]*${jech.clips} clips`).test(e)), `${jech.clips}`);
  const none = drills.patterns.filter((p) => !p.clips);
  check('a pattern with none says "no clips yet — watch more videos"', none.length > 0 && (await page.locator('.drill-entry.off').count()) === none.length
    && /no clips yet — watch more videos/.test(await page.locator('.drill-entry.off').first().innerText()));
  await shot(page, 'practice-home-phone-light');

  await page.locator('a.drill-entry', { hasText: 'je sais → chais' }).click();
  await page.waitForURL(/\/practice\?p=je-ch/);
  await page.waitForSelector('#card .hear');
  check('a round opens with the line hidden', !(await page.isVisible('#card .choices')) && (await page.locator('#card .said').count()) === 0);
  await page.click('#card .hear');
  await page.waitForSelector('#card .choices');
  let clip = await playingClip(page, 'je-ch');
  check('"hear it" plays the clip from its start', Boolean(clip) && (await page.evaluate(() => window.__state)) === 1, clip ? `${clip.video.youtube_id} at ${clip.start_s}` : 'no clip at the clock');
  await page.evaluate((c) => { window.__t = c.end_s + 0.1; }, clip);
  await page.waitForFunction(() => window.__state === 2);
  check('and stops at its end', true);
  await page.click('#card .hear');
  check('"play again" plays the same few seconds', (await page.evaluate(() => window.__t)) === clip.start_s && (await page.evaluate(() => window.__state)) === 1);
  await page.evaluate((c) => { window.__t = c.end_s + 0.1; }, clip);
  const choices = await page.locator('#card .choice').allInnerTexts();
  check('three written lines to choose from, the real one among them', choices.length === 3 && choices.includes(clip.written) && new Set(choices).size === 3, choices.join(' | '));
  check('"Which pattern?" is not asked in a one-pattern round', (await page.locator('#card .q').allInnerTexts()).join() === 'What was said?');
  await shot(page, 'drill-hidden-phone-light');
  await pick(page, clip, true);
  await page.waitForSelector('#card .verdict');
  await wait(700);
  check('a right answer says "Knew it."', (await page.locator('#card .verdict').innerText()) === 'Knew it.');
  check('with the line as said, tinted', (await page.locator('#card .drill-line mark.tint').count()) > 0);
  check('and the pattern named with its explanation', /je sais → chais, je suis → chuis[^—\n]*— The e of je drops/.test(await page.locator('#card .why').innerText()));
  await shot(page, 'drill-right-phone-light');
  const total = Number((await page.locator('#card .label').first().textContent()).match(/of (\d+)/)[1]);
  check('a round is at most ten clips', total >= 1 && total <= 10, `${total}`);
  const seen = [clip.id];
  let wrongClip = null;
  for (let k = 1; k < total; k++) {
    await page.click('#card button.primary:not(.hear)');
    await page.waitForFunction((n) => document.querySelector('#card .label').textContent.startsWith(`clip ${n} `), k + 1);
    clip = await playingClip(page, 'je-ch');
    check(`"next" plays the next clip (${k + 1})`, Boolean(clip) && (await page.evaluate(() => window.__state)) === 1);
    seen.push(clip.id);
    const right = k !== 1;
    await pick(page, clip, right);
    await page.waitForSelector('#card .verdict');
    if (!right) {
      wrongClip = clip;
      check('a wrong answer says "Got past me."', (await page.locator('#card .verdict').innerText()) === 'Got past me.');
      await shot(page, 'drill-wrong-phone-light');
    }
  }
  check('no clip twice in the round', new Set(seen).size === seen.length, seen.join(','));
  await page.click('#card button.primary:not(.hear)');
  await page.waitForSelector('#card h2.title');
  const head = await page.locator('#card h2.title').innerText();
  check('the end screen counts the round', head === `${total} clips, ${total - 1} knew it, 1 got past me`, head);
  const missedLink = await page.locator('#card .kept-item').getAttribute('href');
  check('and lists the one that got past, opening its video at that line', missedLink === `/watch?id=${wrongClip.video.id}&line=${wrongClip.idx}`, missedLink);
  await shot(page, 'drill-end-phone-light');
  const after = await (await page.request.get(`${base}/api/patterns`)).json();
  check('a wrong answer makes its patterns shaky', wrongClip.patterns.every((id) => after.patterns.find((p) => p.id === id).state === 'shaky'));
  check('a right answer counts as heard in a drill', after.patterns.find((p) => p.id === 'je-ch').counts.drill_clean >= 1);
  await page.click('#card button.primary');
  await page.waitForSelector('#card .hear');
  check('"again" starts a new round', /^clip 1 of/.test(await page.locator('#card .label').first().textContent()));

  // Mix: "What was said?", then "Which pattern?"
  await page.goto(`${base}/practice`);
  await page.click('a.drill-entry.mix');
  await page.waitForURL(/\/practice\?p=mix/);
  await page.click('#card .hear');
  await page.waitForSelector('#card .choices');
  clip = await playingClip(page, 'mix');
  await pick(page, clip, true);
  await page.waitForSelector('#card .choices >> nth=1');
  const qs = await page.locator('#card .q').allInnerTexts();
  check('Mix asks "Which pattern?" after "What was said?"', qs.join(' | ') === 'What was said? | Which pattern?', qs.join(' | '));
  check('with the patterns not yet named', (await page.locator('#card .why').count()) === 0);
  const names = await page.locator('#card .choices').nth(1).locator('.choice').allInnerTexts();
  check('four pattern names', names.length === 4 && new Set(names).size === 4, names.join(' | '));
  await page.locator('#card .choices').nth(1).locator('.choice').first().click();
  await page.waitForSelector('#card .why');
  check('then the patterns are named', (await page.locator('#card .choices').nth(1).locator('.choice.right').count()) >= 1);
  await shot(page, 'drill-mix-phone-light');
  check('no script errors on the practice pass', errors.length === 0, errors.join(' | '));
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
    // Practice: the home, a clip with the line hidden, a right and a wrong
    // answer, the end screen
    await page.goto(`${base}/practice`);
    await page.waitForSelector('.drill-entry');
    await shot(page, `practice-home-${tag}`);
    await page.goto(`${base}/practice?p=je-ch`);
    await page.waitForSelector('#card .hear');
    await page.click('#card .hear');
    await page.waitForSelector('#card .choices');
    let clip = await playingClip(page, 'je-ch');
    await page.evaluate((c) => { window.__t = c.end_s + 0.1; }, clip);
    await wait(300);
    await shot(page, `drill-hidden-${tag}`);
    await pick(page, clip, true);
    await page.waitForSelector('#card .verdict');
    await wait(700);
    await shot(page, `drill-right-${tag}`);
    const total = Number((await page.locator('#card .label').first().textContent()).match(/of (\d+)/)[1]);
    for (let k = 1; k < total; k++) {
      await page.click('#card button.primary:not(.hear)');
      await page.waitForFunction((n) => document.querySelector('#card .label').textContent.startsWith(`clip ${n} `), k + 1);
      clip = await playingClip(page, 'je-ch');
      await page.evaluate((c) => { window.__t = c.end_s + 0.1; }, clip);
      await pick(page, clip, k !== 1);
      await page.waitForSelector('#card .verdict');
      if (k === 1) { await wait(700); await shot(page, `drill-wrong-${tag}`); }
    }
    await page.click('#card button.primary:not(.hear)');
    await page.waitForSelector('#card h2.title');
    await page.evaluate(() => window.scrollTo(0, 0));
    await wait(100);
    await shot(page, `drill-end-${tag}`);
    for (const p of ['kept', 'patterns']) {
      await page.goto(`${base}/${p}`);
      await page.waitForSelector(p === 'kept' ? '.kept-item' : '.pattern');
      await shot(page, `${p}-${tag}`);
    }
    await page.goto(`${base}/watch?id=2`);
    await page.waitForSelector('#typed mark.tint');
    await shot(page, `typed-${tag}`);
    // the pasted-transcript screens
    await page.goto(`${base}/`);
    await page.fill('#link', 'https://www.youtube.com/watch?v=refusedVid2');
    await page.fill('#transcript', '');
    await shot(page, `home-paste-field-${tag}`);
    await page.click('#link-go');
    await page.waitForSelector('#nolines:not([hidden])');
    await page.evaluate(() => window.scrollTo(0, 0));
    const help = await page.locator('#nolines').innerText();
    check(`the paste help fits the screen (${tag})`, view === 'phone' ? /On a phone or tablet/.test(help) && !/Ctrl\+A/.test(help) : /On a laptop/.test(help) && !/On a phone or tablet/.test(help));
    check(`the screenshot control is on the no-lines page (${tag})`, await page.isVisible('#pick'));
    await shot(page, `watch-no-captions-${tag}`);
    // screenshots: the home control with two added, and the readback
    await page.goto(`${base}/`);
    await page.fill('#link', 'https://www.youtube.com/watch?v=unknownVid3');
    await page.setInputFiles('#pictures', [join(PICS, 'shot-1.png'), join(PICS, 'shot-2.png')]);
    await page.locator('#pick').scrollIntoViewIfNeeded();
    await wait(100);
    await shot(page, `home-screenshots-added-${tag}`);
    await page.click('#link-go');
    await page.waitForURL(/\/watch\?id=6/, { timeout: 15000 });
    await page.waitForSelector('#readback:not([hidden])');
    await page.waitForSelector('#lines .line mark.tint', { timeout: 15000 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await wait(200);
    await shot(page, `watch-screenshots-readback-${tag}`);
    // the whole-page paste, joined into sentences; then "Paste the transcript again" open
    await page.goto(`${base}/watch?id=5`);
    await page.waitForSelector('#readback:not([hidden])');
    await page.waitForSelector('#lines .line');
    await page.evaluate(() => window.scrollTo(0, 0));
    await wait(200);
    await shot(page, `watch-joined-sentences-${tag}`);
    await page.click('#repaste summary');
    await page.locator('#repaste').scrollIntoViewIfNeeded();
    await wait(200);
    await shot(page, `watch-repaste-open-${tag}`);
    for (const [id, name] of [[3, 'watch-pasted-readback'], [4, 'watch-pasted-no-timings']]) {
      await page.goto(`${base}/watch?id=${id}`);
      await page.waitForSelector('#readback:not([hidden])');
      await page.waitForSelector('#lines .line mark.tint');
      await page.evaluate(() => window.scrollTo(0, 0));
      await wait(200);
      await shot(page, `${name}-${tag}`);
    }
    // photos from the TV: the way in, the after-photo screen, the list, one open
    await page.goto(`${base}/`);
    await page.waitForSelector('#tv-section:not([hidden])');
    await page.locator('#photo-pick').scrollIntoViewIfNeeded();
    await wait(100);
    await shot(page, `home-tv-photo-${tag}`);
    await page.locator('#tv-section').scrollIntoViewIfNeeded();
    await wait(200);
    await shot(page, `home-tv-list-${tag}`);
    await page.setInputFiles('#photo', join(PICS, 'tv-english.png'));
    await page.waitForURL(/\/moment\?id=\d+&new=1/, { timeout: 15000 });
    await page.waitForFunction(() => document.getElementById('subtitle').value.length > 0, null, { timeout: 15000 });
    await shot(page, `moment-after-photo-${tag}`);
    await page.goto(`${base}/tv`);
    await page.waitForSelector('.moment-item img');
    await wait(200);
    await shot(page, `tv-list-${tag}`);
    await page.goto(`${base}/moment?id=1`);
    await page.waitForSelector('.said-big');
    await wait(200);
    await shot(page, `moment-open-${tag}`);
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
