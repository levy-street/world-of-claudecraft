// The foliage material prewarm twin set (foliage_prewarm_twins_core.ts) plus
// the source pins that buildFoliageMaterialPrewarmGroup really mints it.
//
// The measured defect: the group deduped by MATERIAL, so it linked one program
// per species material while the live buckets draw that material through
// several (the far-trunk proxy geometry, the vertex-coloured rock colorways and
// their merged cluster, the colour-inert shadow clones). The uncovered variants
// linked synchronously inside a live frame on a mid-travel zone entry.
//
// The twin identity is three's own: WebGLPrograms.getParameters keys on
// `instancing`, `instancingColor`, `vertexAlphas` (a VEC4 `color`),
// `vertexTangents` and the active uv channels on top of the material, and reads
// neither castShadow nor receiveShadow. Each of those dimensions gets a
// positive AND a negative case below.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  type FoliageDrawPath,
  foliageAttributeSignature,
  foliagePrewarmTwins,
  foliageProgramKey,
} from '../src/render/foliage_prewarm_twins_core';

function path(over: Partial<FoliageDrawPath> = {}): FoliageDrawPath {
  return {
    materialKey: 'Bark_NormalTree',
    attributes: ['position:3', 'normal:3', 'uv:2', 'color:4'],
    instanced: true,
    instanceColor: true,
    castShadow: false,
    receiveShadow: true,
    ...over,
  };
}

const plainTwins = (twins: readonly FoliageDrawPath[], materialKey: string) =>
  twins.filter((t) => t.materialKey === materialKey && !t.instanced);

describe('foliage prewarm twin identity', () => {
  it('is order-insensitive over the attribute set', () => {
    expect(foliageAttributeSignature(['uv:2', 'position:3'])).toBe(
      foliageAttributeSignature(['position:3', 'uv:2']),
    );
    expect(foliageProgramKey(path({ attributes: ['normal:3', 'position:3'] }))).toBe(
      foliageProgramKey(path({ attributes: ['position:3', 'normal:3'] })),
    );
  });

  it('separates the mesh kind, the instance colour and the attribute set', () => {
    const base = foliageProgramKey(path());
    expect(foliageProgramKey(path({ instanced: false }))).not.toBe(base);
    expect(foliageProgramKey(path({ instanceColor: false }))).not.toBe(base);
    // A VEC3 colour is `vertexAlphas: false`, a VEC4 one is true: two programs.
    expect(
      foliageProgramKey(path({ attributes: ['position:3', 'normal:3', 'uv:2', 'color:3'] })),
    ).not.toBe(base);
    // The far-trunk proxy cylinder drops nothing but adds no tangent either;
    // a tangent-carrying geometry on a normal-mapped material is its own key.
    expect(foliageProgramKey(path({ attributes: [...path().attributes, 'tangent:4'] }))).not.toBe(
      base,
    );
  });

  it('does not separate on the shadow flags, which three never reads', () => {
    const base = foliageProgramKey(path());
    expect(foliageProgramKey(path({ castShadow: true }))).toBe(base);
    expect(foliageProgramKey(path({ receiveShadow: false }))).toBe(base);
  });
});

describe('foliage prewarm twin set', () => {
  it('carries BOTH twins for a material drawn instanced and as a plain Mesh', () => {
    const twins = foliagePrewarmTwins([
      path(),
      path({ instanced: false, instanceColor: false }),
      path({ materialKey: 'Leaves_NormalTree' }),
    ]);
    expect(twins).toHaveLength(3);
    const bark = plainTwins(twins, 'Bark_NormalTree');
    expect(bark).toHaveLength(1);
    // The plain twin keeps the live geometry's attribute names, not the
    // instanced twin's: a dummy plane would link a different program.
    expect([...bark[0].attributes].sort()).toEqual(
      ['color:4', 'normal:3', 'position:3', 'uv:2'].sort(),
    );
    // Negative on the same dimension: a material only ever instanced gets no
    // plain twin.
    expect(plainTwins(twins, 'Leaves_NormalTree')).toHaveLength(0);
  });

  it('mints one twin per distinct geometry on the SAME material', () => {
    // The far-trunk proxy: same bark material, its own cylinder geometry.
    const twins = foliagePrewarmTwins([
      path(),
      path({ attributes: ['position:3', 'normal:3', 'uv:2', 'color:4', 'tangent:4'] }),
    ]);
    expect(twins).toHaveLength(2);
    // Negative: the same geometry twice is one twin, whatever the order of the
    // attribute list.
    expect(
      foliagePrewarmTwins([
        path(),
        path({ attributes: ['color:4', 'uv:2', 'normal:3', 'position:3'] }),
      ]),
    ).toHaveLength(1);
  });

  it('unions the shadow arms instead of splitting the twin', () => {
    const twins = foliagePrewarmTwins([
      path({ castShadow: false, receiveShadow: true }),
      path({ castShadow: true, receiveShadow: false }),
    ]);
    expect(twins).toHaveLength(1);
    expect(twins[0].castShadow).toBe(true);
    expect(twins[0].receiveShadow).toBe(true);
    // Negative: no live path casts, so the twin mints no depth variant.
    const quiet = foliagePrewarmTwins([path({ castShadow: false })]);
    expect(quiet[0].castShadow).toBe(false);
  });

  it('keeps world-build order and copies the attribute list', () => {
    const attributes = ['position:3'];
    const twins = foliagePrewarmTwins([
      path({ materialKey: 'Rocks', attributes }),
      path({ materialKey: 'Bark_NormalTree' }),
    ]);
    expect(twins.map((t) => t.materialKey)).toEqual(['Rocks', 'Bark_NormalTree']);
    attributes.push('color:3');
    expect(twins[0].attributes).toEqual(['position:3']);
  });
});

describe('foliage prewarm group wiring (source pins)', () => {
  const source = readFileSync(new URL('../src/render/foliage.ts', import.meta.url), 'utf8');

  it('mints one twin per PROGRAM, mirroring the live mesh kind and flags', () => {
    expect(source).toContain('const seen = new Set<string>();');
    expect(source).toContain('const key = foliageProgramKey(path);');
    expect(source).toContain('if (path.instanced) {');
    expect(source).toContain('const im = new THREE.InstancedMesh(geo, mat, 1);');
    expect(source).toContain('twin = new THREE.Mesh(geo, mat);');
    expect(source).toContain('if (path.instanceColor) {');
    expect(source).toContain('twin.castShadow = path.castShadow;');
    expect(source).toContain('twin.receiveShadow = path.receiveShadow;');
    expect(source).toContain(
      'for (const draw of foliagePrewarmDraws) add(draw.geometry, draw.material, draw.path);',
    );
  });

  it('publishes the live draw set from the one place that sees the whole build', () => {
    expect(source).toContain('foliagePrewarmDraws = foliagePrewarmTwins(drawPaths).flatMap(');
    expect(source).toContain('drawPaths.push(foliageDrawPathOf(b.mesh));');
    // The published sources are keyed by the SAME key the twins are, or every
    // lookup misses and the live coverage silently degrades to the floor.
    expect(source).toContain('const source = drawSources.get(foliageProgramKey(path));');
    expect(source).toContain('drawSources.set(b.reveal.key, {');
    expect(source).toContain(
      'return { key: foliageProgramKey(foliageDrawPathOf(mesh)), revealed: false, held: false };',
    );
  });

  it('reads the attribute itemSize, not just the name', () => {
    // `vertexAlphas` turns on a VEC4 `color` alone, so a name-only signature
    // would fold the far-trunk proxy into the bark twin and link it cold.
    const core = readFileSync(
      new URL('../src/render/foliage_prewarm_twins_core.ts', import.meta.url),
      'utf8',
    );
    expect(core).toContain('.map(([name, attr]) => `${name}:${attr.itemSize}`)');
    expect(source).toContain('foliageAttributeList(mesh.geometry.attributes)');
    expect(source).toContain('foliageAttributeList(part.geometry.attributes)');
  });

  it('draws every live foliage bucket through an InstancedMesh', () => {
    // Why the shipped twin set has no plain-Mesh member today. If a merged or
    // otherwise non-instanced foliage draw is ever added, this pin reds and the
    // twin above (which already handles the case) starts covering it. The
    // matcher is proven on a fixture first, so the zero is not vacuous.
    const plainMesh = /new THREE\.Mesh\(/g;
    expect('const m = new THREE.Mesh(geo, mat);'.match(plainMesh)).toHaveLength(1);
    const drawSites = (source.match(plainMesh) ?? []).length;
    const prewarmTwinSite = source.includes('new THREE.Mesh(geo, mat)') ? 1 : 0;
    expect(drawSites - prewarmTwinSite).toBe(0);
  });
});
