// Type surface for scripts/assets/balgath_cyclops/arm_posture.mjs (see that file for
// behavior), so the asset suites can import it under strict tsc.
import type { Root } from '@gltf-transform/core';

export const ARM_POSTURE_CLIPS: readonly string[];
export const ELBOW_BEND_MIN: number;
export const PALM_OFF_MAX: number;

export interface ArmPostureFrame {
  side: string;
  t: number;
  elbowBend: number;
  palmOff: number;
  palmBack: number;
}

export interface ClipArmPosture {
  clip: string;
  minElbowBend: number;
  maxPalmOff: number;
  maxPalmBack: number;
  frames: ArmPostureFrame[];
}

export function clipArmPosture(root: Root, clipName: string, fps?: number): ClipArmPosture;
export function armPostureFailures(root: Root, clips?: readonly string[]): string[];

export const SEAM_GAP_MAX: number;
export const ARM_SEAM_EXCEPTIONS: readonly (readonly string[])[];
export const ARM_SEAM_FREE: { readonly start: readonly string[]; readonly end: readonly string[] };
export const ARM_SEAM_OPEN: Readonly<Record<string, number>>;
export const OFF_ARM: Readonly<Record<string, readonly string[]>>;
export const OFF_ARM_PALM_MAX: number;

export interface ArmSeam {
  clip: string;
  edge: string;
  against: string;
  gap: number;
  bone: string;
}

export interface OffArm {
  clip: string;
  side: string;
  minElbowBend: number;
  maxPalmOff: number;
}

export function armSeamReport(root: Root): ArmSeam[];
export function armSeamFailures(root: Root, limit?: number): string[];
export function offArmReport(root: Root): OffArm[];
export function offArmFailures(root: Root): string[];
