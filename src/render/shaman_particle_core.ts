/** Contact punctuation, independent of the shared cloud's large generic bursts.
 * The caller owns the sample; seed/index keep trajectories stable at every tier. */
export type ShamanParticleKind =
  | 'shaman_sparks'
  | 'shaman_embers'
  | 'shaman_grit'
  | 'shaman_mist'
  | 'shaman_droplets'
  | 'shaman_runoff';
export interface ShamanParticleSample {
  vx: number;
  vy: number;
  vz: number;
  size: number;
  lifetime: number;
  gravity: number;
  rotation: number;
  brightness: number;
  sprite: 'trace' | 'sparkle' | 'debris' | 'smoke';
}
export function isShamanParticleKind(kind: string): kind is ShamanParticleKind {
  return (
    kind === 'shaman_sparks' ||
    kind === 'shaman_embers' ||
    kind === 'shaman_grit' ||
    kind === 'shaman_mist' ||
    kind === 'shaman_droplets' ||
    kind === 'shaman_runoff'
  );
}
const noise = (seed: number, index: number, channel: number): number => {
  const v = Math.sin(seed * 17.173 + index * 127.1 + channel * 71.7) * 43758.5453;
  return v - Math.floor(v);
};
export function writeShamanParticleSample(
  out: ShamanParticleSample,
  kind: ShamanParticleKind,
  seed: number,
  index: number,
  power: number,
  duration?: number,
): boolean {
  if (!Number.isFinite(seed) || !Number.isFinite(index) || !Number.isFinite(power) || power < 0)
    return false;
  const scatter = Math.min(12, power);
  const mist = kind === 'shaman_mist',
    grit = kind === 'shaman_grit',
    runoff = kind === 'shaman_runoff',
    drop = kind === 'shaman_droplets' || runoff,
    ember = kind === 'shaman_embers';
  const angle =
    index * 2.399963 + noise(seed, 0, 0) * Math.PI * 2 + (noise(seed, index, 1) - 0.5) * 0.3;
  const speed =
    (mist ? 0.35 + noise(seed, index, 2) * 0.65 : 2 + noise(seed, index, 2) * 4.5) * scatter;
  out.vx = Math.cos(angle) * speed;
  out.vz = Math.sin(angle) * speed;
  out.vy =
    (mist
      ? 0.3 + noise(seed, index, 3) * 0.35
      : (0.1 + noise(seed, index, 3) * 0.9) * speed * 0.8) + (ember ? 0.45 : 0);
  if (kind === 'shaman_sparks') out.vy *= 0.58;
  if (ember) {
    // Heavy hot flecks lead, while tiny buoyant cinders peel upward behind them.
    const fine = index % 5 !== 0;
    out.vx *= fine ? 0.57 : 0.88;
    out.vz *= fine ? 0.57 : 0.88;
    out.vy += (fine ? 1.3 : 0.3) * Math.sqrt(scatter);
  }
  if (grit) {
    out.vy *= index % 7 < 3 ? 0.6 : 0.9;
    out.vx *= 1.08;
    out.vz *= 1.08;
  }
  if (runoff) {
    out.vx *= 0.3;
    out.vz *= 0.3;
    out.vy = -(1.4 + noise(seed, index, 3) * 2.0) * scatter;
  }
  // The impact owns scale; power spreads punctuation without inflating white blobs.
  out.size = mist
    ? 0.25 + noise(seed, index, 4) * 0.2
    : drop
      ? 0.07 + noise(seed, index, 4) * 0.05
      : grit
        ? index % 7 === 0
          ? 0.23 + noise(seed, index, 4) * 0.06
          : index % 7 < 3
            ? 0.16 + noise(seed, index, 4) * 0.06
            : 0.075 + noise(seed, index, 4) * 0.065
        : index % 5 === 0
          ? 0.18 + noise(seed, index, 4) * 0.06
          : 0.07 + noise(seed, index, 4) * 0.07;
  out.lifetime =
    duration !== undefined && Number.isFinite(duration)
      ? Math.max(0.05, duration)
      : 0.45 + noise(seed, index, 5) * 0.35;
  out.gravity = mist ? -0.15 : grit ? 10.5 : drop ? 6.5 : ember ? (index % 5 ? 0.9 : 3.8) : 7;
  out.rotation = angle + noise(seed, index, 6) * 0.45;
  out.brightness = mist
    ? 0.1 + noise(seed, index, 7) * 0.1
    : grit
      ? 0.65 + noise(seed, index, 7) * 0.4
      : drop
        ? 0.8 + noise(seed, index, 7) * 0.55
        : 1.0 + noise(seed, index, 7) * 0.65;
  out.sprite = mist
    ? 'smoke'
    : grit
      ? 'debris'
      : drop
        ? runoff
          ? 'trace'
          : 'sparkle'
        : ember
          ? index % 5 === 0
            ? 'trace'
            : 'debris'
          : index % 5 === 0
            ? 'trace'
            : 'sparkle';
  return true;
}
