// The kit-detail pass (scripts/assets/blender_tidehold/bl_build_common.py,
// detail_kit) lifts the medieval kit's FLAT palette faces onto two tiling
// materials and carries the original atlas swatch in COLOR_0, which three
// multiplies over the detail map. Two things have to hold for the city's
// palette to survive that, and both failed at least once while it was built:
//
//   1. Every WocKitTimber / WocKitStone primitive carries COLOR_0. The
//      installer used to strip vertex colours off everything but `*_stone`,
//      which would have shipped raw grey-brown detail maps with no tint.
//   2. Every tint is a colour the classifier would actually have chosen.
//      ChurchTower_03 is genuinely UV-mapped rather than palette-mapped, so
//      sampling a face's UV centroid returned nonsense: its spire cones were
//      classified as timber, tinted PURE ORANGE, and then escaped
//      bl_castle.py's own retint_roof(), the castle shipped terracotta
//      spires. A saturation check on the shipped tints catches that class of
//      bug whatever causes it.
//
// The test looks at saturation and channel ORDER only, never brightness:
// vertex AO and _weather_stone multiply into the same attribute, and a
// darkening multiply leaves both of those alone.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { describe, expect, it } from 'vitest';

const BUILDINGS = [
  'tavern',
  'tavern_b',
  'bank',
  'market',
  'smithy',
  'hall',
  'castle',
  'castle_b',
  'house_a',
  'house_b',
  'house_c',
  'house_d',
  'house_e',
];

type Tint = { rgb: [number, number, number]; sat: number };

const toSrgb = (v: number) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);

/** COLOR_0 is LINEAR and carries whatever AO and _weather_stone multiplied in,
 *  so normalise by the max channel (which removes any scalar darkening) and
 *  read the hue back in sRGB, the space the classifier's own thresholds were
 *  measured in. Saturation is not invariant under a linear multiply once
 *  gamma is involved, so doing this in the raw linear values would reject the
 *  kit's ordinary browns. */
function tint(rgb: [number, number, number]): Tint {
  const mx = Math.max(...rgb);
  if (mx <= 1e-5) return { rgb, sat: 0 };
  const s = rgb.map((v) => toSrgb(v / mx)) as [number, number, number];
  return { rgb: s, sat: 1 - Math.min(...s) / Math.max(...s) };
}

/** The kit's timber ramp normalises to saturation 0.55-0.70; the terracotta
 *  roof tiles and the church spire's pure orange land at 0.9-1.0, which is
 *  exactly the mistake this guards against. The same swatch on a roof piece
 *  is the slate RETINT of it, which inverts the channel order. */
function timberOk(t: Tint): boolean {
  const [r, g, b] = t.rgb;
  if (r >= g && g >= b) return t.sat >= 0.35 && t.sat <= 0.85;
  if (b >= g && g >= r) return t.sat <= 0.6; // _roof_retint_rgb output
  return false;
}

/** Masonry is the kit's neutrals plus the chimney's pale tan (0.30 here);
 *  _weather_stone's damp gradient shifts it a little further. */
function stoneOk(t: Tint): boolean {
  return t.sat <= 0.5;
}

describe('tidehold kit detail tints', () => {
  it('ships a plausible palette swatch on every retextured face', async () => {
    await MeshoptDecoder.ready;
    const io = new NodeIO()
      .registerExtensions(ALL_EXTENSIONS)
      .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
    const missing: string[] = [];
    const wrong: string[] = [];
    let checked = 0;

    for (const name of BUILDINGS) {
      const path = resolve(`public/models/tidehold/${name}.glb`);
      const doc = await io.readBinary(new Uint8Array(readFileSync(path)));
      for (const mesh of doc.getRoot().listMeshes()) {
        for (const prim of mesh.listPrimitives()) {
          const mat = prim.getMaterial()?.getName() ?? '';
          const kind = mat.startsWith('WocKitTimber')
            ? 'timber'
            : mat.startsWith('WocKitStone')
              ? 'stone'
              : null;
          if (!kind) continue;
          const col = prim.getAttribute('COLOR_0');
          if (!col) {
            missing.push(`${name}: ${mat}`);
            continue;
          }
          // One entry per distinct tint: a building carries a handful, and
          // walking every vertex of castle B would dominate the suite.
          const seen = new Set<string>();
          const e = [0, 0, 0, 0];
          for (let i = 0; i < col.getCount(); i++) {
            col.getElement(i, e);
            const key = e
              .slice(0, 3)
              .map((v) => Math.round(v * 200))
              .join(',');
            if (seen.has(key)) continue;
            seen.add(key);
            // Near-black tints carry no recoverable hue: COLOR_0 ships as 8
            // bits, so a deeply occluded dark brown quantises to something
            // like (5, 2, 0)/255 and reads as saturation 1.0 whatever it
            // started as. The mistake this guards against, a pure orange
            // roof/spire swatch, is BRIGHT, so gate on the max channel.
            if (Math.max(e[0], e[1], e[2]) < 0.04) continue;
            const t = tint([e[0], e[1], e[2]]);
            checked++;
            const ok = kind === 'timber' ? timberOk(t) : stoneOk(t);
            if (!ok) {
              wrong.push(
                `${name}: ${mat} tint rgb(${t.rgb.map((v) => v.toFixed(3)).join(', ')}) sat ${t.sat.toFixed(2)}`,
              );
            }
          }
        }
      }
    }

    expect(missing, 'retextured primitives with no COLOR_0 tint').toEqual([]);
    expect(wrong.slice(0, 12), 'tints outside the classifier bands').toEqual([]);
    expect(checked).toBeGreaterThan(50);
  }, 120_000);
});
