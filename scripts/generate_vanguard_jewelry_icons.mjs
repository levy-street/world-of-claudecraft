// scripts/generate_vanguard_jewelry_icons.mjs
// Generates the shipping 128x128 WebP item icons for the eight Warfare Season 2
// rings and pendants (SEASON2_JEWELRY_IDS in src/sim/content/pvp_honor_season2.ts)
// and records their generated batch in public/ui/items/mapping.json.
// Meets the woc-item-icon-v1 contract (docs/design/item-icon-art-style.md): opaque
// dark vignette, warm top-left key and cool bottom-right shadow, centered
// silhouette with safe padding, and distinct art for every item. The Vanguard
// palette follows the Season 2 weapons: blackened steel, crimson enamel and
// burnished gold; each role carries its own gem (Might ruby, Precision emerald,
// Focus amethyst, Mending dawn topaz).

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const repoRoot = process.cwd();
const itemsDir = path.join(repoRoot, 'public/ui/items');
const mappingPath = path.join(itemsDir, 'mapping.json');
const OUT_PX = 128;
const BATCH_ID = 'vanguard-jewelry-icons-2026-10-03';

// A blackened-steel ring band with a crimson enamel inlay and gold edges.
const band = (cy) => `
  <ellipse cx="64" cy="${cy}" rx="37" ry="23" fill="none" stroke="#141010" stroke-width="15" />
  <ellipse cx="64" cy="${cy}" rx="37" ry="23" fill="none" stroke="url(#steelGrad)" stroke-width="11" />
  <ellipse cx="64" cy="${cy}" rx="37" ry="23" fill="none" stroke="#9e1b1b" stroke-width="4" />
  <ellipse cx="64" cy="${cy}" rx="42.5" ry="28.5" fill="none" stroke="url(#goldGrad)" stroke-width="1.6" opacity="0.9" />
  <ellipse cx="64" cy="${cy}" rx="31.5" ry="17.5" fill="none" stroke="url(#goldGrad)" stroke-width="1.4" opacity="0.8" />
`;

// A fine gold chain arc for the pendants.
const chain = `
  <path d="M 26 18 Q 64 62 102 18" fill="none" stroke="#3a2a10" stroke-width="5" stroke-linecap="round" />
  <path d="M 26 18 Q 64 62 102 18" fill="none" stroke="url(#goldGrad)" stroke-width="3" stroke-dasharray="5 3" stroke-linecap="round" />
`;

// A small gold laurel sprig, the Vanguard regalia mark shared with the weapons.
const laurel = (x, y, flip) => `
  <g transform="translate(${x} ${y}) scale(${flip ? -1 : 1} 1)">
    <path d="M 0 0 Q 8 -10 4 -22" fill="none" stroke="url(#goldGrad)" stroke-width="2" />
    <ellipse cx="5" cy="-6" rx="3.5" ry="1.6" transform="rotate(-40 5 -6)" fill="url(#goldGrad)" />
    <ellipse cx="7" cy="-12" rx="3.5" ry="1.6" transform="rotate(-60 7 -12)" fill="url(#goldGrad)" />
    <ellipse cx="6" cy="-18" rx="3.2" ry="1.5" transform="rotate(-80 6 -18)" fill="url(#goldGrad)" />
  </g>
`;

const ITEMS_TO_GENERATE = [
  {
    id: 'vanguard_band_of_might',
    bgDark: '#0c0606',
    bgMid: '#1e0c0c',
    bgGlow: '#401616',
    svgArt: `
      ${band(76)}
      <!-- Crowned ruby setting flanked by laurel -->
      ${laurel(46, 54, false)}
      ${laurel(82, 54, true)}
      <polygon points="50,46 56,32 64,40 72,32 78,46" fill="url(#goldGrad)" stroke="#3a2a10" stroke-width="1.5" />
      <circle cx="64" cy="48" r="13" fill="#5a0a0a" stroke="url(#goldGrad)" stroke-width="3" />
      <polygon points="64,37 73,48 64,59 55,48" fill="#e53935" filter="url(#glow)" />
      <polygon points="64,41 69,48 64,55 59,48" fill="#ff8a80" />
      <circle cx="61" cy="45" r="1.8" fill="#ffffff" />
    `,
  },
  {
    id: 'vanguard_band_of_precision',
    bgDark: '#060a07',
    bgMid: '#0f1a12',
    bgGlow: '#1d3522',
    svgArt: `
      ${band(76)}
      <!-- Arrowhead-cut emerald in a gold claw mount -->
      <path d="M 52 54 L 64 28 L 76 54 Z" fill="url(#goldGrad)" stroke="#3a2a10" stroke-width="1.5" />
      <path d="M 56 52 L 64 34 L 72 52 Z" fill="#1b5e20" />
      <path d="M 58 50 L 64 37 L 70 50 Z" fill="#43a047" filter="url(#glow)" />
      <path d="M 61 47 L 64 40 L 67 47 Z" fill="#b9f6ca" />
      <!-- Crimson enamel fletching marks on the band shoulders -->
      <path d="M 30 70 L 36 62 L 38 72 Z" fill="#9e1b1b" stroke="url(#goldGrad)" stroke-width="1" />
      <path d="M 98 70 L 92 62 L 90 72 Z" fill="#9e1b1b" stroke="url(#goldGrad)" stroke-width="1" />
    `,
  },
  {
    id: 'vanguard_band_of_focus',
    bgDark: '#08060c',
    bgMid: '#140f1e',
    bgGlow: '#2a1c40',
    svgArt: `
      ${band(76)}
      <!-- Faceted amethyst ringed by a faint arcane circle -->
      <circle cx="64" cy="46" r="17" fill="none" stroke="#b388ff" stroke-width="1.5" stroke-dasharray="3 3" opacity="0.8" />
      <circle cx="64" cy="46" r="12" fill="#2a0a4a" stroke="url(#goldGrad)" stroke-width="3" />
      <polygon points="64,35 73,42 70,54 58,54 55,42" fill="#7e57c2" filter="url(#glow)" />
      <polygon points="64,39 69,43 67,50 61,50 59,43" fill="#d1c4e9" />
      <circle cx="61" cy="42" r="1.6" fill="#ffffff" />
      <circle cx="44" cy="34" r="1.6" fill="#e1bee7" opacity="0.9" />
      <circle cx="86" cy="36" r="1.3" fill="#e1bee7" opacity="0.8" />
    `,
  },
  {
    id: 'vanguard_band_of_mending',
    bgDark: '#0c0a05',
    bgMid: '#1e180c',
    bgGlow: '#3d3016',
    svgArt: `
      ${band(76)}
      <!-- Dawn topaz cradled in two gold leaves -->
      <path d="M 64 50 Q 44 46 40 30 Q 58 32 64 50 Z" fill="url(#goldGrad)" stroke="#3a2a10" stroke-width="1.2" />
      <path d="M 64 50 Q 84 46 88 30 Q 70 32 64 50 Z" fill="url(#goldGrad)" stroke="#3a2a10" stroke-width="1.2" />
      <ellipse cx="64" cy="44" rx="10" ry="12" fill="#f9a825" stroke="url(#goldGrad)" stroke-width="2.5" filter="url(#glow)" />
      <ellipse cx="64" cy="43" rx="6" ry="8" fill="#fff59d" />
      <circle cx="61" cy="39" r="1.8" fill="#ffffff" />
    `,
  },
  {
    id: 'vanguard_pendant_of_might',
    bgDark: '#0c0606',
    bgMid: '#1e0c0c',
    bgGlow: '#401616',
    svgArt: `
      ${chain}
      <!-- Crimson-enamel heater shield medallion with a ruby boss -->
      <path d="M 40 52 L 88 52 L 88 74 Q 88 98 64 110 Q 40 98 40 74 Z" fill="url(#steelGrad)" stroke="#141010" stroke-width="3" />
      <path d="M 45 57 L 83 57 L 83 74 Q 83 94 64 104 Q 45 94 45 74 Z" fill="#8e1414" />
      <path d="M 45 57 L 83 57 L 83 74 Q 83 94 64 104 Q 45 94 45 74 Z" fill="none" stroke="url(#goldGrad)" stroke-width="2" />
      ${laurel(52, 98, false)}
      ${laurel(76, 98, true)}
      <circle cx="64" cy="76" r="9" fill="#5a0a0a" stroke="url(#goldGrad)" stroke-width="2.5" />
      <circle cx="64" cy="76" r="5.5" fill="#e53935" filter="url(#glow)" />
      <circle cx="62" cy="74" r="1.6" fill="#ffffff" />
      <rect x="60" y="44" width="8" height="10" rx="2" fill="url(#goldGrad)" stroke="#3a2a10" stroke-width="1" />
    `,
  },
  {
    id: 'vanguard_pendant_of_precision',
    bgDark: '#060a07',
    bgMid: '#0f1a12',
    bgGlow: '#1d3522',
    svgArt: `
      ${chain}
      <!-- Steel arrowhead pendant with an emerald inset and crimson binding -->
      <path d="M 64 112 L 40 66 L 56 66 L 56 52 L 72 52 L 72 66 L 88 66 Z" fill="url(#steelGrad)" stroke="#141010" stroke-width="3" stroke-linejoin="round" />
      <path d="M 64 104 L 47 70 L 81 70 Z" fill="none" stroke="url(#goldGrad)" stroke-width="2" stroke-linejoin="round" />
      <rect x="56" y="56" width="16" height="6" fill="#9e1b1b" stroke="url(#goldGrad)" stroke-width="1" />
      <path d="M 56 74 L 64 92 L 72 74 Z" fill="#43a047" filter="url(#glow)" />
      <path d="M 60 76 L 64 85 L 68 76 Z" fill="#b9f6ca" />
      <rect x="60" y="44" width="8" height="10" rx="2" fill="url(#goldGrad)" stroke="#3a2a10" stroke-width="1" />
    `,
  },
  {
    id: 'vanguard_pendant_of_focus',
    bgDark: '#08060c',
    bgMid: '#140f1e',
    bgGlow: '#2a1c40',
    svgArt: `
      ${chain}
      <!-- Round gold-rimmed amulet holding an amethyst eye inside a rune ring -->
      <circle cx="64" cy="80" r="26" fill="url(#steelGrad)" stroke="#141010" stroke-width="3" />
      <circle cx="64" cy="80" r="22" fill="#1a0a2e" stroke="url(#goldGrad)" stroke-width="2.5" />
      <circle cx="64" cy="80" r="16" fill="none" stroke="#b388ff" stroke-width="1.5" stroke-dasharray="4 3" opacity="0.85" />
      <path d="M 46 80 Q 64 66 82 80 Q 64 94 46 80 Z" fill="#4527a0" stroke="url(#goldGrad)" stroke-width="1.5" />
      <circle cx="64" cy="80" r="7" fill="#9575cd" filter="url(#glow)" />
      <circle cx="64" cy="80" r="3.5" fill="#ede7f6" />
      <rect x="60" y="48" width="8" height="8" rx="2" fill="url(#goldGrad)" stroke="#3a2a10" stroke-width="1" />
    `,
  },
  {
    id: 'vanguard_pendant_of_mending',
    bgDark: '#0c0a05',
    bgMid: '#1e180c',
    bgGlow: '#3d3016',
    svgArt: `
      ${chain}
      <!-- Gold sunburst locket with a dawn topaz heart and crimson enamel rays -->
      <g fill="url(#goldGrad)" stroke="#3a2a10" stroke-width="1">
        <polygon points="64,50 68,64 60,64" />
        <polygon points="64,110 68,96 60,96" />
        <polygon points="34,80 48,76 48,84" />
        <polygon points="94,80 80,76 80,84" />
        <polygon points="43,59 54,68 49,72" />
        <polygon points="85,59 74,68 79,72" />
        <polygon points="43,101 54,92 49,88" />
        <polygon points="85,101 74,92 79,88" />
      </g>
      <circle cx="64" cy="80" r="17" fill="url(#steelGrad)" stroke="#141010" stroke-width="2.5" />
      <circle cx="64" cy="80" r="13" fill="#8e1414" stroke="url(#goldGrad)" stroke-width="2" />
      <ellipse cx="64" cy="80" rx="7.5" ry="9" fill="#f9a825" filter="url(#glow)" />
      <ellipse cx="64" cy="79" rx="4.5" ry="5.5" fill="#fff59d" />
      <circle cx="62" cy="76" r="1.5" fill="#ffffff" />
    `,
  },
];

async function main() {
  const mappingData = JSON.parse(readFileSync(mappingPath, 'utf8'));

  for (const item of ITEMS_TO_GENERATE) {
    const fullSvg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="${OUT_PX}" height="${OUT_PX}" viewBox="0 0 128 128">
        <defs>
          <radialGradient id="bgGrad" cx="38%" cy="32%" r="72%">
            <stop offset="0%" stop-color="${item.bgGlow}" />
            <stop offset="50%" stop-color="${item.bgMid}" />
            <stop offset="100%" stop-color="${item.bgDark}" />
          </radialGradient>
          <linearGradient id="steelGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#8a8f96" />
            <stop offset="40%" stop-color="#4a4f57" />
            <stop offset="100%" stop-color="#16181c" />
          </linearGradient>
          <linearGradient id="goldGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#fff1b8" />
            <stop offset="45%" stop-color="#d4a73a" />
            <stop offset="100%" stop-color="#6b4a12" />
          </linearGradient>
          <filter id="glow" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="2.5" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
        </defs>
        <rect width="128" height="128" fill="url(#bgGrad)" />
        ${item.svgArt}
      </svg>
    `;
    const destFile = path.join(itemsDir, `${item.id}.webp`);
    await sharp(Buffer.from(fullSvg))
      .resize(OUT_PX, OUT_PX)
      .webp({ quality: 85, effort: 6 })
      .toFile(destFile);
    console.log(`Generated: ${item.id}.webp`);
  }

  // Provenance is owned by the generatedBatches record (one owner per icon,
  // tests/item_icons.test.ts F); no per-item entry. Upsert so a re-run is a no-op.
  const batch = {
    batchId: BATCH_ID,
    source:
      'Deterministic SVG compositions rendered to WebP with Sharp (scripts/generate_vanguard_jewelry_icons.mjs); no image model',
    owner: 'World of ClaudeCraft',
    license: 'World of ClaudeCraft project-generated art, project asset, rights reserved',
    styleContract: { id: 'woc-item-icon-v1', document: 'docs/design/item-icon-art-style.md' },
    styleReference:
      'woc-item-icon-v1; existing painted item catalog (opaque dark vignette, warm top-left key, cool bottom-right shadow, centered silhouette with safe padding); Vanguard palette of the Season 2 weapons (blackened steel, crimson enamel, burnished gold, laurel motif)',
    commonPrompt:
      'Not a text-to-image prompt: each icon is an authored SVG composition (per-item vector art over a three-stop radial ground) rasterized to an opaque 128x128 sRGB WebP. The exact vector source of every item is the ITEMS_TO_GENERATE table in scripts/generate_vanguard_jewelry_icons.mjs.',
    provenanceRecord: `docs/achievements/${BATCH_ID}/`,
    itemIds: ITEMS_TO_GENERATE.map((item) => item.id).sort(),
  };
  const batches = mappingData.generatedBatches;
  const at = batches.findIndex((b) => b.batchId === BATCH_ID);
  if (at >= 0) batches[at] = batch;
  else batches.push(batch);
  writeFileSync(mappingPath, `${JSON.stringify(mappingData, null, 2)}\n`);
  console.log('mapping.json updated');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
