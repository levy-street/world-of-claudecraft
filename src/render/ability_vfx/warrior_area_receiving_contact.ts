import {
  type MeleeImpactProfile,
  meleeContactHeight,
  meleeContactPoint,
} from '../melee_impact_core';
import type { SeqPoint, SequencerHost } from './sequencer';
import { warriorImpactFan } from './warrior_impact_fan';

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
  echo = false,
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
    echo ? 9 : heavy ? 12 : counter || gyre ? 10 : sweep ? 10.5 : 8,
    0xb5d5ed,
    'warrior_steel_flash',
    heavy ? 5.2 : 4.2,
    heavy ? 0.32 : 0.28,
    profile.angle,
    1.3,
    facing,
  );
  let count = 1;
  const sprayed =
    host.bakedAt?.(
      'warrior_shear',
      x,
      y,
      z,
      echo ? 10.4 : counter ? 10.6 : heavy ? 12.6 : sweep ? 11 : gyre ? 10.8 : 7.4,
      0xffffff,
      0xdceaf3,
      duration,
      0,
      0,
      facing,
      false,
      profile.angle,
      heavy ? 1.75 : sweep || gyre || echo ? 1.65 : 1.4,
    ) !== false && !!host.bakedAt;
  if (sprayed) count++;
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
  // The real body imprint gets the last free slot before optional outgoing material.
  if (!sprayed)
    count += warriorImpactFan(
      host,
      { x, y, z },
      facing,
      profile.angle,
      heavy ? 4.4 : 3.6,
      0xa8bdc9,
      duration,
    );
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
      0.28,
      true,
    );
    count++;
  }
  host.contact?.(sourceId, targetId, 'physical', profile.force, id, 0);
  host.countPrimitive(id, count);
}
