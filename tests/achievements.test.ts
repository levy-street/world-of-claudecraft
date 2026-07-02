import { describe, expect, it } from 'vitest';
import {
  ACHIEVEMENTS,
  applyAchievementEvaluation,
  emptyAchievementState,
  normalizeAchievementState,
  unlockAchievement,
} from '../src/sim/achievements';
import { Sim } from '../src/sim/sim';
import { MAX_LEVEL } from '../src/sim/types';

function makeSim() {
  return new Sim({ seed: 11, playerClass: 'warrior', autoEquip: true });
}

function serializePrimary(sim: Sim) {
  const state = sim.serializeCharacter(sim.playerId);
  if (!state) throw new Error('expected primary character to serialize');
  return state;
}

describe('achievement state', () => {
  it('normalizes persisted unlocks and recomputes points from current defs', () => {
    const state = normalizeAchievementState({
      unlocked: ['unknown', 'level_20', 'level_10', 'level_10'],
      points: 999,
    });

    const expectedPoints = ACHIEVEMENTS.filter((achievement) =>
      ['level_10', 'level_20'].includes(achievement.id),
    ).reduce((sum, achievement) => sum + achievement.points, 0);

    expect(state.unlocked).toEqual(['level_10', 'level_20']);
    expect(state.points).toBe(expectedPoints);
  });

  it('unlocks known ids once', () => {
    const state = emptyAchievementState();

    expect(unlockAchievement(state, 'level_10')).toBe(true);
    expect(unlockAchievement(state, 'level_10')).toBe(false);
    expect(unlockAchievement(state, 'not_real')).toBe(false);
    expect(state.unlocked).toEqual(['level_10']);
  });

  it('applies all criteria met by the current sim snapshot', () => {
    const state = emptyAchievementState();

    const unlocked = applyAchievementEvaluation(state, {
      level: MAX_LEVEL,
      lifetimeXp: 1_000,
      counters: { kills: 10, deaths: 0, xpGained: 1_000, questsCompleted: 0, levelUps: 19 },
    });

    expect(unlocked).toEqual(['level_10', 'level_20', 'lifetime_xp_1000', 'kills_10']);
    expect(
      applyAchievementEvaluation(state, {
        level: MAX_LEVEL,
        lifetimeXp: 1_000,
        counters: { kills: 10, deaths: 0, xpGained: 1_000, questsCompleted: 0, levelUps: 19 },
      }),
    ).toEqual([]);
  });
});

describe('Sim achievement integration', () => {
  it('unlocks level achievements when player level changes', () => {
    const sim = makeSim();

    sim.setPlayerLevel(10);

    expect(sim.achievements.unlocked).toEqual(['level_10', 'lifetime_xp_1000']);
    sim.setPlayerLevel(MAX_LEVEL);
    expect(sim.achievements.unlocked).toContain('level_20');
  });

  it('unlocks lifetime-XP achievements after XP awards', () => {
    const sim = makeSim();

    sim.grantXp(1_000);

    expect(sim.achievements.unlocked).toContain('lifetime_xp_1000');
  });

  it('keeps returned achievement state detached from PlayerMeta', () => {
    const sim = makeSim();
    sim.unlockAchievement('level_10');

    const state = sim.achievementsFor();
    state.unlocked.push('level_20');
    state.points = 999;

    expect(sim.achievements).toEqual({ unlocked: ['level_10'], points: 10 });
  });

  it('round-trips achievement unlocks through character persistence', () => {
    const sim = makeSim();
    sim.unlockAchievement('level_10');
    const state = serializePrimary(sim);

    const restored = new Sim({ seed: 11, playerClass: 'warrior', noPlayer: true });
    const pid = restored.addPlayer('warrior', 'Restored', { state });

    expect(restored.achievementsFor(pid)).toEqual({ unlocked: ['level_10'], points: 10 });
  });

  it('loads legacy characters with an empty achievement state', () => {
    const sim = makeSim();
    const state = serializePrimary(sim);
    delete state.achievements;

    const restored = new Sim({ seed: 11, playerClass: 'warrior', noPlayer: true });
    const pid = restored.addPlayer('warrior', 'Legacy', { state });

    expect(restored.achievementsFor(pid)).toEqual({ unlocked: [], points: 0 });
  });
});
