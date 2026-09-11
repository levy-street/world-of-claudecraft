import type * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { buildFoliageModel, FOLIAGE_PRESETS, foliagePreset } from '../src/render/foliage_gen';
import {
  FOLIAGE_KINDS,
  FOLIAGE_LIMITS,
  type FoliageParams,
  foliageHasLeafCards,
  foliageHasTrunk,
  foliageKindOf,
  foliageLimitsFor,
  resolvedFoliageParams,
  sanitizeFoliageParams,
} from '../src/sim/foliage_params';
import { sanitizeMapDoc, serializeMapDoc, TREE_ASSET_ID } from '../src/sim/map_doc';
import { DEFAULT_TREE_PARAMS, resolvedTreeParams } from '../src/sim/tree_params';

// The generator generalized past trees: the parameter record, the per-kind
// solvers, and the promise that every v1 tree record still means exactly what
// it always did.

describe('FoliageParams (src/sim/foliage_params.ts)', () => {
  it('a record with no kind is a tree, resolved exactly as before', () => {
    expect(foliageKindOf(undefined)).toBe('tree');
    expect(foliageKindOf({})).toBe('tree');
    expect(foliageKindOf({ kind: 'bush' })).toBe('bush');
    // Every shared field resolves to the tree defaults, untouched.
    const p: FoliageParams = { trunk: 'pine', leaves: 200 };
    const foliage = resolvedFoliageParams(p);
    const tree = resolvedTreeParams(p);
    for (const key of Object.keys(DEFAULT_TREE_PARAMS) as (keyof typeof DEFAULT_TREE_PARAMS)[]) {
      expect(foliage[key]).toEqual(tree[key]);
    }
  });

  it('a kind brings its own defaults, and an authored field still wins', () => {
    const bush = resolvedFoliageParams({ kind: 'bush' });
    expect(bush.branches).toBe(0); // no trunk chain to branch off
    expect(bush.shape).toBe('dome');
    expect(bush.footprint).toBeGreaterThan(0);
    // The maker's own value beats the kind default.
    expect(resolvedFoliageParams({ kind: 'bush', leaves: 42 }).leaves).toBe(42);
    expect(resolvedFoliageParams({ kind: 'bush', footprint: 4 }).footprint).toBe(4);
  });

  it('says which half of the solver each kind uses', () => {
    expect(foliageHasTrunk('tree')).toBe(true);
    expect(foliageHasLeafCards('grass')).toBe(false);
    for (const kind of FOLIAGE_KINDS) {
      if (kind === 'tree') continue;
      expect(foliageHasTrunk(kind)).toBe(false);
    }
  });

  it('hides the dials a kind cannot use', () => {
    const tree = foliageLimitsFor('tree');
    expect(tree.girth).toBeDefined();
    expect(tree.footprint).toBeUndefined(); // a tree takes it from the trunk
    const bush = foliageLimitsFor('bush');
    expect(bush.girth).toBeUndefined();
    expect(bush.branchLen).toBeUndefined();
    expect(bush.footprint).toBeDefined();
    expect(bush.clumps).toBeUndefined(); // grass only
    const grass = foliageLimitsFor('grass');
    expect(grass.leaves).toBeUndefined(); // blades, not cards
    expect(grass.clumps).toBeDefined();
    expect(foliageLimitsFor('vine').hang).toBeDefined();
  });
});

describe('sanitizing (untrusted documents)', () => {
  it('leaves a v1 tree record byte-identical', () => {
    const raw = { trunk: 'oak', leaves: 300, leafSize: 2 };
    expect(sanitizeFoliageParams(raw)).toEqual(raw);
    // 'tree' carries no information, so it is never written back.
    expect(sanitizeFoliageParams({ ...raw, kind: 'tree' })).toEqual(raw);
  });

  it('clamps the new knobs and drops an unknown kind', () => {
    const out = sanitizeFoliageParams({
      kind: 'grass',
      footprint: 999,
      plantHeight: -5,
      clumps: 9999,
      splay: 99,
    });
    expect(out?.kind).toBe('grass');
    expect(out?.footprint).toBe(FOLIAGE_LIMITS.footprint.max);
    expect(out?.plantHeight).toBe(FOLIAGE_LIMITS.plantHeight.min);
    expect(out?.clumps).toBe(FOLIAGE_LIMITS.clumps.max);
    expect(out?.splay).toBe(FOLIAGE_LIMITS.splay.max);
    expect(sanitizeFoliageParams({ kind: 'triffid', leaves: 10 })?.kind).toBeUndefined();
  });

  it('survives the map document round trip on a placement', () => {
    const doc = sanitizeMapDoc({
      version: 2,
      meta: { id: 'm1', name: 'plants', seed: 1 },
      content: {
        zones: [
          { id: 'z', name: 'Z', zMin: -10, zMax: 100, hub: { x: 0, z: 0, radius: 5, name: 'H' } },
        ],
        camps: [],
        npcs: {},
        objects: [],
        roads: [],
      },
      terrainEdits: [],
      placements: [
        {
          assetId: TREE_ASSET_ID,
          x: 1,
          z: 2,
          rotY: 0,
          scale: 1,
          tree: { kind: 'fern', footprint: 2, strands: 5, leaves: 80 },
        },
      ],
    });
    const tree = doc?.placements[0]?.tree;
    expect(tree?.kind).toBe('fern');
    expect(tree?.strands).toBe(5);
    const reparsed = sanitizeMapDoc(JSON.parse(serializeMapDoc(doc as never)));
    expect(reparsed?.placements[0]?.tree).toEqual(tree);
  });
});

describe('growing each kind (src/render/foliage_gen.ts)', () => {
  it('a bush is a canopy with no trunk and no branches', () => {
    const build = buildFoliageModel({ kind: 'bush', seed: 7 });
    expect(build.branchCount).toBe(0);
    expect(build.volumes.length).toBeGreaterThan(0);
    expect(build.leafCount).toBeGreaterThan(0);
    expect(build.height).toBeGreaterThan(0);
    expect(build.radius).toBeGreaterThan(0);
    expect(build.group.name).toBe('generated-bush');
    build.dispose();
  });

  it('grass is blades, not leaf cards, and never collides', () => {
    const build = buildFoliageModel({ kind: 'grass', seed: 3, clumps: 20 });
    expect(build.leafCount).toBe(0);
    expect(build.volumes).toEqual([]);
    expect(build.collideRadius).toBe(0);
    expect(build.group.name).toBe('generated-grass');
    build.dispose();
  });

  it('a vine hangs its canopy below the anchor', () => {
    const build = buildFoliageModel({ kind: 'vine', seed: 5, hang: 6, plantHeight: 0.5 });
    const lowest = Math.min(...build.volumes.map((v) => v.y));
    expect(lowest).toBeLessThan(0); // strung down past the ground plane
    build.dispose();
  });

  it('a fern sprays one volume per strand', () => {
    const build = buildFoliageModel({ kind: 'fern', seed: 11, strands: 5 });
    expect(build.volumes.length).toBe(5);
    build.dispose();
  });

  it('is deterministic: the same seed grows the same plant', () => {
    const a = buildFoliageModel({ kind: 'bush', seed: 99 });
    const b = buildFoliageModel({ kind: 'bush', seed: 99 });
    expect(a.volumes).toEqual(b.volumes);
    expect(a.height).toBe(b.height);
    const c = buildFoliageModel({ kind: 'bush', seed: 100 });
    expect(c.volumes).not.toEqual(a.volumes);
    a.dispose();
    b.dispose();
    c.dispose();
  });

  it('authored volumes win over the kind solver, as they do for trees', () => {
    const volumes = [{ x: 0, y: 3, z: 0, r: 2, sy: 1 }];
    const build = buildFoliageModel({ kind: 'bush', volumes });
    expect(build.volumes).toEqual(volumes);
    build.dispose();
  });

  it('every preset grows, and names a kind that exists', () => {
    for (const preset of FOLIAGE_PRESETS) {
      expect(FOLIAGE_KINDS).toContain(preset.kind);
      expect(foliagePreset(preset.key)).toBe(preset);
      const build = buildFoliageModel(preset.params);
      expect(build.height).toBeGreaterThan(0);
      build.dispose();
    }
    expect(foliagePreset('nope')).toBeNull();
  });
});

describe('volume bounds (what the leaf scatter and the sanitizer assume)', () => {
  it('a tall thin bush keeps every volume inside the TreeVolume ranges', () => {
    // A pathological combination: the smallest footprint against the tallest
    // plant. The core blob must stretch without authoring an ellipsoid the
    // rest of the pipeline cannot read.
    const build = buildFoliageModel({ kind: 'bush', footprint: 0.2, plantHeight: 20, seed: 1 });
    for (const v of build.volumes) {
      expect(v.sy).toBeGreaterThanOrEqual(0.1);
      expect(v.sy).toBeLessThanOrEqual(4);
      expect(v.r).toBeGreaterThan(0);
      expect(Number.isFinite(v.y)).toBe(true);
    }
    build.dispose();
  });

  it('every kind at its extremes stays finite', () => {
    for (const kind of FOLIAGE_KINDS) {
      for (const extreme of [
        { footprint: FOLIAGE_LIMITS.footprint.min, plantHeight: FOLIAGE_LIMITS.plantHeight.max },
        { footprint: FOLIAGE_LIMITS.footprint.max, plantHeight: FOLIAGE_LIMITS.plantHeight.min },
      ]) {
        const build = buildFoliageModel({ kind, seed: 2, ...extreme });
        expect(Number.isFinite(build.height)).toBe(true);
        expect(Number.isFinite(build.radius)).toBe(true);
        expect(build.height).toBeGreaterThan(0);
        build.dispose();
      }
    }
  });
});

// A grass clump reuses blade_grass.ts's clusterGeometry, which ships position
// and colour only: the all-up normal every blade needs is a SHADER constant,
// and the double-sided flip then has to be undone in the fragment stage. Miss
// either and a clump renders solid black - the missing attribute normalizes to
// NaN, and the flipped one points at the ground.
describe('grass clump shading', () => {
  const grassShader = (): { vertexShader: string; fragmentShader: string } => {
    const build = buildFoliageModel({ kind: 'grass', seed: 5 });
    const mats: THREE.Material[] = [];
    build.group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh && !Array.isArray(mesh.material)) mats.push(mesh.material);
    });
    expect(mats).toHaveLength(1);
    const shader = {
      uniforms: {},
      vertexShader: ['void main() {', '#include <beginnormal_vertex>', '}'].join('\n'),
      fragmentShader: ['void main() {', '#include <normal_fragment_begin>', '}'].join('\n'),
    };
    mats[0].onBeforeCompile?.(
      shader as unknown as THREE.WebGLProgramParametersWithUniforms,
      null as unknown as THREE.WebGLRenderer,
    );
    build.dispose();
    return shader;
  };

  it('forces the up normal the blade geometry never carries', () => {
    expect(grassShader().vertexShader).toContain('vec3 objectNormal = vec3(0.0, 1.0, 0.0);');
  });

  it('undoes the double-sided flip so backfacing blades stay lit', () => {
    expect(grassShader().fragmentShader).toContain('normal *= faceDirection;');
  });
});
