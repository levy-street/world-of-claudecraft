import { abilityHexColor } from './ability_vfx_core';
import { abilityVfxFullSpec } from './ability_vfx_registry';

interface WaterPoint {
  x: number;
  y: number;
  z: number;
}
interface WaterStreamHost {
  waterVolume?(
    from: WaterPoint,
    to: WaterPoint,
    tint: number,
    accent: number,
    width: number,
    duration?: number,
  ): void;
  pathRibbon(
    color: number,
    width: number,
    life: number,
    fill: (points: { set(x: number, y: number, z: number): unknown }[]) => number,
  ): void;
}

/** Real chain-heal hops share the editable water identity and the already
 * prepared ribbon pool. Three interlaced streams replace the dotted green cord.
 * Endpoints come from the heal event, never inferred proximity or fake bounces. */
export function drawRestorativeStream(
  host: WaterStreamHost,
  from: WaterPoint,
  to: WaterPoint,
): void {
  const spec = abilityVfxFullSpec('chain_heal');
  if (!spec) return;
  const dx = to.x - from.x,
    dy = to.y - from.y,
    dz = to.z - from.z;
  const horizontal = Math.hypot(dx, dz);
  if (Math.hypot(horizontal, dy) < 0.001) return;
  const lift = Math.min(1.8, 0.35 + horizontal * 0.14);
  const sideX = horizontal > 0.001 ? -dz / horizontal : 1;
  const sideZ = horizontal > 0.001 ? dx / horizontal : 0;
  if (host.waterVolume) {
    const accent =
      typeof spec.accent === 'number' ? spec.accent : abilityHexColor(spec.accent ?? '#bbeee8');
    host.waterVolume(
      from,
      to,
      abilityHexColor(spec.tint ?? '#319cac'),
      accent,
      0.17 * (spec.power ?? 1),
      0.85,
    );
    return;
  }
  for (let strand = 0; strand < 3; strand++) {
    const value = strand === 0 ? spec.tint : spec.accent;
    const color =
      typeof value === 'number'
        ? value
        : abilityHexColor(value ?? (strand === 0 ? '#319cac' : '#bbeee8'));
    host.pathRibbon(
      color,
      (strand === 0 ? 0.15 : 0.035) * (spec.power ?? 1),
      strand === 0 ? 0.7 : 0.55,
      (points) => {
        for (let i = 0; i < 12; i++) {
          const u = i / 11;
          const envelope = Math.sin(u * Math.PI);
          const wave =
            strand === 0 ? 0 : Math.sin(u * Math.PI * 3 + strand * Math.PI) * envelope * 0.13;
          points[i].set(
            from.x + dx * u + sideX * wave,
            from.y + dy * u + lift * envelope + wave * 0.4,
            from.z + dz * u + sideZ * wave,
          );
        }
        return 12;
      },
    );
  }
}
