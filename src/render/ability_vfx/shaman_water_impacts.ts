import type { ShamanComposition } from '../shaman_vfx_specs';
import type { SeqPoint, SeqSlot, SequencerHost } from './sequencer';

/** Different fluid gestures for direct healing, a tide, a cascade and an
 * imbue. They share thin liquid/foam materials, not an identical explosion. */
export function shamanWaterContact(
  host: SequencerHost,
  slot: SeqSlot,
  shape: ShamanComposition,
  at: SeqPoint,
  color: number,
  hot: number,
): void {
  const full = slot.tier === 0;
  const facing = Math.atan2(at.x - slot.sourceX, at.z - slot.sourceZ);
  const sx = Math.cos(facing),
    sz = -Math.sin(facing);
  const dx = Math.sin(facing),
    dz = Math.cos(facing);
  const terrain = host.groundYAt(at.x, at.z);
  const floor = Number.isFinite(terrain) ? terrain : at.y - 1;
  const point = (side: number, height: number, forward = 0): SeqPoint => ({
    x: at.x + sx * side + dx * forward,
    y: height,
    z: at.z + sz * side + dz * forward,
  });
  const sheet = (from: SeqPoint, to: SeqPoint, width: number, life: number) =>
    host.waterVolume?.(from, to, color, hot, width, life, 0, 1);
  const spray = (
    side: number,
    height: number,
    count: number,
    power: number,
    delay: number,
    falling = false,
  ) => {
    const p = point(side, height);
    host.burstAt(
      p.x,
      p.y,
      p.z,
      hot,
      full ? count : Math.ceil(count * 0.45),
      power,
      falling ? 'shaman_runoff' : 'shaman_droplets',
      falling ? 0.64 : 0.48,
      delay,
    );
  };
  if (shape.action === 'imbue') {
    // The activation gathers onto the actual weapon anchor. No ground waterfall
    // beside the caster; the live held enchant owns the lasting wet sheen.
    sheet(point(-0.48, at.y + 0.55), point(0.04, at.y - 0.18), 0.12, 0.6);
    spray(0, at.y + 0.18, 13, 0.23, 0);
    return;
  }
  const cascade = slot.abilityId === 'chain_heal';
  const tide = slot.abilityId === 'tidecall';
  const unleash = slot.abilityId === 'unleash_weapon_water';
  if (cascade) {
    // A dominant rolling waterfall embraces the real recipient. The shorter
    // returning wave answers it at ankle height: deliberately unequal masses.
    sheet(point(-2.7, at.y + 2.9, -0.9), point(1.55, floor + 0.16, 0.8), 0.4, 1.12);
    sheet(point(2.15, at.y + 1.35, 0.3), point(-0.75, floor + 0.14, -0.4), 0.29, 1.02);
    spray(-1.25, at.y + 2.2, 36, 0.5, 0, true);
    spray(0.9, floor + 0.18, 34, 1.45, 0.19);
  } else if (tide) {
    // Fast shorebreak: low broad surge climbing inward, then falling spray.
    sheet(point(-2.65, floor + 0.12, 0.55), point(1.25, at.y + 0.35, -0.2), 0.38, 0.53);
    if (full) sheet(point(2.05, floor + 0.15, -0.5), point(-0.6, at.y + 0.28, 0.3), 0.18, 0.63);
    spray(-0.9, floor + 0.22, 24, 1.1, 0);
    spray(0.25, at.y + 0.9, 19, 0.38, 0.11, true);
  } else if (unleash) {
    // Stored water closes protectively around the recipient, not a fire blast.
    sheet(point(-2.15, at.y + 1.65, -0.2), point(-0.3, floor + 0.18, 0.55), 0.4, 0.86);
    if (full) sheet(point(1.7, at.y + 1.2, 0.3), point(0.4, floor + 0.16, -0.2), 0.3, 1.05);
    spray(-1.2, at.y + 0.9, 28, 0.38, 0.04, true);
    spray(0.4, floor + 0.2, 25, 1.25, 0.2);
  } else {
    // A large curling wave crosses the recipient diagonally. Its companion is
    // a narrow runoff, not a mirrored second slab.
    sheet(point(-2.75, at.y + 2.05, -1.0), point(1.8, floor + 0.14, 0.8), 0.4, 0.94);
    if (full) sheet(point(0.7, floor + 0.55, 0.35), point(2.4, floor + 0.12, -0.65), 0.16, 0.8);
    spray(-1.85, at.y + 1.7, 30, 0.3, 0.04, true);
    spray(1.3, floor + 0.18, 25, 1.0, 0.2);
  }
  // Broken foam crests sit at the runoff, with open ends and unequal lengths.
  // Two ribbons maximum, one for chain receipts, within the existing pool.
  for (let crest = 0; crest < (full && !cascade ? 2 : 1); crest++) {
    const reach = cascade ? 2.8 : tide ? 2.5 : unleash ? 2.1 : 1.8;
    host.pathRibbon(
      crest ? color : hot,
      crest ? 0.035 : 0.06,
      0.48 + crest * 0.12,
      (points) => {
        for (let i = 0; i < 12; i++) {
          const u = i / 11,
            side = (u - 0.4) * reach * 2;
          const bow = Math.sin(u * Math.PI);
          const p = point(
            side,
            floor + 0.12 + bow * (tide ? 0.6 : 0.22 + crest * 0.14),
            bow * (0.8 + crest * 0.2),
          );
          points[i].set(p.x, p.y, p.z);
        }
        return 12;
      },
      false,
      null,
      true,
    );
  }
}
