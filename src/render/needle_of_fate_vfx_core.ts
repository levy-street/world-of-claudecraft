import {
  PROJECTILE_MAX_FLIGHT,
  PROJECTILE_REACH,
  PROJECTILE_SPEED,
} from '../sim/projectile_travel';

export const NEEDLE_OF_FATE_SPEED = PROJECTILE_SPEED;
export const NEEDLE_OF_FATE_REACH = PROJECTILE_REACH;
export const NEEDLE_OF_FATE_MAX_FLIGHT = PROJECTILE_MAX_FLIGHT;
export const NEEDLE_OF_FATE_RELEASE_SECONDS = 0.34;
export const NEEDLE_OF_FATE_IMPACT_SECONDS = 0.9;

export interface NeedleSpellFxEvent {
  fx: string;
  ability?: string;
}

export function isNeedleOfFateProjectile(event: NeedleSpellFxEvent): boolean {
  return event.fx === 'projectile' && event.ability === 'needle_of_fate';
}

export interface NeedleFlightPlan {
  step: number;
  spin: number;
  glow: number;
  distortion: number;
  coil: number;
}

export interface NeedleImpactPlan {
  visible: boolean;
  opacity: number;
  scale: number;
  irisScale: number;
  rotation: number;
  shockwaveOpacity: number;
  shockwaveScale: number;
  sparkDistance: number;
  pillarOpacity: number;
}

export interface NeedleWindupPlan {
  visible: boolean;
  progress: number;
  opacity: number;
  eyeScale: number;
  orbit: number;
  runeLift: number;
  pulse: number;
}

export interface NeedleReleasePlan {
  visible: boolean;
  opacity: number;
  ringScale: number;
  rotation: number;
}

export function createNeedleFlightPlan(): NeedleFlightPlan {
  return { step: 0, spin: 0, glow: 1, distortion: 0, coil: 0 };
}

export function createNeedleImpactPlan(): NeedleImpactPlan {
  return {
    visible: false,
    opacity: 0,
    scale: 1,
    irisScale: 1,
    rotation: 0,
    shockwaveOpacity: 0,
    shockwaveScale: 1,
    sparkDistance: 0,
    pillarOpacity: 0,
  };
}

export function createNeedleWindupPlan(): NeedleWindupPlan {
  return {
    visible: false,
    progress: 0,
    opacity: 0,
    eyeScale: 0.6,
    orbit: 0,
    runeLift: 0,
    pulse: 1,
  };
}

export function createNeedleReleasePlan(): NeedleReleasePlan {
  return { visible: false, opacity: 0, ringScale: 0.5, rotation: 0 };
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function smoothstep(value: number): number {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
}

export function writeNeedleFlightPlan(
  out: NeedleFlightPlan,
  remainingDistance: number,
  dt: number,
  age: number,
  reducedMotion: boolean,
): NeedleFlightPlan {
  out.step = Math.min(Math.max(0, remainingDistance), NEEDLE_OF_FATE_SPEED * Math.max(0, dt));
  out.spin = reducedMotion ? 0 : age * 13.5;
  out.glow = reducedMotion ? 1 : 1 + Math.sin(age * 24) * 0.2;
  out.distortion = reducedMotion ? 0 : 0.12 + Math.sin(age * 31) * 0.06;
  out.coil = reducedMotion ? 0 : age * 17;
  return out;
}

export function writeNeedleWindupPlan(
  out: NeedleWindupPlan,
  elapsed: number,
  duration: number,
  reducedMotion: boolean,
): NeedleWindupPlan {
  const progress = clamp01(elapsed / Math.max(0.05, duration));
  const enter = smoothstep(Math.min(1, progress / 0.18));
  out.visible = elapsed >= 0;
  out.progress = progress;
  out.opacity = reducedMotion ? 1 : enter;
  out.eyeScale = reducedMotion ? 1.18 : 0.78 + progress * 0.84 + Math.sin(elapsed * 15) * 0.08;
  out.orbit = reducedMotion ? 0 : progress * Math.PI * 4.5;
  out.runeLift = reducedMotion ? 0 : progress * 0.7;
  out.pulse = reducedMotion ? 1 : 1 + Math.sin(elapsed * 18) * 0.12;
  return out;
}

export function writeNeedleReleasePlan(
  out: NeedleReleasePlan,
  elapsed: number,
  reducedMotion: boolean,
): NeedleReleasePlan {
  const progress = clamp01(elapsed / NEEDLE_OF_FATE_RELEASE_SECONDS);
  const enter = smoothstep(Math.min(1, progress / 0.16));
  const leave = 1 - smoothstep(Math.max(0, (progress - 0.3) / 0.7));
  out.visible = elapsed >= 0 && progress < 1;
  out.opacity = enter * leave;
  out.ringScale = reducedMotion ? 1.35 : 0.55 + progress * 2.6;
  out.rotation = reducedMotion ? 0 : progress * Math.PI * 1.4;
  return out;
}

export function writeNeedleImpactPlan(
  out: NeedleImpactPlan,
  elapsed: number,
  reducedMotion: boolean,
): NeedleImpactPlan {
  const progress = clamp01(elapsed / NEEDLE_OF_FATE_IMPACT_SECONDS);
  const enter = smoothstep(Math.min(1, progress / 0.12));
  const leave = 1 - smoothstep(Math.max(0, (progress - 0.46) / 0.54));
  out.visible = progress < 1;
  out.opacity = enter * leave;
  out.scale = reducedMotion ? 1 : 0.76 + enter * 0.58 + Math.sin(progress * Math.PI) * 0.18;
  out.irisScale = reducedMotion ? 1 : 0.78 + Math.sin(progress * Math.PI) * 0.74;
  out.rotation = reducedMotion ? 0 : progress * Math.PI * 0.7;
  out.shockwaveOpacity = enter * (1 - smoothstep(progress / 0.72));
  out.shockwaveScale = reducedMotion ? 2.4 : 0.5 + progress * 4.8;
  out.sparkDistance = reducedMotion ? 0.9 : 0.2 + progress * 3.1;
  out.pillarOpacity = enter * (1 - smoothstep(Math.max(0, (progress - 0.12) / 0.72))) * 0.92;
  return out;
}
