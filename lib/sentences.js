'use strict';
// Caption fragments into whole sentences, before the "as said" pass. YouTube's
// lines, pasted or fetched, are cut mid-sentence ("Bonjour les amis et
// bienvenue dans un" / "nouvel épisode d'iz French. Aujourd'hui,"), so a
// pattern split across two of them is missed.
//
// A fragment is first cut where a sentence ends inside it (".", "?" or "!",
// then a space), each piece taking its share of the fragment's time by length.
// Pieces are then joined into one line until a piece ends a sentence, with a
// cap: 4 pieces, or 12 seconds from the line's start to the piece's end,
// whichever comes first. The piece that hits the cap closes the line as is.
// A piece wholly in brackets ("[Musique]") is a line of its own. A joined line
// takes its first piece's start and its last piece's end. Without times, the
// joins go by the sentence ends and the 4-piece cap only. The text itself is
// never corrected.

const MAX_PARTS = 4;
const MAX_SECONDS = 12;

// Sentence end: . ? ! (or a run of them), any closing quote or bracket, then
// a space. The cut falls after the closing marks.
const END_INSIDE = /[.?!]+["'»”’)\]]*(?=\s)/g;
const ENDS = /[.?!]+["'»”’)\]]*$/;
const BRACKETED = /^\[[^\]]*\]$/;

const round = (n) => Math.round(n * 1000) / 1000;
const timedLine = (l) => typeof l.start_s === 'number' && typeof l.end_s === 'number';

// One fragment -> its pieces, each { start_s, end_s, text, ends }.
function pieces(line) {
  const text = String(line.written).trim();
  const cuts = [];
  for (const m of text.matchAll(END_INSIDE)) cuts.push(m.index + m[0].length);
  const parts = [];
  let from = 0;
  for (const at of [...cuts, text.length]) {
    const raw = text.slice(from, at);
    const lead = raw.length - raw.trimStart().length;
    const t = raw.trim();
    if (t) parts.push({ text: t, a: from + lead, b: from + lead + t.length });
    from = at;
  }
  const timed = timedLine(line);
  const span = timed ? Math.max(0, line.end_s - line.start_s) : 0;
  const at = (i) => (timed ? round(line.start_s + (span * i) / Math.max(1, text.length)) : null);
  return parts.map((p, k) => ({
    text: p.text,
    ends: ENDS.test(p.text),
    start_s: k === 0 ? (timed ? line.start_s : null) : at(p.a),
    end_s: k === parts.length - 1 ? (timed ? line.end_s : null) : at(parts[k + 1].a),
  }));
}

// [{ start_s, end_s, written }] -> the same, joined into sentences.
function joinFragments(lines) {
  const out = [];
  let cur = null;
  const close = () => {
    if (cur) out.push({ start_s: cur.start_s, end_s: cur.end_s, written: cur.parts.join(' ') });
    cur = null;
  };
  for (const line of lines || []) {
    for (const p of pieces(line)) {
      if (BRACKETED.test(p.text)) {
        close();
        out.push({ start_s: p.start_s, end_s: p.end_s, written: p.text });
        continue;
      }
      if (!cur) cur = { start_s: p.start_s, end_s: p.end_s, parts: [] };
      cur.parts.push(p.text);
      cur.end_s = p.end_s;
      const long = cur.start_s != null && cur.end_s != null && cur.end_s - cur.start_s >= MAX_SECONDS;
      if (p.ends || cur.parts.length >= MAX_PARTS || long) close();
    }
  }
  close();
  return out;
}

module.exports = { joinFragments, MAX_PARTS, MAX_SECONDS };
