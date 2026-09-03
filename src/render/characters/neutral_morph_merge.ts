// Fold the body-slider morph parts of a composed body back into the merged
// body draw when the look leaves every body slider at neutral.
//
// A composed modular body is one SkinnedMesh per PART, and mergeSkinnedParts
// (rig_merge.ts) collapses the parts it can prove safe into one draw per
// material. It refuses any part carrying morph targets, because its rebake
// would drop them silently. The nine body-region parts (torso, arms, legs,
// hands, feet) each carry a `body_<slider>_up` / `_dn` pair for the Fit Studio
// body sliders, so every one of them stayed its own draw AND its own
// Skeleton (the GLB gives every part its own skin): nine extra skinned draws,
// nine extra bone-palette updates and bone-texture uploads per pose tick, per
// composed character in the articulated band, doubled by the shadow pass.
//
// The body sliders are authoring data the in-game creator never exposes
// (appearance_customizer.ts, "No BODY_LABEL / body rows here on purpose"), so
// every legitimate look leaves them at zero: in the 2026-08-26 production
// snapshot 6,931 of 6,933 authored looks are body-neutral, and the two that
// are not carry out-of-range junk. At zero influence a morph part is bit for
// bit the same surface as its base geometry, so replacing its geometry with a
// morph-free copy changes nothing on screen and lets the merge fold it into
// the one `mod_skin_detail` draw the body wanted all along.
//
// Only the parts whose EVERY target is a body-slider target are touched: the
// face parts keep their live morphs (the face sliders are real per-instance
// input), and a look that does set a body slider skips this entirely (its
// variant is cached under its own key, see assets.ts modularVariant), so the
// authoring path is preserved bit for bit.
import type * as THREE from 'three';
import { BODY_SLIDERS, type ModularAppearance } from './modular';

/** Whether a look leaves every body slider at neutral (the production norm). */
export function bodyNeutral(app: ModularAppearance): boolean {
  const body = app.body;
  if (!body) return true;
  for (const key of BODY_SLIDERS) if ((body[key] ?? 0) !== 0) return false;
  return true;
}

/** A morph target name a body slider drives (`body_shoulders_up`, ...). */
export function isBodySliderTarget(name: string): boolean {
  return name.startsWith('body_');
}

/**
 * Replace the geometry of every skinned part under `root` whose morph
 * targets are ALL body-slider targets with a morph-free copy, so
 * mergeSkinnedParts no longer refuses it. Returns the copies it minted: they
 * belong to the caller (the variant), which disposes whichever the merge
 * leaves orphaned (a merged part's source geometry is dropped from the tree
 * but never disposed, since it is normally the parsed GLB's own buffer).
 *
 * Call it AFTER pruning to the look's part set and BEFORE mergeSkinnedParts.
 * Never call it for a look with a non-neutral body: the copies carry no
 * targets for applyMorphs to drive.
 */
export function stripNeutralBodyMorphs(root: THREE.Object3D): THREE.BufferGeometry[] {
  const minted: THREE.BufferGeometry[] = [];
  root.traverse((o) => {
    const sm = o as THREE.SkinnedMesh;
    if (!sm.isSkinnedMesh) return;
    const targets = sm.geometry.morphAttributes;
    if (!targets || Object.keys(targets).length === 0) return;
    const names = Object.keys(sm.morphTargetDictionary ?? {});
    if (names.length === 0 || !names.every(isBodySliderTarget)) return;
    const bare = sm.geometry.clone();
    bare.morphAttributes = {};
    bare.morphTargetsRelative = false;
    sm.geometry = bare;
    sm.morphTargetInfluences = undefined;
    sm.morphTargetDictionary = undefined;
    minted.push(bare);
  });
  return minted;
}

/** Dispose the minted copies that a later merge left out of the tree (their
 *  vertices now live in the merged geometry). Copies still mounted (a part the
 *  merge could not bucket) stay, and are the variant's to free on eviction. */
export function disposeOrphanedGeometries(
  root: THREE.Object3D,
  minted: readonly THREE.BufferGeometry[],
): number {
  if (minted.length === 0) return 0;
  const mounted = new Set<THREE.BufferGeometry>();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh && mesh.geometry) mounted.add(mesh.geometry);
  });
  let disposed = 0;
  for (const geo of minted) {
    if (mounted.has(geo)) continue;
    geo.dispose();
    disposed++;
  }
  return disposed;
}
