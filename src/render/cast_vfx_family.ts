// The cast gate's families: the pooled programs the ability-VFX painter draws
// behind it. The ENGINE family is what it draws for every class (the
// AbilityVfxFx engine pools and the Vfx particle cloud its bursts ride). The
// KIT family is the Warrior kit's pools AbilityVfxFx builds with the engine:
// several of their pieces draw with no readiness check of their own (the
// baked layers' non-strict kinds and every kind before a preparation exists,
// the solid fragments, the crests outside their authored kinds), so the gate
// is their only protection. Every other 'vfx' drawable (the bespoke class
// pools, the lazy spell stand-ins, the generic basics) keeps its compile unit
// in the same warm-up, but never holds a cast: none of them is drawn behind
// the gate.
//
// Each family is one bit: a cast waits on the families it draws from
// (ability_vfx/cast_requirements.ts), and the readiness core
// (cast_vfx_readiness_core.ts) latches one ready bit per family. A bespoke
// visual joins by one row in CAST_VFX_FAMILIES, a tag on every drawable it
// builds, and its ability ids in the requirement resolver; nothing else
// enumerates the families.
//
// A drawable joins at the site that builds it, and the tag is read off each
// object's OWN userData, like the prewarm walk's category tag, so a pool must
// tag every drawable it builds, never only a root.

import type * as THREE from 'three';
import { setRenderCategory } from './renderer_diagnostics';

export type CastVfxFamilyId = 'engine' | 'kit';

export const CAST_VFX_ENGINE = 1;
export const CAST_VFX_KIT = 2;

/** Every family, in the order the warm-up links them and the gate reads them. */
export const CAST_VFX_FAMILIES: readonly { id: CastVfxFamilyId; bit: number }[] = [
  { id: 'engine', bit: CAST_VFX_ENGINE },
  { id: 'kit', bit: CAST_VFX_KIT },
];

/** Tag a pooled drawable as cast VFX AND as a member of `family`. */
export function tagCastVfxFamily(object: THREE.Object3D, family: CastVfxFamilyId): void {
  setRenderCategory(object, 'vfx');
  object.userData.castVfxFamily = family;
}

/** Whether this object, by its own tag, is a member of `family`. */
export function inCastVfxFamily(object: THREE.Object3D, family: CastVfxFamilyId): boolean {
  return object.userData?.castVfxFamily === family;
}

/** Tag a pooled drawable as cast VFX AND as a member of the engine family. */
export function tagCastVfxEngine(object: THREE.Object3D): void {
  tagCastVfxFamily(object, 'engine');
}

/** Tag a Warrior kit pool drawable as cast VFX AND as a member of the kit family. */
export function tagCastVfxKit(object: THREE.Object3D): void {
  tagCastVfxFamily(object, 'kit');
}

/** Whether this object, by its own tag, is an engine-family drawable. */
export function inCastVfxEngine(object: THREE.Object3D): boolean {
  return inCastVfxFamily(object, 'engine');
}

/** Whether this object, by its own tag, is a kit-family drawable. */
export function inCastVfxKit(object: THREE.Object3D): boolean {
  return inCastVfxFamily(object, 'kit');
}

/** The family bit this object is tagged with, or 0. */
export function castVfxFamilyBitOf(object: THREE.Object3D): number {
  const family = object.userData?.castVfxFamily;
  for (const row of CAST_VFX_FAMILIES) if (row.id === family) return row.bit;
  return 0;
}

/** The fail-closed check a gated pool makes before it spawns: false when its
 *  family is not ready, so a cast admitted on a requirement that missed the
 *  family skips the piece instead of linking its program on a live frame. */
export interface CastVfxSpawnGate {
  allows(bit: number): boolean;
}

/** A pool built outside AbilityVfxFx (a bespoke module's own instance) or in
 *  a test answers to nothing. */
export const OPEN_CAST_VFX_SPAWN_GATE: CastVfxSpawnGate = { allows: () => true };
