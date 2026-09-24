'use strict';
// French ear: one plain Node server.
//   /login (GET, POST), /logout, /health, the manifest, the service worker
//   and the icons                          — open
//   everything else                        — behind the passphrase cookie
// Fail closed: with APP_PASSWORD or COOKIE_SECRET unset, only the login page
// serves, and it says the server is not configured.

const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');

const auth = require('./lib/auth');
const db = require('./lib/db');
const youtube = require('./lib/youtube');
const spoken = require('./lib/spoken');
const tally = require('./lib/tally');
const { parseTranscript } = require('./lib/transcript');
const { joinFragments } = require('./lib/sentences');
const pictures = require('./lib/pictures');
const { PATTERNS } = require('./lib/patterns');
const ratelimit = require('./lib/ratelimit');
const { sendJson, sendHtml, redirect, readJson, readForm, serveStatic } = require('./lib/http');

const PORT = Number(process.env.PORT) || 8080;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'var');
const PUBLIC = path.join(__dirname, 'public');
const { APP_PASSWORD, COOKIE_SECRET } = process.env;
const SECURE_COOKIE = process.env.COOKIE_INSECURE !== '1';
const CONFIGURED = Boolean(APP_PASSWORD && COOKIE_SECRET);

if (!CONFIGURED) {
  const missing = ['APP_PASSWORD', 'COOKIE_SECRET'].filter((k) => !process.env[k]);
  console.error(`not configured: ${missing.join(', ')} unset. Only the login page will serve.`);
}

const LOGIN_TEMPLATE = fs.readFileSync(path.join(PUBLIC, 'login.html'), 'utf8');
const NOT_CONFIGURED = 'This server is not configured: APP_PASSWORD or COOKIE_SECRET is unset. Set both and restart.';

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Only a path on this site: never another host.
function safeNext(next) {
  return typeof next === 'string' && /^\/(?!\/)/.test(next) && !next.startsWith('/login') ? next : '/';
}

function loginPage(res, status, message = '', next = '/') {
  sendHtml(res, status, LOGIN_TEMPLATE.replace('{{MESSAGE}}', escapeHtml(message)).replace('{{NEXT}}', escapeHtml(safeNext(next))));
}

function wantsJson(req) {
  return (req.headers.accept || '').includes('application/json')
    || (req.headers['content-type'] || '').includes('application/json');
}

async function handleLogin(req, res) {
  if (!CONFIGURED) {
    return wantsJson(req) ? sendJson(res, 503, { error: NOT_CONFIGURED }) : loginPage(res, 503, NOT_CONFIGURED);
  }
  const wait = ratelimit.lockedFor(req);
  if (wait > 0) {
    const msg = `Too many wrong passphrases. Wait ${Math.ceil(wait / 60)} minute(s) and try again.`;
    return wantsJson(req) ? sendJson(res, 429, { error: msg, retry_after_s: wait }, { 'retry-after': String(wait) })
      : loginPage(res, 429, msg);
  }
  let body;
  try { body = await readJson(req); } catch (e) { return sendJson(res, e.status || 400, { error: e.message }); }
  if (!auth.passwordOk(body.passphrase, APP_PASSWORD)) {
    ratelimit.recordFailure(req);
    const msg = 'Wrong passphrase. Try again.';
    return wantsJson(req) ? sendJson(res, 401, { error: msg }) : loginPage(res, 401, msg, body.next);
  }
  ratelimit.clear(req);
  const headers = { 'set-cookie': auth.issueCookie(COOKIE_SECRET, { secure: SECURE_COOKIE }) };
  return wantsJson(req) ? sendJson(res, 200, { ok: true }, headers) : redirect(res, safeNext(body.next), headers);
}

// --- routes behind the cookie -----------------------------------------------

const api = [];
function route(method, pattern, run) { api.push({ method, pattern, run }); }

function videoOut(id) {
  const v = db.getVideo(id);
  return { ...v, working: spoken.isRunning(v.id) };
}

route('GET', /^\/api\/home$/, (req, res) => {
  const { totals } = tally.states(db.allEvents());
  return sendJson(res, 200, { totals, videos: db.listVideos({ limit: 5 }) });
});

route('GET', /^\/api\/patterns$/, (req, res) => sendJson(res, 200, tally.states(db.allEvents())));

// Caption fetches that failed, by YouTube id: what came back, so the page for
// a video with no lines can say it. Kept in memory only (a restart forgets
// them and the page says it in general words); nothing is saved without lines.
const failures = new Map();
function noteFailure(youtubeId, e) {
  failures.delete(youtubeId);
  failures.set(youtubeId, { error: e.message, kind: e.kind, tracks: e.detail?.tracks || [], at: new Date().toISOString() });
  while (failures.size > 200) failures.delete(failures.keys().next().value);
}

// A caption fetch for a video not yet saved. Saves it with its lines and
// starts the "as said" pass, or answers the failure in plain words. A fetch
// failure (not "no French captions") sends him to the video's own page,
// where he can paste the transcript or try YouTube again.
async function fetchAndSave(res, youtubeId, startS) {
  let got;
  try {
    got = await youtube.fetchVideo(youtubeId);
  } catch (e) {
    if (e instanceof youtube.CaptionError) {
      console.error(`captions for ${youtubeId}: ${e.message} ${JSON.stringify(e.detail)}`);
      if (e.kind === 'fetch') noteFailure(youtubeId, e);
      return sendJson(res, e.status, { error: e.message, kind: e.kind, detail: e.detail, youtube_id: youtubeId, page: e.kind === 'fetch' ? `/watch?yt=${youtubeId}` : null });
    }
    throw e;
  }
  const title = got.title || (await youtube.oembedTitle(youtubeId)) || `YouTube video ${youtubeId}`;
  const id = db.addVideo({ ...got, title, lines: joinFragments(got.lines) });
  failures.delete(youtubeId);
  console.log(`video ${id}: "${title}" (${got.lines.length} lines, track ${got.caption_track}; tracks: ${got.tracks.join(', ')})`);
  spoken.workVideo(id);
  return sendJson(res, 201, { ...videoOut(id), start_s: startS, tracks: got.tracks });
}

// A pasted transcript -> { lines, timed }: read, then joined into sentences.
function pastedLines(paste) {
  const { lines, timed } = parseTranscript(paste);
  if (!lines.length) throw new db.AppError(400, "I couldn't find any lines in that paste. Copy the text in YouTube's transcript panel and paste it again.");
  return { lines: joinFragments(lines), timed };
}

// { link, transcript? } -> the video. With a transcript pasted in, the caption
// fetch is skipped: the paste is the video's lines, and only the title and
// length come from YouTube (the link stands in for the title when YouTube
// gives nothing). Without one, the captions are fetched. A video already
// added answers the one saved; with a transcript, the paste replaces its
// lines. Either way the video is answered at once while the "as said" pass
// runs in the background.
route('POST', /^\/api\/videos$/, async (req, res) => {
  const body = await readJson(req);
  const link = youtube.parseLink(body.link);
  if (!link) throw new db.AppError(400, "That doesn't look like a YouTube link. Copy the link from the video's Share button and paste it here.");
  const had = db.findVideoByYoutubeId(link.id);
  const paste = typeof body.transcript === 'string' ? body.transcript.trim() : '';
  if (had && !paste) return sendJson(res, 200, { ...videoOut(had.id), start_s: link.start_s, existing: true });
  if (!paste) return fetchAndSave(res, link.id, link.start_s);

  const { lines, timed } = pastedLines(paste);
  if (had) {
    const r = db.replaceLines(had.id, lines, { caption_track: 'pasted' });
    console.log(`video ${had.id}: lines replaced by a new paste (${r.lines} lines, ${timed ? 'with' : 'without'} timings; ${r.moved} kept moved, ${r.earlier} kept from the earlier paste)`);
    spoken.workVideo(had.id);
    return sendJson(res, 200, { ...videoOut(had.id), start_s: link.start_s, existing: true, replaced: true });
  }
  const details = await youtube.fetchDetails(link.id);
  const title = details.title || `https://www.youtube.com/watch?v=${link.id}`;
  const id = db.addVideo({ youtube_id: link.id, title, duration_s: details.duration_s, caption_track: 'pasted', lines });
  failures.delete(link.id);
  console.log(`video ${id}: "${title}" (${lines.length} lines pasted, ${timed ? 'with' : 'without'} timings)`);
  spoken.workVideo(id);
  return sendJson(res, 201, { ...videoOut(id), start_s: link.start_s });
});

// Screenshots shared to French ear from another app (Android's Share), held
// here until he adds the video's link on the home page and sends them. In
// memory only, for an hour; a restart forgets them and the home page says so.
const PICTURE_LIMIT = 40 * 1024 * 1024;
const HELD_MS = 60 * 60 * 1000;
const held = new Map(); // token -> { files, at }
function holdPictures(files) {
  for (const [k, v] of held) if (Date.now() - v.at > HELD_MS) held.delete(k);
  while (held.size >= 20) held.delete(held.keys().next().value);
  const token = require('node:crypto').randomBytes(12).toString('hex');
  held.set(token, { files, at: Date.now() });
  return token;
}
const heldPictures = (token) => (typeof token === 'string' && held.get(token)) || null;
const isPicturePart = (f) => f.bytes.length > 0 && (f.field === 'screenshots' || /^image\//i.test(f.type));

// A multipart form: link, and screenshots of the transcript (the field
// "screenshots", several), and/or the token of screenshots shared in (the
// field "shared"). The pictures are read into lines (lib/pictures.js), joined
// into sentences, and saved as the video's lines the same way a pasted
// transcript is: a new video, or the lines of one already added replaced.
// Answers the video with `read`: how many lines came from each picture and
// how many were dropped, for "Here's how I read your screenshots".
route('POST', /^\/api\/screenshots$/, async (req, res) => {
  const form = await readForm(req, PICTURE_LIMIT, 'the link and the screenshots');
  const rawLink = (form.fields.link || '').trim();
  const shared = heldPictures(form.fields.shared);
  const files = [...(shared ? shared.files : []), ...form.files.filter(isPicturePart)]
    .map((f, i) => ({ name: f.fileName || `screenshot ${i + 1}`, bytes: f.bytes }));
  if (!rawLink) throw new db.AppError(400, "Paste the video's link too.");
  const link = youtube.parseLink(rawLink);
  if (!link) throw new db.AppError(400, "That doesn't look like a YouTube link. Copy the link from the video's Share button and paste it here.");
  if (!files.length) {
    throw new db.AppError(400, form.fields.shared && !shared
      ? 'The shared screenshots are no longer here (they are kept for an hour). Add them again.'
      : 'Add at least one screenshot of the transcript.');
  }

  const read = await pictures.readPictures(files);
  const lines = joinFragments(read.lines);
  for (const p of read.pictures) {
    console.log(`screenshots: ${p.name}: ${p.read} line(s) read, ${p.fresh} new${Object.keys(p.dropped).length ? `, dropped ${JSON.stringify(p.dropped)}` : ''} (${p.model}${p.usage && p.usage.cost != null ? `, cost $${p.usage.cost}` : ''}${p.usage ? `, ${p.usage.prompt_tokens} in / ${p.usage.completion_tokens} out tokens` : ''})`);
  }
  if (shared) held.delete(form.fields.shared);
  const summary = {
    lines: read.lines.length,
    pictures: read.pictures.map((p) => ({ name: p.name, read: p.read, fresh: p.fresh, dropped: Object.values(p.dropped).reduce((a, b) => a + b, 0), transcript: p.transcript })),
  };
  const had = db.findVideoByYoutubeId(link.id);
  if (had) {
    const r = db.replaceLines(had.id, lines, { caption_track: 'screenshots' });
    console.log(`video ${had.id}: lines replaced by ${files.length} screenshot(s) (${r.lines} lines; ${r.moved} kept moved, ${r.earlier} kept from the earlier lines)`);
    spoken.workVideo(had.id);
    return sendJson(res, 200, { ...videoOut(had.id), start_s: link.start_s, existing: true, replaced: true, read: summary });
  }
  const details = await youtube.fetchDetails(link.id);
  const title = details.title || `https://www.youtube.com/watch?v=${link.id}`;
  const id = db.addVideo({ youtube_id: link.id, title, duration_s: details.duration_s, caption_track: 'screenshots', lines });
  failures.delete(link.id);
  console.log(`video ${id}: "${title}" (${lines.length} lines from ${files.length} screenshot(s))`);
  spoken.workVideo(id);
  return sendJson(res, 201, { ...videoOut(id), start_s: link.start_s, read: summary });
});

// Screenshots shared in and held: how many, so the home page can say so.
route('GET', /^\/api\/shared\/(?<token>[0-9a-f]{24})$/, (req, res, { token }) => {
  const h = heldPictures(token);
  return sendJson(res, 200, { count: h ? h.files.length : 0 });
});

// A YouTube video by its YouTube id: the saved one, or, when none is saved,
// why its captions could not be fetched (null after a restart).
route('GET', /^\/api\/youtube\/(?<yt>[A-Za-z0-9_-]{11})$/, (req, res, { yt }) => {
  const had = db.findVideoByYoutubeId(yt);
  return sendJson(res, 200, { youtube_id: yt, video_id: had ? had.id : null, failure: had ? null : failures.get(yt) || null });
});

// "Try YouTube again": the caption fetch, once more.
route('POST', /^\/api\/youtube\/(?<yt>[A-Za-z0-9_-]{11})\/retry$/, async (req, res, { yt }) => {
  const had = db.findVideoByYoutubeId(yt);
  if (had) return sendJson(res, 200, { ...videoOut(had.id), existing: true });
  return fetchAndSave(res, yt, 0);
});

route('GET', /^\/api\/videos$/, (req, res) => sendJson(res, 200, { items: db.listVideos({ limit: 50 }) }));

route('GET', /^\/api\/videos\/(?<id>\d+)$/, (req, res, { id }) => sendJson(res, 200, videoOut(id)));

// The lines not yet worked out go round again.
route('POST', /^\/api\/videos\/(?<id>\d+)\/retry$/, (req, res, { id }) => {
  db.getVideo(id);
  const n = spoken.retryVideo(Number(id));
  return sendJson(res, 202, { ...videoOut(id), retrying: n });
});

// { text } -> one typed or pasted French sentence, worked out at once, as a
// video with no player. Nothing is recorded to the tally from this path.
route('POST', /^\/api\/typed$/, async (req, res) => {
  const body = await readJson(req);
  const text = typeof body.text === 'string' ? body.text.replace(/\s+/g, ' ').trim() : '';
  if (!text) throw new db.AppError(400, 'Type or paste a French sentence first.');
  if (text.length > 600) throw new db.AppError(400, 'That is longer than one sentence. Paste one line at a time (600 characters at most).');
  const title = text.length > 80 ? `${text.slice(0, 77)}…` : text;
  const id = db.addVideo({ youtube_id: null, title, lines: [{ written: text }] });
  await spoken.workVideo(id);
  return sendJson(res, 201, videoOut(id));
});

route('POST', /^\/api\/lines\/(?<id>\d+)\/keep$/, (req, res, { id }) => sendJson(res, 200, db.keepLine(id)));
route('DELETE', /^\/api\/lines\/(?<id>\d+)\/keep$/, (req, res, { id }) => sendJson(res, 200, db.unkeepLine(id)));

route('GET', /^\/api\/kept$/, (req, res) => sendJson(res, 200, { items: db.listKept() }));

// { kind, line_ids } -> one event per pattern in each line. kind is looked,
// got_past_me or watched_clean; keep goes through the keep route.
route('POST', /^\/api\/events$/, async (req, res) => {
  const body = await readJson(req);
  if (!['looked', 'got_past_me', 'watched_clean'].includes(body.kind)) throw new db.AppError(400, 'kind must be looked, got_past_me or watched_clean.');
  const ids = Array.isArray(body.line_ids) ? body.line_ids.map(Number).filter(Number.isInteger).slice(0, 50) : [];
  let recorded = 0;
  for (const lineId of ids) {
    const line = db.getLine(lineId);
    for (const p of line.patterns) { db.addEventRow(body.kind, p, line.id); recorded++; }
  }
  return sendJson(res, 200, { recorded });
});

route('GET', /^\/api\/pattern-list$/, (req, res) => sendJson(res, 200, { items: PATTERNS }));

// --- serving ----------------------------------------------------------------

const OPEN_FILES = new Set(['/manifest.webmanifest', '/sw.js', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/icon.svg', '/app.css']);
const PAGES = { '/': '/index.html', '/watch': '/watch.html', '/kept': '/kept.html', '/patterns': '/patterns.html' };

async function handle(req, res) {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;

  if (p === '/health') return sendJson(res, 200, { ok: true, configured: CONFIGURED });
  if (p === '/login' && req.method === 'GET') return loginPage(res, CONFIGURED ? 200 : 503, CONFIGURED ? '' : NOT_CONFIGURED, url.searchParams.get('next'));
  if (p === '/login' && req.method === 'POST') return handleLogin(req, res);
  if (p === '/logout') return redirect(res, '/login', { 'set-cookie': auth.clearCookie({ secure: SECURE_COOKIE }) });
  if (req.method === 'GET' && OPEN_FILES.has(p) && serveStatic(res, PUBLIC, p)) return;

  const isApi = p.startsWith('/api/');
  if (!CONFIGURED) return isApi ? sendJson(res, 503, { error: NOT_CONFIGURED }) : loginPage(res, 503, NOT_CONFIGURED);
  if (!auth.cookieOk(req, COOKIE_SECRET)) {
    return isApi ? sendJson(res, 401, { error: 'Sign in first.' }) : redirect(res, `/login?next=${encodeURIComponent(p + url.search)}`);
  }

  for (const r of api) {
    const m = r.method === req.method && r.pattern.exec(p);
    if (m) {
      try {
        return await r.run(req, res, m.groups || {}, url);
      } catch (e) {
        const status = e.status || 500;
        if (status === 500) console.error(e);
        return sendJson(res, status, { error: status === 500 ? 'Something went wrong on the server.' : e.message });
      }
    }
  }
  if (isApi) return sendJson(res, 404, { error: `No route ${req.method} ${p}.` });

  // Android's Share lands here (the manifest's share_target): the shared
  // text goes into the home page's link box, and shared screenshots are held
  // for the home page's screenshot control. The manifest shares by POST
  // (multipart, so pictures can come); a GET is an install from before that.
  if (p === '/share') {
    let fields = Object.fromEntries(url.searchParams), files = [];
    if (req.method === 'POST') {
      try { ({ fields, files } = await readForm(req, PICTURE_LIMIT, 'what was shared')); } catch (e) {
        console.error(`share: ${e.message}`);
        return redirect(res, `/?share_error=${encodeURIComponent(e.message)}`);
      }
    }
    const text = [fields.url, fields.text, fields.title].filter(Boolean).join(' ');
    const pics = files.filter(isPicturePart);
    const q = new URLSearchParams();
    if (text) q.set('shared', text);
    if (pics.length) q.set('pictures', holdPictures(pics));
    console.log(`share: ${text ? 'text' : 'no text'}, ${pics.length} picture(s)`);
    return redirect(res, `/${q.toString() ? `?${q}` : ''}`);
  }
  if (PAGES[p]) return serveStatic(res, PUBLIC, PAGES[p]) || sendJson(res, 404, { error: 'page missing' });
  if (/\.html$/.test(p) && PAGES[p.replace(/\.html$/, '')]) return redirect(res, p.replace(/\.html$/, '') + url.search);
  if (serveStatic(res, PUBLIC, p)) return;
  return sendJson(res, 404, { error: `Nothing at ${p}.` });
}

db.open(DATA_DIR);
console.log(`database: ${path.join(DATA_DIR, 'french-ear.db')}`);
// Videos saved before lines were joined into sentences are joined now; their
// lines go back to pending and the "as said" pass runs on the sentences.
for (const id of db.videosNotJoined()) {
  const old = db.getVideo(id).lines;
  const joined = joinFragments(old);
  if (joined.length === old.length && joined.every((l, i) => l.written === old[i].written)) { db.markJoined(id); continue; }
  const r = db.replaceLines(id, joined);
  console.log(`video ${id}: ${old.length} caption lines joined into ${r.lines} sentences (${r.moved} kept moved, ${r.earlier} kept from the earlier lines)`);
}
// Lines left pending by a restart are worked again.
for (const id of db.videosWithPending()) spoken.workVideo(id);

const server = http.createServer((req, res) => {
  handle(req, res).catch((e) => {
    console.error(e);
    if (!res.headersSent) sendJson(res, 500, { error: 'Server error.' });
  });
});

server.listen(PORT, () => console.log(`french-ear listening on ${PORT}${CONFIGURED ? '' : ' (NOT CONFIGURED)'}; models ${spoken.MODEL}, then ${spoken.FALLBACK_MODEL}`));

module.exports = { server };
