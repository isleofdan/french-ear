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
//
// The whole YouTube page, copied with Ctrl+A (seen live, 24 Sep 2026: shape
// (a) inside the page), works too. The page carries other times: each
// suggested video's length ("7:40" then "New", title, channel, views, age).
// So the transcript is taken to be the longest run of timestamped entries
// whose times never go backwards and whose text is at most MAX_WRAP lines;
// an entry with more text lines ends its run and keeps only its first line
// (the transcript's last line is followed by the page's "All", "Related"…).

const STAMP = /^[[(]?((?:\d{1,2}:)?\d{1,2}:\d{2})[\])]?$/;
const STAMP_TEXT = /^[[(]?((?:\d{1,2}:)?\d{1,2}:\d{2})[\])]?\s+(\S.*)$/;
const HEADING = /^(transcript|transcription|transcripción)$/i;
const UNIT = '(?:seconds?|secondes?|minutes?|hours?|heures?)';
const SPOKEN_LENGTH = new RegExp(`^\\d+\\s+${UNIT}(?:,?\\s+(?:et\\s+|and\\s+)?\\d+\\s+${UNIT})*$`, 'i');
const LAST_LINE_S = 6;
const MAX_LINES = 5000;
const MAX_WRAP = 3;

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

  // Every timestamped entry, with the text lines after it.
  const entries = [];
  let cur = null;
  for (const r of kept) {
    let m = r.match(STAMP);
    if (m) { cur = { start_s: seconds(m[1]), parts: [] }; entries.push(cur); continue; }
    m = r.match(STAMP_TEXT);
    if (m) { cur = { start_s: seconds(m[1]), parts: [m[2]] }; entries.push(cur); continue; }
    // Text before the first timestamp is a heading or the page around the
    // transcript; text after one belongs to it.
    if (cur) cur.parts.push(r);
  }
  // Runs: times never going backwards, no entry with more than MAX_WRAP
  // text lines inside a run. The longest run is the transcript.
  const runs = [];
  let run = [];
  for (const e of entries) {
    if (run.length && e.start_s < run[run.length - 1].start_s) { runs.push(run); run = []; }
    if (e.parts.length > MAX_WRAP) {
      run.push({ start_s: e.start_s, parts: e.parts.slice(0, 1) });
      runs.push(run); run = [];
      continue;
    }
    run.push(e);
  }
  runs.push(run);
  const found = runs.reduce((a, b) => (b.length > a.length ? b : a), []);
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
