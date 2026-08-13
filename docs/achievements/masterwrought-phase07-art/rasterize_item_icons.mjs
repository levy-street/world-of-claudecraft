// Phase 07 intermediates: hand-authored original SVG compositions, rasterized to
// 512x512 fully-opaque sRGB PNG masters for the item icon converter
// (npm run assets:items). One distinct composition per item id, woc-item-icon-v1
// register: single centered subject at roughly 70 percent fill, opaque dark painted
// vignette, warm top-left key light, cool lower-right shadow, grounded contact
// shadow, no text or frames.
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolve sharp against the repo root's package.json relative to this file
// (docs/achievements/<dir>/ is three levels down), so the script runs from any
// clone or worktree, not just the machine it was authored on.
const require = createRequire(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..', 'package.json'),
);
const sharp = require('sharp');

const OUT_DIR = process.argv[2];
if (!OUT_DIR) {
  console.error('usage: node phase07_item_icons.mjs <out-dir>');
  process.exit(1);
}
mkdirSync(OUT_DIR, { recursive: true });

// Shared scaffolding: background vignette + contact shadow. Each icon supplies its
// own zone tint so no two backgrounds are identical either.
function stage(tintTop, tintBottom, subject, extraDefs = '') {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
<defs>
<radialGradient id="bg" cx="0.36" cy="0.3" r="1.05">
<stop offset="0" stop-color="${tintTop}"/>
<stop offset="0.55" stop-color="${tintBottom}"/>
<stop offset="1" stop-color="#101014"/>
</radialGradient>
<radialGradient id="vig" cx="0.5" cy="0.5" r="0.72">
<stop offset="0.62" stop-color="#000000" stop-opacity="0"/>
<stop offset="1" stop-color="#000000" stop-opacity="0.5"/>
</radialGradient>
<filter id="soft" x="-40%" y="-40%" width="180%" height="180%">
<feGaussianBlur stdDeviation="10"/>
</filter>
<filter id="soft4" x="-40%" y="-40%" width="180%" height="180%">
<feGaussianBlur stdDeviation="4"/>
</filter>
${extraDefs}
</defs>
<rect width="512" height="512" fill="url(#bg)"/>
<ellipse cx="262" cy="408" rx="150" ry="34" fill="#000000" opacity="0.55" filter="url(#soft)"/>
${subject}
<rect width="512" height="512" fill="url(#vig)"/>
</svg>`;
}

const icons = {
  // A dark forged metal bar with ember glints: blued steel billet on a low diagonal,
  // hot seams still cooling along the hammered face.
  duskforged_billet: stage(
    '#3d3833',
    '#1c1a1d',
    `<g transform="rotate(-18 256 268)">
  <rect x="96" y="238" width="320" height="74" rx="10" fill="url(#steelSide)"/>
  <rect x="96" y="222" width="320" height="40" rx="10" fill="url(#steelTop)"/>
  <rect x="102" y="228" width="150" height="10" rx="5" fill="#9aa2ad" opacity="0.55"/>
  <path d="M132 262 L188 268 L236 262 L292 270 L344 264 L392 270" stroke="url(#ember)" stroke-width="5" fill="none" stroke-linecap="round" opacity="0.9"/>
  <path d="M150 288 L204 294 L258 288 L318 296 L372 290" stroke="url(#ember)" stroke-width="3.4" fill="none" stroke-linecap="round" opacity="0.7"/>
  <circle cx="188" cy="268" r="7" fill="#ffb347" filter="url(#soft4)"/>
  <circle cx="292" cy="270" r="8.4" fill="#ff8b2e" filter="url(#soft4)"/>
  <circle cx="372" cy="290" r="6" fill="#ffcf6a" filter="url(#soft4)"/>
  <circle cx="150" cy="288" r="4.6" fill="#ff9c45" filter="url(#soft4)"/>
  <rect x="96" y="222" width="320" height="90" rx="10" fill="none" stroke="#0c0c0f" stroke-width="3" opacity="0.6"/>
</g>`,
    `<linearGradient id="steelTop" x1="0" y1="0" x2="1" y2="1">
<stop offset="0" stop-color="#8d94a1"/>
<stop offset="0.45" stop-color="#565b66"/>
<stop offset="1" stop-color="#33363e"/>
</linearGradient>
<linearGradient id="steelSide" x1="0" y1="0" x2="0.9" y2="1">
<stop offset="0" stop-color="#4b4f59"/>
<stop offset="0.6" stop-color="#2a2c33"/>
<stop offset="1" stop-color="#191a1f"/>
</linearGradient>
<linearGradient id="ember" x1="0" y1="0" x2="1" y2="0">
<stop offset="0" stop-color="#ff7a2a"/>
<stop offset="0.5" stop-color="#ffc258"/>
<stop offset="1" stop-color="#e0561f"/>
</linearGradient>`,
  ),

  // Overlapping folded armor plates: three lapped steel plates fanned like scales,
  // riveted, each fold catching the key light on its rolled edge.
  forgefold_plating: stage(
    '#333744',
    '#191b22',
    `<g>
  <g transform="rotate(8 300 300)">
    <path d="M208 176 h176 a22 22 0 0 1 22 22 v118 a92 92 0 0 1 -110 62 l-88 -30 z" fill="url(#plateC)" stroke="#101116" stroke-width="4"/>
  </g>
  <g transform="rotate(4 240 280)">
    <path d="M152 150 h176 a22 22 0 0 1 22 22 v118 a92 92 0 0 1 -110 62 l-88 -30 z" fill="url(#plateB)" stroke="#101116" stroke-width="4"/>
    <path d="M158 158 h164" stroke="#c3cad6" stroke-width="6" opacity="0.5" stroke-linecap="round"/>
  </g>
  <path d="M96 128 h176 a22 22 0 0 1 22 22 v118 a92 92 0 0 1 -110 62 l-88 -30 z" fill="url(#plateA)" stroke="#101116" stroke-width="4"/>
  <path d="M104 136 h160" stroke="#dde3ee" stroke-width="7" opacity="0.65" stroke-linecap="round"/>
  <path d="M96 208 q92 22 190 4" stroke="#0d0e12" stroke-width="4" fill="none" opacity="0.35"/>
  <path d="M108 254 q66 30 132 24" stroke="#dde3ee" stroke-width="4" fill="none" opacity="0.3"/>
  <circle cx="120" cy="152" r="8" fill="url(#rivet)" stroke="#0d0e12" stroke-width="2"/>
  <circle cx="164" cy="152" r="8" fill="url(#rivet)" stroke="#0d0e12" stroke-width="2"/>
  <circle cx="208" cy="152" r="8" fill="url(#rivet)" stroke="#0d0e12" stroke-width="2"/>
  <circle cx="250" cy="152" r="8" fill="url(#rivet)" stroke="#0d0e12" stroke-width="2"/>
</g>`,
    `<linearGradient id="plateA" x1="0" y1="0" x2="0.8" y2="1">
<stop offset="0" stop-color="#aab2c0"/>
<stop offset="0.5" stop-color="#69707e"/>
<stop offset="1" stop-color="#383c46"/>
</linearGradient>
<linearGradient id="plateB" x1="0" y1="0" x2="0.8" y2="1">
<stop offset="0" stop-color="#828a98"/>
<stop offset="0.55" stop-color="#4d525e"/>
<stop offset="1" stop-color="#292c34"/>
</linearGradient>
<linearGradient id="plateC" x1="0" y1="0" x2="0.8" y2="1">
<stop offset="0" stop-color="#5a5f6b"/>
<stop offset="0.6" stop-color="#363943"/>
<stop offset="1" stop-color="#1e2026"/>
</linearGradient>
<radialGradient id="rivet" cx="0.35" cy="0.3" r="0.9">
<stop offset="0" stop-color="#e8edf6"/>
<stop offset="0.5" stop-color="#8b93a2"/>
<stop offset="1" stop-color="#3d414b"/>
</radialGradient>`,
  ),

  // A coiled scaled-leather cord: stacked loops of dragonhide lacing with chevron
  // scale nicks and a loose working end crossing the coil.
  wyrmhide_cording: stage(
    '#3a352a',
    '#1d1b16',
    `<g>
  <ellipse cx="256" cy="292" rx="150" ry="66" fill="none" stroke="url(#hideC)" stroke-width="34"/>
  <ellipse cx="256" cy="258" rx="142" ry="62" fill="none" stroke="url(#hideB)" stroke-width="34"/>
  <ellipse cx="256" cy="224" rx="134" ry="58" fill="none" stroke="url(#hideA)" stroke-width="34"/>
  <ellipse cx="256" cy="216" rx="132" ry="55" fill="none" stroke="#d8c491" stroke-width="4" opacity="0.4"/>
  <g stroke="#241f14" stroke-width="4" fill="none" opacity="0.75" stroke-linecap="round">
    <path d="M148 190 l16 -14"/><path d="M176 178 l15 -14"/><path d="M206 170 l13 -15"/>
    <path d="M238 166 l11 -16"/><path d="M270 165 l9 -16"/><path d="M302 169 l7 -17"/>
    <path d="M332 176 l4 -17"/><path d="M360 188 l1 -17"/>
  </g>
  <path d="M136 296 C 190 342 330 348 396 300 C 420 282 430 258 420 240" fill="none" stroke="url(#hideEnd)" stroke-width="26" stroke-linecap="round"/>
  <path d="M414 244 l22 -18" stroke="#5e4c2c" stroke-width="16" stroke-linecap="round"/>
</g>`,
    `<linearGradient id="hideA" x1="0" y1="0" x2="1" y2="1">
<stop offset="0" stop-color="#a08a52"/>
<stop offset="0.5" stop-color="#6f5c34"/>
<stop offset="1" stop-color="#453a22"/>
</linearGradient>
<linearGradient id="hideB" x1="0" y1="0" x2="1" y2="1">
<stop offset="0" stop-color="#7c6a3e"/>
<stop offset="0.55" stop-color="#584a29"/>
<stop offset="1" stop-color="#37301c"/>
</linearGradient>
<linearGradient id="hideC" x1="0" y1="0" x2="1" y2="1">
<stop offset="0" stop-color="#5f5130"/>
<stop offset="0.6" stop-color="#423920"/>
<stop offset="1" stop-color="#292416"/>
</linearGradient>
<linearGradient id="hideEnd" x1="0" y1="0" x2="1" y2="0.4">
<stop offset="0" stop-color="#8a744a"/>
<stop offset="0.6" stop-color="#61502c"/>
<stop offset="1" stop-color="#3c321d"/>
</linearGradient>`,
  ),

  // A rolled bolt of golden cloth: the spiral core faces the light, the run of
  // fabric drapes off the roll with soft fold shadows and a silken sheen.
  sunspun_bolt: stage(
    '#3f382c',
    '#1e1b16',
    `<g transform="rotate(-6 256 270)">
  <rect x="112" y="286" width="290" height="54" rx="27" fill="url(#foldC)" stroke="#4a350e" stroke-width="4"/>
  <rect x="120" y="246" width="274" height="54" rx="27" fill="url(#foldB)" stroke="#4a350e" stroke-width="4"/>
  <rect x="130" y="204" width="254" height="56" rx="28" fill="url(#foldA)" stroke="#4a350e" stroke-width="4"/>
  <path d="M152 220 q104 -16 212 -2" stroke="#ffedb2" stroke-width="9" opacity="0.65" fill="none" stroke-linecap="round"/>
  <path d="M136 276 q116 14 246 4" stroke="#5d4315" stroke-width="4" opacity="0.45" fill="none"/>
  <path d="M128 316 q120 14 262 4" stroke="#523b12" stroke-width="4" opacity="0.45" fill="none"/>
  <path d="M136 230 q-34 42 -16 100 q10 30 38 36 q-20 -38 -12 -80 q5 -30 22 -48 z" fill="url(#drape)" stroke="#4a350e" stroke-width="3.6"/>
  <path d="M140 270 q-10 40 8 78" stroke="#6e4f19" stroke-width="4" fill="none" opacity="0.55"/>
  <path d="M148 240 q-14 20 -16 48" stroke="#ffedb2" stroke-width="5" fill="none" opacity="0.5" stroke-linecap="round"/>
</g>`,
    `<linearGradient id="foldA" x1="0" y1="0" x2="0.3" y2="1">
<stop offset="0" stop-color="#f4c95f"/>
<stop offset="0.6" stop-color="#c8963c"/>
<stop offset="1" stop-color="#8a6522"/>
</linearGradient>
<linearGradient id="foldB" x1="0" y1="0" x2="0.3" y2="1">
<stop offset="0" stop-color="#d8a747"/>
<stop offset="0.6" stop-color="#a87c2e"/>
<stop offset="1" stop-color="#6e5019"/>
</linearGradient>
<linearGradient id="foldC" x1="0" y1="0" x2="0.3" y2="1">
<stop offset="0" stop-color="#b58a35"/>
<stop offset="0.6" stop-color="#8a6522"/>
<stop offset="1" stop-color="#573f12"/>
</linearGradient>
<linearGradient id="drape" x1="0" y1="0" x2="1" y2="1">
<stop offset="0" stop-color="#e5b452"/>
<stop offset="0.6" stop-color="#a87c2e"/>
<stop offset="1" stop-color="#694816"/>
</linearGradient>`,
  ),

  // A faceted glass bezel mount: an empty jeweler's setting, a bright metal bezel
  // ring gripping a cut prismglass dome with restrained spectral facets.
  prismglass_setting: stage(
    '#2e3442',
    '#171a21',
    `<g>
  <circle cx="256" cy="268" r="150" fill="url(#bezelOuter)" stroke="#0e0f13" stroke-width="5"/>
  <circle cx="256" cy="268" r="118" fill="url(#bezelInner)"/>
  <g fill="url(#prong)" stroke="#101116" stroke-width="3">
    <path d="M256 106 l20 34 -40 0 z"/>
    <path d="M256 430 l20 -34 -40 0 z"/>
    <path d="M94 268 l34 -20 0 40 z"/>
    <path d="M418 268 l-34 -20 0 40 z"/>
  </g>
  <circle cx="256" cy="268" r="96" fill="url(#glassDome)" stroke="#c9d6e8" stroke-width="3"/>
  <g stroke="#e7f0fb" stroke-width="2.4" opacity="0.65" fill="none">
    <path d="M256 172 L306 240 L288 348 L224 348 L206 240 Z"/>
    <path d="M206 240 L160 268 M306 240 L352 268 M224 348 L196 330 M288 348 L316 330 M256 172 L256 208"/>
  </g>
  <path d="M306 240 L352 268 L316 330 L288 348 Z" fill="#9fd8c9" opacity="0.28"/>
  <path d="M206 240 L160 268 L196 330 L224 348 Z" fill="#b9a7e0" opacity="0.28"/>
  <path d="M256 172 L306 240 L256 268 L206 240 Z" fill="#f2c8d6" opacity="0.24"/>
  <path d="M186 210 a96 96 0 0 1 60 -34" stroke="#ffffff" stroke-width="9" fill="none" opacity="0.8" stroke-linecap="round"/>
  <circle cx="216" cy="196" r="7" fill="#ffffff" opacity="0.9" filter="url(#soft4)"/>
</g>`,
    `<linearGradient id="bezelOuter" x1="0" y1="0" x2="0.8" y2="1">
<stop offset="0" stop-color="#cbd3df"/>
<stop offset="0.5" stop-color="#77808f"/>
<stop offset="1" stop-color="#3a3f4a"/>
</linearGradient>
<linearGradient id="bezelInner" x1="0" y1="0" x2="0.8" y2="1">
<stop offset="0" stop-color="#4c515d"/>
<stop offset="1" stop-color="#23252d"/>
</linearGradient>
<linearGradient id="prong" x1="0" y1="0" x2="1" y2="1">
<stop offset="0" stop-color="#b8c0cd"/>
<stop offset="1" stop-color="#565c68"/>
</linearGradient>
<radialGradient id="glassDome" cx="0.36" cy="0.3" r="1">
<stop offset="0" stop-color="#dfeaf6"/>
<stop offset="0.55" stop-color="#93a7bd"/>
<stop offset="1" stop-color="#485468"/>
</radialGradient>`,
  ),

  // A compact geared frame: a riveted brass chassis carrying two meshed steel
  // gears and an axle block, the workings readable through the open frame.
  precision_chassis: stage(
    '#3a332a',
    '#1c1a17',
    `<g>
  <rect x="116" y="150" width="280" height="236" rx="20" fill="url(#chassisFrame)" stroke="#0e0d0b" stroke-width="5"/>
  <rect x="146" y="180" width="220" height="176" rx="12" fill="url(#chassisWell)" stroke="#0e0d0b" stroke-width="4"/>
  <g fill="url(#gearSteel)" stroke="#0f0f11" stroke-width="3">
    <g transform="rotate(12 226 262)">
      <circle cx="226" cy="262" r="52"/>
      <g>
        <rect x="218" y="196" width="16" height="24" rx="4"/>
        <rect x="218" y="304" width="16" height="24" rx="4"/>
        <rect x="160" y="254" width="24" height="16" rx="4"/>
        <rect x="268" y="254" width="24" height="16" rx="4"/>
        <rect x="218" y="196" width="16" height="24" rx="4" transform="rotate(45 226 262)"/>
        <rect x="218" y="304" width="16" height="24" rx="4" transform="rotate(45 226 262)"/>
        <rect x="160" y="254" width="24" height="16" rx="4" transform="rotate(45 226 262)"/>
        <rect x="268" y="254" width="24" height="16" rx="4" transform="rotate(45 226 262)"/>
      </g>
    </g>
  </g>
  <circle cx="226" cy="262" r="20" fill="url(#gearHub)" stroke="#0f0f11" stroke-width="3"/>
  <g fill="url(#gearBrass)" stroke="#0f0f11" stroke-width="3">
    <g transform="rotate(-8 316 312)">
      <circle cx="316" cy="312" r="34"/>
      <rect x="310" y="268" width="12" height="18" rx="3"/>
      <rect x="310" y="338" width="12" height="18" rx="3"/>
      <rect x="272" y="306" width="18" height="12" rx="3"/>
      <rect x="342" y="306" width="18" height="12" rx="3"/>
      <rect x="310" y="268" width="12" height="18" rx="3" transform="rotate(45 316 312)"/>
      <rect x="310" y="338" width="12" height="18" rx="3" transform="rotate(45 316 312)"/>
      <rect x="272" y="306" width="18" height="12" rx="3" transform="rotate(45 316 312)"/>
      <rect x="342" y="306" width="18" height="12" rx="3" transform="rotate(45 316 312)"/>
    </g>
  </g>
  <circle cx="316" cy="312" r="12" fill="url(#gearHub)" stroke="#0f0f11" stroke-width="3"/>
  <rect x="298" y="192" width="54" height="34" rx="8" fill="url(#gearBrass)" stroke="#0e0d0b" stroke-width="3"/>
  <rect x="306" y="200" width="24" height="8" rx="4" fill="#f3e3b0" opacity="0.6"/>
  <rect x="124" y="158" width="140" height="10" rx="5" fill="#f0dfae" opacity="0.4"/>
  <g fill="url(#rivetB)" stroke="#0e0d0b" stroke-width="2">
    <circle cx="134" cy="168" r="7"/><circle cx="378" cy="168" r="7"/>
    <circle cx="134" cy="368" r="7"/><circle cx="378" cy="368" r="7"/>
  </g>
</g>`,
    `<linearGradient id="chassisFrame" x1="0" y1="0" x2="0.7" y2="1">
<stop offset="0" stop-color="#c9a44e"/>
<stop offset="0.5" stop-color="#8a6c2c"/>
<stop offset="1" stop-color="#4d3c17"/>
</linearGradient>
<linearGradient id="chassisWell" x1="0" y1="0" x2="0.7" y2="1">
<stop offset="0" stop-color="#2a2925"/>
<stop offset="1" stop-color="#151412"/>
</linearGradient>
<linearGradient id="gearSteel" x1="0" y1="0" x2="0.8" y2="1">
<stop offset="0" stop-color="#aeb6c2"/>
<stop offset="0.55" stop-color="#6d7480"/>
<stop offset="1" stop-color="#3a3e47"/>
</linearGradient>
<linearGradient id="gearBrass" x1="0" y1="0" x2="0.8" y2="1">
<stop offset="0" stop-color="#dcb45e"/>
<stop offset="0.55" stop-color="#a37f35"/>
<stop offset="1" stop-color="#5d4718"/>
</linearGradient>
<radialGradient id="gearHub" cx="0.35" cy="0.3" r="0.9">
<stop offset="0" stop-color="#e9edf4"/>
<stop offset="0.6" stop-color="#8a919e"/>
<stop offset="1" stop-color="#43464f"/>
</radialGradient>
<radialGradient id="rivetB" cx="0.35" cy="0.3" r="0.9">
<stop offset="0" stop-color="#f4e6b8"/>
<stop offset="0.6" stop-color="#b08c3f"/>
<stop offset="1" stop-color="#57431a"/>
</radialGradient>`,
  ),

  // A phial of quicksilver: a corked round-bottom flask, the mercury pooled
  // bright and metallic with motion streaks whipping around the swirl.
  quickening_catalyst: stage(
    '#2f3336',
    '#17191c',
    `<g>
  <path d="M238 122 h36 v70 c46 18 78 60 78 112 a96 96 0 0 1 -192 0 c0 -52 32 -94 78 -112 z" fill="url(#flaskGlass)" stroke="#aebdc6" stroke-width="4"/>
  <path d="M180 290 a76 76 0 0 0 152 0 c0 -34 -20 -64 -50 -78 q-26 22 -52 0 c-30 14 -50 44 -50 78 z" fill="url(#mercury)"/>
  <path d="M196 268 q30 -26 60 -8 t60 8" stroke="#f4fbff" stroke-width="7" fill="none" opacity="0.85" stroke-linecap="round"/>
  <path d="M204 306 q40 22 104 -2" stroke="#c9d9e2" stroke-width="5" fill="none" opacity="0.6" stroke-linecap="round"/>
  <path d="M222 336 q34 14 68 0" stroke="#9fb2bd" stroke-width="4" fill="none" opacity="0.5" stroke-linecap="round"/>
  <ellipse cx="238" cy="286" rx="14" ry="9" fill="#ffffff" opacity="0.9"/>
  <ellipse cx="296" cy="322" rx="9" ry="6" fill="#e8f3f9" opacity="0.75"/>
  <path d="M150 236 q-24 40 -8 88" stroke="#cfe0ea" stroke-width="6" fill="none" opacity="0.5" stroke-linecap="round"/>
  <path d="M362 236 q24 40 8 88" stroke="#cfe0ea" stroke-width="6" fill="none" opacity="0.5" stroke-linecap="round"/>
  <path d="M206 160 a96 96 0 0 0 -44 58" stroke="#e9f4fa" stroke-width="6" fill="none" opacity="0.55" stroke-linecap="round"/>
  <rect x="232" y="96" width="48" height="34" rx="8" fill="url(#corkQ)" stroke="#1d150c" stroke-width="3"/>
  <rect x="236" y="122" width="40" height="10" fill="#2e3a41" opacity="0.7"/>
</g>`,
    `<linearGradient id="flaskGlass" x1="0" y1="0" x2="0.6" y2="1">
<stop offset="0" stop-color="#5b6b74"/>
<stop offset="0.5" stop-color="#39454d"/>
<stop offset="1" stop-color="#232b31"/>
</linearGradient>
<linearGradient id="mercury" x1="0" y1="0" x2="0.5" y2="1">
<stop offset="0" stop-color="#eef6fb"/>
<stop offset="0.4" stop-color="#aebfca"/>
<stop offset="1" stop-color="#5c6b76"/>
</linearGradient>
<linearGradient id="corkQ" x1="0" y1="0" x2="0.6" y2="1">
<stop offset="0" stop-color="#a67f4e"/>
<stop offset="1" stop-color="#57401f"/>
</linearGradient>`,
  ),

  // A steaming stockpot: a lidded copper-banded pot with side handles, the lid set
  // ajar over a glowing rim of broth, soft steam curling off the gap.
  seasoned_stock: stage(
    '#3c342c',
    '#1d1a17',
    `<g>
  <path d="M300 128 q10 44 -14 74" stroke="#c9cdd4" stroke-width="9" fill="none" opacity="0.4" stroke-linecap="round" filter="url(#soft4)"/>
  <path d="M252 118 q-16 40 6 78" stroke="#c9cdd4" stroke-width="11" fill="none" opacity="0.5" stroke-linecap="round" filter="url(#soft4)"/>
  <path d="M206 136 q-6 34 12 60" stroke="#c9cdd4" stroke-width="8" fill="none" opacity="0.35" stroke-linecap="round" filter="url(#soft4)"/>
  <ellipse cx="258" cy="216" rx="126" ry="30" fill="url(#brothRim)"/>
  <g transform="rotate(-7 250 204)">
    <ellipse cx="250" cy="198" rx="118" ry="26" fill="url(#lidTop)" stroke="#101012" stroke-width="4"/>
    <ellipse cx="250" cy="192" rx="34" ry="12" fill="url(#lidKnob)" stroke="#101012" stroke-width="3"/>
    <ellipse cx="216" cy="188" rx="30" ry="7" fill="#f0f3f8" opacity="0.5"/>
  </g>
  <path d="M132 224 c0 80 30 148 126 148 s126 -68 126 -148 z" fill="url(#potBody)" stroke="#0e0e10" stroke-width="5"/>
  <path d="M132 244 q126 34 252 0" stroke="url(#copperBand)" stroke-width="14" fill="none"/>
  <path d="M148 320 q110 26 220 0" stroke="#0c0c0e" stroke-width="5" fill="none" opacity="0.4"/>
  <path d="M118 226 a22 22 0 0 0 -6 44 l24 4" stroke="url(#copperBand)" stroke-width="13" fill="none" stroke-linecap="round"/>
  <path d="M394 226 a22 22 0 0 1 6 44 l-24 4" stroke="url(#copperBand)" stroke-width="13" fill="none" stroke-linecap="round"/>
  <path d="M150 238 q10 66 52 108" stroke="#f3ede2" stroke-width="8" fill="none" opacity="0.35" stroke-linecap="round"/>
</g>`,
    `<linearGradient id="potBody" x1="0" y1="0" x2="0.6" y2="1">
<stop offset="0" stop-color="#6e7480"/>
<stop offset="0.5" stop-color="#454a54"/>
<stop offset="1" stop-color="#26282e"/>
</linearGradient>
<linearGradient id="lidTop" x1="0" y1="0" x2="0.7" y2="1">
<stop offset="0" stop-color="#b3bac6"/>
<stop offset="0.6" stop-color="#6d7480"/>
<stop offset="1" stop-color="#3d414b"/>
</linearGradient>
<radialGradient id="lidKnob" cx="0.35" cy="0.3" r="0.9">
<stop offset="0" stop-color="#e6c581"/>
<stop offset="0.6" stop-color="#a97f3c"/>
<stop offset="1" stop-color="#5c421a"/>
</radialGradient>
<linearGradient id="copperBand" x1="0" y1="0" x2="1" y2="0.6">
<stop offset="0" stop-color="#d99a58"/>
<stop offset="0.5" stop-color="#a4642c"/>
<stop offset="1" stop-color="#5e3514"/>
</linearGradient>
<radialGradient id="brothRim" cx="0.4" cy="0.35" r="0.9">
<stop offset="0" stop-color="#f7c96b"/>
<stop offset="0.7" stop-color="#b97f2c"/>
<stop offset="1" stop-color="#6e4712"/>
</radialGradient>`,
  ),

  // A glowing crystalline phial: a slender stoppered vial packed with lucent
  // cyan shard crystals, their light pooling softly through the glass.
  lucent_reagent: stage(
    '#28313a',
    '#141a20',
    `<g>
  <ellipse cx="256" cy="284" rx="96" ry="120" fill="#57e6d2" opacity="0.16" filter="url(#soft)"/>
  <path d="M226 152 h60 v56 q34 28 34 88 a64 64 0 0 1 -128 0 q0 -60 34 -88 z" fill="url(#vialGlass)" stroke="#bfe6e2" stroke-width="4"/>
  <g stroke="#0f2b28" stroke-width="3">
    <path d="M256 226 l30 52 -30 66 -30 -66 z" fill="url(#lucentA)"/>
    <path d="M216 268 l22 30 -14 52 -26 -44 z" fill="url(#lucentB)"/>
    <path d="M296 268 l20 38 -24 46 -14 -50 z" fill="url(#lucentB)"/>
  </g>
  <path d="M256 226 l10 52 -10 66" stroke="#eafffb" stroke-width="4" fill="none" opacity="0.8"/>
  <circle cx="256" cy="276" r="6" fill="#ffffff" opacity="0.95" filter="url(#soft4)"/>
  <circle cx="222" cy="300" r="4" fill="#d8fff8" opacity="0.8" filter="url(#soft4)"/>
  <circle cx="298" cy="296" r="4.6" fill="#d8fff8" opacity="0.8" filter="url(#soft4)"/>
  <path d="M212 208 a64 88 0 0 0 -18 84" stroke="#e9fffb" stroke-width="6" fill="none" opacity="0.5" stroke-linecap="round"/>
  <rect x="220" y="118" width="72" height="40" rx="9" fill="url(#corkL)" stroke="#161009" stroke-width="3"/>
  <rect x="228" y="126" width="34" height="8" rx="4" fill="#d9b98a" opacity="0.6"/>
  <rect x="224" y="152" width="64" height="10" fill="#20444a" opacity="0.7"/>
</g>`,
    `<linearGradient id="vialGlass" x1="0" y1="0" x2="0.6" y2="1">
<stop offset="0" stop-color="#3f5a60"/>
<stop offset="0.5" stop-color="#2c4349"/>
<stop offset="1" stop-color="#1b2c31"/>
</linearGradient>
<linearGradient id="lucentA" x1="0" y1="0" x2="0.6" y2="1">
<stop offset="0" stop-color="#e7fffa"/>
<stop offset="0.5" stop-color="#7cf0dd"/>
<stop offset="1" stop-color="#2a9d8c"/>
</linearGradient>
<linearGradient id="lucentB" x1="0" y1="0" x2="0.6" y2="1">
<stop offset="0" stop-color="#b6fff2"/>
<stop offset="0.55" stop-color="#54cfbc"/>
<stop offset="1" stop-color="#1f7568"/>
</linearGradient>
<linearGradient id="corkL" x1="0" y1="0" x2="0.6" y2="1">
<stop offset="0" stop-color="#b08a55"/>
<stop offset="1" stop-color="#5e4522"/>
</linearGradient>`,
  ),

  // A rolled vellum sheet with a black wax seal: cream vellum wrapped tight, the
  // sablewax boss embossed with a plain ring-and-star relief, never lettering.
  sablewax_vellum: stage(
    '#38322b',
    '#1b1916',
    `<g transform="rotate(-8 256 272)">
  <path d="M118 300 q-30 28 -22 68 q40 -6 64 -32" fill="url(#vellumFlap)" stroke="#43331c" stroke-width="3.6"/>
  <rect x="104" y="222" width="296" height="98" rx="49" fill="url(#vellumBody)" stroke="#43331c" stroke-width="4"/>
  <ellipse cx="386" cy="271" rx="24" ry="45" fill="url(#vellumEndFace)" stroke="#43331c" stroke-width="3.6"/>
  <path d="M386 236 a22 42 0 0 1 0 72" fill="none" stroke="#a5854c" stroke-width="4" opacity="0.8"/>
  <path d="M388 250 a12 24 0 0 1 0 44" fill="none" stroke="#8a6f42" stroke-width="4" opacity="0.75"/>
  <path d="M124 242 h226" stroke="#fff6dd" stroke-width="8" opacity="0.55" stroke-linecap="round"/>
  <path d="M120 300 q118 16 240 4" stroke="#6b5330" stroke-width="4" fill="none" opacity="0.5"/>
  <rect x="186" y="212" width="56" height="116" rx="10" fill="url(#wrapBand)" stroke="#241a0d" stroke-width="3"/>
  <path d="M256 270 Q262.2 289.1 244.3 298.3 Q235.1 316.2 216 310 Q196.9 316.2 187.7 298.3 Q169.8 289.1 176 270 Q169.8 250.9 187.7 241.7 Q196.9 223.8 216 230 Q235.1 223.8 244.3 241.7 Q262.2 250.9 256 270 Z" fill="url(#sealWax)" stroke="#050505" stroke-width="3"/>
  <circle cx="216" cy="270" r="22" fill="none" stroke="url(#sealRelief)" stroke-width="5"/>
  <g stroke="url(#sealRelief)" stroke-width="3.6" stroke-linecap="round">
    <path d="M216 262 L216 254"/>
    <path d="M221.7 264.3 L227.3 258.7"/>
    <path d="M224 270 L232 270"/>
    <path d="M221.7 275.7 L227.3 281.3"/>
    <path d="M216 278 L216 286"/>
    <path d="M210.3 275.7 L204.7 281.3"/>
    <path d="M208 270 L200 270"/>
    <path d="M210.3 264.3 L204.7 258.7"/>
  </g>
  <circle cx="216" cy="270" r="5" fill="url(#sealRelief)"/>
  <path d="M186 244 a40 40 0 0 1 26 -12" stroke="#83838e" stroke-width="5" fill="none" opacity="0.8" stroke-linecap="round"/>
</g>`,
    `<linearGradient id="vellumBody" x1="0" y1="0" x2="0.35" y2="1">
<stop offset="0" stop-color="#efdfae"/>
<stop offset="0.55" stop-color="#cdb27a"/>
<stop offset="1" stop-color="#93743f"/>
</linearGradient>
<radialGradient id="vellumEndFace" cx="0.4" cy="0.35" r="1">
<stop offset="0" stop-color="#f4e7bd"/>
<stop offset="0.7" stop-color="#c8ab72"/>
<stop offset="1" stop-color="#8c6d3a"/>
</radialGradient>
<radialGradient id="vellumSpiral" cx="0.45" cy="0.4" r="1">
<stop offset="0" stop-color="#d9bf85"/>
<stop offset="1" stop-color="#a5854c"/>
</radialGradient>
<linearGradient id="vellumFlap" x1="0" y1="0" x2="1" y2="1">
<stop offset="0" stop-color="#d9c28a"/>
<stop offset="1" stop-color="#7e6234"/>
</linearGradient>
<linearGradient id="wrapBand" x1="0" y1="0" x2="0.8" y2="1">
<stop offset="0" stop-color="#c7a760"/>
<stop offset="1" stop-color="#77582a"/>
</linearGradient>
<radialGradient id="sealWax" cx="0.35" cy="0.3" r="1">
<stop offset="0" stop-color="#3b3b42"/>
<stop offset="0.45" stop-color="#1d1d22"/>
<stop offset="1" stop-color="#050506"/>
</radialGradient>
<linearGradient id="sealRelief" x1="0" y1="0" x2="0.8" y2="1">
<stop offset="0" stop-color="#6f6f7a"/>
<stop offset="1" stop-color="#26262c"/>
</linearGradient>`,
  ),
};

const ids = Object.keys(icons);
if (ids.length !== 10) {
  console.error(`expected 10 icons, found ${ids.length}`);
  process.exit(1);
}

// Every committed SVG carries its item's display name as the <title> element
// (the phase 06 convention, and the biome a11y noSvgWithoutTitle contract).
// The title is metadata only: it renders no pixels, so the rasterized PNG and
// the encoded WebP stay byte-identical to the untitled composition.
const TITLES = {
  duskforged_billet: 'Duskforged Billet',
  forgefold_plating: 'Forgefold Plating',
  wyrmhide_cording: 'Wyrmhide Cording',
  sunspun_bolt: 'Sunspun Bolt',
  prismglass_setting: 'Prismglass Setting',
  precision_chassis: 'Precision Chassis',
  quickening_catalyst: 'Quickening Catalyst',
  seasoned_stock: 'Seasoned Stock',
  lucent_reagent: 'Lucent Reagent',
  sablewax_vellum: 'Sablewax Vellum',
};
for (const id of ids) {
  icons[id] = icons[id].replace(/^(<svg [^>]*>)/, `$1\n<title>${TITLES[id]}</title>`);
}

for (const [id, svg] of Object.entries(icons)) {
  const svgPath = path.join(OUT_DIR, `${id}.svg`);
  writeFileSync(svgPath, svg);
}

const target = process.argv[3];
if (!target) {
  console.log('SVGs written; pass a second arg to rasterize into it');
  process.exit(0);
}
mkdirSync(target, { recursive: true });
for (const [id, svg] of Object.entries(icons)) {
  const png = await sharp(Buffer.from(svg))
    .resize(512, 512, { fit: 'fill' })
    .flatten({ background: '#101014' })
    .removeAlpha()
    .toColorspace('srgb')
    .png()
    .toBuffer();
  const meta = await sharp(png).metadata();
  if (meta.width !== 512 || meta.height !== 512) {
    console.error(`${id}: unexpected raster size ${meta.width}x${meta.height}`);
    process.exit(1);
  }
  writeFileSync(path.join(target, `${id}.png`), png);
  console.log(`rasterized ${id}.png (${png.length} bytes)`);
}
