import type { ShamanComposition } from '../shaman_vfx_specs';
import type { SeqPoint, SeqSlot, SequencerHost } from './sequencer';

const noise = (seed: number): number => {
  const n = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return n - Math.floor(n);
};
// Broken shear offsets: long straight runs alternate with tight reversals.
// Equal zigzags make lightning look like a decorative sawtooth or liquid hose.
const SHEAR = [0, 0.025, 0.064, 0.07, -0.095, -0.084, -0.05, 0.09, 0.065, 0.04, -0.02, 0];

/** Arc Bolt shears across the contact; Skybranch descends from above into the
 * actual recipient. Three paths and one sheet own the entire confirmed hit. */
export function shamanStormContact(
  host: SequencerHost,
  slot: SeqSlot,
  shape: ShamanComposition,
  at: SeqPoint,
  color: number,
  hot: number,
): void {
  const r = shape.radius;
  if (
    slot.tier > 1 ||
    !Number.isFinite(r) ||
    r <= 0 ||
    !Number.isFinite(at.x + at.y + at.z + slot.sourceX + slot.sourceZ)
  )
    return;
  const full = slot.tier === 0;
  const chain = slot.abilityId === 'chain_lightning';
  const seed = slot.targetId * 17 + slot.casterId * 3 + (chain ? 151 : 37);
  const face = Math.atan2(at.x - slot.sourceX, at.z - slot.sourceZ);
  const angle = face + (noise(seed) - 0.5) * 0.48;
  const x = at.x,
    y = at.y,
    z = at.z;
  const sx = Math.cos(angle),
    sz = -Math.sin(angle);
  const dx = Math.sin(angle),
    dz = Math.cos(angle);
  const sign = noise(seed + 19) < 0.5 ? -1 : 1;
  const reach = r * (chain ? 0.5 : 2.64);
  const rise = r * (chain ? 3.65 : 0.34);
  const lead = (u: number, index: number): [number, number, number] => {
    if (chain && index === 11) return [x, y, z];
    const kink = (SHEAR[index] + (noise(seed + index * 7) - 0.5) * 0.045) * r;
    const interior = Math.sin(u * Math.PI);
    const progress = chain ? 1 - u : u;
    const skyBend = chain ? Math.sin(u * Math.PI) * Math.sin(u * 5.4 + 0.4) * r * 0.2 : 0;
    return [
      x + sx * (reach * progress * sign + skyBend) + dx * kink * interior,
      y + rise * progress + (chain ? 0 : kink * 1.45 * interior),
      z + sz * (reach * progress * sign + skyBend) + dz * kink * interior,
    ];
  };
  for (let k = 0; k < (full ? 3 : 2); k++) {
    const rootIndex = k === 1 ? 3 : 6;
    const root = k === 0 ? [x, y, z] : lead(rootIndex / 11, rootIndex);
    // Skybranch forks attach to the airborne leader and descend beside it;
    // only its dominant stroke lands on the recipient. Arc Bolt keeps its
    // transverse counter-split and shorter forward peel.
    const branchSide = chain ? (k === 1 ? -0.95 : 0.65) : k === 1 ? -2.12 : 1.12;
    const branchDepth = chain ? (k === 1 ? 0.28 : 0.42) : k === 1 ? 0.38 : 0.74;
    host.pathRibbon(
      k === 0 ? 0xf2fbff : k === 1 ? hot : 0xbbddff,
      k === 0 ? 0.18 : k === 1 ? 0.072 : 0.036,
      k === 0 ? 0.145 : k === 1 ? 0.125 : 0.16,
      (points) => {
        for (let i = 0; i < 12; i++) {
          const u = i / 11;
          if (k === 0) {
            const p = lead(u, i);
            points[i].set(p[0], p[1], p[2]);
          } else {
            const kink =
              (SHEAR[11 - i] * 1.2 + (noise(seed + k * 101 + i * 13) - 0.5) * 0.035) *
              r *
              Math.sin(u * Math.PI);
            const side = branchSide * r * u * sign;
            const depth = branchDepth * r * u + kink;
            points[i].set(
              root[0] + sx * side + dx * depth,
              root[1] +
                (chain ? (k === 1 ? -0.9 : -0.65) : k === 1 ? -0.16 : 0.43) * r * u +
                kink * (chain ? 0.55 : 1.8),
              root[2] + sz * side + dz * depth,
            );
          }
        }
        return 12;
      },
      false,
      null,
      true,
    );
  }
  // The atlas already paints blue corona around a white return stroke. A blue
  // multiplicative tint erased its white detail before it reached the screen.
  host.flipbookAt(
    x,
    y,
    z,
    r * (chain ? 6.6 : 6.4),
    0xf1f8ff,
    chain ? 'shaman_skybranch' : 'shaman_storm',
    2.6,
    0.36,
    sign * (0.1 + noise(seed + 11) * 0.2),
    chain ? 0.76 : 0.86,
  );
  // A tight white detonation opens first, then cool longer-lived ions carry the
  // mass outward. The late short fizz stays on the body, not in empty space.
  host.burstAt(x, y, z, hot, full ? 68 : 29, 3.65, 'shaman_sparks', 0.2);
  host.burstAt(
    x + sx * r * 0.2 * sign,
    chain ? host.groundYAt(x + sx * r * 0.2 * sign, z + sz * r * 0.2 * sign) + 0.18 : y + 0.08,
    z + sz * r * 0.2 * sign,
    color,
    full ? 44 : 18,
    3.1,
    'shaman_sparks',
    0.53,
    0.065,
  );
  host.burstAt(x, y, z, hot, full ? 12 : 5, 1.3, 'shaman_sparks', 0.085, 0.11);
}
