import {
  type MeleeImpactProfile,
  meleeContactHeight,
  meleeContactPoint,
} from '../melee_impact_core';
import type { SeqPoint, SequencerHost } from './sequencer';

/** The wide wake establishes reach; this short split establishes the hit.
 * One retained seam per victim leaves room for a full pack in the ribbon pool. */
export function drawWarriorAreaReceivingContact(
  host: SequencerHost,
  id: string,
  sourceId: number,
  targetId: number,
  tier: number,
  at: SeqPoint,
  profile: MeleeImpactProfile,
): void {
  const body = { x: 0, y: 0, z: 0 },
    point = { x: 0, y: 0, z: 0 };
  const from = host.anchorOf(sourceId, 0.5, body);
  const facing = from ? Math.atan2(at.x - from.x, at.z - from.z) : 0;
  const offset = facing - (host.facingAt?.(targetId) ?? facing);
  const dx = Math.sin(facing),
    dz = Math.cos(facing);
  const x = at.x - dx * 0.28,
    y = at.y,
    z = at.z - dz * 0.28;
  const heavy = id === 'bladestorm';
  const counter = id === 'revenge';
  const sweep = id === 'cleave',
    gyre = id === 'whirlwind';
  const duration = heavy ? 0.27 : 0.23;
  host.flipbookAt(
    x,
    y,
    z,
    counter || gyre ? 3.8 : heavy ? 4.6 : sweep ? 3.7 : 3.1,
    0xeaf4fa,
    'contact_cut',
    heavy ? 2.1 : 1.8,
    0.065,
    profile.angle,
  );
  let count = 1;
  if (
    host.bakedAt?.(
      'warrior_shear',
      x,
      y,
      z,
      counter ? 6 : heavy ? 7.4 : sweep ? 6.4 : gyre ? 6.2 : 4.4,
      0xffffff,
      0xdceaf3,
      duration,
      0,
      0,
      facing,
      false,
      profile.angle,
      heavy ? 1.5 : sweep || gyre ? 1.4 : 1,
    ) !== false &&
    host.bakedAt
  )
    count++;
  if (
    host.pathRibbon(
      0x293b48,
      counter ? 0.46 : heavy ? 0.5 : sweep ? 0.44 : gyre ? 0.42 : 0.34,
      duration,
      (points) => {
        const origin = host.anchorOf(targetId, meleeContactHeight(profile, 0), body);
        if (!origin) return 0;
        const yaw = (host.facingAt?.(targetId) ?? facing) + offset;
        const sx = Math.sin(yaw),
          sz = Math.cos(yaw);
        for (let i = 0; i < points.length; i++) {
          meleeContactPoint(profile, i / (points.length - 1), 0, 0, point);
          points[i].set(
            origin.x + sz * point.x + sx * (point.z - 0.26),
            origin.y + point.y,
            origin.z - sx * point.x + sz * (point.z - 0.26),
          );
        }
        return points.length;
      },
      true,
      null,
      true,
      0,
      null,
      true,
    ) !== false
  )
    count++;
  if (tier === 0 && host.fragmentsAt) {
    host.fragmentsAt(
      'metal_splinter',
      x,
      y,
      z,
      0xc6d2da,
      8,
      counter ? 1.45 : heavy ? 1.5 : sweep || gyre ? 1.4 : 1.2,
      dx,
      dz,
      0.24,
    );
    count++;
  }
  host.contact?.(sourceId, targetId, 'physical', profile.force, id, 0);
  host.countPrimitive(id, count);
}
