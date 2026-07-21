// Style-reference boards: 2x2 renders of REPRESENTATIVE SHIPPED assets, fed to
// gpt-image-2 (images/edits reference inputs) alongside every concept prompt so
// generated concepts match the game's KayKit/Quaternius art style by default
// (flat-shaded low-poly, chibi proportions, hand-painted flat colors) instead
// of relying on style words alone.
//
// Boards are cached under tmp/asset_pipeline/style_refs/ and rebuilt only when
// missing (shipped assets rarely change; delete the dir to force a rebuild).
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from './env.mjs';
import { renderThumb } from './preview.mjs';

const REFS_DIR = join(REPO_ROOT, 'tmp/asset_pipeline/style_refs');

// Four on-style exemplars per category; characters double as the chibi
// proportion reference for creature/skin concepts.
const BOARD_SPECS = {
  weapon: [
    'public/models/weapons/sword_a.glb',
    'public/models/weapons/axe_b.glb',
    'public/models/weapons/staff_c.glb',
    'public/models/weapons/adv_dagger.glb',
  ],
  prop: [
    'public/models/props/barrel.glb',
    'public/models/props/well.glb',
    'public/models/props/cart.glb',
    'public/models/props/gravestone_decorative.glb',
  ],
  character: [
    'public/models/chars/players/knight.glb',
    'public/models/chars/players/mage.glb',
    'public/models/chars/players/barbarian.glb',
    'public/models/creatures/goblin.glb',
  ],
};

/** Build (or reuse) the style board PNG for a category. Returns its path, or
 *  null when the category has no board spec. */
export async function styleBoard(category) {
  const key = category === 'creature' || category === 'skinmodel' ? 'character' : category;
  const spec = BOARD_SPECS[key];
  if (!spec) return null;
  mkdirSync(REFS_DIR, { recursive: true });
  const out = join(REFS_DIR, `${key}.png`);
  if (existsSync(out)) return out;

  const sharp = (await import('sharp')).default;
  const cell = 384;
  const tiles = [];
  for (let i = 0; i < spec.length; i++) {
    const thumb = join(REFS_DIR, `${key}_${i}.png`);
    if (!existsSync(thumb)) await renderThumb(join(REPO_ROOT, spec[i]), thumb, { size: cell });
    tiles.push({
      input: await sharp(thumb)
        .resize(cell, cell, { fit: 'contain', background: { r: 245, g: 245, b: 245, alpha: 1 } })
        .png()
        .toBuffer(),
      top: Math.floor(i / 2) * cell,
      left: (i % 2) * cell,
    });
  }
  await sharp({
    create: {
      width: cell * 2,
      height: cell * 2,
      channels: 3,
      background: { r: 245, g: 245, b: 245 },
    },
  })
    .composite(tiles)
    .png()
    .toFile(out);
  return out;
}

/** The instruction that frames the board for gpt-image-2: style guide only,
 *  never content to copy. */
export const STYLE_REF_INSTRUCTION =
  'The first attached image is an ART-STYLE REFERENCE SHEET from the game (low-poly, ' +
  'flat-shaded, hand-painted flat colors, chunky rounded shapes, KayKit style). Match that ' +
  'art style EXACTLY. Do not copy the reference objects themselves.';
