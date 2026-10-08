// Type surface for scripts/assets/balgath_cyclops/arm_jitter.mjs (see that file for
// behavior), so the asset suites can import it under strict tsc.
import type { Root } from '@gltf-transform/core';

export const ARM_JITTER_BONES: readonly string[];
export const ARM_TREMOR_LIMIT: number;
export const ARM_JITTER_FPS: number;

export interface RotationJitter {
  maxAccel: number;
  accelFrame: number;
  tremor: number;
  tremorFrame: number;
}

export interface ClipArmJitter {
  clip: string;
  duration: number;
  bones: Record<string, RotationJitter>;
  worst: { bone: string; tremor: number; t: number; maxAccel: number };
}

export function rotationJitter(qs: ReadonlyArray<readonly number[]>): RotationJitter;
export function clipArmJitter(root: Root, clipName: string, fps?: number): ClipArmJitter;
export function armJitterReport(root: Root): ClipArmJitter[];
export function armJitterFailures(report: ClipArmJitter[], limit?: number): string[];
