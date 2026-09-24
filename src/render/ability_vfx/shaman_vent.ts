import type { SequencerHost } from './sequencer';

/** A proven five-charge spend adds a storm return stroke to the earth impact.
 * This is released power, not another damage result or another cast gesture. */
export function drawShamanThunderVent(
  fx: Pick<SequencerHost, 'pathRibbon' | 'flipbookAt' | 'burstAt' | 'shakeAt' | 'abilityAudio'>,
  x: number,
  y: number,
  z: number,
  radius: number,
  tier: number,
): void {
  if (![x, y, z, radius].every(Number.isFinite) || radius <= 0) return;
  const reach = Math.min(5, radius);
  for (let branch = 0; branch < (tier === 0 ? 3 : 2); branch++) {
    const angle = branch * 2.39996 + 0.27;
    fx.pathRibbon(
      0x62b9f0,
      branch === 0 ? 0.24 : 0.09,
      0.14 + branch * 0.045,
      (points) => {
        for (let k = 0; k < 12; k++) {
          const u = k / 11;
          const kink = Math.sin(k * 4.73 + branch) * Math.sin(u * Math.PI) * 0.29;
          points[k].set(
            x + Math.cos(angle) * reach * u - Math.sin(angle) * kink,
            y + Math.sin(u * Math.PI) * (branch === 0 ? 2.4 : 0.85),
            z + Math.sin(angle) * reach * u + Math.cos(angle) * kink,
          );
        }
        return 12;
      },
      false,
      null,
      true,
    );
  }
  fx.flipbookAt(x, y, z, reach * 4.5, 0x73c9f5, 'shaman_storm', 2.3, 0.38, -0.22, 0.95);
  fx.burstAt(x, y, z, 0xd7f4ff, tier === 0 ? 50 : 20, 3, 'shaman_sparks', 0.25);
  fx.burstAt(x, y + 0.3, z, 0x73c9f5, tier === 0 ? 31 : 12, 2.1, 'shaman_sparks', 0.55, 0.075);
  fx.shakeAt(x, y, z, 0.13, true);
  fx.abilityAudio?.('impact', 'storm', 2.1, x, y, z, { lite: tier > 0 });
}
