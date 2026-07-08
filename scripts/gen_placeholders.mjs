// gen_placeholders.mjs — Generates placeholder sprite sheets with pixel-art
// silhouettes + JSON metadata for every entity in the sprite manifest.
// Run with: node scripts/gen_placeholders.mjs
//
// Produces:
//   public/sprites/bodies/{name}.png   (128×640, 5 animation rows × 128px frames)
//   public/sprites/bodies/{name}.json
//   public/sprites/weapons/{name}.png  (128×128, single weapon frame)
//   public/sprites/weapons/{name}.json

import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

const PUBLIC = join(import.meta.dirname, '..', 'public', 'sprites');

// ---------------------------------------------------------------------------
// Silhouette pixel maps (16×16, 0 = transparent, 1 = fill)
// ---------------------------------------------------------------------------

const SIL = {
  // Basic humanoid — used for most player classes and humanoid mobs
  humanoid: [
    '0000001111000000',
    '0000011111100000',
    '0000011111100000',
    '0000001111000000',
    '0000011111100000',
    '0001111111111000',
    '0011111111111100',
    '0000111111110000',
    '0000011111100000',
    '0000011111100000',
    '0000111001110000',
    '0001110000111000',
    '0011100000011100',
    '0011000000001100',
    '0110000000000110',
    '0110000000000110',
  ],
  // Humanoid with staff/caster pose
  caster: [
    '0000001111000000',
    '0000011111100000',
    '0000011111100000',
    '0000001111000000',
    '1000111111100100',
    '0101111111110010',
    '0011111111111001',
    '0000111111110000',
    '0000011111100000',
    '0000011111100000',
    '0000111001110000',
    '0001110000111000',
    '0011100000011100',
    '0011000000001100',
    '0110000000000110',
    '0110000000000110',
  ],
  // Beast — four-legged wolf/boar/fox shape
  beast_quad: [
    '0000000000000000',
    '0000000000000000',
    '0011000000000000',
    '0111100000000000',
    '0111101111111000',
    '0011011111111100',
    '0000111111111110',
    '0001111111111110',
    '0000111111111100',
    '0000011111111000',
    '0000110011001100',
    '0001100011000110',
    '0011000011000011',
    '0110000011000011',
    '0110000011000011',
    '0000000000000000',
  ],
  // Spider — eight legs, low body
  spider: [
    '0000000000000000',
    '0000000000000000',
    '0000000000000000',
    '0000000000000000',
    '0010001111000100',
    '0101011111101010',
    '1000111111110001',
    '0100111111110010',
    '0011111111111100',
    '0100111111110010',
    '1000111111110001',
    '0101011111101010',
    '0010001111000100',
    '0000000000000000',
    '0000000000000000',
    '0000000000000000',
  ],
  // Skeleton — thin stick figure
  skeleton: [
    '0000001111000000',
    '0000011111100000',
    '0000011111100000',
    '0000001111000000',
    '0000001111000000',
    '0000011111100000',
    '0001111111111000',
    '0000011111100000',
    '0000001111000000',
    '0000011011100000',
    '0000110001110000',
    '0001100000111000',
    '0011000000011000',
    '0011000000011000',
    '0110000000001100',
    '0110000000001100',
  ],
  // Golem — bulky, wide shape
  golem: [
    '0000111111110000',
    '0001111111111000',
    '0011111111111100',
    '0011111111111100',
    '0001111111111000',
    '0111111111111110',
    '1111111111111111',
    '1111111111111111',
    '0111111111111110',
    '0011111111111100',
    '0011110000111100',
    '0011100000011100',
    '0111000000001110',
    '0111000000001110',
    '1110000000000111',
    '1110000000000111',
  ],
  // Dragon — winged beast
  dragon: [
    '0000000011000000',
    '0000000111100000',
    '0100001111110000',
    '0110011111111000',
    '0111111111111100',
    '0111111111111110',
    '0011111111111110',
    '0001111111111100',
    '0000111111111000',
    '0001110011011100',
    '0011000011001100',
    '0110000011000110',
    '1100000011000011',
    '1100000000000011',
    '0000000000000000',
    '0000000000000000',
  ],
  // Ghost — floating wispy shape
  ghost: [
    '0000001111000000',
    '0000011111100000',
    '0000111111110000',
    '0001111111111000',
    '0001111111111000',
    '0011111111111100',
    '0011111111111100',
    '0011111111111100',
    '0011111111111100',
    '0001111111111000',
    '0001111111111000',
    '0000111001110000',
    '0001100000111000',
    '0011000000011000',
    '0110000000001100',
    '0000000000000000',
  ],
  // Mech — blocky robot
  mech: [
    '0000111111110000',
    '0001111111111000',
    '0011110000111100',
    '0011111111111100',
    '0011111111111100',
    '0111111111111110',
    '1111111111111111',
    '1111111111111111',
    '0111111111111110',
    '0011111111111100',
    '0011100000011100',
    '0011100000011100',
    '0111100000011110',
    '0111100000011110',
    '1111100000011111',
    '1111100000011111',
  ],
  // Demon — horned humanoid
  demon: [
    '0100001111000100',
    '0110011111100110',
    '0011011111101100',
    '0000001111000000',
    '0000011111100000',
    '0001111111111000',
    '0011111111111100',
    '0000111111110000',
    '0000011111100000',
    '0000111001110000',
    '0001110000111000',
    '0011100000011100',
    '0011000000001100',
    '0110000000000110',
    '0110000000000110',
    '0110000000000110',
  ],
  // Frog — squat amphibian
  frog: [
    '0000000000000000',
    '0000000000000000',
    '0000000000000000',
    '0011000000001100',
    '0111100000011110',
    '0111111111111110',
    '0111111111111110',
    '0111111111111110',
    '0111111111111110',
    '0011111111111100',
    '0001111111111000',
    '0000111001110000',
    '0001110000111000',
    '0011100000011100',
    '0000000000000000',
    '0000000000000000',
  ],
  // Stag — deer-like with antlers
  stag: [
    '0000000000000000',
    '0001000000001000',
    '0011100000011100',
    '0001100000011000',
    '0000110000110000',
    '0000011111100000',
    '0000111111110000',
    '0001111111111000',
    '0000111111110000',
    '0000011111100000',
    '0000110011001100',
    '0001100011000110',
    '0011000011000011',
    '0110000011000011',
    '0110000011000011',
    '0000000000000000',
  ],
  // Bell — large hanging bell shape
  bell: [
    '0000000110000000',
    '0000001111000000',
    '0000011111100000',
    '0000111111110000',
    '0001111111111000',
    '0011111111111100',
    '0011111111111100',
    '0111111111111110',
    '0111111111111110',
    '0111111111111110',
    '0111111111111110',
    '0011111111111100',
    '0001111111111000',
    '0000111111110000',
    '0000001111000000',
    '0000000110000000',
  ],
  // Egg sac — lumpy blob
  egg_sac: [
    '0000000000000000',
    '0000000000000000',
    '0000001111000000',
    '0000111111100000',
    '0001111111110000',
    '0011110111111000',
    '0111111111111100',
    '0111111111111100',
    '0111101111111100',
    '0111111111111100',
    '0011111111111000',
    '0001111111110000',
    '0000111111100000',
    '0000001111000000',
    '0000000000000000',
    '0000000000000000',
  ],
};

// Map body names to silhouette types
const BODY_SIL = {
  knight: 'humanoid', paladin: 'humanoid', ranger: 'humanoid',
  rogue: 'humanoid', mage: 'caster', barbarian: 'humanoid',
  druid: 'humanoid', CombatMech: 'mech', mage_classic: 'caster',
  rogue_hooded: 'humanoid',
  alpaca: 'beast_quad', yetialt: 'humanoid', wolf: 'beast_quad',
  chicken_cow: 'beast_quad',
  wild_boar: 'beast_quad', fox: 'beast_quad', stag: 'stag',
  velociraptor: 'dragon', spider: 'spider', frog: 'frog',
  goblin: 'humanoid', orc: 'humanoid', giant: 'golem',
  golelingevolved: 'golem', dragonevolved: 'dragon',
  ghost: 'ghost', tolling_bell: 'bell', demonalt: 'demon',
  demon: 'demon',
  skeleton_minion: 'skeleton', skeleton_warrior: 'skeleton',
  skeleton_rogue: 'skeleton', skeleton_mage: 'skeleton',
  necromancer: 'caster', skeleton_golem: 'golem',
  stone_cantor: 'humanoid', spider_egg_sac: 'egg_sac',
};

// ---------------------------------------------------------------------------
// Body definitions: name → { height, color, hover }
// ---------------------------------------------------------------------------

const BODIES = {
  knight:           { h: 2.6, color: '#4a7c59' },
  paladin:          { h: 2.6, color: '#c9b98a' },
  ranger:           { h: 2.6, color: '#5a8a4a' },
  rogue:            { h: 2.6, color: '#6b3a32' },
  mage:             { h: 2.6, color: '#6a5acd' },
  barbarian:        { h: 2.6, color: '#8b4513' },
  druid:            { h: 2.6, color: '#2e8b57' },
  CombatMech:       { h: 2.6, color: '#708090' },
  mage_classic:     { h: 2.6, color: '#6a5acd' },
  rogue_hooded:     { h: 2.6, color: '#4a3028' },

  alpaca:           { h: 1.2, color: '#deb887' },
  yetialt:          { h: 2.4, color: '#5a4030' },
  wolf:             { h: 1.6, color: '#808080' },
  chicken_cow:      { h: 2.3, color: '#f5deb3' },

  wild_boar:        { h: 1.45, color: '#8b6914' },
  fox:              { h: 1.0, color: '#d2691e' },
  stag:             { h: 1.9, color: '#a0522d' },
  velociraptor:     { h: 1.8, color: '#2e8b57' },
  spider:           { h: 1.4, color: '#2f2f2f' },
  frog:             { h: 1.7, color: '#3cb371' },
  goblin:           { h: 2.1, color: '#6b8e23' },
  orc:              { h: 2.4, color: '#556b2f' },
  giant:            { h: 2.8, color: '#8b8682' },
  golelingevolved:  { h: 2.2, color: '#4682b4' },
  dragonevolved:    { h: 2.4, color: '#b22222' },
  ghost:            { h: 1.6, color: '#b0c4de', hover: 0.3 },
  tolling_bell:     { h: 3.4, color: '#8b7765' },
  demonalt:         { h: 2.1, color: '#8b0000' },
  demon:            { h: 1.7, color: '#4a0080', hover: 0.35 },

  skeleton_minion:  { h: 2.5, color: '#e8e8d0' },
  skeleton_warrior: { h: 2.5, color: '#d4d4b8' },
  skeleton_rogue:   { h: 2.5, color: '#c8c8b0' },
  skeleton_mage:    { h: 2.5, color: '#bfbfa8' },
  necromancer:      { h: 2.5, color: '#4a4a3a' },
  skeleton_golem:   { h: 3.4, color: '#a0a090' },

  stone_cantor:     { h: 2.6, color: '#708090' },
  spider_egg_sac:   { h: 1.8, color: '#3a3a2a' },
};

// ---------------------------------------------------------------------------
// Weapon definitions: name → { color, shape }
// shape: 'sword' | 'axe' | 'staff' | 'dagger' | 'wand' | 'shield' | 'book'
// ---------------------------------------------------------------------------

const WEAPONS = {
  sword_1handed:            { color: '#c0c0c0', shape: 'sword' },
  axe_1handed:              { color: '#a0a0a0', shape: 'axe' },
  axe_2handed:              { color: '#909090', shape: 'axe' },
  crossbow_1handed:         { color: '#8b4513', shape: 'bow' },
  dagger:                   { color: '#d0d0d0', shape: 'dagger' },
  staff:                    { color: '#654321', shape: 'staff' },
  wand:                     { color: '#9370db', shape: 'wand' },
  spellbook_open:           { color: '#daa520', shape: 'book' },
  skeleton_axe:             { color: '#b0b0a0', shape: 'axe' },
  skeleton_blade:           { color: '#c0c0b0', shape: 'sword' },
  skeleton_shield_large_a:  { color: '#a0a090', shape: 'shield' },
  skeleton_staff:           { color: '#706050', shape: 'staff' },
};

// Weapon pixel maps (16×16)
const WEAPON_SIL = {
  sword: [
    '0000000010000000',
    '0000000111000000',
    '0000000010000000',
    '0000000010000000',
    '0000000010000000',
    '0000000010000000',
    '0000000010000000',
    '0000000010000000',
    '0000000010000000',
    '0000000010000000',
    '0000011111110000',
    '0000000010000000',
    '0000000111000000',
    '0000001101100000',
    '0000011000110000',
    '0000000000000000',
  ],
  axe: [
    '0000011111000000',
    '0000111111100000',
    '0001111001110000',
    '0001110000110000',
    '0000110000100000',
    '0000010000100000',
    '0000010000100000',
    '0000010000100000',
    '0000010000100000',
    '0000010000100000',
    '0000011111100000',
    '0000000010000000',
    '0000000111000000',
    '0000001101100000',
    '0000011000110000',
    '0000000000000000',
  ],
  staff: [
    '0000001111000000',
    '0000011111100000',
    '0000011001100000',
    '0000001111000000',
    '0000000110000000',
    '0000000110000000',
    '0000000110000000',
    '0000000110000000',
    '0000000110000000',
    '0000000110000000',
    '0000000110000000',
    '0000000110000000',
    '0000000110000000',
    '0000001111000000',
    '0000011111100000',
    '0000000000000000',
  ],
  dagger: [
    '0000000011000000',
    '0000000111100000',
    '0000000011000000',
    '0000000011000000',
    '0000000011000000',
    '0000000011000000',
    '0000000011000000',
    '0000000011000000',
    '0000000011000000',
    '0000001111110000',
    '0000000011000000',
    '0000000111000000',
    '0000001101100000',
    '0000000000000000',
    '0000000000000000',
    '0000000000000000',
  ],
  wand: [
    '0000000110000000',
    '0000001111000000',
    '0000000110000000',
    '0000000110000000',
    '0000000110000000',
    '0000000110000000',
    '0000000110000000',
    '0000000110000000',
    '0000000110000000',
    '0000000110000000',
    '0000000110000000',
    '0000000110000000',
    '0000001111000000',
    '0000000000000000',
    '0000000000000000',
    '0000000000000000',
  ],
  book: [
    '0000000000000000',
    '0000111111110000',
    '0001111111111000',
    '0001110000111000',
    '0001110000111000',
    '0001110000111000',
    '0001111111111000',
    '0001110000111000',
    '0001110000111000',
    '0001110000111000',
    '0001111111111000',
    '0000111111110000',
    '0000000000000000',
    '0000000000000000',
    '0000000000000000',
    '0000000000000000',
  ],
  bow: [
    '0000000000110000',
    '0000000001100000',
    '0000000011000000',
    '0000000110000000',
    '0000001100000000',
    '0000011000000000',
    '0000110000000000',
    '0000110000000000',
    '0000011000000000',
    '0000001100000000',
    '0000000110000000',
    '0000000011000000',
    '0000000001100000',
    '0000000000110000',
    '0000000000000000',
    '0000000000000000',
  ],
  shield: [
    '0000000000000000',
    '0000111111110000',
    '0001111111111000',
    '0011111111111100',
    '0011111111111100',
    '0111111111111110',
    '0111111111111110',
    '0111111111111110',
    '0111111111111110',
    '0011111111111100',
    '0011111111111100',
    '0001111111111000',
    '0000111111110000',
    '0000001111000000',
    '0000000000000000',
    '0000000000000000',
  ],
};

// ---------------------------------------------------------------------------
// PNG generation — proper sized PNGs with pixel-art silhouettes
// ---------------------------------------------------------------------------

function parseColor(hex) {
  const h = hex.replace('#', '');
  return {
    r: parseInt(h.substring(0, 2), 16),
    g: parseInt(h.substring(2, 4), 16),
    b: parseInt(h.substring(4, 6), 16),
  };
}

function darken(rgb, factor = 0.6) {
  return {
    r: Math.round(rgb.r * factor),
    g: Math.round(rgb.g * factor),
    b: Math.round(rgb.b * factor),
  };
}

function createPngFromGrid(grid, rgb, rows = 1) {
  const size = grid.length; // 16
  const scale = 8; // 16×8 = 128px per frame
  const frameW = size * scale;
  const frameH = size * scale;
  const outW = frameW;
  const outH = frameH * rows; // stack frames vertically

  // Build raw RGBA pixel data (with filter byte per row)
  const raw = Buffer.alloc((outW * 4 + 1) * outH);
  let ptr = 0;

  for (let oy = 0; oy < outH; oy++) {
    raw[ptr++] = 0; // filter: None
    const frameRow = Math.floor(oy / frameH);
    const sy = Math.floor((oy % frameH) / scale);
    const row = grid[sy];
    for (let ox = 0; ox < outW; ox++) {
      const sx = Math.floor(ox / scale);
      const filled = row[sx] === '1';
      if (filled) {
        // Slight variation: darken edges for depth; different row = slight tint shift
        const edge = sx === 0 || sx === size - 1 || sy === 0 || sy === size - 1;
        const rowShift = frameRow * 0.05;
        const c = edge
          ? darken(rgb, 0.55 - rowShift)
          : { r: Math.min(255, rgb.r + frameRow * 3), g: Math.min(255, rgb.g + frameRow * 2), b: Math.min(255, rgb.b + frameRow) };
        raw[ptr++] = c.r;
        raw[ptr++] = c.g;
        raw[ptr++] = c.b;
        raw[ptr++] = 255;
      } else {
        raw[ptr++] = 0;
        raw[ptr++] = 0;
        raw[ptr++] = 0;
        raw[ptr++] = 0;
      }
    }
  }

  return encodePng(outW, outH, raw);
}

function createWeaponPng(grid, rgb) {
  // Weapon sprites are smaller — 16×16 scaled to 32×32
  const size = 16;
  const scale = 2;
  const outSize = size * scale;

  const raw = Buffer.alloc((outSize * 4 + 1) * outSize);
  let ptr = 0;

  for (let oy = 0; oy < outSize; oy++) {
    raw[ptr++] = 0;
    const sy = Math.floor(oy / scale);
    const row = grid[sy];
    for (let ox = 0; ox < outSize; ox++) {
      const sx = Math.floor(ox / scale);
      const filled = row[sx] === '1';
      if (filled) {
        const edge = sx === 0 || sx === size - 1 || sy === 0 || sy === size - 1;
        const c = edge ? darken(rgb, 0.6) : rgb;
        raw[ptr++] = c.r;
        raw[ptr++] = c.g;
        raw[ptr++] = c.b;
        raw[ptr++] = 255;
      } else {
        raw[ptr++] = 0;
        raw[ptr++] = 0;
        raw[ptr++] = 0;
        raw[ptr++] = 0;
      }
    }
  }

  return encodePng(outSize, outSize, raw);
}

// Minimal PNG encoder (RGBA, no compression library needed)
function encodePng(width, height, rawData) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  function crc32(buf) {
    let c = 0xffffffff;
    const table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let v = n;
      for (let k = 0; k < 8; k++) v = v & 1 ? 0xedb88320 ^ (v >>> 1) : v >>> 1;
      table[n] = v;
    }
    for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  function chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const typeAndData = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(typeAndData));
    return Buffer.concat([len, typeAndData, crc]);
  }

  // IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  // IDAT — stored (uncompressed deflate)
  const blocks = [];
  let offset = 0;
  while (offset < rawData.length) {
    const blockLen = Math.min(rawData.length - offset, 65535);
    const isFinal = offset + blockLen >= rawData.length ? 1 : 0;
    const header = Buffer.alloc(5);
    header[0] = isFinal;
    header.writeUInt16LE(blockLen, 1);
    header.writeUInt16LE(blockLen ^ 0xffff, 3);
    blocks.push(header, rawData.subarray(offset, offset + blockLen));
    offset += blockLen;
  }
  const deflateData = Buffer.concat(blocks);

  // Adler32 checksum
  let s1 = 1, s2 = 0;
  for (let i = 0; i < rawData.length; i++) {
    s1 = (s1 + rawData[i]) % 65521;
    s2 = (s2 + s1) % 65521;
  }
  const adler = Buffer.alloc(4);
  adler.writeUInt32BE(((s2 << 16) | s1) >>> 0);

  const idat = Buffer.concat([deflateData, adler]);

  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// Generate body sprites
// ---------------------------------------------------------------------------

mkdirSync(join(PUBLIC, 'bodies'), { recursive: true });
mkdirSync(join(PUBLIC, 'weapons'), { recursive: true });

let bodyCount = 0;
for (const [name, def] of Object.entries(BODIES)) {
  const rgb = parseColor(def.color);
  const silType = BODY_SIL[name] || 'humanoid';
  const grid = SIL[silType];
  const png = createPngFromGrid(grid, rgb, 5); // 5 animation rows
  writeFileSync(join(PUBLIC, 'bodies', `${name}.png`), png);

  const meta = {
    height: def.h,
    hover: def.hover ?? 0,
    frameWidth: 128,
    frameHeight: 128,
    animations: {
      idle:   { row: 0, frames: 4, fps: 4 },
      walk:   { row: 1, frames: 6, fps: 10 },
      attack: { row: 2, frames: 5, fps: 12 },
      cast:   { row: 3, frames: 5, fps: 10 },
      death:  { row: 4, frames: 4, fps: 6 },
    },
  };
  writeFileSync(join(PUBLIC, 'bodies', `${name}.json`), JSON.stringify(meta, null, 2));
  bodyCount++;
}

// ---------------------------------------------------------------------------
// Generate weapon sprites
// ---------------------------------------------------------------------------

let weaponCount = 0;
for (const [name, def] of Object.entries(WEAPONS)) {
  const rgb = parseColor(def.color);
  const grid = WEAPON_SIL[def.shape] || WEAPON_SIL.sword;
  const png = createWeaponPng(grid, rgb);
  writeFileSync(join(PUBLIC, 'weapons', `${name}.png`), png);

  const offset = {
    bone: 'handslot.r',
    offsetX: 0.3,
    offsetY: -0.1,
    scale: 0.5,
  };
  const meta = {
    height: 0.5,
    frameWidth: 32,
    frameHeight: 32,
    animations: {
      idle:   { row: 0, frames: 4, fps: 4 },
      walk:   { row: 0, frames: 4, fps: 4 },
      attack: { row: 0, frames: 5, fps: 12 },
      cast:   { row: 0, frames: 5, fps: 10 },
      death:  { row: 0, frames: 4, fps: 6 },
    },
    weaponSlot: offset,
  };
  writeFileSync(join(PUBLIC, 'weapons', `${name}.json`), JSON.stringify(meta, null, 2));
  weaponCount++;
}

console.log(`Generated ${bodyCount} body sprites + ${weaponCount} weapon sprites in public/sprites/`);
console.log('Body sprites: 128×640 pixel-art silhouettes (16×16 grid, 8× scale, 5 animation rows)');
console.log('Weapon sprites: 32×32 pixel-art icons (16×16 grid, 2× scale)');
