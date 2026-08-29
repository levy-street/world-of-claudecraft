// Storage price seam (Bank Storage phase 09): resolveStoragePrices per-dimension
// validation, the frozen defaults, aliasing safety, and the SimConfig.storagePrices
// override observed through the LIVE Sim quotes and charges (bankInfoFor /
// vaultInfoFor / bankBuySlots / bankUnlockSocket / vaultBuyUpgrade), plus a
// same-seed determinism arm proving an override perturbs nothing but prices.
//
// Every expected table below is a FRESH literal written out in this file, never
// the imported constant or DEFAULT_STORAGE_PRICES (comparing the resolver's
// output to the object it was minted from would be a self-comparison).
import { describe, expect, it } from 'vitest';
import { BUILTIN_WORLD } from '../src/sim/data';
import { Sim } from '../src/sim/sim';
import { resolveStoragePrices } from '../src/sim/storage_prices';
import type { Entity, WorldContent } from '../src/sim/types';

// The compiled defaults, restated as fresh literals.
const EXPANSIONS = [
  500, 1000, 2500, 5000, 10000, 20000, 40000, 80000, 150000, 300000, 600000, 1200000,
];
const SOCKETS = [1000000, 2000000, 3500000, 5000000];
const VAULT = [20000, 50000, 100000, 200000, 400000];

const DEFAULTS = { bankExpansions: EXPANSIONS, bankSockets: SOCKETS, vaultUpgrades: VAULT };

// A copy of the default with one entry replaced, for single-bad-entry arms.
const withEntry = (arr: readonly number[], i: number, v: number): number[] => {
  const copy = [...arr];
  copy[i] = v;
  return copy;
};

describe('resolveStoragePrices validation', () => {
  it('no override resolves to the compiled default tables', () => {
    expect(resolveStoragePrices(undefined)).toEqual(DEFAULTS);
    expect(resolveStoragePrices()).toEqual(DEFAULTS);
  });

  it('a null top level resolves to all defaults', () => {
    expect(resolveStoragePrices(null)).toEqual(DEFAULTS);
  });

  it('a non-object top level resolves to all defaults', () => {
    expect(resolveStoragePrices('cheap')).toEqual(DEFAULTS);
    expect(resolveStoragePrices(7)).toEqual(DEFAULTS);
    expect(resolveStoragePrices(true)).toEqual(DEFAULTS);
  });

  it('an array top level resolves to all defaults', () => {
    expect(resolveStoragePrices([1, 2, 3])).toEqual(DEFAULTS);
  });

  it('a missing dimension key falls back to that default alone', () => {
    const resolved = resolveStoragePrices({ bankSockets: [1, 2, 3, 4] });
    expect(resolved.bankSockets).toEqual([1, 2, 3, 4]);
    expect(resolved.bankExpansions).toEqual(EXPANSIONS);
    expect(resolved.vaultUpgrades).toEqual(VAULT);
  });

  it('a non-array dimension falls back', () => {
    expect(resolveStoragePrices({ bankExpansions: 500 }).bankExpansions).toEqual(EXPANSIONS);
    expect(resolveStoragePrices({ bankExpansions: 'cheap' }).bankExpansions).toEqual(EXPANSIONS);
    expect(resolveStoragePrices({ bankExpansions: { 0: 500 } }).bankExpansions).toEqual(EXPANSIONS);
    expect(resolveStoragePrices({ bankExpansions: null }).bankExpansions).toEqual(EXPANSIONS);
  });

  it('a wrong-length short dimension falls back', () => {
    expect(
      resolveStoragePrices({ bankExpansions: EXPANSIONS.slice(0, 11) }).bankExpansions,
    ).toEqual(EXPANSIONS);
    expect(resolveStoragePrices({ bankSockets: [1, 2, 3] }).bankSockets).toEqual(SOCKETS);
  });

  it('a wrong-length long dimension falls back', () => {
    expect(resolveStoragePrices({ bankExpansions: [...EXPANSIONS, 9] }).bankExpansions).toEqual(
      EXPANSIONS,
    );
    expect(resolveStoragePrices({ vaultUpgrades: [...VAULT, 9] }).vaultUpgrades).toEqual(VAULT);
  });

  it('a non-integer entry drops the whole dimension', () => {
    const raw = withEntry(EXPANSIONS, 3, 500.5);
    expect(resolveStoragePrices({ bankExpansions: raw }).bankExpansions).toEqual(EXPANSIONS);
  });

  it('a negative entry drops the whole dimension', () => {
    const raw = withEntry(SOCKETS, 0, -1);
    expect(resolveStoragePrices({ bankSockets: raw }).bankSockets).toEqual(SOCKETS);
  });

  it('a NaN entry drops the whole dimension', () => {
    const raw = withEntry(VAULT, 2, Number.NaN);
    expect(resolveStoragePrices({ vaultUpgrades: raw }).vaultUpgrades).toEqual(VAULT);
  });

  it('an Infinity entry drops the whole dimension', () => {
    const raw = withEntry(VAULT, 4, Number.POSITIVE_INFINITY);
    expect(resolveStoragePrices({ vaultUpgrades: raw }).vaultUpgrades).toEqual(VAULT);
  });

  it('a non-number entry drops the whole dimension', () => {
    const raw = [...SOCKETS.slice(0, 3), '5000000'];
    expect(resolveStoragePrices({ bankSockets: raw }).bankSockets).toEqual(SOCKETS);
  });

  it('zero IS a legal price', () => {
    const resolved = resolveStoragePrices({ bankSockets: [0, 0, 0, 0] });
    expect(resolved.bankSockets).toEqual([0, 0, 0, 0]);
  });

  it('an unsafely large entry (past Number.MAX_SAFE_INTEGER) drops the whole dimension', () => {
    // 1e300 IS an integer to Number.isInteger; the safe-integer bound is what
    // rejects it (a mistyped exponent must reject loudly, never apply as an
    // unpayable price). The exact boundary value stays legal.
    const raw = withEntry(SOCKETS, 1, 1e300);
    expect(resolveStoragePrices({ bankSockets: raw }).bankSockets).toEqual(SOCKETS);
    const edge = withEntry(SOCKETS, 1, Number.MAX_SAFE_INTEGER);
    expect(resolveStoragePrices({ bankSockets: edge }).bankSockets).toEqual([
      1000000,
      Number.MAX_SAFE_INTEGER,
      3500000,
      5000000,
    ]);
  });

  it('a JSON __proto__ key neither pollutes nor applies (prototype-pollution pin)', () => {
    // JSON.parse creates __proto__ as an OWN property, and the resolver reads
    // only the three named dimensions, so the junk is ignored and
    // Object.prototype stays clean. Pinned so a refactor to Object.assign or
    // for...in cannot regress silently.
    const parsed = JSON.parse('{"__proto__":{"polluted":1},"bankSockets":[9,8,7,6]}');
    const resolved = resolveStoragePrices(parsed);
    expect(resolved.bankSockets).toEqual([9, 8, 7, 6]);
    expect(resolved.bankExpansions).toEqual(EXPANSIONS);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('one bad dimension defaults alone while a good sibling still applies', () => {
    const resolved = resolveStoragePrices({
      bankExpansions: withEntry(EXPANSIONS, 11, Number.NaN),
      bankSockets: [9, 8, 7, 6],
    });
    expect(resolved.bankExpansions).toEqual(EXPANSIONS);
    expect(resolved.bankSockets).toEqual([9, 8, 7, 6]);
    expect(resolved.vaultUpgrades).toEqual(VAULT);
  });

  it('resolved tables are frozen copies, never aliases of the caller arrays', () => {
    const mine = withEntry(SOCKETS, 0, 123);
    const resolved = resolveStoragePrices({ bankSockets: mine });
    expect(resolved.bankSockets).toEqual([123, 2000000, 3500000, 5000000]);
    expect(resolved.bankSockets).not.toBe(mine);
    // Mutating the caller's array after resolve must not reach the table.
    mine[1] = 42;
    mine.push(9);
    expect(resolved.bankSockets).toEqual([123, 2000000, 3500000, 5000000]);
    expect(Object.isFrozen(resolved)).toBe(true);
    expect(Object.isFrozen(resolved.bankSockets)).toBe(true);
    // The default path is frozen too.
    const defaults = resolveStoragePrices(undefined);
    expect(Object.isFrozen(defaults)).toBe(true);
    expect(Object.isFrozen(defaults.bankExpansions)).toBe(true);
  });
});

// The three Gilded Strongbox bursars (banker NPCs), one per town hub; the same
// trimmed fixture world tests/bank.test.ts uses so Sim construction stays fast.
const BANKERS = ['bursar_fernando', 'bursar_petra_vell', 'bursar_aldous_crane'] as const;
const TEST_WORLD: WorldContent = {
  ...BUILTIN_WORLD,
  camps: [],
  npcs: Object.fromEntries(BANKERS.map((id) => [id, BUILTIN_WORLD.npcs[id]])),
  groundObjects: [],
};

// The determinism arm needs a world that actually DRAWS: the fully trimmed
// fixture above idles at ZERO rng draws and one event across its 60 ticks
// (QA 09 probe), which made an exact-draw-stream equality claim vacuous
// ([] equals []). Restoring a slice of camps puts wandering mobs back
// (measured: ~127 mobs, ~38 idle draws per 60 ticks at seed 42, player
// untouched at spawn), so the floors below are real work, not zero.
const DETERMINISM_WORLD: WorldContent = {
  ...BUILTIN_WORLD,
  camps: BUILTIN_WORLD.camps.slice(0, 25),
  npcs: Object.fromEntries(BANKERS.map((id) => [id, BUILTIN_WORLD.npcs[id]])),
  groundObjects: [],
};

// Stand the default player on top of a banker (the tests/bank.test.ts idiom):
// content coords run through findSafePos/groundPos at spawn, so read the LIVE pos.
function moveToBanker(sim: Sim): void {
  let banker: Entity | undefined;
  for (const e of sim.entities.values()) {
    if (e.kind === 'npc' && e.templateId === BANKERS[0]) {
      banker = e;
      break;
    }
  }
  if (!banker) throw new Error('banker not spawned in the fixture world');
  const p = sim.entities.get(sim.playerId);
  if (!p) throw new Error('missing default player');
  p.pos = { ...banker.pos };
  p.prevPos = { ...p.pos };
  sim.rebucket(p);
}

describe('SimConfig.storagePrices through the live Sim', () => {
  it('a same-seed override Sim matches the default Sim tick for tick, then quotes and charges the override', () => {
    const a = new Sim({
      seed: 42,
      playerClass: 'warrior',
      autoEquip: false,
      world: DETERMINISM_WORLD,
    });
    const b = new Sim({
      seed: 42,
      playerClass: 'warrior',
      autoEquip: false,
      world: DETERMINISM_WORLD,
      storagePrices: { bankExpansions: [777, ...EXPANSIONS.slice(1)] },
    });
    // Same fixed run, no purchases: the override must perturb nothing. The
    // rng observers turn the event-stream proxy into an EXACT draw-stream
    // equality claim: the override cannot shift a single draw.
    const drawsA: number[] = [];
    const drawsB: number[] = [];
    // biome-ignore lint/suspicious/noExplicitAny: the rng observer is a test seam
    (a as any).rng.setObserver((v: number) => drawsA.push(v));
    // biome-ignore lint/suspicious/noExplicitAny: the rng observer is a test seam
    (b as any).rng.setObserver((v: number) => drawsB.push(v));
    const digest = (evs: ReturnType<Sim['tick']>): string[] =>
      evs.map((e) => `${e.type}:${'text' in e ? (e.text ?? '') : ''}`);
    for (let i = 0; i < 60; i++) {
      expect(digest(b.tick()), `tick ${i} event stream`).toEqual(digest(a.tick()));
    }
    // biome-ignore lint/suspicious/noExplicitAny: the rng observer is a test seam
    (a as any).rng.setObserver(null);
    // biome-ignore lint/suspicious/noExplicitAny: the rng observer is a test seam
    (b as any).rng.setObserver(null);
    // Vacuity floor (QA 09): the equality claims below are only worth their
    // words if the run actually drew. The camp slice yields ~38 idle draws at
    // seed 42; 10 keeps headroom for content drift while staying decisive.
    expect(drawsA.length).toBeGreaterThanOrEqual(10);
    expect(drawsB.length).toBe(drawsA.length);
    expect(drawsB).toEqual(drawsA);
    const sample = (s: Sim) => {
      const p = s.entities.get(s.playerId)!;
      return {
        size: s.entities.size,
        player: [p.pos.x, p.pos.z, p.hp],
        mobs: [...s.entities.values()]
          .filter((e) => e.kind === 'mob')
          .map((m) => [m.pos.x, m.pos.z, m.hp]),
      };
    };
    // The world sample must be binding non-trivial state: the camp slice
    // spawns a real mob population whose positions and hp join the compare.
    expect(sample(a).mobs.length).toBeGreaterThan(0);
    expect(sample(b)).toEqual(sample(a));
    // The quotes diverge exactly at the overridden rung.
    moveToBanker(a);
    moveToBanker(b);
    expect(a.bankInfoFor(a.playerId)!.nextExpansionCost).toBe(500);
    expect(b.bankInfoFor(b.playerId)!.nextExpansionCost).toBe(777);
    // A purchase charges exactly the overridden price (and the default one in
    // the control Sim), moving purchasedSlots identically.
    const am = a.meta(a.playerId)!;
    const bm = b.meta(b.playerId)!;
    am.copper = 10000;
    bm.copper = 10000;
    a.bankBuySlots(a.playerId);
    b.bankBuySlots(b.playerId);
    expect(am.copper).toBe(9500);
    expect(bm.copper).toBe(10000 - 777);
    expect(am.bank.purchasedSlots).toBe(6);
    expect(bm.bank.purchasedSlots).toBe(6);
    // Rung 1 was not overridden, so both Sims quote the same next price.
    expect(a.bankInfoFor(a.playerId)!.nextExpansionCost).toBe(1000);
    expect(b.bankInfoFor(b.playerId)!.nextExpansionCost).toBe(1000);
  });

  it('socket and vault overrides flow through their quotes and charges', () => {
    const sim = new Sim({
      seed: 42,
      playerClass: 'warrior',
      autoEquip: false,
      world: TEST_WORLD,
      storagePrices: {
        bankSockets: [111111, ...SOCKETS.slice(1)],
        vaultUpgrades: [222, ...VAULT.slice(1)],
      },
    });
    moveToBanker(sim);
    const info = sim.bankInfoFor(sim.playerId)!;
    expect(info.nextSocketCost).toBe(111111);
    // The untouched dimension stays on its default.
    expect(info.nextExpansionCost).toBe(500);
    expect(sim.vaultInfoFor(sim.playerId)!.nextUpgradeCost).toBe(222);
    const m = sim.meta(sim.playerId)!;
    m.copper = 200000;
    sim.bankUnlockSocket(sim.playerId);
    expect(m.copper).toBe(200000 - 111111);
    expect(m.bank.unlockedSockets).toBe(1);
    sim.vaultBuyUpgrade(sim.playerId);
    expect(m.copper).toBe(200000 - 111111 - 222);
    expect(m.vault.upgrades).toBe(1);
    // The next quotes walk the (unoverridden) later rungs of the same tables.
    expect(sim.bankInfoFor(sim.playerId)!.nextSocketCost).toBe(2000000);
    expect(sim.vaultInfoFor(sim.playerId)!.nextUpgradeCost).toBe(50000);
  });

  it('the SimContext exposes the SAME resolved table the Sim owns (reference identity)', () => {
    // Identity, not deep equality: deep equality would pass vacuously if the
    // seam ever grew a fallback that fired with default prices under a live
    // override; identity cannot.
    const sim = new Sim({
      seed: 42,
      playerClass: 'warrior',
      autoEquip: false,
      world: TEST_WORLD,
      storagePrices: { vaultUpgrades: [222, ...VAULT.slice(1)] },
    });
    expect(sim.ctx.storagePrices).toBe(sim.storagePrices);
  });

  it('mutating the caller override array after construction never reaches the live Sim', () => {
    const mine = [777, ...EXPANSIONS.slice(1)];
    const sim = new Sim({
      seed: 42,
      playerClass: 'warrior',
      autoEquip: false,
      world: TEST_WORLD,
      storagePrices: { bankExpansions: mine },
    });
    mine[0] = 1;
    moveToBanker(sim);
    expect(sim.bankInfoFor(sim.playerId)!.nextExpansionCost).toBe(777);
  });
});
