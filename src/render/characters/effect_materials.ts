// Gloamveil alone uses a lit transparent clone to draw after sun shafts.
// Its opaque stand-in keeps the form visible until the compile gate proves it.
// Ghost, stealth, Soul Rend and Moonkin use the shared spirit veil instead.

import type * as THREE from 'three';
import { cloneMaterialWithHooks } from '../material_clone_hooks';
import { createGloamLook, dressGloamClone, type GloamLook } from './gloam_climb';

type CharacterEffectStyle = 'shadowform';

/** userData marker every clone this module mints carries, so a factory-built
 *  variant is distinguishable from a hand-rolled one. */
const CHARACTER_EFFECT_MARKER = 'wocCharacterEffect';

type TintableMaterial = THREE.Material & {
  color?: THREE.Color;
  emissive?: THREE.Color;
  emissiveIntensity?: number;
};

/**
 * The program-relevant half of the recipe, and the only part the twin has to
 * reproduce byte for byte: the hook-preserving clone plus `transparent`.
 *
 * `depthWrite` stays ON: with it off the whole rig depth-blends against itself,
 * so back faces and far limbs shine through the chest (the x-ray the owner
 * reported on Duskveil). Writing depth lets nearer faces occlude farther ones
 * and the body reads as one uniformly faded silhouette. It is NOT a program
 * cache key input either way.
 */
function cloneTransparent(source: THREE.Material, style: CharacterEffectStyle): TintableMaterial {
  const clone = cloneMaterialWithHooks(source) as TintableMaterial;
  clone.transparent = true;
  clone.depthWrite = true;
  mark(clone, style);
  return clone;
}

function mark(clone: THREE.Material, style: CharacterEffectStyle): void {
  (clone.userData as { [CHARACTER_EFFECT_MARKER]?: CharacterEffectStyle })[
    CHARACTER_EFFECT_MARKER
  ] = style;
}

/** The look a Shadowform clone wears when no rig drives one (the prewarm
 *  twins, tests): the form at rest. */
let restLook: GloamLook | null = null;

/** The form body is solid: transparent only in the pass it draws in. */
const SHADOWFORM_OPACITY = 1;

/**
 * The Shadowform (Gloamveil) clone of `source`: the body keeps its own colours
 * and the dark climbs it from the feet, under a violet rim, both read from
 * `look` (gloam_climb.ts).
 *
 * Solid, yet `transparent`: the body draws in the transparent pass with depth
 * write on, AFTER the sun-shaft overlay (renderer.ts god rays, additive, no
 * depth test), so the dark stays deep where every opaque body in frame is
 * washed by the shafts. That is the approved look, and it is why this clone
 * carries a gated transparent program variant specific to Gloamveil.
 */
export function createShadowformEffectMaterial(
  source: THREE.Material,
  look?: GloamLook,
): THREE.Material {
  const clone = cloneTransparent(source, 'shadowform');
  clone.opacity = SHADOWFORM_OPACITY;
  restLook ??= createGloamLook();
  dressGloamClone(clone, source, look ?? restLook);
  return clone;
}

/**
 * The Shadowform stand-in for `source`: the same look on a hook-preserving
 * clone that flips nothing, so its program is the one the body is already
 * drawing with. The visual mounts it on the frame of the shift and swaps to
 * the transparent clone above once that set has linked (visual.ts
 * applyVisualMaterials), so the form never waits on a link to SHOW. It reads
 * a touch lighter than the final clone only where sun shafts cross the body.
 */
export function createShadowformStandInMaterial(
  source: THREE.Material,
  look?: GloamLook,
): THREE.Material {
  const clone = cloneMaterialWithHooks(source);
  mark(clone, 'shadowform');
  restLook ??= createGloamLook();
  dressGloamClone(clone, source, look ?? restLook);
  return clone;
}
