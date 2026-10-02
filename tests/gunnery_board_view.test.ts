import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { QuestWorldWireState } from '../src/net/quest_world_wire_state';
import { TURRET_MISSIONS } from '../src/sim/content/fire_and_fly_missions';
import {
  FIRE_AND_FLY_SCENARIOS,
  TURRET_SCENARIO_INTRODUCTION,
  TURRET_SCENARIOS,
} from '../src/sim/content/fire_and_fly_scenarios';
import { recordPersonalFireAndFlyScore } from '../src/sim/fire_and_fly_personal_records';
import type { FireAndFlyRecruitment } from '../src/sim/fire_and_fly_recruitment';
import { fireAndFlyScoreboardId } from '../src/sim/fire_and_fly_scoreboards';
import { Sim } from '../src/sim/sim';
import type { TurretArsenalDef } from '../src/sim/types';
import { WORLD_SEED } from '../src/sim/world_seed';
import {
  buildGunneryBoardView,
  type GunneryBest,
  type GunneryBoardInput,
  gunneryBestsFromRecords,
  gunneryBoardDefaultSelection,
  gunneryBoardStep,
  gunneryBriefKey,
  gunneryMasteryStars,
} from '../src/ui/hud/quest/gunnery_board_view';
import { ensureLocaleLoaded, setLanguage, t } from '../src/ui/i18n';

const FRESH: FireAndFlyRecruitment = { trialsWon: 0, recruited: false };
const ONE_WON: FireAndFlyRecruitment = { trialsWon: 1, recruited: false };
const RECRUITED: FireAndFlyRecruitment = { trialsWon: TURRET_SCENARIOS.length, recruited: true };
const NO_BESTS: ReadonlyMap<string, GunneryBest> = new Map();

const [PACK, GIANTS, DELUGE, BRITTLE, POWDER] = TURRET_MISSIONS;

function input(overrides: Partial<GunneryBoardInput> = {}): GunneryBoardInput {
  return {
    recruitment: FRESH,
    rewardCollected: false,
    bests: NO_BESTS,
    selectedId: null,
    speakerName: 'Master Gunner Alder',
    speakerTitle: 'Gunnery Recruiter',
    greeting: 'Take a trial.',
    ...overrides,
  };
}

/** A recruited gunner with mixed medals: every trial won, two missions medalled. */
const MIXED: ReadonlyMap<string, GunneryBest> = new Map([
  [TURRET_SCENARIOS[0].id, { medal: 'gold', points: 9_400 }],
  [TURRET_SCENARIOS[1].id, { medal: 'silver', points: 15_200 }],
  [TURRET_SCENARIOS[2].id, { medal: 'gold', points: 21_000 }],
  [PACK.id, { medal: 'gold', points: 20_900 }],
  [DELUGE.id, { medal: 'bronze', points: 11_050 }],
]);

beforeEach(() => setLanguage('en'));
afterEach(() => setLanguage('en'));

describe('the Gunnery Board rows', () => {
  it('lists the three trials under Recruitment and the five missions under Missions, in order', () => {
    const view = buildGunneryBoardView(input());
    expect(view.sections.map((s) => s.title)).toEqual(['Recruitment', 'Missions']);
    expect(view.sections[0].rows.map((r) => r.scenarioId)).toEqual(
      TURRET_SCENARIOS.map((s) => s.id),
    );
    expect(view.sections[1].rows.map((r) => r.name)).toEqual([
      'The Pack',
      'Heavy Tread',
      'The Deluge',
      'The Cracked Tower',
      'The Powder Store',
    ]);
  });

  it('marks a fresh recruit: the first trial open, the rest and every mission locked', () => {
    const view = buildGunneryBoardView(input());
    const states = view.sections.flatMap((s) => s.rows.map((r) => r.state));
    expect(states).toEqual(['open', 'locked', 'locked', ...TURRET_MISSIONS.map(() => 'locked')]);
    const first = view.sections[0].rows[0];
    expect(first.stateText).toBe('Not won yet');
    expect(view.sections[0].rows[1].stateText).toBe('Locked');
  });

  it("shows each scenario's best medal, a dash for an unwon one, from the bests", () => {
    const view = buildGunneryBoardView(input({ recruitment: RECRUITED, bests: MIXED }));
    const rows = view.sections.flatMap((s) => s.rows);
    expect(rows.map((r) => r.medal)).toEqual([
      'gold',
      'silver',
      'gold',
      'gold',
      null,
      'bronze',
      null,
      null,
    ]);
    expect(rows.map((r) => r.state)).toEqual([
      'medal',
      'medal',
      'medal',
      'medal',
      'open',
      'medal',
      'open',
      'open',
    ]);
    expect(rows[1].stateText).toBe('Silver medal');
    expect(rows[0].medalArt).toBe('/ui/world-quests/leaderboard/medal_gold.webp');
    expect(rows[4].medalArt).toBeNull();
  });

  it('marks a trial the recruitment won but no ladder row names as won, medal unknown', () => {
    const view = buildGunneryBoardView(input({ recruitment: RECRUITED }));
    const trials = view.sections[0].rows;
    expect(trials.map((r) => r.state)).toEqual(['won', 'won', 'won']);
    expect(trials[0].stateText).toBe('Won');
    expect(trials[0].medal).toBeNull();
    expect(view.selectedId).toBe(PACK.id);
  });

  it('never shows a medal on a locked row', () => {
    const bests = new Map([[PACK.id, { medal: 'gold' as const, points: 1 }]]);
    const view = buildGunneryBoardView(input({ recruitment: ONE_WON, bests }));
    const pack = view.sections[1].rows[0];
    expect(pack.state).toBe('locked');
    expect(pack.medal).toBeNull();
  });
});

describe('the default selection', () => {
  it("opens on the recruitment's next trial while no record names a medal", () => {
    expect(gunneryBoardDefaultSelection(FRESH, NO_BESTS)).toBe(TURRET_SCENARIOS[0].id);
    expect(gunneryBoardDefaultSelection(ONE_WON, NO_BESTS)).toBe(TURRET_SCENARIOS[1].id);
    expect(gunneryBoardDefaultSelection(RECRUITED, NO_BESTS)).toBe(PACK.id);
  });

  it('opens on the first open scenario without a medal', () => {
    expect(gunneryBoardDefaultSelection(RECRUITED, MIXED)).toBe(GIANTS.id);
  });

  it('then on the first one without gold, then on the first open one', () => {
    const allMedalled = new Map(MIXED);
    for (const mission of [GIANTS, BRITTLE, POWDER])
      allMedalled.set(mission.id, { medal: 'gold', points: 1 });
    expect(gunneryBoardDefaultSelection(RECRUITED, allMedalled)).toBe(TURRET_SCENARIOS[1].id);
    const allGold = new Map(
      FIRE_AND_FLY_SCENARIOS.map((s) => [s.id, { medal: 'gold' as const, points: 1 }]),
    );
    expect(gunneryBoardDefaultSelection(RECRUITED, allGold)).toBe(TURRET_SCENARIOS[0].id);
  });

  it("keeps the player's pick, locked or not, and falls back on an unknown one", () => {
    expect(buildGunneryBoardView(input({ selectedId: POWDER.id })).selectedId).toBe(POWDER.id);
    expect(buildGunneryBoardView(input({ selectedId: 'nope' })).selectedId).toBe(
      TURRET_SCENARIOS[0].id,
    );
    const view = buildGunneryBoardView(input({ recruitment: RECRUITED, selectedId: DELUGE.id }));
    expect(view.sections[1].rows.filter((r) => r.selected).map((r) => r.scenarioId)).toEqual([
      DELUGE.id,
    ]);
  });

  it('steps through every row with the arrows, wrapping at both ends', () => {
    expect(gunneryBoardStep(TURRET_SCENARIOS[0].id, 'ArrowDown')).toBe(TURRET_SCENARIOS[1].id);
    expect(gunneryBoardStep(TURRET_SCENARIOS[2].id, 'ArrowRight')).toBe(PACK.id);
    expect(gunneryBoardStep(TURRET_SCENARIOS[0].id, 'ArrowUp')).toBe(POWDER.id);
    expect(gunneryBoardStep(POWDER.id, 'Home')).toBe(TURRET_SCENARIOS[0].id);
    expect(gunneryBoardStep(PACK.id, 'End')).toBe(POWDER.id);
    expect(gunneryBoardStep(PACK.id, 'Enter')).toBeNull();
  });
});

describe('the detail panel', () => {
  it("reads the arsenal off the scenario: each weapon's charges, a missing one as zero", () => {
    for (const scenario of FIRE_AND_FLY_SCENARIOS) {
      const view = buildGunneryBoardView(
        input({ recruitment: RECRUITED, selectedId: scenario.id }),
      );
      const arsenal: TurretArsenalDef = scenario.arsenal ?? {};
      expect(view.detail.arsenal.map((chip) => chip.text)).toEqual([
        `Shockwave x${arsenal.shockwave ?? 0}`,
        `Fragmentation Shell x${arsenal.fragmentation ?? 0}`,
      ]);
      expect(view.detail.arsenal.map((chip) => chip.empty)).toEqual([
        (arsenal.shockwave ?? 0) <= 0,
        (arsenal.fragmentation ?? 0) <= 0,
      ]);
      expect(view.detail.wavesText).toBe(String(scenario.waves.length));
    }
  });

  it("states the gold bar as the share of the tower to keep, from the scenario's medals", () => {
    const pack = buildGunneryBoardView(input({ recruitment: RECRUITED, selectedId: PACK.id }));
    expect(pack.detail.goldText).toBe(
      `Keep ${Math.round(PACK.medals.gold.minIntegrityShare * 100)}% of the tower`,
    );
    const brittle = buildGunneryBoardView(
      input({ recruitment: RECRUITED, selectedId: BRITTLE.id }),
    );
    expect(brittle.detail.goldText).toBe('Keep 100% of the tower');
  });

  it('names the best run with its medal and points, or says none yet', () => {
    const won = buildGunneryBoardView(
      input({ recruitment: RECRUITED, bests: MIXED, selectedId: PACK.id }),
    );
    expect(won.detail.bestText).toBe('Gold medal, 20,900 points');
    expect(won.detail.bestMedal).toBe('gold');
    const none = buildGunneryBoardView(
      input({ recruitment: RECRUITED, bests: MIXED, selectedId: GIANTS.id }),
    );
    expect(none.detail.bestText).toBe('Not played yet');
    expect(none.detail.bestMedalArt).toBeNull();
  });

  it("shows today's reward as available, or collected with practice runs only", () => {
    expect(buildGunneryBoardView(input()).detail.rewardText).toBe('Available');
    const collected = buildGunneryBoardView(input({ rewardCollected: true })).detail;
    expect(collected.rewardText).toBe('Collected: practice runs only');
    expect(collected.rewardCollected).toBe(true);
  });

  it('gives a brief to all eight scenarios, each its own', () => {
    const briefs = FIRE_AND_FLY_SCENARIOS.map((s) => {
      const key = gunneryBriefKey(s.boardKey);
      expect(key).not.toBeNull();
      return key ? t(key) : '';
    });
    expect(briefs).toHaveLength(8);
    expect(new Set(briefs).size).toBe(8);
    for (const brief of briefs) {
      const sentences = brief.split(/[.!?](\s|$)/).filter((part) => part.trim().length > 1);
      expect(sentences.length).toBeGreaterThanOrEqual(2);
      expect(sentences.length).toBeLessThanOrEqual(3);
    }
    const view = buildGunneryBoardView(input({ recruitment: RECRUITED, selectedId: BRITTLE.id }));
    expect(view.detail.brief).toBe(t('questUi.worldQuest.fireAndFly.brief.brittle'));
    expect(view.detail.kicker).toBe('Mission');
  });
});

describe('the one action', () => {
  it('takes a trial or a mission, by group', () => {
    expect(buildGunneryBoardView(input()).detail.actionLabel).toBe('Take the trial');
    const mission = buildGunneryBoardView(input({ recruitment: RECRUITED, selectedId: PACK.id }));
    expect(mission.detail.actionLabel).toBe('Take the mission');
    expect(mission.detail.actionAria).toBe('Take the mission: The Pack');
    expect(mission.detail.actionDisabled).toBe(false);
  });

  it("is a practice once today's reward is collected", () => {
    const view = buildGunneryBoardView(input({ rewardCollected: true }));
    expect(view.detail.actionLabel).toBe('Practice');
  });

  it('is disabled on a locked scenario, with what opens it', () => {
    const trial = buildGunneryBoardView(input({ selectedId: TURRET_SCENARIOS[2].id })).detail;
    expect(trial.actionDisabled).toBe(true);
    expect(trial.lockedReason).toBe('Win the Standing Watch to open this trial.');
    const mission = buildGunneryBoardView(input({ recruitment: ONE_WON, selectedId: PACK.id }));
    expect(mission.detail.actionDisabled).toBe(true);
    expect(mission.detail.lockedReason).toBe(
      "Win the Veterans' Test to be recruited and open the missions.",
    );
    expect(mission.detail.bestText).toBe('Not played yet');
  });
});

describe('the header', () => {
  it('counts the trials won, then says Recruited with the Mastery stars', () => {
    const fresh = buildGunneryBoardView(input({ recruitment: ONE_WON }));
    expect(fresh.recruitmentText).toBe('Trials won: 1 of 3');
    expect(fresh.masteryText).toBeNull();
    const recruited = buildGunneryBoardView(input({ recruitment: RECRUITED, bests: MIXED }));
    expect(recruited.recruitmentText).toBe('Recruited');
    expect(recruited.masteryText).toBe("Gunner's Mastery: 4 of 15 stars");
    expect(buildGunneryBoardView(input({ recruitment: RECRUITED })).masteryText).toBe(
      "Gunner's Mastery: 0 of 15 stars",
    );
  });

  it('sums the Mastery stars over the missions only: gold 3, silver 2, bronze 1', () => {
    expect(gunneryMasteryStars(MIXED)).toBe(4);
    expect(gunneryMasteryStars(NO_BESTS)).toBe(0);
  });
});

describe("the bests, from the character's own records", () => {
  it("takes each scenario's all-time record, never a trial's day row", () => {
    const intro = TURRET_SCENARIO_INTRODUCTION.id;
    const records = {
      [fireAndFlyScoreboardId(intro, 'daily')!]: {
        metric: 9_900,
        medal: 'gold',
        day: '2030-01-02',
      },
      [fireAndFlyScoreboardId(intro, 'lifetime')!]: {
        metric: 8_000,
        medal: 'silver',
        day: '2030-01-01',
      },
      [fireAndFlyScoreboardId(PACK.id, 'lifetime')!]: {
        metric: 20_900,
        medal: 'gold',
        day: '2030-01-01',
      },
    } as const;
    expect([...gunneryBestsFromRecords(records)]).toEqual([
      [intro, { medal: 'silver', points: 8_000 }],
      [PACK.id, { medal: 'gold', points: 20_900 }],
    ]);
    expect(gunneryBestsFromRecords({}).size).toBe(0);
  });
});

describe('the same input, the same board', () => {
  it('builds identical views from the offline records and their online mirror', () => {
    const sim = new Sim({ seed: WORLD_SEED, playerClass: 'warrior' });
    const meta = sim.meta(sim.playerId)!;
    meta.fireAndFlyRecruitment = { trialsWon: 3, recruited: true };
    recordPersonalFireAndFlyScore(meta.fireAndFlyRecords, PACK.id, '2030-01-01', 'gold', 20_900);
    recordPersonalFireAndFlyScore(meta.fireAndFlyRecords, DELUGE.id, '2030-01-01', 'bronze', 900);
    const client = new QuestWorldWireState();
    client.applyQuestSelfSnapshot(
      JSON.parse(
        JSON.stringify({ ffr: meta.fireAndFlyRecruitment, ffrec: meta.fireAndFlyRecords }),
      ),
    );
    const board = (world: Pick<Sim, 'fireAndFlyRecruitment' | 'fireAndFlyRecords'>) =>
      buildGunneryBoardView(
        input({
          recruitment: world.fireAndFlyRecruitment,
          bests: gunneryBestsFromRecords(world.fireAndFlyRecords),
        }),
      );
    const offline = board(sim);
    expect(offline.masteryText).toBe("Gunner's Mastery: 4 of 15 stars");
    expect(board(client)).toEqual(offline);
  });

  it('follows the language', async () => {
    const english = t('questUi.worldQuest.fireAndFly.brief.pack');
    await ensureLocaleLoaded('zh_CN');
    setLanguage('zh_CN');
    const view = buildGunneryBoardView(input({ recruitment: RECRUITED, selectedId: PACK.id }));
    expect(view.title).toBe(t('hudChrome.gunneryBoard.title'));
    expect(view.title).not.toBe('Gunnery Board');
    expect(view.detail.brief).not.toBe(english);
  });
});
