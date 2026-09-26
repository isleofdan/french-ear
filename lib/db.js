'use strict';
// The app's own database: one SQLite file on the Fly volume (DATA_DIR, /data
// in production). Four tables, as the brief's section 11.2 sets them:
//   videos  — one row per YouTube video; youtube_id null for a typed line
//   lines   — the video's lines: written, spoken, spans, patterns, status
//   kept    — the lines he kept
//   events  — looked, got_past_me, watched_clean, keep; one row per pattern
//   moments — photos from the TV: the photo's path on the volume, the
//             subtitle read off it, his two notes, and how the French was
//             worked out. A moment's line lives in `lines`, on a video row
//             of its own (youtube_id null, caption_track 'tv'), so keep, the
//             tally and the kept list treat it like any other line.

const path = require('node:path');
const fs = require('node:fs');
const Database = require('better-sqlite3');

class AppError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const EVENT_KINDS = ['looked', 'got_past_me', 'watched_clean', 'keep'];

let db = null;

function open(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  db = new Database(path.join(dataDir, 'french-ear.db'));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS videos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      youtube_id TEXT,
      title TEXT NOT NULL,
      duration_s REAL,
      caption_track TEXT,
      added_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS videos_youtube ON videos(youtube_id);
    CREATE TABLE IF NOT EXISTS lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      video_id INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
      idx INTEGER NOT NULL,
      start_s REAL,
      end_s REAL,
      written TEXT NOT NULL,
      spoken TEXT,
      spans TEXT,
      patterns TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      status_reason TEXT,
      UNIQUE (video_id, idx)
    );
    CREATE TABLE IF NOT EXISTS kept (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      line_id INTEGER NOT NULL UNIQUE REFERENCES lines(id) ON DELETE CASCADE,
      kept_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at TEXT NOT NULL,
      kind TEXT NOT NULL,
      pattern_id TEXT NOT NULL,
      line_id INTEGER
    );
    CREATE INDEX IF NOT EXISTS events_pattern ON events(pattern_id);
    CREATE TABLE IF NOT EXISTS kept_earlier (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      video_id INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
      start_s REAL,
      written TEXT NOT NULL,
      spoken TEXT,
      spans TEXT,
      patterns TEXT,
      kept_at TEXT NOT NULL
    );
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS moments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      added_at TEXT NOT NULL,
      photo_path TEXT NOT NULL,
      photo_bytes INTEGER NOT NULL,
      read_status TEXT NOT NULL DEFAULT 'reading',
      subtitle TEXT,
      subtitle_lang TEXT,
      subtitle_edited INTEGER NOT NULL DEFAULT 0,
      heard_note TEXT NOT NULL DEFAULT '',
      scene_note TEXT NOT NULL DEFAULT '',
      saved INTEGER NOT NULL DEFAULT 0,
      work_status TEXT NOT NULL DEFAULT 'waiting',
      work_reason TEXT,
      sure TEXT,
      why TEXT,
      video_id INTEGER REFERENCES videos(id) ON DELETE SET NULL,
      tallied INTEGER NOT NULL DEFAULT 0
    );
  `);
  // joined: 1 once the video's lines are whole sentences (lib/sentences.js).
  // Videos saved before that are 0, and are joined when the server starts.
  if (!db.prepare('PRAGMA table_info(videos)').all().some((c) => c.name === 'joined')) {
    db.exec('ALTER TABLE videos ADD COLUMN joined INTEGER NOT NULL DEFAULT 0');
  }
  return db;
}

function handle() {
  if (!db) throw new Error('database not open');
  return db;
}

const now = () => new Date().toISOString();

function lineRow(r) {
  if (!r) return r;
  return {
    id: r.id,
    video_id: r.video_id,
    idx: r.idx,
    start_s: r.start_s,
    end_s: r.end_s,
    written: r.written,
    spoken: r.spoken,
    spans: r.spans ? JSON.parse(r.spans) : [],
    patterns: r.patterns ? JSON.parse(r.patterns) : [],
    status: r.status,
    status_reason: r.status_reason,
    kept: Boolean(r.kept_at),
  };
}

// --- videos -----------------------------------------------------------------

// { youtube_id, title, duration_s, caption_track, lines: [{ start_s, end_s, written }] }
function addVideo(v) {
  const d = handle();
  const tx = d.transaction(() => {
    const { lastInsertRowid } = d.prepare('INSERT INTO videos (youtube_id, title, duration_s, caption_track, added_at, joined) VALUES (?, ?, ?, ?, ?, 1)')
      .run(v.youtube_id ?? null, v.title, v.duration_s ?? null, v.caption_track ?? null, now());
    const ins = d.prepare("INSERT INTO lines (video_id, idx, start_s, end_s, written, status) VALUES (?, ?, ?, ?, ?, 'pending')");
    v.lines.forEach((l, i) => ins.run(lastInsertRowid, i, l.start_s ?? null, l.end_s ?? null, l.written));
    return Number(lastInsertRowid);
  });
  return tx();
}

const sameText = (s) => String(s || '').replace(/\s+/g, ' ').trim();

// A new paste (or the sentence join) for a saved video: its lines, and their
// "as said" results, are replaced by `lines`, all pending again. A kept line
// stays kept on the new line with the same text, else on the new line that
// contains its text; one that matches no new line is kept anyway, with its
// text, in kept_earlier ("from an earlier paste"). Answers { lines, moved, earlier }.
function replaceLines(videoId, lines, { caption_track } = {}) {
  const d = handle();
  const tx = d.transaction(() => {
    const keptRows = d.prepare('SELECT k.kept_at, l.* FROM kept k JOIN lines l ON l.id = k.line_id WHERE l.video_id = ? ORDER BY k.id').all(videoId);
    d.prepare('DELETE FROM lines WHERE video_id = ?').run(videoId);
    const ins = d.prepare("INSERT INTO lines (video_id, idx, start_s, end_s, written, status) VALUES (?, ?, ?, ?, ?, 'pending')");
    const ids = lines.map((l, i) => Number(ins.run(videoId, i, l.start_s ?? null, l.end_s ?? null, l.written).lastInsertRowid));
    const texts = lines.map((l) => sameText(l.written));
    let moved = 0, earlier = 0;
    for (const k of keptRows) {
      const old = sameText(k.written);
      let at = texts.indexOf(old);
      if (at < 0 && old) at = texts.findIndex((t) => t.includes(old));
      if (at >= 0) {
        d.prepare('INSERT OR IGNORE INTO kept (line_id, kept_at) VALUES (?, ?)').run(ids[at], k.kept_at);
        moved++;
      } else {
        d.prepare('INSERT INTO kept_earlier (video_id, start_s, written, spoken, spans, patterns, kept_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .run(videoId, k.start_s, k.written, k.spoken, k.spans, k.patterns, k.kept_at);
        earlier++;
      }
    }
    if (caption_track) d.prepare('UPDATE videos SET caption_track = ? WHERE id = ?').run(caption_track, videoId);
    d.prepare('UPDATE videos SET joined = 1 WHERE id = ?').run(videoId);
    return { lines: lines.length, moved, earlier };
  });
  return tx();
}

// YouTube videos saved before lines were joined into sentences.
function videosNotJoined() {
  return handle().prepare('SELECT id FROM videos WHERE joined = 0 AND youtube_id IS NOT NULL ORDER BY id').all().map((r) => r.id);
}

function markJoined(videoId) {
  handle().prepare('UPDATE videos SET joined = 1 WHERE id = ?').run(videoId);
}

function findVideoByYoutubeId(youtubeId) {
  return handle().prepare('SELECT * FROM videos WHERE youtube_id = ? ORDER BY id DESC LIMIT 1').get(youtubeId) || null;
}

function lineCounts(videoId) {
  const rows = handle().prepare('SELECT status, COUNT(*) AS n FROM lines WHERE video_id = ? GROUP BY status').all(videoId);
  const out = { total: 0, worked: 0, unworked: 0, pending: 0 };
  for (const r of rows) { out[r.status] = r.n; out.total += r.n; }
  return out;
}

function getVideo(id) {
  const d = handle();
  const v = d.prepare('SELECT * FROM videos WHERE id = ?').get(Number(id));
  if (!v) throw new AppError(404, `No video ${id}.`);
  const lines = d.prepare(`SELECT l.*, k.kept_at FROM lines l LEFT JOIN kept k ON k.line_id = l.id
    WHERE l.video_id = ? ORDER BY l.idx`).all(v.id).map(lineRow);
  return { ...v, lines, counts: lineCounts(v.id) };
}

function listVideos({ limit = 5, typed = false } = {}) {
  const where = typed ? '' : 'WHERE youtube_id IS NOT NULL';
  return handle().prepare(`SELECT * FROM videos ${where} ORDER BY id DESC LIMIT ?`).all(limit)
    .map((v) => ({ ...v, counts: lineCounts(v.id) }));
}

// --- lines ------------------------------------------------------------------

function getLine(id) {
  const r = handle().prepare('SELECT l.*, k.kept_at FROM lines l LEFT JOIN kept k ON k.line_id = l.id WHERE l.id = ?').get(Number(id));
  if (!r) throw new AppError(404, `No line ${id}.`);
  return lineRow(r);
}

function linesWithStatus(videoId, statuses) {
  const marks = statuses.map(() => '?').join(', ');
  return handle().prepare(`SELECT * FROM lines WHERE video_id = ? AND status IN (${marks}) ORDER BY idx`)
    .all(videoId, ...statuses).map(lineRow);
}

function videosWithPending() {
  return handle().prepare("SELECT DISTINCT video_id FROM lines WHERE status = 'pending'").all().map((r) => r.video_id);
}

function setLineWorked(id, { spoken, spans, patterns }) {
  handle().prepare("UPDATE lines SET spoken = ?, spans = ?, patterns = ?, status = 'worked', status_reason = NULL WHERE id = ?")
    .run(spoken, JSON.stringify(spans), JSON.stringify(patterns), id);
}

function setLineUnworked(id, reason) {
  handle().prepare("UPDATE lines SET status = 'unworked', status_reason = ? WHERE id = ?").run(String(reason).slice(0, 500), id);
}

function setLinesPending(ids) {
  const st = handle().prepare("UPDATE lines SET status = 'pending', status_reason = NULL WHERE id = ?");
  handle().transaction(() => ids.forEach((id) => st.run(id)))();
}

// --- kept -------------------------------------------------------------------

// Keeps the line and records one keep event per pattern in it. Keeping a
// line already kept changes nothing and records nothing.
function keepLine(lineId) {
  const line = getLine(lineId);
  const d = handle();
  const tx = d.transaction(() => {
    const r = d.prepare('INSERT OR IGNORE INTO kept (line_id, kept_at) VALUES (?, ?)').run(line.id, now());
    if (r.changes === 0) return false;
    for (const p of line.patterns) addEventRow('keep', p, line.id);
    return true;
  });
  return { kept: true, created: tx() };
}

function unkeepLine(lineId) {
  handle().prepare('DELETE FROM kept WHERE line_id = ?').run(Number(lineId));
  return { kept: false };
}

// Kept lines, newest first: those on a line of the video, and those from an
// earlier paste (earlier: true, no line id).
function listKept() {
  const d = handle();
  const now = d.prepare(`SELECT k.kept_at, l.*, v.title AS video_title, v.youtube_id, v.id AS vid, v.caption_track AS track, m.id AS moment_id
    FROM kept k JOIN lines l ON l.id = k.line_id JOIN videos v ON v.id = l.video_id
    LEFT JOIN moments m ON m.video_id = v.id ORDER BY k.id DESC`).all()
    .map((r) => ({ ...lineRow(r), kept_at: r.kept_at, earlier: false, moment_id: r.moment_id ?? null, video: { id: r.vid, title: r.video_title, youtube_id: r.youtube_id, caption_track: r.track } }));
  const before = d.prepare(`SELECT e.*, v.title AS video_title, v.youtube_id
    FROM kept_earlier e JOIN videos v ON v.id = e.video_id ORDER BY e.id DESC`).all()
    .map((r) => ({
      id: null, video_id: r.video_id, idx: null, start_s: r.start_s, end_s: null, written: r.written, spoken: r.spoken,
      spans: r.spans ? JSON.parse(r.spans) : [], patterns: r.patterns ? JSON.parse(r.patterns) : [],
      status: 'worked', status_reason: null, kept: true, kept_at: r.kept_at, earlier: true,
      video: { id: r.video_id, title: r.video_title, youtube_id: r.youtube_id },
    }));
  return [...now, ...before].sort((a, b) => (a.kept_at < b.kept_at ? 1 : a.kept_at > b.kept_at ? -1 : 0));
}

// --- moments (photos from the TV) --------------------------------------------
//
// read_status: reading | read | none (no subtitle on the photo) | failed
// work_status: waiting (not saved yet, or waiting on the reading) | working |
//              worked | unworked (the reason in work_reason) | nothing (no
//              subtitle and no sound note: there is nothing to work from)

const MOMENT_EDITS = ['subtitle', 'subtitle_lang', 'subtitle_edited', 'heard_note', 'scene_note', 'saved', 'read_status',
  'work_status', 'work_reason', 'sure', 'why', 'video_id', 'tallied'];

function addMoment({ photo_path, photo_bytes }) {
  return Number(handle().prepare('INSERT INTO moments (added_at, photo_path, photo_bytes) VALUES (?, ?, ?)')
    .run(now(), photo_path, photo_bytes).lastInsertRowid);
}

function momentRow(id) {
  const m = handle().prepare('SELECT * FROM moments WHERE id = ?').get(Number(id));
  if (!m) throw new AppError(404, `No photo ${id}.`);
  return m;
}

function updateMoment(id, fields) {
  const keys = Object.keys(fields).filter((k) => MOMENT_EDITS.includes(k));
  if (!keys.length) return;
  handle().prepare(`UPDATE moments SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`)
    .run(...keys.map((k) => (typeof fields[k] === 'boolean' ? Number(fields[k]) : fields[k])), Number(id));
}

// A moment with its line (or null), for the pages.
function getMoment(id) {
  const m = momentRow(id);
  let line = null;
  if (m.video_id) {
    const r = handle().prepare('SELECT l.*, k.kept_at FROM lines l LEFT JOIN kept k ON k.line_id = l.id WHERE l.video_id = ? ORDER BY l.idx LIMIT 1').get(m.video_id);
    line = r ? lineRow(r) : null;
  }
  const { photo_path, ...rest } = m;
  return { ...rest, saved: Boolean(m.saved), subtitle_edited: Boolean(m.subtitle_edited), tallied: Boolean(m.tallied), line };
}

function listMoments({ limit = 50 } = {}) {
  return handle().prepare('SELECT id FROM moments ORDER BY id DESC LIMIT ?').all(limit).map((r) => getMoment(r.id));
}

function momentPhotoPath(id) {
  return momentRow(id).photo_path;
}

// The moment's line: a video row of its own with one line, pending, made or
// replaced. A kept line stays kept when the new line has the same text.
function setMomentLine(id, written) {
  const m = momentRow(id);
  const title = written.length > 80 ? `${written.slice(0, 77)}…` : written;
  if (m.video_id) {
    replaceLines(m.video_id, [{ written }], { caption_track: 'tv' });
    handle().prepare('UPDATE videos SET title = ? WHERE id = ?').run(title, m.video_id);
    return m.video_id;
  }
  const videoId = addVideo({ youtube_id: null, title, caption_track: 'tv', lines: [{ written }] });
  updateMoment(id, { video_id: videoId });
  return videoId;
}

// The moment's line goes: it has no French any more (no subtitle and no note).
function clearMomentLine(id) {
  const m = momentRow(id);
  if (m.video_id) handle().prepare('DELETE FROM videos WHERE id = ?').run(m.video_id);
  updateMoment(id, { video_id: null });
}

// Moments a restart left half done: still being read, or saved and not yet
// worked out.
function momentsUnfinished() {
  return handle().prepare("SELECT id FROM moments WHERE read_status = 'reading' OR (saved = 1 AND work_status IN ('waiting', 'working')) ORDER BY id").all().map((r) => r.id);
}

// --- clips (for the drills) ---------------------------------------------------
//
// A clip is a worked-out line of one of his YouTube videos with a start and
// an end time: the player can replay it. Typed lines and photos from the TV
// have no YouTube id, and a transcript pasted without timings has no times;
// none of those is a clip.

const CLIP_WHERE = `v.youtube_id IS NOT NULL AND l.start_s IS NOT NULL AND l.end_s IS NOT NULL
  AND l.end_s > l.start_s AND l.status = 'worked'`;

function clipRow(r) {
  return { ...lineRow(r), video: { id: r.vid, youtube_id: r.youtube_id, title: r.video_title } };
}

// Every clip whose patterns include `patternId` (or every clip, with none),
// newest video first, then in the video's order.
function clips(patternId) {
  const has = patternId ? 'AND EXISTS (SELECT 1 FROM json_each(l.patterns) j WHERE j.value = ?)' : '';
  return handle().prepare(`SELECT l.*, v.id AS vid, v.youtube_id, v.title AS video_title
    FROM lines l JOIN videos v ON v.id = l.video_id
    WHERE ${CLIP_WHERE} AND json_array_length(COALESCE(l.patterns, '[]')) > 0 ${has}
    ORDER BY v.id DESC, l.idx`).all(...(patternId ? [patternId] : [])).map(clipRow);
}

// pattern id -> how many clips carry it, for every pattern that has one.
function clipCounts() {
  const out = {};
  for (const r of handle().prepare(`SELECT j.value AS pattern, COUNT(DISTINCT l.id) AS n
    FROM lines l JOIN videos v ON v.id = l.video_id, json_each(l.patterns) j
    WHERE ${CLIP_WHERE} GROUP BY j.value`).all()) out[r.pattern] = r.n;
  return out;
}

// The written text of every worked line in his YouTube videos, timed or not:
// where the drills draw their wrong choices from.
function videoLineTexts() {
  return handle().prepare(`SELECT l.id, l.written FROM lines l JOIN videos v ON v.id = l.video_id
    WHERE v.youtube_id IS NOT NULL AND l.status = 'worked' ORDER BY l.id`).all();
}

// --- events -----------------------------------------------------------------

function addEventRow(kind, patternId, lineId) {
  handle().prepare('INSERT INTO events (at, kind, pattern_id, line_id) VALUES (?, ?, ?, ?)').run(now(), kind, patternId, lineId ?? null);
}

function allEvents() {
  return handle().prepare('SELECT * FROM events ORDER BY id').all();
}

module.exports = {
  AppError, EVENT_KINDS, open, handle,
  addVideo, replaceLines, videosNotJoined, markJoined, findVideoByYoutubeId, getVideo, listVideos, lineCounts,
  getLine, linesWithStatus, videosWithPending, setLineWorked, setLineUnworked, setLinesPending,
  keepLine, unkeepLine, listKept,
  addMoment, getMoment, listMoments, updateMoment, momentPhotoPath, setMomentLine, clearMomentLine, momentsUnfinished,
  clips, clipCounts, videoLineTexts,
  addEventRow, allEvents,
};
