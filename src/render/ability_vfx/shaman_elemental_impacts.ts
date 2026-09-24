import type { ShamanComposition } from '../shaman_vfx_specs';
import type { SeqPoint, SeqSlot, SequencerHost } from './sequencer';
import { shamanEarthContact } from './shaman_earth_impacts';
import { shamanFireContact } from './shaman_fire_impacts';
import { shamanStormContact } from './shaman_storm_impacts';
import { shamanStormstrike } from './shaman_stormstrike';
import { shamanWaterContact } from './shaman_water_impacts';

/** One receiving body, an explosive material silhouette, then smaller delayed
 * ejecta. The six-sheet pool still spends only one sheet on each recipient. */
export function shamanElementalContact(
  host: SequencerHost,
  slot: SeqSlot,
  shape: ShamanComposition,
  at: SeqPoint,
  color: number,
  hot: number,
): void {
  const full = slot.tier === 0;
  const r = shape.radius;
  const face = Math.atan2(at.x - slot.sourceX, at.z - slot.sourceZ);
  const floor = host.groundYAt(at.x, at.z);
  const sx = Math.cos(face),
    sz = -Math.sin(face);
  const dx = Math.sin(face),
    dz = Math.cos(face);
  if (slot.abilityId === 'stormstrike') {
    shamanStormstrike(host, slot, at);
    return;
  }
  if (shape.element === 'storm') {
    shamanStormContact(host, slot, shape, at, color, hot);
    return;
  }
  if (shape.element === 'earth') {
    shamanEarthContact(host, slot, shape, at, color, hot);
    return;
  }
  if (shape.element === 'fire') {
    shamanFireContact(host, slot, shape, at, color, hot);
    return;
  }
  if (shape.element === 'ice') {
    // The crystal face breaks into sharp asymmetric wedges, with frost powder
    // at their roots rather than a blue version of the fire explosion.
    host.flipbookAt(at.x, at.y, at.z, r * 5.85, 0xe9faff, 'shaman_rime', 2.05, 0.5, 0.24, 0.8);
    host.fragmentsAt?.(
      'ice_shard',
      at.x,
      at.y,
      at.z,
      0x367594,
      full ? 3 : 2,
      2.05,
      dx,
      dz,
      0.76,
      true,
      1.8,
      false,
      0.7,
    );
    host.fragmentsAt?.(
      'ice_shard',
      at.x,
      at.y,
      at.z,
      0x38657f,
      full ? 10 : 4,
      1.6,
      dx + sx * 0.6,
      dz + sz * 0.6,
      0.68,
      true,
      1.25,
      false,
      0.6,
    );
    host.burstAt(at.x, at.y, at.z, hot, full ? 31 : 13, 2.2, 'shaman_sparks', 0.34);
    host.burstAt(at.x, at.y - 0.15, at.z, 0x7cafc6, full ? 13 : 5, 1.8, 'shaman_grit', 0.47, 0.045);
    host.burstAt(at.x, at.y - 0.2, at.z, 0x719dad, full ? 11 : 5, 1.25, 'shaman_mist', 0.72, 0.16);
    host.burstAt(
      at.x,
      at.y + 0.3,
      at.z,
      0xc6f4f3,
      full ? 14 : 6,
      1.05,
      'shaman_sparks',
      0.58,
      0.15,
    );
    return;
  }
  if (shape.element === 'water') {
    shamanWaterContact(host, slot, shape, at, color, hot);
    return;
  }
  // Ancestral wind is a sharp passing shear with three unequal trailing wakes.
  // A clean receiving cut leads; long fine dust streaks carry its momentum.
  host.flipbookAt(at.x, at.y, at.z, r * 5.1, 0xe8ffff, 'shaman_gale', 1.9, 0.42, -0.12, 1.3);
  for (let k = 0; k < (full ? 3 : 2); k++) {
    host.pathRibbon(
      k === 0 ? hot : color,
      k === 0 ? 0.32 : 0.055,
      0.36 + k * 0.065,
      (points) => {
        for (let i = 0; i < 12; i++) {
          const u = i / 11,
            a = face - 1.85 + u * (k === 0 ? 3.1 : 4.8);
          const reach = r * (k === 0 ? 1.32 : (0.62 + k * 0.14) * (1 - u * 0.44));
          points[i].set(
            at.x + Math.sin(a) * reach,
            at.y + Math.sin(u * Math.PI) * (0.7 + k * 0.12) + (u - 0.5) * 0.8,
            at.z + Math.cos(a) * reach * 0.57,
          );
        }
        return 12;
      },
      false,
      null,
      true,
    );
  }
  host.burstAt(at.x, at.y, at.z, hot, full ? 31 : 13, 2.3, 'shaman_sparks', 0.29);
  host.burstAt(
    at.x + dx * 0.4,
    at.y,
    at.z + dz * 0.4,
    color,
    full ? 18 : 7,
    1.85,
    'shaman_grit',
    0.48,
    0.065,
  );
  host.burstAt(at.x, floor + 0.18, at.z, 0x7f9b95, full ? 7 : 3, 1.15, 'shaman_mist', 0.54, 0.09);
}
