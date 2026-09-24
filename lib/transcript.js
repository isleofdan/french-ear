'use strict';
// A transcript he pasted in, copied from YouTube's own "Show transcript"
// panel, read into lines. The exact shape of what that panel copies is not
// known from here, so every shape seen or likely is accepted:
//   (a) a timestamp on its own line, the text on the next line(s);
//   (b) timestamp and text on one line ("0:12 Bonjour à tous");
//   (c) either of those with h:mm:ss timestamps;
//   (d) no timestamps at all: one line per line of text, with no times.
// Empty lines go, and so does a leading "Transcript" heading, and so do the
// spoken-length labels a screen reader copy can carry ("12 seconds",
// "1 minute, 5 seconds"). Text running over several lines after one
// timestamp is one line. With timestamps, a line ends where the next begins;
// the last one lasts six seconds.

const STAMP = /^[[(]?((?:\d{1,2}:)?\d{1,2}:\d{2})[\])]?$/;
const STAMP_TEXT = /^[[(]?((?:\d{1,2}:)?\d{1,2}:\d{2})[\])]?\s+(\S.*)$/;
const HEADING = /^(transcript|transcription|transcripción)$/i;
const UNIT = '(?:seconds?|secondes?|minutes?|hours?|heures?)';
const SPOKEN_LENGTH = new RegExp(`^\\d+\\s+${UNIT}(?:,?\\s+(?:et\\s+|and\\s+)?\\d+\\s+${UNIT})*$`, 'i');
const LAST_LINE_S = 6;
const MAX_LINES = 5000;

function seconds(stamp) {
  return stamp.split(':').reduce((n, part) => n * 60 + Number(part), 0);
}

const tidy = (s) => String(s).replace(/\s+/g, ' ').trim().normalize('NFC');

// text -> { lines: [{ start_s, end_s, written }], timed }. start_s and end_s
// are null for every line when the paste has no timestamps.
function parseTranscript(text) {
  const rows = String(text || '').replace(/\r\n?/g, '\n').split('\n').map(tidy).filter(Boolean);
  while (rows.length && HEADING.test(rows[0])) rows.shift();
  const kept = rows.filter((r) => !SPOKEN_LENGTH.test(r));
  const timed = kept.some((r) => STAMP.test(r) || STAMP_TEXT.test(r));

  if (!timed) {
    return { timed: false, lines: kept.slice(0, MAX_LINES).map((written) => ({ start_s: null, end_s: null, written })) };
  }

  const found = [];
  let cur = null;
  for (const r of kept) {
    let m = r.match(STAMP);
    if (m) { cur = { start_s: seconds(m[1]), parts: [] }; found.push(cur); continue; }
    m = r.match(STAMP_TEXT);
    if (m) { cur = { start_s: seconds(m[1]), parts: [m[2]] }; found.push(cur); continue; }
    // Text before the first timestamp is a heading or a stray; text after
    // one belongs to it.
    if (cur) cur.parts.push(r);
  }
  const lines = found
    .map((f) => ({ start_s: f.start_s, written: tidy(f.parts.join(' ')) }))
    .filter((l) => l.written)
    .slice(0, MAX_LINES);
  lines.forEach((l, i) => {
    const next = lines[i + 1];
    l.end_s = next && next.start_s > l.start_s ? next.start_s : l.start_s + LAST_LINE_S;
  });
  return { timed: true, lines: lines.map(({ start_s, end_s, written }) => ({ start_s, end_s, written })) };
}

module.exports = { parseTranscript };
