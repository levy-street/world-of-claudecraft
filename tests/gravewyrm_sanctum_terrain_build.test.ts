// The Sanctum's REAL ground and gates, built the way the interior builds them
// (sanctum_interior.ts: buildSanctumTerrain then buildSanctumGates), on both
// material tiers. Two things only the built meshes can show:
//
//  - the frost wear really lands in the terrain's own top batches. The merge
//    (sanctum_surface_wear.ts) drops the wear without failing when the top
//    and the wear stop sharing an attribute layout, so a synthetic mesh
//    proves nothing about the shipped tops.
//  - the chain bridge's ice crust draws with the SAME material instance as
//    the field's ice tops. The crust builds its surfaceMat from the GFX
//    global and the field from the interior's lowGfx flag; they meet only
//    while the two option sets stay equal, and a crust that drifted would
//    link a program of its own on the frame the bridge opens.
//
// The field's detail textures are baked on a canvas, so the suite stands a
// bare canvas in for the DOM: the real bake, cache and texture identity run.

import * as THREE from 'three';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { gfxInternalsForTest } from '../src/render/gfx';
import { buildSanctumGates } from '../src/render/gravewyrm_sanctum/sanctum_gates';
import { sanctumGround } from '../src/render/gravewyrm_sanctum/sanctum_plan_core';
import { planSanctumSurfaceWear } from '../src/render/gravewyrm_sanctum/sanctum_surface_wear_core';
import { buildSanctumTerrain } from '../src/render/gravewyrm_sanctum/sanctum_terrain';

// Only the gates' canvas glow sprite needs a substitute (a gradient fill the
// bare canvas below does not model); the geometry, the rigs and the crust's
// production material are the real ones.
vi.mock('../src/render/textures', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/render/textures')>()),
  radialGlowTexture: () => new THREE.Texture(),
}));

type Top = THREE.Mesh<THREE.BufferGeometry, THREE.Material>;

const globals = globalThis as { document?: unknown };
const hadDocument = 'document' in globals;
const previousDocument = globals.document;

beforeAll(() => {
  globals.document = {
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => ({
        createImageData: (w: number, h: number) => ({
          width: w,
          height: h,
          data: new Uint8ClampedArray(w * h * 4),
        }),
        putImageData: () => {},
      }),
    }),
  };
});

afterAll(() => {
  if (hadDocument) globals.document = previousDocument;
  else delete globals.document;
});

function top(terrain: THREE.Group, family: string): Top {
  const mesh = terrain.getObjectByName(`fieldTop:${family}`);
  if (!(mesh instanceof THREE.Mesh)) throw new Error(`no fieldTop:${family}`);
  return mesh as Top;
}

/** Build one tier's ground and gates with the tier's own material switch. */
function build(standardMaterials: boolean): { terrain: THREE.Group; gates: THREE.Group } {
  const restore = gfxInternalsForTest.overrideSettings({ standardMaterials });
  try {
    // The renderer derives the interiors' flag from the same setting.
    const terrain = buildSanctumTerrain(!standardMaterials);
    const gates = buildSanctumGates(0, 0, sanctumGround);
    return { terrain, gates };
  } finally {
    restore();
  }
}

describe.each([
  ['standard', true],
  ['low', false],
] as const)('the built Sanctum ground on the %s tier', (_tier, standardMaterials) => {
  it('grows each worn top by exactly its frost wear, appended to the same batch', () => {
    const { terrain } = build(standardMaterials);
    const plan = planSanctumSurfaceWear();
    expect(plan.map((wear) => wear.family)).toEqual(['snow', 'ice']);
    for (const wear of plan) {
      expect(wear.positions.length, wear.family).toBeGreaterThan(900);
      const mesh = top(terrain, wear.family);
      const position = mesh.geometry.getAttribute('position');
      const worn = wear.positions.length / 3;
      // More than the wear alone: the field's own floor is still under it.
      expect(position.count, wear.family).toBeGreaterThan(worn + 1000);
      expect(mesh.geometry.getIndex(), wear.family).toBeNull();
      // The wear is the tail of the batch, vertex for vertex (single
      // precision: the plan is planned in doubles, the buffer is a Float32).
      const first = position.count - worn;
      for (const k of [0, 1, 2, Math.floor(worn / 2), worn - 2, worn - 1]) {
        for (const [axis, read] of [
          [0, position.getX(first + k)],
          [1, position.getY(first + k)],
          [2, position.getZ(first + k)],
        ] as const) {
          expect(read, `${wear.family} vertex ${k}`).toBe(
            Math.fround(wear.positions[k * 3 + axis]),
          );
        }
      }
      // Every attribute the top carried still covers the grown batch.
      for (const name of ['color', 'uv', 'normal']) {
        expect(mesh.geometry.getAttribute(name)?.count, `${wear.family} ${name}`).toBe(
          position.count,
        );
      }
    }
  });

  it('draws the chain bridge crust with the ice tops own material instance', () => {
    const { terrain, gates } = build(standardMaterials);
    const crust = gates.getObjectByName('sanctumChainBridgeCrust');
    if (!(crust instanceof THREE.Mesh)) throw new Error('no chain bridge crust');
    const ice = top(terrain, 'ice');
    expect(crust.material).toBe(ice.material);
    // The tier switch really took: a Lambert on low, a Standard above it.
    expect((ice.material as THREE.Material).type).toBe(
      standardMaterials ? 'MeshStandardMaterial' : 'MeshLambertMaterial',
    );
    // And the snow top is a different batch, so the identity above is not
    // just one material shared by everything.
    expect(top(terrain, 'snow').material).not.toBe(ice.material);
  });
});

it('keeps the two tiers on separate ice materials', () => {
  const standard = top(build(true).terrain, 'ice').material;
  const low = top(build(false).terrain, 'ice').material;
  expect(standard).not.toBe(low);
});
