// Before/after trajectory chart for the net-interpolation jitter-resilience
// fix (src/net/entity_reanchor.ts). The bug is a TEMPORAL artifact (a
// discontinuity in a remote entity's rendered position over time): a single
// still frame looks identical before and after, so a conventional in-game
// screenshot cannot show it. This instead drives the REAL production
// interpolation math directly (remoteEntityAlpha from
// src/render/net_interp_core.ts, unmodified) against two reanchor policies:
// the CURRENT one (entity_reanchor.ts, imported live) and the removed
// pre-fix one (reconstructed below, byte-for-byte from the diff, for
// comparison only), then renders the two resulting position-over-time
// trajectories as an SVG chart, screenshotted to PNG via headless Chrome
// (no npm run dev / server needed; nothing here touches the game client).
//
// Run: npx tsx scripts/net_interp_jitter_chart.mjs
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { reanchorDecision } from '../src/net/entity_reanchor.ts';
import { remoteEntityAlpha } from '../src/render/net_interp_core.ts';
import { BROWSER_PATH } from './browser_path.mjs';

// --- The removed pre-fix reanchor logic (src/net/online.ts, before this PR) ---
// A flat distance threshold, ignoring elapsed time; interval learning ignored
// any gap outside a fixed 5-450 ms band. Reproduced only so the "before" line
// reflects the actual removed behavior, not a guess.
const OLD_TELEPORT_SNAP_DIST_SQ = 40 * 40;
function oldReanchorDecision({ gapMs, deltaSq, prevInterval, reviveEdge }) {
  const snap = reviveEdge || deltaSq > OLD_TELEPORT_SNAP_DIST_SQ;
  let netInterval;
  if (gapMs !== undefined && gapMs > 5 && gapMs < 450) {
    netInterval = prevInterval === undefined ? gapMs : prevInterval * 0.7 + gapMs * 0.3;
  }
  return { snap, netInterval };
}

// --- Scenario: a mounted entity moving at a steady ~22.5 yd/s, then a 2s
// network gap (a jitter spike), covering 45yd during the gap: legitimate
// movement, well under any real teleport, but over the OLD flat 40yd
// threshold. ---
const SPEED_YD_S = 22.5;
const REGULAR_STEP_MS = 120;
const GAP_MS = 2000;
const STEPS_BEFORE_GAP = 3;

function buildSnapshotSchedule() {
  const schedule = [];
  let t = 0;
  let x = 0;
  for (let i = 0; i <= STEPS_BEFORE_GAP; i++) {
    schedule.push({ t, x });
    t += REGULAR_STEP_MS;
    x += (SPEED_YD_S * REGULAR_STEP_MS) / 1000;
  }
  // the gap: no update for GAP_MS, then resume from wherever steady movement
  // would have put the entity
  t = schedule[schedule.length - 1].t + GAP_MS;
  x = schedule[schedule.length - 1].x + (SPEED_YD_S * GAP_MS) / 1000;
  schedule.push({ t, x });
  // two more regular steps after resume, to show recovery
  for (let i = 0; i < 2; i++) {
    t += REGULAR_STEP_MS;
    x += (SPEED_YD_S * REGULAR_STEP_MS) / 1000;
    schedule.push({ t, x });
  }
  return schedule;
}

// Simulates ClientWorld.applyWire's reanchor step (prevPos/pos/netUpdatedAt/
// netInterval bookkeeping) plus per-frame rendering via the REAL
// remoteEntityAlpha, for one of the two decision policies. Returns sampled
// (timeMs, renderedX) points at a fixed render cadence.
function simulate(decisionFn, schedule) {
  let prevPos = 0;
  let pos = 0;
  let netUpdatedAt;
  let netInterval;
  const wireEvents = schedule.map((s) => ({ ...s }));
  const samples = [];
  const RENDER_DT = 16.7;
  const endT = wireEvents[wireEvents.length - 1].t + 600;

  let nextEventIdx = 0;
  for (let now = 0; now <= endT; now += RENDER_DT) {
    while (nextEventIdx < wireEvents.length && wireEvents[nextEventIdx].t <= now) {
      const ev = wireEvents[nextEventIdx];
      const gapMs = netUpdatedAt !== undefined ? ev.t - netUpdatedAt : undefined;
      const deltaSq = (ev.x - pos) * (ev.x - pos);
      const { snap, netInterval: learned } = decisionFn({
        gapMs,
        deltaSq,
        prevInterval: netInterval,
        reviveEdge: false,
      });
      if (learned !== undefined) netInterval = learned;
      // mirror online.ts's entAlpha-at-reanchor-time formula (the glide blend)
      const entAlpha =
        netUpdatedAt !== undefined
          ? Math.min(
              netInterval === undefined ? 1 : 1.25,
              (ev.t - netUpdatedAt) / Math.max(20, netInterval ?? 120),
            )
          : 1;
      netUpdatedAt = ev.t;
      if (snap) {
        prevPos = ev.x;
      } else {
        prevPos = prevPos + (pos - prevPos) * entAlpha;
      }
      pos = ev.x;
      nextEventIdx++;
    }
    const alpha = remoteEntityAlpha(now, netUpdatedAt, netInterval, 0);
    const renderedX = prevPos + (pos - prevPos) * alpha;
    samples.push({ t: now, x: renderedX });
  }
  return samples;
}

const schedule = buildSnapshotSchedule();
const before = simulate(oldReanchorDecision, schedule);
const after = simulate(reanchorDecision, schedule);
const gapEndT = schedule[STEPS_BEFORE_GAP + 1].t;

console.log(`Scenario: ${SPEED_YD_S} yd/s mover, ${GAP_MS}ms gap, resumes at t=${gapEndT}ms`);
console.log(
  `Delta over the gap: ${(schedule[STEPS_BEFORE_GAP + 1].x - schedule[STEPS_BEFORE_GAP].x).toFixed(1)}yd ` +
    `(old flat threshold: ${Math.sqrt(OLD_TELEPORT_SNAP_DIST_SQ).toFixed(0)}yd)`,
);

// --- SVG chart ---
const W = 1100,
  H = 560,
  padL = 70,
  padR = 40,
  padT = 130,
  padB = 60;
const gapDeltaYd = schedule[STEPS_BEFORE_GAP + 1].x - schedule[STEPS_BEFORE_GAP].x;
const maxT = Math.max(...before.map((p) => p.t), ...after.map((p) => p.t));
const maxX = Math.max(...before.map((p) => p.x), ...after.map((p) => p.x)) * 1.05;
const sx = (t) => padL + (t / maxT) * (W - padL - padR);
const sy = (x) => H - padB - (x / maxX) * (H - padT - padB);
const toPath = (pts) =>
  pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${sx(p.t).toFixed(1)},${sy(p.x).toFixed(1)}`).join(' ');

const gridLinesY = Array.from({ length: 6 }, (_, i) => (maxX / 5) * i);
const legendY = padT - 46;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" font-family="Menlo, Consolas, monospace">
  <rect width="${W}" height="${H}" fill="#12141a"/>
  <text x="${padL}" y="34" fill="#e8e8ec" font-size="21" font-weight="bold">Remote-entity rendered X position across a 2s network gap</text>
  <text x="${padL}" y="56" fill="#9aa0ac" font-size="13">A mounted mover at ${SPEED_YD_S} yd/s covers ${gapDeltaYd.toFixed(0)}yd DURING the gap alone (legitimate movement) but past the OLD flat ${Math.sqrt(OLD_TELEPORT_SNAP_DIST_SQ).toFixed(0)}yd snap threshold</text>
  <line x1="${padL}" y1="${legendY}" x2="${padL + 30}" y2="${legendY}" stroke="#ef6a6a" stroke-width="3"/>
  <text x="${padL + 38}" y="${legendY + 5}" fill="#e8e8ec" font-size="13">before: hard pop (flat 40yd snap threshold)</text>
  <line x1="${padL}" y1="${legendY + 22}" x2="${padL + 30}" y2="${legendY + 22}" stroke="#5ac8a8" stroke-width="3"/>
  <text x="${padL + 38}" y="${legendY + 27}" fill="#e8e8ec" font-size="13">after: bounded glide (src/net/entity_reanchor.ts)</text>
  ${gridLinesY.map((gy) => `<line x1="${padL}" y1="${sy(gy).toFixed(1)}" x2="${W - padR}" y2="${sy(gy).toFixed(1)}" stroke="#2a2d38" stroke-width="1"/><text x="${padL - 10}" y="${(sy(gy) + 4).toFixed(1)}" fill="#7d8290" font-size="12" text-anchor="end">${gy.toFixed(0)}yd</text>`).join('\n  ')}
  <line x1="${sx(gapEndT).toFixed(1)}" y1="${padT}" x2="${sx(gapEndT).toFixed(1)}" y2="${H - padB}" stroke="#565c6b" stroke-width="1" stroke-dasharray="4,4"/>
  <text x="${sx(gapEndT).toFixed(1)}" y="${padT - 8}" fill="#9aa0ac" font-size="12" text-anchor="middle">snapshot resumes</text>
  <path d="${toPath(before)}" fill="none" stroke="#ef6a6a" stroke-width="2.5"/>
  <path d="${toPath(after)}" fill="none" stroke="#5ac8a8" stroke-width="2.5"/>
  <text x="${padL}" y="${H - 20}" fill="#7d8290" font-size="12">${(gapEndT - GAP_MS).toFixed(0)}ms of regular ~120ms updates -&gt; ${GAP_MS}ms network gap -&gt; resume (time, ms)</text>
</svg>`;

const outDir = path.resolve('docs/screenshots/net-interp-jitter-resilience');
fs.mkdirSync(outDir, { recursive: true });
const svgPath = path.join(outDir, 'trajectory-before-after.svg');
fs.writeFileSync(svgPath, svg);

const browser = await puppeteer.launch({ executablePath: BROWSER_PATH, headless: 'new' });
const page = await browser.newPage();
await page.setContent(`<!doctype html><html><body style="margin:0">${svg}</body></html>`);
const svgHandle = await page.$('svg');
if (!svgHandle) throw new Error('svg element not found after setContent');
const pngPath = path.join(outDir, 'trajectory-before-after.png');
await svgHandle.screenshot({ path: pngPath });
await browser.close();

console.log(`Wrote ${svgPath}`);
console.log(`Wrote ${pngPath}`);
