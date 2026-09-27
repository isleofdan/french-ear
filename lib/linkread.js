'use strict';
// A video's lines read straight from its YouTube link, by Gemini through
// OpenRouter. YouTube refuses its own captions to the server (HTTP 429 from
// Fly), and he already gets transcripts by giving Gemini the link, so the
// app does the same: pasting the link is the whole job.
//
// One OpenRouter chat call. The user message carries the instruction and a
// `video_url` part holding the YouTube watch link. OpenRouter's video page
// (https://openrouter.ai/docs/features/multimodal/videos, read 27 Sep) says
// only Google Gemini served by Google AI Studio accepts YouTube links (not
// Vertex), so the call pins the provider to AI Studio with OpenRouter's
// `provider` field and no fallback to another provider. LINK_PROVIDER
// overrides the provider name if OpenRouter names it differently.
//
// The answer is JSON: { lines: [{ start: "m:ss", end: "m:ss", text }] }, every
// spoken French sentence in order, in ordinary written French. Every line is
// checked (checkLinkLine): the start must read as a time and never go
// backwards, the end must not come before the start, the text must not be
// empty. A line that fails is dropped and its reason counted. Fewer than
// three good lines is a refusal, not a video.
//
// Nothing here saves anything: lines out, in the shape the paste reader
// gives ({ start_s, end_s, written }), for the same joining and "as said"
// steps.

const { parseTime } = require('./pictures');

const LINK_MODEL = process.env.LINK_MODEL || 'google/gemini-2.5-flash';
const LINK_PROVIDER = process.env.LINK_PROVIDER || 'google-ai-studio';
const OPENROUTER_URL = () => process.env.OPENROUTER_URL || 'https://openrouter.ai/api/v1/chat/completions';
const MIN_LINES = 3;
const MAX_LINES = 600;
const LAST_LINE_S = 4;

// Time limits come from the expected size of the answer. A sentence in an
// Easy French video lasts about five seconds, so a ten-minute video is ~120
// lines; with no length known, assume fifteen minutes (~180). Each line is
// ~20 tokens of text plus ~15 of times and brackets. Written out at a
// cautious 40 tokens a second, plus 90 seconds for Gemini to take in the
// video: a ten-minute video ~195 seconds. The output allowance is doubled,
// and doubled again for the thinking Gemini 2.5 does before it answers.
function linkBudget(durationS) {
  const lines = Math.min(MAX_LINES, Math.max(40, Math.ceil((Number(durationS) || 900) / 5)));
  const tokens = 60 + lines * (20 + 15);
  return { lines, maxTokens: Math.ceil(tokens * 4), timeoutMs: 90000 + Math.ceil(tokens / 40) * 1000 };
}

const SYSTEM = `You write the transcript of a French video, for a learner of French who wants to see, line by line, what was said.

Answer with ONE JSON object and nothing else:
{"lines": [{"start": "m:ss", "end": "m:ss", "text": "<the sentence>"}]}

Rules:
- Every spoken French sentence in the video, in order, from the first to the last. One sentence per line; split a long run of speech at its sentence ends.
- "start" and "end" are when the sentence begins and ends in the video, as minutes:seconds (like 0:07 or 12:41), or hours:minutes:seconds past an hour.
- "text" is the sentence spelled in ordinary written French, the way a book would print it: every word written out in full, with its accents, apostrophes and punctuation. Write the standard written form even where the speaker drops or blurs sounds: "je ne sais pas", not "chais pas"; "il y a", not "y a"; "tu as", not "t'as"; "je suis", not "chuis". Not phonetic, not shortened.
- Nothing invented: if a stretch cannot be made out, leave it out.
- Ignore text shown on the screen (subtitles, titles, captions burned into the picture): write what is heard.
- Leave out music, sound effects and speech in other languages.
- If there is no French speech in the video, answer {"lines": []}.`;

const tidy = (s) => String(s).replace(/\s+/g, ' ').trim().normalize('NFC');

// A time as Gemini may write it: "m:ss", "h:mm:ss", with or without a
// fraction of a second ("0:07.5"), or a number of seconds. null otherwise.
function readTime(raw) {
  if (typeof raw === 'number') return Number.isFinite(raw) && raw >= 0 ? raw : null;
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (/^\d+(\.\d+)?$/.test(s)) return Number(s);
  const m = s.match(/^((?:\d{1,2}:)?\d{1,2}:\d{2})(?:[.,](\d{1,3}))?$/);
  if (!m) return null;
  const whole = parseTime(m[1]);
  if (whole == null) return null;
  return m[2] ? whole + Number(`0.${m[2]}`) : whole;
}

// One line of the answer, against the start of the line before it.
// { ok: true, start_s, end_s, written } or { ok: false, reason }. An end left
// out (or unreadable) is not a reason to drop a good line: it is left null
// and filled from the next line's start.
function checkLinkLine(item, previousS) {
  if (!item || typeof item !== 'object') return { ok: false, reason: 'not an object' };
  const start = readTime(item.start);
  if (start == null) return { ok: false, reason: 'the start did not read as a time' };
  const written = typeof item.text === 'string' ? tidy(item.text) : '';
  if (!written) return { ok: false, reason: 'no text' };
  if (previousS != null && start < previousS) return { ok: false, reason: 'the time went backwards' };
  const end = item.end == null || item.end === '' ? null : readTime(item.end);
  if (end != null && end < start) return { ok: false, reason: 'the end came before the start' };
  return { ok: true, start_s: start, end_s: end, written };
}

// The model's text -> { items } or null when it is not JSON.
function readLinkAnswer(content) {
  const text = String(content || '').replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, '');
  const start = text.indexOf('{');
  if (start < 0) return null;
  try {
    const v = JSON.parse(text.slice(start, text.lastIndexOf('}') + 1));
    if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
    return { items: Array.isArray(v.lines) ? v.lines : [] };
  } catch {
    return null;
  }
}

// Answer items -> { lines, dropped: { reason: count } }, checked in order;
// a missing end filled from the next start.
function checkLinkLines(items) {
  const lines = [];
  const dropped = {};
  let previous = null;
  for (const it of items.slice(0, MAX_LINES)) {
    const r = checkLinkLine(it, previous);
    if (!r.ok) { dropped[r.reason] = (dropped[r.reason] || 0) + 1; continue; }
    lines.push({ start_s: r.start_s, end_s: r.end_s, written: r.written });
    previous = r.start_s;
  }
  lines.forEach((l, i) => {
    if (l.end_s == null) l.end_s = lines[i + 1] && lines[i + 1].start_s > l.start_s ? lines[i + 1].start_s : l.start_s + LAST_LINE_S;
  });
  return { lines, dropped };
}

// A refusal, in plain words for the screen. `from` says where it came from:
// 'openrouter' (the call itself: unreachable, an error status, no answer in
// time, an unexpected shape), 'gemini' (it answered, but with no lines or
// not JSON), 'checks' (its lines failed the app's own checks).
class LinkReadError extends Error {
  constructor(from, reason) {
    super(`Gemini couldn't read this video: ${reason}`);
    this.from = from;
    this.reason = reason;
  }
}

function linkRequest(youtubeId, size) {
  return {
    model: LINK_MODEL,
    temperature: 0,
    max_tokens: size.maxTokens,
    response_format: { type: 'json_object' },
    usage: { include: true },
    provider: { only: [LINK_PROVIDER], allow_fallbacks: false },
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: [
        { type: 'text', text: 'Write the transcript of this video.' },
        { type: 'video_url', video_url: { url: `https://www.youtube.com/watch?v=${youtubeId}` } },
      ] },
    ],
  };
}

// youtubeId (and the video's length, when known) -> { lines, read, dropped,
// model, usage }. Throws a LinkReadError naming what refused.
async function readLink(youtubeId, { durationS } = {}) {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new LinkReadError('openrouter', 'the server has no OpenRouter key.');
  const size = linkBudget(durationS);
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), size.timeoutMs);
  let res, text;
  try {
    res = await fetch(OPENROUTER_URL(), {
      method: 'POST',
      signal: ac.signal,
      headers: {
        authorization: `Bearer ${key}`,
        'content-type': 'application/json',
        'http-referer': 'https://french-ear-dan.fly.dev',
        'x-title': 'french-ear',
      },
      body: JSON.stringify(linkRequest(youtubeId, size)),
    });
    text = await res.text();
  } catch (e) {
    throw new LinkReadError('openrouter', e.name === 'AbortError'
      ? `no answer in ${Math.round(size.timeoutMs / 1000)} seconds.`
      : `OpenRouter could not be reached (${e.message}).`);
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    let detail = '';
    try { detail = JSON.parse(text)?.error?.message || ''; } catch { /* plain */ }
    throw new LinkReadError('openrouter', `OpenRouter answered ${res.status}${detail ? ` (${detail.slice(0, 200)})` : ''}.`);
  }
  let content = '', usage = null, finish = null;
  try {
    const body = JSON.parse(text);
    if (body.error) throw new LinkReadError('openrouter', `OpenRouter answered with an error (${String(body.error.message || '').slice(0, 200)}).`);
    content = String(body.choices[0].message.content || '');
    finish = body.choices[0].finish_reason || null;
    usage = body.usage || null;
  } catch (e) {
    if (e instanceof LinkReadError) throw e;
    throw new LinkReadError('openrouter', 'OpenRouter answered in an unexpected shape.');
  }
  const answer = readLinkAnswer(content);
  if (!answer) {
    throw new LinkReadError('gemini', finish === 'length'
      ? 'its answer was cut off before the end (the video may be too long).'
      : 'its answer was not the list of lines I asked for.');
  }
  if (!answer.items.length) throw new LinkReadError('gemini', 'it found no French speech in it.');
  const { lines, dropped } = checkLinkLines(answer.items);
  const nDropped = Object.values(dropped).reduce((a, b) => a + b, 0);
  if (lines.length < MIN_LINES) {
    const why = Object.entries(dropped).map(([r, n]) => `${n} ${r}`).join(', ');
    throw new LinkReadError('checks', `only ${lines.length} of its ${answer.items.length} line${answer.items.length === 1 ? '' : 's'} passed my checks${why ? ` (${why})` : ''}.`);
  }
  return { lines, read: answer.items.length, dropped, nDropped, model: LINK_MODEL, usage, finish };
}

module.exports = {
  readLink, checkLinkLine, checkLinkLines, readLinkAnswer, readTime, linkBudget, linkRequest,
  LinkReadError, SYSTEM, LINK_MODEL, LINK_PROVIDER, MIN_LINES,
};
