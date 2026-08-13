// The provenance sweep: ONE maximally-marked copy driven through EVERY
// container boundary in the game, each asserting the copy comes out the far
// end byte-identical.
//
// Why this file exists as a sweep rather than as N per-feature cases: the
// "a boundary silently strips an item's identity" bug has been fixed one
// boundary at a time at least eight times now (trade #2049, vendor buyback
// #2412, the market and the plain bank arm #2603/#2605, the anonymous pipes
// #2507, the instanced bank arm and the rename buyback/escrow sweeps in the
// professions packet, then apply-enchant and the instanced escrow legs here).
// Every one of them was the same mistake: a site that REBUILDS an InvSlot or a
// payload from parts instead of carrying it whole, so a marker it did not
// happen to name is dropped. Per-feature tests never caught the next one
// because each was written against the boundary that had just been fixed, and
// two of the boundaries fixed independently in the professions packet were ones
// this sweep's rows had already gone red on.
//
// The contract this file pins, for every boundary in the table below:
//   a copy that goes in carrying { signer, rolled.masterwork + stats, enchant,
//   craftedRecipeId } comes back out carrying all four.
//
// Adding a container boundary (a guild bank, a loadout store, a housing chest)
// means adding a row here. A row that cannot be expressed is itself the
// finding: it means the boundary has no round trip a player can observe.

import { describe, expect, it } from 'vitest';
import { moveBetweenContainers } from '../src/sim/bank';
import { rekeyInstanceSigner } from '../src/sim/character_rename';
import { MAIL_DELIVERY_SECONDS } from '../src/sim/mail/post_office';
import { type PlayerMeta, Sim } from '../src/sim/sim';
import type { Entity, InvSlot, ItemInstancePayload } from '../src/sim/types';
import { runApplyEnchant, runCraft, runDisenchant } from './helpers/enchant_family_cast';
import { EMPTY_TEST_WORLD, VENDOR_TEST_WORLD } from './sim_shared';

// A crafted, masterwork-procced, enchanted, signed piece: every marker channel
// at once. Deliberately an EQUIPPABLE armour piece so the equip/unequip and
// enchant boundaries can drive it, and deliberately one that a real recipe
// mints, so craftedRecipeId is a value the disenchant gate actually honours.
const GEAR = 'eastbrook_chain_vest';
const GEAR_RECIPE = 'recipe_eastbrook_chain_vest';
const SIGNER = 'Provenance';

const FULL_PAYLOAD: ItemInstancePayload = Object.freeze({
  signer: SIGNER,
  rolled: Object.freeze({ masterwork: true, stats: Object.freeze({ sta: 5 }) }),
  enchant: 'enchant_chest_stamina',
}) as ItemInstancePayload;

function payload(): ItemInstancePayload {
  return {
    signer: FULL_PAYLOAD.signer,
    rolled: { masterwork: true, stats: { ...FULL_PAYLOAD.rolled?.stats } },
    enchant: FULL_PAYLOAD.enchant,
  };
}

function fullSlot(): InvSlot {
  return { itemId: GEAR, count: 1, instance: payload(), craftedRecipeId: GEAR_RECIPE };
}

function metaFor(sim: Sim, pid: number): PlayerMeta {
  const r = sim.ctx.resolve(pid);
  if (!r) throw new Error(`no meta for pid ${pid}`);
  return r.meta;
}

function inv(sim: Sim, pid: number): InvSlot[] {
  return metaFor(sim, pid).inventory;
}

function gearSlot(sim: Sim, pid: number): InvSlot | undefined {
  return inv(sim, pid).find((s) => s.itemId === GEAR);
}

/** The one assertion every row shares: all four marker channels intact.
 *  Asserted per channel rather than with a single toEqual so a failure names
 *  WHICH marker the boundary dropped instead of dumping two objects. */
function expectFullyMarked(slot: InvSlot | undefined, where: string): void {
  expect(slot, `${where}: the copy itself is gone`).toBeDefined();
  expect(slot?.instance?.signer, `${where}: signer`).toBe(SIGNER);
  expect(slot?.instance?.rolled?.masterwork, `${where}: masterwork seal`).toBe(true);
  expect(slot?.instance?.rolled?.stats, `${where}: baked stats`).toEqual({ sta: 5 });
  expect(slot?.instance?.enchant, `${where}: enchant`).toBe('enchant_chest_stamina');
  // The craft marker rides EITHER channel: on the slot for a bagged copy, inside
  // the payload while worn (items.ts equipmentPayloadFor bridges it). Both are
  // honoured by the disenchant gate (professions/enchanting.ts
  // isCraftedDisenchantVictim), so either is a pass and neither being present
  // is the laundering bug.
  const marker = slot?.craftedRecipeId ?? slot?.instance?.craftedRecipeId;
  expect(marker, `${where}: craftedRecipeId`).toBe(GEAR_RECIPE);
}

function makeSim(seed: number): Sim {
  // VENDOR_TEST_WORLD keeps BUILTIN_WORLD.npcs untouched (bankers, trader_wilkes,
  // the_merchant, all at fixed content-authored positions) while trimming camps
  // to a single forest_wolf slice and zeroing groundObjects: exactly the ambient
  // bulk this file's rows never touch (they only stand at named NPCs and move
  // inventory/bank/equipment/mail/market slots).
  return new Sim({ seed, playerClass: 'warrior', autoEquip: false, world: VENDOR_TEST_WORLD });
}

function standAt(sim: Sim, pid: number, templateId: string): void {
  const target = [...sim.ctx.entities.values()].find((e) => e.templateId === templateId);
  const p = sim.ctx.entities.get(pid);
  if (!target || !p) throw new Error(`missing ${templateId} or player`);
  p.pos.x = target.pos.x + 1;
  p.pos.z = target.pos.z;
  p.prevPos = { ...p.pos };
  sim.rebucket(p as Entity);
}

function standAtBanker(sim: Sim, pid: number): void {
  const banker = sim.bankerIds
    .map((id) => sim.ctx.entities.get(id))
    .find((e): e is Entity => !!e && e.kind === 'npc');
  const p = sim.ctx.entities.get(pid);
  if (!banker || !p) throw new Error('missing banker or player');
  p.pos.x = banker.pos.x + 1;
  p.pos.z = banker.pos.z;
  p.prevPos = { ...p.pos };
  sim.rebucket(p as Entity);
}

describe('provenance survives every container boundary', () => {
  it('bags: the fixture itself is fully marked before any boundary runs', () => {
    // The control. If this ever fails, every row below is testing nothing.
    expectFullyMarked(fullSlot(), 'fixture');
  });

  it('bank: deposit -> withdraw', () => {
    const sim = makeSim(4101);
    const pid = sim.playerId;
    const meta = metaFor(sim, pid);
    standAtBanker(sim, pid);
    inv(sim, pid).push(fullSlot());

    sim.bankDeposit(
      inv(sim, pid).findIndex((s) => s.itemId === GEAR),
      undefined,
      pid,
    );
    expectFullyMarked(
      meta.bank.inventory.find((s) => s.itemId === GEAR),
      'bank after deposit',
    );

    sim.bankWithdraw(
      meta.bank.inventory.findIndex((s) => s.itemId === GEAR),
      undefined,
      pid,
    );
    expectFullyMarked(gearSlot(sim, pid), 'bags after withdraw');
  });

  it('bank: the container primitive itself, both directions', () => {
    // moveBetweenContainers is container-agnostic and is the seam the guild
    // bank and any future store reuse, so it is pinned directly as well as
    // through the bank commands above.
    const bags: InvSlot[] = [fullSlot()];
    const store: InvSlot[] = [];
    expect(moveBetweenContainers(bags, 0, undefined, store, 40).moved).toBe(1);
    expectFullyMarked(store[0], 'moveBetweenContainers out');
    expect(moveBetweenContainers(store, 0, undefined, bags, 40).moved).toBe(1);
    expectFullyMarked(bags[0], 'moveBetweenContainers back');
  });

  it('equipment: equip -> unequip', () => {
    const sim = makeSim(4102);
    const pid = sim.playerId;
    const meta = metaFor(sim, pid);
    inv(sim, pid).push(fullSlot());

    sim.equipItem(GEAR, pid);
    expect(meta.equipment.chest).toBe(GEAR);
    expectFullyMarked(
      { itemId: GEAR, count: 1, instance: meta.equipmentInstance.chest },
      'equipped payload',
    );

    expect(sim.unequipItem('chest', pid)).toBe(true);
    expectFullyMarked(gearSlot(sim, pid), 'bags after unequip');
  });

  it('vendor: sell -> buy back', () => {
    const sim = makeSim(4103);
    const pid = sim.playerId;
    const meta = metaFor(sim, pid);
    standAt(sim, pid, 'trader_wilkes');
    inv(sim, pid).push(fullSlot());

    sim.sellItem(GEAR, 1, pid);
    expectFullyMarked(
      meta.vendorBuyback.find((s) => s.itemId === GEAR),
      'vendor buyback row',
    );

    sim.buyBackItem(GEAR, 0, undefined, pid);
    expectFullyMarked(gearSlot(sim, pid), 'bags after buy back');
  });

  it('persistence: logout -> login, across bags, bank, buyback, and equipped', () => {
    const sim = makeSim(4104);
    const pid = sim.playerId;
    const meta = metaFor(sim, pid);
    inv(sim, pid).push(fullSlot());
    meta.bank.inventory.push(fullSlot());
    meta.vendorBuyback.push(fullSlot());
    inv(sim, pid).push(fullSlot());
    sim.equipItem(GEAR, pid);

    const state = sim.serializeCharacter(pid);
    expect(state).not.toBeNull();
    const reloaded = makeSim(1);
    const pid2 = reloaded.addPlayer('warrior', SIGNER, { state: state ?? undefined });
    const meta2 = metaFor(reloaded, pid2);

    expectFullyMarked(
      meta2.inventory.find((s) => s.itemId === GEAR),
      'bags after relog',
    );
    expectFullyMarked(
      meta2.bank.inventory.find((s) => s.itemId === GEAR),
      'bank after relog',
    );
    expectFullyMarked(
      meta2.vendorBuyback.find((s) => s.itemId === GEAR),
      'buyback after relog',
    );
    expectFullyMarked(
      { itemId: GEAR, count: 1, instance: meta2.equipmentInstance.chest },
      'equipped after relog',
    );
  });

  it('mail: send -> take', () => {
    // The subsystem world (the mail-suite pattern): this row needs only the
    // PostOffice, players, and mailboxes, and ticking the raven's flight on the
    // FULL world costs seconds of unrelated camp/NPC simulation per run.
    const sim = new Sim({
      seed: 4105,
      playerClass: 'warrior',
      noPlayer: true,
      world: EMPTY_TEST_WORLD,
    });
    const sender = sim.addPlayer('warrior', SIGNER);
    const recipient = sim.addPlayer('mage', 'Rex');
    const box = sim.ctx.entities.get(sim.postOffice.mailboxIds[0]);
    for (const pid of [sender, recipient]) {
      const p = sim.ctx.entities.get(pid);
      if (!box || !p) throw new Error('missing mailbox or player');
      p.pos = { ...box.pos };
      p.prevPos = { ...p.pos };
      sim.rebucket(p as Entity);
    }
    metaFor(sim, sender).copper = 10_000;
    const staged = fullSlot();
    inv(sim, sender).push(fullSlot());
    sim.drainEvents();

    sim.mailSend('Rex', 'a gift', '', 0, [staged], sender);
    expect(
      sim
        .drainEvents()
        .some((e) => e.type === 'mailResult' && (e as { code?: string }).code === 'sent'),
    ).toBe(true);
    // Exactly the raven's flight plus a tick of slack, not a blanket 120s.
    for (let i = 0; i < (MAIL_DELIVERY_SECONDS + 2) * 20; i++) sim.tick();
    sim.drainEvents();

    // By SENDER, not recipient: every new character is also sent the authored
    // welcome letter, which is addressed to Rex too and carries no parcels.
    const letter = sim.postOffice.mail.find(
      (m) => m.recipientName === 'Rex' && m.senderName === SIGNER,
    );
    expect(letter, 'the letter reached the recipient').toBeDefined();
    expectFullyMarked(
      letter?.items.find((s) => s.itemId === GEAR),
      'mail parcel in flight',
    );

    sim.mailTake(letter?.id ?? -1, recipient);
    expectFullyMarked(gearSlot(sim, recipient), 'recipient bags after take');
  });

  it('market: list -> cancel -> collect', () => {
    const sim = makeSim(4106);
    const pid = sim.playerId;
    standAt(sim, pid, 'the_merchant');
    inv(sim, pid).push(fullSlot());
    sim.drainEvents();

    sim.marketListInstance(GEAR, 5_000, payload(), pid);
    const listing = sim.marketListings.find((l) => l.itemId === GEAR && !l.house);
    expect(listing, 'the listing was created').toBeDefined();
    expectFullyMarked(
      { itemId: GEAR, count: 1, instance: listing?.instance, craftedRecipeId: GEAR_RECIPE },
      'escrowed listing payload',
    );

    sim.marketCancel(listing?.id ?? -1, pid);
    sim.marketCollect(pid);
    expectFullyMarked(gearSlot(sim, pid), 'bags after cancel + collect');
  });

  it('enchanting: applying an enchant to a self-crafted masterwork copy', () => {
    // Not a container round trip but a TRANSFORM, and the same contract: the
    // copy that comes back is the copy that went in, plus an enchant. This is
    // the row that catches a mint rebuilt from parts, which is how apply-enchant
    // used to drop the craft marker and reopen the disenchant anti-farm gate.
    const sim = makeSim(4107);
    const pid = sim.playerId;
    // The pre-enchant shape a masterwork proc mints (professions/crafting.ts):
    // instance payload for the seal, craftedRecipeId on the slot.
    sim.addItemInstance(
      GEAR,
      { signer: SIGNER, rolled: { masterwork: true, stats: { sta: 5 } } },
      pid,
      1,
      { craftedRecipeId: GEAR_RECIPE },
    );
    sim.addItem('arcane_dust', 10, pid);
    sim.addItem('arcane_essence', 10, pid);

    runApplyEnchant(sim, GEAR, 'enchant_chest_stamina', undefined, undefined, pid);
    expect(sim.lastEnchantResultFor(pid)?.ok, 'the enchant applied').toBe(true);
    const after = gearSlot(sim, pid);
    expect(after?.instance?.signer, 'signer').toBe(SIGNER);
    expect(after?.instance?.rolled?.masterwork, 'masterwork seal').toBe(true);
    expect(after?.instance?.enchant, 'enchant').toBe('enchant_chest_stamina');
    expect(after?.craftedRecipeId ?? after?.instance?.craftedRecipeId, 'craftedRecipeId').toBe(
      GEAR_RECIPE,
    );
  });

  it('enchanting: the anti-farm gate still holds after a craft -> enchant round trip', () => {
    // The consequence the marker exists for, asserted on behaviour rather than
    // on the marker: disenchanting your OWN crafted piece pays no Enchanting
    // skill, and routing it through an enchant first must not change that.
    const sim = makeSim(4108);
    const pid = sim.playerId;
    const meta = metaFor(sim, pid);
    sim.addItem('copper_ore', 4, pid);
    sim.addItem('smithing_flux', 9, pid);
    runCraft(sim, GEAR_RECIPE, false, pid);
    expect(sim.lastCraftResult?.ok).toBe(true);
    sim.addItem('arcane_dust', 10, pid);
    sim.addItem('arcane_essence', 10, pid);

    runApplyEnchant(sim, GEAR, 'enchant_chest_stamina', undefined, undefined, pid);
    const afterApply = meta.craftSkills.enchanting;
    runDisenchant(
      sim,
      GEAR,
      pid,
      inv(sim, pid).findIndex((s) => s.itemId === GEAR),
    );
    expect(sim.lastDisenchantResult?.ok).toBe(true);
    expect(
      meta.craftSkills.enchanting - afterApply,
      'disenchanting a self-crafted piece pays no skill, enchanted or not',
    ).toBe(0);
  });

  it('rename: the signer sweep reaches every blob container', () => {
    // The rename's own boundary: a signer left on the old name is the same
    // identity loss by another route (the #1145 self-signed discount and
    // Battlefield XP attribution both compare signer to the live name).
    const state = {
      inventory: [fullSlot()],
      bank: { inventory: [fullSlot()], purchasedSlots: 0, bonusSlots: 0 },
      vendorBuyback: [fullSlot()],
      equipmentInstance: { chest: payload() },
    } as unknown as Parameters<typeof rekeyInstanceSigner>[0];

    expect(rekeyInstanceSigner(state, SIGNER, 'Renamed')).toBe(true);
    for (const [where, slot] of [
      ['inventory', state.inventory?.[0]],
      ['bank', state.bank?.inventory[0]],
      ['vendorBuyback', state.vendorBuyback?.[0]],
      ['equipped', { itemId: GEAR, count: 1, instance: state.equipmentInstance?.chest }],
    ] as const) {
      expect(slot?.instance?.signer, `${where}: signer follows the rename`).toBe('Renamed');
      // Everything BUT the signer is untouched by the sweep.
      expect(slot?.instance?.rolled?.masterwork, `${where}: masterwork seal`).toBe(true);
      expect(slot?.instance?.enchant, `${where}: enchant`).toBe('enchant_chest_stamina');
    }
    expect(state.inventory?.[0].craftedRecipeId).toBe(GEAR_RECIPE);
    expect(state.vendorBuyback?.[0].craftedRecipeId).toBe(GEAR_RECIPE);
  });
});
