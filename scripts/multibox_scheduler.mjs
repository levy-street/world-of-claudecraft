// multibox_scheduler.mjs — human-cadence supervisor for ONE party. Instead of a
// single 24/7 grind (inhuman /played + lots of logins → rate limits + report bait),
// it runs SESSIONS of randomized length with OFFLINE breaks and a nightly SLEEP
// window. Each session ends with the GRACEFUL staggered logout (it SIGTERMs the
// child, which trickles dps→healer→tank), never an abrupt mass-disconnect.
//
//   node scripts/multibox_scheduler.mjs scripts/multibox.ryzeduo.json
//   node scripts/multibox_scheduler.mjs scripts/multibox.psduo.json --check   # dry-run, no launch
//
// Tunables (env, minutes / local hours):
//   SESSION_MIN=75  SESSION_MAX=180   BREAK_MIN=25  BREAK_MAX=90
//   SLEEP_START=2   SLEEP_END=9                       (no sessions in [start,end) local)
// One scheduler per party; stagger several by giving each its own ranges.

import { spawn } from 'node:child_process';
import { existsSync, unlinkSync } from 'node:fs';

const args = process.argv.slice(2);
const CHECK = args.includes('--check');
const config = args.find((a) => !a.startsWith('--')) ?? 'scripts/multibox.ryzeduo.json';
const STOP_FILE = process.env.MULTIBOX_STOPFILE ?? 'multibox.stop';

const num = (k, d) => Number(process.env[k] ?? d);
const SESSION_MIN = num('SESSION_MIN', 75), SESSION_MAX = num('SESSION_MAX', 180);
const BREAK_MIN = num('BREAK_MIN', 25), BREAK_MAX = num('BREAK_MAX', 90);
const SLEEP_START = num('SLEEP_START', 2), SLEEP_END = num('SLEEP_END', 9);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stamp = (d = new Date()) => d.toTimeString().slice(0, 8);
const rand = (lo, hi) => lo + Math.random() * (hi - lo);
const log = (m) => console.log(`[${stamp()}] ${m}`);

const inSleep = (h) => (SLEEP_START < SLEEP_END ? (h >= SLEEP_START && h < SLEEP_END) : (h >= SLEEP_START || h < SLEEP_END));
// ms from `from` until the next time the local clock hits hour SLEEP_END (minute 0)
function msUntilWake(from) {
  const d = new Date(from);
  d.setMinutes(0, 0, 0);
  while (true) { d.setHours(d.getHours() + 1); if (d.getHours() === SLEEP_END && d.getTime() > from) return d.getTime() - from; }
}
// minutes until the sleep window starts (for capping a session so it doesn't run past bedtime)
function minsUntilSleep(from) {
  for (let m = 0; m <= 24 * 60; m += 1) { if (inSleep(new Date(from + m * 60000).getHours())) return m; }
  return Infinity;
}

let child = null, stopping = false;
function runSession(mins) {
  return new Promise((resolve) => {
    if (existsSync(STOP_FILE)) { try { unlinkSync(STOP_FILE); } catch {} } // fresh start
    log(`▶ session start: ${config}  (~${Math.round(mins)} min) — pid spawn`);
    child = spawn('node', ['scripts/multibox.mjs', config], { stdio: 'inherit', env: process.env });
    let ended = false;
    const finish = (why) => { if (ended) return; ended = true; child = null; log(`■ session end (${why})`); resolve(); };
    child.on('exit', () => finish('child exited'));
    // end the session gracefully: SIGTERM → the child's staggered dps→healer→tank logout
    const timer = setTimeout(() => {
      if (child && !ended) { log('… ending session: SIGTERM → graceful staggered logout'); child.kill('SIGTERM'); }
    }, mins * 60000);
    child.on('exit', () => clearTimeout(timer));
  });
}

function planPreview() {
  log(`DRY RUN — planned cadence for ${config} (no launch):`);
  let t = Date.now();
  for (let i = 0; i < 8; i++) {
    const h = new Date(t).getHours();
    if (inSleep(h)) { const w = msUntilWake(t); console.log(`   ${stamp(new Date(t))}  😴 sleep → wake at ${stamp(new Date(t + w))}`); t += w + rand(0, 20) * 60000; continue; }
    let s = rand(SESSION_MIN, SESSION_MAX); const cap = minsUntilSleep(t); if (s > cap) s = cap;
    const b = rand(BREAK_MIN, BREAK_MAX);
    console.log(`   ${stamp(new Date(t))}  ▶ play ${Math.round(s)}m  →  ${stamp(new Date(t + s * 60000))}  ⏸ break ${Math.round(b)}m`);
    t += (s + b) * 60000;
  }
  console.log(`   (windows: SESSION ${SESSION_MIN}-${SESSION_MAX}m · BREAK ${BREAK_MIN}-${BREAK_MAX}m · SLEEP ${SLEEP_START}:00-${SLEEP_END}:00)`);
}

async function main() {
  log(`scheduler for ${config} — SESSION ${SESSION_MIN}-${SESSION_MAX}m · BREAK ${BREAK_MIN}-${BREAK_MAX}m · SLEEP ${SLEEP_START}-${SLEEP_END}h`);
  if (CHECK) { planPreview(); return; }
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { stopping = true; if (child) { log('scheduler stopping → SIGTERM child (graceful logout)'); child.kill('SIGTERM'); } setTimeout(() => process.exit(0), 8000); });
  // small randomized initial delay so multiple schedulers don't all start on the same second
  await sleep(rand(0, 90) * 1000);
  while (!stopping) {
    const h = new Date().getHours();
    if (inSleep(h)) { const w = msUntilWake(Date.now()) + rand(0, 25) * 60000; log(`😴 sleep window — offline until ~${stamp(new Date(Date.now() + w))}`); await sleep(w); continue; }
    let s = rand(SESSION_MIN, SESSION_MAX); const cap = minsUntilSleep(Date.now()); if (s > cap) s = Math.max(15, cap - 2);
    await runSession(s);
    if (stopping) break;
    const b = rand(BREAK_MIN, BREAK_MAX);
    log(`⏸ break ${Math.round(b)} min (offline) → back ~${stamp(new Date(Date.now() + b * 60000))}`);
    await sleep(b * 60000);
  }
}
main().catch((e) => { console.error('fatal:', e.message); process.exit(1); });
