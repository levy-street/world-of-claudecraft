// scripts/generate_clue_scroll_icons.mjs
// Generates the shipping 128x128 WebP item icons for the two Clue Scroll items
// (src/sim/content/items.ts clue_scroll and treasure_casket; the hunts are in
// src/sim/content/clue_hunts.ts). Same recipe as generate_faction_vendor_icons.mjs:
// an authored SVG composition per item over a three-stop radial ground,
// rasterized with Sharp, meeting the woc-item-icon-v1 contract (opaque dark
// vignette, warm top-left key light, cool bottom-right shadow, centered
// silhouette with safe padding, distinct art per item). The script IS the
// retained source: re-running it reproduces every file byte for byte. It never
// touches mapping.json; the generated batch entry there is hand-authored
// (batch clue-scroll-icons-2026-09-17) with its provenance README under
// docs/achievements/clue-scroll-icons-2026-09-17/.
//
// Usage: node scripts/generate_clue_scroll_icons.mjs

import path from 'node:path';
import sharp from 'sharp';

const repoRoot = process.cwd();
const itemsDir = path.join(repoRoot, 'public/ui/items');
const OUT_PX = 128;

/**
 * Visual specifications for the two Clue Scroll items.
 */
const ITEMS_TO_GENERATE = [
  {
    id: 'clue_scroll',
    name: 'Clue Scroll',
    bgDark: '#0c0a12',
    bgMid: '#1a1424',
    bgGlow: '#302446',
    svgArt: `
      <!-- A weathered parchment scroll, half unrolled, with a faint treasure
           cross inked on it and a red wax seal on a ribbon -->
      <defs>
        <linearGradient id="parchGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#f3e4bc" />
          <stop offset="55%" stop-color="#d9c08c" />
          <stop offset="100%" stop-color="#9c7a48" />
        </linearGradient>
        <linearGradient id="rollGrad" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#fff4d6" />
          <stop offset="50%" stop-color="#c9a86a" />
          <stop offset="100%" stop-color="#6b4d26" />
        </linearGradient>
      </defs>
      <!-- Cast shadow -->
      <path d="M 40 40 L 96 46 L 100 102 L 44 96 Z" fill="#000000" opacity="0.35" />
      <!-- Unrolled sheet -->
      <path d="M 34 34 L 92 40 L 96 96 L 38 90 Z" fill="url(#parchGrad)" stroke="#5a3e1c" stroke-width="2" />
      <!-- Torn edge -->
      <path d="M 92 40 L 90 48 L 94 56 L 91 64 L 95 72 L 92 80 L 96 88 L 96 96" fill="none" stroke="#5a3e1c" stroke-width="1.5" />
      <!-- Faint inked riddle lines -->
      <g stroke="#6b4d26" stroke-width="1.6" stroke-linecap="round" opacity="0.7">
        <line x1="46" y1="52" x2="80" y2="55" />
        <line x1="46" y1="60" x2="74" y2="62.5" />
        <line x1="46" y1="68" x2="82" y2="71" />
        <line x1="46" y1="76" x2="70" y2="78" />
      </g>
      <!-- The treasure cross -->
      <g stroke="#9c2020" stroke-width="3.2" stroke-linecap="round">
        <line x1="72" y1="80" x2="84" y2="92" />
        <line x1="84" y1="80" x2="72" y2="92" />
      </g>
      <!-- Top roll -->
      <path d="M 30 26 Q 64 22 98 32 L 98 44 Q 64 36 30 40 Z" fill="url(#rollGrad)" stroke="#5a3e1c" stroke-width="2" />
      <ellipse cx="30" cy="33" rx="6" ry="7" fill="#e8d3a2" stroke="#5a3e1c" stroke-width="2" />
      <ellipse cx="30" cy="33" rx="2.5" ry="3.5" fill="#8a6a3c" />
      <ellipse cx="98" cy="38" rx="6" ry="7" fill="#e8d3a2" stroke="#5a3e1c" stroke-width="2" />
      <ellipse cx="98" cy="38" rx="2.5" ry="3.5" fill="#8a6a3c" />
      <!-- Ribbon and wax seal -->
      <path d="M 52 84 L 46 108 L 54 102 L 60 110 L 60 88 Z" fill="#8c1c2a" stroke="#4a0e14" stroke-width="1.5" />
      <circle cx="56" cy="86" r="9" fill="#b3202e" stroke="#4a0e14" stroke-width="2" filter="url(#glow)" />
      <circle cx="56" cy="86" r="5.5" fill="none" stroke="#e8707a" stroke-width="1.5" />
      <circle cx="54" cy="84" r="1.6" fill="#ffd6d9" />
    `,
  },
  {
    id: 'treasure_casket',
    name: 'Treasure Casket',
    bgDark: '#0e0a06',
    bgMid: '#22160a',
    bgGlow: '#3e2a12',
    svgArt: `
      <!-- A squat oak casket with iron bands, a domed lid cracked open on a
           spill of gold light, and a brass lock plate -->
      <defs>
        <linearGradient id="oakGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#8a5a2c" />
          <stop offset="50%" stop-color="#5e3a18" />
          <stop offset="100%" stop-color="#2e1a08" />
        </linearGradient>
        <linearGradient id="lidGrad" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#a06a34" />
          <stop offset="100%" stop-color="#4a2c10" />
        </linearGradient>
        <linearGradient id="ironGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#8a9099" />
          <stop offset="60%" stop-color="#3e444c" />
          <stop offset="100%" stop-color="#1c2026" />
        </linearGradient>
      </defs>
      <!-- Cast shadow -->
      <ellipse cx="68" cy="104" rx="42" ry="8" fill="#000000" opacity="0.4" />
      <!-- Gold glow spilling from the open lid -->
      <ellipse cx="64" cy="58" rx="40" ry="10" fill="#ffcc33" opacity="0.55" filter="url(#glow)" />
      <!-- Chest body -->
      <rect x="28" y="58" width="72" height="42" rx="4" fill="url(#oakGrad)" stroke="#1c1006" stroke-width="2.5" />
      <!-- Plank seams -->
      <g stroke="#2e1a08" stroke-width="1.2" opacity="0.8">
        <line x1="28" y1="72" x2="100" y2="72" />
        <line x1="28" y1="86" x2="100" y2="86" />
      </g>
      <!-- Iron bands on the body -->
      <rect x="40" y="58" width="8" height="42" fill="url(#ironGrad)" stroke="#0e1014" stroke-width="1.2" />
      <rect x="80" y="58" width="8" height="42" fill="url(#ironGrad)" stroke="#0e1014" stroke-width="1.2" />
      <!-- Open domed lid, tilted back -->
      <path d="M 26 54 Q 30 22 64 20 Q 98 22 102 54 Z" fill="url(#lidGrad)" stroke="#1c1006" stroke-width="2.5" />
      <path d="M 40 52 Q 42 30 64 28 Q 86 30 88 52" fill="none" stroke="#2e1a08" stroke-width="1.2" opacity="0.8" />
      <rect x="40" y="26" width="8" height="28" rx="2" fill="url(#ironGrad)" stroke="#0e1014" stroke-width="1.2" transform="rotate(-6 44 40)" />
      <rect x="80" y="26" width="8" height="28" rx="2" fill="url(#ironGrad)" stroke="#0e1014" stroke-width="1.2" transform="rotate(6 84 40)" />
      <!-- Coins and a gem peeking over the rim -->
      <circle cx="52" cy="57" r="5" fill="#ffd54a" stroke="#8a5a10" stroke-width="1.2" />
      <circle cx="62" cy="55" r="5" fill="#ffe27a" stroke="#8a5a10" stroke-width="1.2" />
      <circle cx="74" cy="57" r="5" fill="#ffd54a" stroke="#8a5a10" stroke-width="1.2" />
      <polygon points="66,44 72,50 66,56 60,50" fill="#3fd0ff" stroke="#0a4c66" stroke-width="1.2" filter="url(#glow)" />
      <!-- Brass lock plate and hasp -->
      <rect x="57" y="62" width="14" height="16" rx="2" fill="#c9a24a" stroke="#4a3010" stroke-width="1.5" />
      <rect x="61" y="66" width="6" height="6" rx="1" fill="#2e1a08" />
      <rect x="63" y="70" width="2" height="5" fill="#2e1a08" />
      <path d="M 58 62 L 58 56 Q 64 50 70 56 L 70 62" fill="none" stroke="#c9a24a" stroke-width="3" />
      <!-- Warm key highlight on the top-left of the lid -->
      <path d="M 34 44 Q 44 28 60 26" fill="none" stroke="#e0b070" stroke-width="2" opacity="0.7" stroke-linecap="round" />
    `,
  },
];

function composeSvg(item) {
  return `
      <svg xmlns="http://www.w3.org/2000/svg" width="${OUT_PX}" height="${OUT_PX}" viewBox="0 0 128 128">
        <defs>
          <radialGradient id="bgGrad" cx="38%" cy="32%" r="72%">
            <stop offset="0%" stop-color="${item.bgGlow}" />
            <stop offset="50%" stop-color="${item.bgMid}" />
            <stop offset="100%" stop-color="${item.bgDark}" />
          </radialGradient>
          <filter id="glow" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="2.5" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
        </defs>
        <!-- Dark painted ground vignette -->
        <rect width="128" height="128" fill="url(#bgGrad)" />
        <!-- Subject artwork -->
        ${item.svgArt}
      </svg>
    `;
}

async function main() {
  console.log(`Generating ${ITEMS_TO_GENERATE.length} Clue Scroll WebP icons...`);
  for (const item of ITEMS_TO_GENERATE) {
    const destFile = path.join(itemsDir, `${item.id}.webp`);
    await sharp(Buffer.from(composeSvg(item)))
      .resize(OUT_PX, OUT_PX)
      .webp({ quality: 85, effort: 6 })
      .toFile(destFile);
    console.log(`Generated: ${item.id}.webp`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
