import { courierFlightBlend, courierLegSegmentAt } from '../sim/courier/motion';

/** Read-only presentation subset of the authoritative courier snapshot. */
export interface CourierVisualInfo {
  phase: 'ready' | 'outbound' | 'returning' | 'waiting';
  x: number;
  z: number;
  travelTicks?: number;
  legTicks?: number;
  travelDistance?: number;
  remainingDistance?: number;
}

export interface CourierVisualPose {
  lift: number;
  flight: number;
  moving: boolean;
  /** Nose-up body tilt in radians: hops, takeoff climb and the landing skid. */
  pitch: number;
  /** Run cycle playback rate; the skid slows the legs to a stop. */
  stride: number;
}

export const COURIER_FLIGHT_LIFT = 2;
/** Each pre-takeoff hop springs a little higher than the last. */
export const COURIER_HOP_HEIGHTS = [0.35, 0.5, 0.7] as const;
/** A server that predates per-leg timing ran fixed ten-second legs. */
const LEGACY_LEG_TICKS = 200;

function smoothstep(t: number): number {
  const u = Math.max(0, Math.min(1, t));
  return u * u * (3 - 2 * u);
}

function grounded(out: CourierVisualPose, moving: boolean): void {
  out.flight = 0;
  out.lift = 0;
  out.pitch = 0;
  out.stride = 1;
  out.moving = moving;
}

/** Run, hops, takeoff, cruise, descent and skid follow authoritative leg ticks.
 * Reduced motion keeps the essential flight altitude, and the caller freezes clips. */
export function courierVisualPoseInto(
  out: CourierVisualPose,
  info: CourierVisualInfo,
  moved: boolean,
): void {
  const travelling = info.phase === 'outbound' || info.phase === 'returning';
  const remaining = info.remainingDistance ?? 0;
  if (!travelling) {
    grounded(out, moved);
    return;
  }
  if (info.travelTicks === undefined) {
    grounded(out, moved || remaining > 0);
    out.flight = courierFlightBlend(info.travelDistance ?? 0, remaining);
    out.lift = COURIER_FLIGHT_LIFT * out.flight;
    return;
  }
  // A paused or arrived leg rests on the ground at its last authoritative point.
  if (remaining <= 0) {
    grounded(out, moved);
    return;
  }
  grounded(out, true);
  const { segment, u, hop } = courierLegSegmentAt(
    info.travelTicks,
    info.legTicks ?? LEGACY_LEG_TICKS,
  );
  switch (segment) {
    case 'run':
      return;
    case 'hop': {
      const arc = 4 * u * (1 - u);
      out.lift = (COURIER_HOP_HEIGHTS[hop] ?? COURIER_HOP_HEIGHTS[0]) * arc;
      // Nose up on the spring, level again for the landing.
      out.pitch = 0.18 * (1 - 2 * u);
      return;
    }
    case 'takeoff':
      out.flight = smoothstep(u);
      out.lift = COURIER_FLIGHT_LIFT * out.flight;
      out.pitch = 0.3 * Math.sin(Math.PI * u);
      return;
    case 'cruise':
      out.flight = 1;
      out.lift = COURIER_FLIGHT_LIFT;
      return;
    case 'descent':
      out.flight = 1 - smoothstep(u);
      out.lift = COURIER_FLIGHT_LIFT * out.flight;
      // Flare the nose up just before touchdown.
      out.pitch = 0.22 * smoothstep(u);
      return;
    case 'skid':
      // Lean back hardest at touchdown and settle level as the slide stops.
      out.pitch = 0.35 * (1 - u) * Math.min(1, u * 6 + 0.6);
      out.stride = Math.max(0.15, 1 - u);
      return;
  }
}

export const COURIER_SPIN_SECONDS = 1;
export const COURIER_DANCE_SECONDS = 1.2;
export const COURIER_VANISH_SECONDS = 0.4;
export const COURIER_FAREWELL_SECONDS = COURIER_SPIN_SECONDS + COURIER_VANISH_SECONDS;
/** A delivered courier spins; one dismissed without a trip dances. */
export type CourierFarewellKind = 'spin' | 'dance';

export interface CourierFarewellPose {
  /** Extra yaw added to the last facing (one full turn by the spin's end). */
  spin: number;
  /** Side-to-side body tilt in radians (the dance's sway). */
  roll: number;
  lift: number;
  scale: number;
  done: boolean;
}

export function courierFarewellSeconds(kind: CourierFarewellKind): number {
  return (kind === 'dance' ? COURIER_DANCE_SECONDS : COURIER_SPIN_SECONDS) + COURIER_VANISH_SECONDS;
}

/** After the final delivery the donkey does one happy hop-spin; dismissed
 * unsent, it dances (three bounces, swaying hips) instead. Then it shrinks away. */
export function courierFarewellPoseInto(
  out: CourierFarewellPose,
  elapsed: number,
  kind: CourierFarewellKind = 'spin',
): void {
  const t = Math.max(0, elapsed);
  const show = kind === 'dance' ? COURIER_DANCE_SECONDS : COURIER_SPIN_SECONDS;
  const u = Math.min(1, t / show);
  if (kind === 'dance') {
    out.spin = 0.45 * Math.sin(4 * Math.PI * u);
    out.roll = 0.2 * Math.sin(6 * Math.PI * u);
    out.lift = 0.3 * Math.abs(Math.sin(3 * Math.PI * u));
  } else {
    out.spin = 2 * Math.PI * smoothstep(u);
    out.roll = 0;
    out.lift = 0.45 * 4 * u * (1 - u);
  }
  const vanishU = Math.max(0, Math.min(1, (t - show) / COURIER_VANISH_SECONDS));
  out.done = t >= show + COURIER_VANISH_SECONDS;
  out.scale = out.done ? 0 : 1 - vanishU * vanishU;
  out.lift += 0.3 * vanishU;
}

/** True when the last observed pose was the return skid, so a vanished
 * snapshot means a completed delivery rather than a cancelled or unloaded one. */
export function courierDelivered(last: CourierVisualInfo | null): boolean {
  return (
    last?.phase === 'returning' &&
    last.travelTicks !== undefined &&
    last.legTicks !== undefined &&
    last.travelTicks <= last.legTicks &&
    last.legTicks - last.travelTicks <= 10
  );
}

/** Which goodbye a vanished courier plays: a spin after its return skid, a dance
 * when it was waiting unsent (dismissed), and none otherwise (unloaded or cancelled). */
export function courierFarewellKind(last: CourierVisualInfo | null): CourierFarewellKind | null {
  if (courierDelivered(last)) return 'spin';
  return last?.phase === 'ready' ? 'dance' : null;
}

/** No route prediction: orient along the last observed authoritative movement. */
export function courierFacing(
  previousX: number,
  previousZ: number,
  x: number,
  z: number,
  yaw: number,
): number {
  return Math.hypot(x - previousX, z - previousZ) > 0.001
    ? Math.atan2(x - previousX, z - previousZ)
    : yaw;
}
