import { describe, expect, it, vi } from 'vitest';
import {
  resetWorldQuestMatch3Wire,
  rotateWorldQuestPuzzleWire,
  swapWorldQuestMatch3Wire,
} from '../server/quest_command_wire';
import type { Sim } from '../src/sim/sim';

function simStub() {
  return {
    rotateWorldQuestPuzzleTile: vi.fn(),
    swapWorldQuestMatch3Tiles: vi.fn(),
    resetWorldQuestMatch3: vi.fn(),
  } as unknown as Sim;
}

describe('quest command wire', () => {
  it('forwards only a string quest id and safe integer tile index', () => {
    const sim = simStub();

    rotateWorldQuestPuzzleWire(sim, { quest: 'wq_galecrest_wisps', tileIndex: 4 }, 17);
    expect(sim.rotateWorldQuestPuzzleTile).toHaveBeenCalledWith('wq_galecrest_wisps', 4, 17);

    for (const message of [
      {},
      { quest: 7, tileIndex: 4 },
      { quest: 'wq_galecrest_wisps', tileIndex: '4' },
      { quest: 'wq_galecrest_wisps', tileIndex: 1.5 },
      { quest: 'wq_galecrest_wisps', tileIndex: Number.MAX_SAFE_INTEGER + 1 },
    ]) {
      rotateWorldQuestPuzzleWire(sim, message, 17);
    }
    expect(sim.rotateWorldQuestPuzzleTile).toHaveBeenCalledTimes(1);
  });

  it('validates match-three swap and reset command shapes', () => {
    const sim = simStub();
    swapWorldQuestMatch3Wire(
      sim,
      { quest: 'wq_palmreach_confections', fromIndex: 2, toIndex: 3 },
      17,
    );
    expect(sim.swapWorldQuestMatch3Tiles).toHaveBeenCalledWith(
      'wq_palmreach_confections',
      2,
      3,
      17,
    );
    for (const message of [
      { quest: 7, fromIndex: 2, toIndex: 3 },
      { quest: 'wq_palmreach_confections', fromIndex: '2', toIndex: 3 },
      { quest: 'wq_palmreach_confections', fromIndex: 2, toIndex: '3' },
      { quest: 'wq_palmreach_confections', fromIndex: 2.5, toIndex: 3 },
      { quest: 'wq_palmreach_confections', fromIndex: 2, toIndex: 3.5 },
      {
        quest: 'wq_palmreach_confections',
        fromIndex: Number.MAX_SAFE_INTEGER + 1,
        toIndex: 3,
      },
      {
        quest: 'wq_palmreach_confections',
        fromIndex: 2,
        toIndex: Number.MAX_SAFE_INTEGER + 1,
      },
    ]) {
      swapWorldQuestMatch3Wire(sim, message, 17);
    }
    expect(sim.swapWorldQuestMatch3Tiles).toHaveBeenCalledTimes(1);

    resetWorldQuestMatch3Wire(sim, { quest: 'wq_palmreach_confections' }, 17);
    resetWorldQuestMatch3Wire(sim, { quest: 4 }, 17);
    expect(sim.resetWorldQuestMatch3).toHaveBeenCalledOnce();
    expect(sim.resetWorldQuestMatch3).toHaveBeenCalledWith('wq_palmreach_confections', 17);
  });
});
