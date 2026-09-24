import type { SeqPoint, SeqSlot, SequencerHost } from './sequencer';

/** One elemental ascension, not four unrelated explosions. Water and air draw
 * inward; fire ascends on one flank, lightning crowns the opposite flank.
 * The second beat uses the existing bounded sequencer, never a timer. */
export function shamanPrimalCeremony(
  host: SequencerHost,
  slot: SeqSlot,
  at: SeqPoint,
  climax = false,
): void {
  const facing = host.facingAt?.(slot.casterId) ?? 0;
  const c = Math.cos(facing),
    s = Math.sin(facing);
  const floor = host.groundYAt(at.x, at.z);
  const full = slot.tier === 0;
  const lead = slot.spec.shaman?.element;
  // Every element turns through the same rising helix, leaving its centre open.
  const point = (x: number, y: number, z: number): SeqPoint => {
    const turn = y * 0.12 + (climax ? 0.24 : 0);
    const rx = x * Math.cos(turn) + z * Math.sin(turn);
    const rz = -x * Math.sin(turn) + z * Math.cos(turn);
    return { x: at.x + c * rx + s * rz, y: floor + y, z: at.z - s * rx + c * rz };
  };
  const path = (
    color: number,
    width: number,
    life: number,
    shape: (u: number, i: number) => readonly [number, number, number],
  ) => {
    host.pathRibbon(
      color,
      width,
      life,
      (points) => {
        for (let i = 0; i < 12; i++) {
          const v = shape(i / 11, i),
            p = point(v[0], v[1], v[2]);
          points[i].set(p.x, p.y, p.z);
        }
        return 12;
      },
      false,
      null,
      true,
    );
  };
  const burst = (
    x: number,
    y: number,
    z: number,
    color: number,
    n: number,
    power: number,
    kind: 'shaman_sparks' | 'shaman_embers' | 'shaman_runoff' | 'shaman_mist',
    life: number,
    delay = 0,
  ) => {
    const p = point(x, y, z);
    host.burstAt(p.x, p.y, p.z, color, full ? n : Math.ceil(n * 0.45), power, kind, life, delay);
  };
  if (!climax) {
    // A wide pressure intake establishes the silhouette before the crown.
    for (const side of [-1, 1]) {
      path(0xc8ece7, 0.14, 0.62, (u) => {
        const angle = -0.8 + u * 2.8 + (side < 0 ? Math.PI : 0);
        const radius = 4.8 - u * 2.35;
        return [Math.cos(angle) * radius, 0.18 + u * 1.75, Math.sin(angle) * radius];
      });
      path(side < 0 ? 0xffa148 : 0x84eddf, side < 0 ? 0.24 : 0.09, 0.78, (u) => {
        const angle = -0.4 + u * 2.8 + (side < 0 ? Math.PI : 0);
        const radius = 2.35 + Math.sin(u * Math.PI) * 0.55;
        return [Math.cos(angle) * radius, 0.35 + u * 3.85, Math.sin(angle) * radius];
      });
    }
    // Two real translucent liquid sheets, confined to the water flank.
    host.waterVolume?.(
      point(3.8, 0.15, -0.6),
      point(-1.7, 3.75, 1.35),
      0x238ea8,
      0xc3fff3,
      lead === 'water' ? 0.42 : 0.32,
      0.85,
      0,
      1,
    );
    host.waterVolume?.(
      point(3.1, 0.12, -1.1),
      point(-0.75, 2.85, 1.75),
      0x389ca7,
      0xd8fff4,
      0.16,
      0.7,
      0,
      1,
    );
    burst(-1.6, 0.35, -0.25, 0xff9a35, 38, 1.3, 'shaman_embers', 0.7);
    burst(1.65, 3.05, -0.5, 0xb1f8ee, 24, 0.45, 'shaman_runoff', 0.8, 0.14);
    burst(0, 0.16, -0.75, 0x9eb8b6, 12, 1.5, 'shaman_mist', 0.65, 0.06);
    return;
  }
  // Asymmetric lightning crown and a hot rising fire crest, joined by the
  // same sweeping motion. The body and face stay open between both flanks.
  for (let k = 0; k < (full ? 4 : 2); k++) {
    const bolt = k < 2;
    path(bolt ? 0xdaf8ff : 0xdbf4e9, bolt ? 0.24 : 0.11, bolt ? 0.44 : 0.85, (u, i) => {
      const angle = -0.6 + u * (bolt ? 2.8 : 4.1) + (k % 2 ? Math.PI : 0);
      const radius = bolt ? 2.3 + u * 1.35 : 4.4 - u * 1.75;
      const kink = bolt ? Math.sin(i * 4.17 + k * 9) * Math.sin(u * Math.PI) * 0.22 : 0;
      return [
        Math.cos(angle) * (radius + kink),
        (bolt ? 2.35 : 0.3) + u * (bolt ? 4.2 : 4.6),
        Math.sin(angle) * (radius + kink),
      ];
    });
  }
  const fire = point(-2.35, 3.25, 0.7);
  host.flipbookAt(
    fire.x,
    fire.y,
    fire.z,
    lead === 'fire' ? 9.2 : 8.4,
    0xffd3a0,
    'shaman_fire_ascension',
    1.55,
    0.72,
    -0.7,
    0.82,
    facing,
  );
  host.waterVolume?.(
    point(-0.75, lead === 'water' ? 5.9 : 5.2, 2.5),
    point(3.1, 0.16, -1.6),
    0x318fa4,
    0xd8fff5,
    0.36,
    1.15,
    0,
    1,
  );
  burst(-2.35, 1.5, 0.7, 0xffa334, 45, 2.2, 'shaman_embers', 1.05);
  burst(-0.65, 4.5, 2.4, 0xbaf8ef, 28, 0.55, 'shaman_runoff', 1.15, 0.13);
  burst(-2.8, 3.7, -0.8, 0xe3faff, 34, 1.6, 'shaman_sparks', 0.28, 0.04);
  burst(2.8, 4.4, -0.8, 0x80cfff, 24, 1.2, 'shaman_sparks', 0.45, 0.16);
  host.pulseLight(slot.casterId, 'storm', 3.8, 0.42, 9);
}
