import { expect, it, vi } from 'vitest';
import { dispatchCollectionAction } from '../src/ui/collection_actions_core';

it('routes the Cosmetics action once and leaves unrelated actions to their caller', () => {
  const toggleCosmetics = vi.fn();
  const host = { toggleCosmetics } as never;
  expect(dispatchCollectionAction('cosmetics', host)).toBe(true);
  expect(toggleCosmetics).toHaveBeenCalledOnce();
  expect(dispatchCollectionAction('escape', host)).toBe(false);
  expect(dispatchCollectionAction('toString', host)).toBe(false);
  expect(toggleCosmetics).toHaveBeenCalledOnce();
});

it.each([
  ['deeds', 'toggleDeeds'],
  ['professions', 'toggleProfessions'],
  ['reliquary', 'toggleReliquary'],
  ['cosmetics', 'toggleCosmetics'],
  ['harvestJournal', 'toggleHarvestJournal'],
  ['perfecting', 'togglePerfecting'],
  ['lootExplorer', 'toggleLootExplorer'],
])('dispatches %s through its original toggle', (action, method) => {
  const toggle = vi.fn();
  expect(dispatchCollectionAction(action, { [method]: toggle } as never)).toBe(true);
  expect(toggle).toHaveBeenCalledOnce();
});
