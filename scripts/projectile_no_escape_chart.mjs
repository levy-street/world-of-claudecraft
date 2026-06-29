// Proof for the "a released projectile cannot be escaped" follow-up.
//
// Drives the REAL projectile homing logic (src/sim/projectile_travel.ts) in Node:
// one bolt is launched at a target that immediately kites directly away FASTER than
// the bolt (PROJECTILE_SPEED + 5 yd/s), so the homing can never physically catch it.
// We record the bolt-to-target distance every tick and the tick the bolt resolves.
// Before this change the bolt fizzled at the PROJECTILE_MAX_FLIGHT deadline (no
// damage: the target escaped by outrunning it); after, the bolt LANDS by force at
// that same deadline, so the only way to avoid a projectile is to be out of cast
// range when it fires, not to outrun it after launch.
//
// Pure Node + rsvg-convert (no puppeteer / chromium profile gotchas). Run with:
//   npx tsx scripts/projectile_no_escape_chart.mjs
// Writes docs/screenshots/projectile-no-escape.png.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import {
  advancePendingProjectiles,
  PROJECTILE_MAX_FLIGHT,
  PROJECTILE_SPEED,
  scheduleProjectile,
} from '../src/sim/projectile_travel.ts';
import { DT } from '../src/sim/types.ts';

// --- Drive the real homing logic with a target kiting faster than the bolt ----
function measure() {
  const entities = new Map();
  const ctx = { time: 0, entities, pendingProjectiles: [] };
  const src = { id: 1, dead: false, pos: { x: 0, y: 0, z: 0 } };
  const tgt = { id: 2, dead: false, pos: { x: 0, y: 0, z: 10 } };
  entities.set(1, src);
  entities.set(2, tgt);
  let landTick = -1;
  scheduleProjectile(ctx, src, tgt, () => {
    landTick = tick;
  });
  const samples = [{ t: 0, gap: tgt.pos.z }];
  let tick = 0;
  for (let i = 1; i <= 200 && ctx.pendingProjectiles.length; i++) {
    tick = i;
    tgt.pos.z += (PROJECTILE_SPEED + 5) * DT; // flees faster than the bolt: never caught
    advancePendingProjectiles(ctx);
    const bolt = ctx.pendingProjectiles[0];
    const gap = bolt ? tgt.pos.z - bolt.z : 0; // bolt-to-target distance this tick
    samples.push({ t: i, gap: Math.max(0, gap) });
  }
  return { landTick, samples };
}

const { landTick, samples } = measure();
const deadlineTick = Math.round(PROJECTILE_MAX_FLIGHT / DT);
const ticks = Math.max(landTick, deadlineTick) + 2;
const maxGap = Math.max(...samples.map((s) => s.gap), 1);

// --- Render the SVG -----------------------------------------------------------
const W = 1180;
const H = 560;
const PADX = 150;
const PADTOP = 150;
const trackW = W - PADX - 120;
const trackH = H - PADTOP - 110;
const xAt = (t) => PADX + (t / ticks) * trackW;
const yAt = (g) => PADTOP + trackH - (g / maxGap) * trackH;

const COL = {
  bg: '#11151c',
  panel: '#161c25',
  grid: '#2c3a4a',
  axis: '#39414f',
  text: '#e8edf4',
  sub: '#9aa6b8',
  line: '#e8a23a',
  land: '#4ad07a',
};

const gridX = [];
for (let t = 0; t <= ticks; t += 8) {
  const xx = xAt(t);
  gridX.push(
    `<line x1="${xx.toFixed(1)}" y1="${PADTOP}" x2="${xx.toFixed(1)}" y2="${PADTOP + trackH}" stroke="${COL.grid}" stroke-width="1" opacity="0.5"/>` +
      `<text x="${xx.toFixed(1)}" y="${PADTOP + trackH + 28}" fill="${COL.sub}" font-size="13" text-anchor="middle">${t}t / ${(t / 20).toFixed(1)}s</text>`,
  );
}

const path = samples
  .map((s, i) => `${i === 0 ? 'M' : 'L'} ${xAt(s.t).toFixed(1)} ${yAt(s.gap).toFixed(1)}`)
  .join(' ');

const landX = xAt(landTick);
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect x="0" y="0" width="${W}" height="${H}" fill="${COL.bg}"/>
  <rect x="40" y="40" width="${W - 80}" height="${H - 80}" rx="10" fill="${COL.panel}" stroke="${COL.grid}"/>
  <text x="${PADX}" y="80" fill="${COL.text}" font-size="26" font-weight="700">A released projectile cannot be escaped</text>
  <text x="${PADX}" y="106" fill="${COL.sub}" font-size="15">Target kites directly away at ${PROJECTILE_SPEED + 5} yd/s, faster than the ${PROJECTILE_SPEED} yd/s bolt: the homing never physically catches it.</text>
  <text x="${PADX}" y="128" fill="${COL.sub}" font-size="15">The bolt lands by force at the ${PROJECTILE_MAX_FLIGHT}s flight deadline (tick ${landTick}) instead of fizzling. The only escape is being out of cast range when it fires.</text>
  ${gridX.join('\n  ')}
  <line x1="${PADX}" y1="${PADTOP + trackH}" x2="${PADX + trackW}" y2="${PADTOP + trackH}" stroke="${COL.axis}" stroke-width="2"/>
  <text x="${PADX - 12}" y="${PADTOP + 6}" fill="${COL.sub}" font-size="13" text-anchor="end">${maxGap.toFixed(0)} yd</text>
  <text x="${PADX - 12}" y="${PADTOP + trackH}" fill="${COL.sub}" font-size="13" text-anchor="end">0</text>
  <text x="${PADX - 12}" y="${PADTOP + trackH / 2}" fill="${COL.sub}" font-size="13" text-anchor="end" transform="rotate(-90 ${PADX - 40} ${PADTOP + trackH / 2})">bolt-to-target gap</text>
  <path d="${path}" fill="none" stroke="${COL.line}" stroke-width="3"/>
  <g>
    <line x1="${landX.toFixed(1)}" y1="${PADTOP}" x2="${landX.toFixed(1)}" y2="${PADTOP + trackH}" stroke="${COL.land}" stroke-width="2.5" stroke-dasharray="5 4"/>
    <circle cx="${landX.toFixed(1)}" cy="${yAt(samples[samples.length - 1].gap).toFixed(1)}" r="14" fill="none" stroke="${COL.land}" stroke-width="3"/>
    <text x="${landX.toFixed(1)}" y="${PADTOP - 10}" fill="${COL.land}" font-size="16" font-weight="700" text-anchor="middle">lands by force (tick ${landTick})</text>
  </g>
</svg>`;

fs.mkdirSync('docs/screenshots', { recursive: true });
const out = 'docs/screenshots/projectile-no-escape.png';
fs.writeFileSync('tmp-no-escape.svg', svg);
execFileSync('rsvg-convert', ['-o', out, 'tmp-no-escape.svg']);
fs.rmSync('tmp-no-escape.svg');
console.log(`wrote ${out} (lands by force at tick ${landTick}, deadline ~${deadlineTick})`);
