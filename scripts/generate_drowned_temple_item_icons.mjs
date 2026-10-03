// scripts/generate_drowned_temple_item_icons.mjs
// Generates the shipping 128x128 WebP item icons for the Drowned Temple rework's
// loot (src/sim/content/drowned_temple_items.ts). Same recipe as generate_clue_scroll_icons.mjs:
// an authored SVG composition per item over a three-stop radial ground,
// rasterized with Sharp, meeting the woc-item-icon-v1 contract (opaque dark
// vignette, warm top-left key light, cool bottom-right shadow, centered
// silhouette with safe padding, distinct art per item). The script IS the
// retained source: re-running it reproduces every file byte for byte. It never
// touches mapping.json; the generated batch entry there is hand-authored
// (batch drowned-temple-icons-2026-09-30) with its provenance README under
// docs/achievements/drowned-temple-icons-2026-09-30/.
//
// Usage: node scripts/generate_drowned_temple_item_icons.mjs

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
  <linearGradient id="pearl" x1="0%" y1="0%" x2="100%" y2="100%">
    <stop offset="0%" stop-color="#ffffff" />
    <stop offset="45%" stop-color="#e6e1d3" />
    <stop offset="100%" stop-color="#8a8fa0" />
  </linearGradient>
  <linearGradient id="nacre" x1="0%" y1="0%" x2="100%" y2="100%">
    <stop offset="0%" stop-color="#fff4fa" />
    <stop offset="40%" stop-color="#f1c7d6" />
    <stop offset="75%" stop-color="#b9a6ff" />
    <stop offset="100%" stop-color="#5a4f8a" />
  </linearGradient>
  <linearGradient id="tideglass" x1="0%" y1="0%" x2="100%" y2="100%">
    <stop offset="0%" stop-color="#f2fbff" />
    <stop offset="35%" stop-color="#9fdcff" />
    <stop offset="70%" stop-color="#6b7fd8" />
    <stop offset="100%" stop-color="#232a5c" />
  </linearGradient>
  <linearGradient id="moonsilk" x1="0%" y1="0%" x2="100%" y2="100%">
    <stop offset="0%" stop-color="#f4f6ff" />
    <stop offset="50%" stop-color="#aab4d8" />
    <stop offset="100%" stop-color="#3b4270" />
  </linearGradient>
  <radialGradient id="moonglow" cx="50%" cy="50%" r="50%">
    <stop offset="0%" stop-color="#ffffff" stop-opacity="0.9" />
    <stop offset="60%" stop-color="#b9c8ff" stop-opacity="0.3" />
    <stop offset="100%" stop-color="#b9c8ff" stop-opacity="0" />
  </radialGradient>
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
    id: 'conchplate_girdle',
    bgDark: '#070a10',
    bgMid: '#161e2c',
    bgGlow: '#34405a',
    svgArt: `
      <!-- A mail girdle of overlapping conch plates with a gold spiral buckle -->
      <ellipse cx="66" cy="72" rx="48" ry="20" fill="#000" opacity="0.35" />
      <path d="M 16 58 Q 64 42 112 58 L 110 78 Q 64 62 18 78 Z" fill="url(#moonsilk)" stroke="#1a1d2c" stroke-width="1.6" />
      ${[0, 1, 2, 3, 4, 5, 6, 7].map((i) => `<path d="M ${22 + i * 11} ${(60 - Math.sin((i / 7) * Math.PI) * 6).toFixed(1)} q 6 -6 12 0 q -6 8 -12 0 Z" fill="url(#nacre)" stroke="#4a3f6a" stroke-width="1" />`).join('')}
      <circle cx="64" cy="66" r="12" fill="url(#gold)" stroke="#3a2808" stroke-width="1.6" />
      <path d="M 57 66 a 7 7 0 1 1 7 7 a 4 4 0 1 1 -4 -4 a 2 2 0 1 1 2 2" fill="none" stroke="#fff0b0" stroke-width="1.6" />
    `,
  },
  {
    id: 'pale_chorus_leggings',
    bgDark: '#08090f',
    bgMid: '#191c2a',
    bgGlow: '#3a3f5a',
    svgArt: `
      <!-- Pale leather leggings stitched with moonlit hymn lines -->
      <path d="M 44 22 L 84 22 L 90 106 L 70 106 L 64 58 L 58 106 L 38 106 Z" fill="#000" opacity="0.35" transform="translate(4 4)" />
      <path d="M 44 22 L 84 22 L 90 106 L 70 106 L 64 58 L 58 106 L 38 106 Z" fill="url(#pearl)" stroke="#3a3f5a" stroke-width="1.8" />
      <rect x="44" y="22" width="40" height="9" fill="url(#moonsilk)" stroke="#2a2e44" stroke-width="1.2" />
      <path d="M 47 40 q 4 30 -3 60 M 81 40 q -4 30 3 60" stroke="#8fa0d8" stroke-width="1.6" fill="none" stroke-dasharray="3 2" />
      <circle cx="48" cy="54" r="2.4" fill="#dde8f5" /><circle cx="80" cy="70" r="2.4" fill="#dde8f5" />
    `,
  },
  {
    id: 'refrain_silk_gloves',
    bgDark: '#0a0810',
    bgMid: '#1d1830',
    bgGlow: '#3e3560',
    svgArt: `
      <!-- A pair of pale silk gloves, a gold note embroidered on each cuff -->
      <path d="M 30 96 L 30 50 Q 30 34 40 34 L 42 26 L 48 26 L 50 34 L 56 34 L 58 50 L 58 96 Z" fill="url(#moonsilk)" stroke="#2a2440" stroke-width="1.6" />
      <path d="M 70 96 L 70 50 Q 70 34 80 34 L 82 26 L 88 26 L 90 34 L 96 34 L 98 50 L 98 96 Z" fill="url(#pearl)" stroke="#2a2440" stroke-width="1.6" />
      <rect x="28" y="86" width="32" height="12" rx="3" fill="url(#nacre)" /><rect x="68" y="86" width="32" height="12" rx="3" fill="url(#nacre)" />
      <path d="M 42 78 v -12 l 8 -2 v 10" stroke="url(#gold)" stroke-width="2.4" fill="none" />
      <circle cx="40" cy="78" r="3" fill="url(#gold)" />
      <path d="M 82 78 v -12 l 8 -2 v 10" stroke="url(#gold)" stroke-width="2.4" fill="none" />
      <circle cx="80" cy="78" r="3" fill="url(#gold)" />
    `,
  },
  {
    id: 'chorus_conch',
    bgDark: '#0b0908',
    bgMid: '#2a1f16',
    bgGlow: '#5a4430',
    svgArt: `
      <!-- A spiral conch of nacre, gold light breathing in its mouth -->
      <circle cx="70" cy="60" r="36" fill="url(#moonglow)" opacity="0.35" />
      <path d="M 26 92 Q 30 40 70 26 Q 104 22 106 52 Q 106 84 72 98 Q 46 108 26 92 Z" fill="url(#nacre)" stroke="#4a2f3a" stroke-width="2" />
      <path d="M 40 86 Q 44 52 72 40 Q 94 36 94 56 Q 94 76 70 84" fill="none" stroke="#7a5a70" stroke-width="2.4" />
      <path d="M 56 80 Q 58 60 74 54 Q 84 52 84 62" fill="none" stroke="#7a5a70" stroke-width="2" />
      <ellipse cx="44" cy="92" rx="16" ry="9" fill="url(#gold)" transform="rotate(-25 44 92)" />
      <ellipse cx="44" cy="92" rx="9" ry="4.5" fill="#fff4c4" transform="rotate(-25 44 92)" />
      ${[0, 1, 2, 3, 4].map((i) => `<path d="M ${60 + i * 9} ${30 - (i % 2) * 3} l 2 -10 l 3 10 Z" fill="url(#pearl)" />`).join('')}
    `,
  },
  {
    // The Heroic clone of the chase conch (content/heroic_variants.ts): the same
    // shell under a deeper moonlit ground with the light brimming over.
    id: 'heroic_chorus_conch',
    bgDark: '#08071a',
    bgMid: '#1d1840',
    bgGlow: '#4a3f8a',
    svgArt: `
      <!-- The chorus conch at full voice, moonlight spilling from its mouth -->
      <circle cx="64" cy="64" r="50" fill="url(#moonglow)" opacity="0.55" />
      <path d="M 26 92 Q 30 40 70 26 Q 104 22 106 52 Q 106 84 72 98 Q 46 108 26 92 Z" fill="url(#nacre)" stroke="#2f2458" stroke-width="2" />
      <path d="M 40 86 Q 44 52 72 40 Q 94 36 94 56 Q 94 76 70 84" fill="none" stroke="#5a4f9a" stroke-width="2.4" />
      <path d="M 56 80 Q 58 60 74 54 Q 84 52 84 62" fill="none" stroke="#5a4f9a" stroke-width="2" />
      <ellipse cx="44" cy="92" rx="16" ry="9" fill="url(#gold)" transform="rotate(-25 44 92)" />
      <ellipse cx="44" cy="92" rx="9" ry="4.5" fill="#ffffff" transform="rotate(-25 44 92)" />
      ${[0, 1, 2].map((i) => `<path d="M ${34 - i * 8} ${96 + i * 6} q -10 4 -16 12" stroke="#dfe6ff" stroke-width="${2.6 - i * 0.6}" fill="none" opacity="${0.9 - i * 0.2}" />`).join('')}
      ${[0, 1, 2, 3, 4].map((i) => `<path d="M ${60 + i * 9} ${30 - (i % 2) * 3} l 2 -10 l 3 10 Z" fill="url(#pearl)" />`).join('')}
    `,
  },
  {
    id: 'tideglass_pauldrons',
    bgDark: '#070b12',
    bgMid: '#132035',
    bgGlow: '#2c4870',
    svgArt: `
      <!-- A mail pauldron capped with faceted tideglass shards -->
      <path d="M 18 86 Q 20 44 64 38 Q 108 44 110 86 Q 64 72 18 86 Z" fill="#000" opacity="0.35" transform="translate(4 4)" />
      <path d="M 18 86 Q 20 44 64 38 Q 108 44 110 86 Q 64 72 18 86 Z" fill="url(#moonsilk)" stroke="#1c2440" stroke-width="1.8" />
      <path d="M 26 80 Q 64 64 102 80" stroke="#8fa0d8" stroke-width="2" fill="none" />
      <path d="M 40 50 L 48 18 L 56 48 Z" fill="url(#tideglass)" stroke="#1c2a5a" stroke-width="1.2" />
      <path d="M 58 44 L 66 10 L 74 44 Z" fill="url(#tideglass)" stroke="#1c2a5a" stroke-width="1.2" />
      <path d="M 76 48 L 86 22 L 90 50 Z" fill="url(#tideglass)" stroke="#1c2a5a" stroke-width="1.2" />
      <circle cx="66" cy="60" r="6" fill="#dde8f5" />
    `,
  },
  {
    id: 'moonburn_treads',
    bgDark: '#0a0808',
    bgMid: '#241b18',
    bgGlow: '#4e3a30',
    svgArt: `
      <!-- Soft leather treads branded with a silver crescent that burns cold -->
      <path d="M 40 22 L 66 22 L 68 82 L 104 88 Q 110 104 96 106 L 38 106 Q 32 104 34 90 Z" fill="#000" opacity="0.35" transform="translate(4 4)" />
      <path d="M 40 22 L 66 22 L 68 82 L 104 88 Q 110 104 96 106 L 38 106 Q 32 104 34 90 Z" fill="url(#leather)" stroke="#1e120a" stroke-width="1.8" />
      <rect x="38" y="22" width="30" height="8" fill="url(#moonsilk)" />
      <path d="M 52 50 a 10 10 0 1 0 8 16 a 7 7 0 1 1 -8 -16 Z" fill="#dde8f5" />
      <circle cx="56" cy="58" r="14" fill="url(#moonglow)" opacity="0.5" />
    `,
  },
  {
    id: 'prism_etched_cowl',
    bgDark: '#0b0812',
    bgMid: '#1f1836',
    bgGlow: '#40336a',
    svgArt: `
      <!-- A cloth cowl, a violet prism etched on its brow -->
      <path d="M 24 100 Q 22 30 64 22 Q 106 30 104 100 L 86 100 Q 84 60 64 58 Q 44 60 42 100 Z" fill="#000" opacity="0.35" transform="translate(4 4)" />
      <path d="M 24 100 Q 22 30 64 22 Q 106 30 104 100 L 86 100 Q 84 60 64 58 Q 44 60 42 100 Z" fill="url(#moonsilk)" stroke="#221a40" stroke-width="1.8" />
      <path d="M 64 30 L 74 44 L 64 52 L 54 44 Z" fill="url(#tideglass)" stroke="#3a2a7a" stroke-width="1.4" />
      <path d="M 64 30 L 64 52 M 54 44 L 74 44" stroke="#f2fbff" stroke-width="0.8" opacity="0.8" />
      <circle cx="64" cy="42" r="16" fill="url(#moonglow)" opacity="0.35" />
    `,
  },
  {
    id: 'tideglass_shiv',
    bgDark: '#060a12',
    bgMid: '#111d33',
    bgGlow: '#28406a',
    svgArt: `
      <!-- A slim dagger with a faceted tideglass blade and a pearl pommel -->
      <path d="M 34 96 L 94 30" stroke="#000" stroke-width="10" opacity="0.35" stroke-linecap="round" transform="translate(4 4)" />
      <path d="M 50 80 L 96 24 L 104 22 L 102 30 L 58 86 Z" fill="url(#tideglass)" stroke="#16204a" stroke-width="1.6" />
      <path d="M 54 82 L 99 27" stroke="#ffffff" stroke-width="1.2" opacity="0.8" />
      <path d="M 42 76 L 62 92 L 58 96 L 38 80 Z" fill="url(#moonsilk)" stroke="#1a1d2c" stroke-width="1.2" />
      <path d="M 50 88 L 38 102" stroke="url(#leather)" stroke-width="6" stroke-linecap="round" />
      <circle cx="35" cy="106" r="6" fill="url(#pearl)" stroke="#5a5f70" stroke-width="1.2" />
    `,
  },
  {
    id: 'pale_chorus_vestment',
    bgDark: '#0c0712',
    bgMid: '#231634',
    bgGlow: '#4a2f6a',
    svgArt: `
      <!-- An epic chorister's vestment of pale moonsilk with a gold stole and
           a pearl choir clasp -->
      <path d="M 40 20 L 88 20 L 104 44 L 94 52 L 92 108 L 36 108 L 34 52 L 24 44 Z" fill="#000" opacity="0.35" transform="translate(4 4)" />
      <path d="M 40 20 L 88 20 L 104 44 L 94 52 L 92 108 L 36 108 L 34 52 L 24 44 Z" fill="url(#moonsilk)" stroke="#2a1f44" stroke-width="1.8" />
      <path d="M 52 20 L 58 108 M 76 20 L 70 108" stroke="url(#gold)" stroke-width="7" />
      <circle cx="64" cy="34" r="7" fill="url(#pearl)" stroke="#6a5f80" stroke-width="1.2" />
      <path d="M 44 70 q 20 8 40 0 M 44 84 q 20 8 40 0" stroke="#c6b8ff" stroke-width="1.4" fill="none" />
      <circle cx="64" cy="60" r="30" fill="url(#moonglow)" opacity="0.2" />
    `,
  },
  {
    id: 'tideglass_warmaul',
    bgDark: '#070a12',
    bgMid: '#142038',
    bgGlow: '#304a7a',
    svgArt: `
      <!-- An epic warmaul: a great head of pearl stone banded in bronze and
           crowned with a blazing tideglass prism -->
      <path d="M 30 108 L 76 46" stroke="#000" stroke-width="10" opacity="0.35" stroke-linecap="round" transform="translate(4 4)" />
      <path d="M 30 108 L 76 46" stroke="url(#wood)" stroke-width="7" stroke-linecap="round" />
      <path d="M 36 100 l 6 4 M 42 92 l 6 4" stroke="url(#gold)" stroke-width="2.4" />
      <rect x="56" y="18" width="46" height="40" rx="6" fill="url(#pearl)" stroke="#3a3f5a" stroke-width="2" transform="rotate(35 79 38)" />
      <rect x="58" y="34" width="42" height="7" fill="url(#gold)" transform="rotate(35 79 38)" />
      <path d="M 84 14 L 94 30 L 84 42 L 74 30 Z" fill="url(#tideglass)" stroke="#1c2a5a" stroke-width="1.4" />
      <circle cx="84" cy="28" r="18" fill="url(#moonglow)" opacity="0.5" />
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
  console.log(`Generating ${ITEMS_TO_GENERATE.length} Drowned Temple WebP icons...`);
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
