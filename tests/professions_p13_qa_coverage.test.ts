// Phase 13 QA coverage closures, added by the QA session. Closes the
// decisive-pin gaps the shipped suites left open:
//   1. The rare+ NO-typed-material (jewelry) resolve arm: primary only, ZERO
//      rng draws, even at epic where a typed secondary WOULD ride a draw. The
//      shipped pin (professions_typed_reagents.test.ts) is conditional on a
//      rare neck/ring existing in the catalog, so it can be vacuous; this one
//      registers a synthetic epic amulet and is decisive regardless.
//   2. tradeSetOffer's PARTIAL clamp: a mixed bound/unbound stock clamps the
//      offer line to the unbound copies (the shipped test only covers the
//      all-bound empty-offer case), and a multi-line bound shortfall denies
//      exactly ONCE for the whole offer (the boundDenied flag).
//   3. ClientWorld mirror negative arms: a non-result event never touches the
//      lastX stashes, and a field-stripped malformed result event never throws.
//   4. The salvage resolver's unknown_item reason through the Sim delegate
//      (not_salvageable/not_held/throttled are pinned elsewhere; this one was
//      not).
import { afterAll, describe, expect, it } from 'vitest';
import { ClientWorld } from '../src/net/online';
import { bagCapacity } from '../src/sim/bags';
import { ITEMS } from '../src/sim/data';
import { typedSecondaryFor } from '../src/sim/professions/disenchant_reagents';
import { resolveDisenchant } from '../src/sim/professions/enchanting';
import { Sim } from '../src/sim/sim';
import * as tradeMod from '../src/sim/social/trade';
import type { ItemDef, ItemInstancePayload, SimEvent } from '../src/sim/types';

const STEEL = 'resonant_steel';
const HIDE = 'resonant_hide';
const BOUND_ERROR = 'That item is bound and cannot be traded.';
const QA_AMULET = '__p13_qa_epic_amulet';

afterAll(() => {
  delete (ITEMS as Record<string, ItemDef>)[QA_AMULET];
});

function makeSim(seed = 7) {
  return new Sim({ seed, playerClass: 'warrior', autoEquip: false });
}

function countDraws<T>(sim: Sim, fn: () => T): { result: T; draws: number } {
  let draws = 0;
  sim.ctx.rng.setObserver(() => {
    draws += 1;
  });
  try {
    return { result: fn(), draws };
  } finally {
    sim.ctx.rng.setObserver(null);
  }
}

function slotFor(sim: Sim, pid: number, itemId: string) {
  return sim.ctx.resolve(pid)?.meta.inventory.find((s) => s.itemId === itemId);
}

function makeTradeSim(seed = 42) {
  const sim = new Sim({ seed, playerClass: 'warrior', autoEquip: false, noPlayer: true });
  const a = sim.addPlayer('warrior', 'Ayla');
  const b = sim.addPlayer('warrior', 'Borin');
  const ea = sim.ctx.entities.get(a)!;
  const eb = sim.ctx.entities.get(b)!;
  eb.pos.x = ea.pos.x + 2;
  eb.pos.z = ea.pos.z;
  return { sim, a, b };
}

function grantInstance(sim: Sim, itemId: string, payload: ItemInstancePayload, pid: number) {
  sim.ctx.addItemInstance(itemId, payload, pid);
}

// ---------------------------------------------------------------------------
// 1. Rare+ jewelry (no typed material): primary only, zero draws, decisively.
// ---------------------------------------------------------------------------
describe('rare+ disenchant with NO typed material (jewelry arm, decisive)', () => {
  it('an epic neck piece yields exactly one arcane_shard, no secondary, and ZERO rng draws', () => {
    const def = {
      id: QA_AMULET,
      name: 'QA Epic Amulet',
      kind: 'armor',
      quality: 'epic',
      slot: 'neck',
      sellValue: 10,
    } as unknown as ItemDef;
    // The mapper's jewelry claim, pinned without depending on the catalog
    // shipping a rare+ neck/ring (the shipped pin is conditional on that).
    expect(typedSecondaryFor(def)).toBeNull();

    (ITEMS as Record<string, ItemDef>)[QA_AMULET] = def;
    const sim = makeSim();
    const pid = sim.playerId;
    sim.addItem(QA_AMULET, 1, pid);
    const { result, draws } = countDraws(sim, () => resolveDisenchant(sim.ctx, pid, QA_AMULET));
    expect(result.ok).toBe(true);
    // The epic 1-or-2 secondary draw must NOT run when there is no secondary:
    // the no-typed-material arm is draw-free end to end.
    expect(draws).toBe(0);
    expect(result.materialItemId).toBe('arcane_shard');
    expect(result.count).toBe(1);
    expect(result.secondaryItemId).toBeUndefined();
    expect(result.secondaryCount).toBeUndefined();
    expect(sim.countItem('arcane_shard', pid)).toBe(1);
    expect(sim.countItem(QA_AMULET, pid)).toBe(0);
    // No typed material leaked in from the fallback buckets.
    expect(sim.countItem(STEEL, pid)).toBe(0);
    expect(sim.countItem('resonant_timber', pid)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 2. tradeSetOffer partial clamp + deny-once.
// ---------------------------------------------------------------------------
describe('tradeSetOffer bound-copy clamp (partial stock + deny-once)', () => {
  it('clamps a mixed line to the unbound copies with exactly one deny, and the swap moves only those', () => {
    const { sim, a, b } = makeTradeSim();
    // A holds THREE copies: one bound to A (locked) and two armed-unstamped
    // (offerable), the latter stacking byte-equal into one count-2 slot.
    grantInstance(sim, STEEL, { bindOnTrade: true, boundTo: a }, a);
    grantInstance(sim, STEEL, { bindOnTrade: true }, a);
    grantInstance(sim, STEEL, { bindOnTrade: true }, a);
    expect(sim.countItem(STEEL, a)).toBe(3);

    tradeMod.tradeRequest(sim.ctx, b, a);
    tradeMod.tradeAccept(sim.ctx, b);
    sim.drainEvents();
    tradeMod.tradeSetOffer(sim.ctx, [{ itemId: STEEL, count: 3 }], 0, a);

    // Exactly ONE localized deny for the whole offer.
    const denies = sim.drainEvents().filter((e) => e.type === 'error' && e.text === BOUND_ERROR);
    expect(denies).toHaveLength(1);
    // The line clamped to the 2 unbound copies rather than dropping entirely.
    const session = tradeMod.tradeFor(sim.ctx, a);
    const aOffer = session?.a === a ? session?.offerA : session?.offerB;
    expect(aOffer?.items).toEqual([{ itemId: STEEL, count: 2 }]);

    // The completed swap moves ONLY the unbound copies: B receives 2 (stamped
    // to B on grant), A keeps exactly the A-bound copy.
    tradeMod.tradeConfirm(sim.ctx, a);
    tradeMod.tradeConfirm(sim.ctx, b);
    expect(sim.countItem(STEEL, b)).toBe(2);
    const bSlot = slotFor(sim, b, STEEL);
    expect(bSlot?.count).toBe(2);
    expect(bSlot?.instance?.boundTo).toBe(b);
    expect(sim.countItem(STEEL, a)).toBe(1);
    expect(slotFor(sim, a, STEEL)?.instance?.boundTo).toBe(a);
  });

  it('two bound-short lines in one offer deny once total, not once per line', () => {
    const { sim, a, b } = makeTradeSim(43);
    grantInstance(sim, STEEL, { bindOnTrade: true, boundTo: a }, a);
    grantInstance(sim, HIDE, { bindOnTrade: true, boundTo: a }, a);

    tradeMod.tradeRequest(sim.ctx, b, a);
    tradeMod.tradeAccept(sim.ctx, b);
    sim.drainEvents();
    tradeMod.tradeSetOffer(
      sim.ctx,
      [
        { itemId: STEEL, count: 1 },
        { itemId: HIDE, count: 1 },
      ],
      0,
      a,
    );

    const denies = sim.drainEvents().filter((e) => e.type === 'error' && e.text === BOUND_ERROR);
    expect(denies).toHaveLength(1); // the boundDenied flag coalesces the whole offer
    const session = tradeMod.tradeFor(sim.ctx, a);
    const aOffer = session?.a === a ? session?.offerA : session?.offerB;
    expect(aOffer?.items).toEqual([]); // both all-bound lines dropped entirely
  });
});

// ---------------------------------------------------------------------------
// 3. ClientWorld mirror negative arms.
// ---------------------------------------------------------------------------
type MirrorInternals = {
  applyDisenchantResultEvent(ev: SimEvent): void;
  applyEnchantResultEvent(ev: SimEvent): void;
  applySalvageResultEvent(ev: SimEvent): void;
};

function bareMirrorClient(): ClientWorld {
  return Object.create(ClientWorld.prototype) as ClientWorld;
}

describe('ClientWorld result-event mirror negative arms', () => {
  it('a non-result event leaves every lastX stash untouched', () => {
    const client = bareMirrorClient();
    const sentinelD = { ok: true, itemId: 'd' };
    const sentinelE = { ok: true, itemId: 'e', enchantId: 'x' };
    const sentinelS = { ok: true, itemId: 's' };
    (client as any).lastDisenchantResult = sentinelD;
    (client as any).lastEnchantResult = sentinelE;
    (client as any).lastSalvageResult = sentinelS;
    const internals = client as unknown as MirrorInternals;
    const foreign = { type: 'log', text: 'nothing to see', color: '#fff' } as unknown as SimEvent;
    internals.applyDisenchantResultEvent(foreign);
    internals.applyEnchantResultEvent(foreign);
    internals.applySalvageResultEvent(foreign);
    // Cross-type discrimination too: a disenchantResult must never bleed into
    // the enchant/salvage stashes and vice versa.
    internals.applyEnchantResultEvent({
      type: 'disenchantResult',
      ok: false,
      itemId: 'z',
      reason: 'not_held',
      pid: 1,
    } as unknown as SimEvent);
    internals.applySalvageResultEvent({
      type: 'enchantResult',
      ok: false,
      itemId: 'z',
      enchantId: 'q',
      pid: 1,
    } as unknown as SimEvent);
    expect(client.lastDisenchantResult).toBe(sentinelD);
    expect(client.lastEnchantResult).toBe(sentinelE);
    expect(client.lastSalvageResult).toBe(sentinelS);
  });

  it('a field-stripped malformed result event never throws (mirror stays total)', () => {
    const client = bareMirrorClient();
    const internals = client as unknown as MirrorInternals;
    expect(() => {
      internals.applyDisenchantResultEvent({ type: 'disenchantResult' } as unknown as SimEvent);
      internals.applyEnchantResultEvent({ type: 'enchantResult' } as unknown as SimEvent);
      internals.applySalvageResultEvent({ type: 'salvageResult' } as unknown as SimEvent);
    }).not.toThrow();
    // The stashes took the (undefined-fielded) writes without corrupting shape.
    expect(client.lastDisenchantResult?.itemId).toBeUndefined();
    expect(client.lastEnchantResult?.enchantId).toBeUndefined();
    expect(client.lastSalvageResult?.materialItemId).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 4. Salvage unknown_item through the Sim delegate.
// ---------------------------------------------------------------------------
describe('salvage unknown_item reason (Sim delegate)', () => {
  it('an unknown item id denies with reason unknown_item and stashes it', () => {
    const sim = makeSim();
    sim.drainEvents();
    sim.salvageItem('__p13_qa_no_such_item');
    expect(sim.lastSalvageResult?.ok).toBe(false);
    expect(sim.lastSalvageResult?.reason).toBe('unknown_item');
    const ev = sim.drainEvents().filter((e) => e.type === 'salvageResult');
    expect(ev).toHaveLength(1);
    if (ev[0].type !== 'salvageResult') throw new Error('expected salvageResult');
    expect(ev[0].reason).toBe('unknown_item');
  });
});

// ---------------------------------------------------------------------------
// 5. tradeConfirm's capacity model vs the bind-on-trade stamp (found by this
//    QA session's capacity probe): grantOffer stamps boundTo onto an armed
//    copy as it arrives, and a stamped payload merges differently than the
//    giver's pre-stamp copy, so fitsAfterSwap must model the STAMPED arrival
//    (#2139: a capacity pre-check that disagrees with the real grant re-opens
//    the overflow class).
// ---------------------------------------------------------------------------
describe('tradeConfirm capacity model vs the bind-on-trade stamp', () => {
  const JUNK = 'wolf_pelt';
  const BAG_ERROR = 'Trade failed: not enough bag space.';

  function fillToCapacity(sim: Sim, pid: number): number {
    const cap = bagCapacity(sim.ctx.resolve(pid)!.meta.bags);
    let n = 0;
    while (sim.ctx.resolve(pid)!.meta.inventory.length < cap) {
      n += 1;
      sim.ctx.addItemInstance(JUNK, { rolled: { stats: { str: n } } }, pid);
    }
    return cap;
  }

  function runTrade(sim: Sim, a: number, b: number): string[] {
    tradeMod.tradeRequest(sim.ctx, b, a);
    tradeMod.tradeAccept(sim.ctx, b);
    sim.drainEvents();
    tradeMod.tradeSetOffer(sim.ctx, [{ itemId: STEEL, count: 1 }], 0, a);
    tradeMod.tradeConfirm(sim.ctx, a);
    tradeMod.tradeConfirm(sim.ctx, b);
    return sim
      .drainEvents()
      .filter((e) => e.type === 'error')
      .map((e) => (e as { text: string }).text);
  }

  it('a full receiver holding a byte-equal ARMED copy is refused, never granted over capacity', () => {
    const { sim, a, b } = makeTradeSim(44);
    // B's bags: one armed-unstamped steel slot (stack room), then junk to the
    // exact capacity. The incoming copy stamps to B on arrival, so it can NOT
    // merge with that pre-stamp slot: the only correct verdict is a refusal.
    grantInstance(sim, STEEL, { bindOnTrade: true }, b);
    const cap = fillToCapacity(sim, b);
    grantInstance(sim, STEEL, { bindOnTrade: true }, a);

    const errors = runTrade(sim, a, b);
    expect(errors).toContain(BAG_ERROR);
    expect(sim.ctx.resolve(b)!.meta.inventory.length).toBe(cap);
    expect(sim.countItem(STEEL, a)).toBe(1);
    expect(sim.countItem(STEEL, b)).toBe(1);
  });

  it('a full receiver whose byte-equal slot is ALREADY stamped to them fits via the real merge, past a locked decoy at a higher index', () => {
    const { sim, a, b } = makeTradeSim(45);
    // B's bags: a slot already stamped to B (the merge target), junk to the
    // exact capacity. A holds the offerable armed copy at a LOW index and an
    // A-locked decoy at a HIGHER index: the capacity walk must skip the decoy
    // (isTradeLocked) and model the offered copy's STAMPED arrival, which
    // merges into B's stamped slot without a fresh slot.
    grantInstance(sim, STEEL, { bindOnTrade: true, boundTo: b }, b);
    const cap = fillToCapacity(sim, b);
    grantInstance(sim, STEEL, { bindOnTrade: true }, a);
    grantInstance(sim, STEEL, { bindOnTrade: true, boundTo: a }, a);

    const errors = runTrade(sim, a, b);
    expect(errors).toEqual([]);
    expect(sim.ctx.resolve(b)!.meta.inventory.length).toBe(cap);
    const bSlot = slotFor(sim, b, STEEL);
    expect(sim.countItem(STEEL, b)).toBe(2);
    expect(bSlot?.count).toBe(2);
    expect(bSlot?.instance?.boundTo).toBe(b);
    // A keeps exactly the locked decoy.
    expect(sim.countItem(STEEL, a)).toBe(1);
    expect(slotFor(sim, a, STEEL)?.instance?.boundTo).toBe(a);
  });
});
