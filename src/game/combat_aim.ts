export type CombatAimSource = 'cursor' | 'facing';

export interface CombatAimIntent {
  source: CombatAimSource;
  angle: number;
  point: { x: number; z: number } | null;
}

export interface CombatAimInput {
  player: { x: number; z: number };
  facing: number;
  cursorPoint: { x: number; z: number } | null;
  useFacing: boolean;
}

export function normalizeCombatAimAngle(value: number): number {
  return Math.atan2(Math.sin(value), Math.cos(value));
}

/**
 * Resolve one frame's directional-combat intent. A missing/degenerate cursor
 * ray deliberately falls back to facing; the previous cursor direction is
 * never retained, so moving the pointer off the usable viewport cannot leave a
 * stale shot armed.
 */
export function resolveCombatAimIntent(input: CombatAimInput): CombatAimIntent {
  if (!input.useFacing && input.cursorPoint) {
    const dx = input.cursorPoint.x - input.player.x;
    const dz = input.cursorPoint.z - input.player.z;
    if (Number.isFinite(dx) && Number.isFinite(dz) && Math.hypot(dx, dz) > 1e-6) {
      return {
        source: 'cursor',
        angle: normalizeCombatAimAngle(Math.atan2(dx, dz)),
        point: input.cursorPoint,
      };
    }
  }
  return {
    source: 'facing',
    angle: normalizeCombatAimAngle(input.facing),
    point: null,
  };
}

export function pointAlongCombatAim(
  origin: { x: number; z: number },
  angle: number,
  distance = 100,
): { x: number; z: number } {
  const safeDistance = Number.isFinite(distance) ? Math.max(0, distance) : 0;
  const normalized = normalizeCombatAimAngle(angle);
  return {
    x: origin.x + Math.sin(normalized) * safeDistance,
    z: origin.z + Math.cos(normalized) * safeDistance,
  };
}
