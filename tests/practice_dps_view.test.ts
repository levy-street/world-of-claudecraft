// The practice DPS tracker's pure core (src/ui/hud/practice/practice_dps_view.ts):
// which meters encounters count as practice runs, what the local player's
// numbers on them are, and when the strip has anything to say at all.
import { describe, expect, it } from 'vitest';
import { HEROIC_BOSS_DUMMY_ID, NORMAL_BOSS_DUMMY_ID } from '../src/sim/content/practice_dummies';
import {
  isPracticeDummy,
  PRACTICE_RUN_HISTORY,
  type PracticeEncounter,
  practiceDpsModel,
  practiceRunOf,
} from '../src/ui/hud/practice/practice_dps_view';

const ME = 7;
const OTHER = 9;

function enc(
  templateId: string | null,
  duration: number,
  dmg: Record<number, number>,
): PracticeEncounter {
  const tallies = new Map<number, { dmg: number }>();
  for (const [pid, amount] of Object.entries(dmg)) tallies.set(Number(pid), { dmg: amount });
  return { duration, mainMobTemplateId: templateId, tallies };
}

describe('isPracticeDummy', () => {
  it('is the single dummy template flag: every inert practice target, nothing else', () => {
    expect(isPracticeDummy('training_dummy')).toBe(true);
    expect(isPracticeDummy(NORMAL_BOSS_DUMMY_ID)).toBe(true);
    expect(isPracticeDummy(HEROIC_BOSS_DUMMY_ID)).toBe(true);
    expect(isPracticeDummy('boar')).toBe(false);
    expect(isPracticeDummy('no_such_mob')).toBe(false);
    expect(isPracticeDummy(null)).toBe(false);
    expect(isPracticeDummy(undefined)).toBe(false);
  });
});

describe('practiceRunOf', () => {
  it('reads the local player row only: total, duration and dps', () => {
    const run = practiceRunOf(enc('training_dummy', 10, { [ME]: 2500, [OTHER]: 9000 }), ME);
    expect(run).toEqual({ dummyTemplateId: 'training_dummy', total: 2500, duration: 10, dps: 250 });
  });

  it('is null off a real mob, and null when the player never hit the dummy', () => {
    expect(practiceRunOf(enc('boar', 10, { [ME]: 2500 }), ME)).toBe(null);
    expect(practiceRunOf(enc('training_dummy', 10, { [OTHER]: 2500 }), ME)).toBe(null);
    expect(practiceRunOf(enc(null, 10, { [ME]: 2500 }), ME)).toBe(null);
  });

  it('clamps the duration to a second, like the meters window', () => {
    const run = practiceRunOf(enc('training_dummy', 0, { [ME]: 300 }), ME);
    expect(run?.duration).toBe(1);
    expect(run?.dps).toBe(300);
  });
});

describe('practiceDpsModel', () => {
  it('is null with no live run and no dummy targeted, whatever the history holds', () => {
    const model = practiceDpsModel({
      current: enc('boar', 5, { [ME]: 100 }),
      history: [enc('training_dummy', 10, { [ME]: 1000 })],
      playerId: ME,
      targetTemplateId: 'boar',
    });
    expect(model).toBe(null);
  });

  it('shows an empty prompt model while a dummy is targeted before the first hit', () => {
    const model = practiceDpsModel({
      current: null,
      history: [],
      playerId: ME,
      targetTemplateId: 'training_dummy',
    });
    expect(model).toEqual({
      targetDummyId: 'training_dummy',
      live: null,
      previous: [],
      bestDps: 0,
    });
  });

  it('carries the live run and the finished dummy runs (newest first), skipping real fights', () => {
    const model = practiceDpsModel({
      current: enc('training_dummy', 4, { [ME]: 1200 }),
      history: [
        enc('training_dummy', 10, { [ME]: 2000 }), // newest finished: 200/s
        enc('boar', 10, { [ME]: 9999 }), // a real fight, not a run
        enc(NORMAL_BOSS_DUMMY_ID, 8, { [ME]: 3200 }), // 400/s, the best
        enc('training_dummy', 10, { [OTHER]: 5000 }), // someone else's run
      ],
      playerId: ME,
      targetTemplateId: null,
    });
    expect(model?.live?.dps).toBe(300);
    expect(model?.previous.map((r) => [r.dummyTemplateId, r.dps])).toEqual([
      ['training_dummy', 200],
      [NORMAL_BOSS_DUMMY_ID, 400],
    ]);
    expect(model?.bestDps).toBe(400);
    // Nothing targeted: the header falls back to the live run's dummy.
    expect(model?.targetDummyId).toBe(null);
  });

  it('marks the live run as best when it beats every finished one', () => {
    const model = practiceDpsModel({
      current: enc('training_dummy', 2, { [ME]: 1000 }),
      history: [enc('training_dummy', 10, { [ME]: 2000 })],
      playerId: ME,
      targetTemplateId: 'training_dummy',
    });
    expect(model?.bestDps).toBe(500);
  });

  it('keeps only the most recent PRACTICE_RUN_HISTORY finished runs', () => {
    const history: PracticeEncounter[] = [];
    for (let i = 0; i < PRACTICE_RUN_HISTORY + 3; i++) {
      history.push(enc('training_dummy', 10, { [ME]: 100 * (i + 1) }));
    }
    const model = practiceDpsModel({
      current: null,
      history,
      playerId: ME,
      targetTemplateId: 'training_dummy',
    });
    expect(model?.previous).toHaveLength(PRACTICE_RUN_HISTORY);
    expect(model?.previous[0]?.total).toBe(100);
    expect(model?.previous[PRACTICE_RUN_HISTORY - 1]?.total).toBe(100 * PRACTICE_RUN_HISTORY);
  });
});
