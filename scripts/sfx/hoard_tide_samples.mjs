// Original deterministic water masters: layered filtered surf, sub pressure and droplets.
export const HOARD_TIDE_MASTERS = [
  { key: 'hoard_tide_build', duration: 2.4 },
  { key: 'hoard_tide_rush', duration: 4, loop: true },
  { key: 'hoard_tide_crash', duration: 2.6 },
  { key: 'hoard_tide_hit', duration: 0.8 },
];

export function renderHoardTideSamples(key, duration, rate = 44100) {
  const samples = new Float32Array(Math.round(duration * rate));
  let seed = 0x74696465;
  let low = 0;
  let middle = 0;
  const tau = Math.PI * 2;
  for (let i = 0; i < samples.length; i++) {
    const t = i / rate;
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const white = seed / 2147483648 - 1;
    low += (white - low) * 0.014;
    middle += (white - middle) * 0.17;
    const surf = low * 2.5 + middle * 0.55 + white * 0.055;
    const droplets =
      Math.sin(tau * (690 * t + Math.sin(t * 37) * 8)) *
      Math.max(0, Math.sin(t * 113)) ** 16 *
      0.025;
    let envelope;
    let pressure;
    if (key === 'hoard_tide_build') {
      envelope =
        Math.min(1, t * 5) *
        (0.16 + 0.84 * (t / duration) ** 1.4) *
        Math.min(1, (duration - t) * 16);
      pressure = Math.sin(tau * (42 * t + 8 * t * t)) * 0.1;
    } else if (key === 'hoard_tide_rush') {
      envelope = 0.75 + 0.2 * Math.sin((tau * t) / duration);
      pressure = Math.sin(tau * 57 * t) * 0.035;
    } else {
      envelope = Math.min(1, t * 110) * Math.exp(-t * (key === 'hoard_tide_hit' ? 5.5 : 1.65));
      pressure = Math.sin(tau * (62 * t + 12 * (1 - Math.exp(-t * 8)))) * 0.19;
    }
    samples[i] = Math.tanh((surf + pressure + droplets) * envelope) * 0.7;
  }
  if (key === 'hoard_tide_rush') {
    // Wrap overlap makes the runtime loop boundary continuous without silence.
    const overlap = Math.round(rate * 0.12);
    for (let i = 0; i < overlap; i++) {
      const alpha = i / (overlap - 1);
      samples[samples.length - overlap + i] =
        samples[samples.length - overlap + i] * (1 - alpha) + samples[i] * alpha;
    }
    return samples.slice(overlap);
  }
  return samples;
}
