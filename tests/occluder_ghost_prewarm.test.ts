// The camera-ghost fade flips `transparent`, and three derives its program
// cache key from that flip (`opaque` in WebGLPrograms.getParameters), so every
// ghosted structure carries a SECOND program that only ever links on its first
// fade. A crowd arrival whips the camera across town and fades dozens of
// structures inside one frame, which is where the measured 2.6s geared-arrival
// stall came from once the hook-preserving clones had already collapsed the
// OPAQUE half onto the source's program.
//
// These cases pin that the boot prewarm links that transparent half up front,
// and that it links the SAME key the first live fade will ask for: same
// hook-composed customProgramCacheKey, same geometry, same mesh kind.

import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { attachBiomeHaze } from '../src/render/biome_haze_field';
import { gfxInternalsForTest } from '../src/render/gfx';
import {
  applyOccluderFade,
  isOccluderGhostMaterial,
  occluderFadeMat,
} from '../src/render/occluder_fade';
import { OCCLUDER_FADE_ALPHA } from '../src/render/occluder_fade_core';
import {
  buildGhostVariantPrewarmGroup,
  collectOccluderGhostTargets,
  occluderGhostVariantKey,
} from '../src/render/occluder_ghost_prewarm';
import { applySurfaceDetail } from '../src/render/worn_stone';

// The hook layers a kit material really carries (surfaceMat attaches the zone
// haze at creation, worn_stone the detail layer): both fold into
// customProgramCacheKey, which is exactly what the twin must reproduce.
function kitMaterial(name: string): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ color: 0x8a7568, roughness: 0.8 });
  mat.name = name;
  attachBiomeHaze(mat);
  applySurfaceDetail(mat, 'stone', { strength: 0.4 });
  return mat;
}

/**
 * The material-side inputs three folds into a program cache key
 * (WebGLPrograms.getParameters + getProgramCacheKeyBooleans). Two materials
 * agreeing here, on the same geometry and mesh kind, resolve to one program.
 */
function programKeyInputs(material: THREE.Material): Record<string, unknown> {
  const standard = material as THREE.MeshStandardMaterial;
  return {
    type: material.type,
    // `opaque`, the bit the fade flips.
    opaque:
      material.transparent === false &&
      material.blending === THREE.NormalBlending &&
      material.alphaToCoverage === false,
    transparent: material.transparent,
    blending: material.blending,
    alphaToCoverage: material.alphaToCoverage,
    premultipliedAlpha: material.premultipliedAlpha,
    alphaTest: material.alphaTest,
    alphaHash: material.alphaHash,
    side: material.side,
    forceSinglePass: material.forceSinglePass,
    vertexColors: material.vertexColors,
    flatShading: standard.flatShading,
    fog: standard.fog,
    dithering: material.dithering,
    defines: JSON.stringify(material.defines ?? null),
    map: standard.map?.uuid ?? null,
    normalMap: standard.normalMap?.uuid ?? null,
    customProgramCacheKey: material.customProgramCacheKey(),
  };
}

// A ghosted structure as the hideable registries build one: a group of meshes
// whose per-structure materials went through occluderFadeMat.
function ghostedStructure(materials: readonly THREE.Material[]): {
  group: THREE.Group;
  mats: ReturnType<typeof occluderFadeMat>[];
} {
  const group = new THREE.Group();
  const mats = materials.map((material) => {
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const record = occluderFadeMat(material);
    group.add(new THREE.Mesh(geometry, record.mat));
    return record;
  });
  return { group, mats };
}

let restoreGfx: () => void = () => {};

beforeEach(() => {
  restoreGfx = gfxInternalsForTest.overrideSettings({
    standardMaterials: true,
    surfaceDetail: true,
  });
});

afterEach(() => {
  restoreGfx();
});

describe('occluderFadeMat marks its ghost materials', () => {
  it('marks every fade record it mints, whichever registry called it', () => {
    const material = kitMaterial('villageWall');
    expect(isOccluderGhostMaterial(material)).toBe(false);
    occluderFadeMat(material);
    expect(isOccluderGhostMaterial(material)).toBe(true);
  });

  it('records the authored state unchanged (the marker is not a state change)', () => {
    const material = kitMaterial('villageWall');
    const record = occluderFadeMat(material);
    expect(record.transparent).toBe(false);
    expect(record.opacity).toBe(1);
    expect(record.depthWrite).toBe(true);
  });
});

describe('collectOccluderGhostTargets', () => {
  it('reports one target per distinct ghost material with its own mesh geometry', () => {
    const wall = kitMaterial('wall');
    const roof = kitMaterial('roof');
    const { group } = ghostedStructure([wall, roof]);
    const targets = collectOccluderGhostTargets(group);
    expect(targets).toHaveLength(2);
    const meshes = group.children as THREE.Mesh[];
    expect(targets.map((t) => t.material)).toEqual([wall, roof]);
    expect(targets.map((t) => t.geometry)).toEqual([meshes[0].geometry, meshes[1].geometry]);
    expect(targets.every((t) => t.instanced === false)).toBe(true);
  });

  it('never reports a material the fade registries did not mint', () => {
    const root = new THREE.Group();
    root.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), kitMaterial('plain-shared')));
    expect(collectOccluderGhostTargets(root)).toEqual([]);
  });

  it('deduplicates a ghost material shared by several meshes of one structure', () => {
    const shared = kitMaterial('shared');
    occluderFadeMat(shared);
    const root = new THREE.Group();
    root.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), shared));
    root.add(new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), shared));
    expect(collectOccluderGhostTargets(root)).toHaveLength(1);
  });

  it('reads every slot of a multi-material mesh', () => {
    const front = kitMaterial('front');
    const back = kitMaterial('back');
    occluderFadeMat(front);
    occluderFadeMat(back);
    const root = new THREE.Group();
    root.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), [front, back]));
    expect(collectOccluderGhostTargets(root).map((t) => t.material)).toEqual([front, back]);
  });

  it('keeps the instanced flag and instance-colour flag of the live mesh', () => {
    const material = kitMaterial('wallInstanced');
    occluderFadeMat(material);
    const root = new THREE.Group();
    const instanced = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), material, 4);
    instanced.setColorAt(0, new THREE.Color(1, 1, 1));
    root.add(instanced);
    const [target] = collectOccluderGhostTargets(root);
    expect(target.instanced).toBe(true);
    expect(target.instanceColor).toBe(true);
  });

  it('ignores the twins it already built, so a rebuild cannot compound', () => {
    const { group } = ghostedStructure([kitMaterial('wall')]);
    const root = new THREE.Group();
    root.add(group);
    root.add(buildGhostVariantPrewarmGroup(root));
    expect(collectOccluderGhostTargets(root)).toHaveLength(1);
  });
});

describe('buildGhostVariantPrewarmGroup', () => {
  it('stages one hidden twin per program identity under the prewarm category', () => {
    const roof = kitMaterial('roof');
    roof.side = THREE.DoubleSide;
    const { group } = ghostedStructure([kitMaterial('wall'), roof]);
    const prewarm = buildGhostVariantPrewarmGroup(group);
    expect(prewarm.children).toHaveLength(2);
    expect(prewarm.visible).toBe(false);
    expect(prewarm.userData.renderCategory).toBe('prewarm');
  });

  it('links the key the first live fade asks for, byte for byte', () => {
    const material = kitMaterial('villageWall');
    const { group, mats } = ghostedStructure([material]);
    const prewarm = buildGhostVariantPrewarmGroup(group);
    const twin = (prewarm.children[0] as THREE.Mesh).material as THREE.Material;

    // Before the fade the twin is deliberately the OTHER variant.
    expect(programKeyInputs(twin)).not.toEqual(programKeyInputs(material));

    applyOccluderFade(mats, OCCLUDER_FADE_ALPHA);
    expect(programKeyInputs(twin)).toEqual(programKeyInputs(material));
    // The hook-composed half of the key is the part a bare clone would lose.
    expect(twin.customProgramCacheKey()).toContain('wocHazeVXZ');
    expect(twin.customProgramCacheKey()).toContain('surface-detail|stone');
  });

  it('reproduces the bare-clone split it exists to avoid', () => {
    const material = kitMaterial('villageWall');
    const bare = material.clone();
    bare.transparent = true;
    expect(bare.customProgramCacheKey()).not.toBe(material.customProgramCacheKey());
  });

  it('carries exactly the fade state applyOccluderFade sets below alpha 1', () => {
    const material = kitMaterial('wall');
    const { group } = ghostedStructure([material]);
    const twin = (buildGhostVariantPrewarmGroup(group).children[0] as THREE.Mesh)
      .material as THREE.Material;
    expect(twin.transparent).toBe(true);
    expect(twin.depthWrite).toBe(true);
    expect(twin.opacity).toBeCloseTo(material.opacity * OCCLUDER_FADE_ALPHA);
  });

  it('shares the live geometry and mesh kind, which the cache key also reads', () => {
    const plain = kitMaterial('wall');
    const instancedMat = kitMaterial('wallInstanced');
    occluderFadeMat(plain);
    occluderFadeMat(instancedMat);
    const root = new THREE.Group();
    const plainGeo = new THREE.BoxGeometry(1, 1, 1);
    const instancedGeo = new THREE.BoxGeometry(2, 2, 2);
    root.add(new THREE.Mesh(plainGeo, plain));
    root.add(new THREE.InstancedMesh(instancedGeo, instancedMat, 3));

    const twins = buildGhostVariantPrewarmGroup(root).children as THREE.Mesh[];
    expect(twins[0].geometry).toBe(plainGeo);
    expect((twins[0] as THREE.InstancedMesh).isInstancedMesh).toBeFalsy();
    expect(twins[1].geometry).toBe(instancedGeo);
    expect((twins[1] as THREE.InstancedMesh).isInstancedMesh).toBe(true);
  });

  it('leaves the live ghost materials untouched', () => {
    const material = kitMaterial('wall');
    const { group } = ghostedStructure([material]);
    const before = programKeyInputs(material);
    const twin = (buildGhostVariantPrewarmGroup(group).children[0] as THREE.Mesh)
      .material as THREE.Material;
    expect(twin).not.toBe(material);
    expect(programKeyInputs(material)).toEqual(before);
    expect(material.transparent).toBe(false);
  });
});

// The hideable registries clone their materials PER STRUCTURE, so a town is
// thousands of ghost materials over a few dozen distinct programs. Staging one
// twin each cost a measured 2.4s of extra boot compile for 38 programs, so the
// group carries one twin per program identity instead.
describe('one twin per program identity, not per ghost material', () => {
  function ghostRoot(entries: readonly [THREE.Material, THREE.BufferGeometry][]): THREE.Group {
    const root = new THREE.Group();
    for (const [material, geometry] of entries) {
      occluderFadeMat(material);
      root.add(new THREE.Mesh(geometry, material));
    }
    return root;
  }

  const box = () => new THREE.BoxGeometry(1, 1, 1);

  it('collapses per-structure clones of one kit sheet onto a single twin', () => {
    const source = kitMaterial('villageWall');
    const structures: [THREE.Material, THREE.BufferGeometry][] = [];
    for (let i = 0; i < 12; i++) structures.push([source.clone(), box()]);
    const root = ghostRoot(structures);
    expect(collectOccluderGhostTargets(root)).toHaveLength(12);
    expect(buildGhostVariantPrewarmGroup(root).children).toHaveLength(1);
  });

  it('keeps colour and texture identity out of the key (three does too)', () => {
    const a = kitMaterial('wallA');
    const b = kitMaterial('wallB');
    b.color.setHex(0x112233);
    b.map = new THREE.Texture();
    a.map = new THREE.Texture();
    expect(
      occluderGhostVariantKey({
        material: a,
        geometry: box(),
        instanced: false,
        instanceColor: false,
      }),
    ).toBe(
      occluderGhostVariantKey({
        material: b,
        geometry: box(),
        instanced: false,
        instanceColor: false,
      }),
    );
  });

  it.each([
    ['side', (m: THREE.MeshStandardMaterial) => (m.side = THREE.DoubleSide)],
    ['a map slot', (m: THREE.MeshStandardMaterial) => (m.map = new THREE.Texture())],
    ['a map channel', (m: THREE.MeshStandardMaterial) => (m.aoMap = new THREE.Texture())],
    ['vertex colours', (m: THREE.MeshStandardMaterial) => (m.vertexColors = true)],
    ['flat shading', (m: THREE.MeshStandardMaterial) => (m.flatShading = true)],
    ['alpha test', (m: THREE.MeshStandardMaterial) => (m.alphaTest = 0.5)],
    ['fog', (m: THREE.MeshStandardMaterial) => (m.fog = false)],
    ['blending', (m: THREE.MeshStandardMaterial) => (m.blending = THREE.AdditiveBlending)],
    ['premultiplied alpha', (m: THREE.MeshStandardMaterial) => (m.premultipliedAlpha = true)],
    ['dithering', (m: THREE.MeshStandardMaterial) => (m.dithering = true)],
  ])('splits on %s, which three keys a distinct program on', (_label, mutate) => {
    const plain = kitMaterial('wall');
    const changed = kitMaterial('wall');
    mutate(changed);
    const root = ghostRoot([
      [plain, box()],
      [changed, box()],
    ]);
    expect(buildGhostVariantPrewarmGroup(root).children).toHaveLength(2);
  });

  it('splits on the geometry and object facts three reads into the key', () => {
    const tangents = box();
    tangents.setAttribute('tangent', new THREE.BufferAttribute(new Float32Array(4 * 24), 4));
    const morphed = box();
    morphed.morphAttributes.position = [new THREE.BufferAttribute(new Float32Array(3 * 24), 3)];
    const plainMat = kitMaterial('a');
    const tangentMat = kitMaterial('b');
    const morphMat = kitMaterial('c');
    const instancedMat = kitMaterial('d');
    for (const m of [plainMat, tangentMat, morphMat, instancedMat]) occluderFadeMat(m);
    const root = new THREE.Group();
    root.add(new THREE.Mesh(box(), plainMat));
    root.add(new THREE.Mesh(tangents, tangentMat));
    root.add(new THREE.Mesh(morphed, morphMat));
    root.add(new THREE.InstancedMesh(box(), instancedMat, 2));
    expect(buildGhostVariantPrewarmGroup(root).children).toHaveLength(4);
  });

  it('reproduces the hook half of the key, so a lost hook is a separate twin', () => {
    const hooked = kitMaterial('wall');
    const bare = new THREE.MeshStandardMaterial({ color: 0x8a7568, roughness: 0.8 });
    const root = ghostRoot([
      [hooked, box()],
      [bare, box()],
    ]);
    expect(buildGhostVariantPrewarmGroup(root).children).toHaveLength(2);
  });
});

describe('renderer wiring for the ghost transparent variants', () => {
  const source = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');

  it('stages the twins as a resumable prewarm entry ahead of programs.compile', () => {
    const start = source.indexOf("id: 'props.ghost-fade-variants'");
    expect(start).toBeGreaterThan(-1);
    const end = source.indexOf('      {\n        id:', start + 1);
    const entry = source.slice(start, end);
    expect(entry).toContain("category: 'props'");
    expect(entry).toContain('required: false');
    expect(entry).toContain("id: 'ghost-fade-variants:group'");
    expect(entry).toContain("id: 'ghost-fade-variants:compile'");
    expect(entry).toContain(
      'await this.compilePrewarmColorPrograms(ghostVariantPrewarmGroup, false)',
    );
    expect(entry.match(/buildGhostVariantPrewarmGroup\(this\.scene\)/g)).toHaveLength(2);
    // Ordered before the monolithic compile, or the entry warms nothing.
    expect(start).toBeLessThan(source.indexOf("id: 'programs.compile'"));
  });

  it('tears the staged group out without ever disposing its materials', () => {
    expect(source).toContain(
      'if (ghostVariantPrewarmGroup) this.scene.remove(ghostVariantPrewarmGroup)',
    );
    expect(source).toContain('ghostVariantPrewarmGroup = null;');
    const hideStart = source.indexOf('const hidePrewarmArtifacts = ');
    const hideEnd = source.indexOf('const cleanupPrewarmArtifacts = ', hideStart);
    expect(source.slice(hideStart, hideEnd)).toContain('ghostVariantPrewarmGroup,');
    // A dropped programs.compile still links it from its own bounded unit.
    expect(source).toContain("['ghost-fade-variants', ghostVariantPrewarmGroup],");
  });
});
