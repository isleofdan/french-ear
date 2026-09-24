'use strict';
// The passphrase gate: one passphrase (APP_PASSWORD), one signed 30-day
// cookie (COOKIE_SECRET). Comparisons go through HMAC digests of equal
// length, so neither the length nor the prefix of a secret leaks by timing.
// The same shape as isleofdan/hebrew-reader's lib/auth.js.

const { createHmac, timingSafeEqual } = require('node:crypto');

const COOKIE = 'fe_auth';
const MAX_AGE_S = 30 * 24 * 60 * 60;

function digest(key, value) {
  return createHmac('sha256', key).update(String(value)).digest();
}

function same(key, a, b) {
  return timingSafeEqual(digest(key, a), digest(key, b));
}

function passwordOk(submitted, password) {
  if (typeof submitted !== 'string') return false;
  return same(password, submitted, password);
}

function sign(secret, exp) {
  return createHmac('sha256', secret).update(String(exp)).digest('hex');
}

function issueCookie(secret, { secure = true } = {}) {
  const exp = Date.now() + MAX_AGE_S * 1000;
  const value = encodeURIComponent(`${exp}.${sign(secret, exp)}`);
  const flags = ['Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${MAX_AGE_S}`];
  if (secure) flags.push('Secure');
  return `${COOKIE}=${value}; ${flags.join('; ')}`;
}

function clearCookie({ secure = true } = {}) {
  const flags = ['Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (secure) flags.push('Secure');
  return `${COOKIE}=; ${flags.join('; ')}`;
}

function cookieOk(req, secret) {
  const raw = req.headers.cookie || '';
  const hit = raw.split(';').map((c) => c.trim()).find((c) => c.startsWith(COOKIE + '='));
  if (!hit) return false;
  const [exp, mac] = decodeURIComponent(hit.slice(COOKIE.length + 1)).split('.');
  if (!exp || !mac) return false;
  if (!/^\d+$/.test(exp) || Number(exp) < Date.now()) return false;
  return same(secret, mac, sign(secret, exp));
}

module.exports = { passwordOk, issueCookie, clearCookie, cookieOk, COOKIE, MAX_AGE_S };
