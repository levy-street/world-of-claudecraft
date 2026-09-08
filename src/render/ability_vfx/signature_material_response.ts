import type { SeqPoint, SequencerHost } from './sequencer';
import type { SIGNATURE_ABILITIES } from './signature_core';

type Hero = (typeof SIGNATURE_ABILITIES)[string];

/** Material response is attached to contact, after the projectile has arrived.
 * Large soft bodies stay scarce; opaque fragments carry the smaller detail. */
export function signatureMaterialResponse(
  host: SequencerHost,
  hero: Hero,
  at: SeqPoint,
  size: number,
  color: number,
  accent: number,
  dx: number,
  dz: number,
): number {
  const { x, y, z } = at;
  const floor = host.groundYAt(x, z) + 0.09;
  const angle = Math.atan2(dx, dz);
  const wave = (span: number, duration: number, tint = color, heat = 0.12) =>
    host.bakedAt?.('shockwave', x, floor, z, span * size, tint, accent, duration, 0, heat, angle);
  const smoke = (span: number, duration: number, delay: number, tint: number, heat: number) =>
    host.bakedAt?.(
      'smoke',
      x,
      Math.max(floor + span * size * 0.374, y),
      z,
      span * size,
      tint,
      accent,
      duration,
      delay,
      heat,
      angle,
    );
  switch (hero) {
    case 'pyre':
      wave(4.6, 0.6, 0xbf541e, 0.5);
      host.bakedAt?.('pyroblast', x, floor, z, 6.3 * size, color, accent, 2.1, 0, 0.35, angle);
      smoke(2.7, 2.2, 0.3, 0x615655, 0.04);
      host.fragmentsAt?.('stone_chip', x, floor + 0.2, z, 0x69574e, 12, size, dx, dz);
      return 4;
    case 'glacier':
      wave(4.1, 0.8, 0x91b9cb, 0.08);
      if (!host.elementalImpact)
        host.bakedAt?.('frost_nova', x, floor, z, 7.25 * size, color, accent, 1.65, 0, 0, angle);
      else smoke(3.4, 1.8, 0.12, 0x6e929e, 0);
      host.fragmentsAt?.('ice_shard', x, floor + 0.3, z, 0x9edff4, 14, 1.15, dx, dz);
      return 3;
    case 'thunder':
      wave(3, 0.42, 0x8299b3, 0.35);
      host.fragmentsAt?.('stone_chip', x, floor + 0.15, z, 0x656b76, 7, 0.8, dx, dz);
      return 2;
    case 'tide':
      wave(3.2, 0.95, 0x5babb6, 0);
      host.bakedAt?.('chain_heal', x, floor, z, 5.9 * size, color, accent, 2.1, 0, 0, angle);
      return 2;
    case 'wolf':
      smoke(2.8, 1.8, 0.09, 0x6e7e9c, 0.12);
      return 1;
    case 'rift':
      smoke(3.5, 2.1, 0.08, 0x74527f, 0.16);
      wave(3.4, 0.6, 0x705485, 0.2);
      return 2;
    case 'judgement':
      wave(3.6, 0.72, 0xc3af78, 0.2);
      host.fragmentsAt?.('metal_splinter', x, floor + 0.4, z, 0xd1bb76, 8, 0.8, dx, dz);
      return 2;
    case 'execution':
      smoke(2.5, 1.4, 0.04, 0x847a72, 0);
      host.fragmentsAt?.('stone_chip', x, floor + 0.1, z, 0x73665e, 8, size, dx, dz);
      host.fragmentsAt?.('metal_splinter', x, floor + 0.35, z, 0xb4aaa2, 5, 0.75, dx, dz);
      return 3;
  }
}
