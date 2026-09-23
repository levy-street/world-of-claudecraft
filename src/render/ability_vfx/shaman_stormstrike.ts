import type { SeqPoint, SeqSlot, SequencerHost } from './sequencer';

/** A weapon-driven electrical cleave, distinct from a ranged Arc Bolt.
 * Unequal crossed cuts pass through the confirmed contact before peeling off
 * into finer forks. No target outcome is invented by the release trails. */
export function shamanStormstrike(host: SequencerHost, slot: SeqSlot, at: SeqPoint): void {
  const face = Math.atan2(at.x - slot.sourceX, at.z - slot.sourceZ);
  const c = Math.cos(face),
    s = Math.sin(face),
    full = slot.tier === 0;
  for (let k = 0; k < (full ? 3 : 2); k++) {
    host.pathRibbon(
      k === 0 ? 0xecfbff : 0x8bd5ff,
      k === 0 ? 0.3 : 0.09,
      k === 0 ? 0.3 : 0.24,
      (points) => {
        for (let j = 0; j < 12; j++) {
          const u = j / 11,
            envelope = Math.sin(u * Math.PI);
          const cross = (u - 0.5) * (k === 0 ? 8.8 : k === 1 ? -6.7 : 3.5);
          const kink = Math.sin(j * 4.73 + slot.targetId + k * 3) * envelope * 0.16;
          const depth = (envelope - 1) * (k === 0 ? 1.8 : 1.0) + kink;
          points[j].set(
            at.x + c * cross + s * depth,
            at.y + (u - 0.5) * (k === 0 ? 2.4 : -3.1) + kink,
            at.z - s * cross + c * depth,
          );
        }
        return 12;
      },
      false,
      null,
      true,
    );
  }
  host.flipbookAt(
    at.x,
    at.y,
    at.z,
    20.5,
    0xe9faff,
    'shaman_storm_cleave',
    2.45,
    0.46,
    -0.65,
    1.45,
    face,
  );
  host.burstAt(at.x, at.y, at.z, 0xe5faff, full ? 62 : 26, 3.4, 'shaman_sparks', 0.3);
  host.burstAt(
    at.x + s * 0.4,
    at.y,
    at.z + c * 0.4,
    0x58aee9,
    full ? 34 : 14,
    2.5,
    'shaman_sparks',
    0.55,
    0.09,
  );
}
