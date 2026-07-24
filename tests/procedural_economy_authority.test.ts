import { describe, expect, it } from 'vitest';
import { ITEMS } from '../src/sim/data';
import { generateProceduralItem } from '../src/sim/loot/procedural';
import { MAIL_POSTAGE, type MailMessage, type MailSave } from '../src/sim/mail/post_office';
import { cloneProceduralPayload } from '../src/sim/procedural_item';
import { ownerItemInstanceView, publicItemInstanceView } from '../src/sim/procedural_item_public';
import { duplicateProceduralItemUids } from '../src/sim/procedural_item_validation';
import { itemVendorSellValue } from '../src/sim/procedural_vendor_value';
import { type PlayerMeta, Sim } from '../src/sim/sim';
import type { Entity, ItemInstancePayload, PlayerClass } from '../src/sim/types';

const BASE_ID = 'gravecaller_ring';
const UID_A = 'pi1:economy-authority:1001';
const UID_B = 'pi1:economy-authority:1002';

function generated(
  uid: string,
  seed: number,
  extras: Omit<ItemInstancePayload, 'procedural'> = {},
): ItemInstancePayload {
  return {
    ...extras,
    ...generateProceduralItem({
      seed,
      uid,
      context: {
        source: 'dungeon',
        sourceEntityId: 40,
        sourceSpawnSequence: seed,
        lootSlotIndex: seed % 4,
      },
      basePoolId: 'initial_dungeon_boss',
      rarityTableId: 'initial_dungeon_boss',
      sourceItemLevel: 20,
      forcedBaseId: BASE_ID,
      forcedRarity: 'magic',
    }).instance,
  };
}

function makeWorld(seed = 912): Sim {
  return new Sim({ seed, playerClass: 'warrior', noPlayer: true });
}

function cleanPlayer(sim: Sim, cls: PlayerClass, name: string): number {
  const pid = sim.addPlayer(cls, name);
  const meta = mustMeta(sim, pid);
  meta.inventory = [];
  meta.vendorBuyback = [];
  meta.autoEquip = false;
  return pid;
}

function mustMeta(sim: Sim, pid: number): PlayerMeta {
  const meta = sim.meta(pid);
  if (!meta) throw new Error(`missing player meta ${pid}`);
  return meta;
}

function mustEntity(sim: Sim, pid: number): Entity {
  const entity = sim.entities.get(pid);
  if (!entity) throw new Error(`missing entity ${pid}`);
  return entity;
}

function uidSlots(meta: PlayerMeta, uid: string) {
  return meta.inventory.filter((slot) => slot.instance?.procedural?.uid === uid);
}

function allInventoryUids(meta: PlayerMeta): string[] {
  return meta.inventory
    .map((slot) => slot.instance?.procedural?.uid)
    .filter((uid): uid is string => uid !== undefined);
}

function moveToVendor(sim: Sim, pid: number): void {
  const vendor = [...sim.entities.values()].find(
    (entity) => entity.kind === 'npc' && entity.vendorItems.length > 0,
  );
  const player = mustEntity(sim, pid);
  if (!vendor) throw new Error('missing vendor');
  player.pos = { ...vendor.pos };
  player.prevPos = { ...player.pos };
  sim.rebucket(player);
}

function moveToMailbox(sim: Sim, pid: number): void {
  const mailbox = sim.entities.get(sim.postOffice.mailboxIds[0]);
  const player = mustEntity(sim, pid);
  if (!mailbox) throw new Error('missing mailbox');
  player.pos = { ...mailbox.pos };
  player.prevPos = { ...player.pos };
  sim.rebucket(player);
}

function putTradePartnersTogether(sim: Sim, a: number, b: number): void {
  const first = mustEntity(sim, a);
  const second = mustEntity(sim, b);
  second.pos = { ...first.pos, x: first.pos.x + 1 };
  second.prevPos = { ...second.pos };
  sim.rebucket(second);
}

function openTrade(sim: Sim, a: number, b: number): void {
  putTradePartnersTogether(sim, a, b);
  sim.tradeRequest(b, a);
  sim.tradeAccept(b);
  if (!sim.tradeFor(a)) throw new Error('trade did not open');
}

function rawMail(sim: Sim, subject: string): MailMessage {
  const message = sim.postOffice.mail.find((entry) => entry.subject === subject);
  if (!message) throw new Error(`missing raw mail ${subject}`);
  return message;
}

function deliverNow(sim: Sim, subject: string): MailMessage {
  const message = rawMail(sim, subject);
  message.deliverAt = sim.time;
  sim.tick();
  return message;
}

function fillBackpack(meta: PlayerMeta): void {
  meta.bags = [null, null, null, null];
  while (meta.inventory.length < 16) {
    meta.inventory.push({ itemId: 'roasted_boar', count: 20 });
  }
}

describe('procedural vendor and discard exact-copy authority', () => {
  it('round-trips only the selected same-base copy through persisted buyback and respects capacity', () => {
    const sim = makeWorld();
    const pid = cleanPlayer(sim, 'warrior', 'VendorOne');
    const meta = mustMeta(sim, pid);
    const copyA = generated(UID_A, 1001, { signer: 'Copy A' });
    const copyB = generated(UID_B, 1002, { signer: 'Copy B', enchant: 'keen_edge' });
    sim.addItemInstance(BASE_ID, copyA, pid);
    sim.addItemInstance(BASE_ID, copyB, pid);
    moveToVendor(sim, pid);

    const beforeForged = structuredClone(sim.serializeCharacter(pid));
    sim.sellItem(BASE_ID, 1, pid, 'pi1:forged:missing');
    expect(sim.serializeCharacter(pid)).toEqual(beforeForged);

    sim.sellItem(BASE_ID, 1, pid, UID_B);
    expect(uidSlots(meta, UID_A)).toHaveLength(1);
    expect(uidSlots(meta, UID_B)).toHaveLength(0);
    expect(meta.vendorBuyback).toEqual([{ itemId: BASE_ID, count: 1, instance: copyB }]);
    expect(meta.copper).toBe(itemVendorSellValue(ITEMS[BASE_ID], copyB));

    const state = sim.serializeCharacter(pid);
    if (!state) throw new Error('failed to serialize vendor state');
    const reloaded = makeWorld();
    const reloadedPid = reloaded.addPlayer('warrior', 'VendorOne', {
      state: structuredClone(state),
    });
    const reloadedMeta = mustMeta(reloaded, reloadedPid);
    reloadedMeta.autoEquip = false;
    moveToVendor(reloaded, reloadedPid);
    fillBackpack(reloadedMeta);

    const copperBeforeFullAttempt = reloadedMeta.copper;
    reloaded.buyBackItem(BASE_ID, reloadedPid, UID_B);
    expect(reloadedMeta.copper).toBe(copperBeforeFullAttempt);
    expect(uidSlots(reloadedMeta, UID_B)).toHaveLength(0);
    expect(reloadedMeta.vendorBuyback[0]?.instance).toEqual(copyB);

    reloadedMeta.inventory.pop();
    reloaded.buyBackItem(BASE_ID, reloadedPid, UID_B);
    expect(uidSlots(reloadedMeta, UID_A)).toHaveLength(1);
    expect(uidSlots(reloadedMeta, UID_B)).toHaveLength(1);
    expect(uidSlots(reloadedMeta, UID_B)[0]?.instance).toEqual(copyB);
    expect(reloadedMeta.copper).toBe(0);
    expect(reloadedMeta.vendorBuyback).toHaveLength(0);

    reloaded.discardItem(BASE_ID, 1, reloadedPid, UID_B);
    expect(uidSlots(reloadedMeta, UID_A)).toHaveLength(1);
    expect(uidSlots(reloadedMeta, UID_B)).toHaveLength(0);
  });

  it('never vendor-launders a bound exact copy', () => {
    const sim = makeWorld();
    const pid = cleanPlayer(sim, 'warrior', 'VendorBound');
    const meta = mustMeta(sim, pid);
    const bound = generated(UID_A, 1010, {
      signer: 'Bound',
      bindOnTrade: true,
      boundTo: pid,
    });
    sim.addItemInstance(BASE_ID, bound, pid);
    moveToVendor(sim, pid);

    sim.sellItem(BASE_ID, 1, pid, UID_A);
    expect(uidSlots(meta, UID_A)).toHaveLength(1);
    expect(meta.vendorBuyback).toHaveLength(0);
    expect(meta.copper).toBe(0);
    expect(
      sim.drainEvents().some((event) => event.type === 'error' && event.text.includes('bound')),
    ).toBe(true);
  });
});

describe('procedural trade exact-copy authority', () => {
  it('ignores a forged payload, deduplicates a repeated UID, selects B not A, and cannot replay', () => {
    const sim = makeWorld();
    const a = cleanPlayer(sim, 'warrior', 'TradeAlice');
    const b = cleanPlayer(sim, 'mage', 'TradeBob');
    const metaA = mustMeta(sim, a);
    const metaB = mustMeta(sim, b);
    const copyA = generated(UID_A, 1101, { signer: 'Authoritative A' });
    const copyB = generated(UID_B, 1102, {
      signer: 'Authoritative B',
      enchant: 'keen_edge',
    });
    sim.addItemInstance(BASE_ID, copyA, a);
    sim.addItemInstance(BASE_ID, copyB, a);
    openTrade(sim, a, b);

    const forged = generated(UID_B, 9999, {
      signer: 'FORGED CLIENT PAYLOAD',
      enchant: 'forged_enchant',
    });
    const request = {
      itemId: BASE_ID,
      count: 1,
      instanceUid: UID_B,
      instance: forged,
    };
    sim.tradeSetOffer([request, request] as never, 0, a);
    expect(sim.tradeFor(a)?.offerA.items).toEqual([{ itemId: BASE_ID, count: 1, instance: copyB }]);

    sim.tradeConfirm(a);
    sim.tradeConfirm(b);
    expect(uidSlots(metaA, UID_A)).toHaveLength(1);
    expect(uidSlots(metaA, UID_B)).toHaveLength(0);
    expect(uidSlots(metaB, UID_B)).toHaveLength(1);
    expect(uidSlots(metaB, UID_B)[0]?.instance).toEqual(copyB);

    const after = {
      a: structuredClone(metaA.inventory),
      b: structuredClone(metaB.inventory),
      copperA: metaA.copper,
      copperB: metaB.copper,
    };
    sim.tradeConfirm(a);
    sim.tradeConfirm(b);
    expect(metaA.inventory).toEqual(after.a);
    expect(metaB.inventory).toEqual(after.b);
    expect(metaA.copper).toBe(after.copperA);
    expect(metaB.copper).toBe(after.copperB);
  });

  it('rejects malformed and base-mismatched UIDs without downgrading them to generic stock', () => {
    const sim = makeWorld();
    const a = cleanPlayer(sim, 'warrior', 'MalformedAlice');
    const b = cleanPlayer(sim, 'mage', 'MalformedBob');
    const metaA = mustMeta(sim, a);
    sim.addItem(BASE_ID, 1, a);
    sim.addItemInstance(BASE_ID, generated(UID_A, 1110), a);
    openTrade(sim, a, b);

    sim.tradeSetOffer(
      [
        { itemId: BASE_ID, count: 1, instanceUid: '' },
        { itemId: 'iron_broadsword', count: 1, instanceUid: UID_A },
        { itemId: BASE_ID, count: 1, instanceUid: 'x'.repeat(97) },
      ],
      0,
      a,
    );
    expect(sim.tradeFor(a)?.offerA.items).toEqual([]);
    sim.tradeConfirm(a);
    sim.tradeConfirm(b);
    expect(metaA.inventory).toHaveLength(2);
    expect(sim.countItem(BASE_ID, b)).toBe(0);
  });

  it('fails atomically when an exact offer becomes stale before the second confirmation', () => {
    const sim = makeWorld();
    const a = cleanPlayer(sim, 'warrior', 'StaleAlice');
    const b = cleanPlayer(sim, 'mage', 'StaleBob');
    const metaA = mustMeta(sim, a);
    const metaB = mustMeta(sim, b);
    metaB.copper = 50;
    sim.addItemInstance(BASE_ID, generated(UID_A, 1120), a);
    openTrade(sim, a, b);
    sim.tradeSetOffer([{ itemId: BASE_ID, count: 1, instanceUid: UID_A }], 0, a);
    sim.tradeSetOffer([], 50, b);

    sim.discardItem(BASE_ID, 1, a, UID_A);
    sim.tradeConfirm(a);
    sim.tradeConfirm(b);

    expect(sim.tradeFor(a)).toBeNull();
    expect(metaA.copper).toBe(0);
    expect(metaB.copper).toBe(50);
    expect(uidSlots(metaB, UID_A)).toHaveLength(0);
    expect(
      sim
        .drainEvents()
        .some(
          (event) =>
            event.type === 'error' &&
            event.text === 'Trade failed: items or money no longer available.',
        ),
    ).toBe(true);
  });

  it.each(['inventory', 'bank', 'buyback', 'equipment'] as const)(
    'rejects a recipient %s UID collision before copper or either inventory mutates',
    (container) => {
      const sim = makeWorld();
      const a = cleanPlayer(sim, 'warrior', `TradeCollisionAlice-${container}`);
      const b = cleanPlayer(sim, 'mage', `TradeCollisionBob-${container}`);
      const metaA = mustMeta(sim, a);
      const metaB = mustMeta(sim, b);
      const exact = generated(UID_A, 1125, { signer: `Trade collision ${container}` });
      sim.addItemInstance(BASE_ID, exact, a);
      const duplicate = {
        itemId: BASE_ID,
        count: 1,
        instance: cloneProceduralPayload(exact),
      };
      if (container === 'inventory') metaB.inventory.push(duplicate);
      if (container === 'bank') metaB.bank.inventory.push(duplicate);
      if (container === 'buyback') metaB.vendorBuyback.push(duplicate);
      if (container === 'equipment') {
        metaB.equipment.ring1 = BASE_ID;
        metaB.equipmentInstance.ring1 = cloneProceduralPayload(exact);
      }
      metaA.copper = 10;
      metaB.copper = 20;
      openTrade(sim, a, b);
      sim.tradeSetOffer([{ itemId: BASE_ID, count: 1, instanceUid: UID_A }], 0, a);
      sim.tradeSetOffer([], 5, b);

      expect(() => {
        sim.tradeConfirm(a);
        sim.tradeConfirm(b);
      }).not.toThrow();
      expect(sim.tradeFor(a)).toBeNull();
      expect(uidSlots(metaA, UID_A)).toHaveLength(1);
      expect(metaA.copper).toBe(10);
      expect(metaB.copper).toBe(20);
      expect(
        sim
          .drainEvents()
          .some(
            (event) =>
              event.type === 'error' &&
              event.text === 'Trade failed: items or money no longer available.',
          ),
      ).toBe(true);
    },
  );

  it('preflights a reverse-direction generic procedural transfer against recipient containers', () => {
    const sim = makeWorld();
    const a = cleanPlayer(sim, 'warrior', 'GenericCollisionAlice');
    const b = cleanPlayer(sim, 'mage', 'GenericCollisionBob');
    const metaA = mustMeta(sim, a);
    const metaB = mustMeta(sim, b);
    const exact = generated(UID_B, 1126, { signer: 'Generic reverse collision' });
    sim.addItemInstance(BASE_ID, exact, b);
    metaA.bank.inventory.push({
      itemId: BASE_ID,
      count: 1,
      instance: cloneProceduralPayload(exact),
    });
    metaA.copper = 20;
    metaB.copper = 10;
    openTrade(sim, a, b);
    sim.tradeSetOffer([], 5, a);
    sim.tradeSetOffer([{ itemId: BASE_ID, count: 1 }], 0, b);

    expect(() => {
      sim.tradeConfirm(a);
      sim.tradeConfirm(b);
    }).not.toThrow();
    expect(sim.tradeFor(a)).toBeNull();
    expect(uidSlots(metaB, UID_B)).toHaveLength(1);
    expect(metaA.copper).toBe(20);
    expect(metaB.copper).toBe(10);
  });
  it('reserves exact UIDs from generic same-base scans in both directions at full capacity', () => {
    const sim = makeWorld();
    const a = cleanPlayer(sim, 'warrior', 'CapacityAlice');
    const b = cleanPlayer(sim, 'mage', 'CapacityBob');
    const metaA = mustMeta(sim, a);
    const metaB = mustMeta(sim, b);
    const aGeneric = generated('pi1:economy-authority:1131', 1131);
    const aExact = generated('pi1:economy-authority:1132', 1132);
    const bGeneric = generated('pi1:economy-authority:1133', 1133);
    const bExact = generated('pi1:economy-authority:1134', 1134);
    sim.addItemInstance(BASE_ID, aGeneric, a);
    sim.addItemInstance(BASE_ID, aExact, a);
    sim.addItemInstance(BASE_ID, bGeneric, b);
    sim.addItemInstance(BASE_ID, bExact, b);
    fillBackpack(metaA);
    fillBackpack(metaB);
    openTrade(sim, a, b);

    sim.tradeSetOffer(
      [
        { itemId: BASE_ID, count: 1 },
        {
          itemId: BASE_ID,
          count: 1,
          instanceUid: aExact.procedural?.uid,
        },
      ],
      0,
      a,
    );
    sim.tradeSetOffer(
      [
        { itemId: BASE_ID, count: 1 },
        {
          itemId: BASE_ID,
          count: 1,
          instanceUid: bExact.procedural?.uid,
        },
      ],
      0,
      b,
    );
    sim.tradeConfirm(a);
    sim.tradeConfirm(b);

    expect(sim.tradeFor(a)).toBeNull();
    expect(metaA.inventory).toHaveLength(16);
    expect(metaB.inventory).toHaveLength(16);
    expect(allInventoryUids(metaA).sort()).toEqual(
      [bGeneric.procedural?.uid, bExact.procedural?.uid].sort(),
    );
    expect(allInventoryUids(metaB).sort()).toEqual(
      [aGeneric.procedural?.uid, aExact.procedural?.uid].sort(),
    );
    expect(
      duplicateProceduralItemUids({
        inventory: [...metaA.inventory, ...metaB.inventory],
      }),
    ).toEqual([]);
  });

  it('re-resolves current payload state and binds an armed copy to the recipient', () => {
    const sim = makeWorld();
    const a = cleanPlayer(sim, 'warrior', 'BindingAlice');
    const b = cleanPlayer(sim, 'mage', 'BindingBob');
    const metaA = mustMeta(sim, a);
    const metaB = mustMeta(sim, b);
    sim.addItemInstance(
      BASE_ID,
      generated(UID_A, 1140, { signer: 'Before', bindOnTrade: true }),
      a,
    );
    openTrade(sim, a, b);
    sim.tradeSetOffer([{ itemId: BASE_ID, count: 1, instanceUid: UID_A }], 0, a);

    const authoritative = uidSlots(metaA, UID_A)[0]?.instance;
    if (!authoritative) throw new Error('missing authoritative instance');
    authoritative.signer = 'Changed after staging';
    authoritative.enchant = 'keen_edge';
    sim.tradeConfirm(a);
    sim.tradeConfirm(b);

    const received = uidSlots(metaB, UID_A)[0]?.instance;
    expect(received?.signer).toBe('Changed after staging');
    expect(received?.enchant).toBe('keen_edge');
    expect(received?.bindOnTrade).toBe(true);
    expect(received?.boundTo).toBe(b);
  });
});

describe('procedural mail exact-copy authority', () => {
  it('persists the selected same-base B payload, redacts public secrets, and takes exactly once', () => {
    const sim = makeWorld();
    const alice = cleanPlayer(sim, 'warrior', 'MailAlice');
    cleanPlayer(sim, 'mage', 'MailBob');
    const aliceMeta = mustMeta(sim, alice);
    aliceMeta.copper = 1_000;
    const copyA = generated(UID_A, 1201, { signer: 'Mail A' });
    const copyB = generated(UID_B, 1202, {
      signer: 'Mail B',
      enchant: 'keen_edge',
    });
    sim.addItemInstance(BASE_ID, copyA, alice);
    sim.addItemInstance(BASE_ID, copyB, alice);
    moveToMailbox(sim, alice);
    sim.mailSend(
      'MailBob',
      'Exact persisted parcel',
      'B only',
      25,
      [{ itemId: BASE_ID, count: 1, instanceUid: UID_B }],
      alice,
    );

    expect(uidSlots(aliceMeta, UID_A)).toHaveLength(1);
    expect(uidSlots(aliceMeta, UID_B)).toHaveLength(0);
    expect(aliceMeta.copper).toBe(1_000 - 25 - MAIL_POSTAGE);
    expect(rawMail(sim, 'Exact persisted parcel').items[0]?.instance).toEqual(copyB);
    const saved = sim.serializeMail();
    expect(
      saved.mail.find((message) => message.subject === 'Exact persisted parcel')?.items[0]
        ?.instance,
    ).toEqual(copyB);

    const loaded = makeWorld();
    cleanPlayer(loaded, 'warrior', 'MailAlice');
    const loadedBob = cleanPlayer(loaded, 'mage', 'MailBob');
    const loadedBobMeta = mustMeta(loaded, loadedBob);
    loaded.loadMail(structuredClone(saved));
    deliverNow(loaded, 'Exact persisted parcel');
    moveToMailbox(loaded, loadedBob);
    const publicLetter = loaded
      .mailInfoFor(loadedBob)
      ?.messages.find((message) => message.subject === 'Exact persisted parcel');
    const publicProcedural = publicLetter?.items[0]?.instance?.procedural;
    expect(publicLetter?.items[0]?.instance?.signer).toBe('Mail B');
    expect(publicProcedural).toBeDefined();
    expect(publicProcedural).not.toHaveProperty('uid');
    expect(publicProcedural).not.toHaveProperty('seed');
    expect(publicProcedural).not.toHaveProperty('dropContext');

    if (!publicLetter) throw new Error('mail did not load');
    loaded.mailTake(publicLetter.id, loadedBob);
    expect(uidSlots(loadedBobMeta, UID_B)).toHaveLength(1);
    expect(uidSlots(loadedBobMeta, UID_B)[0]?.instance).toEqual(copyB);
    loaded.mailTake(publicLetter.id, loadedBob);
    expect(uidSlots(loadedBobMeta, UID_B)).toHaveLength(1);
  });

  it('rejects duplicate, malformed, stale, and bound UIDs before postage or escrow mutation', () => {
    const sim = makeWorld();
    const alice = cleanPlayer(sim, 'warrior', 'InvalidMailAlice');
    cleanPlayer(sim, 'mage', 'InvalidMailBob');
    const meta = mustMeta(sim, alice);
    meta.copper = 2_000;
    sim.addItem(BASE_ID, 1, alice);
    sim.addItemInstance(BASE_ID, generated(UID_A, 1210), alice);
    sim.addItemInstance(
      BASE_ID,
      generated(UID_B, 1211, { bindOnTrade: true, boundTo: alice }),
      alice,
    );
    moveToMailbox(sim, alice);
    const before = {
      copper: meta.copper,
      inventory: structuredClone(meta.inventory),
      mail: sim.serializeMail(),
    };

    const attempts = [
      [
        { itemId: BASE_ID, count: 1, instanceUid: UID_A },
        { itemId: BASE_ID, count: 1, instanceUid: UID_A },
      ],
      [{ itemId: BASE_ID, count: 1, instanceUid: '' }],
      [{ itemId: BASE_ID, count: 1, instanceUid: 'pi1:stale:missing' }],
      [{ itemId: BASE_ID, count: 1, instanceUid: UID_B }],
    ];
    for (const [index, attachments] of attempts.entries()) {
      sim.mailSend(
        'InvalidMailBob',
        `Invalid ${index}`,
        'must not mutate',
        100,
        attachments,
        alice,
      );
      expect(meta.copper).toBe(before.copper);
      expect(meta.inventory).toEqual(before.inventory);
      expect(sim.serializeMail()).toEqual(before.mail);
    }
  });

  it.each(['inventory', 'bank', 'buyback', 'equipment'] as const)(
    'rejects a recipient %s UID collision atomically before coin or earlier parcels move',
    (container) => {
      const sim = makeWorld();
      const alice = cleanPlayer(sim, 'warrior', `CollisionAlice-${container}`);
      const bob = cleanPlayer(sim, 'mage', `CollisionBob-${container}`);
      const aliceMeta = mustMeta(sim, alice);
      const bobMeta = mustMeta(sim, bob);
      aliceMeta.copper = 2_000;
      const exact = generated(UID_A, 1220, { signer: `Collision ${container}` });
      sim.addItem('roasted_boar', 1, alice);
      sim.addItemInstance(BASE_ID, exact, alice);
      moveToMailbox(sim, alice);
      sim.mailSend(
        `CollisionBob-${container}`,
        `Collision ${container}`,
        'atomic',
        75,
        [
          { itemId: 'roasted_boar', count: 1 },
          { itemId: BASE_ID, count: 1, instanceUid: UID_A },
        ],
        alice,
      );
      const message = deliverNow(sim, `Collision ${container}`);
      moveToMailbox(sim, bob);

      const duplicate = {
        itemId: BASE_ID,
        count: 1,
        instance: cloneProceduralPayload(exact),
      };
      if (container === 'inventory') bobMeta.inventory.push(duplicate);
      if (container === 'bank') bobMeta.bank.inventory.push(duplicate);
      if (container === 'buyback') bobMeta.vendorBuyback.push(duplicate);
      if (container === 'equipment') {
        bobMeta.equipment.ring1 = BASE_ID;
        bobMeta.equipmentInstance.ring1 = cloneProceduralPayload(exact);
      }
      const copperBefore = bobMeta.copper;
      sim.mailTake(message.id, bob);

      expect(bobMeta.copper).toBe(copperBefore);
      expect(sim.countItem('roasted_boar', bob)).toBe(0);
      expect(message.copper).toBe(75);
      expect(message.items).toHaveLength(2);
      expect(message.items[1]?.instance?.procedural?.uid).toBe(UID_A);
      expect(
        sim
          .drainEvents()
          .some((event) => event.type === 'mailResult' && event.code === 'notEnoughItems'),
      ).toBe(true);
    },
  );

  it('keeps an exact armed parcel attached while bags are full, then binds it on collection', () => {
    const sim = makeWorld();
    const alice = cleanPlayer(sim, 'warrior', 'CapacityMailAlice');
    const bob = cleanPlayer(sim, 'mage', 'CapacityMailBob');
    const aliceMeta = mustMeta(sim, alice);
    const bobMeta = mustMeta(sim, bob);
    aliceMeta.copper = 1_000;
    const armed = generated(UID_A, 1230, {
      signer: 'Bind on collection',
      bindOnTrade: true,
    });
    sim.addItemInstance(BASE_ID, armed, alice);
    moveToMailbox(sim, alice);
    sim.mailSend(
      'CapacityMailBob',
      'Full bags exact',
      'wait',
      0,
      [{ itemId: BASE_ID, count: 1, instanceUid: UID_A }],
      alice,
    );
    const message = deliverNow(sim, 'Full bags exact');
    moveToMailbox(sim, bob);
    const publicParcel = sim
      .mailInfoFor(bob)
      ?.messages.find((entry) => entry.subject === 'Full bags exact')?.items[0]?.instance;
    expect(publicParcel?.bindOnTrade).toBe(true);
    expect(publicParcel?.procedural).not.toHaveProperty('uid');
    expect(publicParcel?.procedural).not.toHaveProperty('seed');
    expect(publicParcel?.procedural).not.toHaveProperty('dropContext');

    fillBackpack(bobMeta);

    sim.mailTake(message.id, bob);
    expect(uidSlots(bobMeta, UID_A)).toHaveLength(0);
    expect(message.items).toHaveLength(1);
    expect(message.items[0]?.instance?.boundTo).toBeUndefined();

    bobMeta.inventory.pop();
    sim.mailTake(message.id, bob);
    expect(message.items).toHaveLength(0);
    expect(uidSlots(bobMeta, UID_A)).toHaveLength(1);
    expect(uidSlots(bobMeta, UID_A)[0]?.instance?.boundTo).toBe(bob);
    expect(uidSlots(bobMeta, UID_A)[0]?.instance?.bindOnTrade).toBe(true);
  });

  it('loads mail atomically and leaves the existing book untouched on a duplicate UID', () => {
    const source = makeWorld();
    const alice = cleanPlayer(source, 'warrior', 'LoadAlice');
    cleanPlayer(source, 'mage', 'LoadBob');
    const aliceMeta = mustMeta(source, alice);
    aliceMeta.copper = 1_000;
    simGrantAndMail(source, alice, 'LoadBob', 'Duplicate load', generated(UID_A, 1240));
    const valid = source.serializeMail();
    const exactLetter = valid.mail.find((message) => message.subject === 'Duplicate load');
    if (!exactLetter) throw new Error('missing persisted exact letter');
    const corrupt: MailSave = structuredClone(valid);
    corrupt.mail.push({
      ...structuredClone(exactLetter),
      id: exactLetter.id + 10_000,
      subject: 'Duplicate load replay',
    });

    const target = makeWorld();
    cleanPlayer(target, 'priest', 'ExistingKeeper');
    const before = target.serializeMail();
    expect(() => target.loadMail(corrupt)).toThrow(
      `Duplicate procedural item UID in mail state: ${UID_A}`,
    );
    expect(target.serializeMail()).toEqual(before);
  });

  it('recognizes an impossible multi-count procedural mail slot as a UID collision', () => {
    const exact = generated(UID_A, 1250);
    expect(
      duplicateProceduralItemUids({
        mail: [{ itemId: BASE_ID, count: 2, instance: exact }],
      }),
    ).toEqual([UID_A]);
  });
});

describe('procedural economy wire projections', () => {
  it('retains UID only for the owner while redacting seed and provenance from both views', () => {
    const exact = generated(UID_A, 1300, {
      signer: 'Projection',
      enchant: 'keen_edge',
      bindOnTrade: true,
    });
    const owner = ownerItemInstanceView(exact);
    const other = publicItemInstanceView(exact);

    expect(owner.procedural?.uid).toBe(UID_A);
    expect(owner.procedural).not.toHaveProperty('seed');
    expect(owner.procedural).not.toHaveProperty('dropContext');
    expect(other.procedural).not.toHaveProperty('uid');
    expect(other.procedural).not.toHaveProperty('seed');
    expect(other.procedural).not.toHaveProperty('dropContext');
    expect(owner.signer).toBe('Projection');
    expect(other.signer).toBe('Projection');
    expect(owner.bindOnTrade).toBe(true);
    expect(other.bindOnTrade).toBe(true);
  });
});

function simGrantAndMail(
  sim: Sim,
  sender: number,
  recipientName: string,
  subject: string,
  instance: ItemInstancePayload,
): void {
  sim.addItemInstance(BASE_ID, instance, sender);
  moveToMailbox(sim, sender);
  sim.mailSend(
    recipientName,
    subject,
    'payload',
    0,
    [
      {
        itemId: BASE_ID,
        count: 1,
        instanceUid: instance.procedural?.uid,
      },
    ],
    sender,
  );
}
