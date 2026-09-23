import type { SeqPoint, SeqSlot, SequencerHost } from './sequencer';

/** Authored second contact beat. A flash needs mass and an aftermath to read
 * at gameplay distance. All tails follow an already confirmed receipt, fit
 * inside one GCD, and reuse the same bounded prepared primitive families. */
export function shamanContactTail(host: SequencerHost, slot: SeqSlot, at: SeqPoint): void {
  const shape = slot.spec.shaman;
  if (!shape) return;
  const full = slot.tier === 0,
    storm = shape.element === 'storm';
  const sky = slot.abilityId === 'chain_lightning';
  const cleave = slot.abilityId === 'stormstrike';
  const fire = shape.element === 'fire',
    earth = shape.element === 'earth';
  const ice = shape.element === 'ice';
  const face = Math.atan2(at.x - slot.sourceX, at.z - slot.sourceZ);
  const c = Math.cos(face),
    s = Math.sin(face);
  const heavy = shape.action === 'strike' || slot.abilityId === 'chain_lightning';
  const reach = shape.radius * (heavy ? 1.7 : 1.45);
  const color = storm ? 0xa4ddff : fire ? 0xff9a42 : ice ? 0xbbeafa : earth ? 0xd2c8a6 : 0xcfeee4;
  for (let k = 0; k < (full ? 2 : 1); k++) {
    host.pathRibbon(
      color,
      storm ? 0.115 : fire ? 0.075 : 0.043,
      sky ? 0.22 : storm ? 0.4 : 0.58,
      (points) => {
        for (let j = 0; j < 12; j++) {
          const u = j / 11,
            envelope = Math.sin(u * Math.PI);
          const tooth = storm ? Math.sin(j * 4.7 + k * 13 + slot.targetId) * envelope * 0.17 : 0;
          const side = sky
            ? k === 0
              ? (1 - u) * reach * 0.32 + tooth + envelope * Math.sin(u * 5.6) * 0.4
              : reach * u * 1.2
            : fire
              ? (k ? -0.5 : 0.65) * reach * u + Math.sin(u * 6.2 + k) * envelope * 0.28
              : (k ? -1 : 1) * reach * u;
          const up = sky
            ? k === 0
              ? (1 - u) * reach * 2.2
              : -0.8 + envelope * 0.17
            : fire
              ? Math.sin(u * Math.PI) * reach * (k ? 0.32 : 0.5) + u * 0.4
              : ice
                ? Math.sin(u * Math.PI) * reach * 0.3 - u * 0.55
                : u * (k ? -0.13 : 0.22);
          const x = at.x + c * side + s * tooth;
          const z = at.z - s * side + c * (envelope * 0.5 + tooth);
          points[j].set(
            x,
            sky && k === 1 ? host.groundYAt(x, z) + 0.08 + envelope * 0.17 : at.y + up + tooth,
            z,
          );
        }
        return 12;
      },
      false,
      null,
      true,
    );
  }
  if (storm) {
    // Four Skybranch receipts already occupy four of six sheets. Its return
    // stroke uses paths and ions so primary hits cannot evict one another.
    if (slot.abilityId !== 'chain_lightning')
      host.flipbookAt(
        at.x,
        at.y,
        at.z,
        shape.radius * 5.4,
        0xecfaff,
        cleave ? 'shaman_storm_cleave' : 'shaman_storm_echo',
        2.1,
        cleave ? 0.3 : 0.46,
        cleave ? -0.65 : 0.32,
        cleave ? 1.45 : 0.85,
      );
    host.burstAt(at.x, at.y, at.z, 0x88cfff, full ? 34 : 14, 2.0, 'shaman_sparks', 0.6);
  } else if (fire) {
    host.burstAt(at.x, at.y + 0.25, at.z, color, full ? 43 : 18, 2.1, 'shaman_embers', 0.85);
    host.bakedAt?.(
      'smoke',
      at.x,
      at.y + 0.2,
      at.z,
      shape.radius * 1.5,
      0x554a44,
      0xc98c57,
      0.74,
      0.13,
      0,
      face,
      false,
    );
  } else if (earth) {
    const floor = host.groundYAt(at.x, at.z);
    host.burstAt(at.x, floor + 0.2, at.z, 0xa9af9b, full ? 38 : 16, 2.1, 'shaman_grit', 0.6);
    host.bakedAt?.(
      'smoke',
      at.x,
      floor + 0.25,
      at.z,
      shape.radius * 1.75,
      0x7b8073,
      0xc4c6ad,
      0.68,
      0.12,
      0,
      face,
      false,
    );
  } else {
    host.burstAt(
      at.x,
      at.y,
      at.z,
      color,
      full ? 32 : 13,
      2.0,
      ice ? 'shaman_sparks' : 'shaman_grit',
      0.55,
    );
  }
  host.pulseLight(slot.targetId, slot.spec.palette, heavy ? 3.4 : 2.5, 0.38, 8);
}
