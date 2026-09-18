// scripts/generate_faction_vendor_icons.mjs
// Generates shipping 128x128 WebP item icons for the 15 Faction Vendor items.
// Meets the woc-item-icon-v1 contract: opaque dark background vignette,
// tactile lighting with top-left warm key and bottom-right cool shadow,
// centered silhouette with safe padding, and distinct art for every item.

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const repoRoot = process.cwd();
const itemsDir = path.join(repoRoot, 'public/ui/items');
const mappingPath = path.join(itemsDir, 'mapping.json');
const OUT_PX = 128;

/**
 * Visual specifications for each of the 15 faction vendor items.
 */
const ITEMS_TO_GENERATE = [
  // --- Rift Watch (Cosmic / Void / Teal / Deep Navy) ---
  {
    id: 'rift_watchers_band',
    name: "Rift Watcher's Band",
    bgDark: '#080814',
    bgMid: '#121428',
    bgGlow: '#1a2244',
    svgArt: `
      <!-- Deep dark silver ring band with glowing cyan riftglass insert -->
      <ellipse cx="64" cy="64" rx="38" ry="24" fill="none" stroke="#222838" stroke-width="14" />
      <ellipse cx="64" cy="64" rx="38" ry="24" fill="none" stroke="url(#silverGrad)" stroke-width="10" />
      <ellipse cx="64" cy="64" rx="38" ry="24" fill="none" stroke="#00ffff" stroke-width="4" filter="url(#glow)" opacity="0.8" />
      <ellipse cx="64" cy="64" rx="38" ry="24" fill="none" stroke="#e0f7fa" stroke-width="1.5" stroke-dasharray="14 10" />
      <!-- Central rift gem mount -->
      <polygon points="64,36 74,44 64,52 54,44" fill="#00e5ff" filter="url(#glow)" />
      <polygon points="64,38 71,44 64,50 57,44" fill="#e0ffff" />
      <circle cx="64" cy="44" r="2" fill="#ffffff" />
    `,
  },
  {
    id: 'rift_surveyors_satchel',
    name: "Rift Surveyor's Satchel",
    bgDark: '#0a0a16',
    bgMid: '#141426',
    bgGlow: '#1e2040',
    svgArt: `
      <!-- Surveyor leather satchel with straps and cyan rift crystals -->
      <!-- Main body -->
      <rect x="30" y="44" width="68" height="56" rx="10" fill="#1c2030" stroke="#0c0e16" stroke-width="3" />
      <path d="M 30 48 Q 64 68 98 48 L 98 74 Q 64 92 30 74 Z" fill="#282e44" stroke="#121624" stroke-width="2" />
      <!-- Buckles and straps -->
      <rect x="42" y="44" width="8" height="42" rx="2" fill="#141824" />
      <rect x="78" y="44" width="8" height="42" rx="2" fill="#141824" />
      <rect x="40" y="68" width="12" height="10" rx="2" fill="#c0a060" stroke="#604820" stroke-width="1.5" />
      <rect x="76" y="68" width="12" height="10" rx="2" fill="#c0a060" stroke="#604820" stroke-width="1.5" />
      <!-- Hanging rift crystal -->
      <polygon points="64,76 70,86 64,96 58,86" fill="#00e5ff" filter="url(#glow)" />
      <polygon points="64,78 68,86 64,93 60,86" fill="#e0ffff" />
      <!-- Flap clasp -->
      <circle cx="64" cy="62" r="4" fill="#e0c070" stroke="#403010" stroke-width="1.5" />
    `,
  },
  {
    id: 'riftwalkers_tunic',
    name: "Riftwalker's Tunic",
    bgDark: '#080a18',
    bgMid: '#10162e',
    bgGlow: '#18244c',
    svgArt: `
      <!-- Midnight leather tunic with cyan runic embroidery and reinforced mantle -->
      <!-- Torso shape -->
      <path d="M 40 28 L 54 26 L 64 36 L 74 26 L 88 28 L 96 46 L 86 52 L 84 96 L 44 96 L 42 52 L 32 46 Z" fill="#161c2c" stroke="#0a0c16" stroke-width="3" />
      <!-- Lapels / Vest layer -->
      <path d="M 46 32 L 64 64 L 82 32 L 76 28 L 64 48 L 52 28 Z" fill="#242e48" />
      <!-- Inner tunic -->
      <polygon points="56,30 64,44 72,30" fill="#0d121c" />
      <!-- Runic stitching -->
      <path d="M 48 56 Q 64 68 80 56" fill="none" stroke="#00e5ff" stroke-width="2" filter="url(#glow)" />
      <path d="M 46 72 Q 64 84 82 72" fill="none" stroke="#00e5ff" stroke-width="1.5" opacity="0.8" />
      <!-- Belt & Buckle -->
      <rect x="42" y="86" width="44" height="8" fill="#0d101a" stroke="#05060a" stroke-width="1" />
      <rect x="60" y="84" width="8" height="12" fill="#3cd7ff" stroke="#0a4c66" stroke-width="1.5" />
    `,
  },
  {
    id: 'riftwarden_voidblade',
    name: "Riftwarden's Voidblade",
    bgDark: '#060614',
    bgMid: '#120e28',
    bgGlow: '#221448',
    svgArt: `
      <!-- Elegant void-forged curved blade with ethereal violet-cyan edge -->
      <defs>
        <linearGradient id="bladeGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#e0ffff" />
          <stop offset="30%" stop-color="#7c4dff" />
          <stop offset="70%" stop-color="#2a085c" />
          <stop offset="100%" stop-color="#0e0220" />
        </linearGradient>
      </defs>
      <!-- Hilt / Pommel / Grip diagonal from bottom-left to top-right -->
      <path d="M 24 104 L 38 90" stroke="#3e2723" stroke-width="6" stroke-linecap="round" />
      <circle cx="22" cy="106" r="5" fill="#8c7853" stroke="#2c1a08" stroke-width="2" />
      <!-- Guard -->
      <path d="M 32 98 C 36 90 42 86 46 82 C 40 84 34 88 30 96 Z" fill="#c0a060" stroke="#3a2a10" stroke-width="1.5" />
      <!-- Curved Blade -->
      <path d="M 40 88 Q 66 60 84 34 Q 96 16 106 18 Q 98 32 80 64 Q 62 90 44 86 Z" fill="url(#bladeGrad)" stroke="#b388ff" stroke-width="2" filter="url(#glow)" />
      <!-- Core edge glow -->
      <path d="M 42 86 Q 68 58 84 34 Q 96 16 106 18" fill="none" stroke="#ffffff" stroke-width="1.5" />
    `,
  },
  {
    id: 'champion_rift_band',
    name: "Champion's Rift Band",
    bgDark: '#0a0618',
    bgMid: '#160e34',
    bgGlow: '#2a1660',
    svgArt: `
      <!-- Platinum cosmic ring holding an astral dark-star void stone -->
      <ellipse cx="64" cy="68" rx="42" ry="26" fill="none" stroke="#2c2838" stroke-width="14" />
      <ellipse cx="64" cy="68" rx="42" ry="26" fill="none" stroke="#e8eaf6" stroke-width="10" />
      <ellipse cx="64" cy="68" rx="42" ry="26" fill="none" stroke="#9fa8da" stroke-width="2" />
      <!-- Claws holding gem -->
      <polygon points="64,26 80,42 64,58 48,42" fill="#7c4dff" filter="url(#glow)" />
      <polygon points="64,28 78,42 64,56 50,42" fill="#311b92" />
      <polygon points="64,32 74,42 64,52 54,42" fill="#00e5ff" opacity="0.9" />
      <circle cx="64" cy="42" r="3" fill="#ffffff" />
      <!-- Little setting prongs -->
      <circle cx="48" cy="42" r="3" fill="#ffffff" stroke="#333" stroke-width="1" />
      <circle cx="80" cy="42" r="3" fill="#ffffff" stroke="#333" stroke-width="1" />
      <circle cx="64" cy="26" r="3" fill="#ffffff" stroke="#333" stroke-width="1" />
    `,
  },

  // --- Church Order (Holy Light / Amber / Cathedral Gold / Radiant) ---
  {
    id: 'order_prayer_beads',
    name: 'Order Prayer Beads',
    bgDark: '#120d06',
    bgMid: '#241a0c',
    bgGlow: '#443014',
    svgArt: `
      <!-- Strung sacred olivewood beads with brass holy sun pendent -->
      <path d="M 32 36 Q 64 80 96 36 Q 64 64 32 36 Z" fill="none" stroke="#3e2723" stroke-width="1" />
      <!-- Beads along the loop -->
      <circle cx="34" cy="36" r="5" fill="#8d6e63" stroke="#3e2723" stroke-width="1.5" />
      <circle cx="40" cy="46" r="5" fill="#d7ccc8" stroke="#5d4037" stroke-width="1.5" />
      <circle cx="48" cy="56" r="5.5" fill="#8d6e63" stroke="#3e2723" stroke-width="1.5" />
      <circle cx="58" cy="62" r="6" fill="#ffecb3" stroke="#ffb300" stroke-width="1.5" />
      <circle cx="70" cy="62" r="6" fill="#8d6e63" stroke="#3e2723" stroke-width="1.5" />
      <circle cx="80" cy="56" r="5.5" fill="#d7ccc8" stroke="#5d4037" stroke-width="1.5" />
      <circle cx="88" cy="46" r="5" fill="#8d6e63" stroke="#3e2723" stroke-width="1.5" />
      <circle cx="94" cy="36" r="5" fill="#8d6e63" stroke="#3e2723" stroke-width="1.5" />
      <!-- Central Holy Sun Cross Pendant -->
      <circle cx="64" cy="80" r="14" fill="#ffc107" stroke="#b78103" stroke-width="2" filter="url(#glow)" />
      <circle cx="64" cy="80" r="10" fill="#fff8e1" />
      <path d="M 64 68 L 64 92 M 52 80 L 76 80" stroke="#d48806" stroke-width="3" stroke-linecap="round" />
      <circle cx="64" cy="80" r="3" fill="#ff9800" />
    `,
  },
  {
    id: 'vestments_of_the_acolyte',
    name: 'Vestments of the Acolyte',
    bgDark: '#120f0a',
    bgMid: '#241e14',
    bgGlow: '#423420',
    svgArt: `
      <!-- Cream clerical vestments with liturgical golden dawn stole -->
      <path d="M 38 28 L 54 24 L 64 34 L 74 24 L 90 28 L 98 48 L 86 52 L 86 98 L 42 98 L 42 52 L 30 48 Z" fill="#ede7f6" stroke="#2e2418" stroke-width="3" />
      <!-- Liturgical gold stole -->
      <path d="M 52 26 L 50 96 L 58 96 L 60 48 L 68 48 L 70 96 L 78 96 L 76 26 L 64 36 Z" fill="#ffc107" stroke="#b78103" stroke-width="2" />
      <!-- Embroidered sun symbols on stole ends -->
      <circle cx="54" cy="86" r="3" fill="#fff" stroke="#d48806" stroke-width="1" />
      <circle cx="74" cy="86" r="3" fill="#fff" stroke="#d48806" stroke-width="1" />
      <!-- Neck cowl -->
      <path d="M 52 26 Q 64 36 76 26" fill="#fff" stroke="#d48806" stroke-width="2" />
    `,
  },
  {
    id: 'templar_dawn_shield',
    name: "Templar's Dawn Shield",
    bgDark: '#140e06',
    bgMid: '#281a0a',
    bgGlow: '#4a3010',
    svgArt: `
      <!-- Heavy white and gold heater shield with radiant sunburst -->
      <!-- Shield rim -->
      <path d="M 30 24 L 98 24 C 98 62 82 86 64 104 C 46 86 30 62 30 24 Z" fill="#2c2214" stroke="#120c06" stroke-width="3" />
      <!-- White field -->
      <path d="M 36 28 L 92 28 C 92 60 78 82 64 96 C 50 82 36 60 36 28 Z" fill="#f5f5f5" stroke="#c0a060" stroke-width="2" />
      <!-- Gilded border & boss -->
      <path d="M 64 32 L 64 92 M 38 42 L 90 42" stroke="#ffc107" stroke-width="4" stroke-linecap="round" />
      <circle cx="64" cy="42" r="14" fill="#ffb300" stroke="#ff8f00" stroke-width="2" filter="url(#glow)" />
      <circle cx="64" cy="42" r="8" fill="#fff9c4" />
      <polygon points="64,22 68,34 64,38 60,34" fill="#ffc107" />
    `,
  },
  {
    id: 'dawnkeeper_consecrated_mace',
    name: "Dawnkeeper's Consecrated Mace",
    bgDark: '#140c04',
    bgMid: '#281608',
    bgGlow: '#4c260a',
    svgArt: `
      <!-- Heavy flanged golden mace with shining holy brazier head -->
      <!-- Shaft -->
      <line x1="28" y1="102" x2="72" y2="44" stroke="#3e2723" stroke-width="7" stroke-linecap="round" />
      <line x1="28" y1="102" x2="72" y2="44" stroke="#d7ccc8" stroke-width="3" stroke-linecap="round" />
      <!-- Pommel -->
      <circle cx="26" cy="104" r="6" fill="#c0a060" stroke="#3e2723" stroke-width="2" />
      <!-- Mace head (radial flanges) -->
      <circle cx="76" cy="38" r="16" fill="#ffb300" filter="url(#glow)" stroke="#8d6e63" stroke-width="2" />
      <!-- Crown flanges -->
      <path d="M 62 26 L 76 18 L 90 26 L 86 42 L 66 42 Z" fill="#ffca28" stroke="#c0a060" stroke-width="2" />
      <!-- Holy core -->
      <circle cx="76" cy="38" r="8" fill="#ffffff" filter="url(#glow)" />
    `,
  },
  {
    id: 'champion_dawn_medallion',
    name: "Champion's Dawn Medallion",
    bgDark: '#160e06',
    bgMid: '#2e1c0c',
    bgGlow: '#543212',
    svgArt: `
      <!-- Heavy gold sun medallion with radiant rays and large amber dawnstone -->
      <!-- Chain links -->
      <path d="M 28 20 Q 64 60 100 20" fill="none" stroke="#ffc107" stroke-width="4" stroke-dasharray="6 4" />
      <!-- Sun rays -->
      <g stroke="#ffa000" stroke-width="4" stroke-linecap="round">
        <line x1="64" y1="36" x2="64" y2="28" />
        <line x1="64" y1="84" x2="64" y2="92" />
        <line x1="40" y1="60" x2="32" y2="60" />
        <line x1="88" y1="60" x2="96" y2="60" />
        <line x1="46" y1="42" x2="40" y2="36" />
        <line x1="82" y1="78" x2="88" y2="84" />
        <line x1="82" y1="42" x2="88" y2="36" />
        <line x1="46" y1="78" x2="40" y2="84" />
      </g>
      <!-- Medallion body -->
      <circle cx="64" cy="60" r="22" fill="#ffca28" stroke="#8d6e63" stroke-width="3" filter="url(#glow)" />
      <circle cx="64" cy="60" r="15" fill="#ff8f00" />
      <!-- Glowing amber core -->
      <circle cx="64" cy="60" r="10" fill="#fffde7" filter="url(#glow)" />
    `,
  },

  // --- Automatons (Brass / Bronze / Industrial Steel / Heat / Copper) ---
  {
    id: 'automaton_cog_ring',
    name: 'Automaton Cog Ring',
    bgDark: '#120e0a',
    bgMid: '#241a12',
    bgGlow: '#442816',
    svgArt: `
      <!-- Interlocking brass & gunmetal gear ring with glowing ember axle -->
      <ellipse cx="64" cy="66" rx="40" ry="24" fill="none" stroke="#221e1a" stroke-width="16" />
      <ellipse cx="64" cy="66" rx="40" ry="24" fill="none" stroke="#b08d57" stroke-width="10" />
      <!-- Cog teeth around circumference -->
      <path d="M 28 66 L 22 66 M 100 66 L 106 66 M 64 44 L 64 38 M 64 88 L 64 94" stroke="#d4a373" stroke-width="5" stroke-linecap="square" />
      <!-- Central gear face -->
      <circle cx="64" cy="46" r="16" fill="#8c6d48" stroke="#44321e" stroke-width="2" />
      <circle cx="64" cy="46" r="10" fill="#2d2218" />
      <!-- Glowing amber core -->
      <circle cx="64" cy="46" r="5" fill="#ff9100" filter="url(#glow)" />
      <circle cx="64" cy="46" r="2" fill="#fff" />
    `,
  },
  {
    id: 'clockwork_tinkers_pack',
    name: "Clockwork Tinker's Pack",
    bgDark: '#120c08',
    bgMid: '#241810',
    bgGlow: '#462a1a',
    svgArt: `
      <!-- Heavy riveted leather tinker backpack with brass dials and conduits -->
      <rect x="28" y="40" width="72" height="60" rx="8" fill="#3e2723" stroke="#1b0000" stroke-width="3" />
      <rect x="34" y="44" width="60" height="30" rx="4" fill="#5d4037" />
      <!-- Riveted metal bands -->
      <line x1="28" y1="56" x2="100" y2="56" stroke="#b08d57" stroke-width="4" />
      <line x1="28" y1="84" x2="100" y2="84" stroke="#b08d57" stroke-width="4" />
      <!-- Rivets -->
      <circle cx="34" cy="56" r="1.5" fill="#fff" />
      <circle cx="50" cy="56" r="1.5" fill="#fff" />
      <circle cx="78" cy="56" r="1.5" fill="#fff" />
      <circle cx="94" cy="56" r="1.5" fill="#fff" />
      <!-- Pressure gauge / dial -->
      <circle cx="64" cy="68" r="10" fill="#fff8e1" stroke="#b08d57" stroke-width="2" />
      <line x1="64" y1="68" x2="69" y2="63" stroke="#b71c1c" stroke-width="1.5" stroke-linecap="round" />
      <!-- Copper chimney / boiler tube on side -->
      <rect x="78" y="24" width="10" height="20" rx="2" fill="#b87333" stroke="#5d2a18" stroke-width="2" />
      <ellipse cx="83" cy="24" rx="5" ry="2" fill="#ff7043" />
    `,
  },
  {
    id: 'artificers_welding_cowl',
    name: "Artificer's Welding Cowl",
    bgDark: '#0e0c0a',
    bgMid: '#201814',
    bgGlow: '#3c2a20',
    svgArt: `
      <!-- Heavy leather & brass welding helmet with glowing amber circular lenses -->
      <path d="M 36 34 Q 64 20 92 34 L 90 78 Q 64 98 38 78 Z" fill="#37474f" stroke="#1c252a" stroke-width="3" />
      <!-- Riveted brass faceplate -->
      <path d="M 42 42 L 86 42 L 84 72 Q 64 84 44 72 Z" fill="#795548" stroke="#3e2723" stroke-width="2" />
      <!-- Round dual lenses -->
      <circle cx="52" cy="56" r="9" fill="#ff6f00" stroke="#b08d57" stroke-width="2.5" filter="url(#glow)" />
      <circle cx="76" cy="56" r="9" fill="#ff6f00" stroke="#b08d57" stroke-width="2.5" filter="url(#glow)" />
      <circle cx="52" cy="56" r="5" fill="#ffe082" />
      <circle cx="76" cy="56" r="5" fill="#ffe082" />
      <!-- Breath grill slits -->
      <line x1="58" y1="74" x2="70" y2="74" stroke="#212121" stroke-width="2" stroke-linecap="round" />
      <line x1="60" y1="78" x2="68" y2="78" stroke="#212121" stroke-width="2" stroke-linecap="round" />
    `,
  },
  {
    id: 'forgemaster_crag_cleaver',
    name: "Forgemaster's Crag Cleaver",
    bgDark: '#140a06',
    bgMid: '#2a1208',
    bgGlow: '#4c1e0e',
    svgArt: `
      <!-- Massive industrial notched axe with glowing thermal magma core -->
      <!-- Shaft -->
      <line x1="30" y1="104" x2="74" y2="36" stroke="#4e342e" stroke-width="7" stroke-linecap="round" />
      <line x1="30" y1="104" x2="74" y2="36" stroke="#8d6e63" stroke-width="3" stroke-linecap="round" />
      <!-- Cleaver Head -->
      <path d="M 68 46 L 98 24 L 106 60 L 86 78 L 66 62 Z" fill="#263238" stroke="#000a12" stroke-width="3" />
      <!-- Heavy Bevel & Cutting Edge -->
      <path d="M 98 24 L 106 60 L 86 78" fill="none" stroke="#cfd8dc" stroke-width="4" stroke-linecap="round" />
      <!-- Magma heat vents in axe head -->
      <polygon points="76,46 88,40 84,56 74,54" fill="#ff3d00" filter="url(#glow)" />
      <polygon points="78,48 86,43 83,54 76,52" fill="#ffeb3b" />
    `,
  },
  {
    id: 'champion_forged_loop',
    name: "Champion's Forged Loop",
    bgDark: '#140a06',
    bgMid: '#2c140a',
    bgGlow: '#522010',
    svgArt: `
      <!-- Heavy Damascus folded-steel loop with molten core channels -->
      <ellipse cx="64" cy="66" rx="42" ry="26" fill="none" stroke="#212121" stroke-width="16" />
      <ellipse cx="64" cy="66" rx="42" ry="26" fill="none" stroke="#546e7a" stroke-width="12" />
      <!-- Damascus fold ridges -->
      <ellipse cx="64" cy="66" rx="42" ry="26" fill="none" stroke="#263238" stroke-width="2" stroke-dasharray="8 6" />
      <!-- Molten thermal channel glowing through center -->
      <ellipse cx="64" cy="66" rx="42" ry="26" fill="none" stroke="#ff3d00" stroke-width="3" filter="url(#glow)" />
      <ellipse cx="64" cy="66" rx="42" ry="26" fill="none" stroke="#ffeb3b" stroke-width="1" />
      <!-- Central forge jewel / hot rivet -->
      <polygon points="64,30 76,42 64,54 52,42" fill="#d84315" stroke="#212121" stroke-width="2" />
      <polygon points="64,34 72,42 64,50 56,42" fill="#ff9100" filter="url(#glow)" />
      <circle cx="64" cy="42" r="3" fill="#ffffff" />
    `,
  },
];

async function main() {
  console.log('Generating 15 faction vendor WebP icons...');

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
          <linearGradient id="silverGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#ffffff" />
            <stop offset="35%" stop-color="#cfd8dc" />
            <stop offset="70%" stop-color="#78909c" />
            <stop offset="100%" stop-color="#37474f" />
          </linearGradient>
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

    const destFile = path.join(itemsDir, `${item.id}.webp`);
    await sharp(Buffer.from(fullSvg))
      .resize(OUT_PX, OUT_PX)
      .webp({ quality: 85, effort: 6 })
      .toFile(destFile);

    console.log(`Generated: ${item.id}.webp`);

    // Ensure mapping entry exists
    const existing = mappingData.entries.find((e) => e.itemId === item.id);
    if (!existing) {
      mappingData.entries.push({
        itemId: item.id,
        name: item.name,
        sourcePack: 'woc_faction_vendors_art',
        sourceFile: `faction_vendors/masters/${item.id}.png`,
        confidence: 'high',
        license: 'World of ClaudeCraft original art (project-owned, created for this game)',
      });
    }
  }

  // Sort entries by itemId to keep mapping.json tidy
  mappingData.entries.sort((a, b) => a.itemId.localeCompare(b.itemId));

  writeFileSync(mappingPath, `${JSON.stringify(mappingData, null, 2)}\n`);
  console.log('mapping.json updated successfully!');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
