import { TICK_RATE } from '../types';
import { GLIDER_MAX_SPEED } from './glider_energy';
import type { GliderFlightState } from './glider_flight';

export const GLIDER_BOOST_SPEED = 14;
export const GLIDER_BOOST_COOLDOWN_SECONDS = 10;
export const GLIDER_BOOST_COOLDOWN_TICKS = GLIDER_BOOST_COOLDOWN_SECONDS * TICK_RATE;

/** Session-clock boost: repeated commands cannot accelerate or reset the cooldown. */
export function applyGliderBoost(state: GliderFlightState): boolean {
  if (state.phase !== 'flying' || state.tick < (state.boostReadyTick ?? 0)) return false;
  state.speed = Math.min(GLIDER_MAX_SPEED, state.speed + GLIDER_BOOST_SPEED);
  state.boostReadyTick = state.tick + GLIDER_BOOST_COOLDOWN_TICKS;
  return true;
}
