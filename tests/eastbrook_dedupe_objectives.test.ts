import { describe, expect, it } from 'vitest';

import { ITEMS, MOBS, QUESTS } from '../src/sim/data';

// Eastbrook duplicate-objective rework (the one non-profession Eastbrook dupe).
describe('Eastbrook quest de-duplication', () => {
  describe('The Restless Dead becomes a skull collect (q_bones)', () => {
    it('adds a Restless Skull that drops from Restless Bones while on the quest', () => {
      expect(ITEMS.restless_skull?.questId).toBe('q_bones');
      const drop = (MOBS.restless_bones.loot ?? []).find((l) => l.itemId === 'restless_skull');
      expect(drop?.questId).toBe('q_bones');
      expect(drop?.chance).toBe(1); // guaranteed while on quest, so it stays concurrent
    });
    it('collects skulls instead of the kill duplicate shared with Silence the Call', () => {
      const q = QUESTS.q_bones;
      expect(q.objectives).toHaveLength(1);
      const o = q.objectives[0];
      expect(o.type).toBe('collect');
      if (o.type === 'collect') {
        expect(o.itemId).toBe('restless_skull');
        expect(o.count).toBe(8);
      }
      expect(q.objectives.some((x) => x.type === 'kill')).toBe(false);
      // Silence the Call keeps the kill, so the two quests are no longer identical.
      expect(
        QUESTS.q_silence_the_call.objectives.some(
          (x) => x.type === 'kill' && x.targetMobId === 'restless_bones',
        ),
      ).toBe(true);
    });
  });
});
