// The Three half of Gloamveil's climbing shadow: the dormant layer every lit
// rig material carries, the form clones that rebind it without minting a
// program, and the per-rig presence that drives them. The point of the design
// is PROGRAM IDENTITY, so most pins here compare three's own cache key.
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { tintedMaterial } from '../src/render/characters/assets';
import {
  createGhostEffectMaterial,
  createMoonkinEffectMaterial,
  createShadowformEffectMaterial,
  createShadowformStandInMaterial,
} from '../src/render/characters/effect_materials';
import {
  attachGloamClimb,
  createGloamLook,
  GloamPresence,
  hasGloamClimb,
} from '../src/render/characters/gloam_climb';
import {
  GLOAM_CLIMB_MARKER,
  GLOAM_CUE_ENTER,
  GLOAM_CUE_HIDDEN,
  GLOAM_CUE_PRESENT,
  GLOAM_CUE_REST,
  GLOAM_CUE_STILL,
  GLOAM_ENTRY_SURGE,
  GLOAM_RIM_REST,
  GLOAM_STILL_CLOCK,
} from '../src/render/characters/gloam_climb_core';
import { addRimGlow, gfxInternalsForTest, sharedUniforms } from '../src/render/gfx';
import { cloneMaterialWithHooks } from '../src/render/material_clone_hooks';

vi.mock('../src/render/assets/loader', () => ({
  loadGltf: vi.fn(() => new Promise(() => undefined)),
  loadKtx2Texture: vi.fn(() => new Promise(() => undefined)),
  loadTexture: vi.fn(() => new Promise(() => undefined)),
}));
vi.mock('../src/render/assets/preload', () => ({
  registerPreload: vi.fn(),
  registerDeferredPreload: vi.fn((start: () => unknown) => start()),
}));

type Uniforms = Record<string, { value: unknown }>;

/** Run a material's hook chain over three's own shader for it, as three does. */
function compiled(material: THREE.Material): { fragmentShader: string; uniforms: Uniforms } {
  const lib = (material as THREE.MeshLambertMaterial).isMeshLambertMaterial
    ? THREE.ShaderLib.lambert
    : (material as THREE.MeshBasicMaterial).isMeshBasicMaterial
      ? THREE.ShaderLib.basic
      : THREE.ShaderLib.standard;
  const shader = {
    uniforms: {} as Uniforms,
    vertexShader: lib.vertexShader,
    fragmentShader: lib.fragmentShader,
  };
  material.onBeforeCompile(shader as never, {} as never);
  return shader;
}

/** A rig material as the standard tiers build it: the rim, then the climb. */
function rigMaterial(): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ color: 0x8899aa });
  addRimGlow(material);
  attachGloamClimb(material);
  return material;
}

describe('attachGloamClimb (the dormant layer)', () => {
  it('patches a lit material once, bound to a look that draws nothing', () => {
    for (const material of [new THREE.MeshStandardMaterial(), new THREE.MeshLambertMaterial()]) {
      expect(hasGloamClimb(material)).toBe(false);
      attachGloamClimb(material);
      expect(hasGloamClimb(material)).toBe(true);
      const hook = material.onBeforeCompile;
      attachGloamClimb(material);
      // Idempotent: a second call wraps nothing.
      expect(material.onBeforeCompile).toBe(hook);
      const shader = compiled(material);
      expect(shader.fragmentShader).toContain(GLOAM_CLIMB_MARKER);
      // w is 1 / body height: zero is "not in the form", the shader's one branch.
      expect((shader.uniforms.uGloamBody.value as THREE.Vector4).w).toBe(0);
    }
  });

  it('is a no-op on an unlit material (the class halo)', () => {
    const halo = new THREE.MeshBasicMaterial();
    const hook = halo.onBeforeCompile;
    const key = halo.customProgramCacheKey();
    attachGloamClimb(halo);
    expect(hasGloamClimb(halo)).toBe(false);
    expect(halo.onBeforeCompile).toBe(hook);
    expect(halo.customProgramCacheKey()).toBe(key);
  });

  it('shares ONE dormant uniform pair across every material', () => {
    const a = compiled(rigMaterial());
    const b = compiled(rigMaterial());
    expect(a.uniforms.uGloamBody).toBe(b.uniforms.uGloamBody);
    expect(a.uniforms.uGloamState).toBe(b.uniforms.uGloamState);
  });

  it('keys every material of one chain on one program, and a hook-preserving clone too', () => {
    const a = rigMaterial();
    const b = rigMaterial();
    expect(a.customProgramCacheKey()).toBe(b.customProgramCacheKey());
    expect(a.customProgramCacheKey()).toContain('gloam-climb|');
    const clone = cloneMaterialWithHooks(a);
    expect(hasGloamClimb(clone)).toBe(true);
    expect(clone.customProgramCacheKey()).toBe(a.customProgramCacheKey());
    expect(compiled(clone).fragmentShader).toBe(compiled(a).fragmentShader);
    // A bare clone() is the trap the helper exists for: it drops the layer and
    // lands on another program.
    const bare = a.clone();
    expect(hasGloamClimb(bare)).toBe(false);
    expect(bare.customProgramCacheKey()).not.toBe(a.customProgramCacheKey());
    // A clone never GAINS the layer its source lacked.
    const plain = new THREE.MeshStandardMaterial();
    expect(hasGloamClimb(cloneMaterialWithHooks(plain))).toBe(false);
  });

  it('rides the rig material factory on the standard tier and on the Lambert tier', () => {
    for (const standardMaterials of [true, false]) {
      const restore = gfxInternalsForTest.overrideSettings({ standardMaterials });
      try {
        const source = new THREE.MeshStandardMaterial({ color: 0x556677 });
        const tinted = tintedMaterial(source, null, 0, null, null, 'body', null, 'rig', '');
        expect(tinted).not.toBe(source);
        expect((tinted as THREE.MeshLambertMaterial).isMeshLambertMaterial === true).toBe(
          !standardMaterials,
        );
        expect(hasGloamClimb(tinted)).toBe(true);
        expect(compiled(tinted).fragmentShader).toContain(GLOAM_CLIMB_MARKER);
        // The shared source the factory clones from stays untouched.
        expect(hasGloamClimb(source)).toBe(false);
      } finally {
        restore();
      }
    }
  });
});

describe('the Shadowform stand-in (program-free)', () => {
  it('keeps the source program: same key, same shader text, same pass', () => {
    const source = rigMaterial();
    const look = createGloamLook();
    const standIn = createShadowformStandInMaterial(source, look);
    expect(standIn).not.toBe(source);
    expect(standIn.customProgramCacheKey()).toBe(source.customProgramCacheKey());
    expect(standIn.transparent).toBe(source.transparent);
    expect(standIn.transparent).toBe(false);
    expect(compiled(standIn).fragmentShader).toBe(compiled(source).fragmentShader);
    expect(standIn.userData.wocCharacterEffect).toBe('shadowform');
  });

  it("reads its own rig's climb and the form rim, not the dormant and scene pairs", () => {
    const source = rigMaterial();
    const look = createGloamLook();
    const shader = compiled(createShadowformStandInMaterial(source, look));
    expect(shader.uniforms.uGloamBody).toBe(look.body);
    expect(shader.uniforms.uGloamState).toBe(look.state);
    expect(shader.uniforms.uRimBoost).not.toBe(sharedUniforms.uRimBoost);
    expect(shader.uniforms.uRimColor).not.toBe(sharedUniforms.uRimColor);
    // The source still reads the dormant pair and the scene rim.
    const base = compiled(source);
    expect(base.uniforms.uGloamBody).not.toBe(look.body);
    expect(base.uniforms.uRimBoost).toBe(sharedUniforms.uRimBoost);
  });

  it('keeps the key pinned even where the chain reads the hook source lazily', () => {
    // A material whose first layer sat on three's default key: that default
    // reads `onBeforeCompile.toString()` at call time, so the rebind's own
    // source would leak into the key (it linked two programs live before the
    // pin). The key must still be the source's.
    const source = new THREE.MeshStandardMaterial();
    attachGloamClimb(source);
    const standIn = createShadowformStandInMaterial(source, createGloamLook());
    expect(standIn.customProgramCacheKey()).toBe(source.customProgramCacheKey());
  });

  it('gives two rigs their own uniforms on one program', () => {
    const source = rigMaterial();
    const a = createGloamLook();
    const b = createGloamLook();
    const first = createShadowformStandInMaterial(source, a);
    const second = createShadowformStandInMaterial(source, b);
    expect(first.customProgramCacheKey()).toBe(second.customProgramCacheKey());
    expect(compiled(first).uniforms.uGloamBody).toBe(a.body);
    expect(compiled(second).uniforms.uGloamBody).toBe(b.body);
  });

  it('turns the unlit halo to the look colour without wrapping its hook', () => {
    const halo = new THREE.MeshBasicMaterial({ color: 0xffd966, transparent: true });
    const look = createGloamLook();
    const standIn = createShadowformStandInMaterial(halo, look) as THREE.MeshBasicMaterial;
    // The SAME colour object: the presence dims every halo of a rig in one write.
    expect(standIn.color).toBe(look.unlit);
    expect(standIn.customProgramCacheKey()).toBe(halo.customProgramCacheKey());
    expect(halo.color.getHex()).toBe(0xffd966);
  });
});

describe('the Shadowform clone (the settled form)', () => {
  it('is the ghost clone program: solid, transparent, depth written', () => {
    const source = rigMaterial();
    const look = createGloamLook();
    const form = createShadowformEffectMaterial(source, look);
    expect(form.transparent).toBe(true);
    expect(form.depthWrite).toBe(true);
    expect(form.opacity).toBe(1);
    // One program per source for every transparent flavour: the boot twin
    // (minted through createGhostEffectMaterial) covers the form too.
    const key = form.customProgramCacheKey();
    expect(key).toBe(createGhostEffectMaterial(source).customProgramCacheKey());
    expect(key).toBe(createMoonkinEffectMaterial(source).customProgramCacheKey());
    expect(key).toBe(source.customProgramCacheKey());
    const shader = compiled(form);
    expect(shader.uniforms.uGloamBody).toBe(look.body);
    expect(shader.fragmentShader).toBe(compiled(source).fragmentShader);
  });

  it('keeps the body own colours: no tint, no emissive wash', () => {
    const source = rigMaterial();
    source.emissive.setHex(0x112233);
    const form = createShadowformEffectMaterial(source) as THREE.MeshStandardMaterial;
    expect(form.color.getHex()).toBe(source.color.getHex());
    expect(form.emissive.getHex()).toBe(0x112233);
    expect(form.emissiveIntensity).toBe(source.emissiveIntensity);
  });

  it('draws at rest when no rig drives it (the prewarm twin, a test)', () => {
    const shader = compiled(createShadowformEffectMaterial(rigMaterial()));
    const body = shader.uniforms.uGloamBody.value as THREE.Vector4;
    const state = shader.uniforms.uGloamState.value as THREE.Vector2;
    expect(body.w).toBeGreaterThan(0);
    expect(state.x).toBe(0);
    expect(state.y).toBe(GLOAM_STILL_CLOCK);
  });
});

describe('GloamPresence', () => {
  /** A rig standing at (x, y, z), its head bone `tall` yards above its feet. */
  function rig(x: number, y: number, z: number, tall: number) {
    const root = new THREE.Group();
    root.position.set(x, y, z);
    const model = new THREE.Group();
    const head = new THREE.Bone();
    head.name = 'head';
    head.position.set(0, tall, 0);
    model.add(head);
    root.add(model);
    root.updateMatrixWorld(true);
    return { root, model, head };
  }

  it('anchors the climb at the feet and measures the body by its head bone', () => {
    const { root, model } = rig(100000, 12, -40, 2.4);
    const presence = new GloamPresence();
    presence.start(root, model, false);
    const body = presence.look.body.value;
    expect([body.x, body.y, body.z]).toEqual([100000, 12, -40]);
    expect(body.w).toBeCloseTo(1 / 2.4, 12);
  });

  it('follows the rig as placed THIS frame, before three recomputes its matrices', () => {
    const { root, model } = rig(0, 0, 0, 2);
    const presence = new GloamPresence();
    presence.start(root, model, false);
    root.position.set(3, 1.5, -2);
    presence.update(1 / 60, root, model, false, false);
    const body = presence.look.body.value;
    expect([body.x, body.y, body.z]).toEqual([3, 1.5, -2]);
  });

  it('keeps the height it stood at when the body lies down or pitches forward', () => {
    const { root, model, head } = rig(0, 0, 0, 2);
    const presence = new GloamPresence();
    presence.start(root, model, false);
    head.position.set(1.8, 0.3, 0);
    root.updateMatrixWorld(true);
    presence.update(1 / 60, root, model, false, false);
    expect(presence.look.body.value.w).toBeCloseTo(0.5, 12);
  });

  it('falls back to a two yard body on a rig with no head bone', () => {
    const root = new THREE.Group();
    const model = new THREE.Group();
    root.add(model);
    const presence = new GloamPresence();
    presence.start(root, model, false);
    expect(presence.look.body.value.w).toBe(0.5);
  });

  it('plays the entry on a shift seen happening, and reports it to the floor layer once', () => {
    const { root, model } = rig(0, 0, 0, 2);
    const presence = new GloamPresence();
    expect(presence.takeCue(false, false)).toBe(GLOAM_CUE_HIDDEN);
    presence.start(root, model, true);
    // Dark over the whole body from the frame of the shift.
    expect(presence.look.state.value.x).toBe(GLOAM_ENTRY_SURGE);
    expect(presence.takeCue(false, false)).toBe(GLOAM_CUE_ENTER);
    expect(presence.takeCue(false, false)).toBe(GLOAM_CUE_PRESENT);
    for (let i = 0; i < 240; i++) presence.update(1 / 60, root, model, false, false);
    expect(presence.look.state.value.x).toBeLessThan(0.01);
  });

  it('shows the form at rest on a rig first seen already in it', () => {
    const { root, model } = rig(0, 0, 0, 2);
    const presence = new GloamPresence();
    presence.start(root, model, false);
    expect(presence.look.state.value.x).toBe(0);
    expect(presence.takeCue(false, false)).toBe(GLOAM_CUE_PRESENT);
  });

  it('hides its cue under a ghost body and never replays a shift nobody saw', () => {
    const { root, model } = rig(0, 0, 0, 2);
    const presence = new GloamPresence();
    presence.start(root, model, true);
    expect(presence.takeCue(true, false)).toBe(GLOAM_CUE_HIDDEN);
    expect(presence.takeCue(false, false)).toBe(GLOAM_CUE_PRESENT);
    presence.stop();
    expect(presence.takeCue(false, false)).toBe(GLOAM_CUE_HIDDEN);
    expect(presence.look.state.value.x).toBe(0);
  });

  it('rests its cue in water, and a shift made there is not replayed on the shore', () => {
    const { root, model } = rig(0, 0, 0, 2);
    const presence = new GloamPresence();
    presence.start(root, model, true);
    expect(presence.takeCue(false, true)).toBe(GLOAM_CUE_REST);
    expect(presence.takeCue(false, true)).toBe(GLOAM_CUE_REST);
    expect(presence.takeCue(false, false)).toBe(GLOAM_CUE_PRESENT);
  });

  it('surges with a cast and writes the live clock, or the still one under reduced motion', () => {
    const { root, model } = rig(0, 0, 0, 2);
    const presence = new GloamPresence();
    presence.start(root, model, false);
    const clock = sharedUniforms.uTime.value;
    sharedUniforms.uTime.value = 41.5;
    try {
      for (let i = 0; i < 30; i++) presence.update(1 / 60, root, model, true, false);
      expect(presence.look.state.value.x).toBeGreaterThan(0.9);
      expect(presence.look.state.value.y).toBe(41.5);
      expect(presence.takeCue(false, false)).toBe(GLOAM_CUE_PRESENT);
      presence.update(1 / 60, root, model, true, true);
      expect(presence.look.state.value.y).toBe(GLOAM_STILL_CLOCK);
      // The floor layer hears it from the rig: the still read, on every tier.
      expect(presence.takeCue(false, false)).toBe(GLOAM_CUE_STILL);
      // The form's rim is one pair for every rig: held at rest when still.
      const shader = compiled(createShadowformStandInMaterial(rigMaterial(), presence.look));
      expect(shader.uniforms.uRimBoost.value).toBe(GLOAM_RIM_REST);
    } finally {
      sharedUniforms.uTime.value = clock;
    }
  });

  it('dims the unlit halo colour with the entry and restores it', () => {
    const { root, model } = rig(0, 0, 0, 2);
    const presence = new GloamPresence();
    presence.start(root, model, false);
    const rest = presence.look.unlit.clone();
    presence.stop();
    presence.start(root, model, true);
    expect(presence.look.unlit.r).toBeLessThan(rest.r * 0.1);
    expect(presence.look.unlit.b).toBeLessThan(rest.b * 0.1);
    for (let i = 0; i < 240; i++) presence.update(1 / 60, root, model, false, false);
    expect(presence.look.unlit.getHex()).toBe(rest.getHex());
  });

  it('mints one stand-in per source and hands the same one back', () => {
    const presence = new GloamPresence();
    const source = rigMaterial();
    const mint = vi.fn(createShadowformStandInMaterial);
    const first = presence.standIn(source, mint);
    expect(presence.standIn(source, mint)).toBe(first);
    expect(mint).toHaveBeenCalledTimes(1);
    expect(mint).toHaveBeenCalledWith(source, presence.look);
    expect([...presence.standIns.values()]).toEqual([first]);
    expect(compiled(first).uniforms.uGloamBody).toBe(presence.look.body);
  });

  it('does nothing before the form starts', () => {
    const { root, model } = rig(5, 5, 5, 2);
    const presence = new GloamPresence();
    presence.update(1 / 60, root, model, true, false);
    expect(presence.look.body.value.toArray()).toEqual([0, 0, 0, 0.5]);
    expect(presence.look.state.value.x).toBe(0);
  });
});
