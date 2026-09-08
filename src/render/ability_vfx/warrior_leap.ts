import type { SequencerHost } from './sequencer';

/** A planted takeoff sheds grit behind the body. It never guesses a landing. */
export function drawWarriorLeapLaunch(host: SequencerHost, sourceId: number): number {
  const at = host.anchorOf(sourceId, 0);
  if (!at) return 0;
  const angle = host.facingAt?.(sourceId) ?? 0;
  for (const side of [-1, 1]) {
    const x = at.x + Math.cos(angle) * side * 0.5 - Math.sin(angle) * 0.35;
    const z = at.z - Math.sin(angle) * side * 0.5 - Math.cos(angle) * 0.35;
    host.bakedAt?.(
      'shout_dust',
      x,
      host.groundYAt(x, z) + 0.08,
      z,
      2.7,
      0xa29480,
      0xd3c5ad,
      0.38,
      0,
      0,
      angle,
    );
    host.fragmentsAt?.(
      'stone_chip',
      x,
      host.groundYAt(x, z) + 0.12,
      z,
      0x8e8271,
      5,
      0.6,
      -Math.sin(angle),
      -Math.cos(angle),
      0.3,
    );
  }
  return 4;
}

/** The authoritative landing point owns one impact. No nearest-caster guess,
 * victim inference, delayed second hit or source-bound animation is involved. */
export function drawWarriorLeapLanding(
  host: SequencerHost,
  x: number,
  z: number,
  radius: number,
  tier: number,
): number {
  if (![x, z, radius].every(Number.isFinite) || radius <= 0) return 0;
  const scale = radius / 6,
    floor = host.groundYAt(x, z);
  host.decalXZ(x, z, radius, 0xffffff, 'leap_fracture', 0.72);
  let count = 1;
  if (
    host.crestAt &&
    host.crestAt(x, floor, z, scale, 1, 0x898b90, 0xc7bbaa, 'leap_rupture', 0, 0.72) !== false
  )
    count++;
  // Supplementary fracture highlights may yield to busy attack paths. The
  // complete instantaneous drawing above remains one independent pool owner.
  for (let i = 0; i < 8; i++) {
    const angle = (i * Math.PI) / 4 + Math.sin(i * 3.7) * 0.065;
    const dx = Math.sin(angle),
      dz = Math.cos(angle);
    const pathAdmitted = host.pathRibbon(
      0xd0b392,
      0.23,
      0.42,
      (points) => {
        for (let j = 0; j < points.length; j++) {
          const u = j / (points.length - 1),
            r = (1.45 + 4.5 * u) * scale;
          const jag = Math.sin(u * 24 + i) * Math.sin(u * Math.PI) * 0.17 * scale;
          const px = x + dx * r + dz * jag,
            pz = z + dz * r - dx * jag;
          points[j].set(px, host.groundYAt(px, pz) + 0.045, pz);
        }
        return points.length;
      },
      true,
      null,
      false,
      0,
    );
    if (pathAdmitted !== false) count++;
    if (i % 2 === 0) {
      const px = x + dx * radius * 0.58,
        pz = z + dz * radius * 0.58;
      host.bakedAt?.(
        'shout_dust',
        px,
        host.groundYAt(px, pz) + 0.08,
        pz,
        5.6 * scale,
        0xb09b80,
        0xead7b4,
        0.72,
        0,
        0,
        angle,
      );
      count++;
      if (tier === 0) {
        host.fragmentsAt?.(
          'stone_chip',
          px,
          host.groundYAt(px, pz) + 0.25,
          pz,
          0x8e8271,
          14,
          2.1,
          dx,
          dz,
          0.62,
        );
        count++;
      }
    }
  }
  host.bakedAt?.(
    'warrior_power',
    x,
    floor + 0.08,
    z,
    5.5 * scale,
    0xf0d9ac,
    0xa79479,
    0.3,
    0,
    0.8,
    0,
    false,
    0,
    1.8,
  );
  return count + 1;
}
