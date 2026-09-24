'use strict';
// The app's own database: one SQLite file on the Fly volume (DATA_DIR, /data
// in production). Four tables, as the brief's section 11.2 sets them:
//   videos  — one row per YouTube video; youtube_id null for a typed line
//   lines   — the video's lines: written, spoken, spans, patterns, status
//   kept    — the lines he kept
//   events  — looked, got_past_me, watched_clean, keep; one row per pattern

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
  `);
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
    const { lastInsertRowid } = d.prepare('INSERT INTO videos (youtube_id, title, duration_s, caption_track, added_at) VALUES (?, ?, ?, ?, ?)')
      .run(v.youtube_id ?? null, v.title, v.duration_s ?? null, v.caption_track ?? null, now());
    const ins = d.prepare("INSERT INTO lines (video_id, idx, start_s, end_s, written, status) VALUES (?, ?, ?, ?, ?, 'pending')");
    v.lines.forEach((l, i) => ins.run(lastInsertRowid, i, l.start_s ?? null, l.end_s ?? null, l.written));
    return Number(lastInsertRowid);
  });
  return tx();
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

function listKept() {
  return handle().prepare(`SELECT k.kept_at, l.*, v.title AS video_title, v.youtube_id, v.id AS vid
    FROM kept k JOIN lines l ON l.id = k.line_id JOIN videos v ON v.id = l.video_id ORDER BY k.id DESC`).all()
    .map((r) => ({ ...lineRow(r), kept_at: r.kept_at, video: { id: r.vid, title: r.video_title, youtube_id: r.youtube_id } }));
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
  addVideo, findVideoByYoutubeId, getVideo, listVideos, lineCounts,
  getLine, linesWithStatus, videosWithPending, setLineWorked, setLineUnworked, setLinesPending,
  keepLine, unkeepLine, listKept,
  addEventRow, allEvents,
};
