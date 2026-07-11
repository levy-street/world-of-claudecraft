// multibox_fleet.mjs — start a whole FLEET of multibox parties with one command, and
// stop them all with one Ctrl-C. Each party runs as its own `multibox.mjs` child process
// (one WebSocket set each); their console output is line-prefixed with the party tag.
//
// Usage:
//   node scripts/multibox_fleet.mjs                       # reads scripts/multibox.fleet.json
//   node scripts/multibox_fleet.mjs a.json b.json …       # explicit party configs
//
// Safety: refuses to launch if two parties share a CHARACTER or ACCOUNT — the server only
// lets a character be in the world once, and one-char-per-account blocks the rest, so that
// would just collide. (This is the "never run the same character in two processes" rule.)

import { spawn } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { loadConfig } from './multibox_config.mjs';

const FLEET_FILE = 'scripts/multibox.fleet.json';

const CHECK = process.argv.includes('--check') || process.argv.includes('--dry');
let paths = process.argv.slice(2).filter((a) => !a.startsWith('--'));
if (!paths.length) {
  if (!existsSync(FLEET_FILE)) {
    console.error(`usage: node scripts/multibox_fleet.mjs <party.json>…   (or create ${FLEET_FILE} listing the parties)`);
    process.exit(1);
  }
  const f = JSON.parse(readFileSync(FLEET_FILE, 'utf8'));
  paths = Array.isArray(f) ? f : (f.parties ?? []);
}
// bare names resolve under scripts/
paths = paths.map((p) => (p.includes('/') ? p : `scripts/${p}`));

// load each party + guard against character/account collisions across the fleet
const seenChar = new Map(), seenAcct = new Map(), parties = [];
for (const path of paths) {
  let cfg;
  try { cfg = loadConfig(path); }
  catch (e) { console.error(`✗ ${path}: ${e.message}`); process.exit(1); }
  const label = `${cfg.tag ? cfg.tag + ' ' : ''}${path.split('/').pop().replace(/^multibox\.|\.json$/g, '')}`;
  for (const b of cfg.bots ?? []) {
    const ch = String(b.character).toLowerCase(), ac = String(b.user).toLowerCase();
    if (seenChar.has(ch)) { console.error(`✗ character "${b.character}" is in two fleet parties (${seenChar.get(ch)} + ${label}) — they would collide. Run only one.`); process.exit(1); }
    if (seenAcct.has(ac)) { console.error(`✗ account "${b.user}" is in two fleet parties (${seenAcct.get(ac)} + ${label}) — one-char-per-account blocks it. Run only one.`); process.exit(1); }
    seenChar.set(ch, label); seenAcct.set(ac, label);
  }
  parties.push({ path, label, cfg });
}
if (!parties.length) { console.error('no parties to launch.'); process.exit(1); }

console.log(`🚀 fleet: launching ${parties.length} part${parties.length === 1 ? 'y' : 'ies'}`);
for (const p of parties) console.log(`   ${p.label} — ${(p.cfg.bots ?? []).map((b) => b.character).join(', ')}`);
if (CHECK) { console.log('fleet: --check OK (no collisions); not launching.'); process.exit(0); }

const children = [];
let shuttingDown = false;

for (const p of parties) {
  const child = spawn('node', ['scripts/multibox.mjs', p.path], { stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
  const relay = (stream, out) => {
    let buf = '';
    stream.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) { out.write(`[${p.label}] ${buf.slice(0, i)}\n`); buf = buf.slice(i + 1); }
    });
  };
  relay(child.stdout, process.stdout);
  relay(child.stderr, process.stderr);
  child.on('exit', (code, sig) => {
    console.log(`[${p.label}] exited (code=${code ?? '-'} sig=${sig ?? '-'})`);
    if (!shuttingDown && children.every((c) => c.exitCode !== null || c.signalCode !== null)) {
      console.log('fleet: all parties stopped.');
      process.exit(0);
    }
  });
  children.push(child);
}

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('\n⏹  fleet: stopping all parties…');
  for (const c of children) { try { c.kill('SIGINT'); } catch {} }
  setTimeout(() => { for (const c of children) { try { c.kill('SIGKILL'); } catch {} } process.exit(0); }, 4000);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
