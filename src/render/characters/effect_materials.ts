// The transparent-clone recipe every character effect overlay shares.
//
// `setGhost` (stealth, the spirit run, visions, ghost wolf, the spirit healer,
// the veilbound march), `setShadowform` and `setMoonkin` all mount a clone of
// the rig's live material with `transparent = true`. Three keys its program
// cache on that flip (`opaque` in WebGLPrograms.getParameters), so each of
// those clones is a SECOND program per rig material, and a production capture
// measured them linking cold inside a gameplay frame in a crowd
// (`paladin_metallic` 4808 ms, `mod_cloth` and `mod_jewel` 115 to 130 ms each).
//
// The recipe lives here, in one exported factory per flavour, so the boot
// prewarm twin (character_effect_prewarm.ts) mints the SAME clone the live
// path mounts and the two cannot drift into different program keys.
//
// The three flavours differ ONLY in opacity, base colour and emissive, none of
// which three reads into a program cache key: they resolve to ONE program per
// source material, which is why the prewarm group carries one twin for all
// three.
//
// Every clone goes through cloneMaterialWithHooks for the reason
// material_clone_hooks.ts spells out: a bare clone() drops onBeforeCompile, so
// it renders without the rim glow, the worn detail layer and the player's
// armour dye, AND links a whole new program because three's cache key defaults
// to `onBeforeCompile.toString()`.

import * as THREE from 'three';
import { cloneMaterialWithHooks } from '../material_clone_hooks';

/** Translucent-rig flavor: 'spirit' is the thin ghost run (released spirits,
 *  ghost wolf, the graveyard angel); 'stealth' is the denser Duskveil fade. */
export type GhostStyle = 'spirit' | 'stealth';

/** Every overlay that flips `transparent` on a rig material. */
type CharacterEffectStyle = GhostStyle | 'shadowform' | 'moonkin';

const GHOST_OPACITY = 0.34;
// Stealth (Duskveil/Smokestep) reads as a faded-but-solid silhouette, a touch
// denser than the spirit run's 0.34 (owner: stealth was "too transparent").
const STEALTH_OPACITY = 0.45;
const SHADOWFORM_OPACITY = 0.9;
const SHADOWFORM_TINT = new THREE.Color(0x5a2a8f);
const SHADOWFORM_EMISSIVE_HEX = 0x2a0a4a;
const SHADOWFORM_EMISSIVE_INTENSITY = 0.4;
// Moonkin Form: a brighter, more luminous violet than the ghost run (owner's brief: a
// purplish tint like ghost form but a bit brighter).
const MOONKIN_OPACITY = 0.72;
const MOONKIN_TINT = new THREE.Color(0x9d6bff);
const MOONKIN_EMISSIVE_HEX = 0x6a3fd0;
const MOONKIN_EMISSIVE_INTENSITY = 0.55;

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
  (clone.userData as { [CHARACTER_EFFECT_MARKER]?: CharacterEffectStyle })[
    CHARACTER_EFFECT_MARKER
  ] = style;
  return clone;
}

/** The ghost run / stealth fade clone of `source`. */
export function createGhostEffectMaterial(
  source: THREE.Material,
  style: GhostStyle = 'spirit',
): THREE.Material {
  const clone = cloneTransparent(source, style);
  clone.opacity = ghostEffectOpacity(style);
  return clone;
}

/** The opacity a ghost clone wears for `style` (rewritten in place on a flip:
 *  stealth to death to ghost run reuses the same clones). */
export function ghostEffectOpacity(style: GhostStyle): number {
  return style === 'stealth' ? STEALTH_OPACITY : GHOST_OPACITY;
}

/** The Shadowform clone of `source`. */
export function createShadowformEffectMaterial(source: THREE.Material): THREE.Material {
  const clone = cloneTransparent(source, 'shadowform');
  clone.opacity = SHADOWFORM_OPACITY;
  if (clone.color) clone.color.copy(SHADOWFORM_TINT);
  if (clone.emissive) {
    clone.emissive.setHex(SHADOWFORM_EMISSIVE_HEX);
    clone.emissiveIntensity = Math.max(clone.emissiveIntensity ?? 0, SHADOWFORM_EMISSIVE_INTENSITY);
  }
  return clone;
}

/** The Moonkin Form clone of `source`. */
export function createMoonkinEffectMaterial(source: THREE.Material): THREE.Material {
  const clone = cloneTransparent(source, 'moonkin');
  clone.opacity = MOONKIN_OPACITY;
  if (clone.color) clone.color.copy(MOONKIN_TINT);
  if (clone.emissive) {
    clone.emissive.setHex(MOONKIN_EMISSIVE_HEX);
    clone.emissiveIntensity = Math.max(clone.emissiveIntensity ?? 0, MOONKIN_EMISSIVE_INTENSITY);
  }
  return clone;
}
