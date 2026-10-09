// The tracked copy's lineage through the in-place changes (src/sim/
// item_tracking.ts recordTrackedChange, docs/design/item-tracking.md): a
// Perfecting attempt, the legendary promotion, a Perfecting swap, an enchant
// (worn, bagged, replace, the Lucent Infusion included), a Rift Forge upgrade
// or socket and a Maker's Bond unbind each change the copy IN PLACE, so the
// copy keeps its guid and the sim emits one `modify` row naming the action.
// A disenchant ends the copy, so it writes a `consume` row, and its victim
// walk still spares a Perfected copy now that no epic copy is payload-free.
// Every case drives the real command path on a real Sim and reads the
// server-only itemTracked event the item ledger mirrors.
import { describe, expect, it } from 'vitest';
import { STATIONS } from '../src/sim/content/professions';
import { RIFT_ESSENCE_ITEM_ID, RIFT_GEM_IDS } from '../src/sim/content/rift/items';
import { isPlainCopy } from '../src/sim/item_plain_copy';
import { isItemGuid } from '../src/sim/item_provenance';
import { unbindItem } from '../src/sim/professions/commission';
import {
  consumePreferredDisenchantVictim,
  resolveApplyEnchant,
  resolveDisenchant,
} from '../src/sim/professions/enchanting';
import {
  PERFECTING_ATTEMPT_COST,
  PERFECTING_RANKS,
  PERFECTING_SKILL_REQ,
} from '../src/sim/professions/perfecting';
import { capturePerfectItemRef } from '../src/sim/professions/perfecting_copy';
import { swapPerfectingRanks } from '../src/sim/professions/perfecting_swap';
import { createRiftGearInstance } from '../src/sim/rift/progression';
import { type PlayerMeta, Sim } from '../src/sim/sim';
import type { Entity, InvSlot, ItemInstancePayload, SimEvent } from '../src/sim/types';
import { moveToRiftForge } from './helpers/rift_forge';
import { EMPTY_TEST_WORLD } from './sim_shared';

type ItemTrackedEvent = Extract<SimEvent, { type: 'itemTracked' }>;

const APEX_NECK = 'wyrmfall_pendant'; // epic apex jewelry (jewelcrafting)
const DEED = 'deed_of_making';
const CHEST_ITEM = 'sunspun_vestments'; // an epic chest piece
const LUCENT_STAMINA = 'enchant_chest_lucent_stamina';
const INFUSION = 'enchant_lucent_infusion'; // requiresPerfected
const SWAP_CHEST = 'crucible_str_mail_chest';
const SWAP_WAIST = 'crucible_str_mail_waist';
const EPIC_WEAPON = 'duskforged_warblade';

function world(seed: number): { sim: Sim; pid: number; meta: PlayerMeta; e: Entity } {
  const sim = new Sim({ seed, playerClass: 'warrior', autoEquip: false, world: EMPTY_TEST_WORLD });
  const pid = sim.playerId;
  return {
    sim,
    pid,
    meta: sim.players.get(pid) as PlayerMeta,
    e: sim.entities.get(pid) as Entity,
  };
}

function tracked(sim: Sim): ItemTrackedEvent[] {
  return (sim.drainEvents() as SimEvent[]).filter(
    (ev): ev is ItemTrackedEvent => ev.type === 'itemTracked',
  );
}

/** The one copy of `itemId` in the bags (a tracked def is one per slot). */
function onlySlot(meta: PlayerMeta, itemId: string): InvSlot {
  const slots = meta.inventory.filter((s) => s.itemId === itemId);
  expect(slots, `exactly one ${itemId} held`).toHaveLength(1);
  return slots[0];
}

function guidOf(payload: ItemInstancePayload | undefined): string {
  const guid = payload?.guid;
  expect(isItemGuid(guid), 'the copy is tracked').toBe(true);
  return guid as string;
}

/** Force every rng draw to `value` and count the draws (the perfecting suite's
 *  idiom); nothing here ticks, so every draw counted is the action's own. */
function forceRoll(sim: Sim, value: number): () => number {
  let draws = 0;
  (sim.rng as { next: () => number }).next = () => {
    draws += 1;
    return value;
  };
  return () => draws;
}

function perfecter(seed: number): ReturnType<typeof world> {
  const w = world(seed);
  w.meta.craftSkills.jewelcrafting = PERFECTING_SKILL_REQ;
  for (const c of PERFECTING_ATTEMPT_COST) w.sim.addItem(c.itemId, 8, w.pid);
  return w;
}

function enchanter(seed: number): ReturnType<typeof world> {
  const w = world(seed);
  w.meta.craftSkills.enchanting = 125;
  w.sim.addItem('lucent_reagent', 10, w.pid);
  w.sim.addItem('arcane_shard', 10, w.pid);
  w.sim.addItem('arcane_essence', 10, w.pid);
  return w;
}

describe('Perfecting: every attempt that changes the copy is a modify row', () => {
  it('the bind and each rank gained keep the guid and name the rank; a later failure writes nothing', () => {
    const { sim, pid, meta } = perfecter(301);
    sim.addItem(APEX_NECK, 1, pid);
    const guid = guidOf(onlySlot(meta, APEX_NECK).instance);
    const ref = { bag: meta.inventory.findIndex((s) => s.itemId === APEX_NECK), itemId: APEX_NECK };
    sim.drainEvents();

    // A first attempt that FAILS still binds the copy: that is a change.
    const fail = forceRoll(sim, 0.99);
    sim.perfectItemAs(pid, ref);
    expect(fail(), 'the ledger row adds no draw').toBe(1);
    expect(tracked(sim)).toEqual([
      expect.objectContaining({
        kind: 'modify',
        guid,
        itemId: APEX_NECK,
        source: 'perfecting',
        detail: 'rank 0',
      }),
    ]);
    // A second failure leaves the copy as it was: no row.
    sim.perfectItemAs(pid, ref);
    expect(tracked(sim)).toEqual([]);

    const win = forceRoll(sim, 0);
    for (let rank = 1; rank <= PERFECTING_RANKS; rank++) {
      sim.perfectItemAs(pid, ref);
      const rows = tracked(sim);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        kind: 'modify',
        guid,
        source: 'perfecting',
        detail: `rank ${rank}`,
      });
      expect(rows[0].relatedGuid).toBeUndefined();
    }
    expect(win(), 'one draw per attempt, unchanged').toBe(PERFECTING_RANKS);
    const after = onlySlot(meta, APEX_NECK).instance;
    expect(after?.perfected).toBe(true);
    expect(after?.guid, 'the guid survived the whole walk').toBe(guid);
  });

  it('the legendary promotion of a tracked copy is a modify (detail legendary), never a second mint', () => {
    const w = perfecter(302);
    const { sim, pid, meta } = w;
    sim.addItem(DEED, 1, pid);
    sim.addItem(APEX_NECK, 1, pid);
    const guid = guidOf(onlySlot(meta, APEX_NECK).instance);
    const ref = { bag: meta.inventory.findIndex((s) => s.itemId === APEX_NECK), itemId: APEX_NECK };
    forceRoll(sim, 0);
    for (let i = 0; i < PERFECTING_RANKS; i++) sim.perfectItemAs(pid, ref);
    sim.drainEvents();

    sim.perfectItemAs(pid, ref, 'Sunrise Vow');
    const rows = tracked(sim);
    expect(rows).toEqual([
      expect.objectContaining({
        kind: 'modify',
        guid,
        source: 'promotion',
        detail: 'legendary',
        quality: 'legendary',
      }),
    ]);
    expect(onlySlot(meta, APEX_NECK).instance?.guid).toBe(guid);
  });
});

describe('Perfecting swap: both copies keep their guids and name each other', () => {
  it('one modify per copy, each relatedGuid the OTHER copy, the rank each now holds', () => {
    const { sim, pid, meta, e } = world(303);
    meta.craftSkills.armorcrafting = 125;
    const forge = STATIONS.find((s) => s.type === 'forge');
    if (!forge) throw new Error('no forge station in the content');
    e.pos = { ...forge.pos, y: 0 };
    sim.addItemInstance(
      SWAP_CHEST,
      {
        signer: 'Artisan',
        perfectingBonus: { str: 2 },
        perfected: true,
        rolled: { stats: { str: 2 } },
      },
      pid,
      1,
    );
    sim.addItemInstance(
      SWAP_WAIST,
      { signer: 'Artisan', perfectingBonus: { str: 1 }, perfecting: 1 },
      pid,
      1,
    );
    const chestGuid = guidOf(onlySlot(meta, SWAP_CHEST).instance);
    const waistGuid = guidOf(onlySlot(meta, SWAP_WAIST).instance);
    const reads = {
      inventory: meta.inventory,
      equipment: meta.equipment,
      equipmentInstances: meta.equipmentInstance,
    };
    const request = {
      source: capturePerfectItemRef(reads, {
        bag: meta.inventory.findIndex((s) => s.itemId === SWAP_CHEST),
        itemId: SWAP_CHEST,
      }),
      target: capturePerfectItemRef(reads, {
        bag: meta.inventory.findIndex((s) => s.itemId === SWAP_WAIST),
        itemId: SWAP_WAIST,
      }),
    };
    sim.drainEvents();
    const draws = forceRoll(sim, 0);

    const result = swapPerfectingRanks(sim.ctx, pid, request);
    expect(result.ok, `swap: ${result.reason}`).toBe(true);
    expect(draws(), 'the swap stays draw-free').toBe(0);
    const rows = tracked(sim);
    expect(rows).toHaveLength(2);
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'modify',
          guid: chestGuid,
          itemId: SWAP_CHEST,
          source: 'perfectingSwap',
          detail: 'rank 1',
          relatedGuid: waistGuid,
        }),
        expect.objectContaining({
          kind: 'modify',
          guid: waistGuid,
          itemId: SWAP_WAIST,
          source: 'perfectingSwap',
          detail: `rank ${PERFECTING_RANKS}`,
          relatedGuid: chestGuid,
        }),
      ]),
    );
    expect(onlySlot(meta, SWAP_CHEST).instance?.guid).toBe(chestGuid);
    expect(onlySlot(meta, SWAP_WAIST).instance?.guid).toBe(waistGuid);
    expect(onlySlot(meta, SWAP_WAIST).instance?.perfected).toBe(true);
  });
});

describe('Enchanting: an enchant is a modify on the copy, a disenchant its consume', () => {
  it('a bagged apply keeps the guid through the re-grant: one modify, no transfer, no mint', () => {
    const { sim, pid, meta } = enchanter(304);
    sim.addItem(CHEST_ITEM, 1, pid);
    const guid = guidOf(onlySlot(meta, CHEST_ITEM).instance);
    sim.drainEvents();
    const applied = resolveApplyEnchant(sim.ctx, pid, CHEST_ITEM, LUCENT_STAMINA);
    expect(applied.ok, `apply: ${applied.reason}`).toBe(true);
    expect(tracked(sim)).toEqual([
      expect.objectContaining({
        kind: 'modify',
        guid,
        itemId: CHEST_ITEM,
        source: 'enchant',
        detail: LUCENT_STAMINA,
      }),
    ]);
    const after = onlySlot(meta, CHEST_ITEM).instance;
    expect(after?.enchant).toBe(LUCENT_STAMINA);
    expect(after?.guid).toBe(guid);
  });

  it('a confirmed bagged replace with the Lucent Infusion is a modify naming the Infusion', () => {
    const { sim, pid, meta } = enchanter(305);
    sim.addItemInstance(
      CHEST_ITEM,
      { perfected: true, enchant: LUCENT_STAMINA, rolled: { stats: { sta: 1 } } },
      pid,
      1,
    );
    const guid = guidOf(onlySlot(meta, CHEST_ITEM).instance);
    sim.drainEvents();
    const applied = resolveApplyEnchant(sim.ctx, pid, CHEST_ITEM, INFUSION, undefined, true);
    expect(applied.ok, `replace: ${applied.reason}`).toBe(true);
    expect(tracked(sim)).toEqual([
      expect.objectContaining({ kind: 'modify', guid, source: 'enchant', detail: INFUSION }),
    ]);
    expect(onlySlot(meta, CHEST_ITEM).instance?.enchant).toBe(INFUSION);
    expect(onlySlot(meta, CHEST_ITEM).instance?.guid).toBe(guid);
  });

  it('a worn apply enchants the copy in place: one modify on the worn guid', () => {
    const { sim, pid, meta } = enchanter(306);
    sim.setPlayerLevel(20);
    sim.addItem(CHEST_ITEM, 1, pid);
    sim.equipItem(CHEST_ITEM, pid);
    expect(meta.equipment.chest).toBe(CHEST_ITEM);
    const guid = guidOf(meta.equipmentInstance.chest);
    sim.drainEvents();
    const applied = resolveApplyEnchant(sim.ctx, pid, CHEST_ITEM, LUCENT_STAMINA, 'chest');
    expect(applied.ok, `worn apply: ${applied.reason}`).toBe(true);
    expect(tracked(sim)).toEqual([
      expect.objectContaining({ kind: 'modify', guid, source: 'enchant', detail: LUCENT_STAMINA }),
    ]);
    expect(meta.equipmentInstance.chest?.guid).toBe(guid);
  });

  it('a disenchant ends the copy: one consume row naming the yield', () => {
    const { sim, pid, meta } = enchanter(307);
    sim.addItem(CHEST_ITEM, 1, pid);
    const guid = guidOf(onlySlot(meta, CHEST_ITEM).instance);
    sim.drainEvents();
    const result = resolveDisenchant(sim.ctx, pid, CHEST_ITEM);
    expect(result.ok, `disenchant: ${result.reason}`).toBe(true);
    expect(sim.countItem(CHEST_ITEM, pid)).toBe(0);
    const rows = tracked(sim).filter((r) => r.guid === guid);
    expect(rows).toEqual([
      expect.objectContaining({
        kind: 'consume',
        itemId: CHEST_ITEM,
        source: 'disenchant',
        detail: `${result.materialItemId} x${result.count}`,
      }),
    ]);
  });
});

describe('the disenchant victim walk spares a Perfected copy among tracked copies', () => {
  it('isPlainCopy: payload-free or identity-only is plain, anything more is not', () => {
    expect(isPlainCopy(undefined)).toBe(true);
    expect(isPlainCopy({})).toBe(true);
    const identity: ItemInstancePayload = {
      guid: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
      provenance: { at: 1, by: 'A', source: 'world' },
    };
    expect(isPlainCopy(identity)).toBe(true);
    expect(isPlainCopy({ ...identity, boundTo: undefined })).toBe(true);
    expect(isPlainCopy({ ...identity, perfected: true })).toBe(false);
    expect(isPlainCopy({ ...identity, boundTo: 7 })).toBe(false);
    expect(isPlainCopy({ signer: 'Crafter' })).toBe(false);
  });

  it('an ordinary tracked copy is destroyed before a NEWER Perfected one', () => {
    // Before tracking the ordinary copy was payload-free and the walk's plain
    // pass took it. Now it carries a guid; the instanced pass alone would take
    // the newest unenchanted copy, the Perfected one.
    const { sim, pid, meta } = enchanter(308);
    sim.addItem(CHEST_ITEM, 1, pid);
    sim.addItemInstance(CHEST_ITEM, { perfected: true }, pid, 1);
    const slots = meta.inventory.filter((s) => s.itemId === CHEST_ITEM);
    expect(slots).toHaveLength(2);
    const ordinaryGuid = guidOf(slots[0].instance);
    const perfectedGuid = guidOf(slots[1].instance);
    expect(slots[1].instance?.perfected).toBe(true);
    sim.drainEvents();

    expect(resolveDisenchant(sim.ctx, pid, CHEST_ITEM).ok).toBe(true);
    const left = meta.inventory.filter((s) => s.itemId === CHEST_ITEM);
    expect(left.map((s) => s.instance?.guid)).toEqual([perfectedGuid]);
    expect(left[0].instance?.perfected).toBe(true);
    const consumed = tracked(sim).filter((r) => r.kind === 'consume');
    expect(consumed.map((r) => r.guid)).toEqual([ordinaryGuid]);
  });

  it('the walk itself: identity-only first, then an unenchanted special copy, then an enchanted one', () => {
    const id = (n: number): ItemInstancePayload => ({
      guid: `3f2504e0-4f89-41d3-9a0c-0305e82c330${n}`,
      provenance: { at: 1, by: 'A', source: 'world' },
    });
    const inventory: InvSlot[] = [
      { itemId: CHEST_ITEM, count: 1, instance: { ...id(1), enchant: LUCENT_STAMINA } },
      { itemId: CHEST_ITEM, count: 1, instance: id(2) },
      { itemId: CHEST_ITEM, count: 1, instance: { ...id(3), perfected: true } },
    ];
    expect(consumePreferredDisenchantVictim(inventory, CHEST_ITEM)?.instance?.guid).toBe(
      id(2).guid,
    );
    expect(consumePreferredDisenchantVictim(inventory, CHEST_ITEM)?.instance?.guid).toBe(
      id(3).guid,
    );
    expect(consumePreferredDisenchantVictim(inventory, CHEST_ITEM)?.instance?.guid).toBe(
      id(1).guid,
    );
    expect(inventory).toHaveLength(0);
  });

  it('a slot-named disenchant still destroys the NAMED copy, Perfected or not', () => {
    const { sim, pid, meta } = enchanter(309);
    sim.addItem(CHEST_ITEM, 1, pid);
    sim.addItemInstance(CHEST_ITEM, { perfected: true }, pid, 1);
    const perfectedIdx = meta.inventory.findIndex(
      (s) => s.itemId === CHEST_ITEM && s.instance?.perfected === true,
    );
    const perfectedGuid = guidOf(meta.inventory[perfectedIdx].instance);
    sim.drainEvents();
    expect(resolveDisenchant(sim.ctx, pid, CHEST_ITEM, perfectedIdx).ok).toBe(true);
    const left = meta.inventory.filter((s) => s.itemId === CHEST_ITEM);
    expect(left).toHaveLength(1);
    expect(left[0].instance?.perfected).toBeUndefined();
    expect(
      tracked(sim)
        .filter((r) => r.kind === 'consume')
        .map((r) => r.guid),
    ).toEqual([perfectedGuid]);
  });
});

describe('Rift Forge: an upgrade and a socket are modify rows on the band', () => {
  it('names the new upgrade level, then the gem (and the gem it replaced)', () => {
    const sim = new Sim({ seed: 310, playerClass: 'warrior', autoEquip: false });
    moveToRiftForge(sim);
    sim.setPlayerLevel(20);
    const meta = sim.players.get(sim.playerId) as PlayerMeta;
    const gear = createRiftGearInstance('rift-lineage', 'A', 'warrior', sim.player.id);
    sim.addItemInstance(gear.itemId, gear.instance);
    sim.addItem(RIFT_ESSENCE_ITEM_ID, 10);
    sim.addItem(RIFT_GEM_IDS[0], 1);
    sim.addItem(RIFT_GEM_IDS[1], 1);
    const band = () => meta.inventory.find((s) => s.itemId === gear.itemId && s.instance?.rift);
    const guid = guidOf(band()?.instance);
    const gemSlots = band()?.instance?.rift?.gemSlots ?? 0;
    expect(gemSlots, 'an A band has exactly one socket').toBe(1);
    sim.drainEvents();

    expect(sim.upgradeRiftItem(gear.itemId).ok).toBe(true);
    expect(tracked(sim)).toEqual([
      expect.objectContaining({ kind: 'modify', guid, source: 'riftForge', detail: 'upgrade 1' }),
    ]);
    expect(sim.socketRiftGem(gear.itemId, RIFT_GEM_IDS[0]).ok).toBe(true);
    expect(tracked(sim)).toEqual([
      expect.objectContaining({
        kind: 'modify',
        guid,
        source: 'riftSocket',
        detail: RIFT_GEM_IDS[0],
      }),
    ]);
    expect(sim.socketRiftGem(gear.itemId, RIFT_GEM_IDS[1]).ok).toBe(true);
    expect(tracked(sim)).toEqual([
      expect.objectContaining({
        kind: 'modify',
        guid,
        source: 'riftSocket',
        detail: `${RIFT_GEM_IDS[1]} replacing ${RIFT_GEM_IDS[0]}`,
      }),
    ]);
    expect(band()?.instance?.guid).toBe(guid);
  });
});

describe("Maker's Bond: an unbind is a modify on the copy", () => {
  it('clears the bond in place, keeps the guid, writes one unbind row', () => {
    const { sim, pid, meta, e } = world(311);
    sim.ctx.addItemInstance(EPIC_WEAPON, { bindOnTrade: true, boundTo: pid }, pid);
    meta.copper = 100000;
    e.pos.x = STATIONS[0].pos.x;
    e.pos.z = STATIONS[0].pos.z;
    const guid = guidOf(onlySlot(meta, EPIC_WEAPON).instance);
    sim.drainEvents();
    const result = unbindItem(sim.ctx, EPIC_WEAPON, pid);
    expect(result.ok, `unbind: ${result.reason}`).toBe(true);
    const rows = tracked(sim);
    expect(rows).toEqual([
      expect.objectContaining({ kind: 'modify', guid, itemId: EPIC_WEAPON, source: 'unbind' }),
    ]);
    expect(rows[0].detail).toBeUndefined();
    const after = onlySlot(meta, EPIC_WEAPON).instance;
    expect(after?.boundTo).toBeUndefined();
    expect(after?.guid).toBe(guid);
  });
});
