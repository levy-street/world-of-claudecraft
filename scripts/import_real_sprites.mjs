// import_real_sprites.mjs — Copies downloaded RO-style sprites into the sprite
// system and generates correct JSON metadata for single-frame sprites.
// Run with: node scripts/import_real_sprites.mjs

import { mkdirSync, copyFileSync, writeFileSync, readdirSync } from 'fs';
import { join } from 'path';

const SRC = join(import.meta.dirname, '..', 'tmp', 'sprites_source');
const BODIES_DIR = join(import.meta.dirname, '..', 'public', 'sprites', 'bodies');

// Mapping: source filename → target body name + height
const SPRITE_MAP = {
  'novice_f.png':    { target: 'novice',    h: 2.6 },
  'acolyte.png':     { target: 'druid',     h: 2.6 },
  'archer.png':      { target: 'ranger',    h: 2.6 },
  'mage_ro.png':     { target: 'mage',      h: 2.6 },
  'merchant.png':    { target: 'barbarian', h: 2.6 },
  'swordman.png':    { target: 'paladin',   h: 2.6 },
  'thief.png':       { target: 'rogue',     h: 2.6 },
  'assassin.png':    { target: 'rogue_hooded', h: 2.6 },
  'blacksmith.png':  { target: 'knight',    h: 2.6 },
  'knight_ro.png':   { target: 'npc_knight', h: 2.6 },
  'priest_ro.png':   { target: 'npc_mage',  h: 2.6 },
  'wizard.png':      { target: 'necromancer', h: 2.6 },
};

// Single-frame animation metadata
// All animations point to the same single frame (row 0, 1 frame)
function makeSingleFrameMeta(height) {
  return {
    height,
    hover: 0,
    frameWidth: 0,   // 0 = auto-detect from texture size (single frame = full image)
    frameHeight: 0,
    animations: {
      idle:   { row: 0, frames: 1, fps: 1 },
      walk:   { row: 0, frames: 1, fps: 1 },
      attack: { row: 0, frames: 1, fps: 1 },
      cast:   { row: 0, frames: 1, fps: 1 },
      death:  { row: 0, frames: 1, fps: 1 },
    },
  };
}

mkdirSync(BODIES_DIR, { recursive: true });

let count = 0;
for (const [srcFile, def] of Object.entries(SPRITE_MAP)) {
  const srcPath = join(SRC, srcFile);
  const dstPng = join(BODIES_DIR, `${def.target}.png`);
  const dstJson = join(BODIES_DIR, `${def.target}.json`);

  try {
    copyFileSync(srcPath, dstPng);
    writeFileSync(dstJson, JSON.stringify(makeSingleFrameMeta(def.h), null, 2));
    count++;
    console.log(`  ${srcFile} → ${def.target}.png + .json`);
  } catch (err) {
    console.warn(`  SKIP ${srcFile}: ${err.message}`);
  }
}

console.log(`\nImported ${count} real sprites into ${BODIES_DIR}`);
