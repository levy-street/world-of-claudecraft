// scripts/generate_hoard_loot_icons.mjs
// Generates the 128x128 WebP item icons for the Buried Hoard boss loot
// (src/sim/content/hoard_loot.ts): 32 pieces, three tiers each.
//
// Deterministic authored SVG, no image model. An icon is composed from three
// independent choices, so the 96 icons stay one family and every one is distinct:
//   - the SILHOUETTE, by the piece's slot and make (ring, cowl, cuirass, ...);
//   - the PALETTE and EMBLEM, by the boss that drops it (void, frost, ember, ...);
//   - the FINISH, by the tier: a tarnished piece is dulled and verdigris-flecked
//     with pitted grey-green fittings, the epic piece has bright steel fittings,
//     and the sovereign piece has gold fittings, a gold halo and glints.
// Meets the woc-item-icon-v1 contract the other generated batches follow: opaque
// dark vignette, warm top-left key, cool bottom-right shadow, centred silhouette
// with safe padding.
//
// Run: node scripts/generate_hoard_loot_icons.mjs

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const repoRoot = process.cwd();
const itemsDir = path.join(repoRoot, 'public/ui/items');
const mappingPath = path.join(itemsDir, 'mapping.json');
const OUT_PX = 128;
const BATCH_ID = 'hoard-boss-loot-icons-2026-09-20';

// dk/md/lt: the piece's own material, dark to light. glow: the boss's element.
const BOSSES = {
  arcane: {
    bg: ['#07040f', '#140b26', '#2a1750'],
    dk: '#1d1238',
    md: '#3b2670',
    lt: '#6a4bb8',
    glow: '#c9a2ff',
  },
  frost: {
    bg: ['#040a10', '#0b1a28', '#173650'],
    dk: '#1c3346',
    md: '#3a6886',
    lt: '#7fb4d4',
    glow: '#d6f4ff',
  },
  ember: {
    bg: ['#100503', '#260d06', '#4a1a0a'],
    dk: '#3a1408',
    md: '#7a2c10',
    lt: '#c25a22',
    glow: '#ffb347',
  },
  storm: {
    bg: ['#05070f', '#0e1430', '#1c2a5c'],
    dk: '#1a2450',
    md: '#31468e',
    lt: '#6584d8',
    glow: '#bfe0ff',
  },
  brute: {
    bg: ['#0b0907', '#1e1812', '#3a2e20'],
    dk: '#2e261c',
    md: '#5c4c38',
    lt: '#94805e',
    glow: '#e0c48a',
  },
  venom: {
    bg: ['#040b05', '#0c2010', '#183c1c'],
    dk: '#15301a',
    md: '#2c5e30',
    lt: '#5a9c4c',
    glow: '#b6ff6a',
  },
  necro: {
    bg: ['#08080a', '#17171c', '#2c2c36'],
    dk: '#3a3830',
    md: '#8a8470',
    lt: '#cfc8ae',
    glow: '#9dffd0',
  },
  tide: {
    bg: ['#03090c', '#082028', '#0f3e4a'],
    dk: '#0e3038',
    md: '#1c6470',
    lt: '#48a8b0',
    glow: '#a4fff0',
  },
};

const TIERS = {
  rare: { prefix: 'rare_', trim: '#73806c', trimDk: '#39422f', trimLt: '#a3ad92' },
  epic: { prefix: '', trim: '#b4bccb', trimDk: '#565d6c', trimLt: '#eef2fa' },
  legendary: { prefix: 'legendary_', trim: '#f0bd46', trimDk: '#8a5a10', trimLt: '#fff0b0' },
};

// ---- emblems: the boss's mark, drawn small on the piece (about 18px, centred on 0,0)
const EMBLEMS = {
  arcane: (c) =>
    `<circle r="7" fill="#05020a" stroke="${c.glow}" stroke-width="2"/><path d="M -10 2 Q 0 -12 10 -2" fill="none" stroke="${c.glow}" stroke-width="1.5" opacity="0.8"/>`,
  frost: (c) =>
    `<g stroke="${c.glow}" stroke-width="2" stroke-linecap="round"><line x1="0" y1="-9" x2="0" y2="9"/><line x1="-8" y1="-4.5" x2="8" y2="4.5"/><line x1="-8" y1="4.5" x2="8" y2="-4.5"/></g>`,
  ember: (c) =>
    `<path d="M 0 -10 C 6 -3 8 2 5 7 C 3 10 -3 10 -5 7 C -8 2 -3 -1 0 -10 Z" fill="${c.glow}"/><path d="M 0 -2 C 3 2 3 5 0 7 C -3 5 -3 2 0 -2 Z" fill="#fff3c4"/>`,
  storm: (c) =>
    `<path d="M 3 -10 L -6 1 L 0 1 L -3 10 L 7 -2 L 1 -2 Z" fill="${c.glow}" stroke="#ffffff" stroke-width="0.8"/>`,
  brute: (c) =>
    `<g fill="none" stroke="${c.glow}" stroke-width="2.4" stroke-linejoin="miter"><path d="M -8 -2 L 0 -9 L 8 -2"/><path d="M -8 6 L 0 -1 L 8 6"/></g>`,
  venom: (c) =>
    `<path d="M -5 -9 Q -2 2 -4 9 Q -8 0 -5 -9 Z" fill="${c.glow}"/><path d="M 5 -9 Q 2 2 4 9 Q 8 0 5 -9 Z" fill="${c.glow}"/>`,
  necro: (c) =>
    `<g stroke="${c.glow}" stroke-width="3" stroke-linecap="round"><line x1="-7" y1="-7" x2="7" y2="7"/><line x1="-7" y1="7" x2="7" y2="-7"/></g><circle r="2.5" fill="#101014"/>`,
  tide: (c) =>
    `<g fill="none" stroke="${c.glow}" stroke-width="2.2" stroke-linecap="round"><path d="M -9 -3 Q -4.5 -9 0 -3 Q 4.5 3 9 -3"/><path d="M -9 5 Q -4.5 -1 0 5 Q 4.5 11 9 5"/></g>`,
};

const emblem = (c, x, y, scale = 1) =>
  `<g transform="translate(${x} ${y}) scale(${scale})" filter="url(#glow)">${EMBLEMS[c.boss](c)}</g>`;

// ---- silhouettes. `c` carries the boss palette plus the tier's trim colours.
const SILHOUETTES = {
  ring: (c) => `
    <ellipse cx="64" cy="78" rx="30" ry="27" fill="none" stroke="${c.trimDk}" stroke-width="14"/>
    <ellipse cx="64" cy="78" rx="30" ry="27" fill="none" stroke="${c.trim}" stroke-width="9"/>
    <path d="M 38 66 A 30 27 0 0 1 72 52" fill="none" stroke="${c.trimLt}" stroke-width="3" stroke-linecap="round"/>
    <polygon points="64,24 82,42 64,60 46,42" fill="${c.md}" stroke="${c.trimDk}" stroke-width="3"/>
    <polygon points="64,30 76,42 64,54 52,42" fill="${c.lt}"/>
    <polygon points="64,30 70,42 64,54 58,42" fill="${c.glow}" opacity="0.85" filter="url(#glow)"/>
    ${emblem(c, 64, 100, 0.7)}`,
  neck: (c) => `
    <path d="M 26 24 Q 64 96 102 24" fill="none" stroke="${c.trimDk}" stroke-width="7" stroke-linecap="round"/>
    <path d="M 26 24 Q 64 96 102 24" fill="none" stroke="${c.trim}" stroke-width="3.5" stroke-dasharray="5 4" stroke-linecap="round"/>
    <path d="M 64 58 C 84 72 84 98 64 108 C 44 98 44 72 64 58 Z" fill="${c.dk}" stroke="${c.trim}" stroke-width="4"/>
    <path d="M 64 66 C 77 76 77 94 64 101 C 51 94 51 76 64 66 Z" fill="${c.md}"/>
    <path d="M 56 74 Q 60 68 66 70" fill="none" stroke="${c.lt}" stroke-width="2.5" stroke-linecap="round"/>
    ${emblem(c, 64, 86, 0.95)}`,
  orb: (c) => `
    <path d="M 40 104 L 50 84 L 78 84 L 88 104 Z" fill="${c.trimDk}" stroke="${c.trim}" stroke-width="3"/>
    <path d="M 34 82 Q 30 58 46 44" fill="none" stroke="${c.trim}" stroke-width="5" stroke-linecap="round"/>
    <path d="M 94 82 Q 98 58 82 44" fill="none" stroke="${c.trim}" stroke-width="5" stroke-linecap="round"/>
    <circle cx="64" cy="58" r="30" fill="url(#orbGrad)" stroke="${c.dk}" stroke-width="3"/>
    <path d="M 46 48 Q 52 36 64 34" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round" opacity="0.75"/>
    <path d="M 46 66 Q 64 46 82 62 Q 66 58 58 74" fill="none" stroke="${c.glow}" stroke-width="2" opacity="0.7"/>
    ${emblem(c, 64, 58, 1.05)}`,
  chalice: (c) => `
    <ellipse cx="64" cy="106" rx="24" ry="7" fill="${c.trimDk}" stroke="${c.trim}" stroke-width="3"/>
    <rect x="59" y="72" width="10" height="32" fill="${c.trim}" stroke="${c.trimDk}" stroke-width="2"/>
    <ellipse cx="64" cy="84" rx="9" ry="5" fill="${c.trimLt}" stroke="${c.trimDk}" stroke-width="2"/>
    <path d="M 30 28 Q 32 74 64 76 Q 96 74 98 28 Z" fill="${c.md}" stroke="${c.trimDk}" stroke-width="3"/>
    <path d="M 36 32 Q 38 64 58 70" fill="none" stroke="${c.lt}" stroke-width="3" stroke-linecap="round"/>
    <ellipse cx="64" cy="28" rx="34" ry="9" fill="${c.glow}" stroke="${c.trim}" stroke-width="4" filter="url(#glow)"/>
    <ellipse cx="58" cy="27" rx="12" ry="3" fill="#ffffff" opacity="0.7"/>
    ${emblem(c, 64, 52, 0.95)}`,
  shield: (c) => `
    <path d="M 64 16 L 104 28 Q 104 84 64 114 Q 24 84 24 28 Z" fill="${c.trimDk}" stroke="${c.trimDk}" stroke-width="3"/>
    <path d="M 64 16 L 104 28 Q 104 84 64 114 Q 24 84 24 28 Z" fill="none" stroke="${c.trim}" stroke-width="6"/>
    <path d="M 64 26 L 95 35 Q 94 78 64 102 Q 34 78 33 35 Z" fill="${c.md}"/>
    <path d="M 64 26 L 33 35 Q 34 78 64 102 Z" fill="${c.lt}" opacity="0.45"/>
    <line x1="64" y1="26" x2="64" y2="102" stroke="${c.dk}" stroke-width="3"/>
    <circle cx="64" cy="60" r="15" fill="${c.dk}" stroke="${c.trim}" stroke-width="4"/>
    ${emblem(c, 64, 60, 1)}`,
  cowl: (c) => `
    <path d="M 64 14 C 100 18 108 60 100 112 L 28 112 C 20 60 28 18 64 14 Z" fill="${c.md}" stroke="${c.dk}" stroke-width="4"/>
    <path d="M 64 14 C 40 20 30 56 34 108" fill="none" stroke="${c.lt}" stroke-width="4" stroke-linecap="round" opacity="0.8"/>
    <path d="M 64 38 C 84 42 86 76 78 104 L 50 104 C 42 76 44 42 64 38 Z" fill="#05040a"/>
    <path d="M 64 32 C 90 36 92 78 82 110" fill="none" stroke="${c.trim}" stroke-width="4" stroke-linecap="round"/>
    <path d="M 64 32 C 38 36 36 78 46 110" fill="none" stroke="${c.trim}" stroke-width="4" stroke-linecap="round"/>
    <ellipse cx="56" cy="66" rx="4" ry="2.5" fill="${c.glow}" filter="url(#glow)"/>
    <ellipse cx="72" cy="66" rx="4" ry="2.5" fill="${c.glow}" filter="url(#glow)"/>
    ${emblem(c, 64, 24, 0.7)}`,
  crown: (c) => `
    <path d="M 22 96 L 18 40 L 40 64 L 52 26 L 64 60 L 76 26 L 88 64 L 110 40 L 106 96 Z" fill="${c.md}" stroke="${c.dk}" stroke-width="4" stroke-linejoin="round"/>
    <path d="M 22 96 L 18 40 L 40 64 L 52 26 L 58 44" fill="none" stroke="${c.lt}" stroke-width="3" stroke-linejoin="round" opacity="0.8"/>
    <rect x="20" y="84" width="88" height="18" rx="4" fill="${c.trim}" stroke="${c.trimDk}" stroke-width="3"/>
    <rect x="24" y="87" width="80" height="4" rx="2" fill="${c.trimLt}" opacity="0.8"/>
    <circle cx="52" cy="28" r="5" fill="${c.glow}" filter="url(#glow)"/>
    <circle cx="76" cy="28" r="5" fill="${c.glow}" filter="url(#glow)"/>
    <circle cx="18" cy="42" r="4" fill="${c.glow}" filter="url(#glow)"/>
    <circle cx="110" cy="42" r="4" fill="${c.glow}" filter="url(#glow)"/>
    ${emblem(c, 64, 74, 0.9)}`,
  shoulder: (c) => `
    <path d="M 16 92 C 14 46 44 22 84 26 C 106 30 114 50 112 70 C 90 58 60 66 44 100 Z" fill="${c.md}" stroke="${c.dk}" stroke-width="4"/>
    <path d="M 22 84 C 24 52 46 32 80 32" fill="none" stroke="${c.lt}" stroke-width="4" stroke-linecap="round" opacity="0.8"/>
    <path d="M 30 100 C 44 70 74 58 110 72" fill="none" stroke="${c.trim}" stroke-width="6" stroke-linecap="round"/>
    <path d="M 40 108 C 52 84 78 74 108 86 L 104 100 C 82 92 64 98 54 114 Z" fill="${c.dk}" stroke="${c.trim}" stroke-width="3"/>
    <circle cx="40" cy="92" r="4" fill="${c.trimLt}" stroke="${c.trimDk}" stroke-width="1.5"/>
    <circle cx="98" cy="72" r="4" fill="${c.trimLt}" stroke="${c.trimDk}" stroke-width="1.5"/>
    ${emblem(c, 66, 52, 1.05)}`,
  robe: (c) => `
    <path d="M 44 16 L 84 16 L 112 40 L 100 58 L 90 50 L 98 114 L 30 114 L 38 50 L 28 58 L 16 40 Z" fill="${c.md}" stroke="${c.dk}" stroke-width="4" stroke-linejoin="round"/>
    <path d="M 44 16 L 16 40 L 28 58 L 38 50 L 32 108" fill="none" stroke="${c.lt}" stroke-width="3" stroke-linejoin="round" opacity="0.7"/>
    <path d="M 52 16 L 64 40 L 76 16" fill="${c.dk}" stroke="${c.trim}" stroke-width="3"/>
    <line x1="64" y1="40" x2="64" y2="114" stroke="${c.trim}" stroke-width="5"/>
    <path d="M 34 84 L 94 84 L 95 94 L 33 94 Z" fill="${c.trimDk}" stroke="${c.trim}" stroke-width="2.5"/>
    <path d="M 30 108 L 98 108" stroke="${c.trim}" stroke-width="4"/>
    ${emblem(c, 64, 62, 1)}`,
  cuirass: (c) => `
    <path d="M 38 14 L 54 22 Q 64 28 74 22 L 90 14 L 110 34 L 96 52 L 98 96 Q 64 118 30 96 L 32 52 L 18 34 Z" fill="${c.md}" stroke="${c.dk}" stroke-width="4" stroke-linejoin="round"/>
    <path d="M 38 14 L 18 34 L 32 52 L 31 92" fill="none" stroke="${c.lt}" stroke-width="3.5" stroke-linejoin="round" opacity="0.8"/>
    <path d="M 40 40 Q 64 58 88 40" fill="none" stroke="${c.trim}" stroke-width="5" stroke-linecap="round"/>
    <path d="M 34 74 Q 64 90 94 74" fill="none" stroke="${c.trim}" stroke-width="4" stroke-linecap="round"/>
    <path d="M 33 88 Q 64 104 95 88" fill="none" stroke="${c.trim}" stroke-width="4" stroke-linecap="round"/>
    <line x1="64" y1="28" x2="64" y2="108" stroke="${c.dk}" stroke-width="3"/>
    <circle cx="24" cy="36" r="4" fill="${c.trimLt}" stroke="${c.trimDk}" stroke-width="1.5"/>
    <circle cx="104" cy="36" r="4" fill="${c.trimLt}" stroke="${c.trimDk}" stroke-width="1.5"/>
    ${emblem(c, 64, 60, 1.1)}`,
  belt: (c) => `
    <path d="M 10 50 Q 64 78 118 50 L 118 76 Q 64 104 10 76 Z" fill="${c.md}" stroke="${c.dk}" stroke-width="4" stroke-linejoin="round"/>
    <path d="M 12 56 Q 64 84 116 56" fill="none" stroke="${c.lt}" stroke-width="3" opacity="0.8"/>
    <path d="M 12 72 Q 64 100 116 72" fill="none" stroke="${c.dk}" stroke-width="2" stroke-dasharray="3 5"/>
    <circle cx="26" cy="68" r="3.5" fill="${c.trimLt}" stroke="${c.trimDk}" stroke-width="1.5"/>
    <circle cx="102" cy="68" r="3.5" fill="${c.trimLt}" stroke="${c.trimDk}" stroke-width="1.5"/>
    <rect x="42" y="54" width="44" height="46" rx="8" fill="${c.trim}" stroke="${c.trimDk}" stroke-width="4"/>
    <rect x="49" y="61" width="30" height="32" rx="5" fill="${c.dk}"/>
    <path d="M 46 60 L 60 58" stroke="${c.trimLt}" stroke-width="3" stroke-linecap="round"/>
    ${emblem(c, 64, 77, 1)}`,
  legs: (c) => `
    <path d="M 28 14 L 100 14 L 104 40 L 96 114 L 70 114 L 64 52 L 58 114 L 32 114 L 24 40 Z" fill="${c.md}" stroke="${c.dk}" stroke-width="4" stroke-linejoin="round"/>
    <path d="M 30 18 L 27 40 L 35 110" fill="none" stroke="${c.lt}" stroke-width="3.5" opacity="0.8"/>
    <rect x="26" y="12" width="76" height="14" rx="3" fill="${c.trim}" stroke="${c.trimDk}" stroke-width="3"/>
    <path d="M 31 70 Q 45 60 59 70 L 58 88 Q 45 80 32 88 Z" fill="${c.dk}" stroke="${c.trim}" stroke-width="3"/>
    <path d="M 69 70 Q 83 60 97 70 L 96 88 Q 83 80 70 88 Z" fill="${c.dk}" stroke="${c.trim}" stroke-width="3"/>
    <line x1="33" y1="104" x2="58" y2="104" stroke="${c.trim}" stroke-width="4"/>
    <line x1="70" y1="104" x2="95" y2="104" stroke="${c.trim}" stroke-width="4"/>
    ${emblem(c, 64, 38, 0.85)}`,
  gloves: (c) => `
    <path d="M 40 114 L 36 70 L 30 40 Q 30 32 37 32 Q 43 32 44 40 L 46 54 L 47 22 Q 47 14 54 14 Q 61 14 61 22 L 62 50 L 64 18 Q 65 11 72 12 Q 78 13 78 20 L 77 52 L 81 28 Q 83 21 89 23 Q 95 25 93 32 L 88 70 L 96 60 Q 102 55 106 61 Q 109 66 104 71 L 86 94 L 84 114 Z" fill="${c.md}" stroke="${c.dk}" stroke-width="4" stroke-linejoin="round"/>
    <path d="M 40 106 L 38 70 L 33 42" fill="none" stroke="${c.lt}" stroke-width="3" stroke-linecap="round" opacity="0.8"/>
    <path d="M 38 96 L 86 96 L 85 114 L 39 114 Z" fill="${c.trim}" stroke="${c.trimDk}" stroke-width="3"/>
    <path d="M 42 101 L 82 101" stroke="${c.trimLt}" stroke-width="2.5" opacity="0.8"/>
    <path d="M 40 62 Q 62 72 88 62" fill="none" stroke="${c.trim}" stroke-width="4" stroke-linecap="round"/>
    ${emblem(c, 63, 80, 0.85)}`,
  feet: (c) => `
    <path d="M 40 12 L 78 12 L 80 66 Q 112 74 114 98 L 114 110 L 34 110 L 36 66 Z" fill="${c.md}" stroke="${c.dk}" stroke-width="4" stroke-linejoin="round"/>
    <path d="M 43 16 L 40 66 L 38 104" fill="none" stroke="${c.lt}" stroke-width="3.5" stroke-linecap="round" opacity="0.8"/>
    <rect x="32" y="104" width="84" height="10" rx="3" fill="${c.dk}" stroke="${c.trimDk}" stroke-width="2"/>
    <rect x="38" y="10" width="42" height="13" rx="3" fill="${c.trim}" stroke="${c.trimDk}" stroke-width="3"/>
    <path d="M 38 62 L 80 62" stroke="${c.trim}" stroke-width="5"/>
    <path d="M 84 74 Q 106 80 110 100" fill="none" stroke="${c.trim}" stroke-width="4" stroke-linecap="round"/>
    <circle cx="59" cy="62" r="5" fill="${c.trimLt}" stroke="${c.trimDk}" stroke-width="2"/>
    ${emblem(c, 58, 40, 0.95)}`,
};

// Every piece: its plain (epic tier) id, the boss that drops it, its silhouette,
// and the intended visual subject (documentation for whoever repaints one).
// A boss never repeats a silhouette, so palette plus silhouette is already unique.
const PIECES = [
  ['collapsar_band_of_nyxaris', 'arcane', 'ring', 'a void-dark signet ring with a violet gem'],
  ['orb_collapsing_void', 'arcane', 'orb', 'a clawed caster orb with a collapsing void core'],
  ['cowl_of_event_horizon', 'arcane', 'cowl', 'a deep violet cloth cowl with lit eyes'],
  ['mantle_of_singularity', 'arcane', 'shoulder', 'a violet cloth mantle'],
  ['glacier_hewn_bulwark', 'frost', 'shield', 'a kite shield hewn of blue glacier ice'],
  ['permafrost_legguards', 'frost', 'legs', 'frost-blue mail legguards'],
  ['frostbitten_rime_slippers', 'frost', 'feet', 'pale rime-crusted cloth slippers'],
  ['rime_crusted_grips', 'frost', 'gloves', 'rime-crusted leather grips'],
  ['ember_wrought_crown', 'ember', 'crown', 'a forge-dark crown set with ember gems'],
  ['cinder_stitched_robes', 'ember', 'robe', 'cinder-red stitched robes'],
  ['chained_ember_choker', 'ember', 'neck', 'a chain choker holding a live ember'],
  ['molten_clinker_girdle', 'ember', 'belt', 'a clinker-dark girdle with a molten buckle'],
  ['storm_tuned_buckler', 'storm', 'shield', 'a storm-blue buckler with a lightning boss'],
  ['hauberk_tempest_gale', 'storm', 'cuirass', 'a storm-blue mail hauberk'],
  ['gale_strider_boots', 'storm', 'feet', 'storm-blue leather boots'],
  ['tempest_strike_grips', 'storm', 'gloves', 'storm-blue mail grips'],
  ['breastplate_tectonic_might', 'brute', 'cuirass', 'a stone-brown heavy breastplate'],
  ['band_mountains_weight', 'brute', 'ring', 'a heavy stone-set band'],
  ['monolithic_shoulderguards', 'brute', 'shoulder', 'slab-like stone-brown shoulderguards'],
  ['earthshaker_warboots', 'brute', 'feet', 'heavy stone-brown warboots'],
  ['silkstalker_woven_vest', 'venom', 'cuirass', 'a green silk-woven leather vest'],
  ['spun_venom_spaulders', 'venom', 'shoulder', 'green spun-silk spaulders'],
  ['broodmother_chitin_cowl', 'venom', 'cowl', 'a green chitin cowl with lit eyes'],
  ['venom_etched_waistcord', 'venom', 'belt', 'a venom-green etched waistcord'],
  ['bone_studded_pauldrons', 'necro', 'shoulder', 'bone-pale studded pauldrons'],
  ['legguards_of_the_ossuary', 'necro', 'legs', 'bone-pale leather legguards'],
  ['seal_of_the_cryptwalker', 'necro', 'ring', 'a bone seal ring'],
  ['ossuary_bone_crown', 'necro', 'crown', 'a crown of pale bone'],
  ['chalice_of_living_tides', 'tide', 'chalice', 'a sea-teal chalice brimming with light'],
  ['pendant_continuous_flow', 'tide', 'neck', 'a teal droplet pendant on a chain'],
  ['coral_encrusted_girdle', 'tide', 'belt', 'a teal coral-crusted girdle'],
  ['riptide_handwraps', 'tide', 'gloves', 'sea-teal leather handwraps'],
];

// Deterministic speckle positions (a fixed LCG per icon), so a rebuild is byte-stable.
function flecks(seed, count, colour) {
  let s = seed >>> 0;
  const next = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
  let out = '';
  for (let i = 0; i < count; i++) {
    const x = (22 + next() * 84).toFixed(1);
    const y = (20 + next() * 88).toFixed(1);
    const r = (0.9 + next() * 1.8).toFixed(1);
    out += `<circle cx="${x}" cy="${y}" r="${r}" fill="${colour}" opacity="${(0.35 + next() * 0.4).toFixed(2)}"/>`;
  }
  return out;
}

const glint = (x, y, size) =>
  `<path d="M ${x} ${y - size} L ${x + size * 0.22} ${y - size * 0.22} L ${x + size} ${y} L ${x + size * 0.22} ${y + size * 0.22} L ${x} ${y + size} L ${x - size * 0.22} ${y + size * 0.22} L ${x - size} ${y} L ${x - size * 0.22} ${y - size * 0.22} Z" fill="#fff6c8" filter="url(#glow)"/>`;

function iconSvg(index, bossKey, silhouette, tierKey) {
  const boss = BOSSES[bossKey];
  const tier = TIERS[tierKey];
  const c = { ...boss, ...tier, boss: bossKey };
  const art = SILHOUETTES[silhouette](c);
  const subject =
    tierKey === 'rare'
      ? `<g filter="url(#tarnish)">${art}</g><g clip-path="url(#safe)">${flecks(977 + index * 31, 46, '#5f8f78')}${flecks(4111 + index * 17, 18, '#1a1f18')}</g>`
      : tierKey === 'legendary'
        ? `<g filter="url(#halo)">${art}</g>${glint(100, 26, 9)}${glint(24, 96, 6)}${glint(30, 30, 5)}`
        : art;
  const ground =
    tierKey === 'legendary' ? `<circle cx="64" cy="64" r="58" fill="url(#gildGrad)"/>` : '';
  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${OUT_PX}" height="${OUT_PX}" viewBox="0 0 128 128">
      <defs>
        <radialGradient id="bgGrad" cx="38%" cy="32%" r="72%">
          <stop offset="0%" stop-color="${boss.bg[2]}"/>
          <stop offset="50%" stop-color="${boss.bg[1]}"/>
          <stop offset="100%" stop-color="${boss.bg[0]}"/>
        </radialGradient>
        <radialGradient id="gildGrad" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stop-color="#f0bd46" stop-opacity="0.34"/>
          <stop offset="70%" stop-color="#f0bd46" stop-opacity="0.08"/>
          <stop offset="100%" stop-color="#f0bd46" stop-opacity="0"/>
        </radialGradient>
        <radialGradient id="orbGrad" cx="40%" cy="36%" r="70%">
          <stop offset="0%" stop-color="${boss.glow}"/>
          <stop offset="45%" stop-color="${boss.md}"/>
          <stop offset="100%" stop-color="${boss.bg[0]}"/>
        </radialGradient>
        <linearGradient id="shade" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#fff2d8" stop-opacity="0.16"/>
          <stop offset="55%" stop-color="#000000" stop-opacity="0"/>
          <stop offset="100%" stop-color="#0a1830" stop-opacity="0.42"/>
        </linearGradient>
        <filter id="glow" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="2.2" result="blur"/>
          <feComposite in="SourceGraphic" in2="blur" operator="over"/>
        </filter>
        <filter id="halo" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur in="SourceAlpha" stdDeviation="5" result="blur"/>
          <feFlood flood-color="#ffc94a" flood-opacity="0.85"/>
          <feComposite in2="blur" operator="in" result="gold"/>
          <feMerge><feMergeNode in="gold"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
        <filter id="tarnish">
          <feColorMatrix type="saturate" values="0.42"/>
          <feComponentTransfer>
            <feFuncR type="linear" slope="0.78"/>
            <feFuncG type="linear" slope="0.84"/>
            <feFuncB type="linear" slope="0.78"/>
          </feComponentTransfer>
        </filter>
        <clipPath id="safe"><rect x="14" y="10" width="100" height="108" rx="10"/></clipPath>
      </defs>
      <rect width="128" height="128" fill="url(#bgGrad)"/>
      ${ground}
      ${subject}
      <rect width="128" height="128" fill="url(#shade)"/>
    </svg>`;
}

async function main() {
  const ids = [];
  let index = 0;
  for (const [baseId, bossKey, silhouette] of PIECES) {
    for (const tierKey of Object.keys(TIERS)) {
      const id = `${TIERS[tierKey].prefix}${baseId}`;
      await sharp(Buffer.from(iconSvg(index, bossKey, silhouette, tierKey)))
        .resize(OUT_PX, OUT_PX)
        .webp({ quality: 88, effort: 6 })
        .toFile(path.join(itemsDir, `${id}.webp`));
      ids.push(id);
    }
    index++;
  }
  console.log(`Generated ${ids.length} hoard loot icons.`);

  const mappingData = JSON.parse(readFileSync(mappingPath, 'utf8'));
  mappingData.generatedBatches ??= [];
  const batch = {
    batchId: BATCH_ID,
    source:
      'Deterministic SVG compositions rendered to WebP with Sharp (scripts/generate_hoard_loot_icons.mjs); no image model',
    owner: 'World of ClaudeCraft',
    license: 'World of ClaudeCraft project-generated art, project asset, rights reserved',
    styleContract: {
      id: 'woc-item-icon-v1',
      document: 'docs/design/item-icon-art-style.md',
    },
    styleReference:
      'woc-item-icon-v1; existing painted item catalog (opaque dark vignette, warm top-left key, cool bottom-right shadow, centered silhouette with safe padding)',
    commonPrompt:
      'Not a text-to-image prompt: each icon is an authored SVG composition (a slot silhouette, the dropping boss palette and emblem, and a tier finish) rasterized to an opaque 128x128 sRGB WebP. The exact vector source of every icon is scripts/generate_hoard_loot_icons.mjs.',
    provenanceRecord: 'scripts/generate_hoard_loot_icons.mjs',
    itemIds: [...ids].sort(),
  };
  const at = mappingData.generatedBatches.findIndex((b) => b.batchId === BATCH_ID);
  if (at >= 0) mappingData.generatedBatches[at] = batch;
  else mappingData.generatedBatches.push(batch);
  writeFileSync(mappingPath, `${JSON.stringify(mappingData, null, 2)}\n`);
  console.log('mapping.json updated with the hoard loot batch.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
