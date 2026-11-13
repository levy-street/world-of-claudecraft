// The Smith's Heart's rewards over REAL Sims: each feat's weapon appearance and the meta's
// Quarryheart Charger (src/sim/smith_heart_feat_rewards.ts, paid from grantDeed), the join
// heal, the entrance's essence quest end to end (Warden Collier, the Masterless Strength's
// remnant, the turn-in's coffer), the coffer itself with a stub table and with the shipped
// empty one (src/sim/smith_heart_essence_chest.ts), and `/dev heart feat`.

import { describe, expect, it, vi } from 'vitest';
import {
  forgetAccountDeedEarner,
  freshAccountLedger,
  recordAccountDeed,
} from '../src/sim/account_ledger';
import { DEEDS } from '../src/sim/content/deeds';
import { SMITHS_HEART_META_MOUNT } from '../src/sim/content/mounts';
import {
  SMITH_HEART_CHEST_ITEM,
  SMITH_HEART_DEED_IDS,
  SMITH_HEART_ESSENCE_ITEM,
  SMITH_HEART_ESSENCE_NPC,
  SMITH_HEART_ESSENCE_NPC_SPOT,
  SMITH_HEART_ESSENCE_QUEST,
  SMITH_HEART_FEAT_DEEDS,
  SMITH_HEART_FEAT_ORDER,
  SMITH_HEART_META_DEED,
  SMITH_HEART_NORMAL_LOOT_ITEM_IDS,
} from '../src/sim/content/smith_heart_rewards';
import { SMITHS_HEART_WEAPON_SKINS } from '../src/sim/content/weapon_skins';
import { ITEMS, MOBS, NPCS, QUESTS } from '../src/sim/data';
import { freshDeedStats, retroFallbackGrants } from '../src/sim/deeds';
import {
  SMITH_HEART_FEAT_DEV_USAGE,
  smithHeartFeatTargets,
} from '../src/sim/dev/smith_heart_feat_dev';
import { canEquipItem } from '../src/sim/equipment_rules';
import { mountItemId } from '../src/sim/mounts';
import { openSmithHeartCoffer, smithHeartCofferPool } from '../src/sim/smith_heart_essence_chest';
import {
  healSmithHeartRewards,
  smithHeartDeedSkin,
  smithHeartSkinsForDeeds,
} from '../src/sim/smith_heart_feat_rewards';
import type { Entity, PlayerClass } from '../src/sim/types';
import { deedCosmeticRewardLine } from '../src/ui/deed_cosmetic_reward';
import { buildDeedsView } from '../src/ui/deeds_view';
import { finalFight } from './helpers/final_fight';

const REINS = mountItemId(SMITHS_HEART_META_MOUNT) as string;
const sec = (s: number) => Math.ceil(s * 20);

function raid(n = 1) {
  const f = finalFight(n, 41);
  const meta = (i = 0) => {
    const m = f.sim.meta(f.pids[i]);
    if (!m) throw new Error('no meta');
    return m;
  };
  return { f, meta };
}

/** Up to `n` real epic pieces one class can equip and another cannot. */
function gearListFor(yes: PlayerClass, no: PlayerClass, n: number): string[] {
  const out: string[] = [];
  for (const def of Object.values(ITEMS)) {
    if (!def.slot || def.heroicOf || def.quality !== 'epic') continue;
    if (canEquipItem(yes, def) && !canEquipItem(no, def)) out.push(def.id);
    if (out.length >= n) break;
  }
  return out;
}

/** A real epic armor or weapon one class can equip and another cannot. */
function gearFor(yes: PlayerClass, no: PlayerClass): string {
  for (const def of Object.values(ITEMS)) {
    if (!def.slot || def.heroicOf || def.quality !== 'epic') continue;
    if (canEquipItem(yes, def) && !canEquipItem(no, def)) return def.id;
  }
  throw new Error(`no gear for ${yes} over ${no}`);
}

describe('the feat rewards', () => {
  it('each feat pays its own encounter appearance, nothing else does', () => {
    for (const e of SMITH_HEART_FEAT_ORDER)
      expect(smithHeartDeedSkin(SMITH_HEART_FEAT_DEEDS[e])).toBe(SMITHS_HEART_WEAPON_SKINS[e]);
    expect(smithHeartDeedSkin(SMITH_HEART_META_DEED)).toBeNull();
    expect(smithHeartDeedSkin('prog_veteran')).toBeNull();
    expect(smithHeartSkinsForDeeds([SMITH_HEART_FEAT_DEEDS.heat, 'prog_veteran'])).toEqual([
      'hearthbrand_sword',
    ]);
  });

  it('a granted feat puts its appearance on the account mirror once', () => {
    const { f, meta } = raid();
    expect(f.sim.ctx.accountCosmetics.weaponSkinIds).not.toContain('seamcaller_maul');
    expect(f.sim.ctx.grantDeed(meta(), SMITH_HEART_FEAT_DEEDS.hammer_council)).toBe(true);
    expect(f.sim.ctx.accountCosmetics.weaponSkinIds).toContain('seamcaller_maul');
    healSmithHeartRewards(f.sim.ctx, meta());
    expect(
      f.sim.ctx.accountCosmetics.weaponSkinIds.filter((id) => id === 'seamcaller_maul'),
    ).toHaveLength(1);
  });

  it('the meta, earned through the evaluator, delivers the charger reins once', () => {
    const { f, meta } = raid();
    for (const e of SMITH_HEART_FEAT_ORDER) f.sim.ctx.grantDeed(meta(), SMITH_HEART_FEAT_DEEDS[e]);
    f.tick(2);
    expect(meta().deedsEarned.has(SMITH_HEART_META_DEED)).toBe(true);
    expect(f.sim.ctx.countItem(REINS, f.pids[0])).toBe(1);
    expect(f.sim.ctx.accountCosmetics.weaponSkinIds).toEqual(
      expect.arrayContaining(Object.values(SMITHS_HEART_WEAPON_SKINS)),
    );
    healSmithHeartRewards(f.sim.ctx, meta());
    expect(f.sim.ctx.countItem(REINS, f.pids[0])).toBe(1);
  });

  it('the encounter-to-appearance table is pinned to literal skin ids', () => {
    expect(
      SMITH_HEART_FEAT_ORDER.map((e) => smithHeartDeedSkin(SMITH_HEART_FEAT_DEEDS[e])),
    ).toEqual([
      'seamcaller_maul',
      'squallcrest_sword',
      'rimelight_staff',
      'hearthbrand_sword',
      'duskwick_staff',
    ]);
  });

  it('the join pass (retroFallbackGrants) heals a missing appearance and missing reins', () => {
    const { f, meta } = raid();
    const m = meta();
    for (const e of SMITH_HEART_FEAT_ORDER) f.sim.ctx.grantDeed(m, SMITH_HEART_FEAT_DEEDS[e]);
    f.tick(2);
    // A lost delivery: the reins and one appearance gone.
    f.sim.ctx.removeItem(REINS, 1, f.pids[0]);
    f.sim.ctx.accountCosmetics = { ...f.sim.ctx.accountCosmetics, weaponSkinIds: [] };
    retroFallbackGrants(f.sim.ctx, m, f.players[0]);
    expect(f.sim.ctx.countItem(REINS, f.pids[0])).toBe(1);
    expect(f.sim.ctx.accountCosmetics.weaponSkinIds).toEqual(
      expect.arrayContaining(Object.values(SMITHS_HEART_WEAPON_SKINS)),
    );
  });

  it('an alt earns its own reins even when the account already rides the charger', () => {
    const { f, meta } = raid();
    const m = meta();
    // Online: a sibling's reins already project the mount onto the account.
    m.accountMountSkinIds = [SMITHS_HEART_META_MOUNT];
    for (const e of SMITH_HEART_FEAT_ORDER) f.sim.ctx.grantDeed(m, SMITH_HEART_FEAT_DEEDS[e]);
    f.tick(2);
    expect(f.sim.ctx.countItem(REINS, f.pids[0])).toBe(1);
  });

  it('reins already in the bank are never delivered a second time', () => {
    const { f, meta } = raid();
    const m = meta();
    for (const e of SMITH_HEART_FEAT_ORDER) f.sim.ctx.grantDeed(m, SMITH_HEART_FEAT_DEEDS[e]);
    f.tick(2);
    expect(f.sim.ctx.countItem(REINS, f.pids[0])).toBe(1);
    f.sim.ctx.removeItem(REINS, 1, f.pids[0]);
    m.bank.inventory.push({ itemId: REINS, count: 1 } as (typeof m.bank.inventory)[number]);
    healSmithHeartRewards(f.sim.ctx, m);
    expect(f.sim.ctx.countItem(REINS, f.pids[0])).toBe(0);
    expect(m.bank.inventory.filter((s) => s.itemId === REINS)).toHaveLength(1);
  });

  it('full bags hold the reins back with a line, and the join heal delivers them later', () => {
    const { f, meta } = raid();
    const m = meta();
    for (const e of SMITH_HEART_FEAT_ORDER.slice(0, 4))
      f.sim.ctx.grantDeed(m, SMITH_HEART_FEAT_DEEDS[e]);
    // Fill every free bag slot.
    const filler = Object.values(ITEMS).find((d) => d.kind === 'junk');
    if (!filler) throw new Error('no filler');
    for (let i = 0; i < 400 && f.sim.ctx.canAddItem(REINS, 1, f.pids[0]); i++)
      f.sim.ctx.addItem(filler.id, 1, f.pids[0]);
    expect(f.sim.ctx.canAddItem(REINS, 1, f.pids[0])).toBe(false);
    f.sim.ctx.grantDeed(m, SMITH_HEART_FEAT_DEEDS.masterless);
    const ev = f.tick(2);
    expect(m.deedsEarned.has(SMITH_HEART_META_DEED)).toBe(true);
    expect(f.sim.ctx.countItem(REINS, f.pids[0])).toBe(0);
    expect(
      ev.some(
        (e) =>
          e.type === 'error' &&
          e.text ===
            'Your bags are full. The Quarryheart Charger will wait for you until your next login.',
      ),
    ).toBe(true);
    // Room made, the next join heals it.
    f.sim.ctx.removeItem(filler.id, f.sim.ctx.countItem(filler.id, f.pids[0]), f.pids[0]);
    healSmithHeartRewards(f.sim.ctx, m);
    expect(f.sim.ctx.countItem(REINS, f.pids[0])).toBe(1);
  });
});

describe('the Book of Deeds card names the reward', () => {
  it('an appearance for a feat, the mount for the meta, nothing for any other deed', () => {
    expect(deedCosmeticRewardLine({ rewardSkinId: 'seamcaller_maul', rewardMountKey: null })).toBe(
      'Reward: the Seamcaller weapon appearance, for every character on your account',
    );
    expect(
      deedCosmeticRewardLine({ rewardSkinId: null, rewardMountKey: SMITHS_HEART_META_MOUNT }),
    ).toBe('Reward: the Quarryheart Charger mount');
    expect(deedCosmeticRewardLine({ rewardSkinId: null, rewardMountKey: null })).toBeNull();
  });
});

describe('the Book of Deeds view model', () => {
  it('a feat carries its appearance, the meta its mount, both named before or after the earn', () => {
    const deeds = {
      [SMITH_HEART_FEAT_DEEDS.hammer_council]: DEEDS[SMITH_HEART_FEAT_DEEDS.hammer_council],
      [SMITH_HEART_META_DEED]: DEEDS[SMITH_HEART_META_DEED],
    };
    const order = Object.keys(deeds);
    const view = buildDeedsView({
      // Earned: the raid's deeds are hidden while it is dev-gated.
      deedsEarned: new Map(order.map((id) => [id, '2026-11-11'])),
      deedStats: freshDeedStats(),
      renown: 0,
      activeTitle: null,
      activeBorder: null,
      deeds,
      order,
      category: 'dungeon',
      filter: 'all',
      search: '',
      watched: new Set<string>(),
      searchText: (id) => id,
    });
    const feat = view.entries.find((e) => e.id === SMITH_HEART_FEAT_DEEDS.hammer_council);
    const meta = view.entries.find((e) => e.id === SMITH_HEART_META_DEED);
    expect(feat?.rewardSkinId).toBe('seamcaller_maul');
    expect(feat?.rewardMountKey).toBeNull();
    expect(meta?.rewardSkinId).toBeNull();
    expect(meta?.rewardMountKey).toBe('quarryheart_charger');
  });
});

describe('the Book of Deeds records', () => {
  it('all seven are hidden while the raid is dev-gated, the feats manual, Renown on the scale', () => {
    expect(SMITH_HEART_DEED_IDS).toHaveLength(7);
    for (const id of SMITH_HEART_DEED_IDS) {
      const d = DEEDS[id];
      expect(d, id).toBeDefined();
      expect(d.hidden, id).toBe(true);
      expect(d.reward, id).toBeUndefined();
      expect(d.feat, id).toBeUndefined();
    }
    for (const e of SMITH_HEART_FEAT_ORDER) {
      expect(DEEDS[SMITH_HEART_FEAT_DEEDS[e]].trigger).toEqual({ kind: 'manual' });
      expect(DEEDS[SMITH_HEART_FEAT_DEEDS[e]].renown).toBe(25);
    }
    expect(DEEDS[SMITH_HEART_META_DEED].renown).toBe(50);
  });
});

describe('the essence quest: What the Heart Let Go', () => {
  it('Warden Collier gives it at the Cleft, weekly, its coffer for every class', () => {
    const q = QUESTS[SMITH_HEART_ESSENCE_QUEST];
    expect(q.giverNpcId).toBe(SMITH_HEART_ESSENCE_NPC);
    expect(q.turnInNpcId).toBe(SMITH_HEART_ESSENCE_NPC);
    expect(q.repeatable).toBe(true);
    expect(q.weeklyReset).toBe(true);
    expect(q.objectives).toEqual([
      expect.objectContaining({ type: 'collect', itemId: SMITH_HEART_ESSENCE_ITEM, count: 1 }),
    ]);
    expect(Object.values(q.itemRewards)).toHaveLength(9);
    for (const id of Object.values(q.itemRewards)) expect(id).toBe(SMITH_HEART_CHEST_ITEM);
    expect(NPCS[SMITH_HEART_ESSENCE_NPC].questIds).toEqual([SMITH_HEART_ESSENCE_QUEST]);
    // The remnant is the final boss's personal quest drop, every time.
    expect(MOBS.heart_masterless_strength.loot).toEqual([
      { itemId: SMITH_HEART_ESSENCE_ITEM, chance: 1, questId: SMITH_HEART_ESSENCE_QUEST },
    ]);
  });

  it('accept at the Warden, loot the remnant off the fallen boss, turn in for the coffer', () => {
    const { f, meta } = raid(2);
    // One raid group, as a real run is: the remnant drops for every member on the quest.
    f.sim.partyInvite(f.pids[1], f.pids[0]);
    f.sim.partyAccept(f.pids[1]);
    const npc = [...f.sim.ctx.entities.values()].find(
      (e) => e.templateId === SMITH_HEART_ESSENCE_NPC && !e.dead,
    ) as Entity;
    expect(npc).toBeDefined();
    const here = f.local(npc);
    expect(here.x).toBeCloseTo(SMITH_HEART_ESSENCE_NPC_SPOT.x, 0);
    expect(here.z).toBeCloseTo(SMITH_HEART_ESSENCE_NPC_SPOT.z, 0);
    for (const p of f.players) f.put(p, here.x + 1.5, here.z + 1.5);
    f.tick(2);
    for (const pid of f.pids) f.sim.acceptQuest(SMITH_HEART_ESSENCE_QUEST, pid);
    expect(meta(0).questLog.get(SMITH_HEART_ESSENCE_QUEST)?.state).toBe('active');
    expect(meta(1).questLog.get(SMITH_HEART_ESSENCE_QUEST)?.state).toBe('active');
    // The fight, cut short: the boss falls and both raiders loot their remnant.
    f.pullIn('heat');
    const boss = f.boss();
    boss.hp = 0;
    f.sim.ctx.dealDamage(f.players[0], boss, 10, false, 'physical', 'Strike', 'hit');
    f.tick(sec(1));
    expect(boss.dead).toBe(true);
    // The final boss's fall is the raid's clear (FINAL_BOSS_DUNGEONS): The Heart Stills.
    for (const pid of f.pids)
      expect(meta(f.pids.indexOf(pid)).deedsEarned.has('dgn_smith_heart')).toBe(true);
    for (const pid of f.pids) f.sim.lootCorpse(boss.id, pid);
    f.tick(2);
    for (const pid of f.pids) expect(f.sim.ctx.countItem(SMITH_HEART_ESSENCE_ITEM, pid)).toBe(1);
    expect(meta(0).questLog.get(SMITH_HEART_ESSENCE_QUEST)?.state).toBe('ready');
    // Back at the Cleft, the turn-in pays the coffer.
    for (const p of f.players) f.put(p, here.x + 1.5, here.z + 1.5);
    f.tick(2);
    f.sim.turnInQuest(SMITH_HEART_ESSENCE_QUEST, f.pids[0]);
    f.tick(1);
    expect(f.sim.ctx.countItem(SMITH_HEART_ESSENCE_ITEM, f.pids[0])).toBe(0);
    expect(f.sim.ctx.countItem(SMITH_HEART_CHEST_ITEM, f.pids[0])).toBe(1);
    // Weekly: not offered again until the raid reset.
    f.sim.acceptQuest(SMITH_HEART_ESSENCE_QUEST, f.pids[0]);
    expect(meta(0).questLog.has(SMITH_HEART_ESSENCE_QUEST)).toBe(false);
  });
});

describe('the Coffer of the Highwatch Vigil', () => {
  it('ships an empty Normal table: the coffer refuses, is kept, and draws nothing', () => {
    expect(SMITH_HEART_NORMAL_LOOT_ITEM_IDS).toEqual([]);
    const { f, meta } = raid();
    f.sim.ctx.addItem(SMITH_HEART_CHEST_ITEM, 1, f.pids[0]);
    const draws = vi.spyOn(f.sim.ctx.rng, 'next');
    f.sim.useItem(SMITH_HEART_CHEST_ITEM, f.pids[0]);
    expect(draws).not.toHaveBeenCalled();
    draws.mockRestore();
    const ev = f.tick(1);
    expect(f.sim.ctx.countItem(SMITH_HEART_CHEST_ITEM, f.pids[0])).toBe(1);
    expect(
      ev.some(
        (e) =>
          e.type === 'error' &&
          e.text === 'The coffer is sealed and holds nothing for you yet. Keep it.',
      ),
    ).toBe(true);
    expect(smithHeartCofferPool(meta().cls)).toEqual([]);
  });

  it('with a stub table, opens to one piece the class can equip, deterministically', () => {
    const plate = gearListFor('warrior', 'mage', 4);
    const cloth = gearFor('mage', 'warrior');
    expect(plate.length).toBe(4);
    const stub = [...plate, cloth, 'not_an_item'];
    expect(smithHeartCofferPool('warrior', stub)).toEqual(plate);
    expect(smithHeartCofferPool('mage', stub)).toContain(cloth);
    for (const id of plate) expect(smithHeartCofferPool('mage', stub)).not.toContain(id);
    const picks: (string | null)[] = [];
    for (let run = 0; run < 2; run++) {
      const { f, meta } = raid();
      f.sim.ctx.addItem(SMITH_HEART_CHEST_ITEM, 1, f.pids[0]);
      // The expected pick: the same Rng state, cloned, drawing over the same pool.
      const rng = f.sim.ctx.rng;
      const twin = Object.assign(Object.create(Object.getPrototypeOf(rng)), rng) as typeof rng;
      const expected = twin.pick([...plate]);
      const draws = vi.spyOn(rng, 'next');
      let consumed = 0;
      const got = openSmithHeartCoffer(
        f.sim.ctx,
        meta(),
        () => {
          consumed++;
          f.sim.ctx.removeItem(SMITH_HEART_CHEST_ITEM, 1, f.pids[0]);
          return undefined;
        },
        stub,
      );
      const drawsForPick = draws.mock.calls.length;
      draws.mockRestore();
      expect(drawsForPick).toBeGreaterThanOrEqual(1);
      expect(got).toBe(expected);
      expect(plate).toContain(got);
      expect(consumed).toBe(1);
      expect(f.sim.ctx.countItem(got as string, f.pids[0])).toBe(1);
      expect(f.sim.ctx.countItem(SMITH_HEART_CHEST_ITEM, f.pids[0])).toBe(0);
      picks.push(got);
    }
    expect(picks[0]).toBe(picks[1]);
  });

  it('with no coffer in the bags nothing is drawn or granted', () => {
    const plate = gearListFor('warrior', 'mage', 3);
    const { f, meta } = raid();
    const draws = vi.spyOn(f.sim.ctx.rng, 'next');
    expect(openSmithHeartCoffer(f.sim.ctx, meta(), () => undefined, plate)).toBeNull();
    expect(draws).not.toHaveBeenCalled();
    draws.mockRestore();
    for (const id of plate) expect(f.sim.ctx.countItem(id, f.pids[0])).toBe(0);
  });

  it('a class the stub table has nothing for is refused and keeps its coffer', () => {
    const plate = gearFor('warrior', 'mage');
    expect(smithHeartCofferPool('mage', [plate])).toEqual([]);
  });
});

describe('/dev heart feat', () => {
  it('names each encounter and all, and nothing else', () => {
    expect(smithHeartFeatTargets('council')).toEqual(['hammer_council']);
    expect(smithHeartFeatTargets('final')).toEqual(['masterless']);
    expect(smithHeartFeatTargets('all')).toEqual(SMITH_HEART_FEAT_ORDER);
    expect(smithHeartFeatTargets('dragon')).toBeNull();
  });

  it('grant all pays every appearance and, a tick later, the meta and its reins; reset takes them back', () => {
    const { f, meta } = raid();
    expect(f.dev('/dev heart feat all grant')).toBe(true);
    const ev = f.tick(2);
    const m = meta();
    for (const e of SMITH_HEART_FEAT_ORDER)
      expect(m.deedsEarned.has(SMITH_HEART_FEAT_DEEDS[e])).toBe(true);
    expect(m.deedsEarned.has(SMITH_HEART_META_DEED)).toBe(true);
    // Five feats and the meta, each unlocked once.
    expect(ev.filter((e) => e.type === 'deedUnlocked').length).toBe(6);
    expect(f.sim.ctx.countItem(REINS, f.pids[0])).toBe(1);
    const renown = m.renown;
    expect(f.dev('/dev heart feat quench reset')).toBe(true);
    expect(m.deedsEarned.has(SMITH_HEART_FEAT_DEEDS.quench)).toBe(false);
    expect(m.deedsEarned.has(SMITH_HEART_META_DEED)).toBe(false);
    expect(m.deedsEarned.has(SMITH_HEART_FEAT_DEEDS.heat)).toBe(true);
    expect(m.renown).toBe(renown - 25 - 50);
    expect(m.accountLedger.deeds.has(SMITH_HEART_FEAT_DEEDS.quench)).toBe(false);
    expect(f.sim.ctx.accountCosmetics.weaponSkinIds).not.toContain('rimelight_staff');
    expect(f.sim.ctx.accountCosmetics.weaponSkinIds).toContain('hearthbrand_sword');
    expect(f.sim.ctx.countItem(REINS, f.pids[0])).toBe(0);
    // Granting it again earns it again (and the meta, and the reins).
    f.dev('/dev heart feat quench grant');
    f.tick(2);
    expect(m.deedsEarned.has(SMITH_HEART_META_DEED)).toBe(true);
    expect(f.sim.ctx.countItem(REINS, f.pids[0])).toBe(1);
  });

  it('a bad line answers with the usage and changes nothing', () => {
    const { f, meta } = raid();
    f.dev('/dev heart feat heat grant');
    f.tick(1);
    f.dev('/dev heart feat dragon grant');
    f.dev('/dev heart feat dragon reset');
    f.dev('/dev heart feat breath polish');
    const ev = f.tick(1);
    const usage = ev.filter((e) => e.type === 'error' && e.text === SMITH_HEART_FEAT_DEV_USAGE);
    expect(usage).toHaveLength(3);
    expect(SMITH_HEART_FEAT_DEV_USAGE).toBe(
      '[dev] /dev heart feat <council|breath|quench|heat|final|all> <grant|reset>',
    );
    const held = SMITH_HEART_DEED_IDS.filter((id) => meta().deedsEarned.has(id));
    expect(held).toEqual([SMITH_HEART_FEAT_DEEDS.heat]);
  });

  it('the ledger forget drops only that character, and only that deed', () => {
    const ledger = freshAccountLedger();
    const a = { characterId: 1, name: 'A', cls: 'warrior' as const, day: '2026-11-11' };
    const b = { characterId: 2, name: 'B', cls: 'mage' as const, day: '2026-11-11' };
    recordAccountDeed(ledger, 'dgn_heart_heat_feat', a);
    recordAccountDeed(ledger, 'dgn_heart_heat_feat', b);
    recordAccountDeed(ledger, 'dgn_heart_quench_feat', a);
    expect(forgetAccountDeedEarner(ledger, 'dgn_heart_heat_feat', 1)).toBe(true);
    expect(ledger.deeds.get('dgn_heart_heat_feat')).toEqual([b]);
    expect(ledger.deeds.get('dgn_heart_quench_feat')).toEqual([a]);
    expect(forgetAccountDeedEarner(ledger, 'dgn_heart_heat_feat', 1)).toBe(false);
  });
});
