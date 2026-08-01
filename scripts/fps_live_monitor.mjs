// Live FPS A/B monitor. Connects to the two browsers fps_live_launch.mjs
// booted, waits until BOTH are in-world (the user logs in manually), then
// runs the same tour in both simultaneously: teleport to each waypoint,
// sample idle, orbit the camera, run the player forward, collecting rAF
// frame deltas in-page and per-browser process CPU (total + GPU helper) via
// ps sampling. Simultaneous measurement means both builds share identical
// ambient machine load at every moment, so the comparison is apples-to-apples
// even if something else spikes mid-run.
// Usage: node scripts/fps_live_monitor.mjs   (after both worlds are entered)
// Output: printed table + tmp/fps-live-results.json
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

const TARGETS = ['pbe2', 'local'];
const WAIT_INWORLD_MS = 15 * 60 * 1000;
const SETTLE_MS = 8000;
const PHASES = [
  { name: 'idle', ms: 8000, orbit: 0, run: false },
  { name: 'orbit', ms: 6000, orbit: 0.9, run: false },
  { name: 'run', ms: 6000, orbit: 0.25, run: true },
];
const WAYPOINTS = [
  { name: 'meadow', x: 15, z: 45, yaw: 1.0, pitch: 0.35, dist: 9 },
  { name: 'path', x: 40, z: 9.5, yaw: 1.41, pitch: 0.4, dist: 8 },
  { name: 'town', x: 13, z: 15, yaw: 2.45, pitch: -0.2, dist: 12 },
  { name: 'peaks', x: 30, z: 700, yaw: 0.5, pitch: 0.3, dist: 8 },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- per-browser process CPU sampling (total tree + GPU helper proxy) ----
const roots = Object.fromEntries(
  TARGETS.map((t) => [t, Number(fs.readFileSync(`tmp/fps-live-${t}.pid`, 'utf8').trim())]),
);
function psSnapshot() {
  return new Promise((resolve) => {
    execFile('ps', ['-Ao', 'pid=,ppid=,%cpu=,comm='], (err, out) => {
      if (err) return resolve(null);
      const rows = out
        .trim()
        .split('\n')
        .map((l) => {
          const m = l.trim().match(/^(\d+)\s+(\d+)\s+([\d.]+)\s+(.*)$/);
          return m && { pid: +m[1], ppid: +m[2], cpu: +m[3], comm: m[4] };
        })
        .filter(Boolean);
      const byParent = new Map();
      for (const r of rows) {
        if (!byParent.has(r.ppid)) byParent.set(r.ppid, []);
        byParent.get(r.ppid).push(r);
      }
      const result = {};
      for (const t of TARGETS) {
        const seen = new Set();
        const stack = [roots[t]];
        let total = 0;
        let gpu = 0;
        while (stack.length) {
          const pid = stack.pop();
          if (seen.has(pid)) continue;
          seen.add(pid);
          const row = rows.find((r) => r.pid === pid);
          if (row) {
            total += row.cpu;
            if (/GPU/i.test(row.comm)) gpu += row.cpu;
          }
          for (const child of byParent.get(pid) ?? []) stack.push(child.pid);
        }
        result[t] = { total, gpu };
      }
      resolve(result);
    });
  });
}

// ---- in-page tour driver ----
// Teleport through the game's OWN dev command path (sim.chat routes it to the
// server when online, to the local sim offline). Raw pos writes get snapped
// back by the server on PBE. Camera state is client-side input, safe to write.
async function teleport(page, wp, label) {
  await page.evaluate((p) => {
    const g = window.__game;
    g.sim.chat(`/dev tp ${p.x} ${p.z}`);
    g.input.camYaw = p.yaw;
    g.input.camPitch = p.pitch;
    g.input.camDist = p.dist;
    if (g.renderer) g.renderer.camDist = p.dist;
  }, wp);
  // confirm arrival (server round-trip online); warn rather than fail so a
  // rejected command still produces labeled (if stationary) samples
  const arrived = await page
    .waitForFunction(
      (p) => {
        const pos = window.__game?.sim?.player?.pos;
        return pos && Math.hypot(pos.x - p.x, pos.z - p.z) < 8;
      },
      { timeout: 10000 },
      wp,
    )
    .then(() => true)
    .catch(() => false);
  if (!arrived) console.log(`WARN ${label}: teleport to ${wp.name} not confirmed`);
  return arrived;
}

function samplePhase(page, phase) {
  // returns the array of rAF deltas for the phase; orbit spins camYaw, run
  // walks the player forward along the camera bearing at ~5 u/s (loads
  // streaming chunks and decoration churn like real movement)
  return page.evaluate(
    async (ms, orbitRate, run) => {
      return await new Promise((resolve) => {
        const g = window.__game;
        const deltas = [];
        let last = performance.now();
        const t0 = last;
        const step = (t) => {
          const dt = (t - last) / 1000;
          deltas.push(t - last);
          last = t;
          if (g?.input && orbitRate) g.input.camYaw += dt * orbitRate;
          if (t - t0 < ms) requestAnimationFrame(step);
          else resolve(deltas);
        };
        requestAnimationFrame(step);
      });
    },
    phase.ms,
    phase.orbit,
    phase.run,
  );
}

function stats(deltas) {
  // trim the first 1.5s: teleport/streaming settle and rAF warmup, which
  // otherwise dominate the 1% lows with one-off hitches
  let acc = 0;
  let cut = 0;
  while (cut < deltas.length && acc < 1500) acc += deltas[cut++];
  const d = deltas.slice(cut).sort((a, b) => a - b);
  if (!d.length) return null;
  const avg = d.reduce((a, b) => a + b, 0) / d.length;
  const p = (q) => d[Math.min(d.length - 1, Math.floor(d.length * q))];
  return {
    avgFps: 1000 / avg,
    onePctLowFps: 1000 / p(0.99),
    p95ms: p(0.95),
    worstMs: d[d.length - 1],
  };
}

// ---- connect and wait for both worlds ----
const pages = {};
for (const t of TARGETS) {
  const ws = fs.readFileSync(`tmp/fps-live-${t}.ws`, 'utf8').trim();
  const browser = await puppeteer.connect({ browserWSEndpoint: ws, defaultViewport: null });
  const all = await browser.pages();
  pages[t] = all.find((p) => /worldofclaudecraft|localhost/.test(p.url())) ?? all[all.length - 1];
  console.log(`${t}: connected (${pages[t].url()})`);
}
console.log('waiting for both worlds (log in + enter world in each window)...');
const t0 = Date.now();
for (;;) {
  const ready = {};
  for (const t of TARGETS) {
    ready[t] = await pages[t]
      .evaluate(() => Boolean(window.__game?.sim?.player))
      .catch(() => false);
  }
  if (TARGETS.every((t) => ready[t])) break;
  if (Date.now() - t0 > WAIT_INWORLD_MS) {
    console.log(`timed out waiting; in-world: ${JSON.stringify(ready)}`);
    process.exit(1);
  }
  await sleep(3000);
}
console.log('both in-world; tour starting.');

// ---- the synchronized tour ----
const results = [];
const cpuSamples = { pbe2: [], local: [] };
const cpuTimer = setInterval(async () => {
  const snap = await psSnapshot();
  if (snap) for (const t of TARGETS) cpuSamples[t].push(snap[t]);
}, 1000);

for (const wp of WAYPOINTS) {
  await Promise.all(TARGETS.map((t) => teleport(pages[t], wp, t)));
  await sleep(SETTLE_MS);
  for (const phase of PHASES) {
    const cpuMark = Object.fromEntries(TARGETS.map((t) => [t, cpuSamples[t].length]));
    // run = REAL key input via CDP (drives the client's own movement online
    // and offline); focus the canvas first so the key events land
    if (phase.run)
      await Promise.all(
        TARGETS.map(async (t) => {
          await pages[t].bringToFront().catch(() => {});
          await pages[t].keyboard.down('KeyW').catch(() => {});
        }),
      );
    const deltas = await Promise.all(TARGETS.map((t) => samplePhase(pages[t], phase)));
    if (phase.run)
      await Promise.all(TARGETS.map((t) => pages[t].keyboard.up('KeyW').catch(() => {})));
    TARGETS.forEach((t, i) => {
      const cpu = cpuSamples[t].slice(cpuMark[t]);
      const cpuAvg = cpu.length ? cpu.reduce((a, b) => a + b.total, 0) / cpu.length : null;
      const gpuAvg = cpu.length ? cpu.reduce((a, b) => a + b.gpu, 0) / cpu.length : null;
      results.push({
        target: t,
        waypoint: wp.name,
        phase: phase.name,
        ...stats(deltas[i]),
        cpuPct: cpuAvg,
        gpuHelperPct: gpuAvg,
      });
    });
    const line = TARGETS.map((t, i) => {
      const s = stats(deltas[i]);
      return `${t} ${s.avgFps.toFixed(1)}fps/1%${s.onePctLowFps.toFixed(0)}`;
    }).join('  vs  ');
    console.log(`${wp.name.padEnd(8)} ${phase.name.padEnd(6)} ${line}`);
  }
}
clearInterval(cpuTimer);

fs.writeFileSync('tmp/fps-live-results.json', JSON.stringify(results, null, 2));
console.log('\nwritten tmp/fps-live-results.json');
process.exit(0);
