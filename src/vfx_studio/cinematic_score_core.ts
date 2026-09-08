export interface CinematicScore {
  gather: number;
  recoil: number;
  lift: number;
  orbit: number;
  lens: number;
  settle: number;
}
export const CINEMATIC_SCORES: Readonly<Record<string, CinematicScore>> = {
  pyroblast: { gather: -0.55, recoil: 0.58, lift: 0.012, orbit: -0.018, lens: 1.7, settle: 0.85 },
  frost_nova: { gather: -0.28, recoil: 0.38, lift: 0.028, orbit: 0, lens: 1.1, settle: 0.7 },
  chain_lightning: {
    gather: -0.32,
    recoil: 0.24,
    lift: -0.013,
    orbit: 0.016,
    lens: 0.85,
    settle: 0.42,
  },
  chain_heal: { gather: -0.38, recoil: -0.22, lift: 0.016, orbit: 0.012, lens: -0.5, settle: 1.15 },
  ghost_wolf: { gather: -0.24, recoil: 0.18, lift: -0.014, orbit: -0.014, lens: 0.55, settle: 0.8 },
  hammer_of_wrath: { gather: -0.34, recoil: 0.42, lift: 0.025, orbit: 0, lens: 1.25, settle: 0.8 },
  execute: { gather: -0.25, recoil: 0.5, lift: -0.026, orbit: 0.012, lens: 1.35, settle: 0.64 },
  abyssal_rift: {
    gather: -0.62,
    recoil: -0.32,
    lift: 0.016,
    orbit: 0.028,
    lens: -1.1,
    settle: 1.35,
  },
};

export function cinematicEnvelope(
  phase: 'gather' | 'release' | 'impact',
  age: number,
  duration: number,
): number {
  const t = Math.max(0, Math.min(1, age / Math.max(0.01, duration)));
  if (phase === 'gather') return Math.sin(t * Math.PI * 0.5) ** 2;
  if (phase === 'release') return (1 - t) ** 2;
  return Math.sin(Math.min(1, t / 0.1) * Math.PI * 0.5) * Math.exp(-t * 4) * (1 - t);
}
