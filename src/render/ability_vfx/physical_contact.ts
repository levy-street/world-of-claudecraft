import { physicalContactSheet } from './physical_choreography_core';
import { meleeContactPoint, meleeImpactProfile } from '../melee_impact_core';
import type { SeqSlot, SequencerHost } from './sequencer';

const origin = { x: 0, y: 0, z: 0 };
const point = { x: 0, y: 0, z: 0 };

/** The contact nucleus survives detail shedding; garnish stays in the existing pools. */
export function physicalContact(
  host: SequencerHost,
  slot: SeqSlot,
  beat: number,
  x: number,
  y: number,
  z: number,
): number {
  const p = slot.spec.physical!;
  const sheet = physicalContactSheet(p);
  if (
    !sheet ||
    slot.abilityId === 'intervene' ||
    slot.abilityId === 'skull_bash' ||
    slot.targetId === slot.casterId
  )
    return 0;
  const crescendo = 1 + beat * 0.13;
  const size = (1.05 + p.weight * 0.75) * crescendo;
  // The short sheet crosses the contact plane without claiming a damage radius.
  host.flipbookAt(
    x,
    y,
    z,
    size,
    p.material === 'blood' || p.material === 'venom' ? slot.color : slot.accent,
    sheet,
    1.5 + p.weight * 0.3,
    0.23,
    (beat % 2 ? -1 : 1) * p.tilt * 0.6,
    sheet === 'contact_cut' ? 1.15 : sheet === 'contact_pierce' ? 0.85 : 1,
  );
  const profile = meleeImpactProfile(slot.abilityId);
  if (!profile) return 1;
  const from = host.anchorOf(slot.casterId, 0.55, origin);
  const angle = from ? Math.atan2(x - from.x, z - from.z) : 0;
  const dx = Math.sin(angle),
    dz = Math.cos(angle);
  const strands = slot.tier > 0 ? 1 : profile.style === 'crush' ? 4 : 3;
  for (let strand = 0; strand < strands; strand++) {
    host.pathRibbon(
      strand === 0 ? slot.accent : profile.bleeding ? 0x9e1726 : slot.color,
      profile.width * (strand === 0 ? 1.6 : 0.7),
      0.23,
      (points) => {
        for (let j = 0; j < points.length; j++) {
          meleeContactPoint(
            profile,
            j / (points.length - 1),
            beat,
            strand,
            point,
          );
          points[j].set(
            x + dz * point.x + dx * point.z,
            y + point.y,
            z - dx * point.x + dz * point.z,
          );
        }
        return points.length;
      },
      true,
    );
  }
  if (profile.bleeding) {
    // Blood is an impact material, not a red light or a ground radius.
    host.burstAt(
      x,
      y,
      z,
      0x8d1022,
      Math.round((slot.tier > 0 ? 5 : 11) * profile.force),
      0.6 + profile.force * 0.16,
      'blood',
      0.23,
    );
  }
  return 1 + strands + (profile.bleeding ? 1 : 0);
}
