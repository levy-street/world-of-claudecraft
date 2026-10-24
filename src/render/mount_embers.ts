// Embers a lantern-bearing mount sheds (MountVisualSpec.fx 'embers'): sparks struck off each
// hoof at a gallop and cinders shaken from its lanterns, emitted into the shared particle
// cloud (vfx.ts), so they cost no draw and no shader program of their own. Lantern Hall's
// destrier is the one mount that carries them.
//
// The sources are BONES on the mount's own rig, found once per mount root and cached in a
// WeakMap keyed by that root (not a new EntityView field: the view record lives in the
// renderer coordinator, under its line ratchet), so the sparks come off the hoof that actually
// struck and the cinders off the glass as it swings. The rates and the strike test are the
// pure core (mount_embers_core.ts); this module is the thin Three-side consumer.
//
// Runs only for a PRESENTED mount (mount_presentation.ts gates on it), so an offscreen or
// far-LOD horse sheds nothing; the cloud's quality level scales every rate down on a low tier.
// Cosmetic only: nothing here is information a player reacts to.

import * as THREE from 'three';
import { hoofStrikeWeight, mountEmberRates } from './mount_embers_core';
import type { MountEmberSpec } from './mount_visuals';

/** The slice of the particle cloud the embers draw into (vfx.ts implements it). */
export interface MountEmberSink {
  mountHoofSparks(at: THREE.Vector3, ratePerSec: number, dt: number): void;
  mountLanternCinders(at: THREE.Vector3, ratePerSec: number, dt: number, moving: boolean): void;
}

interface ResolvedEmbers {
  hooves: THREE.Object3D[];
  lanterns: { bone: THREE.Object3D; offset: THREE.Vector3 }[];
}

const resolved = new WeakMap<THREE.Object3D, ResolvedEmbers>();
const at = new THREE.Vector3();
const scaleScratch = new THREE.Vector3();

function resolve(root: THREE.Object3D, spec: MountEmberSpec): ResolvedEmbers {
  const cached = resolved.get(root);
  if (cached) return cached;
  const byName = new Map<string, THREE.Object3D>();
  root.traverse((object) => {
    if (!byName.has(object.name)) byName.set(object.name, object);
  });
  // a GLB that renamed a joint degrades to fewer embers, never a throw in the frame loop
  const out: ResolvedEmbers = {
    hooves: spec.hooves.map((name) => byName.get(name)).filter((b): b is THREE.Object3D => !!b),
    lanterns: spec.lanterns
      .map((l) => ({ bone: byName.get(l.bone), offset: new THREE.Vector3(...l.offset) }))
      .filter((l): l is { bone: THREE.Object3D; offset: THREE.Vector3 } => !!l.bone),
  };
  resolved.set(root, out);
  return out;
}

/** Emit this frame's embers for one presented mount. `groundY` is the world height the
 *  mount stands on (its entity root). */
export function updateMountEmbers(
  root: THREE.Object3D,
  spec: MountEmberSpec,
  sink: MountEmberSink,
  dt: number,
  moving: boolean,
  running: boolean,
  groundY: number,
): void {
  const sources = resolve(root, spec);
  const rates = mountEmberRates(moving, running);
  if (rates.hoof > 0) {
    for (const hoof of sources.hooves) {
      hoof.getWorldPosition(at);
      const weight = hoofStrikeWeight(at.y - groundY, hoof.getWorldScale(scaleScratch).y);
      if (weight > 0) sink.mountHoofSparks(at, rates.hoof * weight, dt);
    }
  }
  if (rates.lantern > 0) {
    for (const lantern of sources.lanterns) {
      at.copy(lantern.offset);
      lantern.bone.localToWorld(at);
      sink.mountLanternCinders(at, rates.lantern, dt, moving);
    }
  }
}
