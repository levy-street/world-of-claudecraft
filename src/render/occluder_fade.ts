// Three-side half of the occluder fade: thin material records the fade
// painters share. Each record remembers a material's authored transparency
// state so a structure can fade to OCCLUDER_FADE_ALPHA while it blocks the
// eye-to-camera segment and restore itself byte-identically once the fade
// returns to 1. Materials handed in must be per-structure clones (the
// hideable registries already clone them); fading a shared material would
// fade every structure that uses it. The fade leaves shadow casting alone,
// so a ghosted structure keeps grounding the scene with its shadow.
import type * as THREE from 'three';

/** One faded material plus the authored state restored when the fade ends. */
export interface OccluderFadeMat {
  mat: THREE.Material;
  transparent: boolean;
  opacity: number;
  depthWrite: boolean;
}

/** Capture a material's authored state before its first fade. */
export function occluderFadeMat(mat: THREE.Material): OccluderFadeMat {
  return { mat, transparent: mat.transparent, opacity: mat.opacity, depthWrite: mat.depthWrite };
}

/**
 * Apply a fade alpha to a structure's materials. Below 1 the materials render
 * transparent but KEEP writing depth: the ghost's nearest surface then owns
 * each pixel, so its own back walls, interiors, and roofs cannot stack into
 * an overlapping double image (three.js sorts the transparent pass
 * back-to-front, so ghost-over-ghost still layers correctly). At exactly 1
 * the authored state is restored.
 * Flipping `transparent` at runtime MUST set `needsUpdate`: a program compiled
 * while opaque bakes an OPAQUE define that forces alpha to 1 and ignores the
 * opacity uniform entirely. The flag flips only on the fade's edge frames, so
 * the program swap (cached after the first fade) never runs per frame.
 */
export function applyOccluderFade(mats: OccluderFadeMat[], alpha: number): void {
  for (let i = 0; i < mats.length; i++) {
    const f = mats[i];
    if (alpha >= 1) {
      if (f.mat.transparent !== f.transparent) f.mat.needsUpdate = true;
      f.mat.transparent = f.transparent;
      f.mat.opacity = f.opacity;
      f.mat.depthWrite = f.depthWrite;
    } else {
      if (!f.mat.transparent) f.mat.needsUpdate = true;
      f.mat.transparent = true;
      f.mat.depthWrite = true;
      f.mat.opacity = f.opacity * alpha;
    }
  }
}
