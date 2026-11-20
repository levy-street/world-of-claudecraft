// The painted kits' shared modules (src/render/smith_heart/env_kit_bake.ts and
// env_kit_look.ts, ridden by the Hammer's and the Breath's kits) and the rock paints'
// composition (breath_env_rock_paint.ts composeRockPaints): the instancer buckets by piece,
// culling cell, shadow class and painting and sheds the cosmetic on the low tier; the
// warmers are hidden, one per painting; a look's program key names every number its GLSL
// bakes in and its GLSL carries only the layers asked for; and two veins' rock paints land
// on ONE clone (a second clone would drop the first's hook: cloneMaterialWithHooks keeps
// only the layers it knows).

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { isSharedMaterial, markSharedMaterial } from '../src/render/shared_resource';
import { composeRockPaints } from '../src/render/smith_heart/breath_env_rock_paint';
import {
  bakeEnvNode,
  type EnvBaked,
  envWarmCarriers,
  instanceEnvPieces,
  isEnvPieceNode,
} from '../src/render/smith_heart/env_kit_bake';
import { applyEnvLook, type EnvLook, envLookKey } from '../src/render/smith_heart/env_kit_look';

const SHADOW = { casts: (p: string) => p !== 'glow', receives: () => true };

function triangle(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute(
    'position',
    new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3),
  );
  g.setAttribute(
    'normal',
    new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]), 3),
  );
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1]), 2));
  g.setIndex([0, 1, 2]);
  return g;
}

function baked(paintings: string[]): EnvBaked {
  return { parts: new Map(paintings.map((p) => [p, triangle()])) };
}

const materials = new Map<string, THREE.Material>();
const materialOf = (p: string) => {
  const have = materials.get(p);
  if (have) return have;
  const m = new THREE.MeshBasicMaterial({ name: p });
  materials.set(p, m);
  return m;
};

describe('the painted kits shared baker', () => {
  it('bakes a piece node per painting, in the node own frame, and keeps each first map', () => {
    const node = new THREE.Object3D();
    node.name = 'Env_Test';
    const map = new THREE.Texture();
    const a = new THREE.Mesh(triangle(), new THREE.MeshStandardMaterial({ name: 'stone', map }));
    const b = new THREE.Mesh(triangle(), new THREE.MeshStandardMaterial({ name: 'stone' }));
    const c = new THREE.Mesh(triangle(), new THREE.MeshStandardMaterial({ name: 'moss' }));
    b.position.set(2, 0, 0);
    node.add(a, b, c);
    const seen: [string, THREE.Texture][] = [];
    const out = bakeEnvNode(
      node,
      (n) => n,
      (p, m) => seen.push([p, m]),
    );
    expect([...out.parts.keys()].sort()).toEqual(['moss', 'stone']);
    const stone = out.parts.get('stone');
    expect(stone?.attributes.position.count).toBe(6);
    // The second triangle carried its own placement into the merge.
    expect(stone?.attributes.position.getX(3)).toBeCloseTo(2, 6);
    expect(seen).toEqual([['stone', map]]);
    // Only top-level pieces are pieces: a node inside another is part of it.
    const inner = new THREE.Object3D();
    inner.name = 'Env_Inner';
    node.add(inner);
    expect(isEnvPieceNode(node)).toBe(true);
    expect(isEnvPieceNode(inner)).toBe(false);
  });

  it('instances one mesh per piece, cell, shadow class and painting', () => {
    const kit = new Map([
      ['Env_A', baked(['stone', 'glow'])],
      ['Env_B', baked(['stone'])],
    ]);
    const group = instanceEnvPieces(
      kit,
      materialOf,
      [
        { piece: 'Env_A', x: 10, y: 0, z: 10, rot: 0 },
        { piece: 'Env_A', x: 20, y: 0, z: 20, rot: 0 },
        // Another culling cell.
        { piece: 'Env_A', x: 260, y: 0, z: 10, rot: 0 },
        // Another shadow class.
        { piece: 'Env_A', x: 30, y: 0, z: 30, rot: 0, noShadow: true },
        { piece: 'Env_B', x: 10, y: 0, z: 10, rot: 0, cosmetic: true },
        // A piece that never baked is skipped.
        { piece: 'Env_Missing', x: 0, y: 0, z: 0, rot: 0 },
      ],
      false,
      'test',
      200,
      SHADOW,
    );
    const meshes = group.children as THREE.InstancedMesh[];
    // Env_A: 3 buckets times 2 paintings; Env_B: 1 bucket.
    expect(meshes.length).toBe(7);
    const first = meshes.filter((m) => m.name === 'Env_A:stone' && m.count === 2);
    expect(first.length).toBe(1);
    expect(first[0].castShadow).toBe(true);
    for (const m of meshes.filter((x) => x.name === 'Env_A:glow')) expect(m.castShadow).toBe(false);
    const quiet = meshes.filter(
      (m) => m.name.startsWith('Env_A') && m.count === 1 && !m.castShadow,
    );
    expect(quiet.length).toBeGreaterThanOrEqual(2);
    for (const m of meshes) expect(m.material).toBe(materialOf(m.name.split(':')[1]));
    // The low tier sheds the cosmetic and casts nothing.
    const low = instanceEnvPieces(
      kit,
      materialOf,
      [
        { piece: 'Env_A', x: 10, y: 0, z: 10, rot: 0 },
        { piece: 'Env_B', x: 10, y: 0, z: 10, rot: 0, cosmetic: true },
      ],
      true,
      'low',
      200,
      SHADOW,
    );
    expect(low.children.map((m) => m.name).sort()).toEqual(['Env_A:glow', 'Env_A:stone']);
    for (const m of low.children as THREE.InstancedMesh[]) expect(m.castShadow).toBe(false);
  });

  it('warms one hidden carrier per painting, on that painting own material', () => {
    const carriers = envWarmCarriers(['stone', 'glow'], materialOf, SHADOW, 'warm');
    expect(carriers.map((m) => m.name)).toEqual(['warm:stone', 'warm:glow']);
    for (const m of carriers) {
      expect(m.visible).toBe(false);
      expect(m.frustumCulled).toBe(false);
      expect(m).toBeInstanceOf(THREE.InstancedMesh);
    }
    expect(carriers[0].material).toBe(materialOf('stone'));
    expect(carriers[1].castShadow).toBe(false);
    expect(envWarmCarriers([], materialOf, SHADOW, 'none')).toEqual([]);
  });
});

/** A look's GLSL, compiled against a stand-in for three's chunks. */
function compiled(look: EnvLook): { vertex: string; fragment: string; uniforms: string[] } {
  const m = new THREE.MeshStandardMaterial();
  applyEnvLook(m, look);
  const shader = {
    uniforms: {} as Record<string, unknown>,
    vertexShader: '#include <common>\n#include <project_vertex>',
    fragmentShader:
      '#include <common>\n#include <clipping_planes_fragment>\n#include <color_fragment>\n#include <emissivemap_fragment>',
  };
  m.onBeforeCompile(shader as never, {} as never);
  return {
    vertex: shader.vertexShader,
    fragment: shader.fragmentShader,
    uniforms: Object.keys(shader.uniforms),
  };
}

describe('the painted kits shared look', () => {
  const shade = ['0.2', '0.21', '0.25'] as const;
  const strokes = { map: () => null, tileA: 17, tileB: 41, strength: 0.2, mean: 0.29 };

  it('names every baked number in its program key', () => {
    const base: EnvLook = { cutaway: true, strokes, shade };
    const keys = new Set([
      envLookKey(base),
      envLookKey({ ...base, strokes: null }),
      envLookKey({ ...base, strokes: { ...strokes, mean: 0.16 } }),
      envLookKey({ ...base, shade: ['0.26', '0.27', '0.32'] }),
      envLookKey({ ...base, crystal: 1.8 }),
      envLookKey({ cutaway: false, strokes: null, shade }),
    ]);
    expect(keys.size).toBe(6);
    // Strokes are a rock's alone: a stone's key ignores them.
    expect(envLookKey({ cutaway: false, strokes, shade })).toBe(
      envLookKey({ cutaway: false, strokes: null, shade }),
    );
  });

  it('carries only the layers asked for', () => {
    const rock = compiled({ cutaway: true, strokes, shade, crystal: 1.8 });
    expect(rock.fragment).toContain('discard');
    expect(rock.fragment).toContain('uEnvStrokes');
    expect(rock.fragment).toContain('envCrystal');
    expect(rock.fragment).toContain(`vec3( ${shade.join(', ')} )`);
    expect(rock.uniforms).toEqual(['uEnvStrokes']);
    const stone = compiled({ cutaway: false, strokes: null, shade });
    expect(stone.fragment).not.toContain('discard');
    expect(stone.fragment).not.toContain('uEnvStrokes');
    expect(stone.fragment).not.toContain('envCrystal');
    expect(stone.vertex).not.toContain('vEnvCutWorld');
  });
});

describe('the veins rock paints on one clone', () => {
  /** A layer that wraps the material's hook and key in place, as each vein's paint does. */
  const layer =
    (tag: string) =>
    (m: THREE.Material): void => {
      const prev = m.onBeforeCompile;
      const prevKey = m.customProgramCacheKey.bind(m);
      m.onBeforeCompile = (shader, renderer) => {
        prev.call(m, shader, renderer);
        shader.fragmentShader += `\n// ${tag}`;
      };
      m.customProgramCacheKey = () => `${prevKey()}|${tag}`;
    };

  it('clones the source once and stacks every layer on that clone, in order', () => {
    const source = new THREE.MeshStandardMaterial({ name: 'rock' });
    const paint = composeRockPaints(layer('hammer'), null, layer('breath'));
    if (!paint) throw new Error('no paint');
    const m = paint(source);
    expect(m).not.toBe(source);
    const shader = { uniforms: {}, vertexShader: '', fragmentShader: '' };
    m.onBeforeCompile(shader as never, {} as never);
    expect(shader.fragmentShader.trim().split('\n')).toEqual(['// hammer', '// breath']);
    expect(m.customProgramCacheKey().endsWith('|hammer|breath')).toBe(true);
    // The source keeps its own hook and key.
    expect(source.customProgramCacheKey()).not.toContain('hammer');
    // The clone is the build's own: a shared source's tag is stripped, so teardown frees it.
    const shared = markSharedMaterial(new THREE.MeshStandardMaterial());
    expect(isSharedMaterial(paint(shared))).toBe(false);
    expect(isSharedMaterial(shared)).toBe(true);
  });

  it('paints nothing with no layer', () => {
    expect(composeRockPaints(null, null)).toBeNull();
  });
});
