// Dedicated corpse-harvest materials close the v0.21.0 collision
// gap. Before this change hide/silk/venomSac mapped to kind:'quest' items
// (boar_hide/webwood_silk/widow_venom_sac), so harvesting ANY tagged corpse
// granted quest-collect credit (a wolf hide advanced the boar quest). Now a
// harvest yields the profession materials from content/profession_items.ts
// and the quest items remain obtainable ONLY through their quest-gated kill
// loot (rollLoot's questId branch).
import { describe, expect, it } from 'vitest';
import {
  HARVEST_COMPONENT_ITEMS,
  HARVEST_COMPONENT_SPECIMENS,
} from '../src/sim/content/professions';
import { ITEMS, MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import type { PlayerMeta } from '../src/sim/sim';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';
import { expectDefined } from './helpers/defined';

type SimInternals = {
  entities: Map<number, Entity>;
  players: Map<number, PlayerMeta>;
};

function setup(seed = 11) {
  const sim = new Sim({ seed, playerClass: 'warrior', noPlayer: true });
  const internals = sim as unknown as SimInternals;
  const pid = sim.addPlayer('warrior', 'Alpha');
  sim.tick();
  const e = expectDefined(internals.entities.get(pid));
  e.pos = { x: 0, y: 0, z: 0 };
  e.prevPos = { x: 0, y: 0, z: 0 };
  return { sim, internals, pid };
}

function corpse(internals: SimInternals, templateId: string, id: number): Entity {
  const template = MOBS[templateId];
  const mob = createMob(id, template, template.maxLevel, { x: 0, y: 0, z: 0 });
  mob.dead = true;
  mob.aiState = 'dead';
  mob.corpseTimer = 9999;
  mob.respawnTimer = 9999;
  internals.entities.set(mob.id, mob);
  return mob;
}

// Collect-quest activation without walking the giver chain: the loot roller
// and quest credit read only the questLog entry's 'active' state plus the
// player's live item count.
function activateQuest(meta: PlayerMeta, questId: string): void {
  meta.questLog.set(questId, { questId, counts: [0], state: 'active' });
}

// Empirical per-kill drop rate of a quest-gated loot entry, driven through the
// authoritative roller the same way combat death does (tests/loot_drops.test.ts
// idiom).
function questDropRate(
  mobId: string,
  itemId: string,
  questId: string,
  active: boolean,
  n = 400,
): number {
  const { sim, internals, pid } = setup(77);
  const meta = expectDefined(internals.players.get(pid));
  if (active) activateQuest(meta, questId);
  const template = MOBS[mobId];
  let hits = 0;
  for (let i = 0; i < n; i++) {
    const mob = createMob(-1, template, template.minLevel, { x: 0, y: 0, z: 0 });
    (sim as unknown as { rollLoot: (m: Entity, meta: PlayerMeta) => void }).rollLoot(mob, meta);
    if (mob.loot?.items.some((s) => s.itemId === itemId)) hits++;
  }
  return hits / n;
}

describe('the dedicated harvest-material map (pinned)', () => {
  it('every component tag maps to its dedicated material; fang stays wolf_fang', () => {
    // horn and gills (Masterwrought Phase 11m, state.md row 11m-ORPHAN)
    // reuse SHIPPED ids rather than minting new ones: horn is the same hard
    // keratin as tusk and feeds curved_tusk, the thinnest mapped family in
    // the 11m census; gills feeds mudfin_scale, the trophy 11l promoted out
    // of quality 'poor'. One item serving two families is deliberate.
    expect({ ...HARVEST_COMPONENT_ITEMS }).toEqual({
      hide: 'rough_hide',
      fang: 'wolf_fang',
      silk: 'spider_silk',
      venomSac: 'venom_gland',
      meat: 'game_meat',
      cloth: 'homespun_cloth',
      claw: 'sharp_claw',
      tusk: 'curved_tusk',
      horn: 'curved_tusk',
      gills: 'mudfin_scale',
    });
    // The two 11m rows point at ids that ship (a typo here would grant
    // nothing at the grant loop), and at ids that are NOT quality 'poor',
    // which is the 11l promotion the gills row was gated on: sellAllJunk
    // sweeps 'poor', so a poor harvest yield would be sold under the player.
    expect(ITEMS.curved_tusk?.quality).toBe('common');
    expect(ITEMS.mudfin_scale?.quality).toBe('common');
  });

  it('the specimen map carries exactly the five jackpot families (fang, cloth, tusk, horn and gills have none)', () => {
    // Literal sibling pin: a dropped or mistargeted specimen row would break
    // a family's jackpot grant while every behavioral suite stays green on
    // the remaining families. claw carries one (pristine_claw) so no shipped
    // corpse carried two specimen-less families at once when #2905 landed
    // (fen_troll: claw+tusk; old_greyjaw: fang+claw); tusk stays
    // specimen-less like fang/cloth. horn and gills (Phase 11m) are
    // specimen-less by DECISION, not default: both sit at the bare-hands
    // MONSTER_MATERIAL_TIERS floor, and a pristine jackpot on a
    // bare-hands-floor component would invert the premium ladder. The
    // one-specimen-less-family-per-corpse premise that keeps the capacity
    // pre-gate honest is checked over the live MOBS table in
    // tests/corpse_harvest_sim.test.ts, not restated here.
    expect({ ...HARVEST_COMPONENT_SPECIMENS }).toEqual({
      hide: 'pristine_hide',
      silk: 'pristine_silk',
      venomSac: 'pristine_venom_gland',
      meat: 'prime_cut',
      claw: 'pristine_claw',
    });
  });
});

describe('harvesting no longer grants quest credit (the collision fix)', () => {
  it('a wolf-hide harvest with q_boars active grants rough_hide and zero boar quest credit', () => {
    const { sim, internals, pid } = setup();
    const meta = expectDefined(internals.players.get(pid));
    activateQuest(meta, 'q_boars');
    // forest_wolf is hide-tagged but is NOT a boar: before this change the
    // harvest granted boar_hide and advanced the boar quest.
    const mob = corpse(internals, 'forest_wolf', 9999);
    sim.harvestCorpse(mob.id, ['hide'], pid);
    expect(mob.harvestClaimedBy).toBe(pid);
    expect(sim.countItem('rough_hide', pid)).toBeGreaterThanOrEqual(1);
    // Collect-quest progress IS the live item count: zero of the quest item
    // means zero credit, and the quest stays active and empty.
    expect(sim.countItem('boar_hide', pid)).toBe(0);
    expect(expectDefined(meta.questLog.get('q_boars')).state).toBe('active');
  });

  it('spider and widow harvests grant materials, never the silk/venom quest items', () => {
    const { sim, internals, pid } = setup();
    const meta = expectDefined(internals.players.get(pid));
    activateQuest(meta, 'q_spiders');
    activateQuest(meta, 'q_widows');
    const spider = corpse(internals, 'webwood_spider', 9999);
    sim.harvestCorpse(spider.id, undefined, pid);
    const widow = corpse(internals, 'mire_widow', 9998);
    sim.harvestCorpse(widow.id, undefined, pid);
    expect(sim.countItem('spider_silk', pid)).toBeGreaterThanOrEqual(1);
    expect(sim.countItem('venom_gland', pid)).toBeGreaterThanOrEqual(1);
    expect(sim.countItem('webwood_silk', pid)).toBe(0);
    expect(sim.countItem('widow_venom_sac', pid)).toBe(0);
  });
});

describe('quest items stay obtainable through their kill-loot drop path', () => {
  // [mob, quest item, quest, configured chance]: each of the three remapped
  // quest items keeps its questId-gated loot entry on the quest's own mob.
  const CASES: [string, string, string, number][] = [
    ['wild_boar', 'boar_hide', 'q_boars', 0.6],
    ['webwood_spider', 'webwood_silk', 'q_spiders', 0.55],
    ['mire_widow', 'widow_venom_sac', 'q_widows', 0.65],
  ];

  for (const [mob, item, quest, chance] of CASES) {
    it(`${mob} drops ${item} near ${(chance * 100).toFixed(0)}% with ${quest} active, never without`, () => {
      const rate = questDropRate(mob, item, quest, true);
      expect(rate).toBeGreaterThan(chance - 0.12);
      expect(rate).toBeLessThan(chance + 0.12);
      expect(questDropRate(mob, item, quest, false)).toBe(0);
    });
  }

  it('looting the boar corpse grants boar_hide, so collect credit accrues through the drop', () => {
    const { sim, internals, pid } = setup(3);
    const meta = expectDefined(internals.players.get(pid));
    activateQuest(meta, 'q_boars');
    // Roll fresh boar corpses until one carries the quest drop (chance 0.6),
    // then loot it through the real command path.
    let looted = false;
    for (let i = 0; i < 50 && !looted; i++) {
      const mob = corpse(internals, 'wild_boar', 20000 + i);
      (sim as unknown as { rollLoot: (m: Entity, meta: PlayerMeta) => void }).rollLoot(mob, meta);
      if (mob.loot?.items.some((s) => s.itemId === 'boar_hide')) {
        sim.lootCorpse(mob.id, pid);
        looted = true;
      }
    }
    expect(looted).toBe(true);
    expect(sim.countItem('boar_hide', pid)).toBeGreaterThanOrEqual(1);
  });
});

describe('every mapped tag yields its dedicated material', () => {
  // Real templates covering each mapped tag: wild_boar (hide/tusk/meat),
  // webwood_spider (venomSac/silk), vale_bandit (cloth), forest_wolf (fang),
  // and the two Phase 11m rows on the templates that carried the tags while
  // they were still orphans: mudfin_murloc (gills beside hide) and
  // sethrael_palecoil (horn beside hide and claw). Those two rows are the
  // pin that gills and horn GRANT now: pre-11m the same default harvest on
  // either template drew nothing for the orphan family and granted nothing.
  const CASES: [string, string[]][] = [
    ['wild_boar', ['rough_hide', 'game_meat', 'curved_tusk']],
    ['webwood_spider', ['venom_gland', 'spider_silk']],
    ['vale_bandit', ['homespun_cloth']],
    ['forest_wolf', ['wolf_fang']],
    ['mudfin_murloc', ['rough_hide', 'mudfin_scale']],
    ['sethrael_palecoil', ['rough_hide', 'sharp_claw', 'curved_tusk']],
  ];
  // Both 11m rows really ride the orphan tag and not a tusk or a second
  // scale source on the same template: the template carries the tag, and it
  // does not carry the family that shares the item id.
  expect(MOBS.mudfin_murloc.componentTags).toContain('gills');
  expect(MOBS.sethrael_palecoil.componentTags).toContain('horn');
  expect(MOBS.sethrael_palecoil.componentTags).not.toContain('tusk');

  for (const [templateId, expected] of CASES) {
    it(`${templateId} yields ${expected.join(' + ')}`, () => {
      const { sim, internals, pid } = setup();
      const mob = corpse(internals, templateId, 9999);
      sim.harvestCorpse(mob.id, undefined, pid);
      expect(mob.harvestClaimedBy).toBe(pid);
      for (const itemId of expected) {
        expect(sim.countItem(itemId, pid), itemId).toBeGreaterThanOrEqual(1);
      }
    });
  }
});
