import { describe, expect, it } from 'vitest';
import { WORLD_QUESTS_BY_ID } from '../src/sim/data';
import { armDailyWorldQuestForDev } from '../src/sim/dev_world_quest_daily';
import { Sim } from '../src/sim/sim';
import { resolveWorldQuestLeyPuzzle } from '../src/sim/world_quest_daily_levels';
import { sanitizeWorldQuestProgress } from '../src/sim/world_quests';

describe('developer daily world quest selector', () => {
  it('opens ley on day two without advancing the selected day', () => {
    const sim = new Sim({ seed: 991, playerClass: 'warrior', devCommands: true });
    sim.chat('/dev wq candy 1');
    sim.chat('/dev wq ley 2');
    expect(sim.worldQuestCycle).toBe('wq1_1');
    expect(sim.worldQuestLog.get('wq_galecrest_wisps')?.puzzleDay).toBe(1);
    expect(sim.players.get(sim.playerId)?.openWorldQuestPuzzleId).toBe('wq_galecrest_wisps');
  });

  it.each(['candy', 'ley'])('opens different %s days and repeats after thirty-two', (kind) => {
    const sim = new Sim({ seed: 991, playerClass: 'warrior', devCommands: true });
    const id = kind === 'candy' ? 'wq_palmreach_confections' : 'wq_galecrest_wisps';
    const meta = sim.players.get(sim.playerId)!;
    const layouts: unknown[] = [];
    for (const day of [1, 2, 33]) {
      sim.chat(`/dev wq ${kind} ${day}`);
      sim.tick();
      const progress = meta.worldQuestLog.get(id)!;
      expect(progress.puzzleDay).toBe((day - 1) % 32);
      expect(meta.openWorldQuestPuzzleId).toBe(id);
      expect(sanitizeWorldQuestProgress([progress], meta.worldQuestCycle)[0]?.puzzleDay).toBe(
        progress.puzzleDay,
      );
      layouts.push(
        kind === 'candy'
          ? progress.match3Board
          : resolveWorldQuestLeyPuzzle(WORLD_QUESTS_BY_ID[id], progress),
      );
      if (kind === 'ley') expect(progress.puzzleExpiresAt! - sim.time).toBeCloseTo(89.95, 2);
    }
    expect(layouts[0]).not.toEqual(layouts[1]);
    expect(layouts[0]).toEqual(layouts[2]);
  });

  it('resets an already open attempt of the same day', () => {
    const sim = new Sim({ seed: 991, playerClass: 'warrior', devCommands: true });
    sim.chat('/dev wq candy 3');
    const meta = sim.players.get(sim.playerId)!;
    const first = meta.worldQuestLog.get('wq_palmreach_confections')!;
    const board = [...first.match3Board!];
    first.match3Moves = 10;
    first.match3Board![0] = first.match3Board![0] === 0 ? 1 : 0;
    sim.chat('/dev wq candy 3');
    const next = meta.worldQuestLog.get(first.questId)!;
    expect(next).not.toBe(first);
    expect(next.match3Moves).toBe(0);
    expect(next.match3Board).toEqual(board);
  });

  it.each(['0', '-1', '1.5', 'Infinity', '9007199254740992', '1 extra', ''])(
    'rejects invalid day %s without changing progress',
    (input) => {
      const sim = new Sim({ seed: 991, playerClass: 'warrior', devCommands: true });
      sim.chat('/dev wq candy 2');
      const meta = sim.players.get(sim.playerId)!;
      const cycle = meta.devWorldQuestCycle;
      const progress = structuredClone([...meta.worldQuestLog]);
      const open = meta.openWorldQuestPuzzleId;
      const pos = { ...sim.player.pos };
      sim.chat(`/dev wq ley ${input}`);
      expect(meta.devWorldQuestCycle).toBe(cycle);
      expect([...meta.worldQuestLog]).toEqual(progress);
      expect(meta.openWorldQuestPuzzleId).toBe(open);
      expect(sim.player.pos).toEqual(pos);
    },
  );

  it('does not enable daily previews on a production host', () => {
    const sim = new Sim({ seed: 991, playerClass: 'warrior', devCommands: false });
    expect(armDailyWorldQuestForDev(sim.ctx, sim.playerId, 'ley', '1')).toBe(false);
    sim.chat('/dev wq candy 2');
    expect(sim.players.get(sim.playerId)?.devWorldQuestCycle).toBeNull();
    expect(sim.worldQuestLog.size).toBe(0);
  });
});
