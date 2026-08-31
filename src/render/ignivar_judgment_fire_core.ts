import {
  IGNIVAR_JUDGMENT_ARENA_RADIUS,
  IGNIVAR_JUDGMENT_SHELTER_RADIUS,
} from '../sim/ignivar_forge_judgment';

export interface IgnivarJudgmentFireSample {
  x: number;
  z: number;
}

export const IGNIVAR_JUDGMENT_FIRE_LOW_INITIAL_COUNT = 136;
export const IGNIVAR_JUDGMENT_FIRE_HIGH_INITIAL_COUNT = 288;
export const IGNIVAR_JUDGMENT_FIRE_SAFE_PADDING = 1.35;

const FIRE_LOW_RATE = 110;
const FIRE_HIGH_RATE = 230;
const FIRE_EDGE_PADDING = 1.25;
const FIRE_SAMPLE_ATTEMPTS = 12;

function normalizedQuality(quality: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(quality) ? quality : 1));
}

export function ignivarJudgmentFireInitialCount(quality: number): number {
  const q = normalizedQuality(quality);
  return Math.round(
    IGNIVAR_JUDGMENT_FIRE_LOW_INITIAL_COUNT +
      (IGNIVAR_JUDGMENT_FIRE_HIGH_INITIAL_COUNT - IGNIVAR_JUDGMENT_FIRE_LOW_INITIAL_COUNT) * q,
  );
}

export function ignivarJudgmentFireRate(quality: number): number {
  const q = normalizedQuality(quality);
  return FIRE_LOW_RATE + (FIRE_HIGH_RATE - FIRE_LOW_RATE) * q;
}

export function ignivarJudgmentFireAllowsSmoke(quality: number): boolean {
  return normalizedQuality(quality) >= 0.67;
}

export function ignivarJudgmentFireNoise(serial: number, channel: number): number {
  const value = Math.sin((serial + 1) * 12.9898 + (channel + 1) * 78.233) * 43758.5453123;
  return value - Math.floor(value);
}

export function writeIgnivarJudgmentFireSample(
  serial: number,
  safeX: number,
  safeZ: number,
  out: IgnivarJudgmentFireSample,
): boolean {
  const maxRadius = IGNIVAR_JUDGMENT_ARENA_RADIUS - FIRE_EDGE_PADDING;
  const safeRadius = IGNIVAR_JUDGMENT_SHELTER_RADIUS + IGNIVAR_JUDGMENT_FIRE_SAFE_PADDING;
  for (let attempt = 0; attempt < FIRE_SAMPLE_ATTEMPTS; attempt++) {
    const candidate = serial * FIRE_SAMPLE_ATTEMPTS + attempt;
    const radius = Math.sqrt(ignivarJudgmentFireNoise(candidate, 0)) * maxRadius;
    const angle = ignivarJudgmentFireNoise(candidate, 1) * Math.PI * 2;
    const x = Math.sin(angle) * radius;
    const z = Math.cos(angle) * radius;
    if (Math.hypot(x - safeX, z - safeZ) < safeRadius) continue;
    out.x = x;
    out.z = z;
    return true;
  }
  return false;
}
