// Fire and Fly speed spread: a kind with a pace band gives each of its monsters its own
// pace, drawn once at the spawn from a stream keyed by the monster's id, so arrivals
// trickle in instead of landing as one blob. A monster's pace rides its record (the
// client cannot draw), and every march leg it plans reads it. Pure: a stateless draw.

import type { TurretDefenseState, TurretMonster } from './turret_defense';
import type { TurretKind } from './turret_defense_plan';
import { TURRET_STREAM, type TurretDrawSource, turretDraw } from './turret_defense_rng';

/** The pace a new monster of `kind` draws (yd/s); undefined on a kind with no band. */
export function turretDrawPace(
  source: TurretDrawSource,
  kind: TurretKind,
  id: number,
): number | undefined {
  const max = kind.marchSpeedMax;
  if (max === undefined) return undefined;
  return kind.marchSpeed + turretDraw(source, TURRET_STREAM.pace, id) * (max - kind.marchSpeed);
}

/** The pace a monster's next march leg takes: its own, else its kind's. */
export function turretPaceOf(state: Pick<TurretDefenseState, 'plan'>, m: TurretMonster): number {
  return m.pace ?? state.plan.kinds[m.kind].marchSpeed;
}
