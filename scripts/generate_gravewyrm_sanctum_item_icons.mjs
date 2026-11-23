// scripts/generate_gravewyrm_sanctum_item_icons.mjs
// Generates the shipping 128x128 WebP item icons for the Gravewyrm Sanctum
// rework's loot (src/sim/content/gravewyrm_sanctum_items.ts and the three
// trinkets in src/sim/content/trinkets.ts). Same recipe as
// generate_wildheart_basin_item_icons.mjs: an authored SVG composition per item
// over a three-stop radial ground, rasterized with Sharp, meeting the
// woc-item-icon-v1 contract (opaque dark vignette, warm top-left key light,
// cool bottom-right shadow, centered silhouette with safe padding, distinct art
// per item). The palette is the Ice Tomb's own (gravewyrm_sanctum.md section
// 8): glacier blue, rime white, the Smith's blue runes, the cult's goad red,
// black iron, soulfire violet-green, dark meltwater and the Wyrm's rose-gold
// heart-shard. The script IS the retained source: re-running it reproduces
// every file byte for byte. It never touches mapping.json; the generated batch
// entry there is hand-authored (batch gravewyrm-sanctum-icons-2026-10-03) with
// its provenance README under docs/achievements/gravewyrm-sanctum-icons-2026-10-03/.
//
// Usage: node scripts/generate_gravewyrm_sanctum_item_icons.mjs

import path from 'node:path';
import sharp from 'sharp';

const repoRoot = process.cwd();
const itemsDir = path.join(repoRoot, 'public/ui/items');
const OUT_PX = 128;
const MASTER_PX = 512;

const DEFS = `
  <linearGradient id="ice" x1="0%" y1="0%" x2="100%" y2="100%">
    <stop offset="0%" stop-color="#f2fbff" />
    <stop offset="45%" stop-color="#8fc8e6" />
    <stop offset="100%" stop-color="#1e4a66" />
  </linearGradient>
  <linearGradient id="iron" x1="0%" y1="0%" x2="100%" y2="100%">
    <stop offset="0%" stop-color="#9aa2aa" />
    <stop offset="45%" stop-color="#454b52" />
    <stop offset="100%" stop-color="#14171a" />
  </linearGradient>
  <linearGradient id="mail" x1="0%" y1="0%" x2="100%" y2="100%">
    <stop offset="0%" stop-color="#c4ccd2" />
    <stop offset="45%" stop-color="#5e6870" />
    <stop offset="100%" stop-color="#1a1e22" />
  </linearGradient>
  <linearGradient id="leather" x1="0%" y1="0%" x2="100%" y2="100%">
    <stop offset="0%" stop-color="#b48a62" />
    <stop offset="50%" stop-color="#6a4428" />
    <stop offset="100%" stop-color="#2a180c" />
  </linearGradient>
  <linearGradient id="fur" x1="0%" y1="0%" x2="100%" y2="100%">
    <stop offset="0%" stop-color="#6a6670" />
    <stop offset="50%" stop-color="#2c2a30" />
    <stop offset="100%" stop-color="#0c0b0e" />
  </linearGradient>
  <linearGradient id="violet" x1="0%" y1="0%" x2="100%" y2="100%">
    <stop offset="0%" stop-color="#c8a0e8" />
    <stop offset="45%" stop-color="#6a3a8e" />
    <stop offset="100%" stop-color="#22102e" />
  </linearGradient>
  <linearGradient id="goad" x1="0%" y1="0%" x2="100%" y2="100%">
    <stop offset="0%" stop-color="#ff9a7a" />
    <stop offset="50%" stop-color="#b8321e" />
    <stop offset="100%" stop-color="#3e0c06" />
  </linearGradient>
  <linearGradient id="gold" x1="0%" y1="0%" x2="100%" y2="100%">
    <stop offset="0%" stop-color="#fff0c8" />
    <stop offset="45%" stop-color="#d4a650" />
    <stop offset="100%" stop-color="#5a3c10" />
  </linearGradient>
  <linearGradient id="water" x1="0%" y1="0%" x2="0%" y2="100%">
    <stop offset="0%" stop-color="#6ab0d0" />
    <stop offset="50%" stop-color="#1c4a64" />
    <stop offset="100%" stop-color="#081822" />
  </linearGradient>
  <radialGradient id="rune" cx="50%" cy="50%" r="50%">
    <stop offset="0%" stop-color="#e8f8ff" stop-opacity="0.95" />
    <stop offset="50%" stop-color="#4ab0ff" stop-opacity="0.45" />
    <stop offset="100%" stop-color="#4ab0ff" stop-opacity="0" />
  </radialGradient>
  <radialGradient id="soulfire" cx="50%" cy="50%" r="50%">
    <stop offset="0%" stop-color="#f0fff0" stop-opacity="0.95" />
    <stop offset="40%" stop-color="#9af0a0" stop-opacity="0.6" />
    <stop offset="75%" stop-color="#9a5ae0" stop-opacity="0.3" />
    <stop offset="100%" stop-color="#9a5ae0" stop-opacity="0" />
  </radialGradient>
  <radialGradient id="shard" cx="50%" cy="50%" r="50%">
    <stop offset="0%" stop-color="#fff4e8" stop-opacity="0.95" />
    <stop offset="50%" stop-color="#f0a080" stop-opacity="0.5" />
    <stop offset="100%" stop-color="#f0a080" stop-opacity="0" />
  </radialGradient>
`;

/** Mail rings: a grid of small circles inside a rectangle. */
function mailRings(x0, y0, x1, y1, step = 6) {
  let out = '';
  let row = 0;
  for (let y = y0; y <= y1; y += step, row++) {
    for (let x = x0 + (row % 2 ? step / 2 : 0); x <= x1; x += step) {
      out += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.1" fill="none" stroke="#dce4ea" stroke-width="0.8" opacity="0.5" />`;
    }
  }
  return out;
}

/** Rime: a crust of small white ice crystals along a line. */
function rime(points) {
  return points
    .map(
      ([x, y, s = 1]) =>
        `<path d="M ${x} ${y - 5 * s} L ${x + 2 * s} ${y} L ${x} ${y + 3 * s} L ${x - 2 * s} ${y} Z" fill="#f2fbff" opacity="0.85" />`,
    )
    .join('');
}

/** A chain of `n` iron links from (x0, y0) to (x1, y1). */
function chain(x0, y0, x1, y1, n, w = 7, h = 4.4) {
  let out = '';
  const ang = (Math.atan2(y1 - y0, x1 - x0) * 180) / Math.PI;
  for (let i = 0; i < n; i++) {
    const t = n > 1 ? i / (n - 1) : 0;
    const x = x0 + (x1 - x0) * t;
    const y = y0 + (y1 - y0) * t;
    const r = i % 2 ? ang + 90 : ang;
    out += `<ellipse cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" rx="${w}" ry="${h}" fill="none" stroke="url(#iron)" stroke-width="2.6" transform="rotate(${r.toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)})" />`;
  }
  return out;
}

const SHADOW = (d) => `<path d="${d}" fill="#000" opacity="0.35" transform="translate(4 4)" />`;

const ITEMS_TO_GENERATE = [
  // ---- Korgath the Bound ----
  {
    id: 'foremans_grips',
    bgDark: '#06080a',
    bgMid: '#1a2430',
    bgGlow: '#3a5a74',
    svgArt: `
      <!-- A giant's mail work gauntlet, a broken shackle cuff round the wrist
           and one of the Smith's blue runes on the back of the hand -->
      ${SHADOW('M 40 20 L 84 20 L 92 64 L 88 100 L 44 104 L 34 64 Z')}
      <path d="M 40 20 L 84 20 L 92 64 L 88 100 L 44 104 L 34 64 Z" fill="url(#mail)" stroke="#101418" stroke-width="1.8" />
      ${mailRings(42, 26, 84, 58)}
      <path d="M 44 20 L 44 8 M 56 20 L 56 6 M 68 20 L 68 6 M 80 20 L 80 9" stroke="url(#iron)" stroke-width="9" stroke-linecap="round" />
      <path d="M 30 76 L 98 76 L 96 98 L 32 98 Z" fill="url(#iron)" stroke="#0c0e10" stroke-width="1.8" />
      <path d="M 96 82 L 108 78 L 110 90 L 98 94" fill="none" stroke="url(#iron)" stroke-width="3" />
      <circle cx="64" cy="44" r="13" fill="url(#rune)" />
      <path d="M 58 38 L 70 38 L 64 50 Z M 64 34 L 64 54" stroke="#e8f8ff" stroke-width="1.6" fill="none" />
      ${rime([
        [34, 80],
        [46, 77],
        [84, 77, 0.8],
        [94, 82],
      ])}
    `,
  },
  {
    id: 'serac_stride_boots',
    bgDark: '#06080a',
    bgMid: '#162636',
    bgGlow: '#4a7090',
    svgArt: `
      <!-- A tall leather boot laced with frost, iron crampon spikes under the
           sole and a jag of serac ice behind it -->
      <path d="M 82 14 L 112 54 L 96 60 Z" fill="url(#ice)" opacity="0.7" />
      <path d="M 92 30 L 116 76 L 100 78 Z" fill="url(#ice)" opacity="0.5" />
      ${SHADOW('M 46 14 L 74 14 L 76 70 Q 104 74 108 92 L 108 100 L 30 100 L 32 70 Z')}
      <path d="M 46 14 L 74 14 L 76 70 Q 104 74 108 92 L 108 100 L 30 100 L 32 70 Z" fill="url(#leather)" stroke="#1a0e06" stroke-width="1.8" />
      <path d="M 44 14 L 76 14 L 76 22 L 44 22 Z" fill="url(#fur)" />
      <path d="M 50 30 L 70 36 M 70 30 L 50 36 M 50 44 L 70 50 M 70 44 L 50 50 M 50 58 L 70 64 M 70 58 L 50 64" stroke="#d8eef8" stroke-width="1.4" />
      <path d="M 30 100 L 108 100 L 108 106 L 30 106 Z" fill="url(#iron)" />
      ${[36, 50, 64, 78, 92, 104].map((x) => `<path d="M ${x - 3} 106 L ${x} 116 L ${x + 3} 106 Z" fill="url(#iron)" stroke="#0c0e10" stroke-width="0.6" />`).join('')}
      ${rime([
        [80, 74],
        [92, 78],
        [102, 86, 0.8],
      ])}
    `,
  },
  {
    id: 'seal_rune_mantle',
    bgDark: '#060810',
    bgMid: '#141e34',
    bgGlow: '#34507a',
    svgArt: `
      <!-- A cloth shoulder mantle of deep blue, its hem stitched with the
           four seal-tool runes, a rime crust along the top -->
      ${SHADOW('M 18 58 Q 30 26 64 24 Q 98 26 110 58 L 100 86 Q 64 74 28 86 Z')}
      <path d="M 18 58 Q 30 26 64 24 Q 98 26 110 58 L 100 86 Q 64 74 28 86 Z" fill="#20345a" stroke="#0a1020" stroke-width="1.8" />
      <path d="M 28 52 Q 40 34 64 32 Q 88 34 100 52" stroke="#3a5a8a" stroke-width="5" fill="none" />
      <path d="M 28 86 Q 64 74 100 86 L 102 96 Q 64 84 26 96 Z" fill="url(#gold)" stroke="#3a2a08" stroke-width="1" />
      ${[
        [38, 62],
        [54, 58],
        [74, 58],
        [90, 62],
      ]
        .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="7" fill="url(#rune)" />`)
        .join('')}
      <path d="M 34 60 L 42 60 M 38 56 L 38 66" stroke="#e8f8ff" stroke-width="1.6" />
      <path d="M 50 54 L 58 62 M 58 54 L 50 62" stroke="#e8f8ff" stroke-width="1.6" />
      <path d="M 70 62 L 78 62 L 76 56 L 72 56 Z" stroke="#e8f8ff" stroke-width="1.4" fill="none" />
      <path d="M 86 58 Q 90 54 94 58 Q 90 66 86 58 Z" stroke="#e8f8ff" stroke-width="1.4" fill="none" />
      ${rime([
        [30, 40],
        [42, 31],
        [56, 27],
        [72, 27],
        [86, 31],
        [98, 40],
      ])}
    `,
  },
  // ---- Grand Necromancer Velkhar ----
  {
    id: 'thawbound_legguards',
    bgDark: '#06080a',
    bgMid: '#14262c',
    bgGlow: '#2e5a62',
    svgArt: `
      <!-- Mail legguards half sheathed in melting ice, meltwater running down
           the greaves -->
      ${SHADOW('M 34 14 L 94 14 L 92 38 L 84 112 L 68 112 L 64 46 L 60 112 L 44 112 L 36 38 Z')}
      <path d="M 34 14 L 94 14 L 92 38 L 84 112 L 68 112 L 64 46 L 60 112 L 44 112 L 36 38 Z" fill="url(#mail)" stroke="#101418" stroke-width="1.8" />
      ${mailRings(40, 22, 88, 44)}
      <path d="M 34 14 L 94 14 L 94 22 L 34 22 Z" fill="url(#leather)" />
      <path d="M 40 60 L 60 60 L 58 92 L 44 92 Z" fill="url(#ice)" opacity="0.75" stroke="#c8ecff" stroke-width="0.8" />
      <path d="M 68 60 L 88 60 L 84 84 L 70 84 Z" fill="url(#ice)" opacity="0.6" stroke="#c8ecff" stroke-width="0.8" />
      <path d="M 50 92 Q 51 100 50 106 M 54 92 Q 56 98 55 104 M 76 84 Q 77 94 76 100" stroke="#8fd8ff" stroke-width="1.6" fill="none" />
      <circle cx="50" cy="108" r="1.8" fill="#8fd8ff" /><circle cx="76" cy="103" r="1.8" fill="#8fd8ff" />
    `,
  },
  {
    id: 'pyre_tenders_hood',
    bgDark: '#08060a',
    bgMid: '#22142a',
    bgGlow: '#4a2e5a',
    svgArt: `
      <!-- A soot-blackened leather hood, a strip of cloth mask across the face
           and a soulfire ember glowing in its shadow -->
      ${SHADOW('M 64 12 Q 102 22 104 70 L 96 108 L 32 108 L 24 70 Q 26 22 64 12 Z')}
      <path d="M 64 12 Q 102 22 104 70 L 96 108 L 32 108 L 24 70 Q 26 22 64 12 Z" fill="url(#leather)" stroke="#140a04" stroke-width="1.8" />
      <path d="M 64 30 Q 88 38 88 70 L 84 96 L 44 96 L 40 70 Q 40 38 64 30 Z" fill="#0a0608" />
      <circle cx="64" cy="66" r="20" fill="url(#soulfire)" />
      <path d="M 42 76 L 86 76 L 84 90 L 44 90 Z" fill="#3a2a30" stroke="#140a0c" stroke-width="1" />
      <circle cx="56" cy="62" r="2.4" fill="#d8ffd8" /><circle cx="72" cy="62" r="2.4" fill="#d8ffd8" />
      <path d="M 28 52 Q 40 44 50 46 M 100 52 Q 88 44 78 46" stroke="#1a1006" stroke-width="2.4" fill="none" opacity="0.7" />
      <path d="M 32 108 L 96 108 L 100 116 L 28 116 Z" fill="url(#fur)" />
    `,
  },
  {
    id: 'meltwater_cord',
    bgDark: '#04080c',
    bgMid: '#10222e',
    bgGlow: '#245066',
    svgArt: `
      <!-- A braided cloth cord knotted round a glass bead of dark meltwater,
           two tasselled ends dripping -->
      ${SHADOW('M 12 56 Q 64 44 116 56 L 116 70 Q 64 58 12 70 Z')}
      <path d="M 12 56 Q 64 44 116 56 L 116 70 Q 64 58 12 70 Z" fill="#2a4a6a" stroke="#0a1420" stroke-width="1.6" />
      ${[20, 32, 44, 84, 96, 108].map((x) => `<path d="M ${x} 52 L ${x + 6} 68" stroke="#6a8aaa" stroke-width="1.6" />`).join('')}
      <path d="M 52 64 Q 44 84 40 104 M 76 64 Q 84 84 88 104" stroke="#2a4a6a" stroke-width="4" fill="none" />
      <path d="M 36 102 L 44 102 L 42 112 L 38 112 Z M 84 102 L 92 102 L 90 112 L 86 112 Z" fill="url(#violet)" />
      <circle cx="64" cy="60" r="15" fill="url(#water)" stroke="#c8ecff" stroke-width="1.6" />
      <ellipse cx="59" cy="54" rx="4" ry="3" fill="#f2fbff" opacity="0.7" />
      <circle cx="40" cy="117" r="1.8" fill="#8fd8ff" /><circle cx="88" cy="117" r="1.8" fill="#8fd8ff" />
    `,
  },
  // ---- Heroic epics ----
  {
    id: 'hammer_of_the_open_lock',
    bgDark: '#060708',
    bgMid: '#1c2228',
    bgGlow: '#3e5466',
    svgArt: `
      <!-- The Smith's forge hammer: a massive iron head wound with a broken
           chain, its face cut with a glowing open-lock rune -->
      ${SHADOW('M 58 44 L 70 44 L 72 118 L 56 118 Z')}
      <path d="M 58 44 L 70 44 L 72 118 L 56 118 Z" fill="url(#leather)" stroke="#140a04" stroke-width="1.6" />
      ${[56, 70, 84, 98].map((y) => `<path d="M 57 ${y} L 71 ${y + 5}" stroke="#2a180c" stroke-width="1.6" />`).join('')}
      ${SHADOW('M 18 14 L 110 14 L 110 50 L 18 50 Z')}
      <path d="M 18 14 L 110 14 L 110 50 L 18 50 Z" fill="url(#iron)" stroke="#0a0c0e" stroke-width="2" />
      <path d="M 18 14 L 10 20 L 10 44 L 18 50 Z M 110 14 L 118 20 L 118 44 L 110 50 Z" fill="#2a3036" stroke="#0a0c0e" stroke-width="1.4" />
      <circle cx="64" cy="32" r="14" fill="url(#rune)" />
      <path d="M 58 34 L 70 34 L 70 42 L 58 42 Z M 60 34 Q 60 24 66 24 Q 70 24 70 28" stroke="#e8f8ff" stroke-width="1.8" fill="none" />
      ${chain(22, 52, 44, 74, 4)}
      <path d="M 44 74 L 50 80 M 46 72 L 52 76" stroke="#9aa2aa" stroke-width="1.6" />
      ${rime([
        [24, 16],
        [40, 15],
        [88, 15],
        [104, 16],
      ])}
    `,
  },
  {
    id: 'vestments_of_the_waking_rite',
    bgDark: '#07050a',
    bgMid: '#1e1230',
    bgGlow: '#4a2e70',
    svgArt: `
      <!-- Violet rite robes with a black fur mantle: frost crusting one
           shoulder, ember-cracked iron on the other, a soulfire sigil on the
           breast -->
      ${SHADOW('M 36 18 L 92 18 L 104 44 L 98 112 L 30 112 L 24 44 Z')}
      <path d="M 36 18 L 92 18 L 104 44 L 98 112 L 30 112 L 24 44 Z" fill="url(#violet)" stroke="#12081a" stroke-width="1.8" />
      <path d="M 30 112 L 98 112 L 96 104 L 32 104 Z" fill="#1a0e10" />
      <path d="M 60 30 L 68 30 L 68 112 L 60 112 Z" fill="#141018" />
      ${[44, 58, 72, 86].map((y) => `<path d="M 61 ${y} L 67 ${y}" stroke="url(#gold)" stroke-width="1.4" />`).join('')}
      <path d="M 26 20 Q 64 36 102 20 L 104 34 Q 64 48 24 34 Z" fill="url(#fur)" />
      <path d="M 20 30 L 40 22 L 44 42 L 24 46 Z" fill="url(#ice)" stroke="#c8ecff" stroke-width="0.8" />
      ${rime([
        [24, 28],
        [32, 24],
        [40, 26],
      ])}
      <path d="M 88 22 L 108 30 L 104 46 L 84 42 Z" fill="url(#iron)" stroke="#0a0c0e" stroke-width="1" />
      <path d="M 92 30 L 98 36 L 96 42 M 100 32 L 102 40" stroke="#ff8a4a" stroke-width="1.4" fill="none" />
      <circle cx="46" cy="70" r="13" fill="url(#soulfire)" />
      <path d="M 46 62 L 52 72 L 46 80 L 40 72 Z" stroke="#e0ffe0" stroke-width="1.4" fill="none" />
    `,
  },
  // ---- Trinkets ----
  {
    id: 'foremans_last_link',
    bgDark: '#06080a',
    bgMid: '#1a2026',
    bgGlow: '#3a4e5e',
    svgArt: `
      <!-- One great iron chain link struck through by a cult goad-brand, the
           Smith's rune half burned away under it -->
      ${SHADOW('M 64 16 Q 100 16 100 50 L 100 78 Q 100 112 64 112 Q 28 112 28 78 L 28 50 Q 28 16 64 16 Z')}
      <path d="M 64 16 Q 100 16 100 50 L 100 78 Q 100 112 64 112 Q 28 112 28 78 L 28 50 Q 28 16 64 16 Z" fill="none" stroke="url(#iron)" stroke-width="15" />
      <path d="M 64 16 Q 100 16 100 50 L 100 78 Q 100 112 64 112 Q 28 112 28 78 L 28 50 Q 28 16 64 16 Z" fill="none" stroke="#0a0c0e" stroke-width="1.6" />
      <circle cx="64" cy="64" r="16" fill="url(#rune)" />
      <path d="M 58 58 L 70 58 L 64 72 Z" stroke="#e8f8ff" stroke-width="1.6" fill="none" />
      <path d="M 20 96 L 104 30" stroke="url(#goad)" stroke-width="5" stroke-linecap="round" />
      <circle cx="104" cy="30" r="5" fill="#ff7a4a" />
      ${chain(10, 64, 18, 64, 2, 5, 3)}${chain(110, 64, 118, 64, 2, 5, 3)}
      ${rime([
        [40, 26],
        [86, 26],
        [36, 104, 0.8],
      ])}
    `,
  },
  {
    id: 'phial_of_the_tithe',
    bgDark: '#08060a',
    bgMid: '#1e1428',
    bgGlow: '#44305e',
    svgArt: `
      <!-- A narrow glass phial in a black-iron cage, swirling with stolen
           soulfire, a wax tithe seal on the stopper -->
      <circle cx="64" cy="70" r="36" fill="url(#soulfire)" opacity="0.6" />
      ${SHADOW('M 52 34 L 76 34 L 82 50 Q 92 64 88 90 Q 84 110 64 112 Q 44 110 40 90 Q 36 64 46 50 Z')}
      <path d="M 52 34 L 76 34 L 82 50 Q 92 64 88 90 Q 84 110 64 112 Q 44 110 40 90 Q 36 64 46 50 Z" fill="#16241e" stroke="#c8f0ff" stroke-width="1.6" opacity="0.95" />
      <path d="M 44 80 Q 64 70 86 80 Q 86 106 64 108 Q 42 106 44 80 Z" fill="url(#soulfire)" />
      <path d="M 50 92 Q 60 82 70 92 Q 78 100 66 102" stroke="#e0ffe0" stroke-width="1.4" fill="none" />
      ${[48, 64, 80].map((x) => `<path d="M ${x} 38 Q ${x + (x - 64) * 0.4} 76 ${x} 110" stroke="url(#iron)" stroke-width="2.6" fill="none" />`).join('')}
      <path d="M 50 22 L 78 22 L 76 36 L 52 36 Z" fill="url(#iron)" stroke="#0a0c0e" stroke-width="1.4" />
      <circle cx="64" cy="18" r="8" fill="url(#goad)" stroke="#3e0c06" stroke-width="1.2" />
      <path d="M 60 18 L 68 18 M 64 14 L 64 22" stroke="#ffd0c0" stroke-width="1.2" />
    `,
  },
  {
    id: 'quenchwater_flask',
    bgDark: '#04080c',
    bgMid: '#10202e',
    bgGlow: '#2a5a7a',
    svgArt: `
      <!-- A squat smith's flask of hammered iron and glass, brimming with the
           Quench's black water; a red-hot blade tip hisses into it in steam -->
      ${SHADOW('M 40 46 L 88 46 Q 104 62 102 86 Q 98 112 64 112 Q 30 112 26 86 Q 24 62 40 46 Z')}
      <path d="M 40 46 L 88 46 Q 104 62 102 86 Q 98 112 64 112 Q 30 112 26 86 Q 24 62 40 46 Z" fill="url(#iron)" stroke="#0a0c0e" stroke-width="1.8" />
      <path d="M 36 66 Q 64 58 92 66 Q 98 98 64 104 Q 30 98 36 66 Z" fill="url(#water)" stroke="#8fd8ff" stroke-width="1.2" />
      <path d="M 50 30 L 78 30 L 80 46 L 48 46 Z" fill="url(#mail)" stroke="#101418" stroke-width="1.4" />
      <path d="M 56 14 L 62 14 L 66 50" stroke="#ffb070" stroke-width="5" stroke-linecap="round" />
      <path d="M 66 50 L 64 60" stroke="#ff5a2a" stroke-width="5" stroke-linecap="round" />
      <path d="M 54 56 Q 48 46 54 38 M 74 56 Q 82 46 76 36 M 64 54 Q 60 40 66 30" stroke="#f2fbff" stroke-width="2" fill="none" opacity="0.6" />
      ${rime([
        [32, 72],
        [96, 72],
        [40, 104, 0.8],
        [88, 104, 0.8],
      ])}
    `,
  },
];

function composeSvg(item, px) {
  return `
      <svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 128 128">
        <defs>
          <radialGradient id="bgGrad" cx="38%" cy="32%" r="72%">
            <stop offset="0%" stop-color="${item.bgGlow}" />
            <stop offset="50%" stop-color="${item.bgMid}" />
            <stop offset="100%" stop-color="${item.bgDark}" />
          </radialGradient>
          <radialGradient id="shade" cx="78%" cy="80%" r="60%">
            <stop offset="0%" stop-color="#0a1830" stop-opacity="0.35" />
            <stop offset="100%" stop-color="#0a1830" stop-opacity="0" />
          </radialGradient>
          ${DEFS}
          <filter id="grain" x="0" y="0" width="100%" height="100%">
            <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="17" />
            <feColorMatrix type="matrix" values="0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 0.22 0" />
          </filter>
          <filter id="soft"><feGaussianBlur stdDeviation="0.35" /></filter>
        </defs>
        <rect width="128" height="128" fill="url(#bgGrad)" />
        <g filter="url(#soft)" transform="translate(64 66) scale(${item.scale ?? 1.05}) translate(-64 -66)">${item.svgArt}</g>
        <rect width="128" height="128" fill="url(#shade)" />
        <rect width="128" height="128" filter="url(#grain)" style="mix-blend-mode: overlay" />
      </svg>
    `;
}

async function main() {
  console.log(`Generating ${ITEMS_TO_GENERATE.length} Gravewyrm Sanctum WebP icons...`);
  for (const item of ITEMS_TO_GENERATE) {
    const destFile = path.join(itemsDir, `${item.id}.webp`);
    // Rasterize at the 512 master size, then downscale to the shipping 128.
    await sharp(Buffer.from(composeSvg(item, MASTER_PX)))
      .resize(OUT_PX, OUT_PX)
      .flatten({ background: item.bgDark })
      .webp({ quality: 85, effort: 6 })
      .toFile(destFile);
    console.log(`Generated: ${item.id}.webp`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
