import { expect, it, vi } from 'vitest';
import type { SimContext } from '../src/sim/sim_context';
import { worldQuestCreditBindings } from '../src/sim/world_quest_context';
import * as quests from '../src/sim/world_quests';

vi.mock('../src/sim/world_quests', () => ({
  completeWorldQuestEscort: vi.fn(),
  hasActiveWorldQuest: vi.fn(),
  onMobKilledForWorldQuests: vi.fn(),
  onNodeGatheredForWorldQuests: vi.fn(),
  onObjectInteractedForWorldQuests: vi.fn(),
}));

it('reads the live context lazily for every quest-credit callback', () => {
  let current = { time: 1 } as SimContext;
  const readContext = vi.fn(() => current);
  const bindings = worldQuestCreditBindings(readContext);
  expect(readContext).not.toHaveBeenCalled();
  expect(bindings.hasActiveWorldQuest).toBe(quests.hasActiveWorldQuest);
  const target = {} as never;
  const meta = {} as never;
  bindings.onMobKilledForWorldQuests(target, meta);
  expect(quests.onMobKilledForWorldQuests).toHaveBeenCalledWith(current, target, meta);
  current = { time: 2 } as SimContext;
  bindings.onNodeGatheredForWorldQuests(target, meta);
  bindings.onObjectInteractedForWorldQuests(target, meta);
  bindings.completeWorldQuestEscort(meta, 'quest', 'escort', target);
  expect(quests.onNodeGatheredForWorldQuests).toHaveBeenCalledWith(current, target, meta);
  expect(quests.onObjectInteractedForWorldQuests).toHaveBeenCalledWith(current, target, meta);
  expect(quests.completeWorldQuestEscort).toHaveBeenCalledWith(
    current,
    meta,
    'quest',
    'escort',
    target,
  );
});
