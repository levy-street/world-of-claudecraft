// Three-side half of the occluder fade: thin material records the fade
// painters share. Each record remembers a material's authored transparency
// state so a structure can fade to OCCLUDER_FADE_ALPHA while it blocks the
// eye-to-camera segment and restore itself byte-identically once the fade
// returns to 1. Materials handed in must be per-structure clones (the
// hideable registries already clone them); fading a shared material would
// fade every structure that uses it. The fade leaves shadow casting alone,
// so a ghosted structure keeps grounding the scene with its shadow.
//
// The flip to transparent is GATED (occluder_fade_gate.ts): three keys a
// second program on `transparent`, so a record's first flip asks the gate for
// its program's twin and keeps drawing opaque until that link settles.
import type * as THREE from 'three';
import {
  occluderFadeSettled,
  stepOccluderFade,
  withinOccluderFadePrefetch,
} from './occluder_fade_core';
import {
  buildOccluderFadeTwin,
  type OccluderFadeConsult,
  occluderFadeTwinReady,
} from './occluder_fade_gate';
import {
  markOccluderGhostMaterial,
  type OccluderGhostTarget,
  occluderGhostMeshVariant,
  occluderGhostTargetOf,
  occluderGhostVariantKey,
} from './occluder_ghost_variant_key';

/** One faded material plus the authored state restored when the fade ends. */
export interface OccluderFadeMat {
  mat: THREE.Material;
  transparent: boolean;
  opacity: number;
  depthWrite: boolean;
  /** The program-key context of the mesh wearing the material (geometry
   *  attributes, instancing): what the gate's twin must share to land on the
   *  program the flip will ask for. */
  geometry: THREE.BufferGeometry;
  instanced: boolean;
  instanceColor: boolean;
  /** The mesh half of that identity (occluderGhostMeshVariant), so a registry
   *  can tell a second mesh of the same material on another program apart. */
  variant: string;
  /** The fade program's identity, computed on the first gate consult. */
  key: string | null;
  /** The alpha last written to the material (1 = the authored state). */
  applied: number;
  /** The structure's fade programs were asked for ahead of its first
   *  occlusion (kept on the first record: records are per structure). */
  prefetched: boolean;
}

/** Capture a material's authored state before its first fade. `mesh` is the
 *  mesh drawing it (the first one, for a material several meshes of one
 *  structure share): its geometry and kind are part of the program identity. */
export function occluderFadeMat(mat: THREE.Material, mesh: THREE.Mesh): OccluderFadeMat {
  markOccluderGhostMaterial(mat);
  const target = occluderGhostTargetOf(mat, mesh);
  return {
    mat,
    transparent: mat.transparent,
    opacity: mat.opacity,
    depthWrite: mat.depthWrite,
    geometry: target.geometry,
    instanced: target.instanced,
    instanceColor: target.instanceColor,
    variant: occluderGhostMeshVariant(target),
    key: null,
    applied: 1,
    prefetched: false,
  };
}

/**
 * The record for `mat` as worn by `mesh`, from `mats` when one already covers
 * that (material, mesh variant), else minted and pushed. A registry that
 * shares one clone across the meshes of a structure calls this per mesh: a
 * plain mesh and an instanced one, or two geometries whose attribute sets
 * differ, draw two programs, and the gate must link BOTH before the flip.
 * Every record of a shared material writes the same material; the writes are
 * idempotent, so the flip is one program swap however many records share it.
 */
export function occluderFadeRecordFor(
  mats: OccluderFadeMat[],
  mat: THREE.Material,
  mesh: THREE.Mesh,
): OccluderFadeMat {
  const variant = occluderGhostMeshVariant(occluderGhostTargetOf(mat, mesh));
  for (let i = 0; i < mats.length; i++) {
    if (mats[i].mat === mat && mats[i].variant === variant) return mats[i];
  }
  const record = occluderFadeMat(mat, mesh);
  mats.push(record);
  return record;
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
 * Ungated on purpose (tests and the far-mode restore call it directly); the
 * painters' per-frame path is advanceOccluderFade below.
 */
export function applyOccluderFade(mats: OccluderFadeMat[], alpha: number): void {
  for (let i = 0; i < mats.length; i++) {
    const f = mats[i];
    if (alpha >= 1) {
      if (f.mat.transparent !== f.transparent) f.mat.needsUpdate = true;
      f.mat.transparent = f.transparent;
      f.mat.opacity = f.opacity;
      f.mat.depthWrite = f.depthWrite;
      f.applied = 1;
    } else {
      if (!f.mat.transparent) f.mat.needsUpdate = true;
      f.mat.transparent = true;
      f.mat.depthWrite = true;
      f.mat.opacity = f.opacity * alpha;
      f.applied = alpha;
    }
  }
}

function targetOf(f: OccluderFadeMat): OccluderGhostTarget {
  return {
    material: f.mat,
    geometry: f.geometry,
    instanced: f.instanced,
    instanceColor: f.instanceColor,
  };
}

function fadeKey(f: OccluderFadeMat): string {
  if (f.key === null) f.key = occluderGhostVariantKey(targetOf(f));
  return f.key;
}

/** The gate's mint for a record: named, so a consult passes the record and
 *  allocates no closure on the per-frame path. */
function gateTwinOf(f: OccluderFadeMat): THREE.Object3D {
  return buildOccluderFadeTwin(targetOf(f), 'ghost-fade-gate');
}

/**
 * May these records draw transparent now? Consults the gate for EVERY record
 * (never short-circuits, so a structure's whole program set is requested in
 * one frame) and is true only once all of them are warm.
 */
export function occluderFadeReady(
  mats: readonly OccluderFadeMat[],
  consult: OccluderFadeConsult,
): boolean {
  let ready = true;
  for (let i = 0; i < mats.length; i++) {
    const f = mats[i];
    if (!occluderFadeTwinReady(fadeKey(f), consult, gateTwinOf, f)) ready = false;
  }
  return ready;
}

/** Ask for a structure's fade programs ahead of its first occlusion. */
export function prefetchOccluderFade(mats: readonly OccluderFadeMat[]): void {
  occluderFadeReady(mats, 'prefetch');
}

/**
 * Stage a structure's fade programs once, unconditionally. This is the warm
 * path for hideables whose flip is DISTANCE-INDEPENDENT (the raid shells'
 * backface cull re-shows whenever the camera returns inside the plane,
 * however far the wall is), where the within-reach latch below would be the
 * wrong gate. It shares the per-structure latch with
 * prefetchOccluderFadeWithin, so whichever asks first covers both.
 */
export function stageOccluderFadeOnce(mats: readonly OccluderFadeMat[]): void {
  if (mats.length === 0 || mats[0].prefetched) return;
  mats[0].prefetched = true;
  prefetchOccluderFade(mats);
}

/**
 * The painters' per-frame prefetch: once, the first frame the structure
 * anchored at (x, z) is within OCCLUDER_FADE_PREFETCH_YD of the camera. The
 * latch lives on the structure's first record, so a painter adds one call and
 * no state; the far case costs one squared distance per structure per frame.
 */
export function prefetchOccluderFadeWithin(
  mats: readonly OccluderFadeMat[],
  x: number,
  z: number,
  camX: number,
  camZ: number,
): void {
  if (mats.length === 0 || mats[0].prefetched) return;
  if (!withinOccluderFadePrefetch(x, z, camX, camZ)) return;
  stageOccluderFadeOnce(mats);
}

/** Whether the records have `alpha` written to their materials. The writes
 *  are all-or-nothing (applyOccluderFade over the whole list, gated as a
 *  whole), so the first record answers for all of them: the settled early-out
 *  every hideable takes every frame stays one compare, not a scan. */
export function occluderFadeApplied(mats: readonly OccluderFadeMat[], alpha: number): boolean {
  return mats.length === 0 || mats[0].applied === alpha;
}

/**
 * One frame of a structure's fade: step the alpha and write it to the
 * materials, unless the write would be the flip to transparent and the gate
 * still holds the program. A held structure keeps drawing opaque while its
 * alpha keeps stepping, so the flip lands the frame the link settles, at the
 * alpha the fade has reached by then. A structure that clears the camera
 * while still held never flips at all: its alpha eases back with nothing to
 * restore, so a link landing mid-ease cannot flash it translucent. Restoring
 * to the authored state never consults the gate. Returns the new alpha;
 * settled and applied, it is free.
 */
export function advanceOccluderFade(
  mats: readonly OccluderFadeMat[],
  alpha: number,
  occluded: boolean,
  dt: number,
  reducedMotion = false,
): number {
  if (occluderFadeSettled(alpha, occluded) && occluderFadeApplied(mats, alpha)) return alpha;
  const next = stepOccluderFade(alpha, occluded, dt, reducedMotion);
  if (next < 1) {
    if (!occluded && occluderFadeApplied(mats, 1)) return next;
    // The edge frame is the actionable consult (the camera is inside this
    // structure); an ease-back after a reinstall asks like a prefetch.
    if (!occluderFadeReady(mats, occluded ? 'edge' : 'prefetch')) return next;
  }
  applyOccluderFade(mats as OccluderFadeMat[], next);
  return next;
}
