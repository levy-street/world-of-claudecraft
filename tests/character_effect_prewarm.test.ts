// A rig goes translucent by mounting a `transparent = true` clone of every one
// of its materials (characters/effect_materials.ts, driven by setGhost /
// setShadowform / setMoonkin), and three keys its program cache on that flip
// (`opaque` in WebGLPrograms.getParameters). Nothing warmed that half: the
// 2026-08-17 production capture measured it as the run's dominant live family,
// `paladin_metallic` linking for 4808 ms inside one gameplay frame plus four
// `mod_cloth` / `mod_jewel` rows at 115 to 130 ms.
//
// These cases pin the boot prewarm that links it up front, and that it links
// the SAME programs the first live effect will ask for: same hook-composed
// customProgramCacheKey, same geometry attributes, same skinning, same side.

import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  buildCharacterEffectPrewarmGroup,
  characterEffectDrawPath,
  collectCharacterEffectTargets,
} from '../src/render/character_effect_prewarm';
import {
  characterEffectPrewarmTwins,
  characterEffectProgramCount,
  characterEffectProgramKey,
} from '../src/render/character_effect_prewarm_core';
import {
  createGhostEffectMaterial,
  createMoonkinEffectMaterial,
  createShadowformEffectMaterial,
} from '../src/render/characters/effect_materials';
import { addRimGlow } from '../src/render/gfx';
import { applySurfaceDetail } from '../src/render/worn_stone';

/** The hook layers a rig material really carries (the rim glow the character
 *  factory attaches, the worn detail layer): both fold into
 *  customProgramCacheKey, which is exactly what the twin must reproduce. */
function rigMaterial(name: string): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ color: 0x8a7568, roughness: 0.7 });
  material.name = name;
  material.map = new THREE.Texture();
  addRimGlow(material);
  applySurfaceDetail(material, 'stone', { strength: 0.3 });
  return material;
}

function rigGeometry(morphs = 0): THREE.BufferGeometry {
  const geometry = new THREE.BoxGeometry(1, 2, 1);
  const count = geometry.getAttribute('position').count;
  geometry.setAttribute(
    'skinIndex',
    new THREE.Uint16BufferAttribute(new Uint16Array(count * 4), 4),
  );
  geometry.setAttribute(
    'skinWeight',
    new THREE.Float32BufferAttribute(new Float32Array(count * 4), 4),
  );
  if (morphs > 0) {
    geometry.morphAttributes.position = Array.from(
      { length: morphs },
      () => new THREE.Float32BufferAttribute(new Float32Array(count * 3), 3),
    );
  }
  return geometry;
}

function rig(
  material: THREE.Material | THREE.Material[],
  geometry = rigGeometry(),
): THREE.SkinnedMesh {
  const mesh = new THREE.SkinnedMesh(geometry, material);
  mesh.name = 'body';
  return mesh;
}

/**
 * The material-side inputs three folds into a program cache key
 * (WebGLPrograms.getParameters + getProgramCacheKeyBooleans). Two materials
 * agreeing here, on the same geometry, mesh kind and side, resolve to one
 * program.
 */
function programKeyInputs(material: THREE.Material): Record<string, unknown> {
  const standard = material as THREE.MeshStandardMaterial;
  return {
    type: material.type,
    // `opaque`, the bit the effect flips.
    opaque:
      material.transparent === false &&
      material.blending === THREE.NormalBlending &&
      material.alphaToCoverage === false,
    cacheKey: material.customProgramCacheKey(),
    defines: JSON.stringify(material.defines ?? null),
    doubleSided: material.side === THREE.DoubleSide,
    flipSided: material.side === THREE.BackSide,
    vertexColors: standard.vertexColors,
    flatShading: standard.flatShading,
    fog: (material as THREE.MeshStandardMaterial).fog,
    blending: material.blending,
    premultipliedAlpha: material.premultipliedAlpha,
    alphaTest: material.alphaTest,
    map: standard.map !== null && standard.map !== undefined,
    normalMap: standard.normalMap !== null && standard.normalMap !== undefined,
    emissiveMap: standard.emissiveMap !== null && standard.emissiveMap !== undefined,
    emissive: standard.emissive !== undefined,
  };
}

describe('the character-effect prewarm mints the twin the live effect asks for', () => {
  it('shares the live ghost clone every program-key input', () => {
    const source = rigMaterial('paladin_metallic');
    const root = new THREE.Group();
    root.add(rig(source));

    const group = buildCharacterEffectPrewarmGroup(root);
    expect(group.children).toHaveLength(1);
    const twin = (group.children[0] as THREE.Mesh).material as THREE.Material;

    // The clone the live path mounts, built by the same exported factory.
    const live = createGhostEffectMaterial(source, 'stealth');

    expect(twin.customProgramCacheKey()).toBe(live.customProgramCacheKey());
    expect(programKeyInputs(twin)).toEqual(programKeyInputs(live));
    expect(twin.transparent).toBe(true);
    expect(source.transparent).toBe(false);
    // Opacity is a uniform, never a key input: the twin need not match it.
    expect(twin.opacity).not.toBe(live.opacity);
    // The twin carries the rig's own geometry and skinning (both in the key).
    const mesh = group.children[0] as THREE.SkinnedMesh;
    expect(mesh.isSkinnedMesh).toBe(true);
    expect(mesh.geometry).toBe((root.children[0] as THREE.Mesh).geometry);
    expect(mesh.visible).toBe(false);
    expect(group.visible).toBe(false);
  });

  it('covers shadowform and moonkin with the same twin', () => {
    // The three flavours differ only in opacity, colour and emissive, none of
    // which three reads into a program cache key, so ONE twin serves them all.
    const source = rigMaterial('mod_cloth');
    const ghost = createGhostEffectMaterial(source);
    const shadowform = createShadowformEffectMaterial(source);
    const moonkin = createMoonkinEffectMaterial(source);
    expect(programKeyInputs(shadowform)).toEqual(programKeyInputs(ghost));
    expect(programKeyInputs(moonkin)).toEqual(programKeyInputs(ghost));
    // ...and they really are different LOOKS, so this is not a vacuous pin.
    expect(shadowform.opacity).not.toBe(ghost.opacity);
    expect((moonkin as THREE.MeshStandardMaterial).color.getHex()).not.toBe(
      (ghost as THREE.MeshStandardMaterial).color.getHex(),
    );
  });

  it('mints one twin per distinct PROGRAM, not per material or per rig', () => {
    const shared = rigMaterial('mod_cloth');
    const geometry = rigGeometry();
    const root = new THREE.Group();
    // Same material on two rigs, and a second material whose program-relevant
    // state is identical: all three collapse onto one twin.
    root.add(rig(shared, geometry));
    root.add(rig(shared, geometry));
    const sameProgram = rigMaterial('mod_cloth');
    root.add(rig(sameProgram, geometry));
    // A genuinely different program: morph targets are a key input.
    root.add(rig(rigMaterial('mod_jewel'), rigGeometry(7)));

    const targets = collectCharacterEffectTargets(root);
    expect(targets).toHaveLength(3); // three distinct MATERIALS
    const group = buildCharacterEffectPrewarmGroup(root);
    expect(group.children).toHaveLength(2); // two distinct PROGRAMS
  });

  it('gets both face passes of a double-sided material', () => {
    // A transparent DoubleSide material is compiled as two programs, one per
    // face pass (three's WebGLRenderer prepareMaterial splits it), which is why
    // the capture saw mod_cloth and mod_jewel link TWICE each. The twin carries
    // the source's `side`, so the same split covers it.
    const source = rigMaterial('mod_cloth');
    source.side = THREE.DoubleSide;
    const root = new THREE.Group();
    root.add(rig(source));

    const group = buildCharacterEffectPrewarmGroup(root);
    expect(group.children).toHaveLength(1);
    const twin = (group.children[0] as THREE.Mesh).material as THREE.Material;
    expect(twin.side).toBe(THREE.DoubleSide);
    expect(twin.forceSinglePass).toBe(false);

    const path = characterEffectDrawPath(
      { material: source, geometry: (root.children[0] as THREE.Mesh).geometry, skinned: true },
      twin,
    );
    expect(path.doubleSidedSplit).toBe(true);
    expect(characterEffectProgramCount([path])).toBe(2);

    // The split is three's, so pin it against three's own source: a bump that
    // drops it would silently halve this coverage.
    const renderer = readFileSync(
      new URL('../node_modules/three/src/renderers/WebGLRenderer.js', import.meta.url),
      'utf8',
    );
    const prepare = renderer.slice(
      renderer.indexOf('function prepareMaterial('),
      renderer.indexOf('this.compile = function'),
    );
    expect(prepare).toContain('material.side === DoubleSide');
    expect(prepare).toContain('material.forceSinglePass === false');
    expect(prepare).toContain('material.side = BackSide');
    expect(prepare).toContain('material.side = FrontSide');

    // A single-sided sibling of the same material is its own program.
    const single = rigMaterial('mod_cloth');
    const both = new THREE.Group();
    both.add(rig(source));
    both.add(rig(single));
    expect(buildCharacterEffectPrewarmGroup(both).children).toHaveLength(2);
  });

  it('warms nothing for a material no rig wears', () => {
    const root = new THREE.Group();
    // A plain (non-skinned) Mesh: `skinning` is a program parameter, so its
    // transparent variant is not the one any rig asks for, and no effect
    // overlay ever repaints it.
    root.add(new THREE.Mesh(rigGeometry(), rigMaterial('prop_stone')));
    // A weapon-VFX rig mesh: its shader material is owned by the weapon-skin
    // handle and stays out of the overlay cycle.
    const vfx = rig(rigMaterial('weapon_vfx'));
    vfx.userData.weaponVfxMesh = true;
    root.add(vfx);
    // An unmounted material is unreachable by construction.
    rigMaterial('never_worn');

    expect(collectCharacterEffectTargets(root)).toEqual([]);
    expect(buildCharacterEffectPrewarmGroup(root).children).toEqual([]);
  });

  it('never shadows its own twins on a second scan', () => {
    const root = new THREE.Group();
    root.add(rig(rigMaterial('mod_skin')));
    const group = buildCharacterEffectPrewarmGroup(root);
    root.add(group);
    expect(buildCharacterEffectPrewarmGroup(root).children).toHaveLength(1);
  });

  it('keeps the twin set bounded by program identity (pure core)', () => {
    const path = (over: Partial<Parameters<typeof characterEffectProgramKey>[0]> = {}) => ({
      materialKey: 'mod_cloth',
      attributes: ['position:3', 'normal:3', 'uv:2', 'skinIndex:4', 'skinWeight:4'],
      skinned: true,
      morphCounts: [0, 0, 0] as [number, number, number],
      side: 0,
      doubleSidedSplit: false,
      ...over,
    });
    // Attribute order never splits a twin...
    expect(characterEffectProgramKey(path({ attributes: ['uv:2', 'position:3'] }))).toBe(
      characterEffectProgramKey(path({ attributes: ['position:3', 'uv:2'] })),
    );
    // ...and every dimension three keys on does.
    for (const over of [
      { materialKey: 'mod_jewel' },
      { skinned: false },
      { side: 2 },
      { morphCounts: [7, 0, 0] as [number, number, number] },
      { attributes: ['position:3', 'color:4'] },
    ]) {
      expect(characterEffectProgramKey(path(over))).not.toBe(characterEffectProgramKey(path()));
    }
    expect(characterEffectPrewarmTwins([path(), path(), path({ side: 2 })])).toHaveLength(2);
  });

  it('builds the live clones through the shared factory (source pin)', () => {
    // The twin and the live clone MUST come from one recipe: a second, private
    // copy in visual.ts is exactly how the town emissive twin drifted into a
    // different cache key and warmed a program nothing asks for.
    const visual = readFileSync(
      new URL('../src/render/characters/visual.ts', import.meta.url),
      'utf8',
    );
    for (const [method, factory] of [
      ['ghostMaterial', 'createGhostEffectMaterial'],
      ['shadowformMaterial', 'createShadowformEffectMaterial'],
      ['moonkinMaterial', 'createMoonkinEffectMaterial'],
    ] as const) {
      const start = visual.indexOf(`private ${method}(material: THREE.Material)`);
      expect(start, `${method} not found in visual.ts`).toBeGreaterThan(0);
      const body = visual.slice(start, visual.indexOf('\n  }\n', start));
      expect(body, `${method} must mint through ${factory}`).toContain(`${factory}(`);
      // ...and must NOT hand-roll the transparent flip beside it.
      expect(body).not.toContain('cloneMaterialWithHooks(');
      expect(body).not.toContain('.transparent = true');
    }
    expect(visual).toContain("from './effect_materials'");
  });
});
