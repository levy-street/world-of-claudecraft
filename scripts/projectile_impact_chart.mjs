// Before/after proof for the "projectiles deal damage on impact" change.
//
// Drives the REAL offline Sim in Node (no browser): a level-20 mage casts an
// instant Fire Blast at a fat dummy 20 yards away and we record the tick the
// target's HP actually drops. BEFORE the change the sim was hitscan (damage on
// the cast tick, tick 0) while the renderer flew the bolt at PROJECTILE_SPEED
// yd/s; AFTER, the damage lands on the tick the bolt arrives, in step with the
// visual. The chart draws both timelines so the old mismatch (damage marker at
// the caster while the bolt is still mid-flight) is obvious.
//
// Pure Node + rsvg-convert (no puppeteer / chromium profile gotchas). Run with:
//   npx tsx scripts/projectile_impact_chart.mjs
// Writes docs/screenshots/projectile-damage-on-impact.png.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { PROJECTILE_SPEED } from '../src/sim/projectile_travel.ts';
import { Sim } from '../src/sim/sim.ts';
import { terrainHeight } from '../src/sim/world.ts';

const DIST = 20; // yards between caster and target

// --- Drive the real sim to get the authentic impact tick + damage ---------
function measure() {
  const sim = new Sim({ seed: 7, playerClass: 'mage', autoEquip: true });
  sim.setPlayerLevel(20);
  const p = sim.player;
  p.hp = p.maxHp;
  p.resource = p.maxResource;
  let target = null;
  for (const e of sim.entities.values())
    if (e.kind === 'mob' && !e.dead) {
      target = e;
      break;
    }
  const place = (e, x, z) => {
    e.pos.x = x;
    e.pos.z = z;
    e.pos.y = terrainHeight(x, z, sim.cfg.seed);
    e.prevPos = { ...e.pos };
  };
  place(p, p.pos.x, p.pos.z);
  place(target, p.pos.x, p.pos.z + DIST);
  target.hp = target.maxHp = 100000;
  p.facing = Math.atan2(target.pos.x - p.pos.x, target.pos.z - p.pos.z);
  p.targetId = target.id;
  const start = target.hp;
  sim.castAbility('fire_blast'); // instant: schedules the bolt this tick
  for (let i = 0; i < 60; i++) {
    sim.tick();
    if (target.hp < start) return { landTick: i + 1, dmg: start - target.hp };
  }
  return { landTick: -1, dmg: 0 };
}

const { landTick, dmg } = measure();
// Flight time is whatever the homing bolt actually took to reach the target in the sim.
const travelSec = landTick > 0 ? landTick / 20 : 0;
const ticks = Math.max(landTick, 16);

// --- Render the SVG --------------------------------------------------------
const W = 1180;
const H = 620;
const PADX = 140;
const trackW = W - PADX - 120;
const xAt = (t) => PADX + (t / ticks) * trackW;

const COL = {
  bg: '#11151c',
  panel: '#161c25',
  grid: '#2c3a4a',
  axis: '#39414f',
  text: '#e8edf4',
  sub: '#9aa6b8',
  bolt: '#e8a23a',
  before: '#e85d5d',
  after: '#4ad07a',
  caster: '#6fb6ff',
  target: '#cdd6e3',
};

function lane(yTop, label, dmgTick, dmgColor, note) {
  const yMid = yTop + 54;
  const bolts = [0, 0.25, 0.5, 0.75, 1].map((f) => {
    const t = f * landTick;
    return `<circle cx="${xAt(t).toFixed(1)}" cy="${yMid}" r="${(4 + f * 5).toFixed(1)}" fill="${COL.bolt}" opacity="${(0.25 + f * 0.6).toFixed(2)}"/>`;
  });
  const burstX = xAt(dmgTick);
  return `
  <g>
    <text x="${PADX}" y="${yTop - 10}" fill="${COL.text}" font-size="20" font-weight="600">${label}</text>
    <line x1="${PADX}" y1="${yMid}" x2="${PADX + trackW}" y2="${yMid}" stroke="${COL.axis}" stroke-width="2"/>
    <circle cx="${PADX}" cy="${yMid}" r="9" fill="${COL.caster}"/>
    <text x="${PADX}" y="${yMid + 30}" fill="${COL.sub}" font-size="13" text-anchor="middle">caster</text>
    <circle cx="${PADX + trackW}" cy="${yMid}" r="11" fill="${COL.target}"/>
    <text x="${PADX + trackW}" y="${yMid + 30}" fill="${COL.sub}" font-size="13" text-anchor="middle">target</text>
    ${bolts.join('\n    ')}
    <g>
      <line x1="${burstX.toFixed(1)}" y1="${yMid - 40}" x2="${burstX.toFixed(1)}" y2="${yMid + 40}" stroke="${dmgColor}" stroke-width="2.5" stroke-dasharray="5 4"/>
      <circle cx="${burstX.toFixed(1)}" cy="${yMid}" r="16" fill="none" stroke="${dmgColor}" stroke-width="3"/>
      <text x="${burstX.toFixed(1)}" y="${yMid - 48}" fill="${dmgColor}" font-size="16" font-weight="700" text-anchor="middle">-${dmg} dmg</text>
    </g>
    <text x="${PADX}" y="${yTop + 96}" fill="${COL.sub}" font-size="14">${note}</text>
  </g>`;
}

const gridX = [];
for (let t = 0; t <= ticks; t += 4) {
  const xx = xAt(t);
  gridX.push(
    `<line x1="${xx.toFixed(1)}" y1="120" x2="${xx.toFixed(1)}" y2="${H - 70}" stroke="${COL.grid}" stroke-width="1" opacity="0.5"/>` +
      `<text x="${xx.toFixed(1)}" y="${H - 44}" fill="${COL.sub}" font-size="13" text-anchor="middle">${t}t / ${(t / 20).toFixed(2)}s</text>`,
  );
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect x="0" y="0" width="${W}" height="${H}" fill="${COL.bg}"/>
  <rect x="40" y="40" width="${W - 80}" height="${H - 80}" rx="10" fill="${COL.panel}" stroke="${COL.grid}"/>
  <text x="${PADX}" y="78" fill="${COL.text}" font-size="26" font-weight="700">Projectiles deal damage on impact, not on cast</text>
  <text x="${PADX}" y="104" fill="${COL.sub}" font-size="15">Fire Blast at ${DIST} yd · bolt speed ${PROJECTILE_SPEED} yd/s · flight ${travelSec.toFixed(2)}s (${landTick} ticks at 20 Hz)</text>
  ${gridX.join('\n  ')}
  ${lane(180, 'BEFORE (hitscan)', 0, COL.before, 'Damage landed on the cast tick while the bolt was still leaving the caster: the number popped before the visual arrived.')}
  ${lane(360, 'AFTER (on impact)', landTick, COL.after, 'Damage lands on the tick the bolt reaches the target, in step with the renderer. A target that dies mid-flight fizzles the bolt.')}
</svg>`;

fs.mkdirSync('docs/screenshots', { recursive: true });
const out = 'docs/screenshots/projectile-damage-on-impact.png';
fs.writeFileSync('tmp-projectile.svg', svg);
execFileSync('rsvg-convert', ['-o', out, 'tmp-projectile.svg']);
fs.rmSync('tmp-projectile.svg');
console.log(`wrote ${out} (impact tick ${landTick}, ${dmg} dmg, ${travelSec.toFixed(3)}s flight)`);
