'use strict';
// Transcript lines read out of pictures: phone screenshots of YouTube's "Show
// transcript" panel today, and later other pictures of printed lines. Nothing
// here knows about YouTube: pictures in, timed lines out, in the same shape
// the paste reader gives ({ start_s, end_s, written }), so the rest of the
// app cannot tell where the lines came from.
//
// One OpenRouter call per picture, to a model that reads images, asking for
// JSON: every line in order, its time exactly as shown (m:ss or h:mm:ss) and
// its text exactly as printed, nothing invented. Every line of the answer is
// checked (checkPictureLine): the time must read as a time, times must never
// go backwards within one picture, the text must not be empty. A line that
// fails is dropped and its reason counted, never guessed at.
//
// Several pictures of one transcript overlap (he scrolls and takes another):
// they are merged by time, the first text seen for a time kept, and each
// picture's count of new lines reported. A picture with no transcript in it
// gives no lines and says so.
//
// Models: IMAGE_MODEL first; when that call fails outright (unreachable, an
// error status, no answer in time, no JSON), the same picture goes once to
// IMAGE_FALLBACK_MODEL. Both are named in README.md.

const IMAGE_MODEL = process.env.IMAGE_MODEL || 'google/gemini-2.5-flash';
const IMAGE_FALLBACK_MODEL = process.env.IMAGE_FALLBACK_MODEL || 'anthropic/claude-sonnet-4.6';
const OPENROUTER_URL = () => process.env.OPENROUTER_URL || 'https://openrouter.ai/api/v1/chat/completions';
const MAX_PICTURES = 12;
const MAX_LINES_PER_PICTURE = 80;
const LAST_LINE_S = 6;
const PARALLEL = 3;

const NO_TRANSCRIPT = "I couldn't find a transcript in this picture.";
const NO_TRANSCRIPT_ANY = "I couldn't find a transcript in these pictures.";

// Time limits come from the expected size of the answer. A phone screenshot
// of the panel holds 8 to 15 lines, a tablet's up to 30; allowing 60 lines of
// about 45 characters, each is ~15 tokens of text plus ~12 of time and
// brackets: ~1,700 tokens with the wrapper. Written out at a cautious 40
// tokens a second, plus 30 seconds to start and take in the picture: ~73
// seconds.
function budget() {
  const tokens = 80 + 60 * (15 + 12);
  return { maxTokens: Math.ceil(tokens * 2), timeoutMs: 30000 + Math.ceil(tokens / 40) * 1000 };
}

const SYSTEM = `You read transcript lines out of a picture, for a learner of French. The picture is usually a phone screenshot of a video app's transcript panel: each entry is a time (like 0:12, 12:05 or 1:02:33) and, under it or beside it, a line of French text.

Answer with ONE JSON object and nothing else:
{"transcript": true, "lines": [{"time": "<the time exactly as shown>", "text": "<the text exactly as printed>"}]}

Rules:
- Every transcript entry you can see, top to bottom, in order. One entry per time shown.
- "time" is copied exactly as printed, digits and colons only.
- "text" is copied exactly as printed: same words, same spelling, same accents, same apostrophes and punctuation. Do not correct, translate, complete or join anything. If an entry's text runs over two printed lines, join them with a space.
- Leave out an entry cut off at the top or bottom edge whose time or text you cannot read whole.
- Leave out everything that is not a transcript entry: the app's buttons, headings, the video title, the clock, the battery, keyboard, chapter titles.
- If the picture has no transcript in it, answer {"transcript": false, "lines": []}.`;

// --- checking the model's answer -------------------------------------------

const TIME = /^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})$/;
const tidy = (s) => String(s).replace(/\s+/g, ' ').trim().normalize('NFC');

// "1:02:33" -> 3753; null when it does not read as a time.
function parseTime(raw) {
  if (typeof raw !== 'string') return null;
  const m = TIME.exec(raw.trim().replace(/^[[(]|[\])]$/g, ''));
  if (!m) return null;
  const [h, min, sec] = [Number(m[1] || 0), Number(m[2]), Number(m[3])];
  if (sec > 59 || (m[1] != null && min > 59)) return null;
  return h * 3600 + min * 60 + sec;
}

// One line of the answer, against the time of the line before it in the same
// picture. { ok: true, start_s, written } or { ok: false, reason }.
function checkPictureLine(item, previousS) {
  if (!item || typeof item !== 'object') return { ok: false, reason: 'not an object' };
  const start = parseTime(item.time);
  if (start == null) return { ok: false, reason: 'the time did not read as a time' };
  const written = typeof item.text === 'string' ? tidy(item.text) : '';
  if (!written) return { ok: false, reason: 'no text' };
  if (previousS != null && start < previousS) return { ok: false, reason: 'the time went backwards' };
  return { ok: true, start_s: start, written };
}

// The model's text -> { transcript, items } or null when it is not JSON.
function readPictureAnswer(content) {
  const text = String(content || '').replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, '');
  const start = text.indexOf('{');
  if (start < 0) return null;
  try {
    const v = JSON.parse(text.slice(start, text.lastIndexOf('}') + 1));
    const items = Array.isArray(v.lines) ? v.lines : [];
    return { transcript: v.transcript !== false && items.length > 0, items };
  } catch {
    return null;
  }
}

// Answer items -> { lines, dropped: { reason: count } }, checked in order.
function checkPicture(items) {
  const lines = [];
  const dropped = {};
  let previous = null;
  for (const it of items.slice(0, MAX_LINES_PER_PICTURE)) {
    const r = checkPictureLine(it, previous);
    if (!r.ok) { dropped[r.reason] = (dropped[r.reason] || 0) + 1; continue; }
    lines.push({ start_s: r.start_s, written: r.written });
    previous = r.start_s;
  }
  return { lines, dropped };
}

// Pictures' lines -> one list by time; the first text seen for a time is
// kept. Answers { lines, fresh: [new lines from each picture] }.
function mergeByTime(perPicture) {
  const byTime = new Map();
  const fresh = perPicture.map((lines) => {
    let n = 0;
    for (const l of lines) if (!byTime.has(l.start_s)) { byTime.set(l.start_s, l.written); n++; }
    return n;
  });
  const lines = [...byTime.entries()].sort((a, b) => a[0] - b[0]).map(([start_s, written]) => ({ start_s, written }));
  lines.forEach((l, i) => { l.end_s = lines[i + 1] ? lines[i + 1].start_s : l.start_s + LAST_LINE_S; });
  return { lines: lines.map(({ start_s, end_s, written }) => ({ start_s, end_s, written })), fresh };
}

// --- the pictures themselves ------------------------------------------------

class PictureError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// Bytes -> 'image/png' | 'image/jpeg' | null, from the file's own first bytes.
function pictureType(bytes) {
  if (!bytes || bytes.length < 8) return null;
  if (bytes[0] === 0x89 && bytes.subarray(1, 4).toString('latin1') === 'PNG') return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  return null;
}

// --- the call ---------------------------------------------------------------

class CallError extends Error {}

// One picture to one model. `ask` is what is asked of it: the system prompt,
// the user's words and the reader of its answer (the transcript by default;
// a TV photo's subtitle passes its own).
const TRANSCRIPT_ASK = { system: SYSTEM, text: 'Read the transcript lines in this picture.', read: readPictureAnswer };

async function callModel(model, picture, { maxTokens, timeoutMs }, ask = TRANSCRIPT_ASK) {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new CallError('OPENROUTER_API_KEY is unset');
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
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
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: maxTokens,
        response_format: { type: 'json_object' },
        usage: { include: true },
        messages: [
          { role: 'system', content: ask.system },
          { role: 'user', content: [
            { type: 'text', text: ask.text },
            { type: 'image_url', image_url: { url: `data:${picture.type};base64,${picture.bytes.toString('base64')}` } },
          ] },
        ],
      }),
    });
    text = await res.text();
  } catch (e) {
    throw new CallError(e.name === 'AbortError' ? `no answer in ${Math.round(timeoutMs / 1000)} seconds` : `OpenRouter unreachable (${e.message})`);
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    let detail = '';
    try { detail = JSON.parse(text)?.error?.message || ''; } catch { /* plain */ }
    throw new CallError(`OpenRouter answered ${res.status}${detail ? ` (${detail.slice(0, 160)})` : ''}`);
  }
  let content = '', usage = null;
  try {
    const body = JSON.parse(text);
    content = String(body.choices[0].message.content || '');
    usage = body.usage || null;
  } catch {
    throw new CallError('OpenRouter answered in an unexpected shape');
  }
  const answer = ask.read(content);
  if (!answer) throw new CallError("the model's answer was not JSON");
  return { ...answer, model, usage };
}

// One picture -> { lines, dropped, transcript, model, usage }. Throws a
// CallError when both models fail.
async function readPicture(picture) {
  const size = budget();
  let answer;
  try {
    answer = await callModel(IMAGE_MODEL, picture, size);
  } catch (first) {
    console.error(`pictures: ${IMAGE_MODEL} failed on ${picture.name || 'a picture'}: ${first.message}; trying ${IMAGE_FALLBACK_MODEL}`);
    try {
      answer = await callModel(IMAGE_FALLBACK_MODEL, picture, size);
    } catch (second) {
      throw new CallError(`${IMAGE_MODEL}: ${first.message}; ${IMAGE_FALLBACK_MODEL}: ${second.message}`);
    }
  }
  const { lines, dropped } = answer.transcript ? checkPicture(answer.items) : { lines: [], dropped: {} };
  return { lines, dropped, transcript: lines.length > 0, model: answer.model, usage: answer.usage };
}

async function inTurns(items, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => { while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); } };
  await Promise.all(Array.from({ length: Math.min(PARALLEL, items.length) }, worker));
  return out;
}

// [{ name, bytes }] -> { lines, pictures: [{ name, read, fresh, dropped,
// transcript, model }] }. Throws a PictureError (status and a plain message)
// when nothing usable came out: not a picture, too many, no transcript in any
// of them, or neither model answering.
async function readPictures(files) {
  if (!files.length) throw new PictureError(400, 'Add at least one screenshot.');
  if (files.length > MAX_PICTURES) throw new PictureError(400, `That is more than ${MAX_PICTURES} pictures. Send ${MAX_PICTURES} at most at a time.`);
  const pictures = files.map((f, i) => {
    const type = pictureType(f.bytes);
    if (!type) throw new PictureError(400, `${f.name || `Picture ${i + 1}`} isn't a picture I can read. Screenshots (PNG or JPEG) only.`);
    return { name: f.name || `picture ${i + 1}`, bytes: f.bytes, type };
  });
  let read;
  try {
    read = await inTurns(pictures, readPicture);
  } catch (e) {
    if (e instanceof CallError) {
      console.error(`pictures: both models failed: ${e.message}`);
      throw new PictureError(502, "I couldn't read the pictures just now. Try again in a minute.");
    }
    throw e;
  }
  const { lines, fresh } = mergeByTime(read.map((r) => r.lines));
  if (!lines.length) throw new PictureError(400, pictures.length === 1 ? NO_TRANSCRIPT : NO_TRANSCRIPT_ANY);
  return {
    lines,
    pictures: read.map((r, i) => ({
      name: pictures[i].name, read: r.lines.length, fresh: fresh[i], dropped: r.dropped, transcript: r.transcript, model: r.model, usage: r.usage,
    })),
  };
}

// --- a photo of the TV: the subtitle on it ----------------------------------
//
// The second use of the picture reader. A photo of a TV screen, taken on a
// phone at the moment a line got past him: the subtitle printed on it, exactly
// as printed, and its language (English or French). No times: the check is
// its own (checkSubtitleLine), not the transcript's. A photo with no readable
// subtitle is an answer ("no subtitle in this photo"), not a failure.

const SUBTITLE_SYSTEM = `You read the subtitle off a photo of a TV or computer screen, for a learner of French. The photo was taken on a phone while a show played or was paused; the subtitle is the line of text printed over the picture, usually white, near the bottom.

Answer with ONE JSON object and nothing else:
{"subtitle": true, "text": "<the subtitle exactly as printed>", "language": "en" or "fr"}

Rules:
- "text" is copied exactly as printed: same words, spelling, accents, apostrophes and punctuation. Do not correct, translate or complete it. If it runs over two printed lines, join them with a space. A dash that starts a speaker's line stays.
- "language" is "en" when the subtitle is English, "fr" when it is French.
- Only the subtitle: leave out channel logos, the time, menus, captions of the TV's own buttons, and text that is part of the scene (signs, newspapers).
- If there is no subtitle you can read whole, or it is in another language, answer {"subtitle": false, "text": "", "language": null}.`;

// A subtitle is a line or two: ~60 tokens of text and ~30 of wrapper. Written
// out at a cautious 40 tokens a second, plus 30 seconds to start and take in
// the photo: ~33 seconds.
function subtitleBudget() {
  const tokens = 30 + 60;
  return { maxTokens: 400, timeoutMs: 30000 + Math.ceil(tokens / 40) * 1000 };
}

// The model's text -> the parsed object, or null when it is not JSON.
function readSubtitleAnswer(content) {
  const text = String(content || '').replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, '');
  const start = text.indexOf('{');
  if (start < 0) return null;
  try {
    const v = JSON.parse(text.slice(start, text.lastIndexOf('}') + 1));
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

const LANGUAGES = { en: 'en', english: 'en', fr: 'fr', french: 'fr', 'français': 'fr', francais: 'fr' };

// The no-time variant of checkPictureLine, for one subtitle. { ok: true,
// none: true } when the photo has no subtitle; { ok: true, written, language }
// for one; { ok: false, reason } when the answer cannot be trusted.
function checkSubtitleLine(item) {
  if (!item || typeof item !== 'object') return { ok: false, reason: 'not an object' };
  const written = typeof item.text === 'string' ? tidy(item.text) : '';
  if (item.subtitle === false || (!written && item.subtitle !== true)) return { ok: true, none: true };
  if (!written) return { ok: false, reason: 'no text' };
  if (written.length > 400) return { ok: false, reason: 'longer than a subtitle' };
  const language = LANGUAGES[String(item.language || '').trim().toLowerCase()];
  if (!language) return { ok: false, reason: `the language did not read as English or French (${String(item.language).slice(0, 20)})` };
  return { ok: true, none: false, written, language };
}

const SUBTITLE_ASK = { system: SUBTITLE_SYSTEM, text: 'Read the subtitle in this photo.', read: readSubtitleAnswer };

// One photo ({ bytes, name }) -> { subtitle: { written, language } | null,
// model, usage }. Throws a PictureError when it is not a picture, or both
// models fail, or their answer does not pass the check.
async function readSubtitle(photo) {
  const type = pictureType(photo.bytes);
  if (!type) throw new PictureError(400, "That isn't a photo I can read. JPEG or PNG only.");
  const picture = { name: photo.name || 'a photo', bytes: photo.bytes, type };
  const size = subtitleBudget();
  let answer;
  try {
    answer = await callModel(IMAGE_MODEL, picture, size, SUBTITLE_ASK);
  } catch (first) {
    console.error(`subtitle: ${IMAGE_MODEL} failed on ${picture.name}: ${first.message}; trying ${IMAGE_FALLBACK_MODEL}`);
    try {
      answer = await callModel(IMAGE_FALLBACK_MODEL, picture, size, SUBTITLE_ASK);
    } catch (second) {
      console.error(`subtitle: both models failed: ${IMAGE_MODEL}: ${first.message}; ${IMAGE_FALLBACK_MODEL}: ${second.message}`);
      throw new PictureError(502, "I couldn't read the photo just now.");
    }
  }
  const r = checkSubtitleLine(answer);
  if (!r.ok) {
    console.error(`subtitle: answer refused: ${r.reason}`);
    throw new PictureError(502, "I couldn't read the photo just now.");
  }
  return { subtitle: r.none ? null : { written: r.written, language: r.language }, model: answer.model, usage: answer.usage };
}

module.exports = {
  readPictures, readPicture, checkPictureLine, checkPicture, readPictureAnswer, mergeByTime, parseTime, pictureType, budget,
  readSubtitle, checkSubtitleLine, readSubtitleAnswer, subtitleBudget, SUBTITLE_SYSTEM,
  PictureError, SYSTEM, IMAGE_MODEL, IMAGE_FALLBACK_MODEL, NO_TRANSCRIPT, NO_TRANSCRIPT_ANY, MAX_PICTURES,
};
