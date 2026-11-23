// The one per-frame write that lights every seasonal prop: the carved
// pumpkins' rind and candle, the paper lanterns, the worn pumpkin heads. Their
// glow materials are SHARED (one clone per source material, made once when the
// event's assets land), so a whole city of pumpkins and every worn head flicker
// on a handful of uniform writes per frame, never a per-instance walk. The curve
// lives in seasonal_glow_core.ts.
import type * as THREE from 'three';
import { seasonalGlowIntensity } from './seasonal_glow_core';

interface GlowEntry {
  material: THREE.MeshStandardMaterial | THREE.MeshLambertMaterial;
  base: number;
  phase: number;
}

const entries: GlowEntry[] = [];

/** Register a shared glow material (once). `phase` desyncs its flicker. */
export function registerSeasonalGlowMaterial(
  material: THREE.MeshStandardMaterial | THREE.MeshLambertMaterial,
  base: number,
  phase: number,
): void {
  if (entries.some((e) => e.material === material)) return;
  entries.push({ material, base, phase });
}

/** Drive every registered glow from the frame's night amount and time. */
export function driveSeasonalGlow(night: number, time: number): void {
  for (const e of entries) {
    e.material.emissiveIntensity = seasonalGlowIntensity(night, time, e.phase, e.base);
  }
}

/** Forget every registered glow (the kit's materials were rebuilt for a new tier). */
export function resetSeasonalGlowMaterials(): void {
  entries.length = 0;
}
