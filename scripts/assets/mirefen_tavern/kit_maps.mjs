// The Mirefen tavern's colour maps in the look of the hand-built painted kit, the look every
// building of Fenbridge beside it wears now (scripts/assets/eastbrook_houses/, the `moss` set).
// Deterministic; run once, by hand, after the kit's sheets have been prepared (any
// `build.py -- --sets` run of a moss lot writes the two it reads under
// tmp/eastbrook_houses/painted/: `stone.png`, the rubble every set shares, and
// `moss/slate.png`, the moss set's own slates):
//
//   node scripts/assets/mirefen_tavern/kit_maps.mjs
//   node scripts/assets/mirefen_tavern/build.mjs
//
// The tavern keeps its own model: its plan, walls, timbers, floors and seats are untouched,
// and so are its tints (inn_kit.py: each close to 1, the map as painted). Only what three of
// its maps say changes:
//   - TownStone and TownRoof are the kit's own rubble and slates for the moss set. The town
//     buildings draw those sheets under the moss set's tones (build.py COLOUR_SETS, in
//     linear light: the stone at (0.8, 0.86, 0.78), the slates at (0.5, 0.56, 0.5)), and
//     the tavern's own shading darkens a wall further (its builders shade every sheet and
//     bake the room's light), so each copy carries the tone that makes the two draw alike
//     in the game: the slates the moss set's own, the stone a little lighter than the
//     set's. They are new paintings, not regrades, so the old maps' normal maps no longer
//     fit them: textures.json drops both.
//   - TownTimber keeps the brushwork it had (and its normal map, which still fits it) and is
//     regraded, brightness for brightness, to the kit's red oak: a three-stop ramp off the
//     kit timber tile's posts, a shade darker than the town's, because the common room's
//     timbers stand against limewash by firelight.
//   - TownPlaster, TownFloor, TownDressed, TownCloth and the props atlas are not touched. The
//     kit's own limewash, planks and dressed stone were tried on them and stood in the game
//     beside the maps the tavern had: outside the two looked equally good, in the common
//     room the kit's looked worse (the hall turned one warm colour), so the room keeps its
//     pale limewash, its brown boards and its grey dressed stone.
// The regrade reads the map the tavern shipped before this pass, out of git (SOURCE_REV), so
// a second run gives the same bytes.
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const HERE = 'scripts/assets/mirefen_tavern';
const KIT = path.join(ROOT, 'tmp/eastbrook_houses/painted');
/** The release the regraded maps are read from (release/v0.46.0). */
const SOURCE_REV = '18c275b17c87d79268fa2ca4b14678dfb139491f';

const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toSrgb = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);
const clamp = (v) => Math.min(1, Math.max(0, v));
/** An sRGB colour under a tone in linear light. */
const toned = (rgb, tone) => rgb.map((c, k) => clamp(toSrgb(toLinear(c) * tone[k])));
const lerp = (a, b, t) => a + (b - a) * t;

async function write(name, pixels, width, height) {
  const out = path.join(ROOT, HERE, 'tex', name);
  await sharp(pixels, { raw: { width, height, channels: 3 } })
    .jpeg({ quality: 92 })
    .toFile(out);
  console.log(`wrote ${HERE}/tex/${name}`);
}

/** One of the kit's own sheets under the tone the town draws it with. */
async function kitSheet(sheet, tone, out) {
  const { data, info } = await sharp(path.join(KIT, sheet))
    .removeAlpha()
    .resize(1024, 1024)
    .raw()
    .toBuffer({ resolveWithObject: true });
  const pixels = Buffer.alloc(data.length);
  for (let i = 0; i < data.length; i++) {
    pixels[i] = Math.round(clamp(toSrgb(toLinear(data[i] / 255) * tone[i % 3])) * 255);
  }
  await write(out, pixels, info.width, info.height);
}

/** A map the tavern shipped, its brightness remapped through a ramp of the kit's colours. */
async function regrade(file, ramp, tone, gamma = 1.0) {
  const source = execFileSync('git', ['show', `${SOURCE_REV}:${HERE}/tex/${file}`], {
    cwd: ROOT,
    maxBuffer: 1 << 26,
  });
  const { data, info } = await sharp(source)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const n = info.width * info.height;
  const L = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    L[i] = (0.3 * data[i * 3] + 0.55 * data[i * 3 + 1] + 0.15 * data[i * 3 + 2]) / 255;
  }
  const sorted = Float32Array.from(L).sort();
  const p2 = sorted[Math.floor(n * 0.02)];
  const p98 = sorted[Math.floor(n * 0.98)];
  const [lo, mid, hi] = ramp.map((rgb) => toned(rgb, tone));
  const pixels = Buffer.alloc(n * 3);
  for (let i = 0; i < n; i++) {
    const t = clamp((L[i] - p2) / (p98 - p2)) ** gamma;
    for (let k = 0; k < 3; k++) {
      const c = t < 0.5 ? lerp(lo[k], mid[k], t * 2) : lerp(mid[k], hi[k], (t - 0.5) * 2);
      pixels[i * 3 + k] = Math.round(clamp(c) * 255);
    }
  }
  await write(file, pixels, info.width, info.height);
}

// The tone each of the kit's sheets carries here (linear light). The moss set draws the
// shared rubble at (0.8, 0.86, 0.78) and its own slates at (0.5, 0.56, 0.5) (build.py
// COLOUR_SETS). The tavern's shading takes about a fifth more off a wall than the town
// buildings' does, so its stone carries the set's tone lifted by 0.96 / 0.86, the lift that
// stood the two alike in the game; its roof takes the full sky as theirs do and carries the
// set's slate tone as it is.
const MOSS_STONE = [0.8, 0.86, 0.78];
const MOSS_SLATE = [0.5, 0.56, 0.5];
const STONE_TONE = MOSS_STONE.map((c) => (c * 0.96) / 0.86);
const PLAIN = [1, 1, 1];

await kitSheet('stone.png', STONE_TONE, 'TownStone_Color.jpg');
await kitSheet(path.join('moss', 'slate.png'), MOSS_SLATE, 'TownRoof_Color.jpg');
// the timber tile's posts, a shade darker: deep red-brown oak, lit to amber along its edges
await regrade(
  'TownTimber_Color.jpg',
  [
    [0.13, 0.06, 0.055],
    [0.33, 0.155, 0.12],
    [0.52, 0.3, 0.17],
  ],
  PLAIN,
);
