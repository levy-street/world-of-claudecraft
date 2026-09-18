// Mechanical glider flight coordinator: pitch energy, swept course credit and landing.
// Pure deterministic sim logic: runs at 20 Hz, draws no DOM, Three.js or Math.random.

import { DT, type Entity, type MoveInput, normAngle } from '../types';
import { groundHeight } from '../world';
import { GLIDER_NEUTRAL_SINK, stepGliderEnergy } from './glider_energy';
import { applyGliderWind, type GliderWindTunnelDef } from './glider_wind';

export type { GliderWindTunnelDef } from './glider_wind';

export const GLIDER_BASE_FORWARD_SPEED = 22; // yards per second

export const GLIDER_BASE_SINK_RATE = GLIDER_NEUTRAL_SINK;
export const GLIDER_TURN_RATE = 2.4;
export const GLIDER_COUNTDOWN_TICKS = 60;
const GLIDER_MAX_DESCENT = 16;
const GLIDER_COURSE_MARGIN = 55;
const GLIDER_DEFAULT_TIMEOUT_SECONDS = 60;

export interface GliderRingDef {
  id: number;
  x: number;
  y: number;
  z: number;
  radius: number;
  boostY: number;
}

export interface GliderLandingPadDef {
  x: number;
  y: number;
  z: number;
  radius: number;
}

export interface GliderMedalTargets {
  goldSeconds: number;
  silverSeconds: number;
  timeoutSeconds: number;
}

export interface GliderCourseDef {
  id: string;
  rings: readonly GliderRingDef[];
  landingPad: GliderLandingPadDef;
  minRings: number;
  medals?: GliderMedalTargets;
  windTunnels?: readonly GliderWindTunnelDef[];
}

export interface GliderFlightResult {
  passedRings: number;
  totalRings: number;
  elapsedSeconds: number;
  rating: 'gold' | 'silver' | 'bronze';
  score: number;
}

export interface GliderFlightState {
  /** Session-only authored route; absent means the original daily course. */
  courseId?: string;
  /** Dev replay of an already claimed daily quest must never award another reward. */
  practiceOnly?: true;
  phase: 'countdown' | 'flying' | 'won' | 'failed';
  tick: number;
  countdownTicks: number;
  speed: number;
  vy: number;
  passedRings: number[];
  windBoosts?: string[];
  /** Next allowed manual boost, measured against this flight's tick. */
  boostReadyTick?: number;
  recentRingPassed?: { id: number; tick: number };
  result?: GliderFlightResult;
}

export function createGliderFlightState(startCountdown = true): GliderFlightState {
  return {
    phase: startCountdown ? 'countdown' : 'flying',
    tick: 0,
    countdownTicks: startCountdown ? GLIDER_COUNTDOWN_TICKS : 0,
    speed: startCountdown ? 0 : GLIDER_BASE_FORWARD_SPEED,
    vy: startCountdown ? 0 : GLIDER_BASE_SINK_RATE,
    passedRings: [],
    windBoosts: [],
    boostReadyTick: 0,
  };
}

export function scoreGliderFlight(
  passedCount: number,
  totalCount: number,
  elapsedSeconds: number,
  medals?: GliderMedalTargets,
): GliderFlightResult {
  const ringRatio = totalCount > 0 ? passedCount / totalCount : 0;
  let rating: 'gold' | 'silver' | 'bronze' = 'bronze';
  if (passedCount >= totalCount && elapsedSeconds <= (medals?.goldSeconds ?? 22)) {
    rating = 'gold';
  } else if (
    medals
      ? ringRatio >= 0.9 && elapsedSeconds <= medals.silverSeconds
      : ringRatio >= 0.8 || elapsedSeconds <= 28
  ) {
    rating = 'silver';
  }
  const ringScore = passedCount * 250;
  const timeBonus = Math.max(0, Math.round(((medals?.timeoutSeconds ?? 35) - elapsedSeconds) * 20));
  const score = ringScore + timeBonus;

  return {
    passedRings: passedCount,
    totalRings: totalCount,
    elapsedSeconds: Math.round(elapsedSeconds * 10) / 10,
    rating,
    score,
  };
}

type FlightPoint = { x: number; y: number; z: number };

/** Closest authored route segment, extrapolated before the first ring for launch. */
function courseProfile(point: FlightPoint, course: GliderCourseDef) {
  const points: readonly FlightPoint[] = [...course.rings, course.landingPad];
  let distance = Infinity;
  let height = course.landingPad.y;
  let segmentIndex = 0;
  for (let index = 0; index < points.length - 1; index++) {
    const a = points[index],
      b = points[index + 1];
    const dx = b.x - a.x,
      dz = b.z - a.z;
    const lengthSquared = dx * dx + dz * dz;
    const raw =
      lengthSquared > 0 ? ((point.x - a.x) * dx + (point.z - a.z) * dz) / lengthSquared : 0;
    const fraction = Math.max(index === 0 ? -1 : 0, Math.min(1, raw));
    const separation = Math.hypot(point.x - a.x - dx * fraction, point.z - a.z - dz * fraction);
    if (separation < distance) {
      distance = separation;
      segmentIndex = index;
      height = a.y + (b.y - a.y) * fraction;
    }
  }
  if (points.length === 1) distance = Math.hypot(point.x - points[0].x, point.z - points[0].z);
  return { distance, height, segmentIndex };
}

function segmentTouchesRing(a: FlightPoint, b: FlightPoint, ring: GliderRingDef): boolean {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    dz = b.z - a.z;
  const lengthSquared = dx * dx + dy * dy + dz * dz;
  const fraction =
    lengthSquared > 0
      ? Math.max(
          0,
          Math.min(
            1,
            ((ring.x - a.x) * dx + (ring.y - a.y) * dy + (ring.z - a.z) * dz) / lengthSquared,
          ),
        )
      : 0;
  return (
    Math.hypot(
      a.x + dx * fraction - ring.x,
      a.y + dy * fraction - ring.y,
      a.z + dz * fraction - ring.z,
    ) <= ring.radius
  );
}

export function tickGliderFlight(
  state: GliderFlightState,
  player: Entity,
  input: MoveInput,
  course: GliderCourseDef,
  worldSeed: number,
): void {
  if (state.phase === 'countdown') {
    state.countdownTicks = Math.max(0, state.countdownTicks - 1);
    player.vx = player.vy = player.vz = 0;
    if (state.countdownTicks === 0) {
      state.phase = 'flying';
      state.speed = GLIDER_BASE_FORWARD_SPEED;
      state.vy = GLIDER_BASE_SINK_RATE;
    }
    return;
  }
  if (state.phase !== 'flying') return;
  state.tick++;

  const left = Boolean(input.turnLeft || input.strafeLeft);
  const right = Boolean(input.turnRight || input.strafeRight);
  if (left !== right)
    player.facing = normAngle(player.facing + (left ? 1 : -1) * GLIDER_TURN_RATE * DT);

  const pad = course.landingPad;
  const previous = { ...player.pos };
  const padDistance = Math.hypot(player.pos.x - pad.x, player.pos.z - pad.z);
  const landing = padDistance <= pad.radius * 5 && state.passedRings.length >= course.minRings;
  const energy = stepGliderEnergy(state.speed, state.vy, input);
  state.speed = energy.speed;
  state.vy = energy.vy;
  if (landing)
    state.speed += (Math.min(state.speed, Math.max(8, padDistance * 0.4)) - state.speed) * 0.15;
  player.pos.x += Math.sin(player.facing) * state.speed * DT;
  player.pos.z += Math.cos(player.facing) * state.speed * DT;

  const profile = courseProfile(player.pos, course);
  const ground = groundHeight(player.pos.x, player.pos.z, worldSeed);
  // Final approach trades speed for a gentle touchdown inside the actual pad.
  if (landing) {
    const targetHeight = ground + Math.max(0, padDistance - pad.radius * 0.5) * 0.3;
    const targetVy = Math.max(-GLIDER_MAX_DESCENT, Math.min(0, (targetHeight - player.pos.y) * 4));
    state.vy += (targetVy - state.vy) * 0.25;
  }
  player.pos.y += state.vy * DT;
  const terrainContact = !landing && player.pos.y <= ground + 1.2;
  player.vx = (player.pos.x - previous.x) / DT;
  player.vy = (player.pos.y - previous.y) / DT;
  player.vz = (player.pos.z - previous.z) / DT;
  const wind = applyGliderWind(
    state.speed,
    state.windBoosts ?? [],
    previous,
    player.pos,
    course.windTunnels ?? [],
  );
  state.speed = wind.speed;
  state.windBoosts = wind.windBoosts;

  for (const ring of course.rings) {
    if (!state.passedRings.includes(ring.id) && segmentTouchesRing(previous, player.pos, ring)) {
      state.passedRings.push(ring.id);
      state.recentRingPassed = { id: ring.id, tick: state.tick };
    }
  }
  const distanceToPad = Math.hypot(player.pos.x - pad.x, player.pos.z - pad.z);
  const touchedPad = distanceToPad <= pad.radius && player.pos.y <= ground + 3;
  const last = course.rings[course.rings.length - 1];
  const endDx = last ? pad.x - last.x : 0,
    endDz = last ? pad.z - last.z : 1;
  const endLength = Math.hypot(endDx, endDz) || 1;
  const beyondEnd =
    profile.segmentIndex === course.rings.length - 1 &&
    ((player.pos.x - pad.x) * endDx + (player.pos.z - pad.z) * endDz) / endLength > 25;
  if (
    touchedPad ||
    terrainContact ||
    beyondEnd ||
    profile.distance > GLIDER_COURSE_MARGIN ||
    state.tick >= 20 * (course.medals?.timeoutSeconds ?? GLIDER_DEFAULT_TIMEOUT_SECONDS)
  ) {
    if (touchedPad && state.passedRings.length >= course.minRings) {
      state.phase = 'won';
      player.pos.y = ground;
      state.result = scoreGliderFlight(
        state.passedRings.length,
        course.rings.length,
        state.tick * DT,
        course.medals,
      );
    } else state.phase = 'failed';
    player.vx = player.vy = player.vz = 0;
  }
}
