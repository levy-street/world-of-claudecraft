import type { ShamanComposition } from '../shaman_vfx_specs';
import type { SeqPoint, SeqSlot, SequencerHost } from './sequencer';

/** Fire shares its material, but ignition, a cutting weapon and stored pressure
 * have different silhouettes, ejecta directions and decay. One quad per hit. */
export function shamanFireContact(
  host: SequencerHost,
  slot: SeqSlot,
  shape: ShamanComposition,
  at: SeqPoint,
  color: number,
  hot: number,
): void {
  const forge = shape.action === 'imbue';
  const blast = slot.abilityId === 'unleash_weapon_fire';
  const cut = shape.action === 'strike' && !blast;
  const r = shape.radius;
  const full = slot.tier === 0;
  const yaw = Math.atan2(at.x - slot.sourceX, at.z - slot.sourceZ);
  const dx = Math.sin(yaw),
    dz = Math.cos(yaw),
    sx = dz,
    sz = -dx;
  const style = forge
    ? 'shaman_fire_forge'
    : blast
      ? 'shaman_fire_detonation'
      : cut
        ? 'shaman_fire_cleave'
        : 'shaman_ember';
  host.flipbookAt(
    at.x,
    at.y,
    at.z,
    r * (forge ? 5.3 : blast ? 6.5 : 5.8),
    0xfff3df,
    style,
    blast ? 2.4 : 2.15,
    forge ? 0.46 : cut ? 0.3 : blast ? 0.58 : 0.62,
    cut ? -0.55 : forge ? 0.12 : -0.09,
    cut ? 1.45 : blast ? 1.15 : 0.84,
  );
  // A weapon inscription catches along the blade, without a ground explosion.
  if (forge) {
    host.burstAt(at.x, at.y, at.z, hot, full ? 18 : 8, 0.28, 'shaman_embers', 0.42);
    host.burstAt(at.x, at.y + 0.35, at.z, color, full ? 12 : 5, 0.35, 'shaman_embers', 0.52, 0.1);
    return;
  }
  if (cut) {
    // Two open blade tracks pass through the wound; the second is cooling
    // fire pulled along the slash, not a radial fireball attached to a sword.
    for (let k = 0; k < (full ? 2 : 1); k++) {
      host.pathRibbon(
        k ? color : hot,
        k ? 0.075 : 0.15,
        0.2 + k * 0.055,
        (points) => {
          for (let i = 0; i < 12; i++) {
            const u = i / 11,
              cross = (u - 0.5) * r * 3.4;
            const bow = Math.sin(u * Math.PI) * r * 0.4;
            points[i].set(
              at.x + sx * cross + dx * bow,
              at.y + cross * 0.35 - k * 0.14,
              at.z + sz * cross + dz * bow,
            );
          }
          return 12;
        },
        false,
        null,
        true,
      );
    }
  }
  host.burstAt(at.x, at.y, at.z, hot, full ? 24 : 10, blast ? 3.2 : 2.1, 'shaman_sparks', 0.17);
  // Emission origins trace the force: ignition climbs, a cut sweeps sideways,
  // the unleashed blast sheds three separated outward rolls and ember showers.
  for (let k = 0; k < 3; k++) {
    const side = (k - 1) * r * (cut ? 0.7 : blast ? 0.7 : 0.24);
    const forward = blast ? r * 0.24 : 0;
    const y = at.y + (cut ? side * 0.35 : k * r * (blast ? 0.12 : 0.32));
    host.burstAt(
      at.x + sx * side + dx * forward,
      y,
      at.z + sz * side + dz * forward,
      k ? color : 0xffb766,
      full ? 19 : 8,
      blast ? 3.5 : cut ? 2.1 : 1.8,
      'shaman_embers',
      0.48 + k * 0.1,
      0.025 + k * (cut ? 0.025 : 0.08),
    );
  }
  host.bakedAt?.(
    'smoke',
    at.x + dx * 0.3,
    at.y + 0.15,
    at.z + dz * 0.3,
    r * (blast ? 1.85 : cut ? 1.1 : 1.65),
    0x514641,
    0x9c612e,
    0.78,
    blast ? 0.11 : 0.075,
    0.04,
  );
  host.burstAt(at.x, at.y + 0.25, at.z, 0x594e45, full ? 9 : 4, 1.15, 'shaman_mist', 0.78, 0.1);
}
