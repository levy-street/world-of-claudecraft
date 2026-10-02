// A Fire and Fly plan holding both limited weapons: a scenario's waves (Standing Watch's
// by default) with 2 Shockwaves and 3 fragmentation shells. The weapon suites test the
// weapons' own rules on it, apart from each scenario's arsenal, which is level design
// (fire_and_fly_scenarios.ts).
import { TURRET_SCENARIO_STANDARD } from '../../src/sim/content/fire_and_fly_scenarios';
import { resolveTurretPlan, type TurretPlan } from '../../src/sim/minigames/turret_defense_plan';
import type { TurretScenarioDef } from '../../src/sim/types';

export function turretArmedScenario(base: TurretScenarioDef = TURRET_SCENARIO_STANDARD) {
  return { ...base, arsenal: { shockwave: 2, fragmentation: 3 } } satisfies TurretScenarioDef;
}

export function resolveArmedTurretPlan(base?: TurretScenarioDef): TurretPlan {
  return resolveTurretPlan(turretArmedScenario(base));
}
