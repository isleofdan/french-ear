'use strict';
// Rate limit on the passphrase: after MAX_ATTEMPTS wrong tries from one client
// address within WINDOW_MS, POST /login answers 429 and checks nothing until
// the wait is over. A correct passphrase clears the count. In memory only.
// The attempted passphrase is never logged.

const MAX_ATTEMPTS = 5;
const DEFAULT_WINDOW_MS = 15 * 60 * 1000;
const WINDOW_MS = (() => {
  const n = Number(process.env.LOGIN_WINDOW_MS);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_WINDOW_MS;
})();

const failures = new Map(); // address -> timestamps of wrong tries

// Fly's proxy sets fly-client-ip; locally the socket address is the client.
function clientIp(req) {
  const fly = req.headers['fly-client-ip'];
  if (typeof fly === 'string' && fly.trim()) return fly.trim();
  return req.socket?.remoteAddress || 'unknown';
}

function fresh(list, now) {
  return list.filter((t) => now - t < WINDOW_MS);
}

// Seconds left in the lock for this address, or 0 when it may try.
function lockedFor(req, now = Date.now()) {
  const ip = clientIp(req);
  const list = fresh(failures.get(ip) || [], now);
  if (list.length === 0) failures.delete(ip); else failures.set(ip, list);
  if (list.length < MAX_ATTEMPTS) return 0;
  return Math.ceil((list[0] + WINDOW_MS - now) / 1000);
}

function recordFailure(req, now = Date.now()) {
  const ip = clientIp(req);
  const list = fresh(failures.get(ip) || [], now);
  list.push(now);
  failures.set(ip, list);
  if (list.length >= MAX_ATTEMPTS) {
    console.log(`login: ${ip} locked for ${Math.ceil(WINDOW_MS / 1000)}s after ${list.length} wrong passphrases`);
  }
}

function clear(req) {
  failures.delete(clientIp(req));
}

module.exports = { lockedFor, recordFailure, clear, MAX_ATTEMPTS, WINDOW_MS };
