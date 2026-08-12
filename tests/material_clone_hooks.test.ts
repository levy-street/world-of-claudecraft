// Material.clone() drops onBeforeCompile while three keys its program cache on
// Material.customProgramCacheKey(), whose default IS onBeforeCompile.toString().
// A bare clone of a patched rig material therefore renders un-patched AND links
// a fresh program on its first draw. The ability-VFX body glow clones exactly
// such materials, per CharacterVisual, so that link landed on the first spec'd
// hit on every new mob rig, mid-combat.

import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { attachBiomeHaze } from '../src/render/biome_haze_field';
import { type ArmorDyeSpec, attachArmorDye } from '../src/render/characters/armor_dye';
import { addRimGlow, gfxInternalsForTest, hasRimGlow } from '../src/render/gfx';
import {
  cloneMaterialWithHooks,
  reattachClonedMaterialHooks,
} from '../src/render/material_clone_hooks';
import { applySurfaceDetail } from '../src/render/worn_stone';

// A rig material as characters/assets.ts tintedMaterial builds it on the
// standard tier: rim glow first, then the low-strength object-space worn layer.
function riggedBodyMaterial(): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ color: 0x808080 });
  mat.name = 'knight_cloth';
  addRimGlow(mat);
  applySurfaceDetail(mat, 'fabric', { strength: 0.2, objectSpace: true });
  return mat;
}

// Enough of three's PBR fragment shader for the rim patch to find its anchors.
function fragmentShaderStub(): { uniforms: Record<string, unknown>; fragmentShader: string } {
  return {
    uniforms: {},
    fragmentShader: [
      '#include <common>',
      'void main() {',
      '#include <lights_fragment_begin>',
      '}',
    ].join('\n'),
  };
}

// The rim + surface-detail layers only exist on the standard/detail tiers,
// which is exactly where the glow clone used to split the program cache.
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

describe('reattachClonedMaterialHooks', () => {
  it('reproduces the bare-clone program split it exists to fix', () => {
    const source = riggedBodyMaterial();
    const bare = source.clone();
    expect(bare.customProgramCacheKey()).not.toBe(source.customProgramCacheKey());
    // The dropped hook is the same reason the bare clone renders un-patched.
    expect(bare.onBeforeCompile).toBe(THREE.Material.prototype.onBeforeCompile);
  });

  it('restores the source program cache key exactly, so the clone reuses its program', () => {
    const source = riggedBodyMaterial();
    const clone = cloneMaterialWithHooks(source);
    expect(clone).not.toBe(source);
    expect(clone.customProgramCacheKey()).toBe(source.customProgramCacheKey());
    // Both layers are represented: the detail layer's own prefix, and the rim
    // hook it chains (surface-detail folds the previous hook's source into its
    // key, which is why the two must be re-attached in the source's order).
    expect(clone.customProgramCacheKey()).toContain('surface-detail|fabric');
    expect(clone.customProgramCacheKey()).toContain('patchPbrRimGlowFragmentShader');
  });

  it('restores the shader patch itself, not just the key', () => {
    const clone = cloneMaterialWithHooks(riggedBodyMaterial());
    const shader = fragmentShaderStub();
    clone.onBeforeCompile(shader as never, null as never);
    expect(shader.fragmentShader).toContain('uniform float uRimBoost;');
    expect(shader.uniforms.uRimBoost).toBeDefined();
  });

  it('never grants a clone a layer its source never carried', () => {
    // A plain material (no rim, no detail): the clone must stay on the stock
    // program key, or it would split the cache in the other direction.
    const plain = new THREE.MeshStandardMaterial({ color: 0x223344 });
    const clone = plain.clone();
    reattachClonedMaterialHooks(plain, clone);
    expect(hasRimGlow(clone)).toBe(false);
    expect(clone.customProgramCacheKey()).toBe(plain.customProgramCacheKey());
    expect(clone.onBeforeCompile).toBe(THREE.Material.prototype.onBeforeCompile);
  });

  it('re-attaches only the surface layer for a detail-only source', () => {
    const source = new THREE.MeshStandardMaterial({ color: 0x445566 });
    applySurfaceDetail(source, 'stone');
    const clone = cloneMaterialWithHooks(source);
    expect(hasRimGlow(clone)).toBe(false);
    expect(clone.customProgramCacheKey()).toBe(source.customProgramCacheKey());
    expect(clone.customProgramCacheKey()).toContain('surface-detail|stone');
  });
});

describe('biome-haze layer survival across the program-preserving clone', () => {
  // The stoneSlab shape (castle_features): a surfaceMat-style source carrying
  // the zone-haze hook plus the worn-stone detail layer.
  function hazedSlabMaterial(): THREE.MeshStandardMaterial {
    const mat = new THREE.MeshStandardMaterial({ color: 0x8a7568 });
    mat.name = 'castle_slab';
    attachBiomeHaze(mat);
    applySurfaceDetail(mat, 'stone', { strength: 0.4 });
    return mat;
  }

  it('documents the lying wocZoneHaze marker a bare clone carries', () => {
    const source = hazedSlabMaterial();
    const bare = source.clone();
    // clone() copies userData, so the marker claims the hook is attached on a
    // clone whose hook was silently dropped; a naive attachBiomeHaze(bare)
    // no-ops on that flag and the key stays split.
    expect((bare.userData as { wocZoneHaze?: boolean }).wocZoneHaze).toBe(true);
    attachBiomeHaze(bare);
    expect(bare.customProgramCacheKey()).not.toBe(source.customProgramCacheKey());
  });

  it('restores the haze layer and the exact program cache key on the clone', () => {
    const source = hazedSlabMaterial();
    const clone = cloneMaterialWithHooks(source);
    expect(clone.customProgramCacheKey()).toBe(source.customProgramCacheKey());
    // The detail layer chains the previous hook's source text into its key,
    // so the haze layer's presence shows as its shader identifier.
    expect(clone.customProgramCacheKey()).toContain('wocHazeVXZ');
  });

  it('never grants haze to a clone of an un-hazed source', () => {
    const source = new THREE.MeshStandardMaterial({ color: 0x97826f });
    applySurfaceDetail(source, 'stone', { strength: 0.4 });
    const clone = cloneMaterialWithHooks(source);
    expect((clone.userData as { wocZoneHaze?: boolean }).wocZoneHaze ?? false).toBe(false);
    expect(clone.customProgramCacheKey()).toBe(source.customProgramCacheKey());
  });
});

describe('the castle stone slabs use the program-preserving clone', () => {
  it('clones the surfaceMat slab sources through material_clone_hooks', () => {
    const castle = readFileSync(
      new URL('../src/render/castle_features.ts', import.meta.url),
      'utf8',
    );
    const start = castle.indexOf('const stoneSlab = (');
    expect(start).toBeGreaterThan(-1);
    const slice = castle.slice(start, castle.indexOf('const slab = (', start));
    expect(slice).toContain('cloneMaterialWithHooks(surfaceMat({ color, roughness }))');
    expect(slice).toContain('cloneMaterialWithHooks(stoneSlab(');
    expect(slice).not.toContain('.clone()');
  });
});

describe('the town ghost and independent-building clones preserve programs', () => {
  it('routes the three kit clone sites through material_clone_hooks', () => {
    // A bare clone at any of these sites drops the zone-haze hook, splits the
    // program cache key, and links a program per kit material the first time
    // a crowd arrival whips the camera across town (the measured
    // first-contact burst: village/khex/fenbridge materials linking inside
    // one frame).
    const sites = [
      ['props.ts', 'const ghostSrc = cloneMaterialWithHooks(src)'],
      ['fenbridge_town.ts', 'independent ? cloneMaterialWithHooks(shared) : shared'],
      ['eastbrook_town.ts', 'independent ? cloneMaterialWithHooks(shared) : shared'],
    ];
    for (const [file, needle] of sites) {
      const source = readFileSync(new URL(`../src/render/${file}`, import.meta.url), 'utf8');
      expect(source, `${file} lost its hook-preserving clone`).toContain(needle);
    }
  });
});

describe('the ability-VFX body glow uses the program-preserving clone', () => {
  it('clones the rig material through material_clone_hooks', () => {
    const visual = readFileSync(
      new URL('../src/render/characters/visual.ts', import.meta.url),
      'utf8',
    );
    const start = visual.indexOf('private auraGlowMaterial(');
    expect(start).toBeGreaterThan(-1);
    const method = visual.slice(start, visual.indexOf('\n  setSoulRend(', start));
    expect(method).toContain('cloneMaterialWithHooks(material)');
    expect(method).not.toContain('material.clone()');
  });
});

describe('armour-dye layer survival across the program-preserving clone', () => {
  // A two-rule colorway in the shape modular.ts authors: a steel band pinned to
  // an absolute hue, plus a cloth band rotated relative to its own hue.
  function dyeSpec(): ArmorDyeSpec {
    return {
      rules: [
        {
          ref: 999,
          band: 400,
          sat: [-2, -1, 0.18, 0.26],
          val: [0.12, 0.2, 2, 3],
          hueMode: 'abs',
          hue: 44,
          satMul: 0.2,
          satAdd: 0.42,
          valMul: 0.9,
          valAdd: 0.06,
        },
        {
          ref: 210,
          band: 46,
          sat: [0.24, 0.32, 2, 3],
          val: [-2, -1, 2, 3],
          hueMode: 'rel',
          hue: 318,
          satMul: 1.05,
          satAdd: 0,
          valMul: 1,
          valAdd: 0,
        },
      ],
    };
  }

  /** A dyed rig material exactly as characters/assets.ts buildTintedClone
   *  composes it on the standard tier: dye, then rim glow, then the low-strength
   *  object-space worn layer. */
  function dyedRigMaterial(): THREE.MeshStandardMaterial {
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff });
    mat.name = 'knight_cloth';
    attachArmorDye(mat, dyeSpec());
    addRimGlow(mat);
    applySurfaceDetail(mat, 'fabric', { strength: 0.2, objectSpace: true });
    return mat;
  }

  /** Enough of three's PBR fragment shader for the dye, rim and detail patches
   *  to all find their anchors. */
  function dyeShaderStub(): {
    uniforms: Record<string, unknown>;
    vertexShader: string;
    fragmentShader: string;
  } {
    return {
      uniforms: {},
      vertexShader: ['#include <common>', 'void main() {', '}'].join('\n'),
      fragmentShader: [
        '#include <common>',
        'void main() {',
        '#include <map_fragment>',
        '#include <lights_fragment_begin>',
        '}',
      ].join('\n'),
    };
  }

  it('reproduces the bare-clone dye loss it exists to fix', () => {
    const source = new THREE.MeshStandardMaterial({ color: 0xffffff });
    attachArmorDye(source, dyeSpec());
    const bare = source.clone();
    // clone() copies the userData spec, so the material still CLAIMS a dye...
    expect((bare.userData as { armorDye?: ArmorDyeSpec }).armorDye).toBeDefined();
    // ...while the hook that paints it, and the key that shares its program,
    // are both gone: the dyed set renders in its base atlas colours.
    expect(bare.onBeforeCompile).toBe(THREE.Material.prototype.onBeforeCompile);
    expect(bare.customProgramCacheKey()).not.toBe(source.customProgramCacheKey());
  });

  it('re-attaches the dye patch itself, uniforms and fragment rewrite', () => {
    const source = new THREE.MeshStandardMaterial({ color: 0xffffff });
    attachArmorDye(source, dyeSpec());
    const clone = cloneMaterialWithHooks(source);
    expect(clone.onBeforeCompile).not.toBe(THREE.Material.prototype.onBeforeCompile);
    const shader = dyeShaderStub();
    clone.onBeforeCompile(shader as never, null as never);
    for (const name of ['uDyeA', 'uDyeB', 'uDyeC', 'uDyeD', 'uDyeCount']) {
      expect(shader.uniforms[name], `${name} missing from the re-attached dye`).toBeDefined();
    }
    expect((shader.uniforms.uDyeCount as { value: number }).value).toBe(2);
    // The first rule's absolute hue target rides uDyeC slot 0 (val hi pair,
    // then hue, then mode): a re-attach that lost the spec would send zeros.
    expect((shader.uniforms.uDyeC as { value: number[] }).value.slice(0, 4)).toEqual([2, 3, 44, 1]);
    expect(shader.fragmentShader).toContain('uniform int uDyeCount;');
    expect(shader.fragmentShader).toContain('diffuseColor.rgb = wocSrgb2Lin(dyeOut);');
  });

  it('restores the exact program cache key of a dye-only source', () => {
    const source = new THREE.MeshStandardMaterial({ color: 0xffffff });
    attachArmorDye(source, dyeSpec());
    const clone = cloneMaterialWithHooks(source);
    expect(clone.customProgramCacheKey()).toBe(source.customProgramCacheKey());
    expect(clone.customProgramCacheKey()).toContain('woc_armor_dye|');
  });

  it('restores the key of the full rig stack: dye, then rim glow, then detail', () => {
    const source = dyedRigMaterial();
    const clone = cloneMaterialWithHooks(source);
    expect(clone.customProgramCacheKey()).toBe(source.customProgramCacheKey());
    // All three layers are visible in the composed key: worn_stone folds the
    // previous layer's LIVE key alongside its source text (the addRimGlow
    // pattern), so the dye marker rides through the rim wrapper into the
    // outermost key instead of collapsing into it.
    expect(clone.customProgramCacheKey()).toContain('surface-detail|fabric');
    expect(clone.customProgramCacheKey()).toContain('patchPbrRimGlowFragmentShader');
    expect(clone.customProgramCacheKey()).toContain('woc_armor_dye|');
    // And the patches themselves all still land on the clone.
    const shader = dyeShaderStub();
    clone.onBeforeCompile(shader as never, null as never);
    expect(shader.uniforms.uDyeCount).toBeDefined();
    expect(shader.uniforms.uRimBoost).toBeDefined();
    expect(shader.fragmentShader).toContain('uniform float uRimBoost;');
  });

  it('distinguishes a dyed from an undyed rig material of the same family', () => {
    // The collision this pins: the rim wrapper's SOURCE TEXT is the same
    // closure whatever it wraps, so a detail key composed from source text
    // alone was byte-identical for a dyed and an undyed material of the same
    // name, and three's program cache served one program for two different
    // fragment shaders. The detail layer now folds the previous LIVE key.
    const dyed = dyedRigMaterial();
    const undyed = new THREE.MeshStandardMaterial({ color: 0xffffff });
    undyed.name = 'knight_cloth';
    addRimGlow(undyed);
    applySurfaceDetail(undyed, 'fabric', { strength: 0.2, objectSpace: true });
    expect(dyed.customProgramCacheKey()).not.toBe(undyed.customProgramCacheKey());

    // And the sharing that must survive the fix: two undyed materials of the
    // same family still land on one key, so their program stays shared.
    const twin = new THREE.MeshStandardMaterial({ color: 0xffffff });
    twin.name = 'knight_cloth';
    addRimGlow(twin);
    applySurfaceDetail(twin, 'fabric', { strength: 0.2, objectSpace: true });
    expect(twin.customProgramCacheKey()).toBe(undyed.customProgramCacheKey());
  });

  it('never grants a dye to a clone of an undyed source', () => {
    const source = new THREE.MeshStandardMaterial({ color: 0x445566 });
    applySurfaceDetail(source, 'fabric', { strength: 0.2, objectSpace: true });
    const clone = cloneMaterialWithHooks(source);
    expect((clone.userData as { armorDye?: ArmorDyeSpec }).armorDye).toBeUndefined();
    expect(clone.customProgramCacheKey()).toBe(source.customProgramCacheKey());
    expect(clone.customProgramCacheKey()).not.toContain('woc_armor_dye');
  });

  it('documents the single-order limitation: a rim-then-dye source does not compose back', () => {
    // The re-attach chain replays ONE order, the one the factories use
    // (assets.ts buildTintedClone: dye, rim, detail). Nothing in the tree
    // builds the reverse, and there is no per-material record of the order to
    // replay, so a hypothetical rim-then-dye source would keep the dye (it is
    // re-attached from userData) but land on a different composed key. Pinned
    // so that a future factory ordering the layers the other way is a red
    // test rather than a silent second program link.
    const source = new THREE.MeshStandardMaterial({ color: 0xffffff });
    addRimGlow(source);
    attachArmorDye(source, dyeSpec());
    const clone = cloneMaterialWithHooks(source);
    expect((clone.userData as { armorDye?: ArmorDyeSpec }).armorDye).toBeDefined();
    expect(clone.customProgramCacheKey()).not.toBe(source.customProgramCacheKey());
  });
});

describe('the character overlay caches and the arena walls clone through the hooks', () => {
  /** The text of one class method, from its signature to the next member. */
  function methodSource(source: string, signature: string): string {
    const start = source.indexOf(signature);
    expect(start, `${signature} not found`).toBeGreaterThan(-1);
    const end = source.indexOf('\n  private ', start + signature.length);
    return source.slice(start, end === -1 ? undefined : end);
  }

  it('routes every CharacterVisual overlay-material cache through cloneMaterialWithHooks', () => {
    // These seven caches clone the rig's LIVE material, which on a dyed player
    // carries the armour-dye hook plus the rim glow and worn-detail layers. A
    // bare clone() drops all three: the set reverts to its base atlas colours
    // and links a second program the frame the effect turns on.
    const visual = readFileSync(
      new URL('../src/render/characters/visual.ts', import.meta.url),
      'utf8',
    );
    const caches = [
      'ferocityMaterial',
      'runeTintMaterial',
      'ghostMaterial',
      'soulRendMaterial',
      'shadowformMaterial',
      'moonkinMaterial',
      'ascensionMaterial',
    ];
    for (const name of caches) {
      const body = methodSource(visual, `  private ${name}(`);
      expect(body, `${name} lost its hook-preserving clone`).toContain(
        'cloneMaterialWithHooks(material)',
      );
      expect(body, `${name} went back to a bare clone`).not.toContain('.clone(');
    }
  });

  it('clones the hideable arena wall material through cloneMaterialWithHooks', () => {
    // emitArenaHideable bypasses emit() and clones the pack material per wall;
    // that material carries applySurfaceDetail(..., 'stone').
    const dungeon = readFileSync(new URL('../src/render/dungeon.ts', import.meta.url), 'utf8');
    const body = methodSource(dungeon, '  private emitArenaHideable(');
    expect(body).toContain('cloneMaterialWithHooks(base)');
    expect(body).not.toContain('.clone(');
  });
});
