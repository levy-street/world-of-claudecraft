import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { sunDirection } from '../src/render/day_night_core';
import {
  IMPOSTOR_ATLAS_BUDGET,
  IMPOSTOR_ATLAS_MAX,
  IMPOSTOR_CATEGORY_VIEWS,
  IMPOSTOR_CATEGORY_WIND,
  IMPOSTOR_CELL_PX,
  IMPOSTOR_JITTER_GLSL,
  IMPOSTOR_MIN_BAND,
  IMPOSTOR_NORMAL_FAN,
  IMPOSTOR_NORMAL_GLSL,
  IMPOSTOR_NORMAL_TILT,
  IMPOSTOR_ROW_BUDGET,
  IMPOSTOR_SWAP_FADE,
  type ImpostorArchetypeSpec,
  impostorSpriteNormal,
  packImpostorAtlas,
  SPRITE_MIN_FOG_BLEND,
  SPRITE_SWAP_BUDGET,
  SPRITE_SWAP_MIN,
  shippedImpostorInventory,
  spriteSwapDistance,
  spriteSwapFloor,
} from '../src/render/foliage_impostor_core';
import {
  fogBlendAt,
  foliageDistanceScale,
  foliageFogLimit,
  LOD_HIGH,
} from '../src/render/foliage_lod';

function spec(over: Partial<ImpostorArchetypeSpec> = {}): ImpostorArchetypeSpec {
  return {
    id: 'pine:0',
    worldWidth: 6,
    worldHeight: 9,
    worldBaseY: -0.2,
    views: 12,
    cellPx: 128,
    ...over,
  };
}

// The production inventory: shippedImpostorInventory() is every category at
// its FULL row budget with its shipped views and cell sizes, the same
// tables the live session registers against (registerArchetype throws past
// a category budget, so a real world can never register more rows than
// this set packs). Driving the capacity assertions from it means a cell,
// view or budget change here is a change to the verified atlas.
const shippedSet = shippedImpostorInventory;

describe('impostor atlas packing', () => {
  it('packs the full production inventory into EXACTLY the atlas budget', () => {
    // 2048 is a memory number, not a convenience: the resident mip chain is
    // about 21 MiB there and 85 MiB at 4096. If a kit change makes this
    // throw or mint 4096, shrink cells or views (or raise the budget with
    // measured peak-memory evidence), never delete the assertion.
    const placement = packImpostorAtlas(shippedSet(), IMPOSTOR_ATLAS_BUDGET);
    expect(placement.size).toBe(2048);
    expect(IMPOSTOR_ATLAS_BUDGET).toBeLessThanOrEqual(IMPOSTOR_ATLAS_MAX);
    expect(Math.log2(placement.size) % 1).toBe(0);
  });

  it('carries the shipped category tables the session registers against', () => {
    // The inventory must stay the WORST case of what registerArchetype
    // admits: every category present, at its full budget, at the live
    // views/cell tables.
    const specs = shippedSet();
    for (const category of ['tree', 'rock', 'dress', 'building'] as const) {
      const rows = specs.filter((s) => s.id.startsWith(`${category}:`));
      expect(rows).toHaveLength(IMPOSTOR_ROW_BUDGET[category]);
      for (const row of rows) {
        expect(row.views).toBe(IMPOSTOR_CATEGORY_VIEWS[category]);
        expect(row.cellPx).toBe(IMPOSTOR_CELL_PX[category]);
      }
    }
    // the real kit's exact foliage counts (fixed variant lists); buildings
    // are a cap with headroom over the MEASURED live inventory: 44 unique
    // assets registered by collectBuildingImpostors on the shipped world
    // (pools, per-kind entries, bell tower, every skyline decor prop 7u+).
    // The first cap here (16) was taken from a stale fixture and threw in
    // the live session, which the fail-soft turned into a sprite-less far
    // field: a budget below the real count is a shipped regression, not a
    // tight bound.
    expect(IMPOSTOR_ROW_BUDGET.tree).toBe(15);
    expect(IMPOSTOR_ROW_BUDGET.rock).toBe(8);
    expect(IMPOSTOR_ROW_BUDGET.dress).toBe(2);
    expect(IMPOSTOR_ROW_BUDGET.building).toBeGreaterThanOrEqual(44 + 2);
  });

  it('rigid categories take HARD ZERO wind; sway parity for the living ones', () => {
    // The #2793 review defect: every non-rock non-tree category inherited
    // the 0.096 bush amplitude, so village houses swayed like shrubs.
    expect(IMPOSTOR_CATEGORY_WIND.building).toBe(0);
    expect(IMPOSTOR_CATEGORY_WIND.rock).toBe(0);
    // parity numbers with the real canopies (TREE_WIND_STRENGTH and the
    // bush windMul in foliage.ts)
    expect(IMPOSTOR_CATEGORY_WIND.tree).toBeCloseTo(0.08, 10);
    expect(IMPOSTOR_CATEGORY_WIND.dress).toBeCloseTo(0.096, 10);
  });

  it('gives every archetype a full row of non-overlapping view cells in bounds', () => {
    const specs = shippedSet();
    const placement = packImpostorAtlas(specs, IMPOSTOR_ATLAS_MAX);
    const boxes: { x0: number; y0: number; x1: number; y1: number }[] = [];
    specs.forEach((s, i) => {
      const rect = placement.origin[i];
      expect(rect, s.id).toBeDefined();
      const cellW = rect.u1 - rect.u0;
      const cellH = rect.v1 - rect.v0;
      // square cells at the requested pixel size
      expect(cellW * placement.size).toBeCloseTo(s.cellPx, 6);
      expect(cellH * placement.size).toBeCloseTo(s.cellPx, 6);
      // the whole view strip stays inside the atlas
      const stripEnd = rect.u0 + s.views * cellW;
      expect(stripEnd, `${s.id} strip`).toBeLessThanOrEqual(1 + 1e-9);
      expect(rect.v1).toBeLessThanOrEqual(1 + 1e-9);
      boxes.push({
        x0: rect.u0,
        y0: rect.v0,
        x1: stripEnd,
        y1: rect.v1,
      });
    });
    for (let a = 0; a < boxes.length; a++) {
      for (let b = a + 1; b < boxes.length; b++) {
        const A = boxes[a];
        const B = boxes[b];
        const overlaps =
          A.x0 < B.x1 - 1e-9 && B.x0 < A.x1 - 1e-9 && A.y0 < B.y1 - 1e-9 && B.y0 < A.y1 - 1e-9;
        expect(overlaps, `${specs[a].id} vs ${specs[b].id}`).toBe(false);
      }
    }
  });

  it('is deterministic in input order', () => {
    const a = packImpostorAtlas(shippedSet(), IMPOSTOR_ATLAS_MAX);
    const b = packImpostorAtlas(shippedSet(), IMPOSTOR_ATLAS_MAX);
    expect(a).toEqual(b);
  });

  it('throws loudly when a grown kit cannot fit, instead of cropping', () => {
    const oversized = Array.from({ length: 80 }, (_, i) => spec({ id: `tree:${i}` }));
    expect(() => packImpostorAtlas(oversized, 2048)).toThrow(/cannot fit/);
  });
});

describe('sprite swap law', () => {
  const scaleAt = (q: number) => foliageDistanceScale(q, false);
  const base = LOD_HIGH.treeDetailFar;

  it('follows the budget in the open realms: no fog floor pushes it out', () => {
    // Vale: near 55, far 700. The old cone law parked the swap at ~506u to
    // hide the cones; the sprite law hands off inside the budgeted radius
    // (SPRITE_SWAP_BUDGET of it) and the sprites carry the rest.
    const fogLimit = foliageFogLimit(700, 1);
    expect(spriteSwapDistance(base, scaleAt(1), 55, 700, fogLimit)).toBeCloseTo(234, 9);
    expect(spriteSwapDistance(base, scaleAt(0), 55, 700, fogLimit)).toBeCloseTo(168.48, 9);
  });

  it('spends only part of the budgeted radius, since the tree keeps being drawn', () => {
    // The saving is quadratic in the radius, which is the whole point: the
    // ring this gives up is a much larger share of the disc's AREA (and so of
    // the real-model triangle count) than of its reach.
    const fogLimit = foliageFogLimit(700, 1);
    const budgeted = base * scaleAt(1);
    const swap = spriteSwapDistance(base, scaleAt(1), 55, 700, fogLimit);
    expect(SPRITE_SWAP_BUDGET).toBeLessThan(1);
    expect(swap).toBeCloseTo(budgeted * SPRITE_SWAP_BUDGET, 9);
    // over a third of the real-model disc handed to 2-triangle sprites
    expect(1 - (swap / budgeted) ** 2).toBeGreaterThan(0.35);
    // and never inside the authors' own clear-air floor
    expect(swap).toBeGreaterThan(SPRITE_SWAP_MIN);
  });

  it('never hands off closer than the clear-air floor', () => {
    // A pathological budget cannot put a flat sprite 90u from the camera in
    // clear air; the floor holds at SPRITE_SWAP_MIN there.
    const fogLimit = foliageFogLimit(700, 1);
    expect(spriteSwapDistance(base, 0.3, 55, 700, fogLimit)).toBe(SPRITE_SWAP_MIN);
  });

  it('the floor yields to the murk: heavy fog may swap arbitrarily close', () => {
    // Marsh: near 75, far 165. At the 50 percent blend line (120u) the
    // parallax flatness the floor exists for is already mush.
    expect(spriteSwapFloor(75, 165)).toBe(75 + SPRITE_MIN_FOG_BLEND * 90);
    const fogLimit = foliageFogLimit(165, 1);
    const swap = spriteSwapDistance(base, scaleAt(1), 75, 165, fogLimit);
    expect(swap).toBeLessThan(fogLimit); // a sprite band exists
    expect(fogBlendAt(swap, 75, 165)).toBeGreaterThanOrEqual(SPRITE_MIN_FOG_BLEND - 1e-9);
  });

  it('short-fog realms keep a guaranteed sprite band before the cull', () => {
    for (const [near, far] of [
      [75, 165], // marsh
      [48, 125], // cave
      [85, 265], // haunt
    ] as const) {
      for (const q of [0, 0.5, 1]) {
        const fogLimit = foliageFogLimit(far, q);
        const swap = spriteSwapDistance(base, scaleAt(q), near, far, fogLimit);
        expect(swap, `near ${near} far ${far} q ${q}`).toBeLessThan(fogLimit);
        expect(fogLimit - swap).toBeGreaterThan(0);
        // the band never grows past what the floor law leaves available
        expect(fogLimit - swap).toBeLessThanOrEqual(
          Math.max(IMPOSTOR_MIN_BAND, fogLimit - spriteSwapFloor(near, far)) + 1e-9,
        );
      }
    }
  });

  it('a residency fog wall parks the handoff on the wall: no sprites in the lap', () => {
    // The live clamp can pin the cull at 45u while a zone builds; the final
    // clamp keeps real trees to the wall rather than swapping at the floor.
    const liveCull = foliageFogLimit(45, 1);
    expect(spriteSwapDistance(base, scaleAt(1), 175, 628, liveCull)).toBe(liveCull);
  });

  it('a malformed near-past-far pair still cannot pass the cull', () => {
    expect(spriteSwapDistance(base, 1, 175, 45, foliageFogLimit(45, 1))).toBe(
      foliageFogLimit(45, 1),
    );
  });

  it('never exceeds the budgeted radius, so near-fill needs no law of its own', () => {
    // placeSpecies folds the near-fill trees into the shared tree sprites.
    // That is sound because the swap can never pass the near-fill authored
    // cap: swap <= base * scale, and the tables author the detail base under
    // the near-fill cap (both scale by the same governor lever).
    expect(LOD_HIGH.treeDetailFar).toBeLessThan(LOD_HIGH.treeFillFar);
    for (const q of [0, 0.35, 0.72, 1]) {
      for (const [near, far] of [
        [55, 700],
        [75, 165],
        [175, 628],
        [48, 125],
      ] as const) {
        const swap = spriteSwapDistance(base, scaleAt(q), near, far, foliageFogLimit(far, q));
        expect(swap).toBeLessThanOrEqual(base * scaleAt(q) + 1e-9);
      }
    }
  });
});

// The sprite's Lambert term, sampled across the card. `bearing` is the
// horizontal direction from the sprite toward the camera; the sun comes from
// day_night_core so these numbers track the real celestial arc rather than a
// hand-picked light.
type Vec3 = readonly [number, number, number];
const dot3 = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const UP_NORMAL: Vec3 = [0, 1, 0];

function cardTerms(bearing: number, sun: Vec3, tilt?: number): number[] {
  const fwdX = Math.sin(bearing);
  const fwdZ = Math.cos(bearing);
  return Array.from({ length: 64 }, (_, i) =>
    Math.max(0, dot3(impostorSpriteNormal(-0.5 + (i + 0.5) / 64, fwdX, fwdZ, tilt), sun)),
  );
}

const mean = (xs: number[]): number => xs.reduce((s, v) => s + v, 0) / xs.length;

/** Card term averaged over every camera bearing: the whole-scene brightness. */
function allBearingsMean(sun: Vec3, tilt?: number): number {
  const bearings = 180;
  let total = 0;
  for (let i = 0; i < bearings; i++)
    total += mean(cardTerms((i / bearings) * Math.PI * 2, sun, tilt));
  return total / bearings;
}

/** Bearing that puts the sun at the viewer's back, so the card faces the light. */
function frontLitBearing(sun: Vec3): number {
  return Math.atan2(sun[0], sun[2]);
}

describe('sprite shading normal', () => {
  const dawn = sunDirection(0.28) as Vec3;
  const noon = sunDirection(0.5) as Vec3;

  it('stays a unit vector everywhere on the card and at every bearing', () => {
    for (let b = 0; b < 16; b++) {
      const bearing = (b / 16) * Math.PI * 2;
      for (const faceX of [-0.5, -0.25, 0, 0.25, 0.5]) {
        const n = impostorSpriteNormal(faceX, Math.sin(bearing), Math.cos(bearing));
        expect(Math.hypot(...n), `bearing ${b} faceX ${faceX}`).toBeCloseTo(1, 12);
      }
    }
  });

  it('keeps most of the vertical component and aims the rest at the camera', () => {
    // The retained up component is what preserves the ground-plane response
    // the daytime sprite-to-tree parity was tuned against; the card centre
    // spends the remainder facing the viewer.
    const n = impostorSpriteNormal(0, 0.6, 0.8);
    const expectedY =
      (1 - IMPOSTOR_NORMAL_TILT) / Math.hypot(1 - IMPOSTOR_NORMAL_TILT, IMPOSTOR_NORMAL_TILT);
    expect(n[1]).toBeCloseTo(expectedY, 12);
    expect(n[1]).toBeGreaterThan(0.5);
    const horiz = Math.hypot(n[0], n[2]);
    expect(n[0] / horiz).toBeCloseTo(0.6, 12);
    expect(n[2] / horiz).toBeCloseTo(0.8, 12);
  });

  it('fans across the card so one sprite carries a lit side and a shaded side', () => {
    // The user-visible symptom this whole normal exists for: a sprite lit from
    // the side used to be one flat colour. The fan spreads the two edges
    // apart in light, monotonically, the way a standing canopy shades.
    const sunOnOneSide = cardTerms(frontLitBearing(dawn) + Math.PI / 2, dawn);
    const sunOnTheOther = cardTerms(frontLitBearing(dawn) - Math.PI / 2, dawn);
    const ends = (t: number[]): number => t[0] - t[t.length - 1];
    // the bright edge follows the sun rather than sticking to one side
    expect(ends(sunOnOneSide)).toBeGreaterThan(0.4);
    expect(ends(sunOnTheOther)).toBeLessThan(-0.4);
    // one gradient across the card, no second bright band
    for (let i = 1; i < sunOnOneSide.length; i++) {
      expect(sunOnOneSide[i]).toBeLessThanOrEqual(sunOnOneSide[i - 1]);
      expect(sunOnTheOther[i]).toBeGreaterThanOrEqual(sunOnTheOther[i - 1]);
    }
    // and the edges really are a fan, not a single leaning normal: their
    // horizontal headings sit a full fan apart on either side of the view
    const heading = (n: Vec3): number => Math.atan2(n[0], n[2]);
    expect(heading(impostorSpriteNormal(-0.5, 0, 1))).toBeCloseTo(-IMPOSTOR_NORMAL_FAN, 12);
    expect(heading(impostorSpriteNormal(0.5, 0, 1))).toBeCloseTo(IMPOSTOR_NORMAL_FAN, 12);
  });

  it('restores the directional term the low sun used to erase', () => {
    // A dawn sun sits about 3 degrees up (CELESTIAL_ARC_HEIGHT caps the arc at
    // 41), so an up normal collects almost nothing and every sprite past the
    // swap flattened into one ambient-lit warm cutout.
    expect(dawn[1]).toBeLessThan(0.06);
    const upTerm = Math.max(0, dot3(UP_NORMAL, dawn));
    const lit = cardTerms(frontLitBearing(dawn), dawn);
    expect(Math.max(...lit) / upTerm).toBeGreaterThan(8);
    expect(mean(lit) / upTerm).toBeGreaterThan(6);
    // and the backlit twin keeps falling into shade rather than lighting up
    expect(Math.max(...cardTerms(frontLitBearing(dawn) + Math.PI, dawn))).toBe(0);
  });

  it('holds the noon response near the up normal it replaces', () => {
    // Parity guard on the other end: the sprite must not go dim at midday,
    // where the old up normal was calibrated against the real trees. Averaged
    // over every camera bearing the tilt costs a modest fraction of the
    // direct term, and it buys the low-sun response above.
    const upTerm = Math.max(0, dot3(UP_NORMAL, noon));
    const ratio = allBearingsMean(noon) / upTerm;
    expect(ratio).toBeGreaterThan(0.78);
    expect(ratio).toBeLessThanOrEqual(1);
    // a steeper tilt would buy more dawn contrast at a noon cost this rejects
    expect(allBearingsMean(noon, 0.6) / upTerm).toBeLessThan(0.78);
  });
});

describe('shared GLSL and constants', () => {
  it('both shader sides source the jitter from this module, byte for byte', () => {
    // The real side (foliage_collapse.ts) ends each instance at
    // swap - fade * jitter; the sprite side (foliage_impostor.ts) begins it
    // there. They agree only because both interpolate IMPOSTOR_JITTER_GLSL.
    for (const file of ['../src/render/foliage_collapse.ts', '../src/render/foliage_impostor.ts']) {
      const src = readFileSync(new URL(file, import.meta.url), 'utf8');
      expect(src, file).toContain('IMPOSTOR_JITTER_GLSL');
    }
    // the hash reads the shared name both vertex shaders declare
    expect(IMPOSTOR_JITTER_GLSL).toContain('collapseOrigin');
  });

  it('the shader normal carries the same constants the Node mirror does', () => {
    // impostorSpriteNormal is only worth testing if the GPU runs the same
    // numbers, and the two are separate sources: pin the interpolation.
    expect(IMPOSTOR_NORMAL_GLSL).toContain((2 * IMPOSTOR_NORMAL_FAN).toFixed(5));
    expect(IMPOSTOR_NORMAL_GLSL).toContain(IMPOSTOR_NORMAL_TILT.toFixed(3));
    // the basis names the sprite vertex stage declares
    expect(IMPOSTOR_NORMAL_GLSL).toContain('impFwd');
    expect(IMPOSTOR_NORMAL_GLSL).toContain('impRight');
    expect(IMPOSTOR_NORMAL_GLSL).toContain('position.x');
  });

  it('the sprite material overrides the normal early enough to reach shading', () => {
    // three resolves the shading normal in <defaultnormal_vertex>, which runs
    // BEFORE <begin_vertex>: an objectNormal written in the offset block
    // would compile clean and light nothing. Pin the chunk it hooks.
    const src = readFileSync(new URL('../src/render/foliage_impostor.ts', import.meta.url), 'utf8');
    expect(src).toContain('IMPOSTOR_NORMAL_GLSL');
    const normalHook = src.indexOf("'#include <beginnormal_vertex>'");
    const offsetHook = src.indexOf("'#include <begin_vertex>'");
    expect(normalHook).toBeGreaterThan(0);
    expect(normalHook).toBeLessThan(offsetHook);
    expect(src.slice(normalHook, offsetHook)).toContain('vec3 objectNormal');
  });

  it('takes the distant-zone air, and attaches it AFTER its own two hooks', () => {
    // Past the detail envelope these sprites ARE the trees, rocks and
    // buildings, so a sprite holding full local colour over hazed ground is
    // the self-cancelling failure biome_haze_field.ts warns about: the vista
    // splits into hazed ground with an unhazed collage on top, which reads as
    // no atmosphere at all. Every other lit surface gets this through
    // surfaceMat; this material is built by hand and so must ask.
    const src = readFileSync(new URL('../src/render/foliage_impostor.ts', import.meta.url), 'utf8');
    expect(src).toContain('attachBiomeHaze');
    // Order is load-bearing: attachBiomeHaze CHAINS the onBeforeCompile and
    // customProgramCacheKey it finds at attach time, so attaching before the
    // sprite installs its own would silently drop the billboard vertex stage
    // (every sprite a flat unrotated quad) and let the two arms share a program.
    const attach = src.indexOf('attachBiomeHaze(mat)');
    expect(attach).toBeGreaterThan(src.indexOf('mat.onBeforeCompile = '));
    expect(attach).toBeGreaterThan(src.indexOf('mat.customProgramCacheKey = '));
    // and it must land on the DRAW material, never the bake material: the
    // atlas is rendered once at boot and baking the air into it would freeze
    // one camera distance and one time of day into every sprite forever.
    const bakeStart = src.indexOf('function bakeMaterialFor');
    const bakeEnd = src.indexOf('\n}', bakeStart);
    expect(bakeStart).toBeGreaterThan(0);
    expect(src.slice(bakeStart, bakeEnd)).not.toContain('attachBiomeHaze');
  });

  it('never sets vertexColors while the sprite quad carries no colour attribute', () => {
    // The regression that made every sprite a flat cutout. three defines
    // USE_COLOR in the VERTEX prefix from material.vertexColors alone, and
    // `color_vertex` then runs `vColor *= color` against a `color` attribute
    // the impostor quad does not have. An unbound attribute reads (0, 0, 0),
    // so vColor was zero and `color_fragment` multiplied every sprite's whole
    // DIFFUSE term away. All that still drew was the canopy emissive floor
    // and a specular lobe, neither of which is multiplied by diffuseColor:
    // one flat colour, no response to the sun at any hour, and warm and
    // washed out at dawn and dusk because the specular alone carried the
    // light's colour. The per-instance tint never needed the flag: three
    // derives USE_INSTANCING_COLOR from the mesh's instanceColor, and its
    // FRAGMENT prefix defines USE_COLOR from that same instancing path.
    const src = readFileSync(new URL('../src/render/foliage_impostor.ts', import.meta.url), 'utf8');
    const geoStart = src.indexOf('function impostorQuadGeo');
    const geoEnd = src.indexOf('\n}', geoStart);
    expect(geoStart).toBeGreaterThan(0);
    const quadGeoBody = src.slice(geoStart, geoEnd);
    const quadHasColor = /setAttribute\(\s*'color'/.test(quadGeoBody);
    expect(quadHasColor, 'quad gained a colour attribute: revisit the flag below').toBe(false);
    // With no such attribute the flag must stay off. Setting it back on is
    // the exact shape of the bug, so fail on the assignment itself.
    expect(src).not.toMatch(/vertexColors:\s*true/);
    // three still needs the tint to arrive, which it does through setColorAt.
    expect(src).toContain('mesh.setColorAt(i,');
    expect(src).toContain('instanceColor.needsUpdate = true');
  });

  it('the pinned three build still has the chunk order the normal patch needs', () => {
    // onBeforeCompile patching fails SILENTLY when a hook string moves: the
    // replace becomes a no-op, objectNormal keeps three's stock value, and
    // every sprite quietly goes back to flat with nothing red. Pin the facts
    // the patch rests on so a three bump fails here instead of on a player's
    // screen (see the Three.js pin note in src/render/CLAUDE.md).
    const vert = THREE.ShaderLib.physical.vertexShader;
    expect(vert.split('#include <beginnormal_vertex>')).toHaveLength(2);
    expect(vert.indexOf('#include <beginnormal_vertex>')).toBeLessThan(
      vert.indexOf('#include <defaultnormal_vertex>'),
    );
    expect(vert.indexOf('#include <defaultnormal_vertex>')).toBeLessThan(
      vert.indexOf('#include <begin_vertex>'),
    );
    // and the instancing arm still DIVIDES a normal by the instance scale,
    // which is exactly what the material's multiply-by-scale un-rotation
    // cancels; if this ever changes to a plain multiply the sprites skew.
    expect(THREE.ShaderChunk.defaultnormal_vertex).toContain(
      'transformedNormal /= vec3( dot( im[ 0 ], im[ 0 ] )',
    );
  });

  it('the fade span stays small against every category swap', () => {
    // The jittered handoff band must sit inside the shortest realistic swap
    // (the murk realms bottom out near the 50 percent blend line).
    expect(IMPOSTOR_SWAP_FADE).toBeGreaterThan(0);
    expect(IMPOSTOR_SWAP_FADE).toBeLessThan(SPRITE_SWAP_MIN / 4);
  });
});
