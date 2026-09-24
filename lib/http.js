'use strict';
// Small helpers for the plain Node http server: JSON in and out, static files.

const fs = require('node:fs');
const path = require('node:path');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

function sendJson(res, status, body, extraHeaders = {}) {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extraHeaders });
  res.end(text);
}

function sendHtml(res, status, html, extraHeaders = {}) {
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', ...extraHeaders });
  res.end(html);
}

function redirect(res, location, extraHeaders = {}) {
  res.writeHead(303, { location, ...extraHeaders });
  res.end();
}

// Reads the whole body (at most `limit` bytes) as a string.
async function readBody(req, limit = 2 * 1024 * 1024) {
  return (await readBuffer(req, limit)).toString('utf8');
}

// Reads the whole body (at most `limit` bytes) as bytes.
function readBuffer(req, limit = 2 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(Object.assign(new Error(`Body larger than ${limit} bytes.`), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// JSON body, or a form body turned into a plain object. Anything else is a 400.
async function readJson(req) {
  const raw = await readBody(req);
  const type = (req.headers['content-type'] || '').split(';')[0].trim();
  if (type === 'application/x-www-form-urlencoded') {
    return Object.fromEntries(new URLSearchParams(raw));
  }
  if (raw.trim() === '') return {};
  try {
    const value = JSON.parse(raw);
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('not an object');
    }
    return value;
  } catch {
    throw Object.assign(new Error('Body must be a JSON object.'), { status: 400 });
  }
}

// A multipart/form-data body -> { fields: { name: text }, files: [{ field,
// fileName, type, bytes }] }. Anything else is a 400 saying what was expected.
async function readForm(req, limit, expected = 'a form') {
  const type = req.headers['content-type'] || '';
  const b = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(type);
  if (!/^multipart\/form-data/i.test(type) || !b) {
    throw Object.assign(new Error(`Send ${expected} as multipart/form-data.`), { status: 400 });
  }
  const declared = Number(req.headers['content-length']);
  const tooBig = () => Object.assign(new Error(`That is over ${Math.floor(limit / (1024 * 1024))} MB in all.`), { status: 413 });
  if (declared > limit) throw tooBig();
  let body;
  try { body = await readBuffer(req, limit); } catch (e) { throw e.status === 413 ? tooBig() : e; }
  const sep = Buffer.from(`--${b[1] || b[2]}`);
  const fields = {};
  const files = [];
  let at = body.indexOf(sep);
  while (at >= 0) {
    const start = at + sep.length;
    const next = body.indexOf(sep, start);
    if (next < 0) break;
    const part = body.subarray(start, next);
    const headEnd = part.indexOf('\r\n\r\n');
    if (headEnd >= 0) {
      const head = part.subarray(0, headEnd).toString('utf8');
      const name = /name="([^"]*)"/i.exec(head);
      let bytes = part.subarray(headEnd + 4);
      if (bytes.subarray(-2).toString('latin1') === '\r\n') bytes = bytes.subarray(0, -2);
      const star = /filename\*=UTF-8''([^;\r\n]+)/i.exec(head);
      const plain = /filename="([^"]*)"/i.exec(head);
      if (name && (star || plain)) {
        let fileName = plain ? plain[1] : '';
        if (star) { try { fileName = decodeURIComponent(star[1]); } catch { /* keep the plain name */ } }
        const ctype = /content-type:\s*([^\r\n;]+)/i.exec(head);
        files.push({ field: name[1], fileName, type: ctype ? ctype[1].trim() : '', bytes });
      } else if (name) {
        fields[name[1]] = bytes.toString('utf8');
      }
    }
    at = next;
  }
  return { fields, files };
}

// One file from a multipart/form-data body: { fileName, bytes } for the part
// named `field`. Anything else is a 400 naming what was expected.
async function readFile(req, field, limit) {
  const { files } = await readForm(req, limit, `the file in a field named "${field}"`);
  const f = files.find((x) => x.field === field);
  if (!f) throw Object.assign(new Error(`No file in the field "${field}".`), { status: 400 });
  return { fileName: f.fileName, bytes: f.bytes };
}

// Serves one file from `root`; false when it is not there or the path escapes.
function serveStatic(res, root, urlPath) {
  const clean = path.normalize(decodeURIComponent(urlPath)).replace(/^(\.\.[/\\])+/, '');
  const file = path.join(root, clean);
  if (!file.startsWith(root)) return false;
  let stat;
  try { stat = fs.statSync(file); } catch { return false; }
  if (!stat.isFile()) return false;
  const ext = path.extname(file).toLowerCase();
  res.writeHead(200, {
    'content-type': TYPES[ext] || 'application/octet-stream',
    'content-length': stat.size,
    'cache-control': ext === '.html' ? 'no-store' : 'public, max-age=300',
  });
  fs.createReadStream(file).pipe(res);
  return true;
}

module.exports = { sendJson, sendHtml, redirect, readBody, readBuffer, readFile, readForm, readJson, serveStatic };
