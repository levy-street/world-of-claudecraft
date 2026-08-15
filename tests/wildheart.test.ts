// The Wildheart Basin is Palmreach's open-field jungle dungeon. This suite
// pins its authored roster, radial route, overflow instance band, shared
// terrain and collision contract, Heroic tuning, and appended deed pair.

import { describe, expect, it } from 'vitest';
import { VISUALS } from '../src/render/characters/manifest';
import { resolvePosition } from '../src/sim/colliders';
import { DEEDS } from '../src/sim/content/deeds';
import { HEROIC_DUNGEON_TUNING } from '../src/sim/content/dungeon_difficulty';
import { HEROIC_BOSS_LOOT } from '../src/sim/content/heroic_loot';
import { heroicVariantId } from '../src/sim/content/heroic_variants';
import {
  WILDHEART_DUNGEON_DEFS,
  WILDHEART_ITEMS,
  WILDHEART_MOBS,
} from '../src/sim/content/wildheart';
import {
  BUILTIN_WORLD,
  DUNGEON_OVERFLOW_X_BASE,
  DUNGEON_X_THRESHOLD,
  DUNGEONS,
  dungeonAt,
  ITEMS,
  instanceOrigin,
  isArenaPos,
  isDelvePos,
  isRiftPos,
  isYumiMazePos,
  MOBS,
  YUMI_BAND_X_MAX,
  zoneAt,
} from '../src/sim/data';
import { onDungeonFinalBossKilledForDeeds } from '../src/sim/deeds';
import { enterDungeon, updateDoorTriggers } from '../src/sim/instances/dungeons';
import {
  primaryStatBudget,
  TWOHAND_DPS_MULT,
  TWOHAND_STAT_MULT,
  weaponDpsBudget,
} from '../src/sim/item_budget';
import { expectedStatBudget, itemLevel, primaryStatSum } from '../src/sim/item_level';
import { combatProfileForMob, scaledDefaultMobMeleeRange } from '../src/sim/mob_combat';
import type { InstanceSlot } from '../src/sim/sim';
import { Sim } from '../src/sim/sim';
import type { Entity, WorldContent } from '../src/sim/types';
import { RUN_SPEED } from '../src/sim/types';
import {
  WILDHEART_FIELD_BOUNDS,
  WILDHEART_FIELD_COLLIDER_SPECS,
  WILDHEART_FIELD_PLACEMENTS,
  wildheartFieldHeight,
} from '../src/sim/wildheart_field';
import { groundHeight } from '../src/sim/world';

const WILDHEART_TEST_WORLD: WorldContent = {
  ...BUILTIN_WORLD,
  camps: [],
  npcs: {},
  groundObjects: [],
};

function makeSim(seed = 91): Sim {
  return new Sim({ seed, playerClass: 'warrior', noPlayer: true, world: WILDHEART_TEST_WORLD });
}

describe('Wildheart Basin dungeon content', () => {
  it('registers a five-player open-field dungeon beside the Sunken Idol in Palmreach', () => {
    const def = DUNGEONS.wildheart_basin;
    expect(def).toMatchObject({
      name: 'The Wildheart Basin',
      index: 7,
      interior: 'wildheart',
      suggestedPlayers: 5,
    });
    expect(zoneAt(def.doorPos.x, def.doorPos.z).id).toBe('palmreach');
    const indices = Object.values(DUNGEONS).map((dungeon) => dungeon.index);
    expect(indices.filter((index) => index === def.index)).toHaveLength(1);
  });

  it('defines five distinct, fully registered savage troll combat roles', () => {
    expect(Object.keys(WILDHEART_MOBS).sort()).toEqual([
      'wildheart_beastmaster',
      'wildheart_hexcaller',
      'wildheart_high_priest',
      'wildheart_ravager',
      'wildheart_stalker',
    ]);
    for (const id of Object.keys(WILDHEART_MOBS)) {
      expect(MOBS[id], `${id} reaches MOBS`).toBeDefined();
      expect(MOBS[id].family).toBe('troll');
      expect(MOBS[id].elite).toBe(true);
    }
    expect(MOBS.wildheart_stalker.petSpell?.name).toBe('Razorvine Spear');
    expect(MOBS.wildheart_ravager.bleed?.name).toBe('Bloodmane Rend');
    expect(MOBS.wildheart_hexcaller.mendAlly?.name).toBe('Ancestral Sap');
    expect(MOBS.wildheart_beastmaster).toMatchObject({ rare: true, ccImmune: true });
    expect(MOBS.wildheart_beastmaster.warcry?.name).toBe('Call of the Hunt');
    for (const id of Object.keys(WILDHEART_MOBS)) {
      const visual = VISUALS[`mob_${id}`];
      expect(visual?.yaw, `${id} faces the game +Z movement axis`).toBe(-Math.PI / 2);
      expect(visual?.clips.run, `${id} carries its run clip`).toBe('Run');
    }
  });

  it('makes Zulgar the sole final boss with arena-scale mechanics and three epics', () => {
    const boss = MOBS.wildheart_high_priest;
    expect(boss).toMatchObject({ boss: true, elite: true, ccImmune: true });
    expect(boss.aoePulse?.name).toBe('Wildheart Pulse');
    expect(boss.knockback?.name).toBe('Jaguar Roar');
    expect(boss.enrage?.belowHpPct).toBe(0.3);
    // Scoped to Zulgar's own loot table: the Tier-2 loot pass added the rare
    // beastspear and the uncommon trio, and the rogue re-band gave the Fanglord
    // Beastmaster its own epic (duskwhisper), which is not a Zulgar drop.
    const zulgarLootIds = new Set((boss.loot ?? []).map((drop) => drop.itemId));
    const epicIds = Object.keys(WILDHEART_ITEMS)
      .filter((id) => WILDHEART_ITEMS[id].quality === 'epic' && zulgarLootIds.has(id))
      .sort();
    expect(epicIds).toEqual([
      'wildheart_fangknife',
      'wildheart_hexwood_staff',
      'wildheart_tuskblade',
    ]);
    for (const id of epicIds) {
      expect(ITEMS[id].quality).toBe('epic');
      expect(boss.loot?.some((drop) => drop.itemId === id)).toBe(true);
    }
  });

  it('populates both banks, two rare encounters, and one deepest shrine boss', () => {
    const spawns = WILDHEART_DUNGEON_DEFS.wildheart_basin.spawns;
    expect(spawns).toHaveLength(20);
    for (const spawn of spawns) expect(spawn.mobId.startsWith('wildheart_')).toBe(true);
    expect(spawns.filter((spawn) => spawn.mobId === 'wildheart_beastmaster')).toHaveLength(2);
    const bosses = spawns.filter((spawn) => spawn.mobId === 'wildheart_high_priest');
    expect(bosses).toHaveLength(1);
    expect(bosses[0].z).toBe(Math.max(...spawns.map((spawn) => spawn.z)));
    expect(spawns.some((spawn) => spawn.x < -20)).toBe(true);
    expect(spawns.some((spawn) => spawn.x > 20)).toBe(true);
  });

  it('keeps combat spawns inside the field and clear of blocking props', () => {
    for (const spawn of WILDHEART_DUNGEON_DEFS.wildheart_basin.spawns) {
      expect(spawn.x).toBeGreaterThanOrEqual(WILDHEART_FIELD_BOUNDS.minX);
      expect(spawn.x).toBeLessThanOrEqual(WILDHEART_FIELD_BOUNDS.maxX);
      expect(spawn.z).toBeGreaterThanOrEqual(WILDHEART_FIELD_BOUNDS.minZ);
      expect(spawn.z).toBeLessThanOrEqual(WILDHEART_FIELD_BOUNDS.maxZ);
      const clearance = Math.min(
        ...WILDHEART_FIELD_COLLIDER_SPECS.map(
          (spec) => Math.hypot(spawn.x - spec.x, spawn.z - spec.z) - spec.r,
        ),
      );
      expect(clearance, `${spawn.mobId} at ${spawn.x},${spawn.z}`).toBeGreaterThan(4);
    }
  });

  it('spawns all five roles when a party claims the instance', () => {
    const sim = makeSim();
    const playerId = sim.addPlayer('warrior', 'Alpha');
    expect(enterDungeon(sim.ctx, 'wildheart_basin', playerId)).toBe(true);
    const instance = (
      sim.instances as { dungeonId: string; partyKey: unknown; mobIds: number[] }[]
    ).find((candidate) => candidate.dungeonId === 'wildheart_basin' && candidate.partyKey !== null);
    expect(instance).toBeDefined();
    if (!instance) throw new Error('Wildheart instance was not claimed');
    const templates = instance.mobIds
      .map((id) => sim.entities.get(id))
      .filter((entity): entity is Entity => !!entity)
      .map((entity) => entity.templateId);
    for (const id of Object.keys(WILDHEART_MOBS)) expect(templates).toContain(id);
  });

  it('uses the overflow band without reclassifying any existing instance system', () => {
    const origin = instanceOrigin(DUNGEONS.wildheart_basin.index, 0);
    expect(origin.x).toBe(DUNGEON_OVERFLOW_X_BASE);
    expect(origin.x).toBeGreaterThanOrEqual(YUMI_BAND_X_MAX + 1000);
    expect(dungeonAt(origin.x)?.id).toBe('wildheart_basin');
    expect(isArenaPos(origin.x)).toBe(false);
    expect(isDelvePos(origin.x)).toBe(false);
    expect(isRiftPos(origin.x)).toBe(false);
    expect(isYumiMazePos(origin.x)).toBe(false);
    for (const existing of Object.values(DUNGEONS).filter((dungeon) => dungeon.index < 7)) {
      expect(instanceOrigin(existing.index, 0).x).toBeLessThan(DUNGEON_OVERFLOW_X_BASE - 1000);
      expect(dungeonAt(instanceOrigin(existing.index, 0).x)?.id).toBe(existing.id);
    }
  });

  it('routes collision and shared height through the Wildheart interior', () => {
    const origin = instanceOrigin(DUNGEONS.wildheart_basin.index, 0);
    const spec = WILDHEART_FIELD_COLLIDER_SPECS.find(
      (candidate) => candidate.kind === 'wildheart_mask_totem',
    );
    if (!spec) throw new Error('Wildheart mask totem collider is missing');
    const probe = { x: origin.x + spec.x + 0.2, z: origin.z + spec.z };
    const resolved = resolvePosition(1, probe.x, probe.z, 1);
    expect(Math.hypot(resolved.x - probe.x, resolved.z - probe.z)).toBeGreaterThan(0.5);

    for (const [x, z] of [
      [0, -5],
      [-37, 96],
      [0, 132],
      [0, 213],
    ] as const) {
      expect(groundHeight(origin.x + x, origin.z + z, 1)).toBeCloseTo(
        wildheartFieldHeight(x, z),
        10,
      );
    }
    expect(wildheartFieldHeight(0, 213)).toBeGreaterThan(wildheartFieldHeight(0, 104) + 7);
  });

  it('derives visible prop collisions from the single authored placement table', () => {
    expect(WILDHEART_FIELD_PLACEMENTS.length).toBeGreaterThanOrEqual(45);
    const blockingKinds = new Set(WILDHEART_FIELD_COLLIDER_SPECS.map((spec) => spec.kind));
    expect(blockingKinds).toEqual(
      new Set([
        'wildheart_beast_den',
        'wildheart_canopy_platform',
        'wildheart_ancestor_ruin',
        'wildheart_jaguar_gate',
        'wildheart_jungle_canopy_tree',
        'wildheart_mask_totem',
        'wildheart_ritual_pyramid',
      ]),
    );
  });

  it('ships Heroic tuning and an append-only normal plus Heroic deed pair', () => {
    expect(HEROIC_DUNGEON_TUNING.wildheart_basin).toMatchObject({
      level: 22,
      finalBossId: 'wildheart_high_priest',
      marksPerParticipant: 1,
    });
    expect(DEEDS.dgn_wildheart_basin.trigger).toEqual({
      kind: 'dungeonClears',
      dungeonId: 'wildheart_basin',
      count: 1,
    });
    expect(DEEDS.dgn_wildheart_basin_heroic.trigger).toEqual({
      kind: 'dungeonClears',
      dungeonId: 'wildheart_basin',
      difficulty: 'heroic',
      count: 1,
    });
  });

  it('credits the clear record and deed pair when Zulgar falls', () => {
    // The shipped regression: wildheart_high_priest was absent from
    // FINAL_BOSS_DUNGEONS, so both deeds above sat permanently at 0/1.
    const sim = makeSim();
    const playerId = sim.addPlayer('warrior', 'Clearer');
    const meta = sim.players.get(playerId);
    if (!meta) throw new Error('player meta missing');
    const boss = { templateId: 'wildheart_high_priest' } as Entity;

    onDungeonFinalBossKilledForDeeds(sim.ctx, boss, undefined, [meta]);
    expect(meta.deedStats.dungeonClears.wildheart_basin).toBe(1);
    expect(meta.deedStats.counters.dungeonFinalBossKills).toBe(1);
    sim.tick();
    expect(meta.deedsEarned.has('dgn_wildheart_basin')).toBe(true);
    expect(meta.deedsEarned.has('dgn_wildheart_basin_heroic')).toBe(false);

    onDungeonFinalBossKilledForDeeds(sim.ctx, boss, { difficulty: 'heroic' } as InstanceSlot, [
      meta,
    ]);
    expect(meta.deedStats.dungeonClears['wildheart_basin:heroic']).toBe(1);
    sim.tick();
    expect(meta.deedsEarned.has('dgn_wildheart_basin_heroic')).toBe(true);
  });

  it('pins the live-playtest combat fixes on the basin roster', () => {
    // The Razorvine Spear must stay a non-physical school: a physical-school
    // petSpell replays the melee Attack clip on every impact, which read as
    // the stalker whiffing melee swings from 24yd.
    expect(MOBS.wildheart_stalker.petSpell?.school).toBe('nature');
    // "Fast melee pressure" must actually outrun a moving player: the shipped
    // 7.1 vs RUN_SPEED 7 closed at 0.1 yd/s and never caught anyone, and a
    // bare toBeGreaterThan(RUN_SPEED) would have accepted that regression, so
    // pin the margin.
    expect(MOBS.wildheart_ravager.moveSpeed).toBeGreaterThanOrEqual(RUN_SPEED + 0.5);
    // The bruisers keep their scale-derived reach but close to visual contact
    // before trading, so landed hits no longer read as whiffs. Reach is driven
    // by the AUTHORED scale (mob_combat.ts hardcodes it per the Nythraxis
    // pattern), so read it from the template: a scale retune that forgets the
    // profile now fails here instead of drifting silently.
    const ravagerScale = MOBS.wildheart_ravager.scale ?? 1;
    const ravager = combatProfileForMob('wildheart_ravager', ravagerScale);
    expect(ravager.meleeRange).toBe(scaledDefaultMobMeleeRange(ravagerScale));
    expect(ravager.desiredRange).toBe(5);
    const beastmasterScale = MOBS.wildheart_beastmaster.scale ?? 1;
    const beastmaster = combatProfileForMob('wildheart_beastmaster', beastmasterScale);
    expect(beastmaster.meleeRange).toBe(scaledDefaultMobMeleeRange(beastmasterScale));
    expect(beastmaster.desiredRange).toBe(5.5);
  });

  it('lets the Idol Guardian phase through the ruin-ring relic debris', () => {
    // Without the flag the gatekeeper wedges on the toppled-relic colliders
    // at the Sunken Idol's heart, ~0.4yd past its own reach, and never swings.
    expect(MOBS.idol_guardian?.phasesThroughObstacles).toBe(true);
  });

  it('the spear school skips physical-only DR: Raised Guard halves melee, never the spear', () => {
    // The school flip's real gameplay consequence beyond the render fix:
    // dealDamage's physical-only fold (buff_dr_phys, prot's Raised Guard) no
    // longer applies to the Razorvine Spear. Reading the school FROM the
    // template makes a silent revert to 'physical' collapse the two deltas
    // and fail here.
    const spear = MOBS.wildheart_stalker.petSpell;
    if (!spear) throw new Error('the stalker lost its spear');
    const sim = makeSim(23);
    const pid = sim.addPlayer('warrior', 'Tank');
    expect(enterDungeon(sim.ctx, 'wildheart_basin', pid)).toBe(true);
    const inst = (sim.instances as { dungeonId: string; mobIds: number[] }[]).find(
      (i) => i.dungeonId === 'wildheart_basin',
    );
    const stalker = inst?.mobIds
      .map((id) => sim.entities.get(id))
      .find((e): e is Entity => e?.templateId === 'wildheart_stalker');
    if (!stalker) throw new Error('no stalker spawned');
    const p = sim.entities.get(pid) as Entity;
    p.auras.push({
      id: 'raised_guard',
      name: 'Raised Guard',
      kind: 'buff_dr_phys',
      remaining: 6,
      duration: 6,
      value: 0.5,
      sourceId: p.id,
      school: 'physical',
    });
    const taken = (school: string): number => {
      p.hp = p.maxHp;
      (sim as unknown as { dealDamage: Function }).dealDamage(
        stalker,
        p,
        20,
        false,
        school,
        spear.name,
        'hit',
      );
      return p.maxHp - p.hp;
    };
    expect(taken('physical'), 'the fold halves a physical hit').toBe(10);
    expect(taken(spear.school), "the spear's school passes it whole").toBe(20);
  });
});

describe('Wildheart Basin Tier-2 loot pass', () => {
  const dps = (id: string) => {
    const w = ITEMS[id].weapon;
    if (!w) throw new Error(`${id} is not a weapon`);
    return (w.min + w.max) / 2 / w.speed;
  };

  it('the Beastmaster rare beastspear is budget-exact at item level 23', () => {
    const item = ITEMS.fanglords_beastspear;
    expect(item.quality).toBe('rare');
    expect(itemLevel(item)).toBe(23);
    // Budget computed from the formulas, not literals: rare mainhand line x the
    // two-hand stat premium.
    const budget = Math.round(primaryStatBudget(23, 'rare', 'mainhand') * TWOHAND_STAT_MULT);
    expect(expectedStatBudget(item)).toBe(budget);
    expect(primaryStatSum(item)).toBe(budget);
    // 2H dps rides the TWOHAND_DPS_MULT premium over the one-hand curve.
    expect(Math.abs(dps(item.id) - weaponDpsBudget(23) * TWOHAND_DPS_MULT)).toBeLessThan(0.3);
  });

  it("Zulgar's guaranteed uncommon trio is budget-exact at item level 21, one per armor class", () => {
    const trio = ['bloodmane_warleggings', 'vineclaw_stalking_breeches', 'sunbone_ritual_sarong'];
    const armorTypes = trio.map((id) => {
      const item = ITEMS[id];
      expect(item.quality, id).toBe('uncommon');
      expect(item.kind === 'armor' && item.slot === 'legs', id).toBe(true);
      expect(itemLevel(item), id).toBe(21);
      expect(expectedStatBudget(item), id).toBe(primaryStatBudget(21, 'uncommon', 'legs'));
      expect(primaryStatSum(item), `${id} stat sum == budget`).toBe(expectedStatBudget(item));
      return item.kind === 'armor' ? item.armorType : undefined;
    });
    expect(new Set(armorTypes)).toEqual(new Set(['mail', 'leather', 'cloth']));
  });

  it('the four heroic Zulgar epics are budget-exact at item level 31 with one rating each', () => {
    for (const id of [
      'basin_stalkers_tunic',
      'verdant_heart_vestment',
      'sunbone_ritual_hauberk',
      'greatfang_of_the_basin',
    ]) {
      const item = ITEMS[id];
      expect(item.quality, id).toBe('epic');
      expect(itemLevel(item), `${id} ilvl`).toBe(31);
      expect(primaryStatSum(item), `${id} stat sum == budget`).toBe(expectedStatBudget(item));
      const ratings = [item.hitRating, item.critRating, item.hasteRating].filter(
        (r) => r !== undefined && r > 0,
      );
      expect(ratings, `${id} carries exactly one combat rating`).toHaveLength(1);
    }
    // The 2H stat premium and dps premium, from the formulas.
    expect(expectedStatBudget(ITEMS.greatfang_of_the_basin)).toBe(
      Math.round(primaryStatBudget(31, 'epic', 'mainhand') * TWOHAND_STAT_MULT),
    );
    expect(
      Math.abs(dps('greatfang_of_the_basin') - weaponDpsBudget(31) * TWOHAND_DPS_MULT),
    ).toBeLessThan(0.3);
  });

  it("pins Zulgar's roll groups: guaranteed uncommon sums to 1.0, wildheart_bonus to 0.18", () => {
    const loot = MOBS.wildheart_high_priest.loot ?? [];
    const groupSum = (group: string) =>
      loot.filter((e) => e.rollGroup === group).reduce((a, e) => a + e.chance, 0);
    expect(loot.filter((e) => e.rollGroup === 'zulgar_guaranteed_uncommon')).toHaveLength(3);
    expect(groupSum('zulgar_guaranteed_uncommon')).toBeCloseTo(1.0, 9);
    // 0.06 per epic, the house PER-ITEM bonus rate (Korzul's epics sit at ~0.05
    // each across a 13-item group; a 3-item pool matches the per-item rate, not
    // the group's total mass). Pinned per item, not only as the group sum: a
    // non-uniform re-tune (0.10/0.05/0.03) keeps the sum but breaks the rate.
    expect(loot.filter((e) => e.rollGroup === 'wildheart_bonus').map((e) => e.chance)).toEqual([
      0.06, 0.06, 0.06,
    ]);
    expect(groupSum('wildheart_bonus')).toBeCloseTo(0.18, 9);
    expect(loot.some((e) => e.copper === 55000 && e.chance === 1)).toBe(true);
    expect(loot.some((e) => e.itemId === 'bone_fragments' && e.chance === 0.8)).toBe(true);
  });

  it('adds the troll trophy junk on the trash line and the rare-convention Beastmaster', () => {
    const tuskChance = (mobId: string) =>
      (MOBS[mobId].loot ?? []).find((e) => e.itemId === 'chipped_tusk')?.chance;
    expect(tuskChance('wildheart_stalker')).toBe(0.35);
    expect(tuskChance('wildheart_ravager')).toBe(0.4);
    expect(tuskChance('wildheart_hexcaller')).toBe(0.45);
    // Rare-trophy convention (Grubjaw): a guaranteed tusk plus the signature rare.
    expect(tuskChance('wildheart_beastmaster')).toBe(1);
    const beastmaster = MOBS.wildheart_beastmaster.loot ?? [];
    expect(beastmaster.some((e) => e.copper === 2500 && e.chance === 1)).toBe(true);
    expect(beastmaster.some((e) => e.itemId === 'fanglords_beastspear' && e.chance === 0.12)).toBe(
      true,
    );
  });

  it('registers the heroic drop table: two roll groups, each summing to exactly 1.0', () => {
    const entries = HEROIC_BOSS_LOOT.wildheart_high_priest;
    expect(entries).toBeDefined();
    // Gear rides exclusive roll groups; the mounts are group-less independent
    // rolls appended after them (the house split, tests/dungeons.test.ts).
    const gear = entries.filter((e) => e.rollGroup !== undefined);
    const groupSum = (group: string) =>
      gear.filter((e) => e.rollGroup === group).reduce((a, e) => a + e.chance, 0);
    expect(groupSum('wildheart_heroic')).toBeCloseTo(1.0, 9);
    expect(groupSum('wildheart_heroic2')).toBeCloseTo(1.0, 9);
    // Every GEAR entry belongs to one of the two groups (no stray chance rolls),
    // and the group names never collide with the base table's 'wildheart_bonus'.
    for (const e of gear) {
      expect(['wildheart_heroic', 'wildheart_heroic2']).toContain(e.rollGroup);
    }
    // Six DISTINCT items across the two groups, the shape every other heroic
    // five-man uses: per-item rates stay at the house 0.33-0.34 (a dup-path
    // re-listing pushed re-listed chests to 0.56-0.66 per kill, above any
    // other heroic item in the game).
    const ids = entries.map((e) => e.itemId);
    expect(new Set(ids).size).toBe(ids.length);
    // Per-item literals, not only group sums: 0.9/0.05/0.05 also sums to 1.0
    // but pays one item far above the house 0.33-0.34 per-item band.
    expect(gear.map((e) => e.chance)).toEqual([0.34, 0.33, 0.33, 0.34, 0.33, 0.33]);
    expect(
      gear.filter((e) => e.itemId === 'greatfang_of_the_basin').map((e) => e.rollGroup),
    ).toEqual(['wildheart_heroic2']);
    // The mounts must stay group-LESS: folding one into a gear group would make
    // it compete with (and at 0.1% effectively erase) a guaranteed epic.
    expect(gear.every((e) => ITEMS[e.itemId!]?.kind !== 'mount')).toBe(true);
  });

  it('carries equal-rate secondary paths to both blue mounts, and to no other mount', () => {
    const mounts = HEROIC_BOSS_LOOT.wildheart_high_priest.filter((e) => e.rollGroup === undefined);
    // The two RARE mounts only. Epic mounts are rift-S exclusive, so a five-man
    // must never become a back door to one; greens belong to the easier pair.
    expect(mounts.map((e) => e.itemId).sort()).toEqual([
      'reins_grag_bear',
      'reins_stalkglider_snail',
    ]);
    // Rate derived from rarity rather than hand-listed, the house pattern: a
    // blue pays 0.1% wherever it drops, so the basin is never a cheaper route
    // to either mount than Ysolei or Korzul.
    for (const e of mounts) {
      const quality = ITEMS[e.itemId!]?.quality;
      expect(quality, `${e.itemId} is a rare-tier mount`).toBe('rare');
      expect(e.chance, `${e.itemId} rate`).toBe(0.001);
    }
    // Rate parity against the mounts' own primary sources, read from the live
    // tables so a retune on either side fails here.
    const rateOn = (boss: string, itemId: string) =>
      HEROIC_BOSS_LOOT[boss].find((e) => e.itemId === itemId)?.chance;
    expect(rateOn('wildheart_high_priest', 'reins_grag_bear')).toBe(
      rateOn('ysolei', 'reins_grag_bear'),
    );
    expect(rateOn('wildheart_high_priest', 'reins_stalkglider_snail')).toBe(
      rateOn('korzul_the_gravewyrm', 'reins_stalkglider_snail'),
    );
  });

  it('registers the basin as a heroic instance: its epic/rare drops mint heroic variants', () => {
    // Epic bases read item level 28 (source 22 + epic 6), the rare 25.
    for (const id of ['wildheart_tuskblade', 'wildheart_hexwood_staff', 'wildheart_fangknife']) {
      const variant = ITEMS[heroicVariantId(id)];
      expect(variant, `heroic variant of ${id}`).toBeDefined();
      expect(variant.heroicOf).toBe(id);
      expect(itemLevel(variant), `${variant.id} ilvl`).toBe(28);
    }
    const rareVariant = ITEMS[heroicVariantId('fanglords_beastspear')];
    expect(rareVariant).toBeDefined();
    expect(itemLevel(rareVariant)).toBe(25);
    // Uncommons never mint variants.
    expect(ITEMS[heroicVariantId('bloodmane_warleggings')]).toBeUndefined();
  });

  // Kills Zulgar with one direct overkill hit and returns the sim, corpse, and
  // killer. Mirrors the killKorzul harness in tests/heroic_loot_flair.test.ts.
  function killZulgar(
    seed: number,
    difficulty: 'normal' | 'heroic',
  ): { sim: Sim; zulgar: Entity; p: Entity } {
    const sim = makeSim(seed);
    const pid = sim.addPlayer('warrior', 'Looter');
    if (difficulty === 'heroic') sim.setDungeonDifficulty('heroic', pid);
    expect(enterDungeon(sim.ctx, 'wildheart_basin', pid)).toBe(true);
    const instance = (sim.instances as { dungeonId: string; mobIds: number[] }[]).find(
      (i) => i.dungeonId === 'wildheart_basin',
    );
    if (!instance) throw new Error('Wildheart instance was not claimed');
    const zulgar = instance.mobIds
      .map((id) => sim.entities.get(id))
      .find((e): e is Entity => e?.templateId === 'wildheart_high_priest');
    if (!zulgar) throw new Error('Zulgar did not spawn');
    const p = sim.entities.get(pid) as Entity;
    p.pos = { x: zulgar.pos.x + 1, y: zulgar.pos.y, z: zulgar.pos.z };
    p.prevPos = { ...p.pos };
    sim.rebucket(p);
    (sim as unknown as { dealDamage: Function }).dealDamage(
      p,
      zulgar,
      zulgar.hp + 100,
      false,
      'physical',
      null,
      'hit',
    );
    expect(zulgar.dead, `seed ${seed}`).toBe(true);
    return { sim, zulgar, p };
  }

  it('pays copper plus exactly one guaranteed uncommon when a party kills Zulgar', () => {
    const trio = new Set([
      'bloodmane_warleggings',
      'vineclaw_stalking_breeches',
      'sunbone_ritual_sarong',
    ]);
    // Several seeds so the pin holds across roll outcomes, not one lucky draw.
    const seen = new Set<string>();
    for (const seed of [3, 8, 11, 42]) {
      const { zulgar } = killZulgar(seed, 'normal');
      expect(zulgar.loot, `seed ${seed} has loot`).toBeTruthy();
      expect(zulgar.loot?.copper, `seed ${seed} copper`).toBeGreaterThan(0);
      const uncommons = (zulgar.loot?.items ?? []).filter((s) => trio.has(s.itemId));
      expect(uncommons, `seed ${seed}: exactly one guaranteed uncommon`).toHaveLength(1);
      seen.add(uncommons[0].itemId);
    }
    // Every trio piece is reachable, not just the count: the seed set must
    // cover all three armor classes.
    expect([...seen].sort()).toEqual([...trio].sort());
  });

  it('pays exactly two DISTINCT heroic epics per heroic Zulgar kill', () => {
    // GEAR ids only: the two mount entries are group-less 0.1% lotteries that
    // no realistic seed set hits, so counting them here would make the
    // reachability assertion below unsatisfiable.
    const heroicIds = new Set(
      HEROIC_BOSS_LOOT.wildheart_high_priest.flatMap((e) =>
        e.itemId && e.rollGroup !== undefined ? [e.itemId] : [],
      ),
    );
    const seen = new Set<string>();
    for (const seed of [3, 8, 11, 42, 97, 123]) {
      const { zulgar } = killZulgar(seed, 'heroic');
      const drops = (zulgar.loot?.items ?? [])
        .map((s) => s.itemId)
        .filter((id) => heroicIds.has(id));
      expect(drops, `seed ${seed}: two heroic epics`).toHaveLength(2);
      expect(new Set(drops).size, `seed ${seed}: the two epics are distinct`).toBe(2);
      for (const id of drops) seen.add(id);
    }
    // All six epics are reachable across the seed set, so no table entry can
    // quietly become dead weight.
    expect([...seen].sort()).toEqual([...heroicIds].sort());
  });

  it("opens the shrine-terrace exit portal on Zulgar's death, on both difficulties", () => {
    for (const difficulty of ['normal', 'heroic'] as const) {
      const { sim } = killZulgar(31, difficulty);
      const inst = (
        sim.instances as { dungeonId: string; bossExitId: number | null; objectIds: number[] }[]
      ).find((i) => i.dungeonId === 'wildheart_basin');
      if (!inst) throw new Error('instance missing');
      expect(inst.bossExitId, difficulty).not.toBeNull();
      const exit = sim.entities.get(inst.bossExitId as number) as Entity;
      expect(exit?.templateId, difficulty).toBe('dungeon_exit');
      // At the authored terrace spot, clear of the pyramid collider disc.
      const origin = instanceOrigin(DUNGEONS.wildheart_basin.index, 0);
      expect(exit.pos.x - origin.x).toBeCloseTo(0, 5);
      expect(exit.pos.z - origin.z).toBeCloseTo(222, 5);
      // The claim owns it: freeInstance drops it with objectIds.
      expect(inst.objectIds).toContain(inst.bossExitId);
    }
    // No portal before the boss dies: a fresh claim spawns none.
    const sim = makeSim(5);
    const pid = sim.addPlayer('warrior', 'Walker');
    expect(enterDungeon(sim.ctx, 'wildheart_basin', pid)).toBe(true);
    const inst = (sim.instances as { dungeonId: string; bossExitId: number | null }[]).find(
      (i) => i.dungeonId === 'wildheart_basin',
    );
    expect(inst?.bossExitId).toBeNull();
  });

  it('keeps the portal shut for trash kills and lets a walk into it leave the dungeon', () => {
    // A non-final-boss death inside the claim must not open the exit: without
    // the finalBossId guard a trash pull would let a group skip the run.
    const sim = makeSim(17);
    const pid = sim.addPlayer('warrior', 'Trasher');
    expect(enterDungeon(sim.ctx, 'wildheart_basin', pid)).toBe(true);
    const inst = (
      sim.instances as { dungeonId: string; bossExitId: number | null; mobIds: number[] }[]
    ).find((i) => i.dungeonId === 'wildheart_basin');
    if (!inst) throw new Error('instance missing');
    const trash = inst.mobIds
      .map((id) => sim.entities.get(id))
      .find((e): e is Entity => e?.templateId === 'wildheart_stalker');
    if (!trash) throw new Error('no stalker spawned');
    const p = sim.entities.get(pid) as Entity;
    (sim as unknown as { dealDamage: Function }).dealDamage(
      p,
      trash,
      trash.hp + 100,
      false,
      'physical',
      null,
      'hit',
    );
    expect(trash.dead).toBe(true);
    expect(inst.bossExitId).toBeNull();

    // And once earned, the portal is USABLE: walking into it rides the same
    // door trigger as the entrance exit and drops the player back outside.
    const cleared = killZulgar(31, 'normal');
    const clearedInst = (
      cleared.sim.instances as { dungeonId: string; bossExitId: number | null }[]
    ).find((i) => i.dungeonId === 'wildheart_basin');
    const portal = cleared.sim.entities.get(clearedInst?.bossExitId as number) as Entity;
    const walker = cleared.p;
    walker.pos = { ...portal.pos };
    walker.prevPos = { ...walker.pos };
    cleared.sim.rebucket(walker);
    updateDoorTriggers(cleared.sim.ctx, walker);
    expect(walker.pos.x, 'the walker left the instance band').toBeLessThan(DUNGEON_X_THRESHOLD);
  });

  it('keeps the jaguar-gate colliders inscribed: the arch and pylon flanks stay walkable', () => {
    const gate = WILDHEART_FIELD_COLLIDER_SPECS.filter(
      (spec) => spec.kind === 'wildheart_jaguar_gate',
    );
    // Six chained posts (three per pylon): solid along each pylon's depth, but
    // never wider than the visible pillar. The old two-fat-circles version put
    // a ~4.7yd invisible ring around each ~2.5yd post and blocked the open
    // grass beside the gate (live-playtest "invisible wall").
    expect(gate).toHaveLength(6);
    for (const post of gate) expect(post.r).toBeLessThanOrEqual(2.7);
    const origin = instanceOrigin(DUNGEONS.wildheart_basin.index, 0);
    // Beside the east pylon (just past the pillar's push zone: post r 2.64 +
    // body 0.5, the old fat circles blocked a player-sized body out past 19)
    // and the arch center: a 1.2yd step in every direction must resolve
    // without a collider push-back.
    for (const [sx, sz] of [
      [18.5, 17],
      [0, 16],
    ] as const) {
      for (let a = 0; a < 8; a++) {
        const angle = (a / 8) * Math.PI * 2;
        const fx = origin.x + sx + Math.sin(angle) * 1.2;
        const fz = origin.z + sz + Math.cos(angle) * 1.2;
        const resolved = resolvePosition(1, fx, fz, 0.5);
        expect(Math.hypot(resolved.x - fx, resolved.z - fz), `(${sx},${sz}) dir ${a}`).toBeLessThan(
          0.3,
        );
      }
    }
  });
});
