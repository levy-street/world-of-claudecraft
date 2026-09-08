import type { SeqSlot, SequencerHost } from './sequencer';

/** Hunter contacts travel through a weapon axis; Priest invocations resolve
 * into written planes and inward restoration. Neither uses a radial flash. */
export function kitContact(host: SequencerHost, slot: SeqSlot): number {
  const identity = slot.spec.castIdentity;
  if (identity !== 'quiver' && identity !== 'scripture' && identity !== 'psionic') return 0;
  const spec = slot.spec;
  const support =
    spec.archetype === 'heal' || spec.archetype === 'buff' || spec.archetype === 'summon';
  const x = slot.ix,
    y = slot.iy,
    z = slot.iz;
  const angle = Math.atan2(x - slot.sourceX, z - slot.sourceZ);
  const dx = Math.sin(angle),
    dz = Math.cos(angle);
  const n = slot.tier > 0 ? 2 : spec.finisher ? 6 : 4;
  const weight = Math.max(0.7, slot.power);
  if (identity === 'quiver' && !support) {
    host.flipbookAt(
      x,
      y + 0.15,
      z,
      (spec.finisher ? 2.8 : 1.3) * weight,
      slot.accent,
      'contact_pierce',
      1.8,
      0.23,
      0.2,
      0.7,
    );
    host.fragmentsAt?.('metal_splinter', x, y, z, 0xc1b1a0, n, weight, dx, dz, 0.23);
  }
  for (let k = 0; k < n; k++) {
    const side = k % 2 ? -1 : 1;
    host.pathRibbon(
      k % 2 ? slot.accent : slot.color,
      (support ? 0.07 : 0.12) * weight,
      0.26,
      (pts) => {
        for (let j = 0; j < pts.length; j++) {
          const u = j / (pts.length - 1);
          let px = 0,
            py = 0,
            pz = 0;
          if (identity === 'quiver') {
            px = side * (0.16 + u * 0.5);
            py = support ? 0.2 + k * 0.12 + u * 0.3 : Math.sin(u * Math.PI) * 0.3 + k * 0.08;
            pz = support ? 0.5 - u * 0.6 : 0.15 + u * 1.3 * weight;
          } else if (support) {
            // Parallel illuminated text folds inward to mend the recipient.
            px = (u - 0.5) * 2.4 * (1 - k * 0.09);
            py = -0.45 + k * 0.33 + Math.sin(u * Math.PI) * 0.15;
            pz = 0.55 + Math.sin(u * Math.PI) * 0.15;
          } else {
            // A broken vertical verdict, never a healing cross or ground rune.
            px = side * (0.18 + (k >> 1) * 0.22) + Math.sin(u * 21 + k) * 0.06;
            py = (u - 0.4) * (1.8 + weight * 0.8);
            pz = 0.2 + Math.sin(u * 8 + k) * 0.12;
          }
          pts[j].set(x + dz * px + dx * pz, y + py, z - dx * px + dz * pz);
        }
        return pts.length;
      },
      identity === 'quiver',
    );
  }
  return n + (identity === 'quiver' && !support ? 2 : 0);
}
