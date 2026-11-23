// scripts/generate_wildheart_basin_item_icons.mjs
// Generates the shipping 128x128 WebP item icons for the Wildheart Basin
// rework's loot (src/sim/content/wildheart_items.ts and the two trinkets in
// src/sim/content/trinkets.ts): an authored SVG composition per item over a
// three-stop radial ground, rasterized with Sharp, meeting the
// woc-item-icon-v1 contract (opaque dark vignette, warm top-left key light,
// cool bottom-right shadow, centered silhouette with safe padding, distinct art
// per item). The palette is the basin's own (wildheart_basin.md section 7):
// jade canopy, moss, wet basalt, sunbone ochre, troll war red, waterfall
// white-cyan, the Gorgebloom's pollen yellow and Zulgar's jade spirit flame.
// The Heroic Falls-Blessed Staff is a weapon, so it aliases its base art like
// every heroic weapon variant and gets no file here. The script IS the
// retained source: re-running it reproduces every file byte for byte. It never
// touches mapping.json; the generated batch entry there is hand-authored (batch
// wildheart-basin-icons-2026-10-02) with its provenance README under
// docs/achievements/wildheart-basin-icons-2026-10-02/.
//
// Usage: node scripts/generate_wildheart_basin_item_icons.mjs

import path from 'node:path';
import sharp from 'sharp';

const repoRoot = process.cwd();
const itemsDir = path.join(repoRoot, 'public/ui/items');
const OUT_PX = 128;
const MASTER_PX = 512;

// Shared material gradients: jade, moss, basalt, sunbone, troll red, pollen,
// hide leather, mail, bloomsilk, river wood, and the spirit-flame glow.
const DEFS = `
  <linearGradient id="jade" x1="0%" y1="0%" x2="100%" y2="100%">
    <stop offset="0%" stop-color="#bdf5d6" />
    <stop offset="45%" stop-color="#3f7d4e" />
    <stop offset="100%" stop-color="#12301c" />
  </linearGradient>
  <linearGradient id="moss" x1="0%" y1="0%" x2="100%" y2="100%">
    <stop offset="0%" stop-color="#c3d68a" />
    <stop offset="50%" stop-color="#6c8a3a" />
    <stop offset="100%" stop-color="#25320e" />
  </linearGradient>
  <linearGradient id="basalt" x1="0%" y1="0%" x2="100%" y2="100%">
    <stop offset="0%" stop-color="#8a948a" />
    <stop offset="45%" stop-color="#3a3f3a" />
    <stop offset="100%" stop-color="#121512" />
  </linearGradient>
  <linearGradient id="sunbone" x1="0%" y1="0%" x2="100%" y2="100%">
    <stop offset="0%" stop-color="#fff2cc" />
    <stop offset="45%" stop-color="#d9b26a" />
    <stop offset="100%" stop-color="#5a4218" />
  </linearGradient>
  <linearGradient id="trollred" x1="0%" y1="0%" x2="100%" y2="100%">
    <stop offset="0%" stop-color="#f08a7a" />
    <stop offset="50%" stop-color="#a3322a" />
    <stop offset="100%" stop-color="#3e0e0a" />
  </linearGradient>
  <linearGradient id="pollen" x1="0%" y1="0%" x2="100%" y2="100%">
    <stop offset="0%" stop-color="#fffbc8" />
    <stop offset="50%" stop-color="#e8e05a" />
    <stop offset="100%" stop-color="#6a6418" />
  </linearGradient>
  <linearGradient id="hide" x1="0%" y1="0%" x2="100%" y2="100%">
    <stop offset="0%" stop-color="#f0c878" />
    <stop offset="50%" stop-color="#c08a3a" />
    <stop offset="100%" stop-color="#4a2c0c" />
  </linearGradient>
  <linearGradient id="leather" x1="0%" y1="0%" x2="100%" y2="100%">
    <stop offset="0%" stop-color="#b78556" />
    <stop offset="50%" stop-color="#6e4526" />
    <stop offset="100%" stop-color="#2e1a0c" />
  </linearGradient>
  <linearGradient id="mail" x1="0%" y1="0%" x2="100%" y2="100%">
    <stop offset="0%" stop-color="#b8c0b4" />
    <stop offset="45%" stop-color="#5e665a" />
    <stop offset="100%" stop-color="#1c201a" />
  </linearGradient>
  <linearGradient id="bloomsilk" x1="0%" y1="0%" x2="100%" y2="100%">
    <stop offset="0%" stop-color="#fbe6f0" />
    <stop offset="45%" stop-color="#d77fa4" />
    <stop offset="100%" stop-color="#4a1a32" />
  </linearGradient>
  <linearGradient id="wood" x1="0%" y1="0%" x2="100%" y2="100%">
    <stop offset="0%" stop-color="#a47a4e" />
    <stop offset="55%" stop-color="#5a3b20" />
    <stop offset="100%" stop-color="#24160a" />
  </linearGradient>
  <linearGradient id="falls" x1="0%" y1="0%" x2="0%" y2="100%">
    <stop offset="0%" stop-color="#ffffff" />
    <stop offset="50%" stop-color="#ddf3f2" />
    <stop offset="100%" stop-color="#5fb8c8" />
  </linearGradient>
  <radialGradient id="spirit" cx="50%" cy="50%" r="50%">
    <stop offset="0%" stop-color="#eafff4" stop-opacity="0.95" />
    <stop offset="50%" stop-color="#5fe0a0" stop-opacity="0.45" />
    <stop offset="100%" stop-color="#5fe0a0" stop-opacity="0" />
  </radialGradient>
  <radialGradient id="pollenglow" cx="50%" cy="50%" r="50%">
    <stop offset="0%" stop-color="#fffbe0" stop-opacity="0.9" />
    <stop offset="55%" stop-color="#e8e05a" stop-opacity="0.35" />
    <stop offset="100%" stop-color="#e8e05a" stop-opacity="0" />
  </radialGradient>
`;

/** Mail rings: a grid of small circles inside a rectangle. */
function mailRings(x0, y0, x1, y1, step = 6) {
  let out = '';
  let row = 0;
  for (let y = y0; y <= y1; y += step, row++) {
    for (let x = x0 + (row % 2 ? step / 2 : 0); x <= x1; x += step) {
      out += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.1" fill="none" stroke="#d6dcd0" stroke-width="0.8" opacity="0.55" />`;
    }
  }
  return out;
}

/** Jaguar rosettes: small broken rings scattered over a hide. */
function rosettes(points) {
  return points
    .map(
      ([x, y, r = 3.4]) =>
        `<circle cx="${x}" cy="${y}" r="${r}" fill="#3a2008" opacity="0.25" /><circle cx="${x}" cy="${y}" r="${r}" fill="none" stroke="#2a1606" stroke-width="1.5" stroke-dasharray="4 2" />`,
    )
    .join('');
}

/** A curling vine from (x0, y0) to (x1, y1) with a few leaves. */
function vine(x0, y0, x1, y1, leaves = 3, color = 'url(#moss)') {
  const mx = (x0 + x1) / 2 + (y1 - y0) * 0.25;
  const my = (y0 + y1) / 2 - (x1 - x0) * 0.25;
  let out = `<path d="M ${x0} ${y0} Q ${mx.toFixed(1)} ${my.toFixed(1)} ${x1} ${y1}" stroke="#2a3a12" stroke-width="2.4" fill="none" />`;
  for (let i = 1; i <= leaves; i++) {
    const t = i / (leaves + 1);
    const lx = (1 - t) * (1 - t) * x0 + 2 * (1 - t) * t * mx + t * t * x1;
    const ly = (1 - t) * (1 - t) * y0 + 2 * (1 - t) * t * my + t * t * y1;
    const rot = (i % 2 ? 40 : -40) + i * 20;
    out += `<ellipse cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" rx="5" ry="2.6" fill="${color}" stroke="#1e2a0c" stroke-width="0.6" transform="rotate(${rot} ${lx.toFixed(1)} ${ly.toFixed(1)})" />`;
  }
  return out;
}

/** A row of `n` fangs hanging from (x0, y) to (x1, y). */
function fangs(x0, x1, y, n, len = 8) {
  let out = '';
  for (let i = 0; i < n; i++) {
    const x = n > 1 ? x0 + ((x1 - x0) * i) / (n - 1) : x0;
    out += `<path d="M ${(x - 2.4).toFixed(1)} ${y} L ${x.toFixed(1)} ${y + len} L ${(x + 2.4).toFixed(1)} ${y} Z" fill="url(#sunbone)" stroke="#3a2a0c" stroke-width="0.6" />`;
  }
  return out;
}

const SHADOW = (d, extra = '') =>
  `<path d="${d}" fill="#000" opacity="0.35" transform="translate(4 4)" ${extra} />`;

const ITEMS_TO_GENERATE = [
  // ---- The Fanglord Beastmaster ----
  {
    id: 'beastpit_warbelt',
    bgDark: '#0a0806',
    bgMid: '#2a1a12',
    bgGlow: '#5a3424',
    svgArt: `
      <!-- A heavy mail war belt hung with beast-pit fangs, a red-lacquered
           sunbone buckle shaped like a jaguar's skull -->
      ${SHADOW('M 14 52 Q 64 40 114 52 L 114 78 Q 64 66 14 78 Z')}
      <path d="M 14 52 Q 64 40 114 52 L 114 78 Q 64 66 14 78 Z" fill="url(#mail)" stroke="#121410" stroke-width="1.8" />
      ${mailRings(20, 54, 108, 70)}
      <path d="M 14 56 Q 64 44 114 56" stroke="url(#leather)" stroke-width="3" fill="none" />
      <path d="M 14 74 Q 64 62 114 74" stroke="url(#leather)" stroke-width="3" fill="none" />
      ${fangs(22, 48, 76, 4, 10)}${fangs(80, 106, 76, 4, 10)}
      <path d="M 50 46 L 78 46 L 82 62 L 72 78 L 56 78 L 46 62 Z" fill="url(#trollred)" stroke="#2a0806" stroke-width="1.6" />
      <path d="M 56 52 L 72 52 L 74 62 L 68 72 L 60 72 L 54 62 Z" fill="url(#sunbone)" stroke="#3a2a0c" stroke-width="1" />
      <circle cx="60" cy="60" r="2.2" fill="#1a0a04" /><circle cx="68" cy="60" r="2.2" fill="#1a0a04" />
      <path d="M 60 68 L 64 72 L 68 68" stroke="#3a2a0c" stroke-width="1.2" fill="none" />
    `,
  },
  {
    id: 'jaguar_hide_jerkin',
    bgDark: '#0a0806',
    bgMid: '#2a2010',
    bgGlow: '#5a4420',
    svgArt: `
      <!-- A sleeveless jerkin of rosetted jaguar hide, laced with jade cord -->
      ${SHADOW('M 34 24 L 52 18 Q 64 30 76 18 L 94 24 L 102 46 L 92 52 L 92 108 L 36 108 L 36 52 L 26 46 Z')}
      <path d="M 34 24 L 52 18 Q 64 30 76 18 L 94 24 L 102 46 L 92 52 L 92 108 L 36 108 L 36 52 L 26 46 Z" fill="url(#hide)" stroke="#2e1a06" stroke-width="1.8" />
      ${rosettes([
        [46, 40],
        [80, 38],
        [52, 62],
        [76, 60, 3],
        [44, 86],
        [64, 80, 3],
        [84, 90],
        [56, 100, 3],
      ])}
      <path d="M 64 28 L 64 106" stroke="#2e1a06" stroke-width="1.4" />
      <path d="M 58 40 L 70 46 M 70 40 L 58 46 M 58 56 L 70 62 M 70 56 L 58 62 M 58 72 L 70 78 M 70 72 L 58 78" stroke="url(#jade)" stroke-width="2" />
      <path d="M 36 100 L 92 100" stroke="url(#leather)" stroke-width="5" />
    `,
  },
  {
    id: 'hexbone_handwraps',
    bgDark: '#06080a',
    bgMid: '#14201c',
    bgGlow: '#2c4a3c',
    svgArt: `
      <!-- Cloth handwraps bound with carved hex-bones, a faint jade hex glow
           between the knuckles -->
      <circle cx="64" cy="58" r="30" fill="url(#spirit)" opacity="0.55" />
      ${SHADOW('M 40 108 L 38 62 Q 38 36 56 32 L 80 34 Q 94 40 92 62 L 90 108 Z')}
      <path d="M 40 108 L 38 62 Q 38 36 56 32 L 80 34 Q 94 40 92 62 L 90 108 Z" fill="#d8ccb4" stroke="#4a3e2a" stroke-width="1.6" />
      <path d="M 38 50 L 92 56 M 38 64 L 92 70 M 39 78 L 91 84 M 40 92 L 90 98" stroke="#9a8a6a" stroke-width="2" />
      <rect x="48" y="40" width="7" height="22" rx="3" fill="url(#sunbone)" stroke="#3a2a0c" stroke-width="1" transform="rotate(-8 51 51)" />
      <rect x="62" y="42" width="7" height="22" rx="3" fill="url(#sunbone)" stroke="#3a2a0c" stroke-width="1" />
      <rect x="76" y="44" width="7" height="22" rx="3" fill="url(#sunbone)" stroke="#3a2a0c" stroke-width="1" transform="rotate(8 79 55)" />
      <path d="M 52 46 l 2 4 M 66 48 l -2 4 M 80 50 l 2 4" stroke="#3a2a0c" stroke-width="1" />
      <path d="M 52 84 L 64 76 L 76 84 L 64 92 Z" fill="none" stroke="#5fe0a0" stroke-width="2" opacity="0.9" />
    `,
  },
  // ---- The Gorgebloom ----
  {
    id: 'rootbound_sabatons',
    bgDark: '#080a06',
    bgMid: '#1c2412',
    bgGlow: '#3c4c24',
    svgArt: `
      <!-- A mail sabaton gripped by living roots that coil up its shin -->
      ${SHADOW('M 44 20 L 74 20 L 76 70 L 108 84 Q 112 102 98 106 L 34 106 Q 30 90 42 80 Z')}
      <path d="M 44 20 L 74 20 L 76 70 L 108 84 Q 112 102 98 106 L 34 106 Q 30 90 42 80 Z" fill="url(#mail)" stroke="#121410" stroke-width="1.8" />
      ${mailRings(48, 26, 70, 72)}
      <path d="M 34 96 L 104 96" stroke="#121410" stroke-width="2" />
      <path d="M 40 104 Q 46 88 42 72 Q 38 56 50 44 Q 60 34 56 22" stroke="url(#wood)" stroke-width="5" fill="none" stroke-linecap="round" />
      <path d="M 78 100 Q 70 86 78 76 Q 84 66 76 52" stroke="url(#wood)" stroke-width="4" fill="none" stroke-linecap="round" />
      <path d="M 50 106 Q 64 92 92 100" stroke="url(#wood)" stroke-width="3.5" fill="none" stroke-linecap="round" />
      ${vine(56, 22, 72, 40, 2)}
    `,
  },
  {
    id: 'pollen_dusted_leggings',
    bgDark: '#0a0a04',
    bgMid: '#26240e',
    bgGlow: '#54501c',
    svgArt: `
      <!-- Supple leather leggings dusted in drifting yellow pollen -->
      <circle cx="40" cy="40" r="22" fill="url(#pollenglow)" opacity="0.7" />
      ${SHADOW('M 38 18 L 90 18 L 94 108 L 70 108 L 64 52 L 58 108 L 34 108 Z')}
      <path d="M 38 18 L 90 18 L 94 108 L 70 108 L 64 52 L 58 108 L 34 108 Z" fill="url(#leather)" stroke="#2e1a0c" stroke-width="1.8" />
      <rect x="36" y="18" width="56" height="9" rx="2" fill="url(#moss)" stroke="#25320e" stroke-width="1" />
      <path d="M 46 30 L 42 104 M 82 30 L 86 104" stroke="#2e1a0c" stroke-width="1" opacity="0.7" />
      ${[
        [44, 40],
        [52, 58],
        [40, 74],
        [80, 46],
        [86, 66],
        [76, 84],
        [48, 92],
        [84, 98],
        [30, 30],
        [98, 34],
        [104, 58],
      ]
        .map(
          ([x, y], i) =>
            `<circle cx="${x}" cy="${y}" r="${i % 3 === 0 ? 2.6 : 1.8}" fill="url(#pollen)" opacity="0.95" />`,
        )
        .join('')}
    `,
  },
  {
    id: 'bloomsilk_cowl',
    bgDark: '#0a060a',
    bgMid: '#26142a',
    bgGlow: '#523050',
    svgArt: `
      <!-- A cowl of petal-pink bloomsilk, its hem cut into petals around a
           pollen-gold clasp -->
      ${SHADOW('M 64 14 Q 100 18 104 62 Q 106 92 92 106 L 36 106 Q 22 92 24 62 Q 28 18 64 14 Z')}
      <path d="M 64 14 Q 100 18 104 62 Q 106 92 92 106 L 36 106 Q 22 92 24 62 Q 28 18 64 14 Z" fill="url(#bloomsilk)" stroke="#3a1028" stroke-width="1.8" />
      <path d="M 64 32 Q 86 36 86 64 Q 86 84 64 88 Q 42 84 42 64 Q 42 36 64 32 Z" fill="#1a0814" opacity="0.9" />
      ${[30, 44, 58, 72, 86, 100]
        .map(
          (x) =>
            `<path d="M ${x - 7} 100 Q ${x} 116 ${x + 7} 100 Z" fill="url(#bloomsilk)" stroke="#3a1028" stroke-width="1" />`,
        )
        .join('')}
      <circle cx="64" cy="96" r="7" fill="url(#pollen)" stroke="#5a5010" stroke-width="1.2" />
      <path d="M 64 90 L 64 102 M 58 96 L 70 96" stroke="#5a5010" stroke-width="1" />
      <path d="M 46 24 Q 54 20 62 20" stroke="#ffffff" stroke-width="2" fill="none" opacity="0.6" />
    `,
  },
  {
    id: 'falls_blessed_staff',
    bgDark: '#04080a',
    bgMid: '#10222a',
    bgGlow: '#28505c',
    svgArt: `
      <!-- A river-wood staff crowned by a falls-worn basalt stone, a ribbon of
           white water spilling from it -->
      <ellipse cx="88" cy="34" rx="24" ry="22" fill="url(#spirit)" opacity="0.45" />
      ${SHADOW('M 24 112 L 30 116 L 92 40 L 86 36 Z')}
      <path d="M 24 112 L 30 116 L 92 40 L 86 36 Z" fill="url(#wood)" stroke="#1e1206" stroke-width="1.4" />
      ${vine(34, 102, 70, 62, 3)}
      <path d="M 72 26 Q 92 12 106 30 Q 112 48 92 52 Q 74 50 72 26 Z" fill="url(#basalt)" stroke="#0e100e" stroke-width="1.6" />
      <path d="M 80 28 Q 90 22 100 30" stroke="#b8c4b8" stroke-width="1.6" fill="none" opacity="0.7" />
      <path d="M 96 50 Q 100 70 94 84 Q 90 96 98 108" stroke="url(#falls)" stroke-width="5" fill="none" stroke-linecap="round" opacity="0.9" />
      <path d="M 98 50 Q 104 66 100 78" stroke="#ffffff" stroke-width="1.6" fill="none" opacity="0.8" />
      <circle cx="98" cy="110" r="4" fill="#ddf3f2" opacity="0.7" />
      <circle cx="91" cy="106" r="2.4" fill="#ddf3f2" opacity="0.6" />
    `,
  },
  // ---- Heroic epics ----
  {
    id: 'fanglords_hide_mantle',
    bgDark: '#0a0604',
    bgMid: '#2c1610',
    bgGlow: '#622c1c',
    svgArt: `
      <!-- A pauldron of the Fanglord's jaguar hide, a snarling jaguar head at
           its crest and a fringe of war-red feathers -->
      ${SHADOW('M 14 74 Q 20 34 64 28 Q 108 34 114 74 Q 96 66 64 66 Q 32 66 14 74 Z')}
      <path d="M 14 74 Q 20 34 64 28 Q 108 34 114 74 Q 96 66 64 66 Q 32 66 14 74 Z" fill="url(#hide)" stroke="#2e1a06" stroke-width="1.8" />
      ${rosettes([
        [30, 58],
        [96, 58],
        [42, 46, 3],
        [86, 46, 3],
      ])}
      ${[22, 34, 46, 58, 70, 82, 94, 106]
        .map(
          (x, i) =>
            `<path d="M ${x - 4} ${70 - (i === 0 || i === 7 ? 2 : 0)} Q ${x} ${100 + (i % 2) * 6} ${x + 4} 70 Z" fill="url(#trollred)" stroke="#2a0806" stroke-width="0.8" />`,
        )
        .join('')}
      <path d="M 46 30 L 52 14 L 60 26 L 68 26 L 76 14 L 82 30 Q 86 50 64 58 Q 42 50 46 30 Z" fill="url(#hide)" stroke="#2e1a06" stroke-width="1.6" />
      <path d="M 54 36 L 60 38 M 74 36 L 68 38" stroke="#1a0a04" stroke-width="2.4" />
      <circle cx="57" cy="38" r="1.6" fill="#5fe0a0" /><circle cx="71" cy="38" r="1.6" fill="#5fe0a0" />
      <path d="M 56 48 Q 64 54 72 48" stroke="#1a0a04" stroke-width="1.6" fill="none" />
      ${fangs(58, 70, 49, 2, 6)}
    `,
  },
  {
    id: 'thornroot_greathelm',
    bgDark: '#060806',
    bgMid: '#162014',
    bgGlow: '#34482c',
    svgArt: `
      <!-- A closed mail greathelm crowned with a ring of thorned roots, a
           single pollen-gold bloom at the brow -->
      ${SHADOW('M 30 106 L 28 56 Q 30 24 64 22 Q 98 24 100 56 L 98 106 Z')}
      <path d="M 30 106 L 28 56 Q 30 24 64 22 Q 98 24 100 56 L 98 106 Z" fill="url(#mail)" stroke="#121410" stroke-width="1.8" />
      ${mailRings(36, 64, 92, 100, 7)}
      <path d="M 36 60 L 92 60 L 92 70 L 70 70 L 64 96 L 58 70 L 36 70 Z" fill="#0e100c" />
      <path d="M 28 50 Q 64 34 100 50" stroke="url(#wood)" stroke-width="7" fill="none" stroke-linecap="round" />
      ${[30, 40, 52, 76, 88, 98]
        .map((x, i) => {
          const y = 50 - Math.sin(((x - 28) / 72) * Math.PI) * 14;
          return `<path d="M ${x - 3} ${y.toFixed(1)} L ${x + (i % 2 ? 2 : -2)} ${(y - 12).toFixed(1)} L ${x + 3} ${y.toFixed(1)} Z" fill="url(#wood)" stroke="#1e1206" stroke-width="0.8" />`;
        })
        .join('')}
      <circle cx="64" cy="36" r="7" fill="url(#pollen)" stroke="#5a5010" stroke-width="1" />
      ${[0, 1, 2, 3, 4]
        .map((i) => {
          const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
          return `<ellipse cx="${(64 + Math.cos(a) * 9).toFixed(1)}" cy="${(36 + Math.sin(a) * 9).toFixed(1)}" rx="4" ry="2.6" fill="url(#trollred)" transform="rotate(${((a * 180) / Math.PI).toFixed(1)} ${(64 + Math.cos(a) * 9).toFixed(1)} ${(36 + Math.sin(a) * 9).toFixed(1)})" />`;
        })
        .join('')}
    `,
  },
  // ---- Trinkets ----
  {
    id: 'fanglords_whistle',
    bgDark: '#040a08',
    bgMid: '#10261c',
    bgGlow: '#24523c',
    svgArt: `
      <!-- A carved fang whistle on a red cord, a jade spirit jaguar's head
           rising from its call -->
      <circle cx="74" cy="44" r="34" fill="url(#spirit)" opacity="0.75" />
      <path d="M 58 46 L 64 28 L 72 40 L 80 40 L 88 28 L 94 46 Q 98 66 76 74 Q 54 66 58 46 Z" fill="#5fe0a0" opacity="0.55" stroke="#bdf5d6" stroke-width="1.2" />
      <circle cx="68" cy="52" r="2" fill="#eafff4" /><circle cx="84" cy="52" r="2" fill="#eafff4" />
      <path d="M 18 30 Q 30 60 34 98" stroke="url(#trollred)" stroke-width="3" fill="none" />
      ${SHADOW('M 30 96 Q 22 84 34 78 L 70 92 Q 76 100 68 106 Z')}
      <path d="M 30 96 Q 22 84 34 78 L 70 92 Q 76 100 68 106 Z" fill="url(#sunbone)" stroke="#3a2a0c" stroke-width="1.6" />
      <path d="M 40 86 L 62 96" stroke="#3a2a0c" stroke-width="1" />
      <ellipse cx="44" cy="88" rx="3" ry="2" fill="#1a1006" />
      <path d="M 70 92 Q 78 84 84 78" stroke="#bdf5d6" stroke-width="1.4" fill="none" opacity="0.8" />
      <path d="M 74 98 Q 84 94 92 88" stroke="#bdf5d6" stroke-width="1.2" fill="none" opacity="0.6" />
    `,
  },
  {
    id: 'gorgebloom_seedpod',
    bgDark: '#0a0806',
    bgMid: '#2a1c0e',
    bgGlow: '#5a4618',
    svgArt: `
      <!-- A swollen blood-red seedpod split along its seam, a glowing pollen
           seed inside and thorned petals curling round it -->
      <circle cx="64" cy="62" r="34" fill="url(#pollenglow)" opacity="0.65" />
      ${SHADOW('M 64 18 Q 96 36 92 70 Q 88 100 64 108 Q 40 100 36 70 Q 32 36 64 18 Z')}
      <path d="M 64 18 Q 96 36 92 70 Q 88 100 64 108 Q 40 100 36 70 Q 32 36 64 18 Z" fill="url(#trollred)" stroke="#2a0806" stroke-width="1.8" />
      <path d="M 64 30 Q 78 50 74 72 Q 70 92 64 98 Q 58 92 54 72 Q 50 50 64 30 Z" fill="#1a0604" />
      <ellipse cx="64" cy="66" rx="9" ry="13" fill="url(#pollen)" stroke="#6a6418" stroke-width="1" />
      <ellipse cx="61" cy="61" rx="3" ry="4" fill="#fffbe0" opacity="0.8" />
      <path d="M 40 40 Q 26 34 22 20 Q 34 24 44 34 Z" fill="url(#moss)" stroke="#25320e" stroke-width="1" />
      <path d="M 88 40 Q 102 34 106 20 Q 94 24 84 34 Z" fill="url(#moss)" stroke="#25320e" stroke-width="1" />
      <path d="M 64 18 L 60 8 L 68 8 Z" fill="url(#moss)" stroke="#25320e" stroke-width="1" />
      ${[
        [24, 60],
        [104, 58],
        [30, 88],
        [98, 90],
        [52, 112],
      ]
        .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="2" fill="url(#pollen)" />`)
        .join('')}
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
            <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="11" />
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
  console.log(`Generating ${ITEMS_TO_GENERATE.length} Wildheart Basin WebP icons...`);
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
