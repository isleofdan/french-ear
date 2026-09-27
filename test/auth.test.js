'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { passwordOk } = require('../lib/auth');

test('sign-in ignores spaces at either end of what is typed', () => {
  assert.equal(passwordOk('bonjour papa', 'bonjour papa'), true);
  assert.equal(passwordOk('  bonjour papa ', 'bonjour papa'), true);
  assert.equal(passwordOk('bonjour papa\n', 'bonjour papa'), true);
  assert.equal(passwordOk('bonjour papa', ' bonjour papa '), true, 'a secret set with a stray space still matches');
});

test('but not a wrong passphrase, spaces inside, or nothing at all', () => {
  assert.equal(passwordOk('bonjourpapa', 'bonjour papa'), false);
  assert.equal(passwordOk('bonjour  papa', 'bonjour papa'), false);
  assert.equal(passwordOk('Bonjour papa', 'bonjour papa'), false);
  assert.equal(passwordOk('   ', 'bonjour papa'), false);
  assert.equal(passwordOk(undefined, 'bonjour papa'), false);
});
