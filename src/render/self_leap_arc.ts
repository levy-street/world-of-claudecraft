export interface LeapPoint {
  x: number;
  y: number;
  z: number;
}

export interface SelfLeapArc {
  from: LeapPoint;
  to: LeapPoint;
  duration: number;
  apexHeight: number;
  elapsed: number;
}

const SELF_LEAP_MIN_DIST = 4;
const SELF_LEAP_MAX_DIST = 32;
const SELF_LEAP_MAX_VERTICAL_DELTA = 3;
const SELF_LEAP_DURATION_MIN = 0.42;
const SELF_LEAP_DURATION_MAX = 0.62;
const SELF_LEAP_APEX_MIN = 1.2;
const SELF_LEAP_APEX_MAX = 2.4;

export function createSelfLeapArc(from: LeapPoint, to: LeapPoint): SelfLeapArc | null {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const dy = Math.abs(to.y - from.y);
  const planarDist = Math.hypot(dx, dz);
  if (
    planarDist < SELF_LEAP_MIN_DIST ||
    planarDist > SELF_LEAP_MAX_DIST ||
    dy > SELF_LEAP_MAX_VERTICAL_DELTA
  ) {
    return null;
  }
  const distT = Math.min(1, Math.max(0, (planarDist - SELF_LEAP_MIN_DIST) / 12));
  return {
    from,
    to,
    duration: SELF_LEAP_DURATION_MIN + (SELF_LEAP_DURATION_MAX - SELF_LEAP_DURATION_MIN) * distT,
    apexHeight: SELF_LEAP_APEX_MIN + (SELF_LEAP_APEX_MAX - SELF_LEAP_APEX_MIN) * distT,
    elapsed: 0,
  };
}

export function advanceSelfLeapArc(
  arc: SelfLeapArc,
  dt: number,
): { point: LeapPoint; done: boolean; arc: SelfLeapArc } {
  const elapsed = Math.min(arc.duration, arc.elapsed + Math.max(0, dt));
  const t = arc.duration > 0 ? elapsed / arc.duration : 1;
  const x = arc.from.x + (arc.to.x - arc.from.x) * t;
  const y = arc.from.y + (arc.to.y - arc.from.y) * t + 4 * arc.apexHeight * t * (1 - t);
  const z = arc.from.z + (arc.to.z - arc.from.z) * t;
  return {
    point: { x, y, z },
    done: elapsed >= arc.duration,
    arc: { ...arc, elapsed },
  };
}
