import type * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { buildLeafCanopy } from '../src/render/tree_gen';
import { sanitizeMapDoc } from '../src/sim/map_doc';
import {
  MAX_TREE_LEAVES,
  MAX_TREE_VOLUMES,
  resolvedTreeParams,
  sanitizeTreeParams,
  TREE_LIMITS,
} from '../src/sim/tree_params';

// The Tree Generator's recipe rides a map document as ONE nested record, which
// means the sanitizer is the only thing standing between an untrusted map and
// a placement the editor could never have authored. These tests pin the two
// properties that matter: every numeric knob is clamped to the SAME range the
// panel's slider offers, and anything unrecognized is dropped rather than kept.

describe('sanitizeTreeParams', () => {
  it('drops junk instead of throwing', () => {
    expect(sanitizeTreeParams(null)).toBeNull();
    expect(sanitizeTreeParams('oak')).toBeNull();
    expect(sanitizeTreeParams(42)).toBeNull();
    expect(sanitizeTreeParams({})).toBeNull();
    expect(sanitizeTreeParams({ nonsense: 1 })).toBeNull();
  });

  it('clamps every numeric knob to its slider range', () => {
    const wild: Record<string, number> = {};
    for (const key of Object.keys(TREE_LIMITS)) wild[key] = 1e9;
    const high = sanitizeTreeParams(wild) as Record<string, number>;
    for (const [key, lim] of Object.entries(TREE_LIMITS)) {
      expect(high[key], key).toBe(lim.max);
    }
    for (const key of Object.keys(TREE_LIMITS)) wild[key] = -1e9;
    const low = sanitizeTreeParams(wild) as Record<string, number>;
    for (const [key, lim] of Object.entries(TREE_LIMITS)) {
      expect(low[key], key).toBe(lim.min);
    }
  });

  it('rejects non-finite numbers rather than clamping them', () => {
    const out = sanitizeTreeParams({
      girth: Number.NaN,
      height: Number.POSITIVE_INFINITY,
      leaves: 100,
    });
    expect(out).toEqual({ leaves: 100 });
  });

  it('rounds integer-stepped knobs', () => {
    const out = sanitizeTreeParams({ branches: 2.7, volumeCount: 3.2, leaves: 101.6 });
    expect(out?.branches).toBe(3);
    expect(out?.volumeCount).toBe(3);
    // leaves has step 10 but is not integer-stepped in the >= 1 sense, so it
    // rounds too; what matters is that it stays a whole number of cards.
    expect(Number.isInteger(out?.leaves)).toBe(true);
  });

  it('only accepts known shapes and orientations', () => {
    expect(sanitizeTreeParams({ shape: 'dome' })?.shape).toBe('dome');
    expect(sanitizeTreeParams({ shape: 'banana' })).toBeNull();
    expect(sanitizeTreeParams({ leafOrient: 'droop' })?.leafOrient).toBe('droop');
    expect(sanitizeTreeParams({ leafOrient: 'sideways' })).toBeNull();
  });

  it('only accepts asset-key shaped ids', () => {
    expect(sanitizeTreeParams({ trunk: 'ancient' })?.trunk).toBe('ancient');
    expect(sanitizeTreeParams({ trunk: '../../etc/passwd' })).toBeNull();
    expect(sanitizeTreeParams({ leafSet: 'broadleaf_arcane' })?.leafSet).toBe('broadleaf_arcane');
    expect(sanitizeTreeParams({ barkTexId: 'Wood003' })?.barkTexId).toBe('Wood003');
    expect(sanitizeTreeParams({ barkTexId: 'a'.repeat(200) })).toBeNull();
  });

  it('caps the canopy volume list and clamps each sphere', () => {
    const volumes = Array.from({ length: 40 }, () => ({ x: 1e6, y: -1e6, z: 0, r: 1e6, sy: 1e6 }));
    const out = sanitizeTreeParams({ volumes });
    expect(out?.volumes?.length).toBe(MAX_TREE_VOLUMES);
    for (const v of out?.volumes ?? []) {
      expect(v.x).toBe(60);
      expect(v.y).toBe(-20);
      expect(v.r).toBe(40);
      expect(v.sy).toBe(4);
    }
    // A sphere missing a coordinate is skipped, not defaulted into existence.
    expect(sanitizeTreeParams({ volumes: [{ x: 1, y: 1 }] })).toBeNull();
  });

  it('caps the leaf count so one placement cannot author 100k quads', () => {
    expect(sanitizeTreeParams({ leaves: 999999 })?.leaves).toBe(MAX_TREE_LEAVES);
  });
});

describe('resolvedTreeParams', () => {
  it('fills every field and leaves the caller record untouched', () => {
    const partial = { trunk: 'palm' as const, leaves: 12 };
    const full = resolvedTreeParams(partial);
    expect(full.trunk).toBe('palm');
    expect(full.leaves).toBe(12);
    expect(full.shape).toBeDefined();
    expect(full.leafSet).toBeDefined();
    expect(full.sway).toBeDefined();
    expect(partial).toEqual({ trunk: 'palm', leaves: 12 });
  });
});

describe('map document round trip', () => {
  const ZONE = {
    id: 'z',
    name: 'Z',
    zMin: -10,
    zMax: 100,
    hub: { x: 0, z: 0, radius: 5, name: 'H' },
  };
  const docWith = (tree: unknown) => ({
    version: 2,
    meta: { id: 'm1', name: 'Map', seed: 7 },
    content: { zones: [ZONE], camps: [], npcs: {}, objects: [], roads: [] },
    terrainEdits: [],
    placements: [{ assetId: 'tree/generated', x: 1, z: 2, rotY: 0, scale: 1, collide: true, tree }],
  });

  it('keeps a sane tree recipe through save and load', () => {
    const doc = sanitizeMapDoc(
      docWith({ trunk: 'ancient', leafSet: 'broadleaf_arcane', leaves: 300, leafGlow: 2 }),
    );
    const p = doc?.placements[0];
    expect(p?.tree).toEqual({
      trunk: 'ancient',
      leafSet: 'broadleaf_arcane',
      leaves: 300,
      leafGlow: 2,
    });
  });

  it('strips a hostile recipe but keeps the placement', () => {
    const doc = sanitizeMapDoc(docWith({ leaves: 1e9, trunk: '<script>', bogus: 'x' }));
    const p = doc?.placements[0];
    expect(p).toBeDefined();
    expect(p?.tree).toEqual({ leaves: MAX_TREE_LEAVES });
  });

  it('leaves ordinary placements without a tree field', () => {
    const doc = sanitizeMapDoc(docWith(undefined));
    expect(doc?.placements[0]?.tree).toBeUndefined();
  });
});

// A leaf card is one cell of a 4x2 atlas, and the cell offset is applied in the
// vertex shader. Three keeps a SEPARATE uv varying per map slot, so a patch
// that only moves vMapUv leaves the emissive map reading the whole sheet -
// which is transparent black between the painted cards, so the ambient floor
// that keeps a self-shadowed canopy off pure black collapses to zero over most
// of every leaf and the crown blotches. Pin that every slot in use is moved.
describe('leaf atlas uv patch', () => {
  const compileLeafShader = (): { vertexShader: string; fragmentShader: string } => {
    const canopy = buildLeafCanopy({
      params: resolvedTreeParams({ leafSet: 'broadleaf', leaves: 8 }),
      volumes: [{ x: 0, y: 4, z: 0, r: 2, sy: 1 }],
      swayAmp: 0.2,
      shimmer: 0.05,
      totalHeight: 8,
    });
    expect(canopy).not.toBeNull();
    const mat = canopy?.mesh.material as THREE.Material;
    // The stub carries the include markers and the varyings three would have
    // declared for the slots this material fills.
    const shader = {
      uniforms: {},
      vertexShader: [
        '#include <common>',
        'varying vec2 vMapUv;',
        'varying vec2 vEmissiveMapUv;',
        'void main() {',
        '#include <uv_vertex>',
        '#include <beginnormal_vertex>',
        '#include <begin_vertex>',
        '#include <project_vertex>',
        '}',
      ].join('\n'),
      fragmentShader: [
        '#include <common>',
        'void main() {',
        '#include <normal_fragment_begin>',
        '}',
      ].join('\n'),
    };
    mat.onBeforeCompile?.(
      shader as unknown as THREE.WebGLProgramParametersWithUniforms,
      null as unknown as THREE.WebGLRenderer,
    );
    return shader;
  };

  it('moves every map slot the leaf material fills into the instance cell', () => {
    const { vertexShader } = compileLeafShader();
    expect(vertexShader).toContain('vMapUv = vMapUv * vec2(0.250000, 0.500000) + aLeafCell;');
    expect(vertexShader).toContain(
      'vEmissiveMapUv = vEmissiveMapUv * vec2(0.250000, 0.500000) + aLeafCell;',
    );
  });

  it('keeps the double-sided normal flip undone so backfacing cards stay lit', () => {
    const { fragmentShader } = compileLeafShader();
    expect(fragmentShader).toContain('normal = normal * faceDirection;');
  });
});
