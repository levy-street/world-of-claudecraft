import type { SeqSlot, SequencerHost } from './sequencer';
import type { WarriorPressureKind } from './warrior_shout_shapes';

interface ShoutDesign {
  shape: WarriorPressureKind;
  tint: number;
  edge: number;
  presence: number;
  lift: number;
}
// Presence is the size of the caster's physical voice/dust sculpture, not a
// range claim. Iron Bellow has unlimited party range; recipient state owns it.
const SHOUTS: Readonly<Record<string, ShoutDesign>> = {
  battle_shout: {
    shape: 'rally_pressure',
    tint: 0x8f7660,
    edge: 0xe8c58a,
    presence: 8,
    lift: 0.9,
  },
  rallying_cry: {
    shape: 'rally_pressure',
    tint: 0xb18c58,
    edge: 0xffe2a4,
    presence: 10,
    lift: 1.2,
  },
  emboldening_roar: {
    shape: 'rally_pressure',
    tint: 0x9f3944,
    edge: 0xffb17d,
    presence: 9,
    lift: 1.35,
  },
  defiant_bellow: {
    shape: 'challenge_pressure',
    tint: 0x7d6757,
    edge: 0xe39d63,
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
    shape: 'dread_pressure',
    tint: 0x4a4052,
    edge: 0xc0b2cb,
    presence: 8,
    lift: 1.35,
  },
  piercing_howl: {
    shape: 'challenge_pressure',
    tint: 0x5d7580,
    edge: 0xc2d6da,
    presence: 12,
    lift: 0.55,
  },
};
const source = { x: 0, y: 0, z: 0 };
const mouthPoint = { x: 0, y: 0, z: 0 };

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
    const mouth = host.anchorOf(slot.casterId, 0.56, mouthPoint);
    const pressure = host.crestAt?.(
      x,
      mouth?.y ?? y + 1.8,
      z,
      design.presence / 5,
      design.lift,
      design.tint,
      design.edge,
      design.shape,
      facing,
      0.65,
    );
    // A cold sculpture or a fully occupied pool must still have a large,
    // directed voice silhouette. Borrow the already-pooled ribbon material;
    // preparation is never submitted from a cast.
    if (pressure === false) {
      const floor = host.groundYAt(x, z);
      const voiceY = mouth?.y ?? y + 1.8;
      const dx = Math.sin(facing),
        dz = Math.cos(facing);
      for (let spoke = -1; spoke <= 1; spoke++) {
        host.pathRibbon(
          design.edge,
          0.32 + design.lift * 0.1,
          0.52,
          (points) => {
            for (let i = 0; i < points.length; i++) {
              const u = i / (points.length - 1);
              const forward = design.presence * 1.8 * u;
              const side = spoke * design.presence * u * (0.2 + 0.8 * u);
              const px = x + dx * forward + dz * side;
              const pz = z + dz * forward - dx * side;
              points[i].set(
                px,
                voiceY +
                  host.groundYAt(px, pz) -
                  floor +
                  Math.sin(u * Math.PI) * design.lift * (2.8 - Math.abs(spoke)),
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
      count += 3;
    }
    host.pulseLight(slot.casterId, 'physical', 0.85, 0.08, 4);
    count += 2;
  }
  const beats = slot.spec.physical?.beats.length ?? 1;
  const outward = (beat + 1) / (beats + 0.4);
  const radius = design.presence * outward;
  // Four broad volumes cover the surroundings once per cast. Re-emitting a
  // sheet on every voice beat would self-saturate the shared ten-slot pool.
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
        7.2 + design.lift * 0.9,
        0xd3bb95,
        design.edge,
        0.62,
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
    // Short swept grit trails join the voice to the moving dust front.
    if (lobe % 2 === 0) {
      host.pathRibbon(
        design.edge,
        0.09 + outward * 0.025,
        0.26,
        (points) => {
          for (let i = 0; i < points.length; i++) {
            const u = i / (points.length - 1);
            const side = Math.sin(u * Math.PI) * 0.35 * (lobe === 0 ? 1 : -1);
            const r = radius * (0.45 + 0.55 * u);
            const tooth = Math.sin(u * Math.PI) * 0.22;
            const tx = x + dx * r + dz * side,
              tz = z + dz * r - dx * side;
            points[i].set(tx, host.groundYAt(tx, tz) + 0.18 + tooth * design.lift * 0.45, tz);
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
  }
  host.countPrimitive(slot.abilityId, count);
  return true;
}
