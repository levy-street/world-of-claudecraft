import { beforeEach, describe, expect, it } from 'vitest';
import { turretPlanWireJson, turretStateWireJson } from '../server/turret_self_wire';
import { decodeTurretPlan, decodeTurretSeat } from '../src/net/turret_session_wire';
import { FIRE_AND_FLY_DUNGEON_ID } from '../src/sim/content/fire_and_fly_arena';
import {
  TURRET_SCENARIO_HARD,
  TURRET_SCENARIO_INTRODUCTION,
  TURRET_SCENARIO_STANDARD,
  TURRET_SCENARIOS,
} from '../src/sim/content/fire_and_fly_scenarios';
import { createTurretDefense } from '../src/sim/minigames/turret_defense';
import { resolveTurretPlan } from '../src/sim/minigames/turret_defense_plan';
import { turretSessionView } from '../src/sim/turret_defense_session';
import type { TurretScenarioDef, TurretSession } from '../src/sim/types';
import { dungeonDisplayName } from '../src/ui/entity_i18n';
import {
  FIRE_AND_FLY_TRIAL_TEXT,
  fireAndFlyTrialName,
  interiorMinimapLabel,
} from '../src/ui/fire_and_fly_trial_view';
import { TurretHudView } from '../src/ui/hud/vehicle/turret_hud_view';
import { ensureLocaleLoaded, setLanguage, t } from '../src/ui/i18n';
import { fireAndFlyTrialChoices } from '../src/ui/world_quest_fire_and_fly_view';
import type { TurretSessionView } from '../src/world_api/vehicles';

function seatFor(scenario: TurretScenarioDef): TurretSession {
  return {
    kind: 'turret',
    origin: { x: 0, y: 0, z: 0 },
    defense: createTurretDefense(resolveTurretPlan(scenario), { x: 0, z: 0 }, 5, 100),
    priorMountKey: '',
    returnTo: { x: 0, y: 0, z: 0, facing: 0 },
    feedback: [],
    nextFeedbackSeq: 1,
  };
}

const TRIALS = [
  [TURRET_SCENARIO_INTRODUCTION, "Recruit's Trial"],
  [TURRET_SCENARIO_STANDARD, 'Standing Watch'],
  [TURRET_SCENARIO_HARD, "Veterans' Test"],
] as const;

beforeEach(() => setLanguage('en'));

describe('the Fire and Fly trial name', () => {
  it.each(TRIALS)('names the %# scenario by its trial', (scenario, name) => {
    expect(fireAndFlyTrialName(scenario.id)).toBe(name);
  });

  it('names every scenario the instructor offers', () => {
    for (const scenario of TURRET_SCENARIOS) expect(fireAndFlyTrialName(scenario.id)).toBeTruthy();
  });

  it("gives the instructor's buttons the same names, from the one table", () => {
    const choices = fireAndFlyTrialChoices(false);
    expect(choices.map((c) => c.key)).toEqual(TURRET_SCENARIOS.map((s) => s.boardKey));
    for (const scenario of TURRET_SCENARIOS) {
      const text = FIRE_AND_FLY_TRIAL_TEXT[scenario.boardKey];
      const label = choices.find((c) => c.key === scenario.boardKey)!.label;
      expect(label).toContain(fireAndFlyTrialName(scenario.id)!);
      expect(label).toContain(t(text.pitch));
    }
  });

  it('has no name for an unknown scenario or a board key without a trial', () => {
    expect(fireAndFlyTrialName('fire_and_fly_custom')).toBeNull();
    const unnamed = { ...TURRET_SCENARIO_STANDARD, id: 'fire_and_fly_new', boardKey: 'new' };
    expect(fireAndFlyTrialName(unnamed.id, [unnamed])).toBeNull();
    expect(fireAndFlyTrialName('fire_and_fly_standard', [])).toBeNull();
  });

  it('follows the language', async () => {
    await ensureLocaleLoaded('zh_CN');
    setLanguage('zh_CN');
    const name = fireAndFlyTrialName(TURRET_SCENARIO_STANDARD.id);
    expect(name).toBe(t('questUi.worldQuest.fireAndFly.scenarios.standard'));
    expect(name).not.toBe('Standing Watch');
  });
});

describe('the interior minimap label', () => {
  it.each(TRIALS)("reads the %# seat's trial in the arena", (scenario, name) => {
    const session = turretSessionView(seatFor(scenario));
    expect(interiorMinimapLabel(FIRE_AND_FLY_DUNGEON_ID, session)).toBe(name);
  });

  it('keeps the arena name outside a session', () => {
    const arena = dungeonDisplayName(FIRE_AND_FLY_DUNGEON_ID);
    expect(arena).toBe('Fire and Fly');
    expect(interiorMinimapLabel(FIRE_AND_FLY_DUNGEON_ID, null)).toBe(arena);
    expect(interiorMinimapLabel(FIRE_AND_FLY_DUNGEON_ID, undefined)).toBe(arena);
  });

  it('keeps the arena name for a scenario without a trial name', () => {
    const session = turretSessionView(seatFor(TURRET_SCENARIO_STANDARD));
    const custom = {
      defense: { ...session.defense, plan: { ...session.defense.plan, scenarioId: 'custom' } },
    };
    expect(interiorMinimapLabel(FIRE_AND_FLY_DUNGEON_ID, custom)).toBe('Fire and Fly');
  });

  it('never renames another instance, even with a seat up', () => {
    const session = turretSessionView(seatFor(TURRET_SCENARIO_HARD));
    expect(interiorMinimapLabel('hollow_crypt', session)).toBe(dungeonDisplayName('hollow_crypt'));
  });

  it.each(TRIALS)("reads the %# seat's trial the same off the online mirror", (scenario, name) => {
    const session = seatFor(scenario);
    const plan = decodeTurretPlan(JSON.parse(turretPlanWireJson(session.defense.plan)));
    expect(plan).not.toBeNull();
    const decoded = decodeTurretSeat(JSON.parse(turretStateWireJson(session, 100)), plan!);
    expect(decoded).not.toBeNull();
    const online: TurretSessionView = { ...decoded!, feedback: [] };
    expect(interiorMinimapLabel(FIRE_AND_FLY_DUNGEON_ID, online)).toBe(name);
    expect(new TurretHudView().tick(online, 100).labels.trial).toBe(name);
  });
});
