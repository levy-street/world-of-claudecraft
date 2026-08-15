// Thornhollow Fields blueprint: a top-down, annotated map diagram generated FROM the
// authoritative layout record (src/sim/battleground_layout.ts) plus the zone
// bands (src/render/battleground_core.ts), so the diagram can never drift from
// what players actually collide with. Emits SVG, then rasterizes to PNG via
// headless Chrome for the PR/docs image.
//
// Run (tsx resolves the .ts imports):
//   npx tsx scripts/assets/ravenrift_blueprint.mjs
// Output:
//   docs/screenshots/ravenrift-battleground/blueprint.png (and .svg beside it)
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import {
  BG_ZONE_KEEP_MIN_Z,
  BG_ZONE_MID_HALF_Z,
  isRuinBlock,
} from '../../src/render/battleground_core.ts';
import {
  BG_BASES,
  BG_COVER_CRATES,
  BG_COVER_PILLARS,
  BG_HALF_X,
  BG_HALF_Z,
  BG_POWER_RUNES,
  BG_SPEED_RUNES,
  battlegroundWallSegments,
} from '../../src/sim/battleground_layout.ts';
import { BROWSER_PATH } from '../browser_path.mjs';

const OUT_DIR = 'docs/screenshots/ravenrift-battleground';
const SCALE = 6; // px per yard
// Wide side gutters so every callout label lands OUTSIDE the field, clear of
// both the walls and the legend.
const MARGIN_L = 275;
const MARGIN_R = 235;
const MARGIN_T = 110;
const MARGIN_B = 120;
const LEGEND_W = 310;

const CRIMSON = '#d1413a';
const AZURE = '#3a78d1';
const GOLD = '#ffd24a';
const WALL = '#2c3444';
const PAPER = '#f3ead8';
const INK = '#3a3020';

// world (x,z) -> svg (px). North (+z, the Azure keep) is up.
const W = BG_HALF_X * 2 * SCALE + MARGIN_L + MARGIN_R + LEGEND_W;
const H = BG_HALF_Z * 2 * SCALE + MARGIN_T + MARGIN_B;
const sx = (x) => MARGIN_L + (x + BG_HALF_X) * SCALE;
const sy = (z) => MARGIN_T + (BG_HALF_Z - z) * SCALE;

const parts = [];
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

function rect(x, z, hw, hd, fill, opacity = 1, rx = 0) {
  parts.push(
    `<rect x="${sx(x - hw)}" y="${sy(z + hd)}" width="${hw * 2 * SCALE}" height="${hd * 2 * SCALE}" fill="${fill}" opacity="${opacity}"${rx ? ` rx="${rx}"` : ''}/>`,
  );
}

function circle(x, z, r, fill, stroke = null) {
  parts.push(
    `<circle cx="${sx(x)}" cy="${sy(z)}" r="${r * SCALE}" fill="${fill}"${stroke ? ` stroke="${stroke}" stroke-width="2"` : ''}/>`,
  );
}

function label(x, z, text, size = 15, color = INK, anchor = 'middle', weight = 600) {
  parts.push(
    `<text x="${sx(x)}" y="${sy(z)}" font-size="${size}" fill="${color}" text-anchor="${anchor}" font-weight="${weight}" font-family="Georgia, serif">${esc(text)}</text>`,
  );
}

function callout(x, z, tx, tz, text, color = INK) {
  parts.push(
    `<line x1="${sx(x)}" y1="${sy(z)}" x2="${sx(tx)}" y2="${sy(tz)}" stroke="${color}" stroke-width="1.4" stroke-dasharray="4 3"/>`,
  );
  label(tx, tz + (tz > z ? 1.2 : -1.8), text, 14, color, tx < x ? 'end' : 'start');
}

// ---- paper + zone bands ----------------------------------------------------
parts.push(`<rect width="${W}" height="${H}" fill="${PAPER}"/>`);
rect(
  0,
  (BG_HALF_Z + BG_ZONE_KEEP_MIN_Z) / -2,
  BG_HALF_X,
  (BG_HALF_Z - BG_ZONE_KEEP_MIN_Z) / 2,
  CRIMSON,
  0.1,
);
rect(
  0,
  (BG_HALF_Z + BG_ZONE_KEEP_MIN_Z) / 2,
  BG_HALF_X,
  (BG_HALF_Z - BG_ZONE_KEEP_MIN_Z) / 2,
  AZURE,
  0.1,
);
rect(0, 0, BG_HALF_X, BG_ZONE_MID_HALF_Z, '#5e7a3a', 0.12);

// the ~120yd view-distance ring from each flag stand: what one player can
// see; the rest of the map is fog until you travel
for (const base of BG_BASES) {
  const color = base.team === 0 ? CRIMSON : AZURE;
  parts.push(
    `<circle cx="${sx(base.flag.x)}" cy="${sy(base.flag.z)}" r="${120 * SCALE}" fill="none" stroke="${color}" stroke-width="1.6" stroke-dasharray="8 6" opacity="0.45"/>`,
  );
}

// ---- walls (perimeter + sealed keeps + curtains + gatehouses) --------------
const LOW_WALL = '#7d6a52';
for (const s of battlegroundWallSegments()) {
  const ruin = isRuinBlock(s);
  const fill = s.low ? LOW_WALL : ruin ? '#6b5b45' : WALL;
  rect(s.x, s.z, s.hw, s.hd, fill, ruin ? 0.85 : 1, 2);
}
for (const p of BG_COVER_PILLARS) circle(p.x, p.z, 1.0, WALL);
for (const c of BG_COVER_CRATES) rect(c.x, c.z, 0.9, 0.9, '#8a6a3c', 1, 2);

// ---- flags, spawns, banners, runes ----------------------------------------
for (const base of BG_BASES) {
  const color = base.team === 0 ? CRIMSON : AZURE;
  circle(base.flag.x, base.flag.z, 1.6, color, INK);
  // a little flag glyph on the stand
  const fx = sx(base.flag.x);
  const fy = sy(base.flag.z);
  parts.push(
    `<line x1="${fx}" y1="${fy}" x2="${fx}" y2="${fy - 26}" stroke="${INK}" stroke-width="3"/>`,
    `<path d="M ${fx} ${fy - 26} h 18 l -5 6 5 6 h -18 z" fill="${color}" stroke="${INK}" stroke-width="1"/>`,
  );
  for (const sp of base.spawns) circle(sp.x, sp.z, 0.55, color);
  for (const bx of [-9, 9]) {
    parts.push(
      `<path d="M ${sx(base.banner.x + bx)} ${sy(base.banner.z) - 8} l 6 14 h -12 z" fill="${color}" opacity="0.85"/>`,
    );
  }
}
for (const r of [...BG_SPEED_RUNES, ...BG_POWER_RUNES]) {
  circle(r.x, r.z, 1.1, 'none', GOLD);
  circle(r.x, r.z, 0.5, GOLD);
}

// ---- annotations (labels live in the side gutters, clear of the field) -----
label(0, BG_HALF_Z + 11, 'THORNHOLLOW FIELDS', 26, INK);
label(
  0,
  BG_HALF_Z + 6,
  `${BG_HALF_X * 2} x ${BG_HALF_Z * 2} yards, walled and open-air. North is up.`,
  14,
  '#6b5b45',
);
label(0, 124, 'AZURE KEEP', 16, AZURE);
label(0, -126, 'CRIMSON KEEP', 16, CRIMSON);
label(0, 76, 'AZURE FIELD', 18, AZURE, 'middle', 700);
label(0, -78, 'CRIMSON FIELD', 18, CRIMSON, 'middle', 700);
label(0, 36, 'THE RUIN COURTYARD', 18, '#5e7a3a', 'middle', 700);
callout(2, 118, 54, 114, 'flag stand + capture point', AZURE);
callout(3.5, 122, 54, 122, 'spawn ring (wave respawn)', AZURE);
callout(0, 91, 54, 89, 'flag-approach rune', '#8a6a3c');
callout(38, 0, 54, -3, 'flank rune + cover', '#8a6a3c');
callout(-38, 0, -54, 3, 'flank rune + cover', '#8a6a3c');
callout(8, 4, 54, 10, 'heart ruin 16x16 (hollow)', '#6b5b45');
callout(16, 22, 54, 28, 'sightline breakers (two pairs)', INK);
callout(13, -56, 54, -60, 'main gate (10yd)', INK);
callout(-26, -56, -54, -50, 'gatehouse (offset doors)', INK);
callout(-26, -58, -54, -62, 'ambush crates', '#8a6a3c');
callout(-30, -98, -54, -96, 'wing baffle', INK);
callout(10, -84, 54, -82, 'staggered S-approach walls', INK);
callout(-3, -106, -54, -108, 'mouth barricade (low wall)', LOW_WALL);
callout(-9, -128, -54, -132, 'keep banner poles', CRIMSON);
callout(0, -2, -54, -30, 'view-distance ring: ~120yd of', AZURE);
label(-54, -34.5, 'fog; enemies fade in', 14, AZURE, 'end');
label(
  0,
  -(BG_HALF_Z + 9),
  'Every move between chambers passes a crossing: the main gate or the gatehouse jog.',
  13.5,
  '#6b5b45',
);
label(
  0,
  -(BG_HALF_Z + 13),
  'The whole map is point-symmetric, so neither side is favored. The sim tracks the whole match;',
  13.5,
  '#6b5b45',
);
label(
  0,
  -(BG_HALF_Z + 17),
  'the client sees to ~120yd with distance fog, like the open world.',
  13.5,
  '#6b5b45',
);

// ---- legend ----------------------------------------------------------------
const lx = MARGIN_L + BG_HALF_X * 2 * SCALE + MARGIN_R + 10;
let ly = MARGIN_T + 20;
parts.push(
  `<rect x="${lx - 16}" y="${ly - 26}" width="${LEGEND_W - 30}" height="422" fill="#fff" opacity="0.55" rx="10"/>`,
);
const legend = (draw, text) => {
  parts.push(draw(lx, ly));
  parts.push(
    `<text x="${lx + 26}" y="${ly + 5}" font-size="14.5" fill="${INK}" font-family="Georgia, serif">${esc(text)}</text>`,
  );
  ly += 30;
};
parts.push(
  `<text x="${lx - 2}" y="${ly - 2}" font-size="18" font-weight="700" fill="${INK}" font-family="Georgia, serif">Legend</text>`,
);
ly += 28;
legend(
  (x, y) => `<rect x="${x}" y="${y - 7}" width="18" height="14" fill="${WALL}" rx="2"/>`,
  'wall (blocks movement + sight)',
);
legend(
  (x, y) => `<rect x="${x}" y="${y - 7}" width="18" height="14" fill="#6b5b45" rx="2"/>`,
  'heart ruin (solid block, hollow shell)',
);
legend(
  (x, y) => `<rect x="${x}" y="${y - 4}" width="18" height="8" fill="${LOW_WALL}" rx="2"/>`,
  'low barricade (blocks movement)',
);
legend((x, y) => `<circle cx="${x + 9}" cy="${y}" r="7" fill="${WALL}"/>`, 'pillar');
legend(
  (x, y) => `<rect x="${x + 2}" y="${y - 7}" width="14" height="14" fill="#8a6a3c" rx="2"/>`,
  'crate stack',
);
legend(
  (x, y) =>
    `<circle cx="${x + 9}" cy="${y}" r="8" fill="${CRIMSON}" stroke="${INK}" stroke-width="2"/>`,
  'flag stand (Crimson / Azure)',
);
legend(
  (x, y) => `<circle cx="${x + 9}" cy="${y}" r="4" fill="${AZURE}"/>`,
  'spawn point (5 per keep)',
);
legend(
  (x, y) => `<path d="M ${x + 3} ${y - 8} l 6 14 h -12 z" fill="${AZURE}" opacity="0.85"/>`,
  'keep banner pole',
);
legend(
  (x, y) =>
    `<g><circle cx="${x + 9}" cy="${y}" r="8" fill="none" stroke="${GOLD}" stroke-width="2"/><circle cx="${x + 9}" cy="${y}" r="3.5" fill="${GOLD}"/></g>`,
  'speed rune (1.4x for 8s, 22s recharge)',
);
legend(
  (x, y) =>
    `<rect x="${x}" y="${y - 7}" width="18" height="14" fill="${CRIMSON}" opacity="0.2" rx="2"/>`,
  'keep grounds (garrison theme)',
);
legend(
  (x, y) =>
    `<rect x="${x}" y="${y - 7}" width="18" height="14" fill="#5e7a3a" opacity="0.25" rx="2"/>`,
  'ruin courtyard (overgrown theme)',
);
legend(
  (x, y) =>
    `<line x1="${x}" y1="${y}" x2="${x + 18}" y2="${y}" stroke="${INK}" stroke-width="1.4" stroke-dasharray="4 3"/>`,
  'annotation',
);

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${parts.join('')}</svg>`;

fs.mkdirSync(OUT_DIR, { recursive: true });
const svgPath = path.join(OUT_DIR, 'blueprint.svg');
fs.writeFileSync(svgPath, svg);
console.log(`wrote ${svgPath}`);

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
  defaultViewport: { width: W, height: H, deviceScaleFactor: 2 },
});
const page = await browser.newPage();
await page.goto(`data:text/html,<body style="margin:0">${encodeURIComponent(svg)}</body>`);
const pngPath = path.join(OUT_DIR, 'blueprint.png');
await page.screenshot({ path: pngPath, clip: { x: 0, y: 0, width: W, height: H } });
await browser.close();
console.log(`wrote ${pngPath}`);
