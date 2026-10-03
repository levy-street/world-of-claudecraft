// scripts/generate_hollow_crypt_item_icons.mjs
// Generates the shipping 128x128 WebP item icons for the Hollow Crypt rework's
// loot (src/sim/content/hollow_crypt_items.ts) plus the one generated
// non-weapon Heroic variant that ships its own painting (the Heroic Cantor's
// Hymnal, content/heroic_variants.ts); the two generated Heroic weapons keep
// their base weapon's painting. Same recipe as
// generate_gravewyrm_sanctum_item_icons.mjs: an authored SVG composition per
// item over a three-stop radial ground, rasterized with Sharp, meeting the
// woc-item-icon-v1 contract (opaque dark vignette, warm top-left key light,
// cool bottom-right shadow, centered silhouette with safe padding, distinct art
// per item). This batch adds a per-shape volume pass (a warm-to-cool sheen over
// every material plate) and a soft paint-grain filter on the subject so the
// shapes read as painted material rather than flat vector fills. The palette
// is the crypt's own (docs/design/dungeon-rework/hollow_crypt.md, Palette):
// bone ivory, grave-earth umber, tallow amber for the only warm light,
// Gravecaller violet and soul green for the enemy's magic, and rime white-blue
// for the Rimeweb's frost-spider wing. The script IS the retained source:
// re-running it reproduces every file byte for byte. It never touches
// mapping.json; the generated batch entry there is hand-authored (batch
// hollow-crypt-icons-2026-10-03) with its provenance README under
// docs/achievements/hollow-crypt-icons-2026-10-03/.
//
// Usage: node scripts/generate_hollow_crypt_item_icons.mjs [item-id ...]
// (no ids renders the whole batch).

import path from 'node:path';
import sharp from 'sharp';

const repoRoot = process.cwd();
const itemsDir = path.join(repoRoot, 'public/ui/items');
const OUT_PX = 128;
const MASTER_PX = 512;

const DEFS = `
  <linearGradient id="sheen" x1="0%" y1="0%" x2="100%" y2="100%">
    <stop offset="0%" stop-color="#fff6e0" stop-opacity="0.42" />
    <stop offset="38%" stop-color="#fff6e0" stop-opacity="0" />
    <stop offset="62%" stop-color="#05070c" stop-opacity="0" />
    <stop offset="100%" stop-color="#05070c" stop-opacity="0.55" />
  </linearGradient>
  <linearGradient id="iron" x1="0%" y1="0%" x2="100%" y2="100%">
    <stop offset="0%" stop-color="#b4b8bc" />
    <stop offset="45%" stop-color="#5a6066" />
    <stop offset="100%" stop-color="#1a1d21" />
  </linearGradient>
  <linearGradient id="blackiron" x1="0%" y1="0%" x2="100%" y2="100%">
    <stop offset="0%" stop-color="#6a6672" />
    <stop offset="45%" stop-color="#2c2a33" />
    <stop offset="100%" stop-color="#0c0b10" />
  </linearGradient>
  <linearGradient id="gravesteel" x1="0%" y1="0%" x2="100%" y2="100%">
    <stop offset="0%" stop-color="#b4aac4" />
    <stop offset="40%" stop-color="#5a5068" />
    <stop offset="100%" stop-color="#18121e" />
  </linearGradient>
  <linearGradient id="steel" x1="0%" y1="0%" x2="100%" y2="100%">
    <stop offset="0%" stop-color="#f4f6f8" />
    <stop offset="40%" stop-color="#a8b0b8" />
    <stop offset="75%" stop-color="#5a646e" />
    <stop offset="100%" stop-color="#262c32" />
  </linearGradient>
  <linearGradient id="mail" x1="0%" y1="0%" x2="100%" y2="100%">
    <stop offset="0%" stop-color="#c8ccd0" />
    <stop offset="45%" stop-color="#6a7076" />
    <stop offset="100%" stop-color="#1e2226" />
  </linearGradient>
  <linearGradient id="leather" x1="0%" y1="0%" x2="100%" y2="100%">
    <stop offset="0%" stop-color="#b88a5e" />
    <stop offset="50%" stop-color="#6c4428" />
    <stop offset="100%" stop-color="#2a180c" />
  </linearGradient>
  <linearGradient id="darkleather" x1="0%" y1="0%" x2="100%" y2="100%">
    <stop offset="0%" stop-color="#7a6656" />
    <stop offset="50%" stop-color="#3a2e26" />
    <stop offset="100%" stop-color="#14100c" />
  </linearGradient>
  <linearGradient id="wood" x1="0%" y1="0%" x2="100%" y2="100%">
    <stop offset="0%" stop-color="#b08a5c" />
    <stop offset="55%" stop-color="#5e3e22" />
    <stop offset="100%" stop-color="#22140a" />
  </linearGradient>
  <linearGradient id="bone" x1="0%" y1="0%" x2="100%" y2="100%">
    <stop offset="0%" stop-color="#fbf4e2" />
    <stop offset="50%" stop-color="#cdbf9e" />
    <stop offset="100%" stop-color="#6e6048" />
  </linearGradient>
  <linearGradient id="chitin" x1="0%" y1="0%" x2="100%" y2="100%">
    <stop offset="0%" stop-color="#f4fbff" />
    <stop offset="40%" stop-color="#b8d2e2" />
    <stop offset="100%" stop-color="#3c5a70" />
  </linearGradient>
  <linearGradient id="rimesilk" x1="0%" y1="0%" x2="100%" y2="100%">
    <stop offset="0%" stop-color="#ffffff" />
    <stop offset="45%" stop-color="#c6e2f0" />
    <stop offset="100%" stop-color="#4a7890" />
  </linearGradient>
  <linearGradient id="fang" x1="0%" y1="100%" x2="100%" y2="0%">
    <stop offset="0%" stop-color="#efe4c8" />
    <stop offset="55%" stop-color="#d8eef8" />
    <stop offset="100%" stop-color="#7ec4ea" />
  </linearGradient>
  <linearGradient id="bronze" x1="0%" y1="0%" x2="100%" y2="100%">
    <stop offset="0%" stop-color="#ffe2a0" />
    <stop offset="45%" stop-color="#b8843a" />
    <stop offset="100%" stop-color="#4a2c0c" />
  </linearGradient>
  <linearGradient id="silver" x1="0%" y1="0%" x2="100%" y2="100%">
    <stop offset="0%" stop-color="#ffffff" />
    <stop offset="50%" stop-color="#b8bcc8" />
    <stop offset="100%" stop-color="#4a4e5c" />
  </linearGradient>
  <linearGradient id="hemp" x1="0%" y1="0%" x2="100%" y2="100%">
    <stop offset="0%" stop-color="#e8d2a0" />
    <stop offset="50%" stop-color="#a88a58" />
    <stop offset="100%" stop-color="#4c3a20" />
  </linearGradient>
  <linearGradient id="plum" x1="0%" y1="0%" x2="100%" y2="100%">
    <stop offset="0%" stop-color="#7a5a86" />
    <stop offset="50%" stop-color="#3a2446" />
    <stop offset="100%" stop-color="#140a1a" />
  </linearGradient>
  <linearGradient id="cassock" x1="0%" y1="0%" x2="100%" y2="100%">
    <stop offset="0%" stop-color="#7a6488" />
    <stop offset="50%" stop-color="#30223c" />
    <stop offset="100%" stop-color="#0c0812" />
  </linearGradient>
  <linearGradient id="crimson" x1="0%" y1="0%" x2="100%" y2="100%">
    <stop offset="0%" stop-color="#d0605a" />
    <stop offset="50%" stop-color="#7a1e22" />
    <stop offset="100%" stop-color="#2a080a" />
  </linearGradient>
  <linearGradient id="gravecloth" x1="0%" y1="0%" x2="100%" y2="100%">
    <stop offset="0%" stop-color="#627660" />
    <stop offset="50%" stop-color="#253228" />
    <stop offset="100%" stop-color="#0a100c" />
  </linearGradient>
  <linearGradient id="linen" x1="0%" y1="0%" x2="100%" y2="100%">
    <stop offset="0%" stop-color="#fffaf0" />
    <stop offset="55%" stop-color="#d6ccb8" />
    <stop offset="100%" stop-color="#7a705e" />
  </linearGradient>
  <linearGradient id="parchment" x1="0%" y1="0%" x2="100%" y2="100%">
    <stop offset="0%" stop-color="#fff4d8" />
    <stop offset="60%" stop-color="#e2cc9a" />
    <stop offset="100%" stop-color="#9a8050" />
  </linearGradient>
  <linearGradient id="dirt" x1="0%" y1="0%" x2="100%" y2="100%">
    <stop offset="0%" stop-color="#7a5a3a" />
    <stop offset="55%" stop-color="#3e2a18" />
    <stop offset="100%" stop-color="#160e06" />
  </linearGradient>
  <radialGradient id="soul" cx="50%" cy="50%" r="50%">
    <stop offset="0%" stop-color="#f2fff0" stop-opacity="0.95" />
    <stop offset="40%" stop-color="#8cf0a8" stop-opacity="0.6" />
    <stop offset="100%" stop-color="#3ac070" stop-opacity="0" />
  </radialGradient>
  <radialGradient id="violetglow" cx="50%" cy="50%" r="50%">
    <stop offset="0%" stop-color="#f4e8ff" stop-opacity="0.9" />
    <stop offset="45%" stop-color="#b07ae8" stop-opacity="0.45" />
    <stop offset="100%" stop-color="#7a3ac0" stop-opacity="0" />
  </radialGradient>
  <radialGradient id="frostglow" cx="50%" cy="50%" r="50%">
    <stop offset="0%" stop-color="#ffffff" stop-opacity="0.95" />
    <stop offset="45%" stop-color="#9ad8ff" stop-opacity="0.45" />
    <stop offset="100%" stop-color="#4aa8f0" stop-opacity="0" />
  </radialGradient>
  <radialGradient id="tallow" cx="50%" cy="50%" r="50%">
    <stop offset="0%" stop-color="#fff6d8" stop-opacity="0.95" />
    <stop offset="45%" stop-color="#ffc060" stop-opacity="0.45" />
    <stop offset="100%" stop-color="#ff9a30" stop-opacity="0" />
  </radialGradient>
  <pattern id="mailpat" width="5" height="4.4" patternUnits="userSpaceOnUse">
    <circle cx="2.5" cy="2.2" r="1.7" fill="none" stroke="#e8ecf0" stroke-width="0.7" opacity="0.55" />
    <circle cx="0" cy="0" r="1.7" fill="none" stroke="#0c0e10" stroke-width="0.6" opacity="0.5" />
    <circle cx="5" cy="0" r="1.7" fill="none" stroke="#0c0e10" stroke-width="0.6" opacity="0.5" />
    <circle cx="0" cy="4.4" r="1.7" fill="none" stroke="#0c0e10" stroke-width="0.6" opacity="0.5" />
    <circle cx="5" cy="4.4" r="1.7" fill="none" stroke="#0c0e10" stroke-width="0.6" opacity="0.5" />
  </pattern>
  <pattern id="weave" width="3" height="3" patternUnits="userSpaceOnUse">
    <path d="M 0 0 L 3 3 M 3 0 L 0 3" stroke="#ffffff" stroke-width="0.35" opacity="0.12" />
  </pattern>
`;

/** A painted material plate: base fill, the shared sheen for volume, an outline. */
function vol(d, fill, stroke = '#0a0806', sw = 1.6, extra = '') {
  return (
    `<path d="${d}" fill="${fill}" ${extra} />` +
    `<path d="${d}" fill="url(#sheen)" />` +
    `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round" />`
  );
}

/** A soft contact shadow under the subject. */
function ground(cx, cy, rx, ry, o = 0.5) {
  return `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="#000" opacity="${o}" />`;
}

/** A drop shadow of a path, offset down-right (the cool shadow side). */
function drop(d, o = 0.38) {
  return `<path d="${d}" fill="#000" opacity="${o}" transform="translate(3.5 4)" />`;
}

/** Rime: a crust of small white ice crystals. */
function rime(points) {
  return points
    .map(
      ([x, y, s = 1]) =>
        `<path d="M ${x} ${y - 5 * s} L ${x + 1.8 * s} ${y} L ${x} ${y + 3 * s} L ${x - 1.8 * s} ${y} Z" fill="#f4fbff" opacity="0.9" />`,
    )
    .join('');
}

/** A four-point glint star. */
function glint(x, y, s = 1, color = '#ffffff') {
  return `<path d="M ${x} ${y - 5 * s} Q ${x + 0.8 * s} ${y - 0.8 * s} ${x + 5 * s} ${y} Q ${x + 0.8 * s} ${y + 0.8 * s} ${x} ${y + 5 * s} Q ${x - 0.8 * s} ${y + 0.8 * s} ${x - 5 * s} ${y} Q ${x - 0.8 * s} ${y - 0.8 * s} ${x} ${y - 5 * s} Z" fill="${color}" opacity="0.95" />`;
}

/** A spider web: `spokes` radial threads and `rings` sagging rings. */
function web(cx, cy, r, spokes, rings, rot = 0, color = '#eaf6ff', op = 0.55, sw = 0.7) {
  let out = '';
  const pts = [];
  for (let i = 0; i < spokes; i++) {
    const a = ((rot + (360 / spokes) * i) * Math.PI) / 180;
    pts.push([Math.cos(a), Math.sin(a)]);
    out += `<path d="M ${cx} ${cy} L ${(cx + Math.cos(a) * r).toFixed(1)} ${(cy + Math.sin(a) * r).toFixed(1)}" stroke="${color}" stroke-width="${sw}" opacity="${op}" />`;
  }
  for (let k = 1; k <= rings; k++) {
    const rr = (r * k) / (rings + 0.4);
    let d = '';
    for (let i = 0; i <= spokes; i++) {
      const [ux, uy] = pts[i % spokes];
      const [px, py] = pts[(i + spokes - 1) % spokes];
      const x = cx + ux * rr;
      const y = cy + uy * rr;
      if (i === 0) d += `M ${x.toFixed(1)} ${y.toFixed(1)}`;
      else {
        const mx = cx + ((ux + px) / 2) * rr * 0.82;
        const my = cy + ((uy + py) / 2) * rr * 0.82;
        d += ` Q ${mx.toFixed(1)} ${my.toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)}`;
      }
    }
    out += `<path d="${d}" fill="none" stroke="${color}" stroke-width="${sw}" opacity="${op}" />`;
  }
  return out;
}

/** Clods of grave dirt: lumpy umber blobs with lit crumbs. */
function dirt(points) {
  return points
    .map(([x, y, s = 1]) => {
      const r = 3.4 * s;
      return (
        `<path d="M ${x - r} ${y} Q ${x - r} ${y - r} ${x} ${y - r * 0.9} Q ${x + r * 1.2} ${y - r} ${x + r} ${y + r * 0.2} Q ${x + r * 0.6} ${y + r} ${x - r * 0.2} ${y + r * 0.8} Q ${x - r * 1.1} ${y + r * 0.7} ${x - r} ${y} Z" fill="url(#dirt)" />` +
        `<circle cx="${(x - r * 0.35).toFixed(1)}" cy="${(y - r * 0.4).toFixed(1)}" r="${(r * 0.28).toFixed(1)}" fill="#9a7650" opacity="0.8" />`
      );
    })
    .join('');
}

/** Little musical note motes, rising (the choir's spectral hymn). */
function notes(list, color = '#e8dcff') {
  return list
    .map(
      ([x, y, s = 1, o = 0.85]) =>
        `<g opacity="${o}"><ellipse cx="${x}" cy="${y}" rx="${2.6 * s}" ry="${1.9 * s}" fill="${color}" transform="rotate(-20 ${x} ${y})" /><path d="M ${x + 2.3 * s} ${y - 0.4 * s} L ${x + 2.3 * s} ${y - 10 * s} Q ${x + 6 * s} ${y - 8 * s} ${x + 6.5 * s} ${y - 5 * s}" stroke="${color}" stroke-width="${1.1 * s}" fill="none" /></g>`,
    )
    .join('');
}

/** Rivet heads along a list of points. */
function rivets(points, r = 1.6) {
  return points
    .map(
      ([x, y]) =>
        `<circle cx="${x}" cy="${y}" r="${r}" fill="#1a1c20" /><circle cx="${x - r * 0.3}" cy="${y - r * 0.3}" r="${r * 0.55}" fill="#e8ecf0" />`,
    )
    .join('');
}

/** A small bronze hand-bell hanging at (x, y) (top of the crown). */
function bell(x, y, s = 1) {
  const d = `M ${x - 3 * s} ${y + 3 * s} Q ${x - 4 * s} ${y + 12 * s} ${x - 9 * s} ${y + 17 * s} L ${x + 9 * s} ${y + 17 * s} Q ${x + 4 * s} ${y + 12 * s} ${x + 3 * s} ${y + 3 * s} Q ${x} ${y} ${x - 3 * s} ${y + 3 * s} Z`;
  return (
    `<circle cx="${x}" cy="${y}" r="${2.2 * s}" fill="none" stroke="url(#bronze)" stroke-width="${1.6 * s}" />` +
    vol(d, 'url(#bronze)', '#2a1806', 1.2 * s) +
    `<path d="M ${x - 9 * s} ${y + 17 * s} L ${x + 9 * s} ${y + 17 * s}" stroke="#ffe8b0" stroke-width="${1.4 * s}" opacity="0.8" />` +
    `<path d="M ${x - 2.4 * s} ${y + 6 * s} Q ${x - 3.6 * s} ${y + 12 * s} ${x - 6 * s} ${y + 15 * s}" stroke="#fff4d0" stroke-width="${1.1 * s}" fill="none" opacity="0.85" />` +
    `<circle cx="${x}" cy="${y + 19 * s}" r="${2.2 * s}" fill="#3a2410" />`
  );
}

/** A twisted rope stroke along a path `d` (tan base plus diagonal ply shadows). */
function rope(d, w = 6) {
  return (
    `<path d="${d}" stroke="#2a1c0c" stroke-width="${w + 1.6}" fill="none" stroke-linecap="round" />` +
    `<path d="${d}" stroke="url(#hemp)" stroke-width="${w}" fill="none" stroke-linecap="round" />` +
    `<path d="${d}" stroke="#4c3a20" stroke-width="${w}" fill="none" stroke-dasharray="1.6 ${(w * 0.55).toFixed(1)}" opacity="0.75" />` +
    `<path d="${d}" stroke="#f4e2b8" stroke-width="${(w * 0.25).toFixed(1)}" fill="none" stroke-dasharray="2 ${(w * 0.5).toFixed(1)}" opacity="0.55" transform="translate(-0.8 -1.2)" />`
  );
}

/** A mail boot in profile, toe to the right, shaft top at (0, 0). */
const BOOT =
  'M 2 0 L 26 0 Q 26 26 29 44 Q 31 52 42 55 L 56 59 Q 67 63 67 72 L 67 78 Q 34 82 -1 78 Q -3 58 1 36 Z';

/** A front-on shoulder mantle with a dagged hem. */
const MANTLE =
  'M 64 20 Q 96 20 110 44 Q 118 58 114 76 L 106 72 L 98 84 L 89 76 L 80 86 L 72 78 L 64 88 L 56 78 L 48 86 L 39 76 L 30 84 L 22 72 L 14 76 Q 10 58 18 44 Q 32 20 64 20 Z';

/** The Cantor's ankle-length cassock with wide bell sleeves. */
const CASSOCK =
  'M 48 12 L 80 12 L 96 26 L 114 56 L 100 62 L 92 50 L 104 114 L 24 114 L 36 50 L 28 62 L 14 56 L 32 26 Z';

/** Morthen's robe: ragged sleeves and a tattered hem. */
const GRAVEROBE =
  'M 44 14 L 84 14 L 98 26 L 116 60 L 106 66 L 102 58 L 98 62 L 92 50 L 104 112 L 92 106 L 82 114 L 72 106 L 64 114 L 56 106 L 46 114 L 36 106 L 24 112 L 36 50 L 30 62 L 26 58 L 22 66 L 12 60 L 30 26 Z';

/** The stalker's ragged leather hood with a swept peak. */
const STALKER_HOOD =
  'M 54 6 Q 100 12 106 64 L 100 96 L 108 110 L 88 104 L 78 112 L 64 106 L 50 112 L 40 104 L 20 110 L 28 96 L 22 64 Q 22 22 54 6 Z';

/** The rime-silk hood: a peaked cowl over wide drapes, and its face opening. */
const RIME_HOOD =
  'M 64 4 Q 74 8 86 20 Q 104 40 104 64 Q 104 84 116 102 Q 100 114 84 108 L 44 108 Q 28 114 12 102 Q 24 84 24 64 Q 24 40 42 20 Q 54 8 64 4 Z';
const RIME_HOOD_OPENING = 'M 64 34 Q 88 40 88 68 Q 86 94 64 102 Q 42 94 40 68 Q 40 40 64 34 Z';

/** The burial spade's pointed blade with foot treads at the shoulders. */
const BURIAL_BLADE = 'M 43 8 Q 64 1 85 8 L 85 44 L 90 46 L 90 52 L 38 52 L 38 46 L 43 44 Z';

const ITEMS_TO_GENERATE = [
  // ---- Sexton Marrow ----
  {
    id: 'gravedirt_treads',
    bgDark: '#070504',
    bgMid: '#1e150e',
    bgGlow: '#4a3622',
    svgArt: `
      <!-- A pair of mail sexton's boots, folded leather cuffs, buckled ankle
           straps and iron toe caps, the feet and soles caked in clods of
           grave dirt with a chip of bone caught in it -->
      ${ground(66, 110, 50, 7, 0.55)}
      <g transform="translate(46 12)">
        ${vol(BOOT, 'url(#mail)', '#0c0e10', 1.6)}
        <path d="${BOOT}" fill="url(#mailpat)" />
        <path d="${BOOT}" fill="#05060a" opacity="0.38" />
        ${vol('M -3 -3 L 29 -3 L 30 11 Q 13 14 -4 12 Z', 'url(#darkleather)', '#140a04', 1.4)}
        ${dirt([
          [56, 77, 1.1],
          [44, 78, 1],
        ])}
      </g>
      <g transform="translate(18 26)">
        ${drop(BOOT)}
        ${vol(BOOT, 'url(#mail)', '#0c0e10', 1.8)}
        <path d="${BOOT}" fill="url(#mailpat)" />
        <path d="M 6 14 Q 8 32 10 46 M 20 14 Q 21 30 24 44" stroke="#f0f4f8" stroke-width="1" fill="none" opacity="0.35" />
        ${vol('M -4 -4 L 30 -4 L 31 11 Q 13 15 -5 12 Z', 'url(#leather)', '#140a04', 1.5)}
        <path d="M -2 4 Q 13 7 28 4" stroke="#f0d0a0" stroke-width="0.9" fill="none" stroke-dasharray="2 2" opacity="0.75" />
        <path d="M -3 -2 Q 13 1 29 -2" stroke="#f4dcb4" stroke-width="1" fill="none" opacity="0.55" />
        ${vol('M 0 38 L 28 38 L 30 46 L 0 47 Z', 'url(#leather)', '#140a04', 1.2)}
        <path d="M 9 37.5 L 16 37.5 L 16 47.5 L 9 47.5 Z" fill="none" stroke="#14161a" stroke-width="3" />
        <path d="M 9 37.5 L 16 37.5 L 16 47.5 L 9 47.5 Z" fill="none" stroke="url(#silver)" stroke-width="1.8" />
        <path d="M 9 42.5 L 15 42.5" stroke="url(#silver)" stroke-width="1.4" />
        ${vol('M 47 57 L 56 59 Q 67 63 67 72 L 67 76 L 49 77 Q 46 66 47 57 Z', 'url(#iron)', '#0a0c0e', 1.4)}
        <path d="M 50 60 Q 60 62 64 70" stroke="#f0f4f8" stroke-width="1.1" fill="none" opacity="0.7" />
        ${rivets([
          [52, 66],
          [59, 66],
        ])}
        <path d="M -1 77 Q 34 81 67 77 L 67 83 Q 34 86 -1 83 Z" fill="#1a120a" />
        ${dirt([
          [2, 74, 1.5],
          [12, 70, 1.1],
          [24, 77, 1.6],
          [36, 74, 1.2],
          [48, 79, 1.4],
          [61, 80, 1.2],
          [3, 60, 0.9],
          [28, 62, 0.75],
          [40, 66, 0.6],
        ])}
        <path d="M 30 70 q 6 4 4 10 M 34 78 q 4 1 6 -2" stroke="#8a6a44" stroke-width="1.1" fill="none" />
        ${vol('M 16 66 l 9 -4 l 1.4 2.6 l -9 4 Z', 'url(#bone)', '#3a3020', 0.6)}
      </g>
    `,
  },
  {
    id: 'bellrope_girdle',
    bgDark: '#070506',
    bgMid: '#1c1418',
    bgGlow: '#47343a',
    svgArt: `
      <!-- A faded grey-violet cloth sash bound round with a length of old
           bell rope, knotted at the front, a small bronze hand-bell hanging
           from one frayed tail -->
      ${ground(64, 104, 46, 7, 0.5)}
      ${drop('M 10 48 Q 64 30 118 48 L 116 68 Q 64 52 12 68 Z')}
      ${vol('M 10 48 Q 64 30 118 48 L 116 68 Q 64 52 12 68 Z', 'url(#plum)', '#0c060e', 1.6)}
      <path d="M 10 48 Q 64 30 118 48 L 116 68 Q 64 52 12 68 Z" fill="url(#weave)" />
      <path d="M 14 54 Q 64 38 114 54" stroke="#b89ac0" stroke-width="0.9" fill="none" opacity="0.45" />
      <path d="M 14 63 Q 64 47 114 63" stroke="#0a040c" stroke-width="1.4" fill="none" opacity="0.6" />
      ${rope('M 8 52 Q 64 34 120 52', 5.4)}
      ${rope('M 10 64 Q 64 46 118 64', 4.6)}
      ${rope('M 26 44 L 30 66 M 96 44 L 92 66', 4)}
      ${rope('M 58 54 Q 50 72 46 88', 5)}
      ${rope('M 70 54 Q 78 70 80 80', 5)}
      <circle cx="64" cy="53" r="9.5" fill="#2a1c0c" />
      <circle cx="64" cy="53" r="8.2" fill="url(#hemp)" />
      <path d="M 57 49 Q 64 56 71 49 M 57 55 Q 64 62 71 55 M 60 46 Q 64 52 68 46" stroke="#4c3a20" stroke-width="1.4" fill="none" />
      <path d="M 59 49 Q 62 47 66 48" stroke="#fff0c8" stroke-width="1" fill="none" opacity="0.7" />
      <path d="M 46 88 l -4 9 M 46 88 l -1 10 M 46 88 l 2 9 M 46 88 l 4 8" stroke="#c8ae78" stroke-width="1.3" stroke-linecap="round" />
      ${bell(81, 80, 1.05)}
      <circle cx="81" cy="96" r="14" fill="url(#tallow)" opacity="0.25" />
    `,
  },
  {
    id: 'sextons_spadehaft',
    bgDark: '#060607',
    bgMid: '#191a1c',
    bgGlow: '#3e4046',
    svgArt: `
      <!-- The Sexton's long-hafted digging spade on the diagonal: a worn
           round-point iron blade with a foot tread and grave dirt on its
           edge, an ash haft bound with rope, a wooden D-grip -->
      ${ground(64, 112, 44, 6, 0.4)}
      <g transform="rotate(42 64 64)">
        ${drop('M 61 50 L 67 50 L 67 112 L 61 112 Z M 64 4 Q 86 8 86 30 L 86 42 L 90 44 L 90 49 L 38 49 L 38 44 L 42 42 L 42 30 Q 42 8 64 4 Z')}
        ${vol('M 61 48 L 67 48 L 67 110 L 61 110 Z', 'url(#wood)', '#140a04', 1.3)}
        <path d="M 63 52 L 63 106 M 65.4 60 L 65.4 100" stroke="#2a180a" stroke-width="0.7" opacity="0.7" />
        ${vol('M 54 108 Q 54 124 64 124 Q 74 124 74 108 L 69 108 Q 69 119 64 119 Q 59 119 59 108 Z', 'url(#wood)', '#140a04', 1.3)}
        ${vol('M 57 114 L 71 114 L 71 118 L 57 118 Z', 'url(#wood)', '#140a04', 1)}
        ${rope('M 60 84 L 68 88 M 60 89 L 68 93 M 60 94 L 68 98', 2.6)}
        ${vol('M 58 46 L 70 46 L 69 60 L 59 60 Z', 'url(#iron)', '#0a0c0e', 1.2)}
        ${rivets([[64, 53]], 1.5)}
        ${vol('M 64 4 Q 86 8 86 30 L 86 42 L 90 44 L 90 49 L 38 49 L 38 44 L 42 42 L 42 30 Q 42 8 64 4 Z', 'url(#iron)', '#0a0c0e', 1.6)}
        <path d="M 46 30 Q 46 12 64 8" stroke="#f0f2f4" stroke-width="1.6" fill="none" opacity="0.75" />
        <path d="M 38 44 L 90 44" stroke="#d0d4d8" stroke-width="1" opacity="0.6" />
        <path d="M 64 16 L 64 40" stroke="#14161a" stroke-width="1.6" opacity="0.6" />
        <path d="M 52 30 Q 56 22 60 28 M 72 26 Q 76 32 80 30" stroke="#5a3a1a" stroke-width="1.6" fill="none" opacity="0.6" />
        <path d="M 45 24 Q 48 9 64 6 Q 81 8 84 25 Q 79 20 74 25 Q 69 18 63 24 Q 56 17 51 23 Q 48 20 45 24 Z" fill="url(#dirt)" opacity="0.92" />
        <path d="M 52 12 Q 58 8 64 8" stroke="#a07a50" stroke-width="1.2" fill="none" opacity="0.8" />
        ${dirt([
          [60, 28, 0.55],
          [72, 30, 0.45],
          [52, 30, 0.4],
        ])}
      </g>
    `,
  },
  // ---- Rimeweb ----
  {
    id: 'rimesilk_mantle',
    bgDark: '#04070c',
    bgMid: '#0e1c2a',
    bgGlow: '#2c4c66',
    svgArt: `
      <!-- A pale rime-silk shoulder mantle seen from the front: a chitin
           collar round the neck opening, web filigree spun over both
           shoulders, a dagged hem hung with icicle tassels and a little
           frost-spider clasp at the throat -->
      ${ground(64, 106, 48, 7, 0.5)}
      ${drop(MANTLE)}
      ${vol(MANTLE, 'url(#rimesilk)', '#14283a', 1.8)}
      <path d="${MANTLE}" fill="url(#weave)" />
      <clipPath id="mantleclip"><path d="${MANTLE}" /></clipPath>
      <g clip-path="url(#mantleclip)">
        ${web(36, 50, 24, 9, 3, 200, '#ffffff', 0.55, 0.6)}
        ${web(92, 50, 24, 9, 3, -20, '#ffffff', 0.55, 0.6)}
        <ellipse cx="38" cy="46" rx="18" ry="12" fill="#ffffff" opacity="0.18" />
        <ellipse cx="90" cy="46" rx="18" ry="12" fill="#ffffff" opacity="0.1" />
      </g>
      <path d="M 30 44 Q 40 60 40 80 M 98 44 Q 88 60 88 80 M 52 46 Q 54 64 56 86 M 76 46 Q 74 64 72 86" stroke="#4a7890" stroke-width="1.8" fill="none" opacity="0.5" />
      <path d="M 22 50 Q 32 32 50 28 M 106 50 Q 96 32 78 28" stroke="#ffffff" stroke-width="1.6" fill="none" opacity="0.7" />
      ${[
        [16, 76],
        [30, 84],
        [48, 86],
        [64, 88],
        [80, 86],
        [98, 84],
        [112, 76],
      ]
        .map(
          ([x, y], i) =>
            `<path d="M ${x - 2.2} ${y - 3} L ${x} ${y + 8 + (i % 2) * 4} L ${x + 2.2} ${y - 3} Z" fill="url(#chitin)" stroke="#2a4a60" stroke-width="0.5" />`,
        )
        .join('')}
      <ellipse cx="64" cy="30" rx="17" ry="7" fill="#06101a" />
      <path d="M 47 30 Q 64 42 81 30" stroke="url(#chitin)" stroke-width="5" fill="none" stroke-linecap="round" />
      <path d="M 47 30 Q 64 24 81 30" stroke="url(#chitin)" stroke-width="2.6" fill="none" opacity="0.8" />
      <ellipse cx="64" cy="44" rx="11" ry="8" fill="url(#frostglow)" opacity="0.75" />
      ${vol('M 59 39 Q 64 34 69 39 Q 71 45 64 50 Q 57 45 59 39 Z', 'url(#chitin)', '#1a3040', 1.1)}
      <path d="M 59 40 L 52 36 M 59 43 L 51 44 M 60 46 L 53 51 M 69 40 L 76 36 M 69 43 L 77 44 M 68 46 L 75 51" stroke="#1a3040" stroke-width="1.5" stroke-linecap="round" />
      <path d="M 64 40 L 61.6 43 L 64 46 L 66.4 43 Z" fill="#7ec4ea" />
      ${rime([
        [28, 44],
        [38, 36],
        [90, 36],
        [100, 44],
      ])}
      ${glint(34, 40, 0.8)}
    `,
  },
  {
    id: 'bonechill_carapace_vest',
    bgDark: '#04070a',
    bgMid: '#111e28',
    bgGlow: '#2e4a5e',
    svgArt: `
      <!-- A mail hauberk plated across the chest with pale frost-widow
           chitin, the widow's icy hourglass on the breast and two curled
           spider legs rising at the shoulders -->
      ${ground(64, 112, 44, 6, 0.5)}
      ${drop('M 30 22 L 48 16 Q 64 24 80 16 L 98 22 L 110 42 L 100 54 L 96 108 L 32 108 L 28 54 L 18 42 Z')}
      ${vol('M 30 22 L 48 16 Q 64 24 80 16 L 98 22 L 110 42 L 100 54 L 96 108 L 32 108 L 28 54 L 18 42 Z', 'url(#mail)', '#0c1014', 1.8)}
      <path d="M 30 22 L 48 16 Q 64 24 80 16 L 98 22 L 110 42 L 100 54 L 96 108 L 32 108 L 28 54 L 18 42 Z" fill="url(#mailpat)" />
      <path d="M 18 42 L 30 22 L 40 30 L 28 54 Z M 110 42 L 98 22 L 88 30 L 100 54 Z" fill="#000" opacity="0.25" />
      ${vol('M 40 30 Q 64 40 88 30 L 92 52 Q 64 62 36 52 Z', 'url(#chitin)', '#1a3040', 1.4)}
      ${vol('M 38 56 Q 64 66 90 56 L 90 74 Q 64 84 38 74 Z', 'url(#chitin)', '#1a3040', 1.4)}
      ${vol('M 40 78 Q 64 88 88 78 L 86 96 Q 64 106 42 96 Z', 'url(#chitin)', '#1a3040', 1.4)}
      <path d="M 44 34 Q 64 42 84 34 M 42 60 Q 64 68 86 60 M 44 82 Q 64 90 84 82" stroke="#ffffff" stroke-width="1.2" fill="none" opacity="0.7" />
      <circle cx="64" cy="66" r="15" fill="url(#frostglow)" opacity="0.65" />
      <path d="M 57 56 L 71 56 L 65 66 L 71 76 L 57 76 L 63 66 Z" fill="#6ac0f0" stroke="#e8f8ff" stroke-width="1.1" />
      ${['M 32 24 L 16 15 L 25 2', 'M 96 24 L 112 15 L 103 2']
        .map(
          (d) =>
            `<path d="${d}" stroke="#14283a" stroke-width="7" fill="none" stroke-linejoin="round" stroke-linecap="round" /><path d="${d}" stroke="url(#chitin)" stroke-width="4.6" fill="none" stroke-linejoin="round" stroke-linecap="round" />`,
        )
        .join('')}
      <circle cx="16" cy="15" r="3" fill="url(#chitin)" stroke="#14283a" stroke-width="1" />
      <circle cx="112" cy="15" r="3" fill="url(#chitin)" stroke="#14283a" stroke-width="1" />
      <path d="M 26 20 L 17 14.5 M 102 20 L 111 14.5" stroke="#ffffff" stroke-width="1" opacity="0.75" />
      ${rime([
        [44, 30],
        [56, 34, 0.8],
        [72, 34, 0.8],
        [84, 30],
        [36, 100, 0.8],
        [92, 100, 0.8],
      ])}
      ${glint(78, 44, 0.7)}
    `,
  },
  {
    id: 'rimeweb_hunters_leggings',
    bgDark: '#05070a',
    bgMid: '#16202a',
    bgGlow: '#344a5c',
    svgArt: `
      <!-- A hunter's supple leather leggings, the shins bound criss-cross
           with frost-white web silk, chitin knee guards rimed with frost -->
      ${ground(64, 114, 40, 6, 0.5)}
      ${drop('M 34 14 L 94 14 L 92 40 L 86 112 L 68 112 L 64 50 L 60 112 L 42 112 L 36 40 Z')}
      ${vol('M 34 14 L 94 14 L 92 40 L 86 112 L 68 112 L 64 50 L 60 112 L 42 112 L 36 40 Z', 'url(#leather)', '#140a04', 1.8)}
      <path d="M 50 20 Q 48 60 52 108 M 78 20 Q 80 60 76 108" stroke="#2a180a" stroke-width="1.2" fill="none" opacity="0.6" stroke-dasharray="3 2" />
      ${vol('M 33 12 L 95 12 L 95 21 L 33 21 Z', 'url(#darkleather)', '#0e0806', 1.3)}
      ${vol('M 60 12 L 68 12 L 68 21 L 60 21 Z', 'url(#silver)', '#1a1c24', 1)}
      ${[
        [44, 76, 60, 104],
        [60, 76, 44, 104],
        [42, 86, 60, 96],
        [68, 76, 84, 104],
        [84, 76, 68, 104],
        [68, 96, 86, 86],
      ]
        .map(
          ([x1, y1, x2, y2]) =>
            `<path d="M ${x1} ${y1} L ${x2} ${y2}" stroke="#eef8ff" stroke-width="2.2" stroke-linecap="round" opacity="0.9" />`,
        )
        .join('')}
      ${vol('M 40 56 Q 51 48 61 56 L 59 70 Q 50 76 42 70 Z', 'url(#chitin)', '#1a3040', 1.2)}
      ${vol('M 67 56 Q 77 48 88 56 L 86 70 Q 78 76 69 70 Z', 'url(#chitin)', '#1a3040', 1.2)}
      <path d="M 44 58 Q 51 54 57 58 M 71 58 Q 78 54 84 58" stroke="#ffffff" stroke-width="1" fill="none" opacity="0.7" />
      ${web(44, 30, 14, 7, 2, 10, '#eef8ff', 0.45, 0.5)}
      ${rime([
        [44, 54],
        [56, 54, 0.8],
        [72, 54, 0.8],
        [84, 54],
        [46, 110, 0.7],
        [82, 110, 0.7],
      ])}
    `,
  },
  {
    id: 'rimeweb_fang',
    bgDark: '#03060a',
    bgMid: '#0c1a28',
    bgGlow: '#25476a',
    svgArt: `
      <!-- A dagger whose blade is one great curved fang of the Rimeweb, ivory
           at the root and ice-clear at the venom-beaded tip; quillons of two
           curled chitin legs, a silk-wound grip, a frosted egg-sac pommel -->
      ${ground(64, 112, 40, 5, 0.4)}
      <path d="M 30 100 Q 70 70 104 18" stroke="#000" stroke-width="12" opacity="0.3" stroke-linecap="round" transform="translate(4 4)" />
      ${vol('M 42 78 Q 50 50 78 32 Q 96 20 112 12 Q 104 32 92 50 Q 78 72 60 94 Z', 'url(#fang)', '#18304a', 1.6)}
      <path d="M 48 80 Q 58 54 82 36 Q 98 24 110 14" stroke="#ffffff" stroke-width="1.5" fill="none" opacity="0.85" />
      <path d="M 56 84 Q 70 62 90 42 Q 100 30 109 16" stroke="#2a5a80" stroke-width="1.2" fill="none" opacity="0.55" />
      <path d="M 50 76 Q 54 66 60 60 M 52 82 Q 58 74 64 68" stroke="#a88a60" stroke-width="1" fill="none" opacity="0.55" />
      <circle cx="108" cy="18" r="8" fill="url(#frostglow)" opacity="0.9" />
      <path d="M 110 16 Q 113 21 110 24 Q 107 21 110 16 Z" fill="#c8f0ff" stroke="#4a8ab0" stroke-width="0.5" />
      <path d="M 40 72 Q 30 70 26 60 Q 24 54 30 52 M 58 92 Q 60 102 70 106 Q 76 108 78 102" stroke="url(#chitin)" stroke-width="4.4" fill="none" stroke-linecap="round" />
      <path d="M 40 72 Q 30 70 26 60 M 58 92 Q 60 102 70 106" stroke="#1a3040" stroke-width="0.8" fill="none" />
      ${vol('M 38 76 Q 46 72 56 82 Q 60 88 56 94 Q 48 92 38 82 Z', 'url(#chitin)', '#1a3040', 1.2)}
      ${vol('M 40 88 L 50 96 L 32 112 L 24 106 Z', 'url(#rimesilk)', '#1a3040', 1.2)}
      <path d="M 37 92 L 45 98 M 33 96 L 41 102 M 29 100 L 37 106" stroke="#4a7890" stroke-width="1.2" />
      <circle cx="24" cy="113" r="6.4" fill="url(#chitin)" stroke="#1a3040" stroke-width="1.2" />
      <path d="M 20 112 Q 23 108 27 110" stroke="#ffffff" stroke-width="1" fill="none" opacity="0.8" />
      ${glint(92, 34, 0.8)}
    `,
  },
  // ---- Cantor Ilvane ----
  {
    id: 'cantors_cassock',
    bgDark: '#06040a',
    bgMid: '#1c1426',
    bgGlow: '#443258',
    svgArt: `
      <!-- The Cantor's ankle-length black-violet cassock with wide bell
           sleeves: a white clerical band at the collar, a line of silver
           buttons down the front and a tallow-gold choir stole worked with
           little bells -->
      ${ground(64, 114, 46, 6, 0.5)}
      ${drop(CASSOCK)}
      ${vol(CASSOCK, 'url(#cassock)', '#06040a', 1.8)}
      <path d="${CASSOCK}" fill="url(#weave)" />
      <path d="M 40 60 Q 36 88 30 110 M 52 58 Q 50 88 48 112 M 76 58 Q 78 88 80 112 M 88 60 Q 92 88 98 110" stroke="#000" stroke-width="2.4" fill="none" opacity="0.45" />
      <path d="M 43 60 Q 39 88 34 110 M 85 60 Q 89 88 94 110" stroke="#a88ab8" stroke-width="1.1" fill="none" opacity="0.45" />
      <path d="M 34 30 Q 26 44 20 56 M 94 30 Q 102 44 108 56" stroke="#a88ab8" stroke-width="1" fill="none" opacity="0.4" />
      ${vol('M 14 56 L 28 62 L 30 56 L 18 50 Z', 'url(#linen)', '#3a3440', 1)}
      ${vol('M 114 56 L 100 62 L 98 56 L 110 50 Z', 'url(#linen)', '#3a3440', 1)}
      ${vol('M 50 12 L 78 12 Q 76 24 64 26 Q 52 24 50 12 Z', 'url(#linen)', '#3a3440', 1.2)}
      ${vol('M 46 16 L 55 24 L 54 108 L 44 112 Z', 'url(#bronze)', '#2a1806', 1.2)}
      ${vol('M 82 16 L 73 24 L 74 108 L 84 112 Z', 'url(#bronze)', '#2a1806', 1.2)}
      <path d="M 47 20 L 47 106 M 81 20 L 81 106" stroke="#fff0c8" stroke-width="0.9" opacity="0.6" />
      ${[44, 64, 84].map((y) => `<path d="M 50 ${y - 3} q -2.4 4 -2.8 6.5 l 5.6 0 q -0.4 -2.5 -2.8 -6.5 Z M 78 ${y - 3} q -2.4 4 -2.8 6.5 l 5.6 0 q -0.4 -2.5 -2.8 -6.5 Z" fill="#3a2410" />`).join('')}
      ${[34, 46, 58, 70, 82, 94, 106]
        .map(
          (y) =>
            `<circle cx="64" cy="${y}" r="2.2" fill="url(#silver)" stroke="#14101a" stroke-width="0.6" />`,
        )
        .join('')}
      <path d="M 44 108 L 55 106 L 55 114 L 44 116 Z M 73 106 L 84 108 L 84 116 L 73 114 Z" fill="#e8c070" opacity="0.9" />
    `,
  },
  {
    id: 'choirward_leggings',
    bgDark: '#05050a',
    bgMid: '#16162a',
    bgGlow: '#36365a',
    svgArt: `
      <!-- Mail leggings under a choir-violet tabard flap embroidered with a
           silver bell, polished steel knee cops -->
      ${ground(64, 114, 40, 6, 0.5)}
      ${drop('M 34 14 L 94 14 L 92 40 L 86 112 L 68 112 L 64 50 L 60 112 L 42 112 L 36 40 Z')}
      ${vol('M 34 14 L 94 14 L 92 40 L 86 112 L 68 112 L 64 50 L 60 112 L 42 112 L 36 40 Z', 'url(#mail)', '#0c0e12', 1.8)}
      <path d="M 34 14 L 94 14 L 92 40 L 86 112 L 68 112 L 64 50 L 60 112 L 42 112 L 36 40 Z" fill="url(#mailpat)" />
      ${vol('M 33 12 L 95 12 L 95 21 L 33 21 Z', 'url(#darkleather)', '#0e0806', 1.3)}
      ${vol('M 50 20 L 78 20 L 76 66 L 64 74 L 52 66 Z', 'url(#plum)', '#0a040e', 1.4)}
      <path d="M 50 20 L 78 20 L 76 66 L 64 74 L 52 66 Z" fill="url(#weave)" />
      <path d="M 53 24 L 75 24 L 73 64 L 64 70 L 55 64 Z" fill="none" stroke="#c8ccd8" stroke-width="1" opacity="0.7" />
      <path d="M 64 34 Q 57 36 57 50 L 54 54 L 74 54 L 71 50 Q 71 36 64 34 Z" fill="url(#silver)" stroke="#1a1c24" stroke-width="0.9" />
      <circle cx="64" cy="57" r="2.2" fill="url(#silver)" />
      <circle cx="64" cy="32" r="1.8" fill="none" stroke="#e8ecf4" stroke-width="1" />
      ${vol('M 38 74 Q 48 66 58 74 L 57 86 Q 48 92 40 86 Z', 'url(#steel)', '#14181c', 1.2)}
      ${vol('M 70 74 Q 80 66 90 74 L 88 86 Q 80 92 71 86 Z', 'url(#steel)', '#14181c', 1.2)}
      ${rivets(
        [
          [43, 80],
          [53, 80],
          [75, 80],
          [85, 80],
        ],
        1.2,
      )}
    `,
  },
  {
    id: 'choristers_gloves',
    bgDark: '#070508',
    bgMid: '#1e1418',
    bgGlow: '#4a3238',
    svgArt: `
      <!-- A pair of supple chorister's gloves in dark leather, the deep
           violet cuffs stitched with a stave of tiny silver notes, a small
           silver chime on a ribbon at one wrist -->
      ${ground(64, 110, 44, 6, 0.5)}
      <g transform="rotate(-10 44 64)">
        ${drop('M 26 92 L 28 50 Q 28 44 32 44 L 32 22 Q 32 18 36 18 Q 40 18 40 22 L 40 40 L 42 16 Q 42 12 46 12 Q 50 12 50 16 L 50 40 L 52 18 Q 52 14 56 14 Q 60 14 60 18 L 60 44 L 62 28 Q 62 24 66 24 Q 70 24 70 28 L 68 70 L 64 92 Z')}
        ${vol('M 26 92 L 28 50 Q 28 44 32 44 L 32 22 Q 32 18 36 18 Q 40 18 40 22 L 40 40 L 42 16 Q 42 12 46 12 Q 50 12 50 16 L 50 40 L 52 18 Q 52 14 56 14 Q 60 14 60 18 L 60 44 L 62 28 Q 62 24 66 24 Q 70 24 70 28 L 68 70 L 64 92 Z', 'url(#darkleather)', '#0a0604', 1.6)}
        <path d="M 40 40 L 40 50 M 50 40 L 50 50 M 60 44 L 60 52" stroke="#0a0604" stroke-width="1" />
        ${vol('M 22 82 L 68 82 L 66 104 L 24 104 Z', 'url(#plum)', '#0a040e', 1.4)}
        <path d="M 26 90 L 64 90 M 26 96 L 64 96" stroke="#c8ccd8" stroke-width="0.6" opacity="0.6" />
        ${notes(
          [
            [34, 94, 0.55, 0.95],
            [44, 92, 0.55, 0.95],
            [54, 95, 0.55, 0.95],
          ],
          '#eef0f8',
        )}
      </g>
      <g transform="rotate(12 86 66)">
        ${drop('M 64 98 L 66 56 Q 66 50 70 50 L 70 28 Q 70 24 74 24 Q 78 24 78 28 L 78 46 L 80 22 Q 80 18 84 18 Q 88 18 88 22 L 88 46 L 90 24 Q 90 20 94 20 Q 98 20 98 24 L 98 50 L 100 34 Q 100 30 104 30 Q 108 30 108 34 L 106 76 L 102 98 Z')}
        ${vol('M 64 98 L 66 56 Q 66 50 70 50 L 70 28 Q 70 24 74 24 Q 78 24 78 28 L 78 46 L 80 22 Q 80 18 84 18 Q 88 18 88 22 L 88 46 L 90 24 Q 90 20 94 20 Q 98 20 98 24 L 98 50 L 100 34 Q 100 30 104 30 Q 108 30 108 34 L 106 76 L 102 98 Z', 'url(#darkleather)', '#0a0604', 1.6)}
        <path d="M 74 30 L 74 46 M 84 24 L 84 44 M 94 26 L 94 46" stroke="#a88a72" stroke-width="0.9" opacity="0.5" />
        ${vol('M 60 88 L 106 88 L 104 110 L 62 110 Z', 'url(#plum)', '#0a040e', 1.4)}
        <path d="M 64 96 L 102 96 M 64 102 L 102 102" stroke="#c8ccd8" stroke-width="0.6" opacity="0.6" />
        ${notes(
          [
            [72, 100, 0.55, 0.95],
            [82, 98, 0.55, 0.95],
            [92, 101, 0.55, 0.95],
          ],
          '#eef0f8',
        )}
      </g>
      <path d="M 100 100 Q 106 104 104 110" stroke="#c03a3a" stroke-width="2" fill="none" />
      <path d="M 104 108 q -4 4 -4 9 l 8 0 q 0 -5 -4 -9 Z" fill="url(#silver)" stroke="#1a1c24" stroke-width="0.8" />
    `,
  },
  {
    id: 'cantors_hymnal',
    bgDark: '#070408',
    bgMid: '#20121a',
    bgGlow: '#4e2c3a',
    svgArt: `
      <!-- The Cantor's thick hymnal, shut: crimson leather boards with brass
           corners, a bone clasp, an embossed bell on the cover and two silk
           marker ribbons; a faint spectral note slips from the pages -->
      ${ground(64, 110, 42, 6, 0.55)}
      ${drop('M 30 20 L 96 16 L 102 98 L 36 104 Z')}
      ${vol('M 36 26 L 100 22 L 104 100 L 40 106 Z', 'url(#parchment)', '#3a2a10', 1.2)}
      <path d="M 100 30 L 103 96 M 98 28 L 101 98 M 96 26 L 99 100" stroke="#8a7040" stroke-width="0.6" opacity="0.7" />
      ${vol('M 28 18 L 94 14 L 98 94 L 32 100 Z', 'url(#crimson)', '#1a0406', 1.8)}
      ${vol('M 22 20 Q 26 16 30 18 L 34 100 Q 30 104 26 100 Z', 'url(#crimson)', '#1a0406', 1.4)}
      <path d="M 24 30 L 30 30 M 25 50 L 31 50 M 25 70 L 32 70 M 26 90 L 33 90" stroke="#e8b060" stroke-width="1.4" opacity="0.8" />
      <path d="M 36 24 L 88 21 L 91 88 L 39 92 Z" fill="none" stroke="#e0a858" stroke-width="1.2" opacity="0.65" />
      ${vol('M 28 18 L 40 17 L 29 29 Z', 'url(#bronze)', '#2a1806', 1)}
      ${vol('M 94 14 L 82 15 L 95 26 Z', 'url(#bronze)', '#2a1806', 1)}
      ${vol('M 32 100 L 44 99 L 31 88 Z', 'url(#bronze)', '#2a1806', 1)}
      ${vol('M 98 94 L 86 95 L 97 82 Z', 'url(#bronze)', '#2a1806', 1)}
      <path d="M 63 36 Q 54 38 54 54 L 50 60 L 76 58 L 72 52 Q 72 36 63 36 Z" fill="url(#bronze)" stroke="#2a1806" stroke-width="1.1" opacity="0.95" />
      <path d="M 57 42 Q 57 52 54 56" stroke="#fff0c8" stroke-width="1.1" fill="none" opacity="0.8" />
      <circle cx="64" cy="62" r="2.6" fill="url(#bronze)" />
      ${vol('M 92 50 L 108 49 L 109 63 L 93 64 Z', 'url(#bone)', '#4a3e28', 1.2)}
      <circle cx="102" cy="56" r="2.2" fill="#4a3e28" />
      <path d="M 52 100 L 50 118 L 54 114 L 56 118 L 56 100 Z" fill="#7a3ac0" />
      <path d="M 62 99 L 63 114 L 66 110 L 69 114 L 67 99 Z" fill="#e8c070" />
      <circle cx="104" cy="30" r="12" fill="url(#violetglow)" opacity="0.55" />
      ${notes([[102, 34, 0.9, 0.85]], '#efe4ff')}
    `,
  },
  {
    // The Heroic clone of the hymnal (content/heroic_variants.ts): the same
    // book thrown open, its hymn rising off the pages in spectral violet.
    id: 'heroic_cantors_hymnal',
    bgDark: '#06030c',
    bgMid: '#1e1032',
    bgGlow: '#4a2a74',
    svgArt: `
      <!-- The Cantor's hymnal thrown open on its crimson boards, the pages
           alight and the hymn rising off them in ghostly violet notes -->
      ${ground(64, 112, 48, 6, 0.55)}
      <circle cx="64" cy="54" r="46" fill="url(#violetglow)" opacity="0.6" />
      ${drop('M 8 72 L 60 64 L 64 70 L 68 64 L 120 72 L 112 104 L 66 98 L 64 102 L 62 98 L 16 104 Z')}
      ${vol('M 8 72 L 60 64 L 64 70 L 68 64 L 120 72 L 112 104 L 66 98 L 64 102 L 62 98 L 16 104 Z', 'url(#crimson)', '#1a0406', 1.6)}
      ${vol('M 14 70 Q 38 60 62 66 L 62 96 Q 38 90 18 98 Z', 'url(#parchment)', '#3a2a10', 1.1)}
      ${vol('M 114 70 Q 90 60 66 66 L 66 96 Q 90 90 110 98 Z', 'url(#parchment)', '#3a2a10', 1.1)}
      <path d="M 62 66 L 62 96 M 66 66 L 66 96" stroke="#5a4020" stroke-width="1.2" />
      ${[74, 79, 84, 89].map((y) => `<path d="M 22 ${y} Q 40 ${y - 6} 58 ${y - 2} M 70 ${y - 2} Q 88 ${y - 6} 106 ${y}" stroke="#8a6a3a" stroke-width="0.8" fill="none" opacity="0.7" />`).join('')}
      ${notes(
        [
          [32, 80, 0.5, 0.9],
          [44, 78, 0.5, 0.9],
          [84, 78, 0.5, 0.9],
          [96, 80, 0.5, 0.9],
        ],
        '#5a3a7a',
      )}
      <path d="M 16 104 L 112 104" stroke="#e8b060" stroke-width="1" opacity="0.5" />
      ${vol('M 8 72 L 18 71 L 10 82 Z', 'url(#bronze)', '#2a1806', 1)}
      ${vol('M 120 72 L 110 71 L 118 82 Z', 'url(#bronze)', '#2a1806', 1)}
      <path d="M 66 100 L 64 118 L 68 114 L 71 118 L 71 100 Z" fill="#e8c070" />
      <path d="M 40 66 Q 30 44 44 30 M 64 64 Q 66 40 58 18 M 88 66 Q 100 46 90 28" stroke="#e4d0ff" stroke-width="2" fill="none" opacity="0.5" />
      ${notes(
        [
          [40, 46, 1.2, 0.95],
          [60, 30, 1.35, 1],
          [84, 42, 1.15, 0.95],
          [50, 16, 0.9, 0.8],
          [76, 20, 0.9, 0.8],
          [100, 26, 0.8, 0.7],
          [26, 30, 0.8, 0.7],
        ],
        '#f4ecff',
      )}
      ${glint(64, 62, 1.1, '#fff8ff')}
    `,
  },
  // ---- Morthen the Gravecaller ----
  {
    id: 'gravecallers_vestments',
    bgDark: '#040806',
    bgMid: '#0e1c14',
    bgGlow: '#2a5038',
    svgArt: `
      <!-- Morthen's Gravecaller vestments: grave-black robes with ragged
           sleeves, a spiked violet collar, a ribcage of bone sewn over the
           breast, a grinning skull clasp at the throat and soul-green light
           seeping from the tattered hem -->
      ${ground(64, 114, 46, 6, 0.55)}
      <ellipse cx="64" cy="108" rx="40" ry="9" fill="url(#soul)" opacity="0.6" />
      ${drop(GRAVEROBE)}
      ${vol(GRAVEROBE, 'url(#gravecloth)', '#030604', 1.8)}
      <path d="${GRAVEROBE}" fill="url(#weave)" />
      <path d="M 58 34 L 70 34 L 72 106 L 56 106 Z" fill="url(#plum)" />
      <path d="M 42 60 Q 38 84 34 104 M 86 60 Q 90 84 94 104" stroke="#000" stroke-width="2.2" fill="none" opacity="0.45" />
      <path d="M 45 60 Q 41 84 38 104 M 83 60 Q 87 84 90 104" stroke="#9ab89a" stroke-width="1" fill="none" opacity="0.4" />
      <path d="M 24 112 L 36 106 L 46 114 L 56 106 L 64 114 L 72 106 L 82 114 L 92 106 L 104 112" stroke="#9cf8b4" stroke-width="1.3" fill="none" opacity="0.75" />
      <path d="M 12 60 L 22 66 L 26 58 L 30 62 M 116 60 L 106 66 L 102 58 L 98 62" stroke="#9cf8b4" stroke-width="1" fill="none" opacity="0.55" />
      ${vol('M 30 18 L 42 4 L 50 20 L 64 14 L 78 20 L 86 4 L 98 18 L 88 32 Q 64 42 40 32 Z', 'url(#plum)', '#0a040e', 1.4)}
      <path d="M 34 18 L 42 8 M 94 18 L 86 8" stroke="#d0b0e8" stroke-width="1" opacity="0.6" />
      ${[0, 1, 2, 3].map((i) => `<path d="M 64 ${50 + i * 9} Q ${50 - i} ${48 + i * 9} ${42 + i * 1.5} ${56 + i * 10} M 64 ${50 + i * 9} Q ${78 + i} ${48 + i * 9} ${86 - i * 1.5} ${56 + i * 10}" stroke="#2a2418" stroke-width="${4.6 - i * 0.3}" fill="none" stroke-linecap="round" /><path d="M 64 ${50 + i * 9} Q ${50 - i} ${48 + i * 9} ${42 + i * 1.5} ${56 + i * 10} M 64 ${50 + i * 9} Q ${78 + i} ${48 + i * 9} ${86 - i * 1.5} ${56 + i * 10}" stroke="url(#bone)" stroke-width="${3.2 - i * 0.3}" fill="none" stroke-linecap="round" />`).join('')}
      ${vol('M 61 44 L 67 44 L 67 86 L 61 86 Z', 'url(#bone)', '#3a3020', 0.9)}
      <circle cx="64" cy="30" r="13" fill="url(#soul)" opacity="0.55" />
      ${vol('M 55 28 Q 55 18 64 18 Q 73 18 73 28 Q 73 34 69 36 L 69 41 L 59 41 L 59 36 Q 55 34 55 28 Z', 'url(#bone)', '#2a2216', 1.2)}
      <path d="M 57.5 28 Q 60 25 62.5 28 Q 61.5 31.5 59 31.5 Q 57 31 57.5 28 Z M 65.5 28 Q 68 25 70.5 28 Q 71 31 69 31.5 Q 66.5 31.5 65.5 28 Z" fill="#0a0806" />
      <circle cx="60" cy="29" r="1.3" fill="#c8ffd8" /><circle cx="68" cy="29" r="1.3" fill="#c8ffd8" />
      <path d="M 63 32 L 64 34.5 L 65 32 Z" fill="#0a0806" />
      <path d="M 61 37 L 61 41 M 63 37 L 63 41 M 65 37 L 65 41 M 67 37 L 67 41" stroke="#2a2216" stroke-width="0.8" />
      <path d="M 57 22 Q 61 19 65 19.5" stroke="#ffffff" stroke-width="1" fill="none" opacity="0.8" />
    `,
  },
  {
    id: 'unquiet_stalkers_hood',
    bgDark: '#050605',
    bgMid: '#151a16',
    bgGlow: '#36432f',
    svgArt: `
      <!-- A ragged stalker's hood of dark grave-worn leather with a swept
           peak, a bone jaw guard strapped across the face and pale soul-green
           eyes burning in its shadow, a cord of finger-bone tokens at the
           brow -->
      ${ground(64, 112, 44, 6, 0.55)}
      ${drop(STALKER_HOOD)}
      ${vol(STALKER_HOOD, 'url(#darkleather)', '#080604', 1.8)}
      <path d="M 52 10 Q 56 26 62 34 M 40 26 Q 46 36 44 48 M 90 24 Q 84 36 86 48 M 30 70 Q 34 84 30 98 M 98 70 Q 94 84 98 98" stroke="#0a0806" stroke-width="1.5" fill="none" opacity="0.7" />
      <path d="M 34 30 Q 50 12 70 10" stroke="#c0a888" stroke-width="1.2" fill="none" opacity="0.45" />
      <path d="M 64 32 Q 90 38 90 66 L 86 94 L 42 94 L 38 66 Q 38 38 64 32 Z" fill="#040504" />
      <path d="M 64 32 Q 90 38 90 66 L 86 94 L 42 94 L 38 66 Q 38 38 64 32 Z" fill="none" stroke="#5a4a3a" stroke-width="1.4" />
      <ellipse cx="64" cy="62" rx="22" ry="16" fill="url(#soul)" opacity="0.35" />
      <circle cx="56" cy="60" r="6" fill="url(#soul)" /><circle cx="72" cy="60" r="6" fill="url(#soul)" />
      <path d="M 51 60 Q 56 55.5 61 60 Q 56 63 51 60 Z M 67 60 Q 72 55.5 77 60 Q 72 63 67 60 Z" fill="#d8ffe4" />
      ${vol('M 42 72 Q 64 66 86 72 L 82 88 Q 64 96 46 88 Z', 'url(#bone)', '#3a3020', 1.3)}
      ${[50, 56, 62, 68, 74, 80].map((x) => `<path d="M ${x} ${74 - Math.abs(64 - x) * 0.08} L ${x} ${86 - Math.abs(64 - x) * 0.15}" stroke="#4a3e28" stroke-width="1" />`).join('')}
      <path d="M 44 76 Q 64 70 84 76" stroke="#fffaf0" stroke-width="1" fill="none" opacity="0.7" />
      <path d="M 26 74 L 44 78 M 102 74 L 84 78" stroke="url(#leather)" stroke-width="3.4" />
      ${rivets(
        [
          [44, 78],
          [84, 78],
        ],
        1.4,
      )}
      <path d="M 36 34 Q 64 24 92 34" stroke="#2a1c10" stroke-width="2" fill="none" />
      ${[44, 54, 64, 74, 84].map((x, i) => `<path d="M ${x} ${31 - (i === 2 ? 3.4 : i % 2 ? 2.4 : 0)} l -1.7 7.5 l 3.4 0 Z" fill="url(#bone)" stroke="#3a3020" stroke-width="0.5" />`).join('')}
    `,
  },
  // ---- Heroic epics ----
  {
    id: 'sextons_burial_spade',
    bgDark: '#060409',
    bgMid: '#1a1024',
    bgGlow: '#3e2a58',
    svgArt: `
      <!-- The Sexton's burial spade, made for the Gravecaller: a blackened
           grave-steel heart-shaped blade pierced with a coffin cross and lit
           with violet grave-light, a bone-wrapped haft, a bone T-grip and a
           little bronze funeral bell tied at the collar -->
      ${ground(64, 112, 44, 6, 0.4)}
      <circle cx="42" cy="38" r="34" fill="url(#violetglow)" opacity="0.45" />
      <g transform="translate(3 3) rotate(-42 64 64)">
        ${drop(`M 61 48 L 67 48 L 67 112 L 61 112 Z ${BURIAL_BLADE}`)}
        ${vol('M 61 46 L 67 46 L 67 108 L 61 108 Z', 'url(#blackiron)', '#06040a', 1.3)}
        ${[56, 65, 74, 83, 92].map((y) => `<path d="M 60 ${y} L 68 ${y + 4} L 68 ${y + 7} L 60 ${y + 3} Z" fill="url(#bone)" stroke="#3a3020" stroke-width="0.5" />`).join('')}
        ${vol('M 48 108 Q 48 104 52 104 L 76 104 Q 80 104 80 108 L 80 112 Q 80 116 76 116 L 52 116 Q 48 116 48 112 Z', 'url(#bone)', '#3a3020', 1.3)}
        ${vol('M 60 100 L 68 100 L 68 106 L 60 106 Z', 'url(#bronze)', '#2a1806', 1)}
        <path d="M 52 106.5 L 76 106.5" stroke="#fffaf0" stroke-width="1" opacity="0.7" />
        ${vol('M 56 42 L 72 42 L 70 54 L 58 54 Z', 'url(#bronze)', '#2a1806', 1.1)}
        ${rivets([[64, 48]], 1.5)}
        ${vol(BURIAL_BLADE, 'url(#gravesteel)', '#06040a', 1.6)}
        <path d="${BURIAL_BLADE}" fill="none" stroke="#c8a0f0" stroke-width="1.2" opacity="0.7" transform="translate(64 26) scale(0.93) translate(-64 -26)" />
        <path d="M 46 42 L 46 10 Q 56 6 64 5" stroke="#f4eeff" stroke-width="1.6" fill="none" opacity="0.8" />
        <path d="M 43 8 Q 64 1 85 8" stroke="#ffffff" stroke-width="1.2" fill="none" opacity="0.7" />
        <path d="M 40 48 L 88 48" stroke="#e0d0f0" stroke-width="1" opacity="0.6" />
        <path d="M 64 8 L 64 46" stroke="#0a0610" stroke-width="1.2" opacity="0.5" />
        <circle cx="64" cy="28" r="13" fill="url(#violetglow)" />
        <path d="M 61.5 15 L 66.5 15 L 66.5 20 L 72 20 L 72 25 L 66.5 25 L 66.5 40 L 61.5 40 L 61.5 25 L 56 25 L 56 20 L 61.5 20 Z" fill="#1a0e26" stroke="#ecdcff" stroke-width="1.2" />
      </g>
      ${bell(74, 78, 0.8)}
      ${glint(30, 24, 0.9, '#f4e8ff')}
    `,
  },
  {
    id: 'rimesilk_hood',
    bgDark: '#04060e',
    bgMid: '#101a34',
    bgGlow: '#2e4274',
    svgArt: `
      <!-- A tall caster's hood spun from shimmering rime silk, a peaked cowl
           falling to wide drapes, frost web filigree over the crown, a
           circlet of ice crystals at the brow and a cold blue light in the
           shadow of the cowl -->
      ${ground(64, 112, 48, 6, 0.5)}
      <circle cx="64" cy="58" r="46" fill="url(#frostglow)" opacity="0.26" />
      ${drop(RIME_HOOD)}
      ${vol(RIME_HOOD, 'url(#rimesilk)', '#18304a', 1.8)}
      <path d="${RIME_HOOD}" fill="url(#weave)" />
      <clipPath id="hoodclip"><path d="${RIME_HOOD}" /></clipPath>
      <g clip-path="url(#hoodclip)">${web(64, 6, 44, 11, 4, 22, '#ffffff', 0.45, 0.55)}</g>
      <path d="M 30 70 Q 28 90 16 102 M 98 70 Q 100 90 112 102 M 36 92 Q 36 100 30 108 M 92 92 Q 92 100 98 108" stroke="#3a6a88" stroke-width="2" fill="none" opacity="0.55" />
      <path d="M 26 64 Q 28 42 44 22 Q 54 10 64 6" stroke="#ffffff" stroke-width="1.8" fill="none" opacity="0.7" />
      <path d="${RIME_HOOD_OPENING}" fill="#050a18" />
      <path d="${RIME_HOOD_OPENING}" fill="none" stroke="#e8f6ff" stroke-width="1.8" />
      <ellipse cx="64" cy="70" rx="20" ry="22" fill="url(#frostglow)" opacity="0.5" />
      <path d="M 54 68 Q 58 64 62 68 Q 58 71 54 68 Z M 66 68 Q 70 64 74 68 Q 70 71 66 68 Z" fill="#e8f8ff" />
      <path d="M 44 42 Q 64 32 84 42" stroke="url(#silver)" stroke-width="2.6" fill="none" />
      ${[
        [48, 39, 0.8],
        [56, 35.5, 1],
        [64, 34, 1.5],
        [72, 35.5, 1],
        [80, 39, 0.8],
      ]
        .map(
          ([x, y, s]) =>
            `<path d="M ${x} ${y - 9 * s} L ${x + 3 * s} ${y} L ${x} ${y + 3 * s} L ${x - 3 * s} ${y} Z" fill="url(#chitin)" stroke="#1a3040" stroke-width="0.6" />`,
        )
        .join('')}
      ${rime([
        [24, 84, 0.8],
        [104, 84, 0.8],
        [40, 106, 0.7],
        [88, 106, 0.7],
      ])}
      ${glint(64, 22, 1.1)}
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
          <radialGradient id="key" cx="22%" cy="18%" r="70%">
            <stop offset="0%" stop-color="#ffe8c0" stop-opacity="0.16" />
            <stop offset="100%" stop-color="#ffe8c0" stop-opacity="0" />
          </radialGradient>
          ${DEFS}
          <filter id="grain" x="0" y="0" width="100%" height="100%">
            <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="23" />
            <feColorMatrix type="matrix" values="0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 0.22 0" />
          </filter>
          <filter id="paint" x="-5%" y="-5%" width="110%" height="110%">
            <feTurbulence type="fractalNoise" baseFrequency="0.06" numOctaves="2" seed="5" result="wob" />
            <feDisplacementMap in="SourceGraphic" in2="wob" scale="1.4" xChannelSelector="R" yChannelSelector="G" result="moved" />
            <feGaussianBlur in="moved" stdDeviation="0.3" />
          </filter>
        </defs>
        <rect width="128" height="128" fill="url(#bgGrad)" />
        <g filter="url(#paint)" transform="translate(64 66) scale(${item.scale ?? 1.04}) translate(-64 -66)">${item.svgArt}</g>
        <rect width="128" height="128" fill="url(#key)" />
        <rect width="128" height="128" fill="url(#shade)" />
        <rect width="128" height="128" filter="url(#grain)" style="mix-blend-mode: overlay" />
      </svg>
    `;
}

async function main() {
  const onlyIds = process.argv.slice(2);
  const items = onlyIds.length
    ? ITEMS_TO_GENERATE.filter(({ id }) => onlyIds.includes(id))
    : ITEMS_TO_GENERATE;
  console.log(`Generating ${items.length} Hollow Crypt WebP icons...`);
  for (const item of items) {
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
