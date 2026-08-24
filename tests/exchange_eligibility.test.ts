// The shared exchange taxonomy + lock predicate (src/sim/exchange_eligibility.ts).
//
// Driven against the REAL merged content table wherever it can be, not only
// synthetic defs: the whole reason this module exists is that three enforcement
// points disagreed about real items (every mount is soulbound, every chroma
// plate is noMarketList), and a fixture-only suite would have passed while the
// live catalog stayed unsellable.

import { describe, expect, it } from 'vitest';
import { MOUNTS } from '../src/sim/content/mounts';
import { STATIONS } from '../src/sim/content/professions';
import { MECH_CHROMAS, mechChromaItemId } from '../src/sim/content/skins';
import { ITEMS } from '../src/sim/data';
import {
  type ExchangeLock,
  exchangeCategoryUsesQualityFloor,
  exchangeHardLock,
  exchangeItemCategory,
} from '../src/sim/exchange_eligibility';
import { isTransferLockedInstance } from '../src/sim/item_instance_transfer';
import { unbindItem } from '../src/sim/professions/commission';
import { Sim } from '../src/sim/sim';
import type { ItemDef, ItemInstancePayload } from '../src/sim/types';
import { VENDOR_TEST_WORLD } from './sim_shared';

const def = (over: Record<string, unknown>): ItemDef =>
  ({
    id: 'syn',
    name: 'Syn',
    kind: 'armor',
    quality: 'epic',
    sellValue: 1,
    ...over,
  }) as unknown as ItemDef;

describe('exchangeItemCategory: the content taxonomy', () => {
  it('classifies by the explicit discriminators before falling back to the slot', () => {
    expect(exchangeItemCategory(def({ kind: 'mount', mount: 'valorsteed' }))).toBe('mount');
    expect(exchangeItemCategory(def({ use: { type: 'mechChroma', chromaId: 'onyx_gold' } }))).toBe(
      'mech_chroma',
    );
    expect(exchangeItemCategory(def({ slot: 'chest' }))).toBe('equipment');
  });

  it('keeps a mount a mount even if one ever gains an equip slot', () => {
    // Order, stated as a property: classifying by slot first would drop a
    // slotted mount into equipment and silently apply the epic floor to it.
    expect(exchangeItemCategory(def({ kind: 'mount', mount: 'valorsteed', slot: 'trinket' }))).toBe(
      'mount',
    );
    expect(
      exchangeItemCategory(
        def({ use: { type: 'mechChroma', chromaId: 'onyx_gold' }, slot: 'chest' }),
      ),
    ).toBe('mech_chroma');
  });

  it('defaults CLOSED: an unrecognized def is not tradable', () => {
    // 'other' is what keeps a new content kind off the Exchange until someone
    // decides it belongs there, rather than it arriving by accident.
    expect(exchangeItemCategory(def({ kind: 'tool', slot: undefined }))).toBe('other');
    expect(exchangeItemCategory(def({ kind: 'consumable', slot: undefined }))).toBe('other');
  });
});

describe('exchangeHardLock: which locks a category tolerates', () => {
  it('refuses a quest item and a bound copy for EVERY category', () => {
    for (const d of [def({ kind: 'quest' }), def({ kind: 'quest', mount: 'valorsteed' })]) {
      expect(exchangeHardLock(d, undefined)).toBe('quest_item');
    }
    for (const d of [
      def({ slot: 'chest' }),
      def({ kind: 'mount', mount: 'valorsteed', soulbound: true }),
      def({ use: { type: 'mechChroma', chromaId: 'onyx_gold' }, noMarketList: true }),
    ]) {
      expect(exchangeHardLock(d, { boundTo: 7 })).toBe('bound_copy');
    }
  });

  it('tolerates soulbound ONLY for a mount', () => {
    expect(
      exchangeHardLock(def({ kind: 'mount', mount: 'valorsteed', soulbound: true }), undefined),
    ).toBe(null);
    expect(exchangeHardLock(def({ slot: 'chest', soulbound: true }), undefined)).toBe('soulbound');
    expect(
      exchangeHardLock(
        def({ use: { type: 'mechChroma', chromaId: 'onyx_gold' }, soulbound: true }),
        undefined,
      ),
    ).toBe('soulbound');
  });

  it('tolerates noMarketList ONLY for a chroma plate', () => {
    expect(
      exchangeHardLock(
        def({ use: { type: 'mechChroma', chromaId: 'onyx_gold' }, noMarketList: true }),
        undefined,
      ),
    ).toBe(null);
    expect(exchangeHardLock(def({ slot: 'chest', noMarketList: true }), undefined)).toBe(
      'no_market_list',
    );
    expect(
      exchangeHardLock(def({ kind: 'mount', mount: 'valorsteed', noMarketList: true }), undefined),
    ).toBe('no_market_list');
  });

  it('leaves ordinary equipment exactly as it was', () => {
    expect(exchangeHardLock(def({ slot: 'chest' }), undefined)).toBe(null);
  });

  it('refuses a still-armed commissioned copy, the state an unbind returns to', () => {
    // A commission is stamped on hand-off, so before the stamp the copy carries
    // bindOnTrade with no boundTo. Unbinding clears boundTo only, so a peeled
    // copy lands back in exactly this state and must not become resellable here.
    expect(exchangeHardLock(def({ slot: 'chest' }), { bindOnTrade: true })).toBe('bind_armed');
    expect(
      exchangeHardLock(def({ kind: 'mount', mount: 'valorsteed' }), { bindOnTrade: true }),
    ).toBe('bind_armed');
  });

  it('reports the stamp, not the arming, once a copy is actually bound', () => {
    // Precedence: an armed AND stamped copy is bound, and the refusal a player
    // sees must say so rather than describing the weaker state it grew out of.
    expect(exchangeHardLock(def({ slot: 'chest' }), { bindOnTrade: true, boundTo: 7 })).toBe(
      'bound_copy',
    );
    // pid 0 is a real character id, so the check is presence and never truthiness.
    expect(exchangeHardLock(def({ slot: 'chest' }), { boundTo: 0 })).toBe('bound_copy');
  });

  it('passes a never-armed and an explicitly disarmed copy', () => {
    expect(exchangeHardLock(def({ slot: 'chest' }), {})).toBe(null);
    expect(exchangeHardLock(def({ slot: 'chest' }), { bindOnTrade: false })).toBe(null);
    expect(exchangeHardLock(def({ slot: 'chest' }), { signer: 'Aldric' })).toBe(null);
  });

  it('refuses a copy the owner item-locked, on every category the exchange trades', () => {
    // R10: the player's own lock (issue 3042) reaches the $WOC rail exactly as
    // it reaches salvage, crafting, and vendor sale. Every tradable category,
    // because the mount and chroma tolerances above must not tunnel past it.
    expect(exchangeHardLock(def({ slot: 'chest' }), { locked: true })).toBe('locked');
    expect(exchangeHardLock(def({ kind: 'mount', mount: 'valorsteed' }), { locked: true })).toBe(
      'locked',
    );
    // An explicit false and an absent flag both stay tradable.
    expect(exchangeHardLock(def({ slot: 'chest' }), { locked: false })).toBe(null);
  });

  it('reports the permanent lock, not the liftable one, when a copy carries both', () => {
    // Precedence: unlocking a bound copy in the bags would not make it listable,
    // so the refusal the player sees must name the stronger fact.
    expect(exchangeHardLock(def({ slot: 'chest' }), { locked: true, boundTo: 7 })).toBe(
      'bound_copy',
    );
    expect(exchangeHardLock(def({ slot: 'chest' }), { locked: true, bindOnTrade: true })).toBe(
      'bind_armed',
    );
    expect(exchangeHardLock(def({ slot: 'chest', soulbound: true }), { locked: true })).toBe(
      'soulbound',
    );
  });
});

describe('the exchange rail refuses exactly what the sibling TRANSFER-lock pipes refuse', () => {
  // The gold market, Ravenpost mail and the guild bank all gate a per-copy state
  // through isTransferLockedInstance. The exchange is a fourth anonymous pipe, so
  // any TRANSFER-lock state one of them refuses and this one accepts is a
  // laundering route. The ONE deliberate asymmetry (ruling R10) is the player
  // item lock: the $WOC rail refuses it, the sibling pipes do not; it is a
  // separate axis (item_lock_flag.ts, not isTransferLockedInstance) and is
  // pinned as an explicit carve-out below, kept out of the parity table so the
  // parity claim stays exactly about the transfer-lock axis.
  const tradable = def({ slot: 'chest' });
  const STATES: [string, ItemInstancePayload, ExchangeLock | null][] = [
    ['a plain copy', {}, null],
    ['an armed copy', { bindOnTrade: true }, 'bind_armed'],
    ['an explicitly disarmed copy', { bindOnTrade: false }, null],
    ['a bound copy', { boundTo: 7 }, 'bound_copy'],
    ['a copy bound to pid 0', { boundTo: 0 }, 'bound_copy'],
    ['an armed and bound copy', { bindOnTrade: true, boundTo: 7 }, 'bound_copy'],
  ];

  it.each(STATES)('%s carries the expected exchange lock', (_name, instance, expected) => {
    expect(exchangeHardLock(tradable, instance)).toBe(expected);
  });

  // What this pins is DELEGATION on the transfer-lock axis: exchangeHardLock
  // calls isTransferLockedInstance, so a mutation of the predicate moves both
  // sides of the comparison together and this stays green by construction. The
  // direction it does catch is the rail re-implementing the rule (a second copy
  // that could drift). The predicate's own content is pinned by the literal
  // state table above and by tests/transfer_lock.test.ts.
  it.each(STATES)('%s reaches the same transfer-lock verdict on both rails', (_name, instance) => {
    expect(exchangeHardLock(tradable, instance) !== null).toBe(isTransferLockedInstance(instance));
  });

  it('the player item lock is the deliberate asymmetry: exchange refuses, transfer-lock ignores', () => {
    // R10: a copy the owner locked is NOT a transfer lock, so the sibling pipes
    // pass it, but the $WOC rail refuses it (the seller unlocks first). This is
    // the one state where the two rails part, and it is intentional.
    const lockedCopy: ItemInstancePayload = { locked: true };
    expect(isTransferLockedInstance(lockedCopy)).toBe(false);
    expect(exchangeHardLock(tradable, lockedCopy)).toBe('locked');
  });
});

describe('the REAL catalog clears every mount and every chroma plate', () => {
  it('has a mount item per catalog mount, and all of them pass the locks', () => {
    const mountItems = Object.values(ITEMS).filter((i) => exchangeItemCategory(i) === 'mount');
    // One tradable handle per catalog mount: a mount with no item behind it
    // would be untradable no matter what the policy said.
    expect(mountItems.length).toBe(Object.keys(MOUNTS).length);
    const blocked = mountItems.filter((i) => exchangeHardLock(i, undefined) !== null);
    expect(blocked.map((i) => i.id)).toEqual([]);
    // Non-vacuity, weakened deliberately in v0.35.0. It used to assert that EVERY
    // mount item is soulbound, which held when the tolerance was written: back then
    // the flag was what kept mounts out of the gold economy. v0.35.0 un-soulbound
    // the player reins on purpose ("Player reins are NOT soulbound, so ownership
    // transfers with the item", MountItemDef in types.ts), leaving only the
    // developer-only tank bound.
    //
    // So the honest bar is that AT LEAST ONE mount item is soulbound, which is what
    // makes the tolerance load-bearing rather than decorative. A non-soulbound mount
    // clears the locks without needing any tolerance at all.
    expect(mountItems.some((i) => i.soulbound === true)).toBe(true);
    expect(mountItems.length).toBeGreaterThanOrEqual(8);
  });

  it('has a plate per mech chroma, and all of them pass the locks', () => {
    const plates = MECH_CHROMAS.map((c) => ITEMS[mechChromaItemId(c.id) ?? '']).filter(Boolean);
    expect(plates.length).toBe(MECH_CHROMAS.length);
    for (const plate of plates) {
      expect(exchangeItemCategory(plate)).toBe('mech_chroma');
      expect(exchangeHardLock(plate, undefined)).toBe(null);
    }
    // Same non-vacuity check from the other side: every plate really is flagged
    // off the gold market, which is the flag this category tolerates.
    expect(plates.every((p) => p.noMarketList === true)).toBe(true);
    expect(plates.length).toBeGreaterThanOrEqual(15);
  });

  it('covers every rarity the two collections actually ship', () => {
    // "Regardless of rarity or tier" is the requirement; this pins that the
    // collections really do span more than one tier, so a floor would bite.
    const mountRarities = new Set(Object.values(MOUNTS).map((m) => m.rarity));
    expect(mountRarities.size).toBeGreaterThan(1);
    const chromaRanks = new Set(MECH_CHROMAS.map((c) => c.rank));
    expect(chromaRanks.size).toBeGreaterThan(1);
  });
});

describe('the peeled commission copy, composed against the REAL unbind', () => {
  // The bind_armed refusal above is stated as a property of a hand-built
  // payload, which is only worth what the claim behind it is worth: that the
  // master unbind service peels the STAMP and leaves the ARM. So drive the
  // real service (professions/commission.ts unbindItem, the deletion itself)
  // and read the rail's verdict off the payload it actually leaves behind.
  const SWORD = 'eastbrook_arming_sword'; // weapon, common quality, unbind fee 2500

  const stampedCommissionSim = (): { sim: Sim; pid: number } => {
    const sim = new Sim({
      seed: 7,
      playerClass: 'warrior',
      autoEquip: false,
      world: VENDOR_TEST_WORLD,
    });
    const pid = sim.playerId;
    const meta = sim.players.get(pid);
    const entity = sim.ctx.entities.get(pid);
    if (!meta || !entity) throw new Error('missing player');
    // A commissioned piece as it exists after hand-off: armed at craft time,
    // stamped by the trade that delivered it.
    sim.ctx.addItemInstance(SWORD, { bindOnTrade: true, boundTo: pid }, pid);
    meta.copper = 50000;
    entity.pos.x = STATIONS[0].pos.x;
    entity.pos.z = STATIONS[0].pos.z;
    return { sim, pid };
  };

  const swordInstance = (sim: Sim, pid: number): ItemInstancePayload | undefined => {
    const meta = sim.players.get(pid);
    if (!meta) throw new Error('missing player meta');
    return meta.inventory.find((s) => s.itemId === SWORD)?.instance;
  };

  it('returns to bind_armed, never to a plain tradable state', () => {
    const { sim, pid } = stampedCommissionSim();
    const swordDef = ITEMS[SWORD];
    // The control that makes the verdict below mean something: this def is
    // ordinary tradable equipment, so every refusal here comes from the copy.
    expect(exchangeHardLock(swordDef, {})).toBe(null);
    expect(exchangeHardLock(swordDef, swordInstance(sim, pid))).toBe('bound_copy');

    const result = unbindItem(sim.ctx, SWORD, pid);
    expect(result.ok).toBe(true);

    const peeled = swordInstance(sim, pid);
    // The real deletion, not a rebuilt object: boundTo is gone, the arm stays.
    expect(peeled).toEqual({ bindOnTrade: true });
    expect(isTransferLockedInstance(peeled)).toBe(true);
    expect(exchangeHardLock(swordDef, peeled)).toBe('bind_armed');
  });
});

describe('exchangeCategoryUsesQualityFloor', () => {
  it('applies the floor to equipment only', () => {
    expect(exchangeCategoryUsesQualityFloor('equipment')).toBe(true);
    expect(exchangeCategoryUsesQualityFloor('mount')).toBe(false);
    expect(exchangeCategoryUsesQualityFloor('mech_chroma')).toBe(false);
    expect(exchangeCategoryUsesQualityFloor('other')).toBe(false);
  });
});
