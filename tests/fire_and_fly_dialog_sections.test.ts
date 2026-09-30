import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TURRET_MISSIONS } from '../src/sim/content/fire_and_fly_missions';
import { TURRET_SCENARIOS } from '../src/sim/content/fire_and_fly_scenarios';
import {
  FIRE_AND_FLY_NPC_DEF,
  FIRE_AND_FLY_QUEST_ID,
} from '../src/sim/content/world_quest_fire_and_fly';
import type { FireAndFlyRecruitment } from '../src/sim/fire_and_fly_recruitment';
import type { Entity } from '../src/sim/types';
import { FIRE_AND_FLY_TRIAL_TEXT } from '../src/ui/fire_and_fly_trial_view';
import { ensureLocaleLoaded, setLanguage, t } from '../src/ui/i18n';
import { fireAndFlyDialogSections } from '../src/ui/world_quest_fire_and_fly_view';
import { worldQuestInstructorDialog } from '../src/ui/world_quest_instructor_view';

const NONE: FireAndFlyRecruitment = { trialsWon: 0, recruited: false };
const PARTIAL: FireAndFlyRecruitment = { trialsWon: 1, recruited: false };
const ALL_TRIALS: FireAndFlyRecruitment = { trialsWon: 2, recruited: false };
const RECRUITED: FireAndFlyRecruitment = { trialsWon: TURRET_SCENARIOS.length, recruited: true };

const MISSION_NAMES = [
  'The Pack',
  'Heavy Tread',
  'The Deluge',
  'The Cracked Tower',
  'The Powder Store',
] as const;
const MISSIONS_LOCKED = "Pass the Veterans' Test to be recruited and open the missions.";

const alder = { id: 9, kind: 'npc', templateId: FIRE_AND_FLY_NPC_DEF.id } as Entity;

function world(state: 'active' | 'completed', recruitment?: FireAndFlyRecruitment) {
  return {
    worldQuestLog: new Map([
      [FIRE_AND_FLY_QUEST_ID, { questId: FIRE_AND_FLY_QUEST_ID, count: 0, state }],
    ]),
    player: { id: 1, level: 20, dead: false, pos: { x: 0, y: 0, z: 0 } } as Entity,
    ...(recruitment ? { fireAndFlyRecruitment: recruitment } : {}),
  };
}

beforeEach(() => setLanguage('en'));
afterEach(() => setLanguage('en'));

describe("Master Gunner Alder's dialog sections", () => {
  it('opens with the first trial only, each locked one naming the win that opens it', () => {
    const [trials, missions] = fireAndFlyDialogSections(false, NONE);
    expect(trials.key).toBe('trials');
    expect(trials.title).toBe('Trials');
    expect(trials.choices.map((c) => c.key)).toEqual(['introduction']);
    expect(trials.locked).toEqual([
      "Standing Watch: pass the Recruit's Trial to open it",
      "Veterans' Test: pass the Standing Watch to open it",
    ]);
    expect(missions.key).toBe('missions');
    expect(missions.title).toBe('Missions');
    expect(missions.choices).toEqual([]);
    expect(missions.locked).toEqual([MISSIONS_LOCKED]);
  });

  it('opens each next trial as the one before it is won', () => {
    const [trials, missions] = fireAndFlyDialogSections(false, PARTIAL);
    expect(trials.choices.map((c) => c.key)).toEqual(['introduction', 'standard']);
    expect(trials.locked).toEqual(["Veterans' Test: pass the Standing Watch to open it"]);
    expect(missions.locked).toEqual([MISSIONS_LOCKED]);
    const [open, stillLocked] = fireAndFlyDialogSections(false, ALL_TRIALS);
    expect(open.choices.map((c) => c.key)).toEqual(['introduction', 'standard', 'hard']);
    expect(open.locked).toEqual([]);
    expect(stillLocked.choices).toEqual([]);
    expect(stillLocked.locked).toEqual([MISSIONS_LOCKED]);
  });

  it("gives a recruit every trial and the five missions, each with Alder's pitch", () => {
    const [trials, missions] = fireAndFlyDialogSections(false, RECRUITED);
    expect(trials.choices).toHaveLength(TURRET_SCENARIOS.length);
    expect(trials.locked).toEqual([]);
    expect(missions.locked).toEqual([]);
    expect(missions.choices.map((c) => c.difficulty)).toEqual(
      TURRET_MISSIONS.map((m) => ({ courseId: m.id })),
    );
    expect(missions.choices.map((c) => c.key)).toEqual(TURRET_MISSIONS.map((m) => m.boardKey));
    missions.choices.forEach((choice, i) => {
      expect(choice.label).toBe(
        t('questUi.worldQuest.fireAndFly.start', {
          name: MISSION_NAMES[i],
          detail: t(FIRE_AND_FLY_TRIAL_TEXT[TURRET_MISSIONS[i].boardKey].pitch),
          count: String(TURRET_MISSIONS[i].waves.length),
        }),
      );
    });
    expect(missions.choices[0].label).toBe(
      `The Pack: they run in packs; make each shell count (waves: ${TURRET_MISSIONS[0].waves.length})`,
    );
  });

  it("turns trials and missions into practice runs after the day's win", () => {
    const [trials, missions] = fireAndFlyDialogSections(true, RECRUITED);
    expect(trials.choices[0].label).toBe("Practice the Recruit's Trial (waves: 3)");
    expect(missions.choices.map((c) => c.label)).toEqual(
      TURRET_MISSIONS.map((m, i) => `${MISSION_NAMES[i]}: practice run (waves: ${m.waves.length})`),
    );
  });

  it('follows the language', async () => {
    await ensureLocaleLoaded('zh_CN');
    setLanguage('zh_CN');
    const [trials, missions] = fireAndFlyDialogSections(false, NONE);
    expect(trials.title).toBe(t('questUi.worldQuest.fireAndFly.sections.trials'));
    expect(trials.title).not.toBe('Trials');
    expect(missions.locked[0]).not.toBe(MISSIONS_LOCKED);
    expect(missions.locked[0]).toContain(t('questUi.worldQuest.fireAndFly.scenarios.hard'));
  });
});

describe('the instructor dialog view', () => {
  it('carries the sections and lists only their buttons as the picks', () => {
    for (const recruitment of [NONE, PARTIAL, RECRUITED]) {
      const view = worldQuestInstructorDialog(world('active', recruitment), alder);
      expect(view?.sections).toEqual(fireAndFlyDialogSections(false, recruitment));
      expect(view?.difficulties).toEqual(view?.sections?.flatMap((s) => s.choices));
    }
  });

  it('reads a world without the recruitment as a character that has won nothing', () => {
    const view = worldQuestInstructorDialog(world('completed'), alder);
    expect(view?.sections).toEqual(fireAndFlyDialogSections(true, NONE));
    expect(view?.difficulties?.map((c) => c.key)).toEqual(['introduction']);
  });

  it('keeps practice and the daily reward wording for missions too', () => {
    const view = worldQuestInstructorDialog(world('completed', RECRUITED), alder);
    expect(view?.hint).toBe(
      'Practice: play again without earning more coins, experience or reputation.',
    );
    expect(view?.sections?.[1].choices.every((c) => c.label.includes('practice run'))).toBe(true);
  });
});
