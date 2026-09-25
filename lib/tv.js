'use strict';
// Photos from the TV: a moment he photographed because a line got past him.
//
// The photo is kept on the volume. The subtitle on it is read (lib/pictures.js,
// readSubtitle). When he taps "Save for later" the French is worked out in the
// background:
//   - a French subtitle goes through the ordinary "as said" pass (lib/spoken.js),
//     unchanged, as a line of its own;
//   - an English subtitle (or none, when he noted what it sounded like) goes to
//     one OpenRouter call with his two notes and the pattern list, asking for
//     the most likely French line as written and as said, its spans, how sure
//     the model is and why. The answer is checked with the "as said" pass's own
//     check (checkLine), plus the written line and the sure word.
// Either way the moment's line has the same shape as a video's line.
//
// The tally: a moment worked out records one "got past me" for each pattern in
// its line, once per moment; one worked out as "a guess" (sure = low) records
// nothing.
//
// Models: MODEL, then FALLBACK_MODEL, as the "as said" pass (README.md).

const fs = require('node:fs');
const path = require('node:path');
const db = require('./db');
const spoken = require('./spoken');
const pictures = require('./pictures');
const { PATTERNS } = require('./patterns');

const OPENROUTER_URL = () => process.env.OPENROUTER_URL || 'https://openrouter.ai/api/v1/chat/completions';
const SURE = ['high', 'medium', 'low'];

let dataDir = null;
function configure(opts) { dataDir = opts.dataDir; }
const photoFile = (rel) => path.join(dataDir, rel);

const SYSTEM = `You help an English-speaking learner of French who watches French TV with English subtitles. A French line just got past him. He took a photo of the screen and noted, roughly, what it sounded like and what was happening. Work out the French line that was most likely said, and show how it sounds in everyday speech.

You are given (any may be empty):
- "english_subtitle": the English subtitle on screen at that moment;
- "sounded_like": what he heard, however roughly: letters, bits of French, or English words for the sounds;
- "happening": what is going on in the scene, in English.

Write:
- "written": the French line most likely said, as it would be written in a French subtitle (standard spelling, ne included in negatives, full forms).
- "spoken": the same line as a French speaker would naturally say it in everyday speech, in ordinary French spelling with apostrophes (chais pas, y a, t'as, j'te, c'que), never phonetic symbols. Match what he heard where you can.
- "spans": every place where "spoken" differs from "written" because of one of these patterns, and only these. Use their ids exactly; never invent an id.
${PATTERNS.map((p) => `- ${p.id}: ${p.name}. ${p.explain} Examples: ${p.examples.map((e) => `"${e.written}" -> "${e.said}"`).join('; ')}.`).join('\n')}
- "patterns": the ids of the spans, each once.
- "sure": "high" when the subtitle and his notes point clearly to one French line, "medium" when the line is likely but the wording could differ, "low" when it is a guess.
- "why": one plain-English sentence on how you got there, for him to read.

Answer with ONE JSON object and nothing else:
{"written": "<French as written>", "spoken": "<French as said>", "spans": [{"start": <offset>, "end": <offset>, "text": "<spoken.slice(start, end)>", "pattern": "<one id>"}], "patterns": ["<each id present>"], "sure": "high" | "medium" | "low", "why": "<one sentence>"}

Rules:
- A span covers the characters of "spoken" that sound different because of that pattern (for something dropped, the words on either side of the gap; for question-tone, the whole question). "start" and "end" are character offsets into "spoken" (end exclusive); "text" is exactly those characters.
- One span per occurrence, each with exactly one pattern id. Where two patterns act on the same words, give two spans.
- If the line contains none of the patterns, "spoken" equals "written", "spans": [], "patterns": [].`;

// Time limits come from the expected size of the answer: one line of ~60
// characters twice (~40 tokens), up to four spans (~90 tokens each), the sure
// word and a sentence of why (~40), the wrapper (~40): ~480 tokens. Written
// out at a cautious 40 tokens a second, plus 20 seconds to start: ~32 seconds.
function budget() {
  const tokens = 40 + 40 + 4 * 90 + 40;
  return { maxTokens: Math.ceil(tokens * 3), timeoutMs: 20000 + Math.ceil(tokens / 40) * 1000 };
}

const tidy = (s) => String(s || '').replace(/\s+/g, ' ').trim().normalize('NFC');

// The gate on one answer: the "as said" pass's check (pattern ids in the list,
// spans inside the spoken line, span text trusted over offsets), plus a
// written line and a sure word. { ok: true, written, spoken, spans, patterns,
// sure, why } or { ok: false, reason }.
function checkWorkOut(item) {
  if (!item || typeof item !== 'object') return { ok: false, reason: 'the answer was not an object' };
  const written = typeof item.written === 'string' ? tidy(item.written) : '';
  if (!written) return { ok: false, reason: 'the answer gave no French line' };
  if (written.length > 400) return { ok: false, reason: 'the French line is longer than a subtitle' };
  const sure = typeof item.sure === 'string' ? item.sure.trim().toLowerCase() : '';
  if (!SURE.includes(sure)) return { ok: false, reason: `"sure" was not high, medium or low (${String(item.sure).slice(0, 20)})` };
  const line = spoken.checkLine(item, written);
  if (!line.ok) return line;
  return { ok: true, written, spoken: line.spoken, spans: line.spans, patterns: line.patterns, sure, why: tidy(item.why).slice(0, 400) };
}

function readWorkOut(content) {
  const text = String(content || '').replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, '');
  const start = text.indexOf('{');
  if (start < 0) return null;
  try { return JSON.parse(text.slice(start, text.lastIndexOf('}') + 1)); } catch { return null; }
}

class CallError extends Error {}

async function callModel(model, notes, { maxTokens, timeoutMs }) {
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
          { role: 'system', content: SYSTEM },
          { role: 'user', content: JSON.stringify(notes) },
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
  const item = readWorkOut(content);
  if (!item) throw new CallError("the model's answer was not JSON");
  return { item, model, usage };
}

// { english_subtitle, sounded_like, happening } -> the checked answer, or
// { ok: false, reason }. A call that fails outright goes once to the fallback;
// an answer that fails the check is not retried (the moment offers "try again").
async function workOut(notes) {
  const size = budget();
  let answer;
  try {
    answer = await callModel(spoken.MODEL, notes, size);
  } catch (first) {
    console.error(`tv: ${spoken.MODEL} failed: ${first.message}; trying ${spoken.FALLBACK_MODEL}`);
    try {
      answer = await callModel(spoken.FALLBACK_MODEL, notes, size);
    } catch (second) {
      return { ok: false, reason: `${spoken.MODEL}: ${first.message}; ${spoken.FALLBACK_MODEL}: ${second.message}` };
    }
  }
  const r = checkWorkOut(answer.item);
  console.log(`tv: worked out ${r.ok ? `"${r.written}" (${r.sure})` : `nothing: ${r.reason}`} (${answer.model}${answer.usage && answer.usage.cost != null ? `, cost $${answer.usage.cost}` : ''})`);
  return r;
}

// Which language a subtitle he typed or corrected is in, when the photo's
// reading cannot say: French and English little words counted.
const FR = new Set("je tu il elle on nous vous ils elles le la les un une des du de ce ça c'est est pas ne que qui quoi et mais ou où avec pour dans sur y a oui non très bien".split(' '));
const EN = new Set("i you he she we they it the a an is are was were not no yes what who and but or with for in on to of that this there".split(' '));
function guessLanguage(text, fallback) {
  const words = String(text).toLowerCase().replace(/[’']/g, "' ").split(/[^a-zàâäçéèêëîïôöùûüœ']+/).filter(Boolean);
  let fr = 0, en = 0;
  for (const w of words) { if (FR.has(w) || FR.has(w.replace(/'$/, ''))) fr++; if (EN.has(w)) en++; }
  if (/[àâçéèêëîïôùûœ]/i.test(text)) fr++;
  if (fr > en) return 'fr';
  if (en > fr) return 'en';
  return fallback || 'en';
}

// --- running it -------------------------------------------------------------

const reading = new Map(); // moment id -> promise
const working = new Map(); // moment id -> promise
const again = new Set();   // moment ids saved again while being worked out

// Reads the subtitle off the moment's photo, once at a time per moment. A
// subtitle he has typed himself is left alone.
function readMoment(id) {
  if (reading.has(id)) return reading.get(id);
  const run = (async () => {
    db.updateMoment(id, { read_status: 'reading' });
    const bytes = fs.readFileSync(photoFile(db.momentPhotoPath(id)));
    try {
      const r = await pictures.readSubtitle({ bytes, name: `photo ${id}` });
      const m = db.getMoment(id);
      const fields = { read_status: r.subtitle ? 'read' : 'none' };
      if (!m.subtitle_edited) Object.assign(fields, { subtitle: r.subtitle ? r.subtitle.written : null, subtitle_lang: r.subtitle ? r.subtitle.language : null });
      db.updateMoment(id, fields);
      console.log(`tv: photo ${id}: ${r.subtitle ? `${r.subtitle.language} subtitle "${r.subtitle.written}"` : 'no subtitle'} (${r.model}${r.usage && r.usage.cost != null ? `, cost $${r.usage.cost}` : ''})`);
    } catch (e) {
      db.updateMoment(id, { read_status: 'failed' });
      console.error(`tv: photo ${id}: not read: ${e.message}`);
    }
  })().catch((e) => console.error(`tv: photo ${id}: ${e.stack || e.message}`))
    .finally(() => reading.delete(id));
  reading.set(id, run);
  return run;
}

// Records one "got past me" per pattern in the moment's line, once per
// moment, unless the line is a guess.
function tally(id) {
  const m = db.getMoment(id);
  if (m.tallied || m.work_status !== 'worked' || m.sure === 'low' || !m.line) return 0;
  for (const p of m.line.patterns) db.addEventRow('got_past_me', p, m.line.id);
  db.updateMoment(id, { tallied: true });
  return m.line.patterns.length;
}

async function workOnce(id) {
  if (reading.has(id)) await reading.get(id);
  let m = db.getMoment(id);
  if (m.read_status === 'reading' || m.read_status === 'failed') { await readMoment(id); m = db.getMoment(id); }
  if (!m.saved) return;
  db.updateMoment(id, { work_status: 'working', work_reason: null });

  if (m.subtitle && m.subtitle_lang === 'fr') {
    const videoId = db.setMomentLine(id, m.subtitle);
    await spoken.workVideo(videoId);
    const line = db.getMoment(id).line;
    if (line && line.status === 'worked') db.updateMoment(id, { work_status: 'worked', sure: 'high', why: 'Read from the French subtitle.' });
    else db.updateMoment(id, { work_status: 'unworked', work_reason: (line && line.status_reason) || 'the "as said" pass gave no answer' });
  } else if (m.subtitle || m.heard_note.trim()) {
    const r = await workOut({ english_subtitle: m.subtitle || '', sounded_like: m.heard_note, happening: m.scene_note });
    if (!r.ok) {
      db.updateMoment(id, { work_status: 'unworked', work_reason: String(r.reason).slice(0, 500) });
    } else {
      db.setMomentLine(id, r.written);
      db.setLineWorked(db.getMoment(id).line.id, r);
      db.updateMoment(id, { work_status: 'worked', sure: r.sure, why: r.why });
    }
  } else {
    db.clearMomentLine(id);
    db.updateMoment(id, { work_status: 'nothing', sure: null, why: null });
  }
  tally(id);
}

// Works out the moment's French in the background. One run per moment at a
// time; saved again while it runs, it runs once more after.
function workMoment(id) {
  id = Number(id);
  if (working.has(id)) { again.add(id); return working.get(id); }
  const run = (async () => {
    do { again.delete(id); await workOnce(id); } while (again.has(id));
  })().catch((e) => {
    console.error(`tv: moment ${id}: ${e.stack || e.message}`);
    try { db.updateMoment(id, { work_status: 'unworked', work_reason: 'something went wrong on the server' }); } catch { /* gone */ }
  }).finally(() => working.delete(id));
  working.set(id, run);
  return run;
}

// A photo in: stored under photos/ on the volume, a moment made, the subtitle
// read in the background. Answers the moment id.
const PHOTO_LIMIT = 8 * 1024 * 1024;
function addPhoto(bytes) {
  const type = pictures.pictureType(bytes);
  if (!type) throw new db.AppError(400, "That isn't a photo I can read. JPEG or PNG only.");
  if (bytes.length > PHOTO_LIMIT) throw new db.AppError(413, 'That photo is too big (8 MB at most).');
  fs.mkdirSync(photoFile('photos'), { recursive: true });
  const rel = path.join('photos', `${Date.now()}-${require('node:crypto').randomBytes(4).toString('hex')}.${type === 'image/png' ? 'png' : 'jpg'}`);
  fs.writeFileSync(photoFile(rel), bytes);
  const id = db.addMoment({ photo_path: rel, photo_bytes: bytes.length });
  readMoment(id);
  return id;
}

// { subtitle?, heard_note?, scene_note? } -> saved, and worked out again.
function saveMoment(id, body) {
  const m = db.getMoment(id);
  const fields = { saved: true };
  if (typeof body.heard_note === 'string') fields.heard_note = body.heard_note.trim().slice(0, 500);
  if (typeof body.scene_note === 'string') fields.scene_note = body.scene_note.trim().slice(0, 500);
  if (typeof body.subtitle === 'string') {
    const sub = tidy(body.subtitle).slice(0, 400);
    if (sub !== (m.subtitle || '')) {
      Object.assign(fields, { subtitle: sub || null, subtitle_edited: true, subtitle_lang: sub ? guessLanguage(sub, m.subtitle_lang) : null });
    }
  }
  db.updateMoment(id, fields);
  workMoment(id);
  return db.getMoment(id);
}

const isBusy = (id) => working.has(Number(id)) || reading.has(Number(id));

// After a restart: photos still to be read, moments saved and not worked out.
function resume() {
  for (const id of db.momentsUnfinished()) {
    const m = db.getMoment(id);
    if (m.saved) workMoment(id); else readMoment(id);
  }
}

module.exports = {
  configure, addPhoto, saveMoment, workMoment, readMoment, isBusy, resume, photoFile,
  checkWorkOut, workOut, guessLanguage, budget, SYSTEM, PHOTO_LIMIT,
};
