// Boot-prewarm coverage for the foliage camera-occluder ghosts
// (foliage_ghost_prewarm.ts). The measured defect: a tree crossing the
// eye-to-camera segment mints a plain-Mesh stand-in wearing a BARE clone of the
// bucket material (hookless, uninstanced, transparent), lazily, on the frame it
// is first needed. No boot sweep, no prewarm group and no reveal gate could see
// it, so it linked inside a live frame (Evergarden Bark_NormalTree 136 ms,
// Leaves_NormalTree 96 + 98 ms, all cacheKeyLength 262).
//
// The twin has to land on the LIVE ghost's program, so the load-bearing
// assertion is that both come out of createInstancedGhostMaterial: a
// reproduced recipe is how the sibling occluder_ghost_prewarm.ts twins already
// miss these ghosts.

import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { foliageGhostPrewarmDraws } from '../src/render/foliage_ghost_prewarm';
import { foliageProgramKey } from '../src/render/foliage_prewarm_twins_core';
import { InstancedOccluderGhosts } from '../src/render/instanced_occluder_ghosts';

/** A bucket-shaped source: instanced, tinted, with the foliage attribute set
 *  and a hook stack whose composed cache key the ghost clone drops. */
function bucketMesh(name: string, count = 2, extraAttribute?: string): THREE.InstancedMesh {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(9), 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(6), 2));
  geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(12), 4));
  if (extraAttribute) {
    geometry.setAttribute(extraAttribute, new THREE.BufferAttribute(new Float32Array(12), 4));
  }
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, alphaTest: 0.4 });
  material.name = name;
  material.side = THREE.DoubleSide;
  material.onBeforeCompile = () => {};
  material.customProgramCacheKey = () => `foliage-collapse|${name}`;
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(count * 3).fill(1), 3);
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  return mesh;
}

/** The material the LIVE pool really draws a ghost with. */
function liveGhostMaterial(source: THREE.InstancedMesh): THREE.Material {
  const handle = new InstancedOccluderGhosts().acquire(source, 0, new THREE.Matrix4());
  return handle.mesh.material as THREE.Material;
}

describe('foliage ghost prewarm twins', () => {
  it('builds the twin on the LIVE ghost material recipe, not a reproduction', () => {
    const source = bucketMesh('Bark_NormalTree');
    const live = liveGhostMaterial(source) as THREE.MeshStandardMaterial;
    const [twin] = foliageGhostPrewarmDraws([source]);
    const twinMat = twin.material as THREE.MeshStandardMaterial;

    expect(twinMat.customProgramCacheKey()).toBe(live.customProgramCacheKey());
    // The whole point: that key is NOT the bucket material's. A twin that
    // matched the source would be covering a program the buckets already warm.
    const src = source.material as THREE.Material;
    expect(live.customProgramCacheKey()).not.toBe(src.customProgramCacheKey());
    for (const flag of [
      'transparent',
      'depthWrite',
      'side',
      'alphaTest',
      'vertexColors',
      'fog',
      'toneMapped',
      'type',
    ] as const) {
      expect([flag, twinMat[flag]]).toEqual([flag, live[flag]]);
    }
    expect(twinMat.map).toBe(live.map);
    expect(twinMat.normalMap).toBe(live.normalMap);
  });

  it('describes the twin as the plain, uninstanced, shadowless Mesh the ghost is', () => {
    const source = bucketMesh('Bark_NormalTree');
    const [twin] = foliageGhostPrewarmDraws([source]);
    expect(twin.path.instanced).toBe(false);
    expect(twin.path.instanceColor).toBe(false);
    expect(twin.path.castShadow).toBe(false);
    expect(twin.path.receiveShadow).toBe(false);
    // The ghost mesh wears the SOURCE geometry verbatim, attributes included.
    const live = new InstancedOccluderGhosts().acquire(source, 0, new THREE.Matrix4());
    expect(twin.geometry).toBe(live.mesh.geometry);
    expect([...twin.path.attributes].sort()).toEqual(['color:4', 'normal:3', 'position:3', 'uv:2']);
    // And it is a different program from the bucket's own instanced draw.
    expect(foliageProgramKey(twin.path)).not.toBe(
      foliageProgramKey({ ...twin.path, instanced: true, instanceColor: true }),
    );
  });

  it('stays bounded: one twin per distinct source material and geometry', () => {
    const bark = bucketMesh('Bark_NormalTree');
    // A whole bucket field: many source meshes, three distinct programs.
    const sources = [
      bark,
      shareMaterialAndGeometry(bark),
      shareMaterialAndGeometry(bark),
      bucketMesh('Leaves_NormalTree'),
      bucketMesh('Bark_NormalTree'),
    ];
    const draws = foliageGhostPrewarmDraws(sources);
    expect(draws).toHaveLength(3);
    // Deduped on the SOURCE material, not on the clone (every clone is a fresh
    // uuid, so a clone-keyed dedup would mint one twin per bucket mesh).
    expect(new Set(draws.map((d) => foliageProgramKey(d.path))).size).toBe(3);
    // The same mesh handed in twice adds nothing.
    expect(foliageGhostPrewarmDraws([bark, bark, bark])).toHaveLength(1);
  });

  it('splits one material across its distinct geometries, and only those', () => {
    const a = bucketMesh('Bark_NormalTree');
    const b = new THREE.InstancedMesh(
      bucketMesh('other', 1, 'tangent').geometry,
      a.material as THREE.Material,
      1,
    );
    expect(foliageGhostPrewarmDraws([a, b])).toHaveLength(2);
    // Negative on the same dimension: same material, same attribute set, one twin.
    const c = new THREE.InstancedMesh(a.geometry, a.material as THREE.Material, 4);
    expect(foliageGhostPrewarmDraws([a, c])).toHaveLength(1);
  });

  it('mints nothing for a species that is never hideable', () => {
    // Rocks, dressing and the impostor rows are registered as buckets but never
    // enter hideRegistry, so they never reach this function and get no ghost
    // twin. An empty source set is the whole negative.
    expect(foliageGhostPrewarmDraws([])).toEqual([]);
  });
});

function shareMaterialAndGeometry(src: THREE.InstancedMesh): THREE.InstancedMesh {
  return new THREE.InstancedMesh(src.geometry, src.material as THREE.Material, 3);
}

describe('foliage ghost prewarm wiring (source pins)', () => {
  const foliage = readFileSync(new URL('../src/render/foliage.ts', import.meta.url), 'utf8');
  const ghosts = readFileSync(
    new URL('../src/render/instanced_occluder_ghosts.ts', import.meta.url),
    'utf8',
  );

  it('the live pool goes through the shared factory', () => {
    expect(ghosts).toContain('const mat = createInstancedGhostMaterial(src);');
    expect(ghosts).toContain('export function createInstancedGhostMaterial(');
    // The recipe exists exactly once: a second `transparent = true` clone site
    // in this module is a twin the prewarm cannot match.
    expect(ghosts.match(/src\.clone\(\)/g) ?? []).toHaveLength(1);
    expect(ghosts.match(/transparent = true/g) ?? []).toHaveLength(1);
  });

  it('buildFoliage publishes the ghost twins from the hideable registry only', () => {
    expect(foliage).toContain(
      'for (const draw of foliageGhostPrewarmDraws(hideableGhostSources(treeHideables))) {',
    );
    expect(foliage).toContain('drawPaths.push(draw.path);');
    expect(foliage).toContain('drawSources.set(foliageProgramKey(draw.path), {');
    // The hideable registry itself lives beside the tree fade (tree_hide_fade.ts).
    expect(
      readFileSync(new URL('../src/render/tree_hide_fade.ts', import.meta.url), 'utf8'),
    ).toContain('for (const t of trees) for (const part of t.parts) yield part.mesh;');
  });
});
