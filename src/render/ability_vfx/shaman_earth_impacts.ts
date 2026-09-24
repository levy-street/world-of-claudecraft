import type { ShamanComposition } from '../shaman_vfx_specs';
import type { SeqPoint, SeqSlot, SequencerHost } from './sequencer';

/** Material is shared across the kit; the force and silhouette are not. A field's
 * resolved victim contacts are jolts, never permission to replay its area cast. */
export function shamanEarthImpactKind(id: string, action: ShamanComposition['action']) {
  if (action === 'imbue') return 'mineral';
  if (action === 'field') return id === 'earthbind' ? 'grip' : 'fault';
  if (id === 'earthbind' || id === 'earthquake') return 'aftershock';
  if (id === 'unleash_weapon_earth') return 'ram';
  if (action === 'strike') return 'cleave';
  return 'uppercut';
}

/** Immediate field contact is cracking earth, not the later cosmetic eruption.
 * The field owner already displays the full actionable area from this frame. */
export function shamanFaultwakeOpening(
  host: SequencerHost,
  slot: SeqSlot,
  shape: ShamanComposition,
  at: SeqPoint,
  color: number,
  hot: number,
): void {
  const yaw = Math.atan2(at.x - slot.sourceX, at.z - slot.sourceZ);
  for (let branch = 0; branch < 2; branch++) {
    const angle = yaw + (branch ? 0.94 : -0.61);
    const reach = shape.radius * (branch ? 0.32 : 0.46);
    host.pathRibbon(
      branch ? color : hot,
      branch ? 0.025 : 0.045,
      0.43,
      (points) => {
        for (let i = 0; i < 12; i++) {
          const u = i / 11;
          const kink = Math.sin(i * 2.93 + branch * 3) * Math.sin(u * Math.PI) * 0.14;
          const x = at.x + Math.sin(angle) * reach * u + Math.cos(angle) * kink;
          const z = at.z + Math.cos(angle) * reach * u - Math.sin(angle) * kink;
          points[i].set(x, host.groundYAt(x, z) + 0.065, z);
        }
        return 12;
      },
      false,
      null,
      true,
    );
    const x = at.x + Math.sin(angle) * reach * 0.42;
    const z = at.z + Math.cos(angle) * reach * 0.42;
    host.burstAt(
      x,
      host.groundYAt(x, z) + 0.1,
      z,
      0xaab4a6,
      slot.tier === 0 ? 9 : 4,
      0.7,
      'shaman_grit',
      0.33,
      branch * 0.08,
    );
  }
}

export function shamanEarthContact(
  host: SequencerHost,
  slot: SeqSlot,
  shape: ShamanComposition,
  at: SeqPoint,
  color: number,
  hot: number,
): void {
  const kind = shamanEarthImpactKind(slot.abilityId, shape.action);
  const full = slot.tier === 0;
  const r = shape.radius;
  const yaw = Math.atan2(at.x - slot.sourceX, at.z - slot.sourceZ);
  const dx = Math.sin(yaw),
    dz = Math.cos(yaw),
    sx = dz,
    sz = -dx;
  const floor = host.groundYAt(at.x, at.z);
  // Coordinates are lateral, height above terrain, and forward from the blow.
  const point = (side: number, height: number, forward: number): SeqPoint => {
    const x = at.x + sx * side + dx * forward;
    const z = at.z + sz * side + dz * forward;
    return { x, y: host.groundYAt(x, z) + height, z };
  };
  const fragments = (
    side: number,
    height: number,
    forward: number,
    count: number,
    force: number,
    spreadSide: number,
    spreadForward: number,
    scale: number,
    fragmentDepth: number,
    life: number,
    tint: number,
  ) => {
    const p = point(side, height, forward);
    host.fragmentsAt?.(
      'stone_chip',
      p.x,
      p.y,
      p.z,
      tint,
      full ? count : Math.max(1, Math.ceil(count * 0.45)),
      force,
      sx * spreadSide + dx * spreadForward,
      sz * spreadSide + dz * spreadForward,
      life,
      true,
      scale,
      true,
      fragmentDepth,
    );
  };
  const grit = (
    side: number,
    height: number,
    forward: number,
    count: number,
    force: number,
    life: number,
    delay = 0,
    tint = 0xaab4a6,
    powder = false,
  ) => {
    const p = point(side, height, forward);
    host.burstAt(
      p.x,
      p.y,
      p.z,
      tint,
      full ? count : powder ? Math.max(1, Math.floor(count * 0.42)) : Math.ceil(count * 0.42),
      force,
      powder ? 'shaman_mist' : 'shaman_grit',
      life,
      delay,
    );
  };
  const seam = (
    from: readonly [number, number, number],
    to: readonly [number, number, number],
    width: number,
    life: number,
    seed: number,
    tint = hot,
  ) =>
    host.pathRibbon(
      tint,
      width,
      life,
      (points) => {
        for (let i = 0; i < 12; i++) {
          const u = i / 11;
          const kink = Math.sin(i * 2.93 + seed) * Math.sin(u * Math.PI) * 0.12;
          const p = point(
            from[0] + (to[0] - from[0]) * u + kink,
            from[1] + (to[1] - from[1]) * u,
            from[2] + (to[2] - from[2]) * u,
          );
          points[i].set(p.x, p.y, p.z);
        }
        return 12;
      },
      false,
      null,
      true,
    );
  const dust = (height: number, size: number, life: number, roll: number, aspect: number) =>
    host.flipbookAt(
      at.x,
      floor + height,
      at.z,
      size,
      0xf2ffe3,
      kind === 'fault' ? 'shaman_earth_fault' : kind === 'ram' ? 'shaman_earth_ram' : 'shaman_dust',
      2.2,
      life,
      roll,
      aspect,
    );
  const smoke = (
    side: number,
    height: number,
    forward: number,
    size: number,
    delay: number,
    aspect: number,
  ) => {
    const p = point(side, height, forward);
    host.bakedAt?.(
      'smoke',
      p.x,
      p.y,
      p.z,
      size,
      0x626862,
      0xb0b39d,
      0.62,
      delay,
      0,
      yaw,
      false,
      0,
      aspect,
    );
  };

  if (kind === 'mineral') {
    // Tiny splinters and three assembly facets stay on the weapon. No ground
    // burst, crater or receiving hit is invented by enchanting a weapon.
    host.fragmentsAt?.(
      'stone_chip',
      at.x,
      at.y,
      at.z,
      0x7c9188,
      full ? 6 : 3,
      0.34,
      0,
      0,
      0.38,
      true,
      1.15,
      true,
      0.55,
    );
    for (let k = 0; k < (full ? 3 : 2); k++) {
      const a = yaw + k * 2.399;
      host.pathRibbon(
        k === 0 ? hot : color,
        0.065,
        0.22 + k * 0.03,
        (points) => {
          for (let i = 0; i < 8; i++) {
            const u = i / 7,
              reach = 0.55 * (1 - u) + 0.13;
            points[i].set(
              at.x + Math.cos(a) * reach,
              at.y + (u - 0.5) * 0.5,
              at.z + Math.sin(a) * reach,
            );
          }
          return 8;
        },
        false,
        null,
        true,
      );
    }
    host.burstAt(at.x, at.y, at.z, hot, full ? 19 : 8, 0.3, 'shaman_grit', 0.38);
    host.burstAt(at.x, at.y, at.z, 0xd7e5be, full ? 11 : 5, 0.35, 'shaman_sparks', 0.25, 0.08);
    return;
  }

  if (kind === 'aftershock') {
    // A recipient read, subordinate to the real persistent field around them.
    fragments(0, 0.12, 0, 4, 0.7, 0.3, 0.4, 1.7, 0.7, 0.42, 0x87968b);
    seam([-0.5, 0.065, -0.3], [0.65, 0.065, 0.4], 0.045, 0.16, 2);
    dust(0.35, r * 2.7, 0.27, 0.13, 1.3);
    grit(0, 0.2, 0, 21, 0.85, 0.33);
    return;
  }

  if (kind === 'grip') {
    // Four low, inward-moving shoulders. The aura owner supplies actual foot
    // grips; this cast composition depicts capture, not an explosive damage hit.
    for (let k = 0; k < 4; k++) {
      const a = (k * Math.PI) / 2 + 0.37;
      const side = Math.cos(a) * r * 0.54,
        forward = Math.sin(a) * r * 0.54;
      fragments(
        side,
        0.08,
        forward,
        2,
        0.48,
        -side,
        -forward,
        4.2 - k * 0.35,
        0.68 + k * 0.13,
        0.48,
        k % 2 ? 0x738777 : 0x97a18a,
      );
      seam([side, 0.06, forward], [side * 0.23, 0.09, forward * 0.23], 0.09, 0.23 + k * 0.02, k);
      grit(side * 0.7, 0.12, forward * 0.7, 12, 0.65, 0.36, k * 0.04);
    }
    smoke(0, 0.16, 0, r * 1.7, 0.075, 1.6);
    return;
  }

  if (kind === 'fault') {
    // One offset shear line tears into four material scales. Thin edge plates
    // oppose one another; tiny quarry chips escape above the powdered seam.
    // The wide analytic pressure front owns scale, not identical flying blocks.
    fragments(-r * 0.48, 0.1, -r * 0.09, 1, 1.5, -1, 0.18, 3.2, 0.5, 0.66, 0x586760);
    fragments(r * 0.39, 0.14, r * 0.22, 2, 1.35, 0.8, 0.65, 2.55, 0.55, 0.61, 0x8c9b87);
    fragments(-r * 0.08, 0.35, -r * 0.11, 2, 1.6, -0.35, -1, 1.8, 0.5, 0.48, 0x718474);
    fragments(r * 0.12, 0.55, r * 0.09, 4, 1.6, 0.3, 1, 0.9, 0.5, 0.38, 0xb1baa3);
    seam([-r * 0.55, 0.065, -r * 0.12], [r * 0.52, 0.065, r * 0.25], 0.085, 0.235, 5);
    // Sparse fast chips lead two pressure jets, then two unequal low powder
    // wakes expose the broken ground again rather than leaving a uniform cloud.
    grit(-r * 0.12, 0.16, -r * 0.03, 18, 2.1, 0.33, 0, 0xc0c5ad);
    grit(r * 0.33, 0.3, r * 0.18, 15, 2.6, 0.42, 0.1, 0x9ca790);
    grit(-r * 0.57, 0.25, -r * 0.19, 9, 1.8, 0.56, 0.15, 0x727d6f);
    grit(-r * 0.35, 0.23, -r * 0.13, 9, 2.6, 0.72, 0.125, 0x828777, true);
    grit(r * 0.64, 0.22, r * 0.29, 6, 1.9, 0.63, 0.2, 0xa0a18b, true);
    dust(0.7, r * 1.85, 0.47, 0, 1.55);
    smoke(r * 0.12, 0.24, r * 0.1, r * 1.5, 0.09, 2.4);
    return;
  }

  host.decalXZ(at.x, at.z, Math.min(2.5, r * 0.85), 0x788478, 'shaman_fracture', 0.72);
  if (kind === 'cleave') {
    // A diagonal weapon-plane fracture: thin sheared plates fly through the hit.
    // Its fast cutting sheet is intentionally unlike Jolt's rising dust column.
    const height = Math.max(0.65, at.y - floor);
    fragments(-0.25, height, 0.12, 2, 1.6, 0.85, 1, 4.6, 0.5, 0.51, 0x697c76);
    fragments(0.25, height + 0.25, 0.2, 9, 1.45, -0.3, 1, 1.55, 0.5, 0.43, 0x99ae9e);
    for (let k = 0; k < (full ? 3 : 2); k++)
      seam(
        [-r * 0.68, height + 0.65 - k * 0.18, -0.3],
        [r * 0.75, height - 0.35 + k * 0.15, 0.55],
        k === 0 ? 0.16 : 0.045,
        0.13 + k * 0.03,
        k,
      );
    host.flipbookAt(
      at.x,
      at.y,
      at.z,
      r * 5.0,
      0xf2ffe3,
      'shaman_earth_cleave',
      1.8,
      0.32,
      -0.72,
      1.65,
    );
    grit(0.3, height, 0.3, 35, 2.8, 0.32);
    grit(0.8, height - 0.1, 0.45, 20, 1.65, 0.46, 0.065);
    grit(1.2, height - 0.2, 0.65, 10, 1.4, 0.62, 0.14, 0x858c7d, true);
    smoke(0.65, height - 0.12, 0.4, r * 1.75, 0.085, 2.5);
    return;
  }

  if (kind === 'ram') {
    // A heavy forward crush: one broad front wedge with two side shear planes.
    fragments(0, 0.4, -0.65, 2, 1.6, 0, 1, 5, 0.95, 0.62, 0x62766f);
    fragments(-0.65, 0.16, -0.1, 2, 1.45, -0.8, 1, 4.3, 0.65, 0.58, 0x8b9e8b);
    fragments(0.85, 0.16, 0.2, 2, 1.3, 1, 0.8, 3.8, 0.85, 0.55, 0x76897e);
    fragments(0, 0.7, 0.15, 8, 1.6, 0.2, 1, 1.5, 0.55, 0.52, 0xa9b8a3);
    for (const side of [-1, 1])
      seam([0, 0.4, -r * 0.7], [side * r * 0.6, 0.08, r * 0.8], 0.13, 0.2, side + 3);
    dust(0.95, r * 5.0, 0.44, -0.08, 1.35);
    smoke(0, 0.3, 1.05, r * 2.1, 0.095, 2.2);
    grit(0, 0.9, 0.25, 43, 3.2, 0.34);
    grit(0.3, 0.2, 1.1, 28, 2.4, 0.49, 0.08);
    grit(-0.2, 0.25, 1.55, 12, 2.1, 0.73, 0.16, 0x84897a, true);
    return;
  }

  // Earthen Jolt splits a low pair of thin plates, then drives eight smaller
  // splinters up through the strike. No giant upright wedge leads the hit.
  // Opposed shearing motion and unequal lifetimes preserve air in the plume.
  fragments(-0.35, 0.09, 0.06, 2, 1.008, -1.45, 0.42, 5.0, 0.5, 0.58, 0x5e7066);
  fragments(0.5, 0.12, 0.1, 2, 0.68, 1.4, 0.38, 4.57, 0.52, 0.52, 0x899780);
  fragments(-0.12, 0.4, 0.12, 3, 1.25, -0.3, 1.3, 1.35, 0.5, 0.43, 0xa7b499);
  fragments(0.18, 0.6, 0.34, 5, 1.6, 0.15, 1.25, 0.75, 0.5, 0.34, 0xc2c8af);
  seam([-r * 0.65, 0.055, -0.2], [r * 0.8, 0.055, 0.4], 0.1, 0.24, 4);
  seam([-0.35, 0.12, -0.15], [0.15, shape.height * 1.25, 0.25], 0.105, 0.15, 7);
  dust(0.4, r * 5.25, 0.46, -0.12, 1.24);
  smoke(0.25, 0.18, 0.5, r * 2.65, 0.11, 2.6);
  grit(0, 0.23, 0, 42, 3.2, 0.28, 0, 0xc0c7aa);
  grit(-0.95, 0.24, 0.75, 25, 2.7, 0.47, 0.08, 0x97a38b);
  grit(0.9, 0.17, 1.1, 11, 3.2, 0.68, 0.17, 0x81897b, true);
  host.burstAt(at.x, floor + 0.3, at.z, hot, full ? 24 : 10, 2.1, 'shaman_sparks', 0.19);
}
