import { describe, expect, it } from 'vitest';

import { questGateBlocksDamage } from '../src/sim/combat/quest_damage_gate';
import { ZONE2_OBJECTS } from '../src/sim/content/zone2';
import { CAMPS, ITEMS, MOBS, QUESTS } from '../src/sim/data';
import {
  FIREBOTTLE_COOLDOWN_SECS,
  firebottleBurnCheck,
  HUT_BURN_RANGE,
} from '../src/sim/interactions/firebottle_hut';
import type { PlayerMeta } from '../src/sim/sim';
import type { Entity, QuestProgress } from '../src/sim/types';

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

  describe('The Broodmother uses a destructible egg clutch (q_broodmother)', () => {
    it('adds a quest-gated Broodmother Egg (~100 HP, only damageable with the quest)', () => {
      const egg = MOBS.spider_egg;
      expect(egg).toBeDefined();
      expect(egg.requiresQuestId).toBe('q_broodmother');
      expect(egg.hpBase).toBe(100);
    });

    it('adds a widow hatchling smaller than a full Mirefen Widow', () => {
      const hatchling = MOBS.widow_hatchling;
      expect(hatchling).toBeDefined();
      expect(hatchling.scale ?? 1).toBeLessThan(MOBS.mire_widow.scale ?? 1);
    });

    it('places enough eggs to complete the destroy-8 objective', () => {
      const camps = CAMPS.filter((c) => c.mobId === 'spider_egg');
      expect(camps.length).toBeGreaterThanOrEqual(1);
      expect(camps.reduce((n, c) => n + c.count, 0)).toBeGreaterThanOrEqual(8);
    });

    it('swaps objective 1 to destroying eggs, keeping the Broodmother kill and dropping the widow duplicate', () => {
      const q = QUESTS.q_broodmother;
      const targets = q.objectives.map((o) => (o.type === 'kill' ? o.targetMobId : o.type));
      expect(targets).toContain('spider_egg');
      expect(targets).toContain('mirefen_broodmother');
      expect(targets).not.toContain('mire_widow');
      const eggObj = q.objectives.find((o) => o.type === 'kill' && o.targetMobId === 'spider_egg');
      expect(eggObj?.count).toBe(8);
    });
  });

  describe('quest-gated egg damage (questGateBlocksDamage)', () => {
    const egg = { kind: 'mob', templateId: 'spider_egg' } as unknown as Entity;
    const widow = { kind: 'mob', templateId: 'mire_widow' } as unknown as Entity;
    const player = { kind: 'player', id: 1 } as unknown as Entity;
    const pet = { kind: 'mob', id: 9, ownerId: 1 } as unknown as Entity;
    const players = (state?: QuestProgress['state']): Map<number, PlayerMeta> => {
      const log = new Map<string, QuestProgress>();
      if (state) log.set('q_broodmother', { questId: 'q_broodmother', counts: [0, 0], state });
      return new Map([[1, { entityId: 1, questLog: log } as unknown as PlayerMeta]]);
    };

    it('blocks a player with no Broodmother quest', () => {
      expect(questGateBlocksDamage(players(), player, egg)).toBe(true);
    });
    it('allows a player with the quest active or ready', () => {
      expect(questGateBlocksDamage(players('active'), player, egg)).toBe(false);
      expect(questGateBlocksDamage(players('ready'), player, egg)).toBe(false);
    });
    it('blocks a player who has already turned the quest in', () => {
      expect(questGateBlocksDamage(players('done'), player, egg)).toBe(true);
    });
    it('allows the pet of a questing player (credits via the pet owner)', () => {
      expect(questGateBlocksDamage(players('active'), pet, egg)).toBe(false);
    });
    it('never gates an ordinary mob', () => {
      expect(questGateBlocksDamage(players(), player, widow)).toBe(false);
    });
  });

  describe('Back to the Shallows becomes a firebottle burn (q_deepfen_purge)', () => {
    it('grants a firebottle and repoints the objective to burning 5 huts', () => {
      const q = QUESTS.q_deepfen_purge;
      expect(q.requiredItems).toContain('firebottle');
      expect(q.objectives).toHaveLength(1);
      const o = q.objectives[0];
      expect(o.type).toBe('interact');
      if (o.type === 'interact') {
        expect(o.targetObjectItemId).toBe('murloc_hut');
        expect(o.count).toBe(5);
      }
      // the old deepfen_murloc kill duplicate (shared with q_deepfen) is gone
      expect(q.objectives.some((x) => x.type === 'kill')).toBe(false);
    });

    it('defines the firebottle and hut items', () => {
      expect(ITEMS.firebottle?.questId).toBe('q_deepfen_purge');
      expect(ITEMS.murloc_hut?.name).toBeTruthy();
    });

    it('places 5 burnable huts at the shallows', () => {
      const huts = ZONE2_OBJECTS.find((o) => o.itemId === 'murloc_hut');
      expect(huts).toBeDefined();
      expect(huts?.positions.length).toBe(5);
    });
  });

  describe('firebottle burn gating (firebottleBurnCheck)', () => {
    const base = {
      onQuest: true,
      hasBottle: true,
      distance: 1,
      time: 100,
      bottleReadyAt: 0,
      hutBurningUntil: 0,
    };
    it('succeeds up against the hut, holding a ready bottle, on the quest', () => {
      expect(firebottleBurnCheck(base)).toEqual({ ok: true });
    });
    it('requires the quest, a bottle, and close range', () => {
      expect(firebottleBurnCheck({ ...base, onQuest: false })).toMatchObject({
        reason: 'notOnQuest',
      });
      expect(firebottleBurnCheck({ ...base, hasBottle: false })).toMatchObject({
        reason: 'noBottle',
      });
      expect(firebottleBurnCheck({ ...base, distance: HUT_BURN_RANGE + 0.1 })).toMatchObject({
        reason: 'tooFar',
      });
      expect(firebottleBurnCheck({ ...base, distance: HUT_BURN_RANGE })).toEqual({ ok: true });
    });
    it('enforces the 5s bottle cooldown and the hut relight', () => {
      expect(FIREBOTTLE_COOLDOWN_SECS).toBe(5);
      expect(firebottleBurnCheck({ ...base, bottleReadyAt: 101 })).toMatchObject({
        reason: 'onCooldown',
      });
      expect(firebottleBurnCheck({ ...base, hutBurningUntil: 101 })).toMatchObject({
        reason: 'alreadyBurning',
      });
    });
  });
});
