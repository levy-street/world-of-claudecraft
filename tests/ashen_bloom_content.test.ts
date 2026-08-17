import { describe, expect, it } from 'vitest';

import { DEEDS } from '../src/sim/content/deeds';
import { CRAFT_RING, GATHERING_PROFESSIONS } from '../src/sim/content/professions';
import { DUNGEONS, ITEMS, MOBS, QUEST_ORDER, QUESTS, ZONES } from '../src/sim/data';

describe('The Ashen Bloom expansion content', () => {
  it('ships a contiguous three-zone campaign from level 20 through 40', () => {
    const zoneIds = ['rotmire_expanse', 'petrified_march', 'crownroot_wilds'];
    const zones = ZONES.filter((zone) => zoneIds.includes(zone.id));
    expect(zones.map((zone) => zone.id)).toEqual(zoneIds);
    expect(zones.map((zone) => zone.levelRange)).toEqual([
      [20, 27],
      [27, 34],
      [34, 40],
    ]);
    const campaign = QUEST_ORDER.filter((id) => id.startsWith('q_ab_'));
    expect(campaign).toHaveLength(12);
    for (let index = 1; index < campaign.length; index += 1) {
      expect(QUESTS[campaign[index]].requiresQuest).toBe(campaign[index - 1]);
    }
  });

  it('registers three dungeons and a ten-player level-cap raid', () => {
    expect(DUNGEONS.rotchapel.suggestedPlayers).toBe(5);
    expect(DUNGEONS.ossuary_of_the_march.suggestedPlayers).toBe(5);
    expect(DUNGEONS.heart_of_crownroot.suggestedPlayers).toBe(5);
    expect(DUNGEONS.sepulcher_of_ashes.suggestedPlayers).toBe(10);
    expect(MOBS.king_in_ashes.boss).toBe(true);
    expect(MOBS.king_in_ashes.minLevel).toBe(40);
  });

  it('gives every instance finale deterministic encounter mechanics', () => {
    expect(MOBS.abbot_of_flies.aoePulse?.name).toBe('Carrion Cloud');
    expect(MOBS.abbot_of_flies.summonAdds?.atHpPct).toEqual([0.65, 0.3]);
    expect(MOBS.general_silex.stomp?.name).toBe('Marching Order');
    expect(MOBS.general_silex.stoneskin?.amount).toBe(260);
    expect(MOBS.queen_under_roots.bigCast?.castId).toBe('rootheart_burst');
    expect(MOBS.queen_under_roots.desperateHeal?.healPct).toBe(0.12);
    expect(MOBS.king_in_ashes.infernoChannel?.atHpPct).toEqual([0.7, 0.35]);
    expect(MOBS.king_in_ashes.summonAdds?.count).toBe(3);
    expect(MOBS.king_in_ashes.terrify?.name).toBe('Edict of Dust');
  });

  it('provides class loot, legendary raid loot, and expansion deeds', () => {
    expect(ITEMS.gravecallers_crozier.requiredClass).toEqual(['gravecaller']);
    expect(ITEMS.mantle_of_walking_thorns.requiredClass).toEqual(['briar_warden']);
    expect(ITEMS.king_in_ashes_blade.quality).toBe('legendary');
    expect(DEEDS.prog_ashen_bloom_40.trigger).toEqual({ kind: 'level', level: 40 });
    expect(DEEDS.dgn_sepulcher_clear.renown).toBe(50);
  });

  it('keeps the established profession caps while adding expansion materials', () => {
    expect(GATHERING_PROFESSIONS.mining.maxSkill).toBe(100);
    expect(GATHERING_PROFESSIONS.fishing.maxSkill).toBe(200);
    expect(CRAFT_RING.every((profession) => profession.maxSkill === 125)).toBe(true);
    expect(ITEMS.ashen_petal.kind).toBe('junk');
    expect(ITEMS.crownroot_heartwood_item.quality).toBe('rare');
    expect(MOBS.carrion_bloom.loot).toContainEqual({ itemId: 'ashen_petal', chance: 0.22 });
    expect(MOBS.sepulcher_guardian.loot).toContainEqual({
      itemId: 'crownroot_heartwood_item',
      chance: 0.12,
    });
  });
});
