// Gloamveil's climbing shadow, the Three half: the shader layer every rig
// material carries, and the per-rig state that drives it.
//
// THE LAYER COSTS NO PROGRAM OF ITS OWN. A first version cloned each rig
// material into a climb VARIANT at the shift, which is a new program per
// material and mesh kind: 23 cold links on a priest's own body, held behind the
// effect-swap gate for 3.6 to 7 s on the first shift of a session, and out of
// reach of the boot twin (character_effect_prewarm.ts stages skinned meshes
// only, while a player's head, hair, shoulders, halo and weapon are rigid
// meshes on bones: 20 of those 23). So the climb is a layer the character
// material factory attaches to EVERY lit rig material at birth (assets.ts
// buildTintedClone), dormant behind one uniform branch. Every program a rig
// already draws with carries it, and so does the transparent variant the ghost
// run and stealth already link, which is the one the form's own clones use.
// What a body in the form changes is two uniform objects, bound per material
// (dressGloamClone).
//
// That is what lets the shift show on the frame it happens: the visual mounts
// the form on program-free stand-ins at once (effect_materials.ts
// createShadowformStandInMaterial) and swaps to the transparent set when its
// gate settles. GloamPresence holds that choice (which of the two sets a rig
// wears) along with the surge, so the visual only asks and remounts.
//
// The pure half (the tongue tables, the surge, the shader text) is
// gloam_climb_core.ts.

import * as THREE from 'three';
import { hasRimGlow, sharedUniforms } from '../gfx';
import {
  cancelGloamEntry,
  createGloamSurge,
  GLOAM_CUE_HIDDEN,
  GLOAM_RIM_REST,
  GLOAM_STILL_CLOCK,
  type GloamCue,
  gloamCue,
  gloamHaloTintInto,
  gloamRimBoost,
  patchGloamClimbFragment,
  startGloamSurge,
  stepGloamSurge,
  stopGloamSurge,
} from './gloam_climb_core';

/** The class halo (an unlit ring over the head) turns this violet with the form. */
const GLOAM_HALO_HEX = 0x6a48c8;
const GLOAM_RIM_HEX = 0x7a4ce0;

/** What one rig in the form shares between its materials. */
export interface GloamLook {
  /** Feet anchor (world x, y, z) and 1 / body height; w 0 is "not in the form". */
  body: { value: THREE.Vector4 };
  /** Surge (0 rest, 1 mid-cast, above 1 during the entry) and the tongue clock. */
  state: { value: THREE.Vector2 };
  /** The colour every unlit piece of the rig (the class halo) wears, dimmed
   *  with the entry. */
  unlit: THREE.Color;
}

/** The pair every rig material binds until a form clone rebinds it: dormant. */
const DORMANT = {
  body: { value: new THREE.Vector4(0, 0, 0, 0) },
  state: { value: new THREE.Vector2(0, 0) },
};

/**
 * The edge glow of every rig in the form: the character rim each rig material
 * already carries (gfx.ts addRimGlow), fed from this pair instead of the shared
 * scene pair. One write per frame serves them all.
 */
const formRim = {
  boost: { value: GLOAM_RIM_REST },
  color: { value: new THREE.Color(GLOAM_RIM_HEX) },
};

const climbMaterials = new WeakSet<THREE.Material>();

function isLit(material: THREE.Material): boolean {
  const m = material as THREE.MeshStandardMaterial & THREE.MeshLambertMaterial;
  return m.isMeshStandardMaterial === true || m.isMeshLambertMaterial === true;
}

/**
 * Attach the dormant climb layer to a lit rig material. Idempotent, and a no-op
 * on an unlit material. Shaped like the rim glow (gfx.ts addRimGlow): the key
 * chains the hooks under it, so every material of one chain shares a program
 * and a hook-preserving clone lands on it too.
 */
export function attachGloamClimb(material: THREE.Material): void {
  if (!isLit(material) || climbMaterials.has(material)) return;
  climbMaterials.add(material);
  const previousCompile = material.onBeforeCompile;
  const previousCompileSource = previousCompile.toString();
  const previousProgramKey = material.customProgramCacheKey.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    previousCompile.call(material, shader, renderer);
    const patched = patchGloamClimbFragment(shader.fragmentShader);
    if (patched === shader.fragmentShader) return;
    shader.uniforms.uGloamBody = DORMANT.body;
    shader.uniforms.uGloamState = DORMANT.state;
    shader.fragmentShader = patched;
  };
  material.customProgramCacheKey = () =>
    `gloam-climb|${previousCompileSource}|${previousProgramKey()}`;
}

/** True when attachGloamClimb patched this exact material instance. */
export function hasGloamClimb(material: THREE.Material): boolean {
  return climbMaterials.has(material);
}

/** Put the layer back on a `Material.clone()`, which drops onBeforeCompile
 *  (material_clone_hooks.ts): only when the source carried it. */
export function reattachGloamClimbToClone(source: THREE.Material, clone: THREE.Material): void {
  if (climbMaterials.has(source)) attachGloamClimb(clone);
}

/** A look with nothing driving it yet: at rest, on a body two yards tall. */
export function createGloamLook(): GloamLook {
  return {
    body: { value: new THREE.Vector4(0, 0, 0, 0.5) },
    state: { value: new THREE.Vector2(0, GLOAM_STILL_CLOCK) },
    unlit: new THREE.Color(GLOAM_HALO_HEX),
  };
}

/**
 * Dress a hook-preserving clone of `source` as one rig's form material: an
 * unlit piece takes the form's colour, and a lit material reads this rig's
 * climb and the form's rim instead of the dormant and scene pairs.
 *
 * EVERY unlit (MeshBasicMaterial) clone is recoloured, and that is safe only
 * because the class halo is the one unlit piece a rig that can hold the form
 * carries. Checked: `form_shadow` is applied by the priest's own ability and
 * nothing else, so only a player-class rig wears it; a priest's material set
 * holds one MeshBasicMaterial, the halo, on the standard and the Lambert arm
 * alike (the factory keeps a material unlit only when its GLB authored it so,
 * and no character or weapon file does). The other unlit rig pieces belong to
 * rigs that never take the form: the eye glow and the Eye Ward marker's ring
 * (three boss defs), the training effigy's flames, a boss gesture's charge
 * glow. If a rig that can hold the form ever gains a second unlit piece that
 * means something (a marker, a debuff ring), recolour by identity instead of
 * by material type here, or the form will repaint it.
 *
 * The rebind runs after the clone's own hook chain and changes no shader text,
 * so the clone must keep its source's program. Its key is therefore PINNED to
 * the value it has before the rebind is installed: a layer chain whose first
 * layer sat on three's default key reads `onBeforeCompile.toString()` lazily,
 * so the rebind's own source would otherwise leak into the key and mint a
 * program per material (measured: the staff and one armor atlas linked live on
 * the first shift before this pin).
 */
export function dressGloamClone(
  clone: THREE.Material,
  source: THREE.Material,
  look: GloamLook,
): void {
  const basic = clone as THREE.MeshBasicMaterial;
  if (basic.isMeshBasicMaterial && basic.color) basic.color = look.unlit;
  if (!hasRimGlow(source) && !climbMaterials.has(source)) return;
  const key = clone.customProgramCacheKey();
  const compile = clone.onBeforeCompile;
  clone.onBeforeCompile = (shader, renderer) => {
    compile.call(clone, shader, renderer);
    if (shader.uniforms.uGloamBody) {
      shader.uniforms.uGloamBody = look.body;
      shader.uniforms.uGloamState = look.state;
    }
    if (shader.uniforms.uRimBoost) {
      shader.uniforms.uRimBoost = formRim.boost;
      shader.uniforms.uRimColor = formRim.color;
    }
  };
  clone.customProgramCacheKey = () => key;
}

const haloTint: [number, number, number] = [1, 1, 1];

/** What a rig's frame state tells the form (the visual's own anim state fits). */
export interface GloamFrameState {
  casting: boolean;
  swimming?: boolean;
}

/**
 * Everything one rig's Gloamveil needs each frame: where its feet are, how tall
 * it stands, the cast surge and the entry, and which of the two clone sets the
 * rig wears (the stand-ins or the settled transparent set). The pool and the
 * smoke are not here: they are world-space and belong to the renderer's Vfx
 * (gloam_field.ts), which learns what it needs from takeCue.
 */
export class GloamPresence {
  readonly look = createGloamLook();
  /** The program-free clones this rig shows while its transparent form set
   *  links and while it swims, one per source material. The visual owns their
   *  disposal with its other effect clones. */
  readonly standIns = new Map<THREE.Material, THREE.Material>();
  private readonly surge = createGloamSurge();
  private headBone: THREE.Object3D | null | undefined;
  private active = false;
  private entryPending = false;
  /** An update has run since the form began: the entry was presented. */
  private presented = false;
  /** The viewer asked for reduced motion (as of the last update). */
  private still = false;
  /** The body is in the water (as of the last frame). */
  private inWater = false;
  /** The rig wears the stand-ins: the settled set is linking, or it swims. */
  private standsIn = false;
  /** The settled set was asked for since the last `release`: the form is the
   *  effect this rig shows, whatever outranks what in the visual. */
  private settledAsked = false;

  /** `mintStandIn` builds the stand-in clone of one source material
   *  (effect_materials.ts createShadowformStandInMaterial). */
  constructor(
    private readonly mintStandIn: (source: THREE.Material, look: GloamLook) => THREE.Material,
  ) {}

  /** The form began or ended on the rig under `root`. `entering` is false for
   *  a rig first seen already in it, which shows the form at rest. */
  shift(on: boolean, root: THREE.Object3D, model: THREE.Object3D, entering: boolean): void {
    this.inWater = false;
    this.standsIn = false;
    if (on) this.start(root, model, entering);
    else this.stop();
  }

  /** The form began on the rig under `root`. */
  start(root: THREE.Object3D, model: THREE.Object3D, entering: boolean): void {
    this.active = true;
    this.entryPending = entering;
    this.presented = false;
    startGloamSurge(this.surge, entering);
    // Placed at once: the form materials mount on this same edge.
    this.drive(0, root, model, false, this.still);
  }

  /**
   * A frame in which the rig is presented. True when the body entered or left
   * the water: the visual remounts, since a swimmer wears the stand-ins.
   */
  frame(
    dt: number,
    root: THREE.Object3D,
    model: THREE.Object3D,
    state: GloamFrameState,
    reducedMotion: boolean,
  ): boolean {
    this.update(dt, root, model, state.casting, reducedMotion);
    const swimming = state.swimming === true;
    if (!this.active || swimming === this.inWater) return false;
    this.inWater = swimming;
    return true;
  }

  /**
   * A frame in which the rig is NOT presented (off screen, culled). The form's
   * time still passes: an entry nobody saw start is called off, and one under
   * way runs on, so a body never comes back into view to play a shift that
   * happened while nobody was looking.
   */
  idle(dt: number): void {
    if (!this.active) return;
    if (this.entryPending) {
      this.entryPending = false;
      cancelGloamEntry(this.surge);
    }
    this.look.state.value.x = stepGloamSurge(this.surge, dt, false, this.still);
  }

  update(
    dt: number,
    root: THREE.Object3D,
    model: THREE.Object3D,
    casting: boolean,
    reducedMotion: boolean,
  ): void {
    if (!this.active) return;
    // The floor layer hears of an entry on the frame the rig first presents
    // it. A cue nobody asked for by the next one (the body was dead, or under
    // an effect that outranks the form) is not kept for later.
    if (this.presented) this.entryPending = false;
    this.presented = true;
    this.drive(dt, root, model, casting, reducedMotion);
  }

  private drive(
    dt: number,
    root: THREE.Object3D,
    model: THREE.Object3D,
    casting: boolean,
    reducedMotion: boolean,
  ): void {
    this.still = reducedMotion;
    if (this.headBone === undefined) this.headBone = model.getObjectByName('head') ?? null;
    const body = this.look.body.value;
    if (this.headBone) {
      // Both read as last drawn, so the pair agrees mid-jump.
      const tall = this.headBone.matrixWorld.elements[13] - root.matrixWorld.elements[13];
      // A body lying down or pitched forward keeps the height it stood at.
      if (tall > 0.5) body.w = 1 / tall;
    }
    // The feet as they will be drawn THIS frame: the renderer has already
    // placed the body, and a stale anchor would trail a jump by a frame.
    root.updateWorldMatrix(true, false);
    const m = root.matrixWorld.elements;
    body.x = m[12];
    body.y = m[13];
    body.z = m[14];
    const surge = stepGloamSurge(this.surge, dt, casting, reducedMotion);
    const seconds = sharedUniforms.uTime.value;
    this.look.state.value.set(surge, reducedMotion ? GLOAM_STILL_CLOCK : seconds);
    gloamHaloTintInto(surge, haloTint);
    this.look.unlit.setHex(GLOAM_HALO_HEX);
    this.look.unlit.r *= haloTint[0];
    this.look.unlit.g *= haloTint[1];
    this.look.unlit.b *= haloTint[2];
    formRim.boost.value = gloamRimBoost(seconds, reducedMotion);
  }

  /**
   * The visual is about to work out what this rig mounts: start from the
   * settled set, unless the body swims (a body in the transparent pass would
   * draw over the water it is in, so a swimmer keeps the stand-ins).
   */
  release(): void {
    this.standsIn = this.inWater;
    this.settledAsked = false;
  }

  /**
   * The set the visual just worked out has clones still to link. When the
   * form is what this rig shows it wears the stand-ins meanwhile, which cost
   * no link: true, and the visual mounts them now. `release` ends it.
   */
  holdStandIns(): boolean {
    if (!this.settledAsked) return false;
    this.standsIn = true;
    return true;
  }

  /**
   * The stand-in for `source` while the rig wears them, minted once; null
   * when it wears the settled set (the visual then hands out its own clone).
   */
  standInFor(source: THREE.Material): THREE.Material | null {
    if (!this.standsIn) {
      this.settledAsked = true;
      return null;
    }
    let clone = this.standIns.get(source);
    if (!clone) {
      clone = this.mintStandIn(source, this.look);
      this.standIns.set(source, clone);
    }
    return clone;
  }

  /**
   * This frame's cue for the floor and smoke layer. The entry is reported at
   * most once, on the first frame asked: a shift nobody could see (the body
   * was ghosted, or in the water) is not replayed when the body shows again.
   */
  takeCue(ghosted: boolean): GloamCue {
    if (!this.active) return GLOAM_CUE_HIDDEN;
    const cue = gloamCue(true, ghosted, this.entryPending, this.inWater);
    this.entryPending = false;
    return cue;
  }

  /** The form ended, or the rig is going away. */
  stop(): void {
    this.active = false;
    this.entryPending = false;
    stopGloamSurge(this.surge);
    this.look.state.value.x = 0;
  }
}
