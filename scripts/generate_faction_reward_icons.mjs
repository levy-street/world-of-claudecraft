// scripts/generate_faction_reward_icons.mjs
// Generates shipping 128x128 WebP item icons for the 18 Faction Reward & Toy items.
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
 * Visual specifications for each of the 18 faction reward items.
 */
const ITEMS_TO_GENERATE = [
  // --- Allied Cross-Faction Vanguard Rewards ---
  {
    id: 'allied_hearthstone',
    name: 'Allied Hearthstone',
    bgDark: '#080812',
    bgMid: '#161426',
    bgGlow: '#2e264a',
    svgArt: `
      <!-- Deep rune-carved river stone with 3 faction gems and swirling center -->
      <defs>
        <radialGradient id="hearthCore" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stop-color="#ffffff" />
          <stop offset="30%" stop-color="#ffe082" />
          <stop offset="65%" stop-color="#ff7043" />
          <stop offset="100%" stop-color="#5d1049" />
        </radialGradient>
      </defs>
      <!-- Base Stone Body -->
      <path d="M 44 24 C 68 18, 92 30, 98 52 C 104 74, 94 100, 70 106 C 46 112, 28 94, 26 68 C 24 44, 32 28, 44 24 Z"
            fill="#2c2a38" stroke="#14131c" stroke-width="4" />
      <path d="M 46 28 C 66 22, 88 34, 94 54 C 98 72, 90 96, 68 102 C 48 108, 32 92, 30 70 C 28 48, 36 32, 46 28 Z"
            fill="#3e3c50" />
      <!-- Tri-faction gems -->
      <!-- Church of Dawn (Top Gold Gem) -->
      <polygon points="64,28 72,36 64,44 56,36" fill="#ffd54f" stroke="#ff8f00" stroke-width="1.5" filter="url(#glow)" />
      <!-- Rift Watch (Bottom-Left Cyan Gem) -->
      <polygon points="40,78 48,84 42,92 34,86" fill="#00e5ff" stroke="#0097a7" stroke-width="1.5" filter="url(#glow)" />
      <!-- Automatons (Bottom-Right Copper Cog) -->
      <circle cx="84" cy="80" r="8" fill="#d87a38" stroke="#7a3410" stroke-width="2" />
      <circle cx="84" cy="80" r="3" fill="#3e3c50" />
      <!-- Swirling Hearth Center -->
      <ellipse cx="62" cy="62" rx="20" ry="16" fill="url(#hearthCore)" filter="url(#glow)" />
      <path d="M 52 64 Q 62 50 72 62 Q 62 74 52 64 Z" fill="#ffffff" opacity="0.9" />
      <circle cx="62" cy="62" r="4" fill="#ffffff" />
    `,
  },
  {
    id: 'allied_vanguard_duffel',
    name: 'Allied Vanguard Duffel',
    bgDark: '#0a0d0c',
    bgMid: '#141c1a',
    bgGlow: '#1f2e2a',
    svgArt: `
      <!-- Heavy military canvas duffel bag with leather straps and bronze buckles -->
      <!-- Main duffel cylinder / pack -->
      <rect x="26" y="38" width="76" height="58" rx="14" fill="#2d3832" stroke="#121815" stroke-width="3.5" />
      <!-- Top roll flap -->
      <path d="M 28 44 C 28 32, 100 32, 100 44 L 96 56 C 96 56, 64 62, 32 56 Z" fill="#3b4a42" stroke="#161f1b" stroke-width="2" />
      <!-- Horizontal reinforcement band -->
      <rect x="27" y="74" width="74" height="12" fill="#222c26" />
      <!-- Vertical leather straps -->
      <rect x="42" y="34" width="8" height="62" rx="2" fill="#543824" stroke="#2a1a10" stroke-width="1.5" />
      <rect x="78" y="34" width="8" height="62" rx="2" fill="#543824" stroke="#2a1a10" stroke-width="1.5" />
      <!-- Brass buckles -->
      <rect x="40" y="58" width="12" height="10" rx="2" fill="#e0a840" stroke="#7a5010" stroke-width="1.5" />
      <rect x="76" y="58" width="12" height="10" rx="2" fill="#e0a840" stroke="#7a5010" stroke-width="1.5" />
      <!-- Vanguard insignia emblem in center -->
      <polygon points="64,54 72,66 64,74 56,66" fill="#00bcd4" stroke="#e0a840" stroke-width="1.5" />
      <circle cx="64" cy="65" r="2.5" fill="#fff9c4" />
    `,
  },

  // --- Rift Watch (Cosmic / Void / Teal / Midnight) ---
  {
    id: 'rift_feather_glider',
    name: 'Rift Feather Glider',
    bgDark: '#080614',
    bgMid: '#12102e',
    bgGlow: '#1f1a4e',
    svgArt: `
      <!-- Sleek mechanical swept wings with glowing teal plumes -->
      <!-- Center harness hub -->
      <ellipse cx="64" cy="68" rx="12" ry="18" fill="#1e1832" stroke="#0d0a18" stroke-width="2" />
      <!-- Harness core gem -->
      <polygon points="64,60 70,68 64,76 58,68" fill="#00e5ff" filter="url(#glow)" />
      <!-- Left Wing Struts -->
      <path d="M 58 64 L 20 38 C 22 52, 28 66, 38 78 L 56 72 Z" fill="#182038" stroke="#00e5ff" stroke-width="2" />
      <path d="M 22 42 Q 36 56 46 64" stroke="#80d8ff" stroke-width="2" fill="none" />
      <path d="M 18 36 C 24 50, 32 64, 44 74" stroke="#00e5ff" stroke-width="1.5" fill="none" opacity="0.8" />
      <!-- Right Wing Struts -->
      <path d="M 70 64 L 108 38 C 106 52, 100 66, 90 78 L 72 72 Z" fill="#182038" stroke="#00e5ff" stroke-width="2" />
      <path d="M 106 42 Q 92 56 82 64" stroke="#80d8ff" stroke-width="2" fill="none" />
      <path d="M 110 36 C 104 50, 96 64, 84 74" stroke="#00e5ff" stroke-width="1.5" fill="none" opacity="0.8" />
      <!-- Wingtip glowing plumes -->
      <circle cx="19" cy="37" r="3.5" fill="#e0ffff" filter="url(#glow)" />
      <circle cx="109" cy="37" r="3.5" fill="#e0ffff" filter="url(#glow)" />
    `,
  },
  {
    id: 'formula_enchant_feet_shadowstride',
    name: 'Formula: Enchant Boots - Shadowstride',
    bgDark: '#080816',
    bgMid: '#14122c',
    bgGlow: '#221c4e',
    svgArt: `
      <!-- Purple vellum scroll with glowing teal ribbon and shadow boot rune -->
      <path d="M 36 28 L 86 28 L 94 96 L 44 96 Z" fill="#d4c8b0" stroke="#4a3e2a" stroke-width="3" />
      <path d="M 40 32 L 82 32 L 90 92 L 48 92 Z" fill="#eee4cc" />
      <!-- Indigo ribbon wrapping -->
      <path d="M 34 56 L 96 56 L 94 66 L 36 66 Z" fill="#311b92" stroke="#120640" stroke-width="1.5" />
      <circle cx="65" cy="61" r="8" fill="#00e5ff" filter="url(#glow)" />
      <circle cx="65" cy="61" r="5" fill="#b388ff" />
      <!-- Shadow boot glyph -->
      <path d="M 58 40 L 70 40 L 70 48 L 76 50 L 76 53 L 56 53 Z" fill="#4527a0" />
      <!-- Rune lines -->
      <line x1="52" y1="74" x2="80" y2="74" stroke="#5c4430" stroke-width="2" stroke-dasharray="4 3" />
      <line x1="50" y1="82" x2="76" y2="82" stroke="#5c4430" stroke-width="2" stroke-dasharray="5 3" />
    `,
  },
  {
    id: 'recipe_potion_of_invisibility',
    name: 'Recipe: Potion of Invisibility',
    bgDark: '#0a0818',
    bgMid: '#161230',
    bgGlow: '#261c52',
    svgArt: `
      <!-- Aged parchment with alchemical diagram of vanishing vial -->
      <rect x="32" y="24" width="64" height="80" rx="4" fill="#dfd3be" stroke="#52422e" stroke-width="3" />
      <rect x="36" y="28" width="56" height="72" fill="#f2ebd9" />
      <!-- Flask drawing with ethereal violet haze -->
      <ellipse cx="64" cy="56" rx="14" ry="14" fill="#b388ff" opacity="0.4" filter="url(#glow)" />
      <path d="M 60 40 L 68 40 L 68 48 L 74 58 L 72 68 L 56 68 L 54 58 L 60 48 Z"
            fill="none" stroke="#651fff" stroke-width="2" stroke-dasharray="4 2" />
      <!-- Alchemical runes -->
      <circle cx="64" cy="58" r="4" fill="#7c4dff" opacity="0.7" />
      <line x1="44" y1="80" x2="84" y2="80" stroke="#7a6248" stroke-width="2" stroke-dasharray="6 3" />
      <line x1="44" y1="88" x2="74" y2="88" stroke="#7a6248" stroke-width="2" stroke-dasharray="5 3" />
    `,
  },
  {
    id: 'potion_of_invisibility',
    name: 'Potion of Invisibility',
    bgDark: '#060614',
    bgMid: '#100e26',
    bgGlow: '#1a1642',
    svgArt: `
      <!-- Translucent crystal flask with shimmering ethereal haze and cork -->
      <!-- Cork & Neck -->
      <rect x="58" y="24" width="12" height="10" rx="2" fill="#8d6e63" stroke="#4e342e" stroke-width="1.5" />
      <path d="M 56 34 L 72 34 L 70 46 L 58 46 Z" fill="#b0bec5" opacity="0.6" stroke="#455a64" stroke-width="1.5" />
      <!-- Round flask body -->
      <circle cx="64" cy="74" r="30" fill="#1a1c38" stroke="#78909c" stroke-width="2.5" />
      <!-- Shimmering ethereal liquid inside (semi-vanishing) -->
      <circle cx="64" cy="76" r="24" fill="#7c4dff" opacity="0.35" filter="url(#glow)" />
      <ellipse cx="64" cy="80" rx="18" ry="12" fill="#00e5ff" opacity="0.4" />
      <!-- Translucent glass gleam -->
      <path d="M 48 58 C 42 66, 42 80, 50 90" stroke="#ffffff" stroke-width="3" fill="none" opacity="0.8" stroke-linecap="round" />
      <circle cx="76" cy="66" r="2.5" fill="#ffffff" opacity="0.9" />
      <circle cx="60" cy="74" r="1.5" fill="#e0f7fa" />
    `,
  },
  {
    id: 'pattern_reinforced_armor_kit',
    name: 'Pattern: Reinforced Armor Kit',
    bgDark: '#120c06',
    bgMid: '#24180c',
    bgGlow: '#3d2814',
    svgArt: `
      <!-- Leatherworking blueprint parchment with armor patch schema -->
      <rect x="30" y="24" width="68" height="80" rx="5" fill="#d9cbb4" stroke="#4e3b26" stroke-width="3" />
      <rect x="35" y="29" width="58" height="70" fill="#ede2ce" />
      <!-- Leather square schema -->
      <rect x="46" y="40" width="36" height="34" rx="4" fill="#6d4c41" stroke="#3e2723" stroke-width="2" />
      <!-- Rivet dots in corners -->
      <circle cx="51" cy="45" r="2" fill="#b0bec5" stroke="#37474f" stroke-width="1" />
      <circle cx="77" cy="45" r="2" fill="#b0bec5" stroke="#37474f" stroke-width="1" />
      <circle cx="51" cy="69" r="2" fill="#b0bec5" stroke="#37474f" stroke-width="1" />
      <circle cx="77" cy="69" r="2" fill="#b0bec5" stroke="#37474f" stroke-width="1" />
      <!-- Crossed needles symbol -->
      <line x1="42" y1="84" x2="86" y2="84" stroke="#4e3b26" stroke-width="2" stroke-dasharray="6 3" />
      <line x1="42" y1="90" x2="74" y2="90" stroke="#4e3b26" stroke-width="2" stroke-dasharray="5 3" />
    `,
  },
  {
    id: 'reinforced_armor_kit',
    name: 'Reinforced Armor Kit',
    bgDark: '#0e0a06',
    bgMid: '#20160e',
    bgGlow: '#362416',
    svgArt: `
      <!-- Heavy layered leather armor plate with steel studs and stitch border -->
      <rect x="28" y="28" width="72" height="72" rx="10" fill="#4e342e" stroke="#271813" stroke-width="4" />
      <rect x="34" y="34" width="60" height="60" rx="6" fill="#6d4c41" stroke="#3e2723" stroke-width="2" />
      <!-- Inner reinforcement plate -->
      <polygon points="64,42 82,56 82,78 64,88 46,78 46,56" fill="#3e2723" stroke="#271813" stroke-width="2" />
      <!-- Steel studs at vertices -->
      <circle cx="64" cy="42" r="3.5" fill="#cfd8dc" stroke="#37474f" stroke-width="1.5" />
      <circle cx="82" cy="56" r="3.5" fill="#cfd8dc" stroke="#37474f" stroke-width="1.5" />
      <circle cx="82" cy="78" r="3.5" fill="#cfd8dc" stroke="#37474f" stroke-width="1.5" />
      <circle cx="64" cy="88" r="3.5" fill="#cfd8dc" stroke="#37474f" stroke-width="1.5" />
      <circle cx="46" cy="78" r="3.5" fill="#cfd8dc" stroke="#37474f" stroke-width="1.5" />
      <circle cx="46" cy="56" r="3.5" fill="#cfd8dc" stroke="#37474f" stroke-width="1.5" />
      <!-- Central steel boss -->
      <circle cx="64" cy="66" r="6" fill="#eceff1" stroke="#455a64" stroke-width="2" />
    `,
  },

  // --- Church Order (Dawn / Holy / Gold / Crimson) ---
  {
    id: 'dawn_battle_standard',
    name: 'Dawn Battle Standard',
    bgDark: '#120a06',
    bgMid: '#28140c',
    bgGlow: '#482010',
    svgArt: `
      <!-- Ornate golden battle standard with sunburst banner and sunstone crest -->
      <!-- Spearhead pole -->
      <rect x="62" y="16" width="5" height="98" fill="#e0a840" stroke="#7a5010" stroke-width="1" />
      <!-- Sunburst crest finial -->
      <circle cx="64.5" cy="22" r="8" fill="#ffd54f" stroke="#ff8f00" stroke-width="2" filter="url(#glow)" />
      <circle cx="64.5" cy="22" r="4" fill="#ffffff" />
      <!-- Horizontal crossbar -->
      <rect x="36" y="32" width="57" height="5" rx="1.5" fill="#d4af37" stroke="#7a5813" stroke-width="1" />
      <!-- Banner cloth -->
      <path d="M 40 37 L 89 37 L 85 92 L 64.5 82 L 44 92 Z" fill="#b71c1c" stroke="#5f0909" stroke-width="2" />
      <!-- Gold sun emblem on banner -->
      <circle cx="64.5" cy="56" r="10" fill="#ffd54f" stroke="#ff8f00" stroke-width="1.5" />
      <circle cx="64.5" cy="56" r="5" fill="#fff9c4" />
      <!-- Sun rays -->
      <line x1="64.5" y1="42" x2="64.5" y2="45" stroke="#ffd54f" stroke-width="2" />
      <line x1="64.5" y1="67" x2="64.5" y2="70" stroke="#ffd54f" stroke-width="2" />
      <line x1="50.5" y1="56" x2="53.5" y2="56" stroke="#ffd54f" stroke-width="2" />
      <line x1="75.5" y1="56" x2="78.5" y2="56" stroke="#ffd54f" stroke-width="2" />
    `,
  },
  {
    id: 'formula_enchant_offhand_spirit',
    name: 'Formula: Enchant Off-Hand - Spirit',
    bgDark: '#120e06',
    bgMid: '#281c0e',
    bgGlow: '#463016',
    svgArt: `
      <!-- Consecrated parchment scroll with golden ribbon and radiant spirit glyph -->
      <path d="M 36 26 L 88 26 L 94 98 L 42 98 Z" fill="#d9ceb8" stroke="#54442a" stroke-width="3" />
      <path d="M 40 30 L 84 30 L 90 94 L 46 94 Z" fill="#f5eedc" />
      <!-- Golden ribbon -->
      <path d="M 34 58 L 96 58 L 94 68 L 36 68 Z" fill="#d4af37" stroke="#785c12" stroke-width="1.5" />
      <circle cx="65" cy="63" r="8" fill="#ffd54f" stroke="#e65100" stroke-width="1.5" filter="url(#glow)" />
      <!-- Radiant Spirit flame glyph -->
      <path d="M 65 38 C 69 44, 73 48, 71 54 C 69 57, 61 57, 59 54 C 57 48, 61 44, 65 38 Z"
            fill="#ffd54f" stroke="#ff6f00" stroke-width="1.5" />
      <circle cx="65" cy="50" r="2" fill="#ffffff" />
      <line x1="52" y1="76" x2="80" y2="76" stroke="#604b33" stroke-width="2" stroke-dasharray="4 3" />
      <line x1="50" y1="84" x2="76" y2="84" stroke="#604b33" stroke-width="2" stroke-dasharray="5 3" />
    `,
  },
  {
    id: 'recipe_elixir_of_mana_regeneration',
    name: 'Recipe: Elixir of Mana Regeneration',
    bgDark: '#081014',
    bgMid: '#10202a',
    bgGlow: '#1a3646',
    svgArt: `
      <!-- Alchemist formula sheet with sapphire water drop and herbs -->
      <rect x="30" y="24" width="68" height="80" rx="4" fill="#d2dede" stroke="#334b52" stroke-width="3" />
      <rect x="35" y="29" width="58" height="70" fill="#e8f0f0" />
      <!-- Radiant mana droplet drawing -->
      <path d="M 64 38 C 72 50, 76 58, 74 66 C 71 74, 57 74, 54 66 C 52 58, 56 50, 64 38 Z"
            fill="#00bcd4" stroke="#00838f" stroke-width="2" filter="url(#glow)" />
      <circle cx="61" cy="62" r="3" fill="#e0f7fa" />
      <!-- Herb branch sketch -->
      <path d="M 44 54 Q 50 50 54 56" stroke="#4caf50" stroke-width="2" fill="none" />
      <path d="M 84 54 Q 78 50 74 56" stroke="#4caf50" stroke-width="2" fill="none" />
      <line x1="44" y1="80" x2="84" y2="80" stroke="#334b52" stroke-width="2" stroke-dasharray="6 3" />
      <line x1="44" y1="87" x2="74" y2="87" stroke="#334b52" stroke-width="2" stroke-dasharray="5 3" />
    `,
  },
  {
    id: 'elixir_of_mana_regeneration',
    name: 'Elixir of Mana Regeneration',
    bgDark: '#060d14',
    bgMid: '#0c1b2c',
    bgGlow: '#14304e',
    svgArt: `
      <!-- Slender crystal vial filled with glowing cerulean mana water -->
      <rect x="58" y="22" width="12" height="10" rx="2" fill="#a1887f" stroke="#4e342e" stroke-width="1.5" />
      <!-- Golden neck band -->
      <rect x="56" y="32" width="16" height="6" fill="#e0a840" stroke="#7a5010" stroke-width="1.5" />
      <!-- Tall vial body -->
      <path d="M 58 38 L 70 38 L 74 86 C 74 94, 54 94, 54 86 Z" fill="#102538" stroke="#78909c" stroke-width="2.5" />
      <!-- Glowing mana fluid inside -->
      <path d="M 59 48 L 69 48 L 72 85 C 72 91, 56 91, 56 85 Z" fill="#00b0ff" filter="url(#glow)" />
      <ellipse cx="64" cy="84" rx="6" ry="3" fill="#e1f5fe" />
      <!-- Glass reflection highlight -->
      <line x1="60" y1="46" x2="58" y2="82" stroke="#ffffff" stroke-width="2" stroke-linecap="round" opacity="0.8" />
    `,
  },

  // --- Automatons (Clockwork / Steam / Copper / Bronze) ---
  {
    id: 'clockwork_target_dummy',
    name: 'Clockwork Target Dummy',
    bgDark: '#100c08',
    bgMid: '#241a10',
    bgGlow: '#3e2a18',
    svgArt: `
      <!-- Sturdy mechanical training automaton with target chestplate and spring joints -->
      <!-- Head / Cog sensor -->
      <circle cx="64" cy="28" r="10" fill="#a06030" stroke="#4e2608" stroke-width="2" />
      <rect x="60" y="24" width="8" height="4" fill="#00e5ff" filter="url(#glow)" />
      <!-- Spring neck -->
      <path d="M 60 38 Q 68 40 60 42 Q 68 44 64 46" stroke="#78909c" stroke-width="2.5" fill="none" />
      <!-- Torso / Chestplate -->
      <path d="M 44 48 L 84 48 L 78 86 L 50 86 Z" fill="#8c5026" stroke="#402008" stroke-width="3" />
      <!-- Bullseye on chest -->
      <circle cx="64" cy="66" r="14" fill="#e0e0e0" stroke="#b71c1c" stroke-width="3" />
      <circle cx="64" cy="66" r="8" fill="#b71c1c" stroke="#e0e0e0" stroke-width="2" />
      <circle cx="64" cy="66" r="3" fill="#ffd54f" />
      <!-- Riveted shoulder pauldrons -->
      <circle cx="42" cy="52" r="7" fill="#b87333" stroke="#4a2608" stroke-width="1.5" />
      <circle cx="86" cy="52" r="7" fill="#b87333" stroke="#4a2608" stroke-width="1.5" />
      <!-- Articulated wooden stand pole -->
      <rect x="61" y="86" width="6" height="26" fill="#5d4037" stroke="#271813" stroke-width="1.5" />
    `,
  },
  {
    id: 'schematic_clockwork_shock_bomb',
    name: 'Schematic: Clockwork Shock Bomb',
    bgDark: '#080e18',
    bgMid: '#101c2e',
    bgGlow: '#182e4a',
    svgArt: `
      <!-- Technical engineering blueprint with gear and electric bomb schematic -->
      <rect x="30" y="24" width="68" height="80" rx="4" fill="#1a3456" stroke="#0e1e32" stroke-width="3" />
      <rect x="34" y="28" width="60" height="72" fill="#204068" />
      <!-- Grid lines -->
      <line x1="34" y1="46" x2="94" y2="46" stroke="#2d588c" stroke-width="1" />
      <line x1="34" y1="64" x2="94" y2="64" stroke="#2d588c" stroke-width="1" />
      <line x1="34" y1="82" x2="94" y2="82" stroke="#2d588c" stroke-width="1" />
      <line x1="54" y1="28" x2="54" y2="100" stroke="#2d588c" stroke-width="1" />
      <line x1="74" y1="28" x2="74" y2="100" stroke="#2d588c" stroke-width="1" />
      <!-- White schematic bomb drawing -->
      <circle cx="64" cy="58" r="16" fill="none" stroke="#e0f7fa" stroke-width="2" />
      <!-- Cog teeth around bomb -->
      <circle cx="64" cy="58" r="6" fill="none" stroke="#e0f7fa" stroke-width="2" stroke-dasharray="4 2" />
      <!-- Electric spark icon -->
      <path d="M 64 48 L 60 58 L 68 58 L 62 68" stroke="#ffeb3b" stroke-width="2" fill="none" filter="url(#glow)" />
    `,
  },
  {
    id: 'clockwork_shock_bomb',
    name: 'Clockwork Shock Bomb',
    bgDark: '#0e0e0a',
    bgMid: '#202014',
    bgGlow: '#36361a',
    svgArt: `
      <!-- Spherical bronze bomb with interlocking cogs, winding key, and lightning sparks -->
      <!-- Winding key on top -->
      <circle cx="64" cy="24" r="6" fill="none" stroke="#d4af37" stroke-width="3" />
      <rect x="62" y="28" width="4" height="8" fill="#d4af37" />
      <!-- Bomb Sphere -->
      <circle cx="64" cy="66" r="30" fill="#5c4028" stroke="#2d1d10" stroke-width="3.5" />
      <circle cx="64" cy="66" r="26" fill="#8c5d34" />
      <!-- Interlocking copper gears on face -->
      <circle cx="56" cy="62" r="12" fill="#b87333" stroke="#4e2c08" stroke-width="2" stroke-dasharray="6 3" />
      <circle cx="56" cy="62" r="4" fill="#5c4028" />
      <circle cx="74" cy="70" r="10" fill="#cd7f32" stroke="#4e2c08" stroke-width="2" stroke-dasharray="5 2.5" />
      <circle cx="74" cy="70" r="3" fill="#5c4028" />
      <!-- Electric shock crackle -->
      <path d="M 38 46 L 46 54 L 42 62 L 52 70" stroke="#00e5ff" stroke-width="2.5" fill="none" filter="url(#glow)" />
      <path d="M 88 50 L 80 58 L 86 66 L 76 74" stroke="#ffeb3b" stroke-width="2" fill="none" filter="url(#glow)" />
      <circle cx="48" cy="54" r="2" fill="#ffffff" />
      <circle cx="80" cy="58" r="2" fill="#ffffff" />
    `,
  },
  {
    id: 'plans_dense_sharpening_stone',
    name: 'Plans: Dense Sharpening Stone',
    bgDark: '#0e1012',
    bgMid: '#1a2024',
    bgGlow: '#2a363c',
    svgArt: `
      <!-- Blacksmithing vellum diagram with stone honing angles -->
      <rect x="30" y="24" width="68" height="80" rx="4" fill="#cdd8d8" stroke="#3b4848" stroke-width="3" />
      <rect x="35" y="29" width="58" height="70" fill="#e4eeee" />
      <!-- Whetstone bar schematic -->
      <polygon points="44,48 76,40 86,58 54,66" fill="#546e7a" stroke="#263238" stroke-width="2" />
      <!-- Honing bevel line -->
      <line x1="44" y1="48" x2="54" y2="66" stroke="#90a4ae" stroke-width="2" />
      <!-- Honing angle arc -->
      <path d="M 76 72 Q 82 66 86 58" stroke="#ff5722" stroke-width="2" fill="none" />
      <line x1="44" y1="80" x2="84" y2="80" stroke="#3b4848" stroke-width="2" stroke-dasharray="6 3" />
      <line x1="44" y1="87" x2="74" y2="87" stroke="#3b4848" stroke-width="2" stroke-dasharray="5 3" />
    `,
  },
  {
    id: 'dense_sharpening_stone',
    name: 'Dense Sharpening Stone',
    bgDark: '#0a0d10',
    bgMid: '#141c22',
    bgGlow: '#222e36',
    svgArt: `
      <!-- Heavy dark slate whetstone bar with honed beveled edges and brass band -->
      <!-- Stone Body (Isometric Perspective) -->
      <polygon points="36,44 80,32 94,68 50,80" fill="#37474f" stroke="#1c252a" stroke-width="3" />
      <!-- Top Honed Face -->
      <polygon points="36,44 80,32 76,46 32,58" fill="#546e7a" stroke="#1c252a" stroke-width="1.5" />
      <!-- Front Edge Face -->
      <polygon points="32,58 76,46 94,68 50,80" fill="#263238" />
      <!-- Honing Sheen Highlight -->
      <line x1="34" y1="56" x2="74" y2="44" stroke="#b0bec5" stroke-width="2" stroke-linecap="round" />
      <!-- Brass center binding band -->
      <polygon points="50,40 60,37 66,54 56,57" fill="#c0a040" stroke="#604810" stroke-width="1.5" />
    `,
  },
  {
    id: 'formula_enchant_gloves_forged_might',
    name: 'Formula: Enchant Gloves - Forged Might',
    bgDark: '#120804',
    bgMid: '#261208',
    bgGlow: '#441e0a',
    svgArt: `
      <!-- Scroll with bronze ribbon, anvil seal, and fiery iron gauntlet rune -->
      <path d="M 36 26 L 88 26 L 94 98 L 42 98 Z" fill="#d9cdb8" stroke="#544026" stroke-width="3" />
      <path d="M 40 30 L 84 30 L 90 94 L 46 94 Z" fill="#f4ecdc" />
      <!-- Molten bronze ribbon -->
      <path d="M 34 58 L 96 58 L 94 68 L 36 68 Z" fill="#b85d19" stroke="#602804" stroke-width="1.5" />
      <circle cx="65" cy="63" r="8" fill="#ff6d00" stroke="#bf360c" stroke-width="1.5" filter="url(#glow)" />
      <!-- Fiery Gauntlet / Fist Glyph -->
      <rect x="58" y="40" width="14" height="12" rx="3" fill="#bf360c" />
      <rect x="56" y="44" width="4" height="7" rx="1.5" fill="#e65100" />
      <circle cx="65" cy="46" r="2.5" fill="#ffab00" />
      <line x1="52" y1="76" x2="80" y2="76" stroke="#5e462a" stroke-width="2" stroke-dasharray="4 3" />
      <line x1="50" y1="84" x2="76" y2="84" stroke="#5e462a" stroke-width="2" stroke-dasharray="5 3" />
    `,
  },
];

async function main() {
  console.log(`Generating ${ITEMS_TO_GENERATE.length} faction reward WebP icons...`);

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
  }

  // Ensure generatedBatches has an entry for faction-rewards-icons-2026-09-17
  if (!mappingData.generatedBatches) {
    mappingData.generatedBatches = [];
  }

  const batchId = 'faction-rewards-icons-2026-09-17';
  let batch = mappingData.generatedBatches.find((b) => b.batchId === batchId);
  const rewardIds = ITEMS_TO_GENERATE.map((i) => i.id).sort();

  if (!batch) {
    batch = {
      batchId,
      source:
        'Deterministic SVG compositions rendered to WebP with Sharp (scripts/generate_faction_reward_icons.mjs); no image model',
      owner: 'World of ClaudeCraft',
      license: 'World of ClaudeCraft project-generated art, project asset, rights reserved',
      styleContract: {
        id: 'woc-item-icon-v1',
        document: 'docs/design/item-icon-art-style.md',
      },
      styleReference:
        'woc-item-icon-v1; existing painted item catalog (opaque dark vignette, warm top-left key, cool bottom-right shadow, centered silhouette with safe padding)',
      commonPrompt:
        'Not a text-to-image prompt: each icon is an authored SVG composition (per-item vector art over a three-stop radial ground) rasterized to an opaque 128x128 sRGB WebP. The exact vector source of every item is the ITEMS_TO_GENERATE table in scripts/generate_faction_reward_icons.mjs.',
      provenanceRecord: 'scripts/generate_faction_reward_icons.mjs',
      itemIds: rewardIds,
    };
    mappingData.generatedBatches.push(batch);
  } else {
    batch.itemIds = rewardIds;
  }

  writeFileSync(mappingPath, `${JSON.stringify(mappingData, null, 2)}\n`);
  console.log('mapping.json updated successfully with faction-rewards batch!');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
