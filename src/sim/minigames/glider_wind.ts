import { GLIDER_MAX_SPEED } from './glider_energy';

export interface GliderWindTunnelDef {
  id: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  radius: number;
  length: number;
  speedBoost: number;
}

type Point = { x: number; y: number; z: number };

/** Swept forward center-plane crossing: standing inside or reverse entry never boosts. */
export function crossesGliderWind(a: Point, b: Point, tunnel: GliderWindTunnelDef): boolean {
  const dx = Math.sin(tunnel.yaw),
    dz = Math.cos(tunnel.yaw);
  const before = (a.x - tunnel.x) * dx + (a.z - tunnel.z) * dz;
  const after = (b.x - tunnel.x) * dx + (b.z - tunnel.z) * dz;
  if (before >= 0 || after < 0) return false;
  const fraction = -before / (after - before);
  const x = a.x + (b.x - a.x) * fraction - tunnel.x;
  const y = a.y + (b.y - a.y) * fraction - tunnel.y;
  const z = a.z + (b.z - a.z) * fraction - tunnel.z;
  return Math.hypot(x * dz - z * dx, y) <= tunnel.radius;
}

export function applyGliderWind(
  speed: number,
  used: readonly string[],
  a: Point,
  b: Point,
  tunnels: readonly GliderWindTunnelDef[],
): { speed: number; windBoosts: string[] } {
  const windBoosts = [...used];
  for (const tunnel of tunnels) {
    if (windBoosts.includes(tunnel.id) || !crossesGliderWind(a, b, tunnel)) continue;
    windBoosts.push(tunnel.id);
    speed = Math.min(GLIDER_MAX_SPEED, speed + tunnel.speedBoost);
  }
  return { speed, windBoosts };
}
