'use strict';
// Starts the mock servers (and the app) on free ports for a test file.
const { spawn } = require('node:child_process');
const path = require('node:path');
const net = require('node:net');

const root = path.join(__dirname, '..');

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, () => { const { port } = s.address(); s.close(() => resolve(port)); });
    s.on('error', reject);
  });
}

async function up(url) {
  for (let i = 0; i < 100; i++) {
    try { await fetch(url); return; } catch { await new Promise((r) => setTimeout(r, 50)); }
  }
  throw new Error(`nothing at ${url}`);
}

function start(args, env = {}) {
  const kid = spawn(process.execPath, args, { cwd: root, env: { ...process.env, ...env }, stdio: ['ignore', 'ignore', 'inherit'] });
  return kid;
}

module.exports = { freePort, up, start, root };
