import { describe, expect, it } from 'vitest';
import { bagCapacity } from '../src/sim/bags';
import { HEROIC_MARK_ITEM_ID } from '../src/sim/content/dungeon_difficulty';
import { PROCEDURAL_LEGENDARY_POWERS } from '../src/sim/content/procedural_legendary_powers';
import { PROCEDURAL_BASE_POOLS } from '../src/sim/content/procedural_loot';
import {
  DEATHLESS_FRAGMENT_ITEM_ID,
  NYTHRAXIS_AUTHORED_FORGE_OFFERS,
  NYTHRAXIS_FORGE_COSTS,
} from '../src/sim/content/procedural_raid_loot';
import { ITEMS, NPCS } from '../src/sim/data';
import { canEquipItem } from '../src/sim/equipment_rules';
import {
  forgeNythraxisReward,
  resolveNythraxisForgeOffer,
  tuneNythraxisLegendary,
} from '../src/sim/instances/nythraxis_forge';
import { heroicRewardWindowToken } from '../src/sim/instances/dungeons';
import { Sim } from '../src/sim/sim';
import { ALL_CLASSES, type Entity, type PlayerClass } from '../src/sim/types';
import { resolveProceduralItemIcon } from '../src/ui/procedural_item_art';

type AnySim = Sim & Record<string, any>;
type AnyEntity = Entity & Record<string, any>;

function setup(cls: PlayerClass = 'warrior') {
  const sim = new Sim({ seed: 70_031, playerClass: cls, noPlayer: true }) as AnySim;
  const pid = sim.addPlayer(cls, `Forge${cls}`);
  const p = sim.entities.get(pid) as AnyEntity;
  const quartermaster = NPCS.heroic_quartermaster.pos;
  p.pos = { x: quartermaster.x + 1, y: p.pos.y, z: quartermaster.z };
  p.prevPos = { ...p.pos };
  sim.rebucket(p);
  return { sim, pid, p, meta: sim.players.get(pid)! };
}

function addCurrency(sim: AnySim, pid: number, fragments: number, marks: number): void {
  sim.addItem(DEATHLESS_FRAGMENT_ITEM_ID, fragments, pid);
  sim.addItem(HEROIC_MARK_ITEM_ID, marks, pid);
  sim.drainEvents();
}

function unlockHeroic(sim: AnySim, pid: number): void {
  const meta = sim.players.get(pid)!;
  const until = sim.ctx.raidResetMs(sim.ctx.lockoutNowMs());
  meta.raidLockouts.set('nythraxis_boss_arena:heroic', until);
  meta.heroicDaily = {
    date: heroicRewardWindowToken(until),
    marked: new Set(['nythraxis_boss_arena']),
  };
}

function proceduralSlots(sim: AnySim, pid: number, itemId?: string) {
  return sim.players
    .get(pid)!
    .inventory.filter((slot) => (!itemId || slot.itemId === itemId) && slot.instance?.procedural);
}

function errorTexts(sim: AnySim): string[] {
  return sim
    .drainEvents()
    .flatMap((event: any) => (event.type === 'error' ? [event.text as string] : []));
}

describe('Nythraxis forge offer authority', () => {
  it('parses only real base, signature and authored offers with pinned costs', () => {
    expect(resolveNythraxisForgeOffer('normal:iron_broadsword')).toMatchObject({
      kind: 'normal_procedural_epic',
      baseId: 'iron_broadsword',
      ...NYTHRAXIS_FORGE_COSTS.normalProceduralEpic,
      heroic: false,
    });
    expect(resolveNythraxisForgeOffer('heroic:iron_broadsword')).toMatchObject({
      kind: 'heroic_procedural_epic',
      ...NYTHRAXIS_FORGE_COSTS.heroicProceduralEpic,
      heroic: true,
    });
    expect(resolveNythraxisForgeOffer('signature:dawnward_signet:gravecaller_ring')).toMatchObject({
      kind: 'raid_forged_signature',
      powerId: 'dawnward_signet',
      baseId: 'gravecaller_ring',
      ...NYTHRAXIS_FORGE_COSTS.raidForgedSignature,
    });
    expect(resolveNythraxisForgeOffer('authored:heroic_deathless_heartwood')).toMatchObject({
      kind: 'heroic_authored_legendary',
      itemId: 'heroic_deathless_heartwood',
    });
    expect(resolveNythraxisForgeOffer('normal:no_such_base')).toBeNull();
    expect(resolveNythraxisForgeOffer('signature:dawnward_signet:iron_broadsword')).toBeNull();
    expect(
      resolveNythraxisForgeOffer('signature:crown_last_pyre:gravecaller_cloth_hood'),
    ).toBeNull();
    expect(resolveNythraxisForgeOffer('normal:iron_broadsword:injected')).toBeNull();
  });

  it('forges chosen-base Normal Epics at item level 28 with independent rolled copies', () => {
    const { sim, pid } = setup('warrior');
    addCurrency(sim, pid, 40, 0);
    forgeNythraxisReward(sim.ctx, 'normal:iron_broadsword', pid);

    forgeNythraxisReward(sim.ctx, 'normal:iron_broadsword', pid);

    const slots = proceduralSlots(sim, pid, 'iron_broadsword');
    expect(slots).toHaveLength(2);
    for (const slot of slots) {
      expect(slot.instance?.boundTo).toBe(pid);
      expect(slot.instance?.procedural).toMatchObject({
        baseId: 'iron_broadsword',
        rarity: 'epic',
        itemLevel: 28,
        dropContext: {
          source: 'raid',
          sourceTemplateId: 'nythraxis_scourge_of_thornpeak',
        },
      });
      expect(slot.instance?.procedural?.dropContext?.sourceTags).toEqual(
        expect.arrayContaining(['raid', 'boss', 'forge', 'normal']),
      );
    }
    expect(slots[0].instance?.procedural?.uid).not.toBe(slots[1].instance?.procedural?.uid);
    expect(slots[0].instance?.procedural?.affixes).not.toEqual(
      slots[1].instance?.procedural?.affixes,
    );
    expect(sim.countItem(DEATHLESS_FRAGMENT_ITEM_ID, pid)).toBe(0);
  });

  it('resolves every one of the 34 raid bases at both procedural tiers', () => {
    const baseIds = PROCEDURAL_BASE_POOLS.nythraxis_raid.baseIds;
    expect(baseIds).toHaveLength(34);
    expect(new Set(baseIds).size).toBe(34);

    for (const baseId of baseIds) {
      expect(ITEMS[baseId], baseId).toBeTruthy();
      expect(
        ALL_CLASSES.some((cls) => canEquipItem(cls, ITEMS[baseId])),
        baseId,
      ).toBe(true);
      expect(resolveNythraxisForgeOffer(`normal:${baseId}`), baseId).toMatchObject({
        kind: 'normal_procedural_epic',
        itemId: baseId,
        baseId,
        ...NYTHRAXIS_FORGE_COSTS.normalProceduralEpic,
        heroic: false,
      });
      expect(resolveNythraxisForgeOffer(`heroic:${baseId}`), baseId).toMatchObject({
        kind: 'heroic_procedural_epic',
        itemId: baseId,
        baseId,
        ...NYTHRAXIS_FORGE_COSTS.heroicProceduralEpic,
        heroic: true,
      });
    }
  });

  it('pins every authored offer and only the two compatible Nythraxis signatures', () => {
    expect(NYTHRAXIS_AUTHORED_FORGE_OFFERS).toHaveLength(5);
    for (const authored of NYTHRAXIS_AUTHORED_FORGE_OFFERS) {
      const definition = ITEMS[authored.itemId];
      expect(definition, authored.offerId).toBeTruthy();
      expect(
        ALL_CLASSES.some((cls) => canEquipItem(cls, definition)),
        authored.offerId,
      ).toBe(true);
      expect(resolveNythraxisForgeOffer(authored.offerId), authored.offerId).toMatchObject({
        itemId: authored.itemId,
        kind:
          authored.quality === 'legendary' ? 'heroic_authored_legendary' : 'heroic_authored_epic',
        heroic: true,
      });
    }

    const signatures = [
      { powerId: 'dawnward_signet', baseId: 'gravecaller_ring', requiredClass: 'paladin' },
      { powerId: 'feral_moonclasp', baseId: 'gravecaller_pendant', requiredClass: 'druid' },
    ] as const;
    for (const signature of signatures) {
      expect(PROCEDURAL_LEGENDARY_POWERS[signature.powerId]).toMatchObject({
        requiredClass: signature.requiredClass,
        compatibleBaseIds: [signature.baseId],
      });
      for (const baseId of PROCEDURAL_BASE_POOLS.nythraxis_raid.baseIds) {
        const resolved = resolveNythraxisForgeOffer(`signature:${signature.powerId}:${baseId}`);
        if (baseId !== signature.baseId) {
          expect(resolved, `${signature.powerId}:${baseId}`).toBeNull();
          continue;
        }
        expect(resolved).toMatchObject({
          kind: 'raid_forged_signature',
          baseId,
          powerId: signature.powerId,
          ...NYTHRAXIS_FORGE_COSTS.raidForgedSignature,
          heroic: true,
        });
      }
    }
  });

  it('requires a current Heroic Nythraxis clear before forging item-level 32 Heroic Epics', () => {
    const { sim, pid } = setup('warrior');
    const cost = NYTHRAXIS_FORGE_COSTS.heroicProceduralEpic;
    addCurrency(sim, pid, cost.fragments, cost.heroicMarks);
    forgeNythraxisReward(sim.ctx, 'heroic:iron_broadsword', pid);
    expect(proceduralSlots(sim, pid)).toHaveLength(0);
    expect(errorTexts(sim)).toContain('Defeat Heroic Nythraxis in the current raid reset first.');
    expect(sim.countItem(DEATHLESS_FRAGMENT_ITEM_ID, pid)).toBe(cost.fragments);
    expect(sim.countItem(HEROIC_MARK_ITEM_ID, pid)).toBe(cost.heroicMarks);

    const meta = sim.players.get(pid)!;
    meta.raidLockouts.set(
      'nythraxis_boss_arena:heroic',
      sim.ctx.raidResetMs(sim.ctx.lockoutNowMs()),
    );
    forgeNythraxisReward(sim.ctx, 'heroic:iron_broadsword', pid);
    expect(proceduralSlots(sim, pid)).toHaveLength(0);
    expect(sim.countItem(DEATHLESS_FRAGMENT_ITEM_ID, pid)).toBe(cost.fragments);
    expect(errorTexts(sim)).toContain('Defeat Heroic Nythraxis in the current raid reset first.');

    unlockHeroic(sim, pid);
    forgeNythraxisReward(sim.ctx, 'heroic:iron_broadsword', pid);
    expect(proceduralSlots(sim, pid)[0].instance?.procedural).toMatchObject({
      rarity: 'epic',
      itemLevel: 32,
    });
  });

  it('forges an exact Heroic signature identity but keeps its stats variable', () => {
    const { sim, pid } = setup('paladin');
    unlockHeroic(sim, pid);
    const cost = NYTHRAXIS_FORGE_COSTS.raidForgedSignature;
    addCurrency(sim, pid, cost.fragments, cost.heroicMarks);
    forgeNythraxisReward(sim.ctx, 'signature:dawnward_signet:gravecaller_ring', pid);

    const slot = proceduralSlots(sim, pid, 'gravecaller_ring')[0];
    expect(slot.instance?.boundTo).toBe(pid);
    expect(slot.instance?.procedural).toMatchObject({
      rarity: 'legendary',
      itemLevel: 36,
      legendaryPowerId: 'dawnward_signet',
      raidForged: true,
    });
    expect(slot.instance?.procedural?.legendaryRolls?.potencyPct).toBeGreaterThanOrEqual(19);
    expect(resolveProceduralItemIcon('gravecaller_ring', slot.instance)?.url).toMatch(
      /dawnward_signet\.r1\.ascendant\.webp$/,
    );
  });

  it('rejects a hostile off-class exact-signature command without throwing or spending', () => {
    const { sim, pid } = setup('warrior');
    unlockHeroic(sim, pid);
    const cost = NYTHRAXIS_FORGE_COSTS.raidForgedSignature;
    addCurrency(sim, pid, cost.fragments, cost.heroicMarks);

    expect(() =>
      forgeNythraxisReward(sim.ctx, 'signature:dawnward_signet:gravecaller_ring', pid),
    ).not.toThrow();
    expect(proceduralSlots(sim, pid)).toHaveLength(0);
    expect(sim.countItem(DEATHLESS_FRAGMENT_ITEM_ID, pid)).toBe(cost.fragments);
    expect(sim.countItem(HEROIC_MARK_ITEM_ID, pid)).toBe(cost.heroicMarks);
    expect(errorTexts(sim)).toContain('Your class cannot use that reward.');
  });

  it('binds authored deterministic rewards and rejects class-incompatible choices', () => {
    const warrior = setup('warrior');
    unlockHeroic(warrior.sim, warrior.pid);
    const cost = NYTHRAXIS_FORGE_COSTS.heroicAuthoredLegendary;
    addCurrency(warrior.sim, warrior.pid, cost.fragments, cost.heroicMarks);
    forgeNythraxisReward(warrior.sim.ctx, 'authored:heroic_deathless_heartwood', warrior.pid);
    expect(warrior.sim.countItem('heroic_deathless_heartwood', warrior.pid)).toBe(0);
    expect(errorTexts(warrior.sim)).toContain('Your class cannot use that reward.');
    expect(warrior.sim.countItem(DEATHLESS_FRAGMENT_ITEM_ID, warrior.pid)).toBe(cost.fragments);

    const paladin = setup('paladin');
    unlockHeroic(paladin.sim, paladin.pid);
    addCurrency(paladin.sim, paladin.pid, cost.fragments, cost.heroicMarks);
    forgeNythraxisReward(paladin.sim.ctx, 'authored:heroic_deathless_heartwood', paladin.pid);
    const slot = paladin.meta.inventory.find(
      (item) => item.itemId === 'heroic_deathless_heartwood',
    );
    expect(slot?.instance?.boundTo).toBe(paladin.pid);
  });

  it('keeps currency atomic across invalid, too-far, dead, unaffordable and full-bag attempts', () => {
    const { sim, pid, p } = setup('warrior');
    addCurrency(sim, pid, 20, 0);
    forgeNythraxisReward(sim.ctx, 'normal:no_such_base', pid);
    expect(sim.countItem(DEATHLESS_FRAGMENT_ITEM_ID, pid)).toBe(20);

    p.pos.x += 1_000;
    sim.rebucket(p);
    forgeNythraxisReward(sim.ctx, 'normal:iron_broadsword', pid);
    expect(sim.countItem(DEATHLESS_FRAGMENT_ITEM_ID, pid)).toBe(20);
    const pos = NPCS.heroic_quartermaster.pos;
    p.pos = { x: pos.x + 1, y: p.pos.y, z: pos.z };
    sim.rebucket(p);
    p.dead = true;
    forgeNythraxisReward(sim.ctx, 'normal:iron_broadsword', pid);
    p.dead = false;
    expect(sim.countItem(DEATHLESS_FRAGMENT_ITEM_ID, pid)).toBe(20);

    sim.removeItem(DEATHLESS_FRAGMENT_ITEM_ID, 1, pid);
    forgeNythraxisReward(sim.ctx, 'normal:iron_broadsword', pid);
    expect(sim.countItem(DEATHLESS_FRAGMENT_ITEM_ID, pid)).toBe(19);
    sim.addItem(DEATHLESS_FRAGMENT_ITEM_ID, 2, pid);
    for (let i = 0; i < 40 && sim.canAddItem('worn_sword', 1, pid); i++)
      sim.addItem('worn_sword', 1, pid);
    expect(sim.canAddItem('iron_broadsword', 1, pid)).toBe(false);
    forgeNythraxisReward(sim.ctx, 'normal:iron_broadsword', pid);
    expect(sim.countItem(DEATHLESS_FRAGMENT_ITEM_ID, pid)).toBe(21);
    expect(proceduralSlots(sim, pid)).toHaveLength(0);
  });

  it('allows a full-bag forge when spending the exact currency frees room for the reward', () => {
    const { sim, pid, meta } = setup('warrior');
    const cost = NYTHRAXIS_FORGE_COSTS.normalProceduralEpic;
    addCurrency(sim, pid, cost.fragments, cost.heroicMarks);
    while (sim.canAddItem('worn_sword', 1, pid)) sim.addItem('worn_sword', 1, pid);

    expect(meta.inventory).toHaveLength(bagCapacity(meta.bags));
    expect(sim.canAddItem('iron_broadsword', 1, pid)).toBe(false);

    forgeNythraxisReward(sim.ctx, 'normal:iron_broadsword', pid);

    expect(proceduralSlots(sim, pid, 'iron_broadsword')).toHaveLength(1);
    expect(sim.countItem(DEATHLESS_FRAGMENT_ITEM_ID, pid)).toBe(0);
    expect(meta.inventory.length).toBeLessThanOrEqual(bagCapacity(meta.bags));
  });

  it('does not accept instanced lookalikes as spendable forge currency', () => {
    const { sim, pid } = setup('warrior');
    const cost = NYTHRAXIS_FORGE_COSTS.normalProceduralEpic;
    sim.addItemInstance(
      DEATHLESS_FRAGMENT_ITEM_ID,
      { signer: 'not-fungible' },
      pid,
      cost.fragments,
    );
    sim.drainEvents();

    forgeNythraxisReward(sim.ctx, 'normal:iron_broadsword', pid);

    expect(proceduralSlots(sim, pid)).toHaveLength(0);
    expect(sim.countFungibleItem(DEATHLESS_FRAGMENT_ITEM_ID, pid)).toBe(0);
    expect(sim.countItem(DEATHLESS_FRAGMENT_ITEM_ID, pid)).toBe(cost.fragments);
    expect(errorTexts(sim)).toContain('You need 20 Deathless Fragments and 0 Heroic Marks.');
  });
});

describe('exact-copy Nythraxis Legendary tuning', () => {
  it('mints a new UID, never lowers power, and preserves every locked identity field', () => {
    const { sim, pid, meta } = setup('paladin');
    unlockHeroic(sim, pid);
    const forgeCost = NYTHRAXIS_FORGE_COSTS.raidForgedSignature;
    addCurrency(sim, pid, forgeCost.fragments, forgeCost.heroicMarks);
    forgeNythraxisReward(sim.ctx, 'signature:dawnward_signet:gravecaller_ring', pid);
    const beforeSlot = proceduralSlots(sim, pid, 'gravecaller_ring')[0];
    beforeSlot.instance!.enchant = 'greater_intellect';
    const before = structuredClone(beforeSlot.instance!);
    const oldUid = before.procedural!.uid;
    const tuneCost = NYTHRAXIS_FORGE_COSTS.legendaryPowerTune;
    addCurrency(sim, pid, tuneCost.fragments, tuneCost.heroicMarks);

    tuneNythraxisLegendary(sim.ctx, oldUid, pid);

    const after = proceduralSlots(sim, pid, 'gravecaller_ring')[0].instance!;
    expect(after.procedural!.uid).not.toBe(oldUid);
    expect(meta.inventory.some((slot) => slot.instance?.procedural?.uid === oldUid)).toBe(false);
    expect(after.enchant).toBe(before.enchant);
    expect(after.boundTo).toBe(before.boundTo);
    expect(after.procedural).toMatchObject({
      baseId: before.procedural!.baseId,
      rarity: before.procedural!.rarity,
      itemLevel: before.procedural!.itemLevel,
      legendaryPowerId: before.procedural!.legendaryPowerId,
      raidForged: true,
      reforgeCount: 1,
      affixes: before.procedural!.affixes,
      generatedName: before.procedural!.generatedName,
    });
    expect(after.procedural!.legendaryRolls!.potencyPct).toBeGreaterThanOrEqual(
      before.procedural!.legendaryRolls!.potencyPct,
    );
    expect(sim.countItem(DEATHLESS_FRAGMENT_ITEM_ID, pid)).toBe(0);
    expect(sim.countItem(HEROIC_MARK_ITEM_ID, pid)).toBe(0);
  });

  it('keeps the exact target stable when exhausted currency stacks shift inventory indices', () => {
    const { sim, pid, meta } = setup('paladin');
    unlockHeroic(sim, pid);
    const forgeCost = NYTHRAXIS_FORGE_COSTS.raidForgedSignature;
    addCurrency(sim, pid, forgeCost.fragments, forgeCost.heroicMarks);
    forgeNythraxisReward(sim.ctx, 'signature:dawnward_signet:gravecaller_ring', pid);
    const target = proceduralSlots(sim, pid, 'gravecaller_ring')[0];
    const oldUid = target.instance!.procedural!.uid;
    const tuneCost = NYTHRAXIS_FORGE_COSTS.legendaryPowerTune;
    addCurrency(sim, pid, tuneCost.fragments, tuneCost.heroicMarks);
    sim.addItem('worn_sword', 1, pid);

    const currencySlots = meta.inventory.filter(
      (slot) => slot.itemId === DEATHLESS_FRAGMENT_ITEM_ID || slot.itemId === HEROIC_MARK_ITEM_ID,
    );
    const sentinel = meta.inventory.find((slot) => slot.itemId === 'worn_sword')!;
    const remaining = meta.inventory.filter(
      (slot) => !currencySlots.includes(slot) && slot !== sentinel && slot !== target,
    );
    meta.inventory.splice(
      0,
      meta.inventory.length,
      ...currencySlots,
      ...remaining,
      sentinel,
      target,
    );

    expect(() => tuneNythraxisLegendary(sim.ctx, oldUid, pid)).not.toThrow();

    const shiftedTargetIndex = meta.inventory.indexOf(target);
    expect(shiftedTargetIndex).toBeGreaterThan(0);
    expect(meta.inventory).toContain(sentinel);
    expect(meta.inventory[shiftedTargetIndex - 1]).toBe(sentinel);
    expect(sentinel.itemId).toBe('worn_sword');
    expect(target.instance?.procedural?.uid).not.toBe(oldUid);
    expect(target.instance?.procedural?.reforgeCount).toBe(1);
    expect(sim.countItem(DEATHLESS_FRAGMENT_ITEM_ID, pid)).toBe(0);
    expect(sim.countItem(HEROIC_MARK_ITEM_ID, pid)).toBe(0);
  });

  it('targets one exact copy and rejects stale, spoofed, or retired power identities atomically', () => {
    const { sim, pid } = setup('paladin');
    unlockHeroic(sim, pid);
    const forgeCost = NYTHRAXIS_FORGE_COSTS.raidForgedSignature;
    addCurrency(sim, pid, forgeCost.fragments * 2, forgeCost.heroicMarks * 2);
    forgeNythraxisReward(sim.ctx, 'signature:dawnward_signet:gravecaller_ring', pid);
    forgeNythraxisReward(sim.ctx, 'signature:dawnward_signet:gravecaller_ring', pid);
    const [first, second] = proceduralSlots(sim, pid, 'gravecaller_ring');
    const firstUid = first.instance!.procedural!.uid;
    const secondUid = second.instance!.procedural!.uid;
    const secondBefore = structuredClone(second.instance);
    const tuneCost = NYTHRAXIS_FORGE_COSTS.legendaryPowerTune;
    addCurrency(sim, pid, tuneCost.fragments * 2, tuneCost.heroicMarks * 2);

    tuneNythraxisLegendary(sim.ctx, firstUid, pid);
    expect(
      proceduralSlots(sim, pid).find((slot) => slot.instance?.procedural?.uid === secondUid)
        ?.instance,
    ).toEqual(secondBefore);
    expect(sim.countItem(DEATHLESS_FRAGMENT_ITEM_ID, pid)).toBe(tuneCost.fragments);
    expect(sim.countItem(HEROIC_MARK_ITEM_ID, pid)).toBe(tuneCost.heroicMarks);

    tuneNythraxisLegendary(sim.ctx, firstUid, pid);
    tuneNythraxisLegendary(sim.ctx, 'pi1:spoofed:999999', pid);
    expect(sim.countItem(DEATHLESS_FRAGMENT_ITEM_ID, pid)).toBe(tuneCost.fragments);
    expect(sim.countItem(HEROIC_MARK_ITEM_ID, pid)).toBe(tuneCost.heroicMarks);
    const uidErrors = errorTexts(sim);
    expect(uidErrors).toContain('That exact Nythraxis Legendary is no longer in your bags.');

    second.instance!.procedural!.legendaryPowerId = 'retired_power_definition';
    tuneNythraxisLegendary(sim.ctx, secondUid, pid);
    expect(sim.countItem(DEATHLESS_FRAGMENT_ITEM_ID, pid)).toBe(tuneCost.fragments);
    expect(sim.countItem(HEROIC_MARK_ITEM_ID, pid)).toBe(tuneCost.heroicMarks);
    expect(
      proceduralSlots(sim, pid).some((slot) => slot.instance?.procedural?.uid === secondUid),
    ).toBe(true);
    expect(errorTexts(sim)).toContain('Your class cannot tune that Legendary power.');
  });

  it('rejects an ambiguous duplicate UID without spending or mutating either copy', () => {
    const { sim, pid, meta } = setup('paladin');
    unlockHeroic(sim, pid);
    const forgeCost = NYTHRAXIS_FORGE_COSTS.raidForgedSignature;
    addCurrency(sim, pid, forgeCost.fragments, forgeCost.heroicMarks);
    forgeNythraxisReward(sim.ctx, 'signature:dawnward_signet:gravecaller_ring', pid);
    const target = proceduralSlots(sim, pid, 'gravecaller_ring')[0];
    const uid = target.instance!.procedural!.uid;
    meta.inventory.push(structuredClone(target));
    const before = structuredClone(meta.inventory);
    const tuneCost = NYTHRAXIS_FORGE_COSTS.legendaryPowerTune;
    addCurrency(sim, pid, tuneCost.fragments, tuneCost.heroicMarks);

    tuneNythraxisLegendary(sim.ctx, uid, pid);

    expect(meta.inventory.slice(0, before.length)).toEqual(before);
    expect(sim.countItem(DEATHLESS_FRAGMENT_ITEM_ID, pid)).toBe(tuneCost.fragments);
    expect(sim.countItem(HEROIC_MARK_ITEM_ID, pid)).toBe(tuneCost.heroicMarks);
    expect(errorTexts(sim)).toContain('That exact Nythraxis Legendary is no longer in your bags.');
  });

  it('rejects a colliding replacement UID before spending tuning currency', () => {
    const { sim, pid, meta } = setup('paladin');
    unlockHeroic(sim, pid);
    const forgeCost = NYTHRAXIS_FORGE_COSTS.raidForgedSignature;
    addCurrency(sim, pid, forgeCost.fragments * 2, forgeCost.heroicMarks * 2);
    forgeNythraxisReward(sim.ctx, 'signature:dawnward_signet:gravecaller_ring', pid);
    forgeNythraxisReward(sim.ctx, 'signature:dawnward_signet:gravecaller_ring', pid);
    const [target, collision] = proceduralSlots(sim, pid, 'gravecaller_ring');
    const before = structuredClone(target.instance);
    const collisionUid = collision.instance!.procedural!.uid;
    const tuneCost = NYTHRAXIS_FORGE_COSTS.legendaryPowerTune;
    addCurrency(sim, pid, tuneCost.fragments, tuneCost.heroicMarks);
    sim.ctx.allocateProceduralItemUid = () => collisionUid;

    expect(() =>
      tuneNythraxisLegendary(sim.ctx, target.instance!.procedural!.uid, pid),
    ).toThrow(/Duplicate procedural item UID/);

    expect(target.instance).toEqual(before);
    expect(meta.inventory).toContain(collision);
    expect(sim.countItem(DEATHLESS_FRAGMENT_ITEM_ID, pid)).toBe(tuneCost.fragments);
    expect(sim.countItem(HEROIC_MARK_ITEM_ID, pid)).toBe(tuneCost.heroicMarks);
  });
});
