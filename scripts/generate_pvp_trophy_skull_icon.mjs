#!/usr/bin/env node
// Deterministic icon for the World PvP trophy skull (pvp_trophy_skull,
// src/sim/pvp/world_pvp_spoils.ts). No image model runs here: an authored SVG
// trophy mount (a dark vignette, a carved wooden heater plaque with brass
// studs, a crimson victory ribbon) is composed around the skull from the
// project's painted Restless Skull (public/ui/items/restless_skull.webp, batch
// quest-objective-dedupe-zone-quest-items-2026-08-04), which is mirrored,
// scaled down and feathered onto the plaque, so the trophy reads as a mounted
// kill rather than a second copy of the quest skull. Output: an opaque 128x128
// sRGB WebP under the 15 KB item-icon budget.
//
//   node scripts/generate_pvp_trophy_skull_icon.mjs
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = path.join(repoRoot, 'public/ui/items/restless_skull.webp');
const OUTPUT = path.join(repoRoot, 'public/ui/items/pvp_trophy_skull.webp');
const SIZE = 128;
const SKULL = 76;

// The mount behind the skull: vignette ground, the plaque with a carved rim and
// four brass studs, lit from the top left like the rest of the catalog.
const MOUNT_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}">
  <defs>
    <radialGradient id="ground" cx="40%" cy="36%" r="80%">
      <stop offset="0%" stop-color="#2a2019"/>
      <stop offset="100%" stop-color="#07060a"/>
    </radialGradient>
    <linearGradient id="wood" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#8a5a34"/>
      <stop offset="55%" stop-color="#5a371d"/>
      <stop offset="100%" stop-color="#2e1b0e"/>
    </linearGradient>
    <linearGradient id="inner" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#6a4326"/>
      <stop offset="100%" stop-color="#2a180c"/>
    </linearGradient>
    <radialGradient id="stud" cx="35%" cy="35%" r="70%">
      <stop offset="0%" stop-color="#ffe7a3"/>
      <stop offset="60%" stop-color="#b8862f"/>
      <stop offset="100%" stop-color="#4d3410"/>
    </radialGradient>
  </defs>
  <rect width="${SIZE}" height="${SIZE}" fill="url(#ground)"/>
  <path d="M24 16 H104 V64 C104 92 84 108 64 118 C44 108 24 92 24 64 Z"
        fill="url(#wood)" stroke="#1c1008" stroke-width="3"/>
  <path d="M31 23 H97 V63 C97 86 81 100 64 109 C47 100 31 86 31 63 Z"
        fill="url(#inner)" stroke="#9a6a3c" stroke-opacity="0.55" stroke-width="1.5"/>
  <circle cx="30" cy="22" r="3.2" fill="url(#stud)"/>
  <circle cx="98" cy="22" r="3.2" fill="url(#stud)"/>
  <circle cx="33" cy="84" r="2.8" fill="url(#stud)"/>
  <circle cx="95" cy="84" r="2.8" fill="url(#stud)"/>
</svg>`;

// The victory ribbon slung across the lower plaque, in front of the jaw.
const RIBBON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}">
  <defs>
    <linearGradient id="cloth" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#c8373a"/>
      <stop offset="100%" stop-color="#5e0d12"/>
    </linearGradient>
  </defs>
  <path d="M14 92 L30 86 L30 100 L14 104 L20 98 Z" fill="#6d1016"/>
  <path d="M114 92 L98 86 L98 100 L114 104 L108 98 Z" fill="#6d1016"/>
  <path d="M28 84 Q64 96 100 84 L100 99 Q64 111 28 99 Z" fill="url(#cloth)"
        stroke="#2a0507" stroke-width="1.5"/>
  <path d="M34 90 Q64 101 94 90" fill="none" stroke="#f08a7a" stroke-opacity="0.45"
        stroke-width="1.2"/>
</svg>`;

// A feathered disc: keeps the painted skull and fades its own dark ground into
// the plaque instead of pasting a square.
const FEATHER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="${SKULL}" height="${SKULL}">
  <defs>
    <radialGradient id="f" cx="50%" cy="46%" r="50%">
      <stop offset="52%" stop-color="#fff" stop-opacity="1"/>
      <stop offset="100%" stop-color="#fff" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${SKULL}" height="${SKULL}" fill="url(#f)"/>
</svg>`;

const skull = await sharp(SOURCE)
  .resize(SKULL, SKULL, { fit: 'cover' })
  .flop()
  .modulate({ brightness: 1.12, saturation: 0.9 })
  .ensureAlpha()
  .composite([{ input: Buffer.from(FEATHER_SVG), blend: 'dest-in' }])
  .png()
  .toBuffer();

await sharp(Buffer.from(MOUNT_SVG))
  .composite([
    { input: skull, left: Math.round((SIZE - SKULL) / 2), top: 22 },
    { input: Buffer.from(RIBBON_SVG), left: 0, top: 0 },
  ])
  .flatten({ background: '#000000' })
  .removeAlpha()
  .toColourspace('srgb')
  .webp({ quality: 90, effort: 6, smartSubsample: true })
  .toFile(OUTPUT);

const meta = await sharp(OUTPUT).metadata();
console.log(`wrote ${path.relative(repoRoot, OUTPUT)} ${meta.width}x${meta.height}`);
