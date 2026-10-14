// The Biome panel's automatic-texturing switches must actually reach the
// terrain (SPACEY, 2026-09-21: "its forcing me to use the angle based textures
// ... so i can paint over the current textures completly").
//
// They never did: MapDoc.terrainStyle.slopeRock / snowCaps / shoreSand were
// written by the editor, carried through the sanitizer, and read by NOTHING in
// the renderer, so the checkboxes were inert and a painter could not stop the
// slope rule re-tinting every cliff they covered. The rules are resolved once
// per chunk in beginChunkGeometry and gate the arms in sampleVertex.
import { afterEach, describe, expect, it } from 'vitest';
import { beginChunkGeometry, fillChunkVertexRow } from '../src/render/terrain_chunk_build';
import { BUILTIN_WORLD, setActiveWorldContent } from '../src/sim/data';
import type { TerrainStyle, WorldContent } from '../src/sim/types';

const SEED = 20061;

/** Summed splat weights over one chunk of the shipped heightfield.
 *  Every arm runs on a CLONE of the builtin world, never the builtin itself:
 *  terrain_chunk_build branches on isBuiltinWorldActive(), so comparing a
 *  clone against the real thing would confound the flag under test. */
function splatTotals(style: TerrainStyle | undefined, x0: number, z0: number) {
  const world = { ...BUILTIN_WORLD } as WorldContent;
  if (style) world.terrainStyle = style;
  else world.terrainStyle = undefined;
  setActiveWorldContent(world);
  const state = beginChunkGeometry(x0, z0, 60, 1.2, SEED, true, 2.6, false);
  for (let row = 0; row < state.gh; row++) fillChunkVertexRow(state, row);
  const splats = state.splats as Float32Array;
  let grass = 0;
  let dirt = 0;
  let rock = 0;
  let sand = 0;
  for (let i = 0; i < splats.length; i += 4) {
    grass += splats[i];
    dirt += splats[i + 1];
    rock += splats[i + 2];
    sand += splats[i + 3];
  }
  return { grass, dirt, rock, sand };
}

afterEach(() => setActiveWorldContent(null));

describe('terrainStyle switches reach the terrain build', () => {
  // A stretch of the shipped world with real relief, so the slope rule fires.
  const STEEP = { x: 120, z: 900 };

  it('slopeRock off removes the angle-derived rock', () => {
    const on = splatTotals(undefined, STEEP.x, STEEP.z);
    const off = splatTotals({ slopeRock: false }, STEEP.x, STEEP.z);
    expect(on.rock).toBeGreaterThan(0);
    expect(off.rock).toBeLessThan(on.rock);
    // and the ground it was covering goes back to the base layers
    expect(off.grass + off.dirt).toBeGreaterThan(on.grass + on.dirt);
  });

  it('an absent style and an all-on style build identically (default is ON)', () => {
    const absent = splatTotals(undefined, STEEP.x, STEEP.z);
    const allOn = splatTotals(
      { slopeRock: true, snowCaps: true, shoreSand: true },
      STEEP.x,
      STEEP.z,
    );
    expect(allOn).toEqual(absent);
  });

  it('each switch is independent', () => {
    const on = splatTotals(undefined, STEEP.x, STEEP.z);
    const noSnow = splatTotals({ snowCaps: false }, STEEP.x, STEEP.z);
    // snowCaps also owns the high-elevation rock band, so dropping it can only
    // reduce rock, never add it.
    expect(noSnow.rock).toBeLessThanOrEqual(on.rock);
    // The channels are a blend, not independent adds: lerpSplat pulls weight
    // OFF the others to lay rock down, so dropping the slope rule hands that
    // weight back rather than leaving a hole. Total cover is conserved.
    const noSlope = splatTotals({ slopeRock: false }, STEEP.x, STEEP.z);
    expect(noSlope.sand).toBeGreaterThanOrEqual(on.sand);
    const total = (t: typeof on) => t.grass + t.dirt + t.rock + t.sand;
    expect(total(noSlope)).toBeCloseTo(total(on), 3);
  });
});
