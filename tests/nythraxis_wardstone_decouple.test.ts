import { describe, expect, it } from 'vitest';
import { DUNGEONS, ITEMS } from '../src/sim/data';

describe('Nythraxis raid wardstone is decoupled from the overworld quest item', () => {
  it('nythraxis_wardstone is not a real item and carries no questId', () => {
    expect(ITEMS.nythraxis_wardstone).toBeUndefined();
  });

  it('the overworld bastion_ward_stone is still the q_bastion_door collectible', () => {
    expect(ITEMS.bastion_ward_stone?.questId).toBe('q_bastion_door');
  });

  it('the raid spawns three nythraxis_wardstone objects, none carrying the quest item id', () => {
    const arena = DUNGEONS.nythraxis_boss_arena;
    expect(arena).toBeDefined();
    expect(arena.objects?.length).toBe(3);
    for (const obj of arena.objects ?? []) {
      expect(obj.itemId).toBe('nythraxis_wardstone');
    }
  });
});
