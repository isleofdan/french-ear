'use strict';
// The "as said" pass: written caption lines in, each line as a French speaker
// says it out, with the changed parts marked by pattern id.
//
// One OpenRouter call per batch of up to 40 lines. Every line of the answer
// is checked on its own (checkLine); a line that fails is saved as
// 'unworked' with the reason, never dropped, and the page offers to try those
// again. An answer cut off mid-way keeps the lines that arrived whole.
//
// Models: MODEL first; when that call fails outright (unreachable, an error
// status, no answer in time, or no JSON at all), the same batch goes once to
// FALLBACK_MODEL. Both are named in README.md.

const db = require('./db');
const { PATTERNS, isPattern } = require('./patterns');

const MODEL = process.env.MODEL || 'anthropic/claude-sonnet-4.6';
const FALLBACK_MODEL = process.env.FALLBACK_MODEL || 'google/gemini-2.5-flash';
const OPENROUTER_URL = () => process.env.OPENROUTER_URL || 'https://openrouter.ai/api/v1/chat/completions';
const BATCH = 40;
const PARALLEL = 2;

// Time limits come from the expected size of the answer: about a third of a
// token per character of the line for `spoken`, plus about 90 tokens for its
// spans and brackets; written out at a cautious 40 tokens a second, plus 20
// seconds to start. 40 lines of 60 characters: ~4,500 tokens, ~2.4 minutes.
function budget(lines) {
  const tokens = 150 + lines.reduce((n, l) => n + Math.ceil(l.written.length / 3) + 90, 0);
  return { maxTokens: Math.min(16000, Math.ceil(tokens * 1.5)), timeoutMs: 20000 + Math.ceil(tokens / 40) * 1000 };
}

const SYSTEM = `You show an English-speaking learner of French how written French lines sound when a French speaker actually says them.

For each numbered line you are given (subtitle or caption text, as written), write "spoken": the same line as a French speaker would naturally say it in everyday speech, in ordinary French spelling with apostrophes (chais pas, y a, t'as, j'te, c'que), never phonetic symbols. Keep the meaning and the words; change only what everyday speech changes.

Then mark every place where "spoken" differs from the written line because of one of these patterns, and only these. Use their ids exactly; never invent an id.
${PATTERNS.map((p) => `- ${p.id}: ${p.name}. ${p.explain} Examples: ${p.examples.map((e) => `"${e.written}" -> "${e.said}"`).join('; ')}.`).join('\n')}

Answer with ONE JSON object and nothing else:
{"lines": [{"i": <the line's number>, "spoken": "<the line as said>", "spans": [{"start": <offset>, "end": <offset>, "text": "<spoken.slice(start, end)>", "pattern": "<one id>"}], "patterns": ["<each id present>"]}]}

Rules:
- One entry per line given, in order, with its "i".
- A span covers the characters of "spoken" that sound different because of that pattern (for something dropped, the words on either side of the gap; for question-tone, the whole question). "start" and "end" are character offsets into "spoken" (end exclusive); "text" is exactly those characters.
- One span per occurrence, each with exactly one pattern id. Where two patterns act on the same words, give two spans.
- "patterns" lists the ids of the spans, each once.
- If a line contains none of the patterns, return it unchanged: "spoken" equal to the line, "spans": [], "patterns": [].
- Lines that are not speech (music, applause, [Musique], names of speakers) come back unchanged with no spans.`;

// --- checking the model's answer -------------------------------------------

const norm = (s) => String(s).normalize('NFC').replace(/[‘’ʼ]/g, "'");

// Every index at which `needle` occurs in `hay`.
function occurrences(hay, needle) {
  const out = [];
  if (!needle) return out;
  for (let at = hay.indexOf(needle); at >= 0; at = hay.indexOf(needle, at + 1)) out.push(at);
  return out;
}

// One line of the answer against its written line. Answers { ok: true, spoken,
// spans, patterns } or { ok: false, reason }. The span's "text" is trusted
// over its offsets: models miscount characters, so offsets that do not match
// the text are moved to the nearest place the text does occur. Offsets
// without a matching text must lie inside the string.
function checkLine(item, written) {
  if (!item || typeof item !== 'object') return { ok: false, reason: 'the answer for this line was not an object' };
  if (typeof item.spoken !== 'string' || !item.spoken.trim()) return { ok: false, reason: 'the answer gave no spoken form' };
  const spoken = norm(item.spoken.trim());
  const rawSpans = item.spans == null ? [] : item.spans;
  if (!Array.isArray(rawSpans)) return { ok: false, reason: 'spans was not a list' };
  const spans = [];
  for (const s of rawSpans) {
    if (!s || typeof s !== 'object') return { ok: false, reason: 'a span was not an object' };
    let pattern = s.pattern ?? s.id;
    if (Array.isArray(pattern) && pattern.length === 1) pattern = pattern[0];
    if (typeof pattern !== 'string') return { ok: false, reason: 'a span did not name exactly one pattern' };
    if (!isPattern(pattern)) return { ok: false, reason: `unknown pattern id "${pattern}"` };
    let start = Number(s.start), end = Number(s.end);
    const text = typeof s.text === 'string' ? norm(s.text) : null;
    if (text && (spoken.slice(start, end) !== text || !(start >= 0 && end <= spoken.length))) {
      const at = occurrences(spoken, text);
      if (at.length) {
        const near = at.reduce((b, a) => (Math.abs(a - start) < Math.abs(b - start) ? a : b));
        start = near; end = near + text.length;
      }
    }
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > spoken.length || start >= end) {
      return { ok: false, reason: `a span (${s.start}–${s.end}${text ? `, "${text}"` : ''}) lies outside the spoken line of ${spoken.length} characters` };
    }
    spans.push({ start, end, pattern });
  }
  const listed = item.patterns == null ? [] : item.patterns;
  if (!Array.isArray(listed)) return { ok: false, reason: 'patterns was not a list' };
  for (const id of listed) if (!isPattern(id)) return { ok: false, reason: `unknown pattern id "${id}"` };
  spans.sort((a, b) => a.start - b.start || a.end - b.end);
  const patterns = [...new Set([...spans.map((s) => s.pattern), ...listed])];
  // A line with no pattern is said as written.
  return { ok: true, spoken: patterns.length ? spoken : String(written), spans, patterns };
}

// The model's text -> { items, truncated }. A whole object is read whole; an
// answer cut off keeps every line object that closed before the cut.
function readAnswer(content) {
  const text = String(content || '').replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, '');
  const start = text.indexOf('{');
  if (start >= 0) {
    try {
      const whole = JSON.parse(text.slice(start, text.lastIndexOf('}') + 1));
      if (Array.isArray(whole.lines)) return { items: whole.lines, truncated: false };
      if (Array.isArray(whole)) return { items: whole, truncated: false };
    } catch { /* cut off, or noise after it: salvage below */ }
  }
  const at = text.indexOf('"lines"');
  const open = at >= 0 ? text.indexOf('[', at) : -1;
  if (open < 0) return { items: [], truncated: true };
  const items = [];
  let depth = 0, inStr = false, esc = false, from = -1;
  for (let i = open + 1; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') { if (depth++ === 0) from = i; }
    else if (c === '}') {
      if (--depth === 0 && from >= 0) {
        try { items.push(JSON.parse(text.slice(from, i + 1))); } catch { /* a broken one is left out */ }
        from = -1;
      }
    } else if (c === ']' && depth === 0) return { items, truncated: false };
  }
  return { items, truncated: true };
}

// Answer items against the batch's lines -> [{ line, result }], one per line.
function matchAnswer(lines, items, truncated) {
  const byI = new Map();
  items.forEach((it, k) => {
    const i = Number.isInteger(it?.i) ? it.i : k;
    if (!byI.has(i)) byI.set(i, it);
  });
  return lines.map((line, k) => {
    const it = byI.get(k);
    if (!it) return { line, result: { ok: false, reason: truncated ? 'the answer was cut off before this line' : 'the answer left this line out' } };
    return { line, result: checkLine(it, line.written) };
  });
}

// --- the call ---------------------------------------------------------------

class CallError extends Error {}

async function callModel(model, lines, { maxTokens, timeoutMs }) {
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
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: JSON.stringify(lines.map((l, i) => ({ i, text: l.written }))) },
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
  let content = '', finish = null;
  try {
    const choice = JSON.parse(text).choices[0];
    content = String(choice.message.content || '');
    finish = choice.finish_reason || null;
  } catch {
    throw new CallError('OpenRouter answered in an unexpected shape');
  }
  const { items, truncated } = readAnswer(content);
  if (!items.length && !truncated) throw new CallError('the model answered with no lines');
  if (!items.length) throw new CallError(`the model's answer was not JSON${finish === 'length' ? ' (cut off at the length limit)' : ''}`);
  return { items, truncated: truncated || finish === 'length', model };
}

// Works out one batch and saves every line: worked, or unworked with a reason.
// Answers { worked, unworked, model }.
async function workBatch(lines) {
  const size = budget(lines);
  let answer;
  try {
    answer = await callModel(MODEL, lines, size);
  } catch (first) {
    console.error(`as-said: ${MODEL} failed on ${lines.length} line(s): ${first.message}; trying ${FALLBACK_MODEL}`);
    try {
      answer = await callModel(FALLBACK_MODEL, lines, size);
    } catch (second) {
      const reason = `${MODEL}: ${first.message}; ${FALLBACK_MODEL}: ${second.message}`;
      for (const l of lines) db.setLineUnworked(l.id, reason);
      console.error(`as-said: both models failed; ${lines.length} line(s) left unworked`);
      return { worked: 0, unworked: lines.length, model: null };
    }
  }
  let worked = 0, unworked = 0;
  for (const { line, result } of matchAnswer(lines, answer.items, answer.truncated)) {
    if (result.ok) { db.setLineWorked(line.id, result); worked++; }
    else { db.setLineUnworked(line.id, result.reason); unworked++; }
  }
  console.log(`as-said: ${worked} worked, ${unworked} unworked (${answer.model}${answer.truncated ? ', answer cut off' : ''})`);
  return { worked, unworked, model: answer.model };
}

// --- running it -------------------------------------------------------------

const running = new Map(); // video id -> promise
let active = 0;
const waiting = [];

async function slot(fn) {
  if (active >= PARALLEL) await new Promise((r) => waiting.push(r));
  active++;
  try { return await fn(); } finally {
    active--;
    const next = waiting.shift();
    if (next) next();
  }
}

// Works every pending line of the video, in batches. One run per video at a
// time; a second ask while one runs gets the same promise. Lines made pending
// while it runs (a new paste replacing the lines) are worked in the same run.
function workVideo(videoId) {
  if (running.has(videoId)) return running.get(videoId);
  const run = (async () => {
    for (let round = 0; round < 5; round++) {
      const lines = db.linesWithStatus(videoId, ['pending']);
      if (!lines.length) break;
      const batches = [];
      for (let i = 0; i < lines.length; i += BATCH) batches.push(lines.slice(i, i + BATCH));
      await Promise.all(batches.map((b) => slot(() => workBatch(b))));
    }
  })().catch((e) => console.error(`as-said: video ${videoId}: ${e.stack || e.message}`))
    .finally(() => running.delete(videoId));
  running.set(videoId, run);
  return run;
}

// The unworked lines go back to pending and are worked again.
function retryVideo(videoId) {
  const again = db.linesWithStatus(videoId, ['unworked']).map((l) => l.id);
  db.setLinesPending(again);
  workVideo(videoId);
  return again.length;
}

const isRunning = (videoId) => running.has(Number(videoId));

module.exports = { checkLine, readAnswer, matchAnswer, workBatch, workVideo, retryVideo, isRunning, budget, SYSTEM, MODEL, FALLBACK_MODEL, BATCH };
