import type { ShamanParticleKind } from '../shaman_particle_core';
import type { SeqPoint, SeqSlot, SequencerHost } from './sequencer';
import { shamanPrimalCeremony } from './shaman_primal_ceremony';

/** Broad elemental silhouettes frame an open body silhouette. Each activation
 * spends at most four ribbons, one sheet and two liquid volumes. Delayed
 * particles use the bounded burst queue, never a predicted receiving contact. */
export function shamanCeremony(
  host: SequencerHost,
  slot: SeqSlot,
  at: SeqPoint,
  color: number,
  hot: number,
): void {
  const shape = slot.spec.shaman;
  if (!shape) return;
  if (slot.abilityId.startsWith('primal_exaltation')) {
    shamanPrimalCeremony(host, slot, at);
    return;
  }
  const id = slot.abilityId;
  const full = slot.tier === 0;
  const facing = host.facingAt?.(slot.casterId) ?? 0;
  const floor = host.groundYAt(at.x, at.z);
  const c = Math.cos(facing),
    s = Math.sin(facing);
  const path = (
    width: number,
    life: number,
    tint: number,
    position: (u: number) => readonly [number, number, number],
  ) => {
    host.pathRibbon(
      tint,
      width,
      life,
      (points) => {
        for (let i = 0; i < 12; i++) {
          const [x, y, z] = position(i / 11);
          points[i].set(at.x + c * x + s * z, floor + y, at.z - s * x + c * z);
        }
        return 12;
      },
      false,
      null,
      true,
    );
  };
  const particles = (
    x: number,
    y: number,
    z: number,
    count: number,
    power: number,
    kind: ShamanParticleKind,
    life: number,
    delay = 0,
    tint = hot,
  ) =>
    host.burstAt(
      at.x + c * x + s * z,
      floor + y,
      at.z - s * x + c * z,
      tint,
      full ? count : Math.ceil(count * 0.45),
      power,
      kind,
      life,
      delay,
    );

  if (id === 'stoneward') {
    // Broad low armour facets close inward; short seams settle at the ribs.
    // This is protection received by an ally, never a blast launched at them.
    for (const side of [-1, 1]) {
      host.fragmentsAt?.(
        'stone_chip',
        at.x + c * side * 0.92,
        floor + 0.7,
        at.z - s * side * 0.92,
        side < 0 ? 0x60796f : 0x92a58e,
        full ? 3 : 2,
        0.45,
        -c * side,
        s * side,
        0.48,
        true,
        4.3,
        true,
        0.6,
      );
      path(0.19, 0.28, color, (u) => [
        side * (1.15 - Math.sin(u * Math.PI) * 0.23),
        0.25 + u * 1.5,
        0.22 + Math.sin(u * Math.PI) * 0.3,
      ]);
      if (full)
        path(0.045, 0.36, hot, (u) => [
          side * (0.96 + Math.sin(u * Math.PI) * 0.12),
          0.5 + u * 1.05,
          0.19,
        ]);
      particles(side * 0.85, 0.7, 0.15, 18, 0.4, 'shaman_grit', 0.42, 0.065, 0xa3b49c);
      particles(side * 0.92, 1.2, 0.1, 9, 0.25, 'shaman_sparks', 0.24, 0.13);
    }
  } else if (id === 'lightning_shield') {
    host.flipbookAt(
      at.x - s * 0.5,
      floor + 2.15,
      at.z - c * 0.5,
      7.6,
      0xe8f8ff,
      'shaman_ward_charge',
      2.3,
      0.35,
      0.08,
      1.15,
      facing,
    );
    // Three protective return strokes open outward and settle into the live
    // charge shields. The face stays between them, never inside a liquid orb.
    for (let node = 0; node < 3; node++) {
      const angle = (node * Math.PI * 2) / 3 + 0.35;
      path(0.2, 0.32 + node * 0.025, hot, (u) => {
        const bow = Math.sin(u * Math.PI);
        const r = 1.12 + bow * 0.72;
        const tangent = (u - 0.5) * 1.7;
        return [
          Math.cos(angle) * r + Math.sin(angle) * tangent,
          0.12 + u * 1.85 + Math.sin(u * 37 + node) * bow * 0.07,
          -Math.sin(angle) * r + Math.cos(angle) * tangent,
        ];
      });
      particles(
        Math.cos(angle) * 1.5,
        1.15,
        -Math.sin(angle) * 1.5,
        26,
        1.05,
        'shaman_sparks',
        0.34,
        node * 0.045,
      );
    }
  } else if (id === 'ghost_wolf') {
    for (let k = 0; k < (full ? 4 : 2); k++) {
      const side = k % 2 ? -1 : 1;
      path(0.2 - k * 0.025, 0.48 + k * 0.025, k ? color : hot, (u) => [
        side * (1.15 - u * 0.72),
        0.2 + Math.sin(u * Math.PI) * (0.42 + k * 0.12),
        -1.8 + u * 3.5,
      ]);
    }
    particles(0, 0.25, -0.3, 28, 1.2, 'shaman_mist', 0.5, 0, color);
    particles(0, 0.14, -1, 12, 0.55, 'shaman_mist', 0.45, 0.1, color);
  } else if (shape.action === 'revive') {
    // An invitation at the actual corpse point. Open tips never form a halo
    // or imply that the resurrection has already been accepted.
    for (const side of [-1, 1]) {
      path(0.25, 1.25, color, (u) => [
        side * (1.45 + Math.sin(u * Math.PI) * 0.65 - u * 0.35),
        0.15 + u * Math.max(4.8, shape.height * 1.3),
        Math.sin(u * 4.1) * 0.65,
      ]);
      if (full)
        path(0.07, 1.05, hot, (u) => [
          side * (1.1 + u * 1.35),
          0.25 + u * Math.max(4.2, shape.height),
          0.2 + Math.sin(u * 3.1) * 0.4,
        ]);
      particles(side * 1.3, 0.55, 0, 20, 0.8, 'shaman_sparks', 1.1, 0.13);
      particles(side * 1.7, 2.8, 0.15, 10, 0.45, 'shaman_sparks', 0.8, 0.2);
    }
  } else if (id === 'elemental_trance') {
    for (let k = 0; k < (full ? 4 : 2); k++) {
      const side = k % 2 ? -1 : 1;
      path(k < 2 ? 0.3 : 0.08, 0.75 + k * 0.05, k < 2 ? color : hot, (u) => [
        side * (0.85 + Math.sin(u * Math.PI) * (k < 2 ? 1.1 : 0.8)),
        0.12 + u * 3.2,
        Math.sin(u * Math.PI * 2) * 0.35,
      ]);
    }
    for (const side of [-1, 1])
      particles(side * 1.25, 1.1, 0, 12, 0.55, 'shaman_sparks', 0.6, 0.12);
  } else if (id === 'bloodlust') {
    // Unequal upper and lower pressure sails open beyond the shoulders.
    for (let k = 0; k < (full ? 4 : 2); k++) {
      const side = k % 2 ? -1 : 1;
      const lower = k >= 2;
      path(lower ? 0.18 : 0.48, lower ? 0.65 : 0.5, lower ? hot : color, (u) => [
        side * (0.85 + u * shape.radius * (lower ? 0.95 : 1.3)),
        0.9 + Math.sin(u * Math.PI * 0.85) * (lower ? 1.1 : 3.4),
        0.35 + u * (lower ? 2.5 : -1.5) + Math.sin(u * 13) * u * 0.13,
      ]);
    }
    host.flipbookAt(
      at.x - s * 0.9,
      floor + 3.5,
      at.z - c * 0.9,
      7.2,
      color,
      'shaman_chorus_crest',
      1.65,
      0.46,
      0.2,
      0.55,
      facing,
    );
    for (const side of [-1, 1]) {
      particles(side * 1.2, 1.25, 0.1, 25, 2.3, 'shaman_sparks', 0.55);
      particles(side * 2.1, 0.18, 0.35, 13, 1.5, 'shaman_grit', 0.65, 0.11, 0xa8b9aa);
    }
  } else {
    // Mastery gathers a split lightning intake into the hands.
    for (const side of [-1, 1]) {
      path(0.3, 0.4, hot, (u) => [
        side * (0.85 + (1 - u) * 1.8) + Math.sin(u * 29) * Math.sin(u * Math.PI) * 0.22,
        1.1 + (1 - u) * 2.8,
        -(1 - u) * 0.65,
      ]);
      particles(side, 1.1, 0, 20, 1.1, 'shaman_sparks', 0.45);
      particles(side * 1.15, 1.6, -0.3, 12, 0.65, 'shaman_sparks', 0.55, 0.12);
    }
  }
}
