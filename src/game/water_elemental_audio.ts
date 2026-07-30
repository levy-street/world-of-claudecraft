export type WaterElementalCue = 'aggro' | 'attack' | 'death';

const CUE_SECONDS: Record<WaterElementalCue, number> = {
  aggro: 0.78,
  attack: 0.46,
  death: 1.12,
};

function seededNoise(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return ((state >>> 0) / 0xffffffff) * 2 - 1;
  };
}

function envelope(kind: WaterElementalCue, t: number): number {
  const attack = kind === 'attack' ? 0.045 : 0.09;
  const rise = Math.min(1, t / attack);
  if (kind === 'aggro') return rise * Math.sin(Math.PI * Math.min(1, t));
  if (kind === 'death') return rise * (1 - t) ** 1.35;
  return rise * (1 - t) ** 1.8;
}

/** Deterministic mono samples for the Water Elemental's spatial one-shots. */
export function waterElementalSamples(kind: WaterElementalCue, sampleRate: number): Float32Array {
  const length = Math.max(1, Math.floor(CUE_SECONDS[kind] * sampleRate));
  const out = new Float32Array(length);
  const random = seededNoise(kind === 'aggro' ? 0xa91e : kind === 'attack' ? 0x71da : 0xde47);
  let low = 0;
  let mid = 0;
  let phase = 0;

  for (let i = 0; i < length; i++) {
    const progress = i / Math.max(1, length - 1);
    const white = random();
    low += 0.025 * (white - low);
    mid += 0.11 * (white - mid);
    const splash = low * 1.9 + (mid - low) * 0.72;

    const baseHz =
      kind === 'aggro'
        ? 115 + progress * 105
        : kind === 'death'
          ? 190 - progress * 125
          : 240 - progress * 90;
    phase += (Math.PI * 2 * baseHz) / sampleRate;
    const gurgle = Math.sin(phase + Math.sin(progress * Math.PI * 9) * 0.65);

    const bubbleCenter = kind === 'attack' ? 0.2 : kind === 'aggro' ? 0.55 : 0.28;
    const bubbleWidth = kind === 'death' ? 0.19 : 0.1;
    const bubbleDistance = (progress - bubbleCenter) / bubbleWidth;
    const bubbleEnv = Math.exp(-bubbleDistance * bubbleDistance);
    const bubble = Math.sin(Math.PI * 2 * (420 + progress * 480) * (i / sampleRate)) * bubbleEnv;

    const value = envelope(kind, progress) * (splash * 0.56 + gurgle * 0.2 + bubble * 0.22);
    out[i] = Math.max(-1, Math.min(1, value));
  }
  return out;
}
