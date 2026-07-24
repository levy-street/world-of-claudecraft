// Scenario registry leaf: the def table plus register/lookup, split out of
// scenarios.ts so CONTENT modules can register at load without a runtime
// import cycle. The cycle it breaks: scenarios.ts imports data.ts (DUNGEONS,
// MOBS, QUESTS) while data.ts imports content/last_bell_campaign.ts, which
// registers its scenarios at module eval; registering through the engine
// module hits its consts mid-evaluation (a TDZ ReferenceError that appears
// or vanishes with the host's import order). This leaf imports only types
// (erased at runtime), so the registration path is always safe.

import type { ScenarioDef } from './scenarios';

const SCENARIOS: Record<string, ScenarioDef> = {};

export function registerScenario(def: ScenarioDef): void {
  SCENARIOS[def.id] = def;
}

export function scenarioById(id: string): ScenarioDef | undefined {
  return SCENARIOS[id];
}
