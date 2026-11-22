// Authored Dawnfall timing and radial paths. No gameplay delay or random state.
export const DAWNFALL_DURATION = 0.9;
export const DAWNFALL_CAST_CAPACITY = 6;
export const DAWNFALL_CONTACT_CAPACITY = 24;
export const DAWNFALL_FLOOR_LAYERS = 5;
export const DAWNFALL_WAVE_CRESTS = 3;
export const DAWNFALL_WAVE_SEGMENTS = 128;
/** Rising embers released where the crests pass; always drawn last. */
export const DAWNFALL_MOTES = 24;
/** Glow beam, hot core beam and the landing flare, then the embers. */
export const DAWNFALL_BILLBOARDS = 3 + DAWNFALL_MOTES;
export const DAWNFALL_VERTICES =
  (DAWNFALL_BILLBOARDS +
    DAWNFALL_WAVE_SEGMENTS * 2 * DAWNFALL_WAVE_CRESTS +
    DAWNFALL_FLOOR_LAYERS * 8 * 8) *
  6;
export interface DawnfallWave {
  radius: number;
  height: number;
  alpha: number;
}
export function dawnfallRadius(value: number): number {
  return Number.isFinite(value) ? Math.max(0.1, Math.min(30, value)) : 6;
}
export function dawnfallEnvelope(age: number, end = DAWNFALL_DURATION): number {
  if (age < 0 || age >= end) return 0;
  return Math.min(1, (age + 0.018) / 0.065) * (1 - age / end) ** 1.6;
}
/** Three staggered breaking crests cross the footprint, then collapse. */
export function sampleDawnfallWave(
  age: number,
  radius: number,
  reduced: boolean,
  out: DawnfallWave,
  crest = 0,
): void {
  const localAge = age - crest * 0.055;
  const progress = Math.min(1, Math.max(0, localAge / 0.3));
  out.radius = radius * (reduced ? 0.9 - crest * 0.2 : 0.18 + 0.76 * (1 - (1 - progress) ** 2));
  out.height = reduced ? 0.22 : 0.18 + Math.sin(progress * Math.PI) * 0.65;
  out.alpha = dawnfallEnvelope(localAge, 0.44) * (reduced ? 0.5 : 1) * (1 - crest * 0.14);
}

// Cosmetic call-down only: authoritative damage still resolves immediately.
export const DAWNFALL_BEAM_LANDING = 0.16;
export interface DawnfallBeam {
  bottom: number;
  top: number;
  alpha: number;
}
export function sampleDawnfallBeam(age: number, reduced: boolean, out: DawnfallBeam): void {
  const descent = Math.min(1, Math.max(0, age / DAWNFALL_BEAM_LANDING));
  out.top = 8.5;
  out.bottom = reduced ? 0.12 : 0.12 + 7.6 * (1 - descent) ** 2;
  out.alpha = dawnfallEnvelope(age, 0.52) * (reduced ? 0.5 : 1);
}
/** The pillar thins once it has landed, so the ground light takes over. */
export function dawnfallBeamWidth(sinceLanding: number): number {
  const t = Math.min(1, Math.max(0, (sinceLanding - 0.02) / 0.4));
  return 1 - 0.6 * t * t * (3 - 2 * t);
}
/** Light pools under the caster while the pillar falls, then hands over to
 * the ground sigil without a dark frame at the landing. */
export function dawnfallGather(sinceLanding: number): number {
  if (sinceLanding < -DAWNFALL_BEAM_LANDING) return 0;
  if (sinceLanding < 0) return (1 + sinceLanding / DAWNFALL_BEAM_LANDING) ** 2;
  return Math.max(0, 1 - sinceLanding / 0.1);
}
/** A short landing flare; zero before the pillar reaches the ground. */
export function dawnfallFlare(sinceLanding: number): number {
  if (sinceLanding < 0 || sinceLanding >= 0.45) return 0;
  return Math.min(1, (sinceLanding + 0.01) / 0.03) * Math.exp(-sinceLanding * 9);
}
