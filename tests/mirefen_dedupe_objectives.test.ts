import { describe, expect, it } from 'vitest';

import { CAMPS, MOBS, QUESTS } from '../src/sim/data';

// Mirefen duplicate-objective rework: each duplicate quest keeps its id (no DB
// breakage) but gets a distinct objective so two quests are no longer literal
// copies. See docs/design and the quest-dedupe worktree.
describe('Mirefen quest de-duplication', () => {
  describe('No Rest in the Reeds becomes an elite capstone (q_no_rest)', () => {
    it('adds an elite Drowned Warlord mob', () => {
      const warlord = MOBS.drowned_warlord;
      expect(warlord).toBeDefined();
      expect(warlord.elite).toBe(true);
      expect(warlord.family).toBe('undead');
    });

    it('places the Drowned Warlord in the world at least once', () => {
      const camps = CAMPS.filter((c) => c.mobId === 'drowned_warlord');
      expect(camps.length).toBeGreaterThanOrEqual(1);
      expect(camps.every((c) => c.count >= 1)).toBe(true);
    });

    it('repoints q_no_rest at the elite and drops the drowned_dead kill duplicate', () => {
      const q = QUESTS.q_no_rest;
      expect(q.objectives).toHaveLength(1);
      const obj = q.objectives[0];
      expect(obj.type).toBe('kill');
      if (obj.type === 'kill') {
        expect(obj.targetMobId).toBe('drowned_warlord');
        expect(obj.count).toBe(1);
      }
      // The old duplicate objective (kill 14 Drowned Dead, shared with q_drowned)
      // must be gone.
      expect(q.objectives.some((o) => o.type === 'kill' && o.targetMobId === 'drowned_dead')).toBe(
        false,
      );
    });
  });
});
