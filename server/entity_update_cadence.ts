import { VALE_CUP_BALL_TEMPLATE_ID } from '../src/sim/content/vale_cup';
import type { Entity } from '../src/sim/types';

// Distance-tiered update rates: full snapshot rate inside nameplate range
// (55yd, beyond every ability range), half rate out to the 80yd draw range,
// quarter rate beyond. The viewer's target and anything attacking the
// viewer always update at full rate regardless of distance.
const FULL_RATE_RADIUS_SQ = 55 * 55;
const HALF_RATE_RADIUS_SQ = 80 * 80;
const HALF_RATE_DIVISOR = 2;
const QUARTER_RATE_DIVISOR = 4;

// full rate close up and for anything the viewer is fighting; mid range
// updates every other tick, far entities every fourth. Measured against
// the per-session last-sent tick rather than a tick-parity stagger: when
// the event loop degrades and one broadcast covers several sim ticks, a
// parity check can stay permanently false and starve entities frozen
export function isUpdateDue(
  tick: number,
  e: Entity,
  d2: number,
  viewer: Entity,
  sentAtTick: number,
): boolean {
  // The one Vale Cup ball is watched by the whole Sowfield: a far keeper sits
  // past the 55yd full-rate tier and the stands past 80yd, where a ~25 yd/s
  // ball turns visibly steppy at half/quarter rate. One entity at full rate
  // costs one lite record per tick, so it is always due.
  if (e.templateId === VALE_CUP_BALL_TEMPLATE_ID) return true;
  if (d2 <= FULL_RATE_RADIUS_SQ) return true;
  if (viewer.targetId === e.id || e.aggroTargetId === viewer.id) return true;
  const divisor = d2 <= HALF_RATE_RADIUS_SQ ? HALF_RATE_DIVISOR : QUARTER_RATE_DIVISOR;
  return tick - sentAtTick >= divisor;
}
