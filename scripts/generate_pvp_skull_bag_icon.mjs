#!/usr/bin/env node
// Deterministic icon for the World PvP Skull Bag (pvp_skull_bag,
// src/sim/pvp/skull_bag.ts). No image model runs here: the project's painted
// burlap pouch (public/ui/items/burlap_reagent_pouch.webp) is darkened and
// warmed toward oxblood leather, and the painted Restless Skull
// (public/ui/items/restless_skull.webp, the same source the trophy skull's
// icon crops) is scaled down, feathered and stitched onto its front, under the
// trophy's crimson cord, so the bag reads as the skulls' own sack rather than a
// reagent pouch. Output: an opaque 128x128 sRGB WebP under the 15 KB budget.
//
//   node scripts/generate_pvp_skull_bag_icon.mjs
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const POUCH = path.join(repoRoot, 'public/ui/items/burlap_reagent_pouch.webp');
const SKULL_SOURCE = path.join(repoRoot, 'public/ui/items/restless_skull.webp');
const OUTPUT = path.join(repoRoot, 'public/ui/items/pvp_skull_bag.webp');
const SIZE = 128;
const SKULL = 46;

// A feathered disc: keeps the painted skull and fades its dark ground into the
// sack cloth instead of pasting a square.
const FEATHER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="${SKULL}" height="${SKULL}">
  <defs>
    <radialGradient id="f" cx="50%" cy="46%" r="50%">
      <stop offset="50%" stop-color="#fff" stop-opacity="1"/>
      <stop offset="100%" stop-color="#fff" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${SKULL}" height="${SKULL}" fill="url(#f)"/>
</svg>`;

// The crimson cord cinched around the neck, the trophy ribbon's colour, with
// two tasselled ends hanging to the right.
const CORD_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}">
  <defs>
    <linearGradient id="cord" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#d4453f"/>
      <stop offset="100%" stop-color="#6d1016"/>
    </linearGradient>
  </defs>
  <path d="M40 47 Q64 55 88 47" fill="none" stroke="#2a0507" stroke-width="6"
        stroke-linecap="round"/>
  <path d="M40 47 Q64 55 88 47" fill="none" stroke="url(#cord)" stroke-width="4"
        stroke-linecap="round"/>
  <path d="M84 50 Q88 62 84 72" fill="none" stroke="url(#cord)" stroke-width="3"
        stroke-linecap="round"/>
  <path d="M88 49 Q94 60 93 69" fill="none" stroke="url(#cord)" stroke-width="3"
        stroke-linecap="round"/>
  <circle cx="84" cy="74" r="3" fill="#8a1a1e"/>
  <circle cx="93" cy="71" r="3" fill="#8a1a1e"/>
</svg>`;

const pouch = await sharp(POUCH)
  .resize(SIZE, SIZE, { fit: 'cover' })
  .modulate({ brightness: 0.82, saturation: 1.15, hue: -12 })
  .tint({ r: 150, g: 92, b: 78 })
  .png()
  .toBuffer();

const skull = await sharp(SKULL_SOURCE)
  .resize(SKULL, SKULL, { fit: 'cover' })
  .modulate({ brightness: 1.15, saturation: 0.85 })
  .ensureAlpha()
  .composite([{ input: Buffer.from(FEATHER_SVG), blend: 'dest-in' }])
  .png()
  .toBuffer();

await sharp(pouch)
  .composite([
    { input: skull, left: Math.round((SIZE - SKULL) / 2), top: 62 },
    { input: Buffer.from(CORD_SVG), left: 0, top: 0 },
  ])
  .flatten({ background: '#000000' })
  .removeAlpha()
  .toColourspace('srgb')
  .webp({ quality: 90, effort: 6, smartSubsample: true })
  .toFile(OUTPUT);

const meta = await sharp(OUTPUT).metadata();
console.log(`wrote ${path.relative(repoRoot, OUTPUT)} ${meta.width}x${meta.height}`);
