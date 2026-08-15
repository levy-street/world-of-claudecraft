// Phase 3 of the WARFARE tier refactor: the lifetimeHonor deed meter and the
// three rank titles it grants.
//
// The two properties that matter, and the reason this file exists rather than a
// few more rows in tests/deeds_content.test.ts (which pins the catalog, not the
// behaviour):
//  - RETRO GRANT. Meters re-evaluate on world join, so honor already banked by a
//    live character counts the moment the change ships. Proven by loading a
//    saved character whose lifetime honor is over a threshold with no deeds
//    earned and no honor awarded afterwards.
//  - LIFETIME, NEVER SPENDABLE. The meter reads PlayerMeta.lifetimeHonor, which
//    grantHonor only ever increases, so buying at the quartermaster can never
//    take a rank back. Driven by actually spending at the vendor, then wiping
//    the earned set and forcing a fresh pass: a meter reading meta.honor would
//    refuse to re-grant at that point, so the assertion is decisive rather than
//    a restatement of the resolver.

import { describe, expect, it } from 'vitest';
import { DEED_ORDER, DEEDS } from '../src/sim/content/deeds';
import { ITEMS } from '../src/sim/data';
import { deedIdsForDirtyKey, METER_DIRTY_KEYS, narrowKeysForTrigger } from '../src/sim/deeds';
import * as items from '../src/sim/items';
import { awardBattlegroundKillHonor, grantHonor } from '../src/sim/pvp/honor';
import type { CharacterState, PlayerMeta } from '../src/sim/sim';
import { Sim } from '../src/sim/sim';
import type { SimContext } from '../src/sim/sim_context';
import type { Entity, SimEvent } from '../src/sim/types';

// The ladder, restated independently of the catalog so a threshold, renown
// value, or title text edited in content reds here too.
const LADDER = [
  { id: 'pvp_honor_sergeant', amount: 10_000, renown: 10, title: 'Linebreaker' },
  { id: 'pvp_honor_knight_lieutenant', amount: 40_000, renown: 25, title: 'Fieldreaver' },
  { id: 'pvp_honor_field_marshal', amount: 150_000, renown: 50, title: 'Warcrowned' },
] as const;

function world(): Sim {
  return new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
}

function ctxOf(sim: Sim): SimContext {
  return (sim as unknown as { ctx: SimContext }).ctx;
}

/** A saved character carrying `lifetimeHonor` and `honor`, with the deed
 *  surface stripped: the loader must earn the rank from the meter alone. */
function savedVeteran(lifetimeHonor: number, honor = 0): CharacterState {
  const seed = world();
  const pid = seed.addPlayer('warrior', 'Veteran');
  const state = seed.serializeCharacter(pid) as CharacterState & {
    honor?: number;
    lifetimeHonor?: number;
    deeds?: Record<string, string>;
    renown?: number;
    activeTitle?: string | null;
  };
  state.honor = honor;
  state.lifetimeHonor = lifetimeHonor;
  state.deeds = undefined;
  state.renown = undefined;
  state.activeTitle = undefined;
  return state;
}

function loadVeteran(
  lifetimeHonor: number,
  honor = 0,
): { sim: Sim; pid: number; meta: PlayerMeta } {
  const sim = world();
  const pid = sim.addPlayer('warrior', 'Veteran', { state: savedVeteran(lifetimeHonor, honor) });
  return { sim, pid, meta: sim.meta(pid) as PlayerMeta };
}

/** Stand a fresh warrior at the honor quartermaster with empty bags. */
function atQuartermaster(sim: Sim): { pid: number; meta: PlayerMeta; vendor: Entity } {
  const pid = sim.addPlayer('warrior', 'Sarge');
  const vendor = [...sim.entities.values()].find(
    (e) => e.kind === 'npc' && e.templateId === 'fury',
  ) as Entity;
  const player = sim.entities.get(pid) as Entity;
  player.pos.x = vendor.pos.x;
  player.pos.z = vendor.pos.z;
  const meta = sim.meta(pid) as PlayerMeta;
  meta.inventory.length = 0;
  return { pid, meta, vendor };
}

/** The cheapest honor-priced row the quartermaster stocks. Resolved from the
 *  live vendor rather than a pinned item id, so a price or catalog retune in
 *  content/pvp_honor.ts cannot silently stop this test from spending. */
function cheapestHonorRow(vendor: Entity): { itemId: string; priceHonor: number } {
  const rows = vendor.vendorItems
    .map((itemId) => ({ itemId, priceHonor: ITEMS[itemId]?.priceHonor ?? 0 }))
    .filter((row) => row.priceHonor > 0)
    .sort((a, b) => a.priceHonor - b.priceHonor || a.itemId.localeCompare(b.itemId));
  expect(rows.length, 'the quartermaster must stock at least one honor-priced row').toBeGreaterThan(
    0,
  );
  return rows[0];
}

function unlockEvents(events: SimEvent[]): { deedId: string; retro?: boolean }[] {
  return events.filter(
    (e): e is Extract<SimEvent, { type: 'deedUnlocked' }> => e.type === 'deedUnlocked',
  );
}

describe('the lifetime-honor rank ladder (catalog)', () => {
  it('ships three appended pvp title deeds on the meter, in ascending order', () => {
    // Appended, never inserted: DEED_ORDER derives from table order, so the
    // three must sit contiguous in ladder order at their release point. The pin
    // is anchored at the ladder's own position because tail-relative indexing
    // breaks on every later catalog append (the absolute tail is deeds_content's
    // pin, not this file's).
    const at = DEED_ORDER.indexOf(LADDER[0].id);
    expect(at).toBeGreaterThanOrEqual(0);
    expect(DEED_ORDER.slice(at, at + LADDER.length)).toEqual(LADDER.map((rank) => rank.id));
    for (const rank of LADDER) {
      const def = DEEDS[rank.id];
      expect(def, rank.id).toBeDefined();
      expect(def.category, rank.id).toBe('pvp');
      expect(def.renown, rank.id).toBe(rank.renown);
      expect(def.trigger, rank.id).toEqual({
        kind: 'meter',
        meter: 'lifetimeHonor',
        amount: rank.amount,
      });
      expect(def.reward, rank.id).toEqual({ kind: 'title', text: rank.title });
      expect(def.feat ?? false, rank.id).toBe(false);
      expect(def.hidden ?? false, rank.id).toBe(false);
      expect(def.name.length, rank.id).toBeGreaterThan(0);
      expect(def.desc.length, rank.id).toBeGreaterThan(0);
    }
  });

  it('the thresholds ascend and each rank carries its own title text', () => {
    const amounts = LADDER.map((rank) => rank.amount);
    expect([...amounts].sort((a, b) => a - b)).toEqual(amounts);
    expect(new Set(LADDER.map((rank) => rank.title)).size).toBe(LADDER.length);
  });
});

describe('the lifetimeHonor meter declares no narrow dirty key', () => {
  it('maps to [] and subscribes to no narrow bucket', () => {
    // Honor moves only through grantHonor, at award sites that request a FULL
    // deed pass; the meter reads no deedStats ledger, so no narrow mark could
    // ever name it. A non-empty row here would silently subscribe the ladder to
    // a bucket whose mark site never touches honor.
    expect(METER_DIRTY_KEYS.lifetimeHonor).toEqual([]);
    for (const rank of LADDER) {
      expect(narrowKeysForTrigger(DEEDS[rank.id].trigger), rank.id).toEqual([]);
      for (const key of ['items', 'visited', 'earned', 'dungeonClears']) {
        expect(
          deedIdsForDirtyKey(key),
          `${rank.id} must not sit in the ${key} bucket`,
        ).not.toContain(rank.id);
      }
    }
  });

  it('a full pass grants the rank on the tick honor crosses the threshold', () => {
    // The other half of the [] decision: the award sites mark a full pass, and
    // a full pass must land the grant on that tick rather than deferring it.
    const sim = world();
    const { pid, meta } = atQuartermaster(sim);
    grantHonor(ctxOf(sim), meta, LADDER[0].amount, 'arena_win');
    ctxOf(sim).markDeedsDirty(pid);
    const events = sim.tick();
    expect(meta.deedsEarned.has(LADDER[0].id)).toBe(true);
    expect(unlockEvents(events).map((e) => e.deedId)).toContain(LADDER[0].id);
  });

  it('defers a rank crossed by the MID-MATCH drip until the next full pass', () => {
    // The honest half, which the cases above mask by marking dirty themselves.
    // The three RESULT sites mark a full pass, but the per-kill and per-assist
    // drip does not, so a threshold crossed by a killing blow lands at the end of
    // the match rather than on that tick. Pinned rather than fixed: adding a mark
    // to the per-kill path would put deed work on a combat hot path to make a
    // cosmetic title appear a few minutes sooner. If that trade is ever revisited,
    // this test is the one that should change, deliberately.
    const sim = world();
    const { pid, meta } = atQuartermaster(sim);
    grantHonor(ctxOf(sim), meta, LADDER[0].amount - 1, 'arena_win');
    ctxOf(sim).markDeedsDirty(pid);
    sim.tick();
    expect(meta.deedsEarned.has(LADDER[0].id), 'not yet at the threshold').toBe(false);

    // Cross it through the drip, which marks nothing.
    const kills = new Map<string, number>();
    awardBattlegroundKillHonor(ctxOf(sim), meta, 999, kills);
    expect(meta.lifetimeHonor).toBeGreaterThanOrEqual(LADDER[0].amount);
    sim.tick();
    expect(meta.deedsEarned.has(LADDER[0].id), 'the drip alone does not grant').toBe(false);

    // The next full pass, which any result award requests, lands it.
    ctxOf(sim).markDeedsDirty(pid);
    const events = sim.tick();
    expect(meta.deedsEarned.has(LADDER[0].id)).toBe(true);
    expect(unlockEvents(events).map((e) => e.deedId)).toContain(LADDER[0].id);
  });
});

describe('retro grant on world join', () => {
  it('a loaded veteran earns the rank from banked honor, having earned none since', () => {
    const { sim, meta } = loadVeteran(LADDER[0].amount);
    // The saved character carried no deeds and, crucially, ZERO spendable
    // honor: only the lifetime counter can have satisfied the trigger.
    expect(meta.honor).toBe(0);
    expect(meta.lifetimeHonor).toBe(LADDER[0].amount);
    expect(meta.deedsEarned.has(LADDER[0].id)).toBe(true);
    expect(meta.renown).toBe(LADDER[0].renown);
    // No honor was awarded on the join path.
    expect(sim.events.some((e) => e.type === 'honor')).toBe(false);
    const retro = unlockEvents(sim.tick()).find((e) => e.deedId === LADDER[0].id);
    expect(retro, 'the join grant must reach the client as a retro unlock').toBeDefined();
    expect(retro?.retro).toBe(true);
    // The title is selectable the moment the rank lands.
    expect(DEEDS[LADDER[0].id].reward).toEqual({ kind: 'title', text: LADDER[0].title });
  });

  it('grants every rank the banked honor clears, and none above it', () => {
    const { meta } = loadVeteran(LADDER[1].amount);
    expect(meta.deedsEarned.has(LADDER[0].id)).toBe(true);
    expect(meta.deedsEarned.has(LADDER[1].id)).toBe(true);
    expect(meta.deedsEarned.has(LADDER[2].id)).toBe(false);
    expect(meta.renown).toBe(LADDER[0].renown + LADDER[1].renown);
  });

  it('one honor short of a threshold grants nothing', () => {
    const { meta } = loadVeteran(LADDER[0].amount - 1);
    for (const rank of LADDER) expect(meta.deedsEarned.has(rank.id), rank.id).toBe(false);
    expect(meta.renown).toBe(0);
  });

  it('the top rank clears the whole ladder', () => {
    const { meta } = loadVeteran(LADDER[2].amount);
    for (const rank of LADDER) expect(meta.deedsEarned.has(rank.id), rank.id).toBe(true);
    expect(meta.renown).toBe(LADDER.reduce((sum, rank) => sum + rank.renown, 0));
  });
});

describe('spending at the quartermaster never costs a rank', () => {
  it('a purchase drains spendable honor, leaves lifetime honor and the title intact', () => {
    const sim = world();
    const { pid, meta, vendor } = atQuartermaster(sim);
    const row = cheapestHonorRow(vendor);
    // Bank exactly the first threshold, which the cheapest row is priced well
    // under, so the purchase provably drops spendable honor BELOW it.
    grantHonor(ctxOf(sim), meta, LADDER[0].amount, 'arena_win');
    ctxOf(sim).markDeedsDirty(pid);
    sim.tick();
    expect(meta.deedsEarned.has(LADDER[0].id)).toBe(true);
    sim.setActiveTitle(LADDER[0].id, pid);
    expect(meta.activeTitle).toBe(LADDER[0].id);

    items.buyItem(ctxOf(sim), vendor.id, row.itemId, pid);

    expect(sim.countItem(row.itemId, pid)).toBe(1);
    expect(meta.honor).toBe(LADDER[0].amount - row.priceHonor);
    expect(meta.honor, 'the purchase must take spendable honor under the threshold').toBeLessThan(
      LADDER[0].amount,
    );
    expect(meta.lifetimeHonor, 'lifetime honor is monotonic').toBe(LADDER[0].amount);
    for (let i = 0; i < 5; i++) sim.tick();
    expect(meta.deedsEarned.has(LADDER[0].id)).toBe(true);
    expect(meta.activeTitle).toBe(LADDER[0].id);
    expect(sim.entities.get(pid)?.title).toBe(LADDER[0].id);
  });

  it('the meter re-earns the rank after spending, so it reads lifetime and not the balance', () => {
    // The decisive arm. After the purchase, spendable honor sits below the
    // threshold while lifetime honor does not. Wipe the earned record and force
    // a fresh evaluation: a resolver reading meta.honor would refuse here.
    const sim = world();
    const { pid, meta, vendor } = atQuartermaster(sim);
    const row = cheapestHonorRow(vendor);
    grantHonor(ctxOf(sim), meta, LADDER[0].amount, 'arena_win');
    items.buyItem(ctxOf(sim), vendor.id, row.itemId, pid);
    expect(meta.honor).toBeLessThan(LADDER[0].amount);

    meta.deedsEarned.clear();
    meta.renown = 0;
    ctxOf(sim).markDeedsDirty(pid);
    sim.tick();

    expect(meta.deedsEarned.has(LADDER[0].id)).toBe(true);
    expect(meta.renown).toBe(LADDER[0].renown);
  });

  it('a rank already earned survives the save and load round trip after spending', () => {
    const sim = world();
    const { pid, meta, vendor } = atQuartermaster(sim);
    const row = cheapestHonorRow(vendor);
    grantHonor(ctxOf(sim), meta, LADDER[0].amount, 'arena_win');
    ctxOf(sim).markDeedsDirty(pid);
    sim.tick();
    sim.setActiveTitle(LADDER[0].id, pid);
    items.buyItem(ctxOf(sim), vendor.id, row.itemId, pid);
    const state = sim.serializeCharacter(pid) as CharacterState;

    const reloaded = world();
    const reloadedPid = reloaded.addPlayer('warrior', 'Sarge', { state });
    const reloadedMeta = reloaded.meta(reloadedPid) as PlayerMeta;
    expect(reloadedMeta.deedsEarned.has(LADDER[0].id)).toBe(true);
    expect(reloadedMeta.activeTitle).toBe(LADDER[0].id);
    expect(reloadedMeta.lifetimeHonor).toBe(LADDER[0].amount);
    expect(reloadedMeta.honor).toBe(LADDER[0].amount - row.priceHonor);
  });
});
