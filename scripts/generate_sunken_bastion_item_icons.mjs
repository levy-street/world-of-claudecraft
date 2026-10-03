// scripts/generate_sunken_bastion_item_icons.mjs
// Generates the shipping 128x128 WebP item icons for the Sunken Bastion rework's
// loot (src/sim/content/sunken_bastion_items.ts and the Gaoler's Iron Key in
// src/sim/content/trinkets.ts). Same recipe as generate_clue_scroll_icons.mjs:
// an authored SVG composition per item over a three-stop radial ground,
// rasterized with Sharp, meeting the woc-item-icon-v1 contract (opaque dark
// vignette, warm top-left key light, cool bottom-right shadow, centered
// silhouette with safe padding, distinct art per item). The script IS the
// retained source: re-running it reproduces every file byte for byte. It never
// touches mapping.json; the generated batch entry there is hand-authored
// (batch sunken-bastion-icons-2026-09-29) with its provenance README under
// docs/achievements/sunken-bastion-icons-2026-09-29/.
//
// Usage: node scripts/generate_sunken_bastion_item_icons.mjs

import path from 'node:path';
import sharp from 'sharp';

const repoRoot = process.cwd();
const itemsDir = path.join(repoRoot, 'public/ui/items');
const OUT_PX = 128;
const MASTER_PX = 512;

// Shared material gradients (steel, verdigris, iron, leather, sea cloth).
const DEFS = `
  <linearGradient id="steel" x1="0%" y1="0%" x2="100%" y2="100%">
    <stop offset="0%" stop-color="#f2f6f4" />
    <stop offset="35%" stop-color="#a9b7b4" />
    <stop offset="70%" stop-color="#5f6f6e" />
    <stop offset="100%" stop-color="#2b3434" />
  </linearGradient>
  <linearGradient id="verdigris" x1="0%" y1="0%" x2="100%" y2="100%">
    <stop offset="0%" stop-color="#9fe0c8" />
    <stop offset="55%" stop-color="#3f8f78" />
    <stop offset="100%" stop-color="#173c34" />
  </linearGradient>
  <linearGradient id="iron" x1="0%" y1="0%" x2="100%" y2="100%">
    <stop offset="0%" stop-color="#9aa0a2" />
    <stop offset="45%" stop-color="#555c5f" />
    <stop offset="100%" stop-color="#1c2022" />
  </linearGradient>
  <linearGradient id="rust" x1="0%" y1="0%" x2="100%" y2="100%">
    <stop offset="0%" stop-color="#d98a4a" />
    <stop offset="50%" stop-color="#8a4a22" />
    <stop offset="100%" stop-color="#3a1c0c" />
  </linearGradient>
  <linearGradient id="leather" x1="0%" y1="0%" x2="100%" y2="100%">
    <stop offset="0%" stop-color="#b78556" />
    <stop offset="50%" stop-color="#6e4526" />
    <stop offset="100%" stop-color="#2e1a0c" />
  </linearGradient>
  <linearGradient id="seacloth" x1="0%" y1="0%" x2="100%" y2="100%">
    <stop offset="0%" stop-color="#7fd0bf" />
    <stop offset="45%" stop-color="#2c7a6c" />
    <stop offset="100%" stop-color="#0f2e2a" />
  </linearGradient>
  <linearGradient id="gold" x1="0%" y1="0%" x2="100%" y2="100%">
    <stop offset="0%" stop-color="#fff0b0" />
    <stop offset="50%" stop-color="#c99a3a" />
    <stop offset="100%" stop-color="#5a3c10" />
  </linearGradient>
  <linearGradient id="wood" x1="0%" y1="0%" x2="100%" y2="100%">
    <stop offset="0%" stop-color="#a47a4e" />
    <stop offset="55%" stop-color="#5a3b20" />
    <stop offset="100%" stop-color="#24160a" />
  </linearGradient>
  <radialGradient id="seaglow" cx="50%" cy="50%" r="50%">
    <stop offset="0%" stop-color="#b8ffe8" stop-opacity="0.85" />
    <stop offset="60%" stop-color="#48c9a0" stop-opacity="0.25" />
    <stop offset="100%" stop-color="#48c9a0" stop-opacity="0" />
  </radialGradient>
`;

/** A cluster of barnacle cones at (x, y), `n` of them, `s` in size. */
function barnacles(x, y, n, s) {
  let out = '';
  for (let i = 0; i < n; i++) {
    const a = i * 2.4;
    const r = s * (0.9 + (i % 3) * 0.35);
    const cx = x + Math.cos(a) * s * 1.6 * (i / n + 0.3);
    const cy = y + Math.sin(a) * s * 1.2 * (i / n + 0.3);
    out += `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r.toFixed(1)}" fill="#d8d2c0" stroke="#6f6a5c" stroke-width="0.8" />`;
    out += `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${(r * 0.4).toFixed(1)}" fill="#3a3a32" />`;
  }
  return out;
}

/** A chain of `n` oval links from (x0, y0) toward (x1, y1). */
function chain(x0, y0, x1, y1, n, w, fill = 'url(#iron)') {
  let out = '';
  const ang = (Math.atan2(y1 - y0, x1 - x0) * 180) / Math.PI;
  for (let i = 0; i < n; i++) {
    const t = n > 1 ? i / (n - 1) : 0;
    const x = x0 + (x1 - x0) * t;
    const y = y0 + (y1 - y0) * t;
    const flat = i % 2 === 1;
    out += `<ellipse cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" rx="${(w * 1.4).toFixed(1)}" ry="${(flat ? w * 0.45 : w * 0.85).toFixed(1)}" transform="rotate(${ang.toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)})" fill="none" stroke="${fill}" stroke-width="${(w * 0.55).toFixed(1)}" />`;
  }
  return out;
}

const ITEMS_TO_GENERATE = [
  {
    id: 'knight_commanders_longsword',
    bgDark: '#070b0b',
    bgMid: '#132220',
    bgGlow: '#28443e',
    svgArt: `
      <!-- A drowned knight-commander's longsword on a strong diagonal:
           verdigris-flecked steel, a sea-green grip, a shell pommel -->
      <path d="M 30 104 L 100 26" stroke="#000" stroke-width="12" opacity="0.35" stroke-linecap="round" transform="translate(4 4)" />
      <path d="M 40 84 L 95 21 L 106 18 L 104 29 L 50 94 Z" fill="url(#steel)" stroke="#1e2626" stroke-width="1.6" />
      <path d="M 46 88 L 99 26" stroke="#ffffff" stroke-width="1.2" opacity="0.7" />
      <path d="M 60 72 l 3 -2 M 70 60 l 4 -1 M 80 50 l 2 -3" stroke="#48a58c" stroke-width="2.2" stroke-linecap="round" opacity="0.8" />
      <path d="M 33 80 L 55 98 L 51 102 L 29 84 Z" fill="url(#gold)" stroke="#3a2808" stroke-width="1.4" />
      <path d="M 43 92 L 30 107" stroke="url(#seacloth)" stroke-width="7" stroke-linecap="round" />
      <path d="M 40 95 l 5 4 M 36 99 l 5 4" stroke="#0f2e2a" stroke-width="1.4" />
      <circle cx="27" cy="110" r="6" fill="url(#verdigris)" stroke="#123028" stroke-width="1.4" />
      <path d="M 23 110 q 4 -5 8 0 M 24 107 q 3 -3 6 0" stroke="#cff5e6" stroke-width="0.9" fill="none" />
    `,
  },
  {
    id: 'gaolers_chain_girdle',
    bgDark: '#08090a',
    bgMid: '#171b1e',
    bgGlow: '#34393c',
    svgArt: `
      <!-- A heavy mail girdle of gaol chain with a square iron buckle and a
           hanging key-ring loop -->
      <ellipse cx="66" cy="70" rx="48" ry="22" fill="#000" opacity="0.35" />
      <path d="M 16 58 Q 64 40 112 58 L 110 76 Q 64 58 18 76 Z" fill="url(#iron)" stroke="#111" stroke-width="1.6" />
      ${chain(20, 62, 108, 62, 12, 4, '#b7bfc2')}
      ${chain(22, 71, 106, 71, 11, 3.4, '#7d878b')}
      <rect x="54" y="52" width="22" height="26" rx="3" fill="url(#iron)" stroke="#0c0e0f" stroke-width="2" />
      <rect x="59" y="57" width="12" height="16" rx="2" fill="none" stroke="#c9d0d2" stroke-width="2" />
      <line x1="65" y1="57" x2="65" y2="73" stroke="#e8eef0" stroke-width="2" />
      <circle cx="84" cy="90" r="9" fill="none" stroke="url(#rust)" stroke-width="3.5" />
      ${chain(80, 76, 84, 82, 2, 2.4, '#8a9092')}
    `,
  },
  {
    id: 'rusted_shackle_grips',
    bgDark: '#0b0806',
    bgMid: '#1f150d',
    bgGlow: '#3d2a18',
    svgArt: `
      <!-- A pair of worn leather grips, one still wearing a rusted shackle
           cuff with a snapped chain link hanging from it -->
      <ellipse cx="66" cy="102" rx="40" ry="8" fill="#000" opacity="0.4" />
      <path d="M 24 90 L 30 44 Q 32 34 40 34 L 44 34 Q 50 32 52 40 L 58 36 Q 64 34 64 44 L 62 90 Z" fill="url(#leather)" stroke="#1d0f06" stroke-width="1.6" />
      <path d="M 34 44 L 36 70 M 44 42 L 45 70 M 54 44 L 53 70" stroke="#2e1a0c" stroke-width="1.4" opacity="0.8" />
      <path d="M 66 94 L 70 50 Q 72 40 80 40 L 84 40 Q 90 38 92 46 L 98 42 Q 104 40 104 50 L 102 94 Z" fill="url(#leather)" stroke="#1d0f06" stroke-width="1.6" />
      <path d="M 76 50 L 77 76 M 86 48 L 86 76 M 95 50 L 94 76" stroke="#2e1a0c" stroke-width="1.4" opacity="0.8" />
      <rect x="62" y="76" width="44" height="14" rx="4" fill="url(#rust)" stroke="#2a1206" stroke-width="1.6" />
      <circle cx="70" cy="83" r="2" fill="#f0b070" />
      <circle cx="98" cy="83" r="2" fill="#f0b070" />
      ${chain(84, 92, 90, 108, 3, 3, 'url(#rust)')}
      <path d="M 88 111 l 6 3" stroke="#d98a4a" stroke-width="2.2" stroke-linecap="round" />
    `,
  },
  {
    id: 'drowned_wardens_mantle',
    bgDark: '#050a0a',
    bgMid: '#0f201e',
    bgGlow: '#1f3f3a',
    svgArt: `
      <!-- A sea-green cloth mantle, its hem ragged with kelp, fastened by a
           pearl clasp; faint brine glow on the folds -->
      <ellipse cx="64" cy="100" rx="44" ry="9" fill="#000" opacity="0.4" />
      <path d="M 18 70 Q 30 36 64 32 Q 98 36 110 70 L 100 92 Q 64 78 28 92 Z" fill="url(#seacloth)" stroke="#07201c" stroke-width="1.8" />
      <path d="M 30 62 Q 64 44 98 62" stroke="#b8f0e0" stroke-width="1.2" fill="none" opacity="0.5" />
      <path d="M 26 80 Q 64 64 102 80" stroke="#0a2622" stroke-width="2" fill="none" opacity="0.7" />
      <path d="M 28 92 l -3 10 M 40 88 l -1 12 M 54 85 l 1 10 M 74 85 l 0 12 M 88 88 l 2 10 M 100 92 l 4 9" stroke="#3a6a2a" stroke-width="3" stroke-linecap="round" />
      <circle cx="64" cy="40" r="7" fill="#f4f2ea" stroke="#8c8a80" stroke-width="1.4" />
      <circle cx="62" cy="38" r="2.4" fill="#ffffff" />
      <ellipse cx="64" cy="58" rx="30" ry="12" fill="url(#seaglow)" opacity="0.45" />
    `,
  },
  {
    id: 'gaolyard_cudgel',
    bgDark: '#0a0806',
    bgMid: '#1d150e',
    bgGlow: '#3a2a1a',
    svgArt: `
      <!-- A gaoler's cudgel on the diagonal: a thick oak club bound in
           rusted iron bands and studs, a leather-wrapped grip and a wrist loop -->
      <path d="M 36 100 L 96 34" stroke="#000" stroke-width="16" opacity="0.35" stroke-linecap="round" transform="translate(4 4)" />
      <path d="M 40 94 L 82 44 Q 90 34 100 36 Q 106 44 98 54 L 52 102 Z" fill="url(#wood)" stroke="#1a0e05" stroke-width="1.6" />
      <path d="M 70 64 L 80 72 M 80 52 L 90 60" stroke="url(#iron)" stroke-width="6" />
      <circle cx="88" cy="46" r="2.6" fill="#c9cfd2" />
      <circle cx="94" cy="52" r="2.6" fill="#c9cfd2" />
      <circle cx="78" cy="58" r="2.4" fill="#c9cfd2" />
      <circle cx="84" cy="66" r="2.4" fill="#c9cfd2" />
      <path d="M 46 96 L 30 112" stroke="url(#leather)" stroke-width="8" stroke-linecap="round" />
      <path d="M 43 100 l 4 3 M 38 105 l 4 3" stroke="#2e1a0c" stroke-width="1.4" />
      <path d="M 26 114 q -8 4 -4 -6 q 4 -6 8 2" fill="none" stroke="#6e4526" stroke-width="2.4" />
    `,
  },
  {
    id: 'drowned_commanders_breastplate',
    bgDark: '#060909',
    bgMid: '#122120',
    bgGlow: '#2c4a44',
    svgArt: `
      <!-- A drowned commander's breastplate: sea-dark steel over mail, gilt
           trim, a shell boss on the chest, barnacles crusting one flank -->
      <ellipse cx="64" cy="108" rx="40" ry="7" fill="#000" opacity="0.4" />
      <path d="M 30 30 L 50 24 Q 64 32 78 24 L 98 30 L 104 50 Q 100 80 90 100 Q 64 110 38 100 Q 28 80 24 50 Z" fill="url(#steel)" stroke="#1a2322" stroke-width="2" />
      <path d="M 38 38 Q 64 50 90 38 L 88 92 Q 64 102 40 92 Z" fill="url(#verdigris)" opacity="0.45" />
      <path d="M 64 34 L 64 100" stroke="#e8f4f0" stroke-width="1.4" opacity="0.6" />
      <path d="M 30 30 L 50 24 Q 64 32 78 24 L 98 30" stroke="url(#gold)" stroke-width="4" fill="none" stroke-linejoin="round" />
      <path d="M 38 100 Q 64 110 90 100" stroke="url(#gold)" stroke-width="3" fill="none" />
      <path d="M 54 58 Q 64 44 74 58 Q 64 72 54 58 Z" fill="url(#gold)" stroke="#3a2808" stroke-width="1.2" />
      <path d="M 58 58 Q 64 50 70 58 M 60 60 Q 64 54 68 60" stroke="#fff4c8" stroke-width="0.9" fill="none" />
      ${barnacles(90, 78, 6, 2.6)}
      <path d="M 26 52 l 8 3 M 26 60 l 8 2" stroke="#4a5655" stroke-width="2" />
    `,
  },
  {
    id: 'gaolyard_striders',
    bgDark: '#0a0806',
    bgMid: '#1c140c',
    bgGlow: '#3a2816',
    svgArt: `
      <!-- A pair of tall leather striders, iron shackle cuffs riveted at the
           ankles, salt-stained toes -->
      <ellipse cx="64" cy="106" rx="44" ry="7" fill="#000" opacity="0.45" />
      <path d="M 26 30 L 50 30 L 52 76 Q 70 80 72 94 L 70 100 L 24 100 Z" fill="url(#leather)" stroke="#1d0f06" stroke-width="1.6" />
      <path d="M 58 34 L 82 34 L 84 76 Q 104 80 106 94 L 104 100 L 56 100 Z" fill="url(#leather)" stroke="#1d0f06" stroke-width="1.6" />
      <rect x="23" y="62" width="31" height="10" rx="3" fill="url(#iron)" stroke="#0e1011" stroke-width="1.4" />
      <rect x="55" y="66" width="31" height="10" rx="3" fill="url(#iron)" stroke="#0e1011" stroke-width="1.4" />
      <circle cx="28" cy="67" r="1.8" fill="#d8dee0" />
      <circle cx="49" cy="67" r="1.8" fill="#d8dee0" />
      <circle cx="60" cy="71" r="1.8" fill="#d8dee0" />
      <circle cx="81" cy="71" r="1.8" fill="#d8dee0" />
      <path d="M 28 94 Q 50 90 70 96 M 60 94 Q 82 90 104 96" stroke="#e8e0cc" stroke-width="2" fill="none" opacity="0.5" />
      <path d="M 30 36 L 48 36 M 62 40 L 80 40" stroke="#c99a6a" stroke-width="1.2" opacity="0.6" />
    `,
  },
  {
    id: 'jailers_iron_gauntlets',
    bgDark: '#08090a',
    bgMid: '#181b1d',
    bgGlow: '#3a3d3e',
    svgArt: `
      <!-- The Gaol Turnkey's heavy mail gauntlets: riveted iron plates over
           rusted mail, the cuffs hung with a length of cell chain -->
      <ellipse cx="64" cy="104" rx="42" ry="7" fill="#000" opacity="0.4" />
      <path d="M 20 92 L 24 48 Q 26 36 36 36 L 50 36 Q 58 38 58 48 L 56 92 Z" fill="url(#iron)" stroke="#0c0e0f" stroke-width="1.6" />
      <path d="M 26 50 L 52 50 M 26 60 L 52 60 M 26 70 L 52 70" stroke="#c7cfd2" stroke-width="1.2" opacity="0.5" />
      <path d="M 30 36 L 30 26 Q 34 22 38 26 L 38 36 M 40 36 L 40 24 Q 44 20 48 24 L 48 36" fill="url(#iron)" stroke="#0c0e0f" stroke-width="1.4" />
      <path d="M 70 96 L 72 52 Q 74 40 84 40 L 98 40 Q 106 42 106 52 L 104 96 Z" fill="url(#iron)" stroke="#0c0e0f" stroke-width="1.6" />
      <path d="M 74 54 L 102 54 M 74 64 L 102 64 M 74 74 L 102 74" stroke="#c7cfd2" stroke-width="1.2" opacity="0.5" />
      <rect x="18" y="80" width="40" height="14" rx="3" fill="url(#rust)" stroke="#2a1206" stroke-width="1.6" />
      <rect x="68" y="84" width="40" height="14" rx="3" fill="url(#rust)" stroke="#2a1206" stroke-width="1.6" />
      <circle cx="24" cy="87" r="2" fill="#f0b070" /><circle cx="52" cy="87" r="2" fill="#f0b070" />
      <circle cx="74" cy="91" r="2" fill="#f0b070" /><circle cx="102" cy="91" r="2" fill="#f0b070" />
      ${chain(58, 90, 70, 94, 3, 3, '#8a9092')}
      ${barnacles(98, 60, 4, 2.2)}
    `,
  },
  {
    id: 'turnkeys_keyring_belt',
    bgDark: '#0a0806',
    bgMid: '#1d150c',
    bgGlow: '#3b2a16',
    svgArt: `
      <!-- The Turnkey's broad leather belt, a rusted iron buckle and the great
           ring of cell keys swinging from it -->
      <ellipse cx="64" cy="100" rx="46" ry="8" fill="#000" opacity="0.4" />
      <path d="M 12 52 Q 64 36 116 52 L 114 70 Q 64 54 14 70 Z" fill="url(#leather)" stroke="#1d0f06" stroke-width="1.6" />
      <path d="M 18 58 Q 64 44 110 58" stroke="#c99a6a" stroke-width="1.2" fill="none" opacity="0.55" stroke-dasharray="3 3" />
      <rect x="50" y="46" width="24" height="24" rx="3" fill="url(#rust)" stroke="#2a1206" stroke-width="2" />
      <rect x="55" y="51" width="14" height="14" rx="2" fill="none" stroke="#f0b070" stroke-width="2" />
      <circle cx="86" cy="86" r="14" fill="none" stroke="url(#iron)" stroke-width="4" />
      <path d="M 78 96 L 70 112 M 70 112 l -4 -2 M 70 112 l 2 4" stroke="url(#iron)" stroke-width="3.2" stroke-linecap="round" />
      <path d="M 88 100 L 90 116 M 90 116 l -3 1 M 90 112 l 4 0" stroke="url(#iron)" stroke-width="3.2" stroke-linecap="round" />
      <path d="M 98 94 L 110 106 M 110 106 l 1 -4 M 106 102 l 3 -3" stroke="url(#rust)" stroke-width="3.2" stroke-linecap="round" />
      ${chain(80, 64, 84, 72, 2, 2.4, '#8a9092')}
    `,
  },
  {
    id: 'turnkeys_lantern_cowl',
    bgDark: '#070707',
    bgMid: '#1a1612',
    bgGlow: '#453521',
    svgArt: `
      <!-- A sea-stained cloth cowl hung with the Turnkey's tiny storm lantern,
           its flame warm against the drowned grey hood -->
      <ellipse cx="64" cy="106" rx="40" ry="7" fill="#000" opacity="0.4" />
      <path d="M 26 96 Q 20 60 36 36 Q 64 14 92 36 Q 108 60 102 96 Q 64 86 26 96 Z" fill="url(#seacloth)" stroke="#07201c" stroke-width="1.8" />
      <path d="M 40 90 Q 44 56 64 50 Q 84 56 88 90 Q 64 82 40 90 Z" fill="#050807" opacity="0.85" />
      <path d="M 36 40 Q 64 22 92 40" stroke="#b8f0e0" stroke-width="1.2" fill="none" opacity="0.45" />
      <path d="M 30 96 l -2 8 M 46 92 l -1 9 M 82 92 l 1 9 M 98 96 l 2 8" stroke="#3a6a2a" stroke-width="2.6" stroke-linecap="round" />
      <circle cx="96" cy="70" r="14" fill="url(#seaglow)" opacity="0.0" />
      <path d="M 96 50 L 96 58" stroke="url(#iron)" stroke-width="2" />
      <rect x="89" y="58" width="14" height="18" rx="2" fill="#2a2016" stroke="url(#iron)" stroke-width="2" />
      <ellipse cx="96" cy="67" rx="4" ry="6" fill="#ffd27a" />
      <ellipse cx="96" cy="68" rx="2" ry="3" fill="#fff4d0" />
      <circle cx="96" cy="67" r="16" fill="#ffb040" opacity="0.18" />
    `,
  },
  {
    id: 'gaolers_iron_key',
    bgDark: '#060808',
    bgMid: '#131a1a',
    bgGlow: '#2a3a38',
    svgArt: `
      <!-- The Gaoler's great iron key on its ring, the bit notched for the
           drowned cells, a cold sea-green glint at the bow -->
      <circle cx="64" cy="64" r="40" fill="url(#seaglow)" opacity="0.35" />
      <path d="M 40 44 L 96 96" stroke="#000" stroke-width="10" opacity="0.35" stroke-linecap="round" transform="translate(4 4)" />
      <circle cx="40" cy="40" r="16" fill="none" stroke="url(#iron)" stroke-width="7" />
      <circle cx="40" cy="40" r="16" fill="none" stroke="#c7cfd2" stroke-width="1.2" opacity="0.6" />
      <path d="M 50 50 L 96 96" stroke="url(#iron)" stroke-width="8" stroke-linecap="round" />
      <path d="M 52 50 L 96 94" stroke="#dfe6e8" stroke-width="1.4" opacity="0.6" />
      <path d="M 84 84 L 94 74 L 100 80 L 94 86 L 100 92 L 92 100 Z" fill="url(#iron)" stroke="#0f1213" stroke-width="1.4" />
      <circle cx="40" cy="40" r="5" fill="url(#verdigris)" />
      <circle cx="24" cy="94" r="10" fill="none" stroke="url(#rust)" stroke-width="3" />
      ${chain(28, 86, 36, 54, 4, 2.2, '#7d878b')}
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
            <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="7" />
            <feColorMatrix type="matrix" values="0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 0.22 0" />
          </filter>
          <filter id="soft"><feGaussianBlur stdDeviation="0.35" /></filter>
        </defs>
        <rect width="128" height="128" fill="url(#bgGrad)" />
        <g filter="url(#soft)" transform="translate(64 66) scale(${item.scale ?? 1.1}) translate(-64 -66)">${item.svgArt}</g>
        <rect width="128" height="128" fill="url(#shade)" />
        <rect width="128" height="128" filter="url(#grain)" style="mix-blend-mode: overlay" />
      </svg>
    `;
}

async function main() {
  console.log(`Generating ${ITEMS_TO_GENERATE.length} Sunken Bastion WebP icons...`);
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
