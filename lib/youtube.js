'use strict';
// YouTube, server side: the link parser, and the fetch of a video's title and
// French caption track. No video or audio is ever fetched; the watch page
// plays through YouTube's own embedded player.
//
// The fetch, in order:
//   1. the watch page (for the Innertube key, and its own player response as
//      a second source of caption tracks);
//   2. the Innertube player call as the Android client, whose caption links
//      answer without a browser token (the watch page's links often answer
//      empty to a server);
//   3. the chosen track: a French track that is not auto-generated, else the
//      French auto-generated one; else no French captions, and nothing saved;
//   4. the track's text, as XML (srv1 or srv3), with json3 as a second try.
// Every failure names the step and what came back, so the screen can say it.
// YT_BASE points the whole fetch at a local mock in checks.

const YT_BASE = () => process.env.YT_BASE || 'https://www.youtube.com';
const TIMEOUT_MS = 20000;
const ANDROID = { clientName: 'ANDROID', clientVersion: '20.10.38', androidSdkVersion: 30, hl: 'fr', gl: 'FR' };
const UA_BROWSER = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';
const UA_ANDROID = 'com.google.android.youtube/20.10.38 (Linux; U; Android 11) gzip';

class CaptionError extends Error {
  // kind: 'no-french' (the video has no French track), 'fetch' (a step failed)
  constructor(kind, message, detail = {}) {
    super(message);
    this.kind = kind;
    this.status = kind === 'no-french' ? 422 : 502;
    this.detail = detail;
  }
}

// --- the link ---------------------------------------------------------------

const ID = /^[A-Za-z0-9_-]{11}$/;

// A YouTube link in any of the usual forms (watch?v=, youtu.be/, shorts/,
// embed/, live/, m. and music. hosts, with or without a timestamp), or text
// with such a link inside it (what Android's Share hands over), or a bare
// eleven-character id. Answers { id, start_s } or null.
function parseLink(input) {
  if (typeof input !== 'string') return null;
  const text = input.trim();
  if (ID.test(text)) return { id: text, start_s: 0 };
  const urls = text.match(/https?:\/\/[^\s<>"']+|(?:www\.|m\.|music\.)?youtu(?:be\.com|\.be)\/[^\s<>"']+/gi) || [];
  for (const raw of urls) {
    let u;
    try { u = new URL(/^https?:/i.test(raw) ? raw : `https://${raw}`); } catch { continue; }
    const host = u.hostname.toLowerCase().replace(/^(www|m|music)\./, '');
    let id = null;
    if (host === 'youtu.be') id = u.pathname.split('/')[1];
    else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
      if (u.pathname === '/watch') id = u.searchParams.get('v');
      else {
        const m = u.pathname.match(/^\/(?:shorts|embed|live|v)\/([^/?#]+)/);
        if (m) id = m[1];
      }
    }
    if (id && ID.test(id)) return { id, start_s: parseTime(u.searchParams.get('t') || u.searchParams.get('start') || (u.hash.match(/t=([^&]+)/) || [])[1]) };
  }
  return null;
}

// "90", "90s", "1m30s", "1h2m3s" -> seconds; anything else 0.
function parseTime(t) {
  if (!t) return 0;
  if (/^\d+$/.test(t)) return Number(t);
  const m = String(t).match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
  if (!m || !m[0]) return 0;
  return (Number(m[1] || 0) * 3600) + (Number(m[2] || 0) * 60) + Number(m[3] || 0);
}

// --- fetching ---------------------------------------------------------------

async function get(url, { headers = {}, method = 'GET', body } = {}, step) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { method, headers, body, signal: ac.signal, redirect: 'follow' });
    return { status: res.status, text: await res.text(), url: res.url };
  } catch (e) {
    throw new CaptionError('fetch', `YouTube could not be reached (${step}: ${e.name === 'AbortError' ? 'no answer in 20 seconds' : e.message}).`, { step });
  } finally {
    clearTimeout(timer);
  }
}

const head = (s, n = 160) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);

// What a refusing watch page says, in a few words, when it says anything.
function refusal(html) {
  if (/confirm you.re not a bot|Sign in to confirm/i.test(html)) return 'YouTube asked the server to sign in to prove it is not a bot';
  if (/consent\.youtube\.com|before you continue to youtube/i.test(html)) return 'YouTube showed its cookie-consent page instead of the video';
  if (/g-recaptcha|unusual traffic/i.test(html)) return 'YouTube showed a captcha (unusual traffic from the server)';
  return null;
}

// The JSON object assigned after `marker` in a page's script, or null.
function jsonAfter(html, marker) {
  const at = html.indexOf(marker);
  if (at < 0) return null;
  const start = html.indexOf('{', at);
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < html.length; i++) {
    const c = html[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) {
      try { return JSON.parse(html.slice(start, i + 1)); } catch { return null; }
    }
  }
  return null;
}

async function watchPage(videoId) {
  const r = await get(`${YT_BASE()}/watch?v=${videoId}&hl=fr&bpctr=9999999999&has_verified=1`, {
    headers: { 'user-agent': UA_BROWSER, 'accept-language': 'fr-FR,fr;q=0.9,en;q=0.8', cookie: 'CONSENT=YES+cb; SOCS=CAI' },
  }, 'watch page');
  if (r.status !== 200) throw new CaptionError('fetch', `YouTube's watch page answered ${r.status}.`, { step: 'watch page', status: r.status, head: head(r.text) });
  const key = (r.text.match(/"INNERTUBE_API_KEY"\s*:\s*"([^"]+)"/) || [])[1] || null;
  const player = jsonAfter(r.text, 'ytInitialPlayerResponse');
  return { html: r.text, key, player };
}

async function androidPlayer(videoId, key) {
  const url = `${YT_BASE()}/youtubei/v1/player?prettyPrint=false${key ? `&key=${encodeURIComponent(key)}` : ''}`;
  const r = await get(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': UA_ANDROID, 'x-youtube-client-name': '3', 'x-youtube-client-version': ANDROID.clientVersion },
    body: JSON.stringify({ context: { client: ANDROID }, videoId, contentCheckOk: true, racyCheckOk: true }),
  }, 'player call');
  if (r.status !== 200) return { error: `the player call answered ${r.status} (${head(r.text, 120)})` };
  try { return { player: JSON.parse(r.text) }; } catch { return { error: `the player call answered something that is not JSON (${head(r.text, 120)})` }; }
}

function tracksOf(player) {
  return player?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
}

function trackName(t) {
  const n = t.name?.simpleText || (t.name?.runs || []).map((r) => r.text).join('') || t.languageCode;
  return `${n}${t.kind === 'asr' && !/auto/i.test(n) ? ' (auto-generated)' : ''}`;
}

// A French track not auto-generated, else a French auto-generated one.
function chooseTrack(tracks) {
  const fr = tracks.filter((t) => /^fr(\b|-|_|$)/i.test(t.languageCode || ''));
  return fr.find((t) => t.kind !== 'asr') || fr.find((t) => t.kind === 'asr') || null;
}

// --- caption text -----------------------------------------------------------

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function decodeEntities(s) {
  let out = String(s);
  for (let i = 0; i < 2; i++) {
    out = out.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
      if (e[0] === '#') {
        const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : m;
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    });
  }
  return out;
}

const clean = (s) => decodeEntities(String(s).replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim().normalize('NFC');

// XML (srv1 <text start dur>, or srv3 <p t d>) or json3 -> [{ start_s, end_s, written }].
function parseCaptions(body) {
  const text = String(body || '').trim();
  const lines = [];
  if (text.startsWith('{')) {
    let j;
    try { j = JSON.parse(text); } catch { return []; }
    for (const ev of j.events || []) {
      if (!ev.segs) continue;
      const w = clean(ev.segs.map((s) => s.utf8 || '').join(''));
      if (!w) continue;
      const start = (ev.tStartMs || 0) / 1000;
      lines.push({ start_s: start, end_s: start + (ev.dDurationMs || 0) / 1000, written: w });
    }
  } else if (/<text\b/.test(text)) {
    for (const m of text.matchAll(/<text\b([^>]*)>([\s\S]*?)<\/text>/g)) {
      const start = Number((m[1].match(/start="([\d.]+)"/) || [])[1] || 0);
      const dur = Number((m[1].match(/dur="([\d.]+)"/) || [])[1] || 0);
      const w = clean(m[2]);
      if (w) lines.push({ start_s: start, end_s: start + dur, written: w });
    }
  } else if (/<p\b/.test(text)) {
    for (const m of text.matchAll(/<p\b([^>]*)>([\s\S]*?)<\/p>/g)) {
      const t = Number((m[1].match(/\bt="(\d+)"/) || [])[1] || 0);
      const d = Number((m[1].match(/\bd="(\d+)"/) || [])[1] || 0);
      const w = clean(m[2]);
      if (w) lines.push({ start_s: t / 1000, end_s: (t + d) / 1000, written: w });
    }
  }
  // Auto-generated tracks overlap: each line ends when the next begins.
  for (let i = 0; i < lines.length - 1; i++) {
    if (lines[i + 1].start_s > lines[i].start_s && lines[i].end_s > lines[i + 1].start_s) lines[i].end_s = lines[i + 1].start_s;
  }
  return lines.map((l) => ({ ...l, start_s: round(l.start_s), end_s: round(l.end_s) }));
}

const round = (n) => Math.round(n * 1000) / 1000;

async function trackText(track, names = []) {
  const base = String(track.baseUrl || '').replace(/&fmt=[^&]*/g, '');
  const url = /^https?:/i.test(base) ? base : `${YT_BASE()}${base}`;
  const tries = [];
  for (const fmt of ['', '&fmt=json3']) {
    const r = await get(url + fmt, { headers: { 'user-agent': UA_BROWSER, 'accept-language': 'fr-FR,fr;q=0.9' } }, 'caption text');
    const lines = r.status === 200 ? parseCaptions(r.text) : [];
    if (lines.length) return lines;
    tries.push(`${fmt ? 'json3' : 'xml'}: ${r.status}, ${r.text.length} characters${r.text.length ? ` ("${head(r.text, 80)}")` : ''}`);
  }
  throw new CaptionError('fetch', `YouTube listed a French track but gave no text for it (${tries.join('; ')}). Captions the video offers: ${names.join(', ') || 'none named'}.`, { step: 'caption text', tries, tracks: names });
}

// videoId -> { title, duration_s, caption_track, tracks, lines }. Throws a
// CaptionError naming the step that failed and what came back.
async function fetchVideo(videoId) {
  const page = await watchPage(videoId);
  const said = refusal(page.html);
  const android = await androidPlayer(videoId, page.key);
  const players = [android.player, page.player].filter(Boolean);
  const status = players.map((p) => p.playabilityStatus?.status).find(Boolean) || null;
  const details = players.map((p) => p.videoDetails).find((d) => d && d.title) || {};
  let tracks = tracksOf(android.player);
  if (!tracks.length) tracks = tracksOf(page.player);

  if (!tracks.length) {
    if (!players.length || (status && status !== 'OK')) {
      const why = [said, status && status !== 'OK' ? `YouTube said the video is ${status}${players[0]?.playabilityStatus?.reason ? ` ("${players[0].playabilityStatus.reason}")` : ''}` : null, android.error].filter(Boolean).join('; ');
      throw new CaptionError('fetch', `YouTube did not hand over the video's details (${why || 'no player response in the watch page'}).`, { step: 'player', status, android: android.error || null });
    }
    throw new CaptionError('no-french', 'This video has no French captions I can read. (It has no captions at all.)', { tracks: [] });
  }
  const names = tracks.map(trackName);
  const chosen = chooseTrack(tracks);
  if (!chosen) {
    throw new CaptionError('no-french', `This video has no French captions I can read. (Captions it has: ${names.join(', ')}.)`, { tracks: names });
  }
  const lines = await trackText(chosen, names);
  return {
    youtube_id: videoId,
    title: details.title || null,
    duration_s: details.lengthSeconds ? Number(details.lengthSeconds) : null,
    caption_track: `${trackName(chosen)} [${chosen.languageCode}${chosen.kind === 'asr' ? ', auto' : ''}]`,
    tracks: names,
    lines,
  };
}

// The title and length alone, for a video whose lines he pasted in: the same
// watch page and player call as fetchVideo (the part that answered from Fly),
// no caption text. Answers { title, duration_s }, either null when YouTube
// gave nothing; never throws.
async function fetchDetails(videoId) {
  try {
    const page = await watchPage(videoId);
    const android = await androidPlayer(videoId, page.key);
    const d = [android.player, page.player].filter(Boolean).map((p) => p.videoDetails).find((x) => x && x.title) || {};
    return { title: d.title || null, duration_s: d.lengthSeconds ? Number(d.lengthSeconds) : null };
  } catch {
    return { title: null, duration_s: null };
  }
}

// The title alone, from YouTube's oEmbed, when the player gave none.
async function oembedTitle(videoId) {
  try {
    const r = await get(`${YT_BASE()}/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}`, {}, 'title');
    return r.status === 200 ? JSON.parse(r.text).title || null : null;
  } catch { return null; }
}

module.exports = { parseLink, parseTime, parseCaptions, chooseTrack, fetchVideo, fetchDetails, oembedTitle, CaptionError, decodeEntities };
