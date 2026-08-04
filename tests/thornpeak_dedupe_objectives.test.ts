import { describe, expect, it } from 'vitest';

import { CAMPS, ITEMS, MOBS, QUESTS } from '../src/sim/data';

// Thornpeak duplicate-objective rework: each duplicate keeps its quest id (no DB
// breakage) but gets a distinct objective. See the quest-dedupe worktree.
describe('Thornpeak quest de-duplication', () => {
  describe("The Captain's Bounty becomes an elite ogre kill (q_ogre_bounty)", () => {
    it('adds an elite Brakka the Wallbreaker, placed in the world', () => {
      const b = MOBS.brakka_wallbreaker;
      expect(b).toBeDefined();
      expect(b.elite).toBe(true);
      expect(b.family).toBe('ogre');
      expect(CAMPS.some((c) => c.mobId === 'brakka_wallbreaker')).toBe(true);
    });
    it('repoints the objective at the elite, dropping the thornpeak_ogre kill', () => {
      const q = QUESTS.q_ogre_bounty;
      expect(q.objectives).toHaveLength(1);
      const o = q.objectives[0];
      expect(o.type).toBe('kill');
      if (o.type === 'kill') expect(o.targetMobId).toBe('brakka_wallbreaker');
      expect(
        q.objectives.some((x) => x.type === 'kill' && x.targetMobId === 'thornpeak_ogre'),
      ).toBe(false);
    });
  });

  describe('Orders from Below becomes a single rare-drop collect (q_cult_orders)', () => {
    it('is a single collect of 1 orders, no kill', () => {
      const q = QUESTS.q_cult_orders;
      expect(q.objectives).toHaveLength(1);
      const o = q.objectives[0];
      expect(o.type).toBe('collect');
      if (o.type === 'collect') {
        expect(o.itemId).toBe('wyrmcult_orders');
        expect(o.count).toBe(1);
      }
      expect(q.objectives.some((x) => x.type === 'kill')).toBe(false);
    });
    it('the orders drop from Wyrmcult Zealots at 10%', () => {
      const drop = (MOBS.wyrmcult_zealot.loot ?? []).find((l) => l.itemId === 'wyrmcult_orders');
      expect(drop?.chance).toBe(0.1);
      expect(drop?.questId).toBe('q_cult_orders');
    });
  });

  describe('The Phylactery Ring becomes collect-only (q_necromancers)', () => {
    it('collects phylacteries and no longer kills necromancers', () => {
      const q = QUESTS.q_necromancers;
      expect(q.objectives).toHaveLength(1);
      const o = q.objectives[0];
      expect(o.type).toBe('collect');
      if (o.type === 'collect') expect(o.itemId).toBe('ritual_phylactery');
      expect(q.objectives.some((x) => x.type === 'kill')).toBe(false);
    });
  });

  describe('The Voice Below repoints its zealot kill at an elite (q_voice_below)', () => {
    it('adds an elite Threnos the First Voice, placed in the world', () => {
      const v = MOBS.threnos_first_voice;
      expect(v).toBeDefined();
      expect(v.elite).toBe(true);
      expect(v.family).toBe('humanoid');
      expect(CAMPS.some((c) => c.mobId === 'threnos_first_voice')).toBe(true);
    });
    it('kills the elite plus the necromancers, no longer the generic zealot', () => {
      const q = QUESTS.q_voice_below;
      // The zealot kill (duplicated with q_zealots) is gone; the necromancer kill,
      // which is not a duplicate objective, is kept.
      expect(
        q.objectives.some((x) => x.type === 'kill' && x.targetMobId === 'wyrmcult_zealot'),
      ).toBe(false);
      const elite = q.objectives.find(
        (x) => x.type === 'kill' && x.targetMobId === 'threnos_first_voice',
      );
      expect(elite).toBeDefined();
      if (elite?.type === 'kill') expect(elite.count).toBe(1);
      expect(
        q.objectives.some((x) => x.type === 'kill' && x.targetMobId === 'wyrmcult_necromancer'),
      ).toBe(true);
    });
    it('leaves Chants on the Wind as the only remaining zealot kill (q_zealots)', () => {
      const zealotKillQuests = Object.entries(QUESTS)
        .filter(([, q]) =>
          q.objectives.some((o) => o.type === 'kill' && o.targetMobId === 'wyrmcult_zealot'),
        )
        .map(([id]) => id);
      expect(zealotKillQuests).toEqual(['q_zealots']);
    });
  });

  describe('Bones of the Vanguard becomes a bone collect (q_revenant_vanguard)', () => {
    it('adds the Vanguard Bone item dropping from Boneclad Revenants', () => {
      expect(ITEMS.vanguard_bone?.questId).toBe('q_revenant_vanguard');
      const drop = (MOBS.boneclad_revenant.loot ?? []).find((l) => l.itemId === 'vanguard_bone');
      expect(drop?.questId).toBe('q_revenant_vanguard');
    });
    it('collects bones instead of killing revenants', () => {
      const q = QUESTS.q_revenant_vanguard;
      expect(q.objectives).toHaveLength(1);
      const o = q.objectives[0];
      expect(o.type).toBe('collect');
      if (o.type === 'collect') expect(o.itemId).toBe('vanguard_bone');
      expect(q.objectives.some((x) => x.type === 'kill')).toBe(false);
    });
  });
});
