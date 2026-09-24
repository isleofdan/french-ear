'use strict';
// The fixed list of twenty spoken-French patterns (data/patterns.json). Every
// "as said" line and every tint refers to one of these ids; nothing else is
// accepted from the model.

const PATTERNS = require('../data/patterns.json');

const IDS = PATTERNS.map((p) => p.id);
const BY_ID = Object.fromEntries(PATTERNS.map((p) => [p.id, p]));

function isPattern(id) {
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(BY_ID, id);
}

module.exports = { PATTERNS, IDS, BY_ID, isPattern };
