// #98 — the quest reward shown in the dialog/preview must be exactly what the
// player receives at turn-in. The bug was the client previewing
// itemRewards[class] (no archetype fallback) while the server granted
// itemRewards[class] ?? itemRewards[archetype]; a priest saw nothing but got
// the mage staff. questRewardItemId is now the single source of truth.
import { describe, expect, it } from 'vitest';
import { QUESTS, questRewardItemId, REWARD_ARCHETYPE } from '../src/sim/data';
import { Sim } from '../src/sim/sim';
import type { PlayerClass } from '../src/sim/types';

const ALL_CLASSES: PlayerClass[] = ['warrior', 'paladin', 'shaman', 'rogue', 'hunter', 'mage', 'priest', 'warlock', 'druid', 'demon_hunter'];

describe('quest reward preview matches turn-in (#98)', () => {
  it('resolves the archetype fallback for classes without an explicit reward', () => {
    const quest = QUESTS['q_greyjaw']; // rewards keyed warrior/mage/rogue only
    // priest -> mage archetype, so it must still resolve the cloak
    expect(quest.itemRewards['priest']).toBeUndefined();
    expect(questRewardItemId(quest, 'priest')).toBe('greyjaw_pelt_cloak');
    expect(questRewardItemId(quest, 'priest')).toBe(quest.itemRewards[REWARD_ARCHETYPE['priest']]);
  });

  it('the resolver agrees with what turnInQuest actually grants, for every class', () => {
    for (const cls of ALL_CLASSES) {
      // autoEquip off so the granted reward stays in the bag where we can count it
      const sim = new Sim({ seed: 1, playerClass: cls, playerName: 'Q', autoEquip: false });
      const preview = questRewardItemId(QUESTS['q_greyjaw'], cls);

      // drive the quest to turn-in
      const meta = (sim as any).primary;
      meta.questLog.set('q_greyjaw', { questId: 'q_greyjaw', state: 'ready', counts: [1] });
      sim.addItem('greyjaw_fang', 1);
      const npc = [...sim.entities.values()].find((e) => e.kind === 'npc' && e.templateId === QUESTS['q_greyjaw'].turnInNpcId)!;
      sim.player.pos = { ...npc.pos };
      const before = sim.countItem(preview ?? '__none__');
      sim.turnInQuest('q_greyjaw');
      const granted = sim.countItem(preview ?? '__none__');

      // whatever the preview promised, the player now holds one more of it
      expect(preview).toBe('greyjaw_pelt_cloak');
      expect(granted).toBe(before + 1);
    }
  });
});
