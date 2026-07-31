import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

// Mock the db layer so importing server/game (for wireEntity) needs no Postgres,
// mirroring tests/snapshots.test.ts.
vi.mock('../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  saveCharacterState: vi.fn(async () => {}),
  openPlaySession: vi.fn(async () => 1),
  touchCharacterLogin: vi.fn(async () => {}),
  closePlaySession: vi.fn(async () => {}),
  insertChatLogs: vi.fn(async () => {}),
  walletForAccount: vi.fn(async () => null),
  markAccountQuestComplete: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
}));

import { meleeSwing, updatePlayerAutoAttack } from '../src/sim/combat/auto_attack';
import { castAbility } from '../src/sim/combat/casting_lifecycle';
import { DELVE_SHOPS } from '../src/sim/content/delves/shop';
import { HEROIC_BOSS_LOOT } from '../src/sim/content/heroic_loot';
import { HEROIC_VENDOR_STOCK } from '../src/sim/content/heroic_vendor';
import {
  DEFAULT_MOUNT,
  MOUNT_KEYS,
  MOUNTS,
  mountDef,
  normalizeMountKey,
  normalizeSelectedMount,
} from '../src/sim/content/mounts';
import { ITEMS, MOBS, NPCS, QUESTS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { useItem } from '../src/sim/items';
import { MARKET_HOUSE_STOCK } from '../src/sim/market';
import {
  MOUNT_SUMMON_SECONDS,
  mountItemId,
  mountOwned,
  ownedMounts,
  summonMountItem,
  toggleMount,
  updateMountTransition,
} from '../src/sim/mounts';
import { moveSpeedMult } from '../src/sim/player_motion';
import {
  RIFT_BLUE_MOUNT_CHANCE,
  RIFT_BLUE_MOUNT_REINS,
  RIFT_EPIC_MOUNT_CHANCE,
  RIFT_EPIC_MOUNT_REINS,
  RIFT_GREEN_MOUNT_CHANCE,
  RIFT_GREEN_MOUNT_REINS,
} from '../src/sim/rift/progression';
import { Sim } from '../src/sim/sim';
import { DT, FORM_AURA_KINDS, type MountItemDef, type SimEvent } from '../src/sim/types';

function makeWorld() {
  return new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
}

function join(sim: Sim, level = 20): number {
  const pid = sim.addPlayer('warrior', 'Rider');
  sim.tick();
  if (level > 1) sim.setPlayerLevel(level, pid);
  // Req 5: riding skill is required; set it so existing tests stay focused on
  // ownership/level/combat gates rather than the riding-skill gate.
  const meta = sim.players.get(pid);
  if (meta) meta.ridingTrained = true;
  return pid;
}

function errorTexts(events: SimEvent[]): string[] {
  return events
    .filter((e): e is Extract<SimEvent, { type: 'error' }> => e.type === 'error')
    .map((e) => e.text);
}

// Drive the mount summon/dismount channel to completion by hand. The tick-loop
// integration (updateMountTransition wired into sim.tick) is covered in
// tests/mount_transition.test.ts; here we call the transition directly with
// swimming=false so these unit tests do not depend on that wiring landing.
function finishTransition(sim: Sim, pid: number, swimming = false): void {
  const e = sim.entities.get(pid)!;
  const steps = Math.ceil(MOUNT_SUMMON_SECONDS / DT) + 2;
  for (let i = 0; i < steps && (e.mountCastRemaining ?? 0) > 0; i++) {
    updateMountTransition(sim.ctx, e, swimming);
  }
}

// Summon a specific mount by its reins and drive the summon channel to completion.
function ride(sim: Sim, pid: number, key: string): void {
  summonMountItem(sim.ctx, pid, key);
  finishTransition(sim, pid);
}

describe('mount catalog', () => {
  it('has exactly eight mounts with the horse first and the developer tank last', () => {
    expect(MOUNT_KEYS).toHaveLength(8);
    expect(MOUNT_KEYS[0]).toBe('valorsteed');
    expect(MOUNT_KEYS.at(-1)).toBe('terrorspark_groundshaker');
    expect(DEFAULT_MOUNT).toBe('valorsteed');
  });

  it('pins each card: rarity and speed, with NO per-mount level gate', () => {
    const spec = (k: string) => {
      const d = MOUNTS[k as keyof typeof MOUNTS];
      return [d.rarity, d.moveSpeedPct];
    };
    expect(spec('valorsteed')).toEqual(['common', 0.6]);
    expect(spec('stormfeather_griffin')).toEqual(['uncommon', 0.7]);
    expect(spec('shadowjump_toad')).toEqual(['uncommon', 0.7]);
    expect(spec('grag_bear')).toEqual(['rare', 0.75]);
    expect(spec('stalkglider_snail')).toEqual(['rare', 0.75]);
    expect(spec('aether_hover_cycle')).toEqual(['epic', 0.8]);
    expect(spec('thunderstrut_gobbler')).toEqual(['epic', 0.8]);
    expect(spec('terrorspark_groundshaker')).toEqual(['epic', 0.8]);
    // The level field is GONE, not merely unused: it never fired (reins carry no
    // requiredLevel and every source is level-20 content) and leaving it would
    // invite a second gate to grow back beside ridingTrained.
    for (const k of MOUNT_KEYS) {
      expect(MOUNTS[k], `${k} has no level gate`).not.toHaveProperty('level');
    }
  });

  it('speed rises strictly with rarity, so the tiers mean something', () => {
    const rank = { common: 0, uncommon: 1, rare: 2, epic: 3 } as const;
    const rows = MOUNT_KEYS.map((k) => MOUNTS[k]);
    for (const a of rows) {
      for (const b of rows) {
        if (rank[a.rarity] < rank[b.rarity]) {
          expect(a.moveSpeedPct, `${a.key} (${a.rarity}) < ${b.key} (${b.rarity})`).toBeLessThan(
            b.moveSpeedPct,
          );
        }
      }
    }
  });

  it('normalizeMountKey coerces unknown or absent keys to "" (unmounted)', () => {
    expect(normalizeMountKey('valorsteed')).toBe('valorsteed');
    expect(normalizeMountKey('flying_carpet')).toBe('');
    expect(normalizeMountKey(undefined)).toBe('');
    expect(normalizeMountKey(null)).toBe('');
    expect(mountDef('nope')).toBeNull();
  });

  it('normalizeSelectedMount coerces unknown or absent picks to the horse', () => {
    expect(normalizeSelectedMount('grag_bear')).toBe('grag_bear');
    expect(normalizeSelectedMount('flying_carpet')).toBe('valorsteed');
    expect(normalizeSelectedMount(undefined)).toBe('valorsteed');
    expect(normalizeSelectedMount(null)).toBe('valorsteed');
    expect(normalizeSelectedMount('')).toBe('valorsteed');
  });

  it('pins the summon channel duration (dismount has none: it is instant)', () => {
    expect(MOUNT_SUMMON_SECONDS).toBe(1.5);
  });
});

describe('mount reins items (the collection: owning the item is owning the mount)', () => {
  const reinsFor = (key: string) =>
    Object.values(ITEMS).filter((d) => d.kind === 'mount' && d.mount === key) as MountItemDef[];

  it('every mount has exactly one soulbound reins item (the horse now included)', () => {
    for (const key of MOUNT_KEYS) {
      const items = reinsFor(key);
      expect(items).toHaveLength(1);
      const item = items[0];
      expect(mountItemId(key)).toBe(item.id);
      expect(item.soulbound).toBe(true); // never traded, mailed, listed, or destroyed
      expect(item.noDiscard).toBe(true);
      expect(item.sellValue).toBe(0);
      // The item's name color matches the card's rarity tier.
      expect(item.quality).toBe(MOUNTS[key].rarity);
    }
  });

  // scripts/mounts_shot.mjs grants the reins by a hardcoded list, and a mount
  // added to the catalog without a matching row leaves the capture tool showing
  // a stale collection while every gate stays green. Pin the list against the
  // catalog so the desync is a red test instead of a silently short screenshot.
  it('the mounts capture script grants exactly the catalog reins', () => {
    const source = readFileSync(path.join(__dirname, '..', 'scripts/mounts_shot.mjs'), 'utf8');
    const block = source.match(/for \(const id of \[([^\]]*)\]\)/);
    expect(block, 'the reins grant loop moved or changed shape').not.toBeNull();
    const granted = [...(block as RegExpMatchArray)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(granted.sort()).toEqual(MOUNT_KEYS.map((key) => mountItemId(key)).sort());
  });

  it('only the horse reins is purchasable, for 10 gold', () => {
    const horse = reinsFor('valorsteed')[0];
    expect(horse.id).toBe('reins_valorsteed');
    expect(horse.buyValue).toBe(100_000); // 10 gold in copper (ridingTrained gated)
    for (const key of MOUNT_KEYS.filter((k) => k !== 'valorsteed')) {
      expect(reinsFor(key)[0].buyValue).toBeUndefined();
    }
  });

  it('pins each reins item to its acquisition path, DERIVED from its own rarity', () => {
    // Rarity is the single source of truth for where a mount comes from:
    //   uncommon -> heroic five-man at 0.5%   ("green")
    //   rare     -> heroic five-man at 0.1%   ("blue")
    //   epic     -> rift S clear only, never on any static table
    // Deriving the expectation from MOUNTS[key].rarity rather than a hand-listed
    // table is what makes a future re-tier impossible to land half-done: move a
    // mount's rarity without moving its drop and this reds immediately.
    const nyth = HEROIC_BOSS_LOOT['nythraxis_scourge_of_thornpeak'] ?? [];
    const CHANCE_FOR_RARITY: Record<string, number> = { uncommon: 0.005, rare: 0.001 };

    for (const key of MOUNT_KEYS) {
      if (key === 'valorsteed') continue; // the purchase, not a drop
      if (key === 'terrorspark_groundshaker') continue; // developer-only, pinned separately below
      const itemId = mountItemId(key)!;
      const rarity = MOUNTS[key].rarity;
      // No mount is ever on a NORMAL mob table, at any rarity.
      for (const mob of Object.values(MOBS)) {
        expect(
          mob.loot.find((l) => l.itemId === itemId),
          `${itemId} must not be on normal table ${mob.id}`,
        ).toBeUndefined();
      }

      const heroicEntries = Object.entries(HEROIC_BOSS_LOOT).flatMap(([bossId, entries]) =>
        entries.filter((l) => l.itemId === itemId).map((l) => ({ bossId, ...l })),
      );

      if (rarity === 'epic') {
        // Rift S clears are the sole source. Nothing heroic, nothing static.
        expect(heroicEntries, `${itemId} (epic) must not be heroic-reachable`).toEqual([]);
        expect(RIFT_EPIC_MOUNT_REINS as readonly string[]).toContain(itemId);
        continue;
      }

      const chance = CHANCE_FOR_RARITY[rarity];
      expect(chance, `${rarity} is a known drop tier`).toBeDefined();
      // Exactly two heroic paths: one five-man boss, plus the heroic raid.
      expect(heroicEntries.length, `${itemId} heroic paths`).toBe(2);
      const fiveMan = heroicEntries.filter((e) => e.bossId !== 'nythraxis_scourge_of_thornpeak');
      expect(fiveMan.length, `${itemId} has one five-man path`).toBe(1);
      expect(
        nyth.some((l) => l.itemId === itemId),
        `${itemId} on the heroic raid`,
      ).toBe(true);
      for (const entry of heroicEntries) {
        expect(entry.chance, `${itemId} on ${entry.bossId} pays the ${rarity} rate`).toBe(chance);
        expect(entry.rollGroup, `${itemId} is an independent draw`).toBeUndefined();
      }
      // ... and the matching rift rank pays the same tier.
      const riftPool = rarity === 'uncommon' ? RIFT_GREEN_MOUNT_REINS : RIFT_BLUE_MOUNT_REINS;
      expect(riftPool as readonly string[], `${itemId} in the matching rift tier`).toContain(
        itemId,
      );
    }
  });

  it('keeps the tank developer-only and absent from every normal acquisition table', () => {
    const itemId = 'reins_terrorspark_groundshaker';
    const item = ITEMS[itemId] as MountItemDef;
    expect(item).toMatchObject({
      kind: 'mount',
      mount: 'terrorspark_groundshaker',
      quality: 'epic',
      soulbound: true,
      noDiscard: true,
      sellValue: 0,
    });
    expect(item.buyValue).toBeUndefined();

    for (const mob of Object.values(MOBS)) {
      expect(
        mob.loot.some((entry) => entry.itemId === itemId),
        `${itemId} must not be on ${mob.id}`,
      ).toBe(false);
    }
    for (const [bossId, loot] of Object.entries(HEROIC_BOSS_LOOT)) {
      expect(
        loot.some((entry) => entry.itemId === itemId),
        `${itemId} must not be on heroic boss ${bossId}`,
      ).toBe(false);
    }
    expect([
      ...RIFT_GREEN_MOUNT_REINS,
      ...RIFT_BLUE_MOUNT_REINS,
      ...RIFT_EPIC_MOUNT_REINS,
    ]).not.toContain(itemId);
    for (const npc of Object.values(NPCS)) {
      expect(npc.vendorItems ?? [], `${itemId} must not be sold by ${npc.id}`).not.toContain(
        itemId,
      );
    }
    expect(
      HEROIC_VENDOR_STOCK.map((offer) => offer.itemId),
      `${itemId} must not be sold by the Heroic Quartermaster`,
    ).not.toContain(itemId);
    for (const [delveId, offers] of Object.entries(DELVE_SHOPS)) {
      expect(
        offers.map((offer) => offer.itemId),
        `${itemId} must not be sold by delve shop ${delveId}`,
      ).not.toContain(itemId);
    }
    expect(
      MARKET_HOUSE_STOCK.map((offer) => offer.itemId),
      `${itemId} must not be seeded by the World Market`,
    ).not.toContain(itemId);
    for (const quest of Object.values(QUESTS)) {
      expect(
        Object.values(quest.itemRewards),
        `${itemId} must not be rewarded by ${quest.id}`,
      ).not.toContain(itemId);
      expect(
        quest.requiredItems ?? [],
        `${itemId} must not be required by ${quest.id}`,
      ).not.toContain(itemId);
    }
  });

  it('the rift mount tiers pay exactly the heroic rate for the rarity they carry', () => {
    // The rule this protects: a rift must never be a cheaper route to a mount
    // than the content that mount belongs to.
    expect(RIFT_GREEN_MOUNT_CHANCE, 'uncommon: the five-man heroic rate').toBe(0.005);
    expect(RIFT_BLUE_MOUNT_CHANCE, 'rare: the five-man heroic rate').toBe(0.001);
    expect(RIFT_EPIC_MOUNT_CHANCE, 'epic: rift-exclusive, so it sets its own rate').toBe(0.003);
    for (const [pool, rarity] of [
      [RIFT_GREEN_MOUNT_REINS, 'uncommon'],
      [RIFT_BLUE_MOUNT_REINS, 'rare'],
      [RIFT_EPIC_MOUNT_REINS, 'epic'],
    ] as const) {
      for (const itemId of pool) {
        const def = ITEMS[itemId] as MountItemDef;
        expect(def.quality, `${itemId} quality`).toBe(rarity);
        expect(MOUNTS[def.mount].rarity, `${itemId} catalog rarity`).toBe(rarity);
      }
    }
  });

  it('ownership: a fresh player owns nothing; a mount only while its reins is held', () => {
    const sim = makeWorld();
    const pid = join(sim, 20);
    const meta = sim.players.get(pid)!;
    expect(ownedMounts(meta)).toEqual([]);
    expect(mountOwned(meta, 'valorsteed')).toBe(false);
    expect(mountOwned(meta, 'grag_bear')).toBe(false);
    expect(mountOwned(meta, 'flying_carpet')).toBe(false);

    sim.addItem('reins_valorsteed', 1, pid);
    expect(mountOwned(meta, 'valorsteed')).toBe(true);
    expect(ownedMounts(meta)).toEqual(['valorsteed']);

    sim.addItem('reins_grag_bear', 1, pid);
    expect(ownedMounts(meta)).toEqual(['valorsteed', 'grag_bear']); // catalog order

    // A reins item parked in the bank still counts (bags OR bank).
    meta.bank.inventory.push({ itemId: 'reins_stormfeather_griffin', count: 1 });
    expect(mountOwned(meta, 'stormfeather_griffin')).toBe(true);
    expect(ownedMounts(meta)).toContain('stormfeather_griffin');
  });

  it('exposes the collection on the IWorld facade (ownedMounts), empty for a fresh player', () => {
    const sim = makeWorld();
    const pid = join(sim, 20);
    expect(sim.ownedMounts()).toEqual([]);
    sim.addItem('reins_shadowjump_toad', 1, pid);
    expect(sim.ownedMounts()).toEqual(['shadowjump_toad']);
    expect(sim.ownedMountsFor(pid)).toEqual(['shadowjump_toad']);
  });

  it('refuses to discard mount reins so an active mount cannot outlive ownership', () => {
    const sim = makeWorld();
    const pid = join(sim, 20);
    const e = sim.entities.get(pid)!;
    sim.addItem('reins_stormfeather_griffin', 1, pid);
    ride(sim, pid, 'stormfeather_griffin');
    expect(e.mountKey).toBe('stormfeather_griffin');

    sim.discardItem('reins_stormfeather_griffin', 1, pid);

    expect(sim.countItem('reins_stormfeather_griffin', pid)).toBe(1);
    expect(mountOwned(sim.players.get(pid)!, 'stormfeather_griffin')).toBe(true);
    expect(e.mountKey).toBe('stormfeather_griffin');
  });
});

// The stablemaster teaches the q_riding_lessons quest (giver/turn-in) and sells
// the Valorsteed reins for 10g after the player has learned to ride (ridingTrained).
// The old 100g-fee/quest-reward-reins flow is replaced: quest gives gold+XP, and
// Marla's vendor stock (reins_valorsteed) is the new purchase path.
describe('mount purchase (Marla sells reins for 10g after ridingTrained)', () => {
  const stablemaster = (sim: Sim) =>
    [...sim.entities.values()].find(
      (e) => e.kind === 'npc' && e.templateId === 'stablemaster_marla',
    )!;

  // Stand the player on the stablemaster so the vendor range check passes.
  function standAtStable(sim: Sim, pid: number): number {
    const npc = stablemaster(sim);
    const e = sim.entities.get(pid)!;
    e.pos.x = npc.pos.x;
    e.pos.z = npc.pos.z;
    return npc.id;
  }

  it('spawns the stablemaster stocking reins_valorsteed and offering q_riding_lessons', () => {
    const sim = makeWorld();
    join(sim, 20);
    const npc = stablemaster(sim);
    expect(npc).toBeDefined();
    expect(npc.vendorItems).toContain('reins_valorsteed');
    expect(npc.questIds).toContain('q_riding_lessons');
  });

  it('refuses a buyItem for the horse reins when ridingTrained is false', () => {
    const sim = makeWorld();
    const pid = join(sim, 20);
    const meta = sim.players.get(pid)!;
    meta.copper = 2_000_000;
    meta.ridingTrained = false; // explicitly not trained
    const npcId = standAtStable(sim, pid);
    sim.buyItem(npcId, 'reins_valorsteed', pid);
    expect(errorTexts(sim.tick())).toContain(
      'You must learn to ride first. Find a riding trainer.',
    );
    expect(meta.copper).toBe(2_000_000);
    expect(sim.countItem('reins_valorsteed', pid)).toBe(0);
    expect(mountOwned(meta, 'valorsteed')).toBe(false);
  });

  it('gates the horse behind q_riding_lessons: level 20, given/turned in at Marla', () => {
    const quest = QUESTS['q_riding_lessons'];
    expect(quest).toBeDefined();
    expect(quest.giverNpcId).toBe('stablemaster_marla');
    expect(quest.turnInNpcId).toBe('stablemaster_marla');
    expect(quest.minLevel).toBe(20);
  });

  it('the quest itemRewards are empty; it gives gold and XP only', () => {
    const quest = QUESTS['q_riding_lessons'];
    expect(quest.itemRewards).toEqual({});
    expect(quest.copperReward).toBe(5000);
    expect(quest.xpReward).toBe(3000);
    expect(quest.objectives).toHaveLength(1);
    const obj = quest.objectives[0];
    expect(obj.type).toBe('interact');
    if (obj.type !== 'interact') throw new Error('riding lesson objective must be interact');
    expect(obj.targetObjectItemId).toBe('train_valorsteed');
    expect(obj.count).toBe(1);
  });
});

describe('summoning a mount by using its reins (the item path)', () => {
  it('rejects an unknown mount key', () => {
    const sim = makeWorld();
    const pid = join(sim);
    expect(summonMountItem(sim.ctx, pid, 'flying_carpet')).toBe(false);
    expect(sim.entities.get(pid)?.mountKey).toBe('');
  });

  it('rejects an uncollected mount with the no-item error, then rides once owned', () => {
    const sim = makeWorld();
    const pid = join(sim, 20);
    expect(summonMountItem(sim.ctx, pid, 'stormfeather_griffin')).toBe(false);
    expect(errorTexts(sim.tick())).toContain("You don't have that item.");
    sim.addItem('reins_stormfeather_griffin', 1, pid);
    expect(summonMountItem(sim.ctx, pid, 'stormfeather_griffin')).toBe(true);
    finishTransition(sim, pid);
    expect(sim.entities.get(pid)?.mountKey).toBe('stormfeather_griffin');
  });

  it('routes a plain useItem on the reins to the summon (the bag / action-bar click)', () => {
    // This is the whole feature: the item IS the mount button. If useItem stops
    // dispatching to the mount arm, clicking reins silently does nothing again.
    const sim = makeWorld();
    const pid = join(sim, 20);
    sim.addItem('reins_grag_bear', 1, pid);
    useItem(sim.ctx, 'reins_grag_bear', pid);
    finishTransition(sim, pid);
    expect(sim.entities.get(pid)?.mountKey).toBe('grag_bear');
    // Never consumed: mountOwned() derives ownership from HOLDING the reins, so
    // spending them on use would delete the mount.
    expect(sim.countItem('reins_grag_bear', pid)).toBe(1);
  });

  it('swaps INSTANTLY to another mount with no dismount and no summon channel', () => {
    const sim = makeWorld();
    const pid = join(sim, 20);
    const e = sim.entities.get(pid)!;
    sim.addItem('reins_valorsteed', 1, pid);
    sim.addItem('reins_stormfeather_griffin', 1, pid);
    summonMountItem(sim.ctx, pid, 'valorsteed');
    finishTransition(sim, pid);
    expect(e.mountKey).toBe('valorsteed');

    expect(summonMountItem(sim.ctx, pid, 'stormfeather_griffin')).toBe(true);
    // Same call, already on the new mount: no channel to drive.
    expect(e.mountKey).toBe('stormfeather_griffin');
    expect(e.mountCastRemaining).toBe(0);
    expect(e.mountCastKey).toBe('');
  });

  it('using the reins you are already riding dismounts you', () => {
    const sim = makeWorld();
    const pid = join(sim, 20);
    const e = sim.entities.get(pid)!;
    sim.addItem('reins_grag_bear', 1, pid);
    summonMountItem(sim.ctx, pid, 'grag_bear');
    finishTransition(sim, pid);
    expect(e.mountKey).toBe('grag_bear');
    expect(summonMountItem(sim.ctx, pid, 'grag_bear')).toBe(true);
    expect(e.mountKey).toBe('');
  });

  it('refuses to summon in combat, and refuses while dead or a released spirit', () => {
    const sim = makeWorld();
    const pid = join(sim, 20);
    const e = sim.entities.get(pid)!;
    sim.addItem('reins_grag_bear', 1, pid);

    e.inCombat = true;
    expect(summonMountItem(sim.ctx, pid, 'grag_bear')).toBe(false);
    expect(errorTexts(sim.tick())).toContain("You can't do that while in combat.");
    e.inCombat = false;

    e.dead = true;
    expect(summonMountItem(sim.ctx, pid, 'grag_bear')).toBe(false);
    e.dead = false;
    e.ghost = true;
    expect(summonMountItem(sim.ctx, pid, 'grag_bear')).toBe(false);
  });

  it('no longer persists any mount pick: a save carries no selectedMount', () => {
    // The old stable pick is gone from PlayerMeta and from the save. A legacy
    // save that still carries the field must load without complaint (the field is
    // simply ignored), which is what makes this a no-migration change.
    const sim = makeWorld();
    const pid = join(sim, 20);
    sim.addItem('reins_grag_bear', 1, pid);
    const state = sim.serializeCharacter(pid);
    if (!state) throw new Error('serializeCharacter returned null');
    expect(state).not.toHaveProperty('selectedMount');

    const legacy = { ...state, selectedMount: 'grag_bear' };
    const sim2 = makeWorld();
    const pid2 = sim2.addPlayer('warrior', 'Rider', { state: legacy });
    sim2.tick();
    // Loads fine, still owns the mount, and starts dismounted as always.
    expect(ownedMounts(sim2.players.get(pid2)!)).toContain('grag_bear');
    expect(sim2.entities.get(pid2)?.mountKey).toBe('');
  });
});

describe('mount and dismount rules', () => {
  it('summons through the channel, then the toggle dismounts instantly', () => {
    const sim = makeWorld();
    const pid = join(sim, 20);
    const e = sim.entities.get(pid)!;
    sim.addItem('reins_valorsteed', 1, pid);
    expect(summonMountItem(sim.ctx, pid, 'valorsteed')).toBe(true);
    expect(e.mountKey).toBe(''); // not mounted until the channel completes
    finishTransition(sim, pid);
    expect(e.mountKey).toBe('valorsteed');
    // The keybind keeps exactly one job: getting OFF, with no channel.
    expect(toggleMount(sim.ctx, pid)).toBe(true);
    expect(e.mountKey).toBe('');
  });

  it('the toggle does NOT summon: unmounted with reins in bags, it is a no-op', () => {
    // Summoning moved onto the reins item. If the toggle ever regains a summon
    // path it would resurrect the implicit "selected mount" this change deleted.
    const sim = makeWorld();
    const pid = join(sim, 20);
    const e = sim.entities.get(pid)!;
    sim.addItem('reins_valorsteed', 1, pid);
    expect(toggleMount(sim.ctx, pid)).toBe(false);
    expect(e.mountKey).toBe('');
    expect(e.mountCastRemaining ?? 0).toBe(0);
  });

  it('refuses to mount in combat but always allows dismounting', () => {
    const sim = makeWorld();
    const pid = join(sim, 20);
    const e = sim.entities.get(pid)!;
    sim.addItem('reins_valorsteed', 1, pid);
    e.inCombat = true;
    expect(summonMountItem(sim.ctx, pid, 'valorsteed')).toBe(false);
    expect(errorTexts(sim.tick())).toContain("You can't do that while in combat.");
    expect(e.mountKey).toBe('');
    e.inCombat = false;
    ride(sim, pid, 'valorsteed');
    expect(e.mountKey).toBe('valorsteed');
    e.inCombat = true;
    expect(toggleMount(sim.ctx, pid)).toBe(true); // dismount is never gated
    expect(e.mountKey).toBe(''); // and it is instant
  });

  it('refuses to mount while dead or a released spirit', () => {
    const sim = makeWorld();
    const pid = join(sim, 20);
    const e = sim.entities.get(pid)!;
    sim.addItem('reins_valorsteed', 1, pid);
    e.dead = true;
    expect(summonMountItem(sim.ctx, pid, 'valorsteed')).toBe(false);
    e.dead = false;
    e.ghost = true;
    expect(summonMountItem(sim.ctx, pid, 'valorsteed')).toBe(false);
    expect(e.mountKey).toBe('');
  });

  it('force-dismounts on death, leaving the reins owned for a remount', () => {
    const sim = makeWorld();
    const pid = join(sim, 20);
    const e = sim.entities.get(pid)!;
    sim.addItem('reins_valorsteed', 1, pid);
    ride(sim, pid, 'valorsteed');
    expect(e.mountKey).toBe('valorsteed');
    sim.ctx.dealDamage(null, e, e.hp + 100, false, 'physical', null, 'hit');
    expect(e.dead).toBe(true);
    expect(e.mountKey).toBe('');
    expect(mountOwned(sim.players.get(pid)!, 'valorsteed')).toBe(true);
  });
});

describe('mount summon/dismount channel (updateMountTransition)', () => {
  it('mounts only after the summon channel completes, not on the toggle', () => {
    const sim = makeWorld();
    const pid = join(sim, 20);
    const e = sim.entities.get(pid)!;
    sim.addItem('reins_valorsteed', 1, pid);
    summonMountItem(sim.ctx, pid, 'valorsteed');
    expect(e.mountCastRemaining).toBeCloseTo(MOUNT_SUMMON_SECONDS, 10);
    expect(e.mountKey).toBe('');
    const steps = Math.round(MOUNT_SUMMON_SECONDS / DT);
    for (let i = 0; i < steps - 1; i++) updateMountTransition(sim.ctx, e, false);
    expect(e.mountKey).toBe(''); // still channeling one tick short
    finishTransition(sim, pid);
    expect(e.mountKey).toBe('valorsteed');
    expect(e.mountCastRemaining).toBe(0);
  });

  it('ignores a toggle while a channel is in progress', () => {
    const sim = makeWorld();
    const pid = join(sim, 20);
    const e = sim.entities.get(pid)!;
    sim.addItem('reins_valorsteed', 1, pid);
    summonMountItem(sim.ctx, pid, 'valorsteed');
    expect(summonMountItem(sim.ctx, pid, 'valorsteed')).toBe(false); // ignored mid-channel
    finishTransition(sim, pid);
    expect(e.mountKey).toBe('valorsteed');
  });

  it('cancels an in-flight summon when combat starts (no mount, no error)', () => {
    const sim = makeWorld();
    const pid = join(sim, 20);
    const e = sim.entities.get(pid)!;
    sim.addItem('reins_valorsteed', 1, pid);
    summonMountItem(sim.ctx, pid, 'valorsteed');
    e.inCombat = true;
    updateMountTransition(sim.ctx, e, false);
    expect(e.mountKey).toBe('');
    expect(e.mountCastRemaining).toBe(0);
    expect(e.mountCastKey).toBe('');
    expect(errorTexts(sim.tick())).not.toContain("You can't do that while in combat.");
  });

  it('force-dismounts instantly in water', () => {
    const sim = makeWorld();
    const pid = join(sim, 20);
    const e = sim.entities.get(pid)!;
    sim.addItem('reins_valorsteed', 1, pid);
    ride(sim, pid, 'valorsteed');
    expect(e.mountKey).toBe('valorsteed');
    updateMountTransition(sim.ctx, e, true); // swimming
    expect(e.mountKey).toBe('');
  });

  it('cancels an in-flight summon in water', () => {
    const sim = makeWorld();
    const pid = join(sim, 20);
    const e = sim.entities.get(pid)!;
    sim.addItem('reins_valorsteed', 1, pid);
    summonMountItem(sim.ctx, pid, 'valorsteed');
    updateMountTransition(sim.ctx, e, true);
    expect(e.mountKey).toBe('');
    expect(e.mountCastRemaining).toBe(0);
  });

  it('leaves the player unmounted if the reins vanish mid-summon', () => {
    const sim = makeWorld();
    const pid = join(sim, 20);
    const meta = sim.players.get(pid)!;
    const e = sim.entities.get(pid)!;
    sim.addItem('reins_valorsteed', 1, pid);
    summonMountItem(sim.ctx, pid, 'valorsteed');
    meta.inventory = meta.inventory.filter((s) => s.itemId !== 'reins_valorsteed');
    finishTransition(sim, pid);
    expect(e.mountKey).toBe('');
  });
});

describe('mount specialty stats', () => {
  it('applies extra mobility while mounted, composing with slows', () => {
    const sim = makeWorld();
    const pid = join(sim, 20);
    const e = sim.entities.get(pid)!;
    expect(moveSpeedMult(e)).toBe(1);
    sim.addItem('reins_valorsteed', 1, pid);
    sim.addItem('reins_stormfeather_griffin', 1, pid);
    sim.addItem('reins_grag_bear', 1, pid);
    sim.addItem('reins_aether_hover_cycle', 1, pid);
    // The whole speed ladder, walked by instant swaps: common 60, uncommon 70,
    // rare 75, epic 80. Each swap applies its new speed on the same call.
    ride(sim, pid, 'valorsteed');
    expect(moveSpeedMult(e), 'common').toBeCloseTo(1.6, 10);
    summonMountItem(sim.ctx, pid, 'stormfeather_griffin');
    expect(moveSpeedMult(e), 'uncommon').toBeCloseTo(1.7, 10);
    summonMountItem(sim.ctx, pid, 'grag_bear');
    expect(moveSpeedMult(e), 'rare').toBeCloseTo(1.75, 10);
    summonMountItem(sim.ctx, pid, 'aether_hover_cycle');
    expect(moveSpeedMult(e), 'epic').toBeCloseTo(1.8, 10);
    e.auras.push({
      id: 'slow_test',
      name: 'slow',
      kind: 'slow',
      remaining: 10,
      duration: 10,
      value: 0.5,
      sourceId: 0,
      school: 'physical',
    });
    expect(moveSpeedMult(e)).toBeCloseTo(0.9, 10);
  });
});

describe('mount wire mirror', () => {
  it('rides the entity identity fields like skin', async () => {
    const { wireEntity } = await import('../server/game');
    const sim = makeWorld();
    const pid = join(sim, 20);
    const e = sim.entities.get(pid)!;
    expect(wireEntity(e)).not.toHaveProperty('mnt');
    sim.addItem('reins_valorsteed', 1, pid);
    ride(sim, pid, 'valorsteed');
    expect(wireEntity(e).mnt).toBe('valorsteed');
  });
});

describe('mount + form/ghost_wolf interaction', () => {
  // Helper: give the player a bear form aura directly (bypasses cast gates so we
  // can test toggleMount's cancel logic in isolation from castAbility).
  function putInBearForm(sim: Sim, pid: number): void {
    const e = sim.entities.get(pid)!;
    e.auras.push({
      id: 'bear_form',
      name: 'Bruin Form',
      kind: 'form_bear',
      remaining: 3600,
      duration: 3600,
      value: 1,
      sourceId: pid,
      school: 'physical',
    });
  }

  // Helper: give the player a ghost_wolf (buff_speed) aura directly.
  function putInGhostWolf(sim: Sim, pid: number): void {
    const e = sim.entities.get(pid)!;
    e.auras.push({
      id: 'ghost_wolf',
      name: 'Shadewolf',
      kind: 'buff_speed',
      remaining: 3600,
      duration: 3600,
      value: 1.4,
      sourceId: pid,
      school: 'nature',
    });
  }

  function giveReins(sim: Sim, pid: number): void {
    sim.addItem('reins_valorsteed', 1, pid);
  }

  it('starting a mount summon cancels all active form auras', () => {
    const sim = makeWorld();
    const pid = join(sim, 20);
    const e = sim.entities.get(pid)!;
    giveReins(sim, pid);
    putInBearForm(sim, pid);
    expect(e.auras.some((a) => FORM_AURA_KINDS.has(a.kind))).toBe(true);

    sim.drainEvents();
    const started = summonMountItem(sim.ctx, pid, 'valorsteed');
    const events = sim.drainEvents();

    expect(started).toBe(true);
    // No form aura should remain.
    expect(e.auras.some((a) => FORM_AURA_KINDS.has(a.kind))).toBe(false);
    // An aura-removal event must have been emitted for the bear form.
    const removal = events.find(
      (ev) => ev.type === 'aura' && ev.targetId === pid && !ev.gained && ev.name === 'Bruin Form',
    );
    expect(removal).toBeDefined();
  });

  it('starting a mount summon breaks ghost_wolf', () => {
    const sim = makeWorld();
    const pid = join(sim, 20);
    const e = sim.entities.get(pid)!;
    giveReins(sim, pid);
    putInGhostWolf(sim, pid);
    expect(e.auras.some((a) => a.id === 'ghost_wolf')).toBe(true);

    sim.drainEvents();
    const started = summonMountItem(sim.ctx, pid, 'valorsteed');
    const events = sim.drainEvents();

    expect(started).toBe(true);
    expect(e.auras.some((a) => a.id === 'ghost_wolf')).toBe(false);
    const removal = events.find(
      (ev) => ev.type === 'aura' && ev.targetId === pid && !ev.gained && ev.name === 'Shadewolf',
    );
    expect(removal).toBeDefined();
  });

  it('shapeshifting into a form while mounted force-dismounts the player', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
    const pid = sim.addPlayer('druid', 'Ursa');
    sim.tick();
    sim.setPlayerLevel(20, pid);
    const e = sim.entities.get(pid)!;
    // Put the player on a mount directly (simulate already-mounted state).
    giveReins(sim, pid);
    e.mountKey = 'valorsteed';

    castAbility(sim.ctx, 'bear_form', pid);

    expect(e.mountKey).toBe('');
  });

  it('activating ghost_wolf while mounted force-dismounts the player', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
    const pid = sim.addPlayer('shaman', 'Thrall');
    sim.tick();
    sim.setPlayerLevel(20, pid);
    const e = sim.entities.get(pid)!;
    giveReins(sim, pid);
    e.mountKey = 'valorsteed';

    castAbility(sim.ctx, 'ghost_wolf', pid);

    expect(e.mountKey).toBe('');
  });
});

describe('riding skill gate (Req 5)', () => {
  it('blocks toggleMount when ridingTrained is absent', () => {
    const sim = makeWorld();
    const pid = join(sim, 20);
    const meta = sim.players.get(pid)!;
    // Override the ridingTrained flag set by join()
    meta.ridingTrained = false;
    sim.addItem('reins_valorsteed', 1, pid);
    const e = sim.entities.get(pid)!;

    const events: SimEvent[] = [];
    const orig = sim.ctx.emit.bind(sim.ctx);
    // Capture events
    const result = summonMountItem(sim.ctx, pid, 'valorsteed');

    expect(result).toBe(false);
    expect(e.mountCastRemaining ?? 0).toBe(0);
    expect(e.mountCastKey).toBe('');
  });

  it('blocks the ITEM path when ridingTrained is absent, even holding the reins', () => {
    // The hole this closes: reins are usable items now, and the item sits in your
    // bags. Without an explicit riding-skill check on the item path, owning reins
    // would imply being able to ride them, bypassing Marla entirely. Deleting
    // selectMount removed one of the three places that gate used to be enforced,
    // so this test exists to make sure the remaining one is real.
    const sim = makeWorld();
    const pid = join(sim, 20);
    const meta = sim.players.get(pid)!;
    const e = sim.entities.get(pid)!;
    meta.ridingTrained = false;
    sim.addItem('reins_grag_bear', 1, pid);

    expect(summonMountItem(sim.ctx, pid, 'grag_bear')).toBe(false);
    expect(errorTexts(sim.tick())).toContain(
      'You must learn to ride first. Find a riding trainer.',
    );
    expect(e.mountKey).toBe('');
    expect(e.mountCastRemaining ?? 0).toBe(0);

    // The same denial through the real click path (useItem), not just the helper.
    useItem(sim.ctx, 'reins_grag_bear', pid);
    finishTransition(sim, pid);
    expect(e.mountKey).toBe('');

    // Buying the skill unblocks it, proving the gate is the ONLY thing refusing.
    meta.ridingTrained = true;
    expect(summonMountItem(sim.ctx, pid, 'grag_bear')).toBe(true);
    finishTransition(sim, pid);
    expect(e.mountKey).toBe('grag_bear');
  });

  it('allows toggleMount when ridingTrained is true', () => {
    const sim = makeWorld();
    const pid = join(sim, 20);
    // join() sets ridingTrained = true already
    sim.addItem('reins_valorsteed', 1, pid);

    const result = summonMountItem(sim.ctx, pid, 'valorsteed');

    expect(result).toBe(true);
  });

  it('allows toggleMount during a riding lesson even without ridingTrained', () => {
    const sim = makeWorld();
    const pid = join(sim, 20);
    const meta = sim.players.get(pid)!;
    meta.ridingTrained = false;
    // Put the player into a lesson IN_PROGRESS
    meta.mountTraining = {
      sessionId: 'test_session',
      ownerId: pid,
      anchor: { x: 0, z: 0 },
      state: 'IN_PROGRESS',
      phase: 'mount',
    };

    const result = toggleMount(sim.ctx, pid);

    // Should start the training mount summon
    expect(result).toBe(true);
  });

  it('grandfathers mountTrainingFeePaid into ridingTrained on addPlayer load', () => {
    // A legacy save where the 100g fee was paid but ridingTrained was not yet stored
    // (pre-v0.23 saves) must load with ridingTrained=true so a reins use succeeds.
    const sim = makeWorld();
    const state = {
      level: 20,
      xp: 0,
      copper: 0,
      hp: 100,
      resource: 100,
      pos: { x: 0, z: 0 },
      facing: 0,
      equipment: {},
      inventory: [],
      questLog: [],
      questsDone: [],
      mountTrainingFeePaid: true,
      // ridingTrained is intentionally absent (legacy save).
    };
    const pid2 = sim.addPlayer('warrior', 'LegacyRider', { state: state as any });
    const meta2 = sim.players.get(pid2)!;
    expect(meta2.ridingTrained).toBe(true);
    sim.addItem('reins_valorsteed', 1, pid2);
    expect(summonMountItem(sim.ctx, pid2, 'valorsteed')).toBe(true);
  });

  it('grandfathers q_riding_lessons active quest into ridingTrained on addPlayer load', () => {
    // A mid-quest save where q_riding_lessons is IN_PROGRESS (the player had accepted
    // the lesson and was racing) but ridingTrained was never stored must also load
    // with ridingTrained=true (the fee was implied by quest acceptance).
    const sim = makeWorld();
    const state = {
      level: 20,
      xp: 0,
      copper: 0,
      hp: 100,
      resource: 100,
      pos: { x: 0, z: 0 },
      facing: 0,
      equipment: {},
      inventory: [],
      questLog: [{ questId: 'q_riding_lessons', state: 'active', counts: [] }],
      questsDone: [],
      // ridingTrained and mountTrainingFeePaid are intentionally absent.
    };
    const pid3 = sim.addPlayer('warrior', 'MidQuestRider', { state: state as any });
    const meta3 = sim.players.get(pid3)!;
    expect(meta3.ridingTrained).toBe(true);
    sim.addItem('reins_valorsteed', 1, pid3);
    expect(summonMountItem(sim.ctx, pid3, 'valorsteed')).toBe(true);
  });

  it('grandfathers q_riding_lessons completed quest into ridingTrained on addPlayer load', () => {
    // A save where q_riding_lessons is in questsDone (lesson finished and turned in)
    // but ridingTrained was not stored must also load with ridingTrained=true.
    const sim = makeWorld();
    const state = {
      level: 20,
      xp: 0,
      copper: 0,
      hp: 100,
      resource: 100,
      pos: { x: 0, z: 0 },
      facing: 0,
      equipment: {},
      inventory: [],
      questLog: [],
      questsDone: ['q_riding_lessons'],
    };
    const pid4 = sim.addPlayer('warrior', 'DoneRider', { state: state as any });
    const meta4 = sim.players.get(pid4)!;
    expect(meta4.ridingTrained).toBe(true);
  });
});

describe('cancelFormsAndGhostWolf recalcs stats (Fix #1)', () => {
  it('strips a bear form aura and immediately recalcs stats so armor drops from bear-form level', () => {
    // Arrange: a druid casts bear_form (which calls recalcPlayerStats internally),
    // giving +90% armor. Then we start a mount summon, which should strip the form
    // AND call recalcPlayerStats so armor drops back to caster-form levels immediately,
    // not on the next tick.
    const sim = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
    const pid = sim.addPlayer('druid', 'Ursatest');
    sim.tick();
    sim.setPlayerLevel(20, pid);
    const meta = sim.players.get(pid)!;
    meta.ridingTrained = true;
    sim.addItem('reins_valorsteed', 1, pid);
    const e = sim.entities.get(pid)!;
    // Record baseline (caster-form) armor.
    const baselineArmor = e.stats.armor;
    // Enter bear form: castAbility calls recalcPlayerStats so armor inflates to 1.9x.
    castAbility(sim.ctx, 'bear_form', pid);
    const armorInBearForm = e.stats.armor;
    expect(armorInBearForm).toBeGreaterThan(baselineArmor);
    expect(e.auras.some((a) => a.kind === 'form_bear')).toBe(true);

    // Act: start the mount summon channel (calls cancelFormsAndGhostWolf internally).
    const started = summonMountItem(sim.ctx, pid, 'valorsteed');

    // Assert: channel started, form gone, armor immediately back to baseline (no tick needed).
    expect(started).toBe(true);
    expect(e.auras.some((a) => a.kind === 'form_bear')).toBe(false);
    expect(e.stats.armor).toBeLessThan(armorInBearForm);
    expect(e.stats.armor).toBe(baselineArmor);
  });
});

describe('summon channel cancels on ability cast (Fix #2)', () => {
  it('cancels an in-progress mount summon channel when the player casts any ability', () => {
    // Arrange: a warrior starts a mount summon (1.5s channel).
    const sim = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
    const pid = sim.addPlayer('warrior', 'Rider');
    sim.tick();
    sim.setPlayerLevel(20, pid);
    const meta = sim.players.get(pid)!;
    meta.ridingTrained = true;
    sim.addItem('reins_valorsteed', 1, pid);
    const e = sim.entities.get(pid)!;
    summonMountItem(sim.ctx, pid, 'valorsteed');

    // Verify the summon channel started.
    expect(e.mountCastKey).toBe('valorsteed');
    expect(e.mountCastRemaining ?? 0).toBeGreaterThan(0);

    // Act: cast an ability mid-channel (battle_shout is instant and has no target req).
    castAbility(sim.ctx, 'battle_shout', pid);

    // Assert: the summon channel was cancelled; the player is still dismounted.
    expect(e.mountCastKey).toBe('');
    expect(e.mountCastRemaining ?? 0).toBe(0);
    expect(e.mountKey).toBe('');
  });

  it('does not cancel the mount key when the player casts with no summon in flight', () => {
    // Casting while FULLY mounted (no channel) triggers forceDismount instantly (pre-existing
    // behavior, not related to Fix #2). Verify that Fix #2 only adds the summon-channel cancel
    // and does not break the forceDismount path.
    const sim = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
    const pid = sim.addPlayer('warrior', 'Rider');
    sim.tick();
    sim.setPlayerLevel(20, pid);
    const meta = sim.players.get(pid)!;
    meta.ridingTrained = true;
    sim.addItem('reins_valorsteed', 1, pid);
    const e = sim.entities.get(pid)!;
    // Fully mount the player (no in-flight channel).
    ride(sim, pid, 'valorsteed');
    expect(e.mountKey).toBe('valorsteed');
    expect(e.mountCastRemaining ?? 0).toBe(0);

    // Cast an ability: forceDismount fires as before (pre-existing behavior).
    castAbility(sim.ctx, 'battle_shout', pid);

    // The pre-existing forceDismount path should still clear the mount key.
    expect(e.mountKey).toBe('');
    // No summon channel was in flight, so mountCastKey stays ''.
    expect(e.mountCastKey).toBe('');
  });
});

describe('pre-armed auto-attack while mounted (Fix #3)', () => {
  it('force-dismounts the player when the swing loop fires with mountKey set', () => {
    // Arrange: a warrior is somehow mounted with autoAttack armed and a hostile target
    // in melee range (swing timer elapsed). This can happen if the client sends an
    // Attack command while mounted without the server blocking it via startAutoAttack
    // (which already force-dismounts). The per-tick updatePlayerAutoAttack must also guard.
    const sim = makeWorld();
    const pid = join(sim, 10);
    const meta = sim.players.get(pid)!;
    sim.addItem('reins_grag_bear', 1, pid);
    const e = sim.entities.get(pid)!;
    // Put the player fully mounted (skip the channel).
    ride(sim, pid, 'grag_bear');
    expect(e.mountKey).toBe('grag_bear');

    // Spawn a hostile mob right next to the player in melee range.
    const tpl = MOBS['wild_boar'];
    const mobId = (sim as any).nextId++;
    const mob = createMob(mobId, tpl, 3, { x: e.pos.x + 1, y: e.pos.y, z: e.pos.z });
    mob.maxHp = 100_000;
    mob.hp = mob.maxHp;
    mob.hostile = true;
    sim.entities.set(mobId, mob);

    // Arm auto-attack directly (bypasses startAutoAttack's own dismount guard).
    e.autoAttack = true;
    e.targetId = mobId;
    e.swingTimer = 0;
    e.facing = 0; // facing +z; mob is to the right, still within melee arc

    // Act: run the per-tick auto-attack loop.
    updatePlayerAutoAttack(sim.ctx, e, meta);

    // Assert: the mount was cleared before the swing could fire while mounted.
    expect(e.mountKey).toBe('');
  });
});

describe('summon completion strips forms that slipped through mid-channel (Fix #2B)', () => {
  it('strips a bear form aura that was gained during the summon channel at completion', () => {
    // Arrange: a druid starts a mount summon, then we inject a bear form aura
    // directly (simulating a form that slipped through during the 1.5s channel).
    // At channel completion, updateMountTransition must call cancelFormsAndGhostWolf
    // so the player is never simultaneously mounted and shapeshifted.
    const sim = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
    const pid = sim.addPlayer('druid', 'Ursatest');
    sim.tick();
    sim.setPlayerLevel(20, pid);
    const meta = sim.players.get(pid)!;
    meta.ridingTrained = true;
    sim.addItem('reins_valorsteed', 1, pid);
    const e = sim.entities.get(pid)!;

    // Start the summon channel.
    expect(summonMountItem(sim.ctx, pid, 'valorsteed')).toBe(true);
    expect(e.mountCastKey).toBe('valorsteed');

    // Inject a bear form aura mid-channel (simulates a form cast during the 1.5s window).
    e.auras.push({
      id: 'bear_form',
      name: 'Bruin Form',
      kind: 'form_bear',
      remaining: 3600,
      duration: 3600,
      value: 1,
      sourceId: pid,
      school: 'physical',
    });
    expect(e.auras.some((a) => a.kind === 'form_bear')).toBe(true);

    // Act: complete the summon channel (drives updateMountTransition to completion).
    finishTransition(sim, pid);

    // Assert: the player is mounted AND the form is gone.
    expect(e.mountKey).toBe('valorsteed');
    expect(e.auras.some((a) => a.kind === 'form_bear')).toBe(false);
  });
});
