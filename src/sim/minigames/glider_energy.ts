import { DT, type MoveInput } from '../types';

export const GLIDER_MIN_SPEED = 8;
export const GLIDER_MAX_SPEED = 38;
export const GLIDER_GRAVITY = 12;
export const GLIDER_NEUTRAL_SINK = -0.55;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/** Positive pitch spends airspeed on lift; a dive returns altitude to airspeed. */
export function gliderControlPitch(input: MoveInput): number {
  if (typeof input.gliderPitch === 'number' && Number.isFinite(input.gliderPitch))
    return clamp(input.gliderPitch, -1, 1);
  const up = Boolean(input.surface || input.jump),
    down = Boolean(input.dive);
  return up === down ? 0 : up ? 1 : -1;
}

/** Fixed-step energy exchange, with drag and a soft stall rather than powered flight. */
export function stepGliderEnergy(speed: number, vy: number, input: MoveInput) {
  speed = clamp(speed, GLIDER_MIN_SPEED, GLIDER_MAX_SPEED);
  const pitch = gliderControlPitch(input);
  const lift = clamp((speed - 10) / 8, 0, 1);
  const stallSink = Math.max(0, 14 - speed) * 0.8;
  // Stored dive speed gives a stronger pull-up, not a fixed slow climb.
  // The energy debit below still pays for every yard gained.
  const climbRate = 7 + Math.max(0, speed - 22) * 0.7;
  const requestedVy =
    GLIDER_NEUTRAL_SINK + (pitch >= 0 ? pitch * climbRate * lift : pitch * 14) - stallSink;
  vy += (clamp(requestedVy, -16, 16) - vy) * 0.18;
  // Never create potential energy at the minimum-speed floor, even during pitch inertia.
  vy = Math.min(vy, (speed * speed - GLIDER_MIN_SPEED ** 2) / (2 * GLIDER_GRAVITY * DT));
  const braking = input.back && !input.forward;
  const drag = 0.18 + Math.max(0, speed - 22) * 0.09 + (braking ? 3 : 0);
  const energy = speed * speed - 2 * GLIDER_GRAVITY * vy * DT - 2 * drag * speed * DT;
  return { speed: clamp(Math.sqrt(Math.max(0, energy)), GLIDER_MIN_SPEED, GLIDER_MAX_SPEED), vy };
}
