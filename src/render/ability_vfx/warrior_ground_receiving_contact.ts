import {
  type MeleeImpactProfile,
  meleeContactHeight,
  meleeContactPoint,
} from '../melee_impact_core';
import type { SeqPoint, SequencerHost } from './sequencer';

/** Ground pressure is cast-owned; only this compact compression belongs to
 * each real recipient. Its retained seam owns its scratch and body facing. */
export function drawWarriorGroundReceivingContact(
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
  const relative = facing - (host.facingAt?.(targetId) ?? facing);
  const dx = Math.sin(facing),
    dz = Math.cos(facing);
  const quake = id === 'thunder_clap',
    rupture = id === 'faultline',
    compression = quake || rupture,
    surface = compression ? 0.26 : 0;
  const x = at.x - dx * surface,
    y = at.y,
    z = at.z - dz * surface;
  host.flipbookAt(
    x,
    y,
    z,
    rupture ? 5.6 : quake ? 4.1 : 2.8,
    compression ? 0xe1eaf0 : 0xc4c9c9,
    'contact_crush',
    1.7,
    rupture ? 0.085 : quake ? 0.07 : 0.21,
    compression ? 0 : 0.3,
    rupture ? 0.82 : quake ? 0.68 : 1,
  );
  host.pathRibbon(
    compression ? 0x334650 : 0xa8b3b5,
    rupture ? 0.46 : quake ? 0.34 : 0.18,
    0.2,
    (points) => {
      const origin = host.anchorOf(targetId, meleeContactHeight(profile, 0), body);
      if (!origin) return 0;
      const yaw = (host.facingAt?.(targetId) ?? facing) + relative;
      const sx = Math.sin(yaw),
        sz = Math.cos(yaw);
      for (let i = 0; i < points.length; i++) {
        const u = i / (points.length - 1);
        if (compression) {
          point.x = (u - 0.5) * (rupture ? 2.45 : 1.95);
          point.y = Math.abs(u - 0.46) * (rupture ? 0.46 : 0.32) + Math.sin(u * 19) * 0.035;
          point.z = -surface;
        } else meleeContactPoint(profile, u, 0, 0, point);
        points[i].set(
          origin.x + sz * point.x + sx * point.z,
          origin.y + point.y,
          origin.z - sx * point.x + sz * point.z,
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
  );
  if (tier === 0)
    host.fragmentsAt?.(
      'stone_chip',
      x,
      y,
      z,
      0x9da4a7,
      8,
      rupture ? 1.6 : quake ? 1.2 : 0.9,
      dx,
      dz,
      0.22,
    );
  host.contact?.(sourceId, targetId, 'physical', profile.force, id, 0);
  host.countPrimitive(id, tier === 0 ? 3 : 2);
}
