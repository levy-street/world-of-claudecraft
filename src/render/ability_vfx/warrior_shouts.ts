import type { SeqSlot, SequencerHost } from './sequencer';
import {
  type WarriorPressureKind,
  warriorPressureLayers,
  warriorPressurePoint,
} from './warrior_shout_shapes';

interface ShoutDesign {
  shape: WarriorPressureKind;
  tint: number;
  edge: number;
  presence: number;
  lift: number;
}
// Presence is the size of the caster's physical acoustic fronts, not a
// range claim. Iron Bellow has unlimited party range; recipient state owns it.
const SHOUTS: Readonly<Record<string, ShoutDesign>> = {
  battle_shout: {
    shape: 'battle_pressure',
    tint: 0x3c434a,
    edge: 0xf0ddbf,
    presence: 8,
    lift: 0.9,
  },
  rallying_cry: {
    shape: 'rally_pressure',
    tint: 0x53545a,
    edge: 0xffe2a4,
    presence: 10,
    lift: 1.2,
  },
  emboldening_roar: {
    shape: 'embolden_pressure',
    tint: 0x531e30,
    edge: 0xffd4cc,
    presence: 9,
    lift: 1.35,
  },
  defiant_bellow: {
    shape: 'challenge_pressure',
    tint: 0x363d48,
    edge: 0xe8d2b1,
    presence: 10,
    lift: 1.1,
  },
  demoralizing_shout: {
    shape: 'dread_pressure',
    tint: 0x34404b,
    edge: 0xa9b5bf,
    presence: 10,
    lift: 0.85,
  },
  intimidating_shout: {
    shape: 'fear_pressure',
    tint: 0x4a4052,
    edge: 0xc0b2cb,
    presence: 8,
    lift: 1.35,
  },
  piercing_howl: {
    shape: 'piercing_pressure',
    tint: 0x5d7580,
    edge: 0xc2d6da,
    presence: 12,
    lift: 0.55,
  },
};
const source = { x: 0, y: 0, z: 0 };
const mouthPoint = { x: 0, y: 0, z: 0 };
const pressurePoint = { x: 0, y: 0, z: 0 };

/** A surrounding physical pressure front, with grit and torn voiced accents.
 * These casts never authorize damage, target hitstop or a target body repaint. */
export function drawWarriorShout(host: SequencerHost, slot: SeqSlot, beat: number): boolean {
  const design = SHOUTS[slot.abilityId];
  if (!design) return false;
  if (slot.physicalSecondary) return true;
  const at = host.anchorOf(slot.casterId, 0, source);
  if (!at) return true;
  const x = at.x,
    y = at.y,
    z = at.z;
  const facing = host.facingAt?.(slot.casterId) ?? 0;
  let count = 0;
  if (beat === 0) {
    const mouth = host.anchorOf(slot.casterId, 0.79, mouthPoint);
    const voiceY = mouth?.y ?? y + 1.8;
    const pressure = host.crestAt
      ? host.crestAt(
          x,
          voiceY,
          z,
          design.presence / 5,
          design.lift,
          design.tint,
          design.edge,
          design.shape,
          facing,
          0.65,
        )
      : false;
    // A cold sculpture or a fully occupied pool must still have a large,
    // directed voice silhouette. Borrow the already-pooled ribbon material;
    // preparation is never submitted from a cast.
    if (pressure === false) {
      const floor = host.groundYAt(x, z);
      const dx = Math.sin(facing),
        dz = Math.cos(facing);
      for (let spoke = 0; spoke < warriorPressureLayers(design.shape); spoke++) {
        host.pathRibbon(
          design.edge,
          0.32 + design.lift * 0.1,
          0.52,
          (points) => {
            for (let i = 0; i < points.length; i++) {
              const u = i / (points.length - 1);
              warriorPressurePoint(design.shape, spoke, u, 0.5, pressurePoint, true);
              const forward = (pressurePoint.z * design.presence) / 5;
              const side = (pressurePoint.x * design.presence) / 5;
              const px = x + dx * forward + dz * side;
              const pz = z + dz * forward - dx * side;
              points[i].set(
                px,
                voiceY + host.groundYAt(px, pz) - floor + pressurePoint.y * design.lift,
                pz,
              );
            }
            return points.length;
          },
          true,
          null,
          false,
          1,
        );
      }
      count += warriorPressureLayers(design.shape);
    }
    host.pulseLight(slot.casterId, 'physical', 0.85, 0.08, 4);
    count += 2;
  }
  const beats = slot.spec.physical?.beats.length ?? 1;
  const outward = (beat + 1) / (beats + 0.4);
  const radius = design.presence * outward;
  // The air carries the scale. Four brief footing accents show displaced grit
  // without turning a voice into a bank of airborne dust.
  const lobes = 4;
  for (let lobe = 0; lobe < lobes; lobe++) {
    const a = facing + (lobe * Math.PI * 2) / lobes;
    const dx = Math.sin(a),
      dz = Math.cos(a);
    const px = x + dx * 1.1,
      pz = z + dz * 1.1;
    const ground = host.groundYAt(px, pz);
    if (beat === 0) {
      const admitted = host.bakedAt?.(
        'shout_dust',
        px,
        ground + 0.08,
        pz,
        3.6 + design.lift * 0.4,
        0xa3a6a4,
        0xd4d7d1,
        0.36,
        lobe * 0.015,
        0,
        a,
      );
      // Competing casts keep physical dust feedback if all volume slots are busy.
      if (admitted === false)
        host.burstAt(px, ground + 0.5, pz, design.tint, 9, 1.8, 'smoke', 0.48);
      if (slot.tier === 0)
        host.fragmentsAt?.('stone_chip', px, ground + 0.08, pz, 0x8b7f6e, 3, 0.95, dx, dz, 0.25);
      count += slot.tier === 0 ? 2 : 1;
    }
    host.pathRibbon(
      design.edge,
      0.07 + outward * 0.025,
      0.26,
      (points) => {
        for (let i = 0; i < points.length; i++) {
          const u = i / (points.length - 1);
          const side = Math.sin(u * Math.PI) * 0.35 * (lobe === 0 ? 1 : -1);
          const r = radius * (0.45 + 0.55 * u);
          const tooth = Math.sin(u * Math.PI) * 0.22;
          const tx = x + dx * r + dz * side,
            tz = z + dz * r - dx * side;
          points[i].set(tx, y + 1.75 + tooth * design.lift * 0.6, tz);
        }
        return points.length;
      },
      true,
      null,
      false,
      0,
    );
    count++;
  }
  host.countPrimitive(slot.abilityId, count);
  return true;
}
