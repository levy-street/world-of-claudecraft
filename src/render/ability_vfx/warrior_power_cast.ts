import type { SeqSlot, SequencerHost } from './sequencer';
import { drawWarriorAvatarRupture } from './warrior_avatar_rupture';

const anchor = { x: 0, y: 0, z: 0 };

/** Blood Toll draws its payment inward during the load, meeting the fist at
 * the .15-second clench. The same source volume plays forward for releases. */
export function warriorPowerRelease(host: SequencerHost, slot: SeqSlot): void {
  if (slot.abilityId !== 'bloodrage' || slot.physicalSecondary) return;
  const at = host.anchorOf(slot.casterId, 0, anchor);
  if (!at) return;
  for (const side of [-1, 1])
    host.bakedAt?.(
      'warrior_power',
      at.x,
      at.y + 1.1,
      at.z,
      5.5,
      0xb91f3e,
      0xff7180,
      0.15,
      0,
      0.65,
      side < 0 ? Math.PI : 0,
      true,
      -side * 0.95,
      0.8,
    );
  host.countPrimitive(slot.abilityId, 2);
}

/** Four physical transformations: rising stone, torn aggression, a clenched
 * blood payment and an outward pressure release. No enemy contact is implied. */
export function drawWarriorPowerCast(host: SequencerHost, slot: SeqSlot, beat: number): boolean {
  const id = slot.abilityId;
  if (!['avatar', 'recklessness', 'bloodrage', 'berserker_rage'].includes(id)) return false;
  if (beat !== 0 || slot.physicalSecondary) return true;
  const at = host.anchorOf(slot.casterId, 0, anchor);
  if (!at) return true;
  const x = at.x,
    y = at.y,
    z = at.z;
  const facing = host.facingAt?.(slot.casterId) ?? 0;
  const dx = Math.sin(facing),
    dz = Math.cos(facing);
  const stone = id === 'avatar',
    toll = id === 'bloodrage',
    reckless = id === 'recklessness';
  const full = slot.tier === 0;
  const duration = stone ? 0.55 : toll ? 0.38 : 0.5;
  let primitives = 0;
  if (stone) primitives += drawWarriorAvatarRupture(host, x, z, facing, full);
  const strands = stone ? 0 : toll ? 3 : reckless ? 6 : 4;
  for (let strand = 0; strand < (full ? strands : Math.min(2, strands)); strand++) {
    const side = strand % 2 ? 1 : -1,
      band = Math.floor(strand / 2);
    host.pathRibbon(
      stone ? 0xdac6a3 : toll ? 0xc0203c : strand % 2 ? 0xf9495a : 0xa71132,
      stone ? 0.2 : toll ? 0.16 : 0.25,
      duration,
      (points) => {
        for (let i = 0; i < points.length; i++) {
          const u = i / (points.length - 1);
          let across: number, rise: number, forward: number;
          if (stone) {
            across = side * (0.8 + band * 0.3 + Math.sin(u * 3.6) * 0.12);
            rise = 0.1 + u * (2.65 - band * 0.35);
            forward = -0.5 + u * 0.12;
          } else if (toll) {
            across = side * (2.0 * (1 - u) + Math.sin(u * 5) * 0.12);
            rise = 0.55 + u * 0.75 + band * 0.1;
            forward = 0.25 + Math.sin(u * Math.PI) * 0.2;
          } else {
            // Shoulder-rooted, jagged flame tongues, not full-body fire or
            // circular shockwaves. Seething spreads; Recklessness climbs.
            across = side * (0.35 + u * (reckless ? 1.3 : 2.8) + band * 0.2);
            rise = 1.05 + u * (reckless ? 1.7 : 0.65) + Math.sin(u * 8 + band) * u * 0.15;
            forward = -0.35 + Math.sin(u * 4 + band) * 0.23;
          }
          points[i].set(x + dz * across + dx * forward, y + rise, z - dx * across + dz * forward);
        }
        return points.length;
      },
      true,
      null,
      false,
      strand === 0 ? 1 : 0,
    );
    primitives++;
  }
  if (!stone) {
    if (!toll) {
      for (const side of [-1, 1])
        host.bakedAt?.(
          'warrior_power',
          x,
          y + 1.2,
          z,
          reckless ? 8 : 6.4,
          0xdd2444,
          0xffc3a4,
          0.52,
          0,
          1.6,
          side < 0 ? Math.PI : 0,
          false,
          side * (reckless ? 0.95 : -0.2),
          reckless ? 0.8 : 1.35,
        );
      primitives += 2;
    }
    // A compact animated sprite gives the conversion/release a textured hot
    // core. Blood Toll stays inward; the two rage bursts split at shoulders.
    const sides = toll ? [0] : [-1, 1];
    for (const side of sides) {
      const sx = x + dz * side * 1.05,
        sz = z - dx * side * 1.05;
      host.flipbookAt(
        sx,
        y + 1.25,
        sz,
        toll ? 1.8 : 2.7,
        toll ? 0xd63149 : 0xff5260,
        'flame',
        1.25,
        duration,
        side * 0.6,
        toll ? 0.65 : 0.8,
      );
      host.burstAt(
        sx,
        y + 1.25,
        sz,
        0xc51e3d,
        full ? 12 : 4,
        toll ? 0.32 : 0.95,
        'embers',
        duration,
      );
      primitives += 2;
    }
  }
  host.pulseLight(
    slot.casterId,
    stone ? 'physical' : 'blood',
    stone || reckless ? 1.2 : 0.7,
    0.07,
    3,
  );
  host.countPrimitive(id, primitives + 1);
  return true;
}
