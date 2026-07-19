import { describe, expect, it } from 'vitest';
import { LIMITED_FALLBACK } from '../src/sim/content/limited_drops';
import { ITEMS, MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { claimFromWorldLedger, resolveRolledDrop } from '../src/sim/loot/limited_gate';
import { appendLimitedDrops, rollLoot } from '../src/sim/loot/loot_roll';
import { Rng } from '../src/sim/rng';
import { Sim } from '../src/sim/sim';
import type { LootSlot, SimEvent } from '../src/sim/types';

// The limited-relic scarcity mechanic (content/limited_drops.ts +
// loot/limited_gate.ts + the appendLimitedDrops phase in loot/loot_roll.ts).
// These pin the four load-bearing guarantees: the supply cap is hard, the mint
// serial is 1-based and monotonic, an exhausted supply substitutes the fallback
// WITHOUT perturbing the rng draw sequence (so the parity gate stays honest),
// and the whole path is replay-deterministic.

const makeSim = (seed = 42) => new Sim({ seed, playerClass: 'warrior', noPlayer: true });
const NYX = 'nythraxis_scourge_of_thornpeak';
const CROWN = 'crown_of_the_thornpeak_scourge';
const EMBER = 'emberfall_edge';

function limitedLedger(sim: Sim): Map<string, number> {
  return (sim as unknown as { limitedMints: Map<string, number> }).limitedMints;
}

// Roll only the limited phase for a Nythraxis kill, returning the produced slots
// and the NEXT rng value (so two runs can be compared for identical draw count).
function rollLimited(
  seed: number,
  heroicClaim: boolean,
  exhaust: string[],
): {
  items: LootSlot[];
  next: number;
} {
  const sim = makeSim(1);
  sim.rng = new Rng(seed);
  for (const id of exhaust) limitedLedger(sim).set(id, ITEMS[id].limitedSupply ?? 0);
  const items: LootSlot[] = [];
  const mob = createMob(-1, MOBS[NYX], MOBS[NYX].minLevel, { x: 0, y: 0, z: 0 });
  appendLimitedDrops(sim.ctx, mob, items, heroicClaim, (itemId) => ({ itemId, count: 1 }));
  return { items, next: sim.rng.next() };
}

function countDraws(fn: (sim: Sim) => void, seed = 5): number {
  const sim = makeSim(1);
  sim.rng = new Rng(seed);
  let draws = 0;
  sim.rng.setObserver(() => {
    draws++;
  });
  fn(sim);
  sim.rng.setObserver(null);
  return draws;
}

describe('limited relics: the world supply ledger', () => {
  it('mints 1..supply then refuses forever, per item id', () => {
    const mints = new Map<string, number>();
    const supply = ITEMS[EMBER].limitedSupply ?? 0;
    expect(supply).toBeGreaterThan(0);
    for (let i = 1; i <= supply; i++) expect(claimFromWorldLedger(mints, EMBER)).toBe(i);
    expect(claimFromWorldLedger(mints, EMBER)).toBeNull();
    expect(claimFromWorldLedger(mints, EMBER)).toBeNull();
    // A different relic has its own independent counter.
    expect(claimFromWorldLedger(mints, CROWN)).toBe(1);
    // A non-limited item never mints.
    expect(claimFromWorldLedger(mints, 'worn_sword')).toBeNull();
  });
});

describe('limited relics: resolveRolledDrop gating', () => {
  it('mints a serialed instance while supply lasts, substitutes the fallback once spent', () => {
    const sim = makeSim();
    expect(resolveRolledDrop(sim.ctx, CROWN)).toEqual({ itemId: CROWN, instance: { serial: 1 } });
    expect(resolveRolledDrop(sim.ctx, CROWN)).toEqual({ itemId: CROWN, instance: { serial: 2 } });
    // Exhaust the supply: the next claim falls back to the registered consolation.
    limitedLedger(sim).set(CROWN, ITEMS[CROWN].limitedSupply ?? 0);
    expect(resolveRolledDrop(sim.ctx, CROWN)).toEqual({ itemId: LIMITED_FALLBACK[CROWN] });
    // A non-limited item passes straight through with no instance payload.
    expect(resolveRolledDrop(sim.ctx, 'worn_sword')).toEqual({ itemId: 'worn_sword' });
  });
});

describe('limited relics: rng draw safety (parity)', () => {
  it('a mint and a fallback consume the identical rng sequence, and both actually occur', () => {
    let sawMint = false;
    let sawFallback = false;
    for (let seed = 0; seed < 300; seed++) {
      const fresh = rollLimited(seed, false, []);
      const spent = rollLimited(seed, false, [CROWN]);
      // The claim draws no rng: a fresh (minting) roll and a fully-exhausted
      // (fallback) roll leave the stream at the exact same position.
      expect(spent.next, `seed ${seed} rng parity`).toBe(fresh.next);
      const freshCrown = fresh.items.find((s) => s.itemId === CROWN);
      if (freshCrown) {
        sawMint = true;
        expect(freshCrown.instance?.serial).toBe(1); // fresh sim: first mint
        // The exhausted run drops the fallback in the crown's place, not the crown.
        expect(spent.items.some((s) => s.itemId === CROWN)).toBe(false);
        expect(spent.items.some((s) => s.itemId === LIMITED_FALLBACK[CROWN])).toBe(true);
        sawFallback = true;
      }
    }
    expect(sawMint, 'the crown minted on some seed').toBe(true);
    expect(sawFallback, 'an exhausted crown fell back on some seed').toBe(true);
  });

  it('a heroicOnly relic draws no rng and never drops on a non-heroic kill', () => {
    const mob = () => createMob(-1, MOBS[NYX], MOBS[NYX].minLevel, { x: 0, y: 0, z: 0 });
    // Nythraxis has two limited entries: the crown (any difficulty) and the
    // heroicOnly Emberfall Edge. A normal kill rolls only the crown (1 draw); a
    // heroic kill rolls both (2 draws). The heroicOnly skip must not draw.
    const normalDraws = countDraws((sim) =>
      appendLimitedDrops(sim.ctx, mob(), [], false, (itemId) => ({ itemId, count: 1 })),
    );
    const heroicDraws = countDraws((sim) =>
      appendLimitedDrops(sim.ctx, mob(), [], true, (itemId) => ({ itemId, count: 1 })),
    );
    expect(normalDraws).toBe(1);
    expect(heroicDraws).toBe(2);
    // Emberfall can never appear on a non-heroic kill, across a wide seed sweep.
    for (let seed = 0; seed < 300; seed++) {
      const { items } = rollLimited(seed, false, []);
      expect(items.some((s) => s.itemId === EMBER)).toBe(false);
    }
  });
});

describe('limited relics: end-to-end through rollLoot', () => {
  it('a Nythraxis kill can mint the crown onto the corpse with a 1-based serial', () => {
    const sim = makeSim(0);
    const pid = sim.addPlayer('warrior', 'Looter');
    const meta = sim.ctx.players.get(pid);
    if (!meta) throw new Error('no meta');
    let mintedSerial: number | undefined;
    for (let seed = 0; seed < 400 && mintedSerial === undefined; seed++) {
      sim.rng = new Rng(seed);
      const mob = createMob(-1, MOBS[NYX], MOBS[NYX].minLevel, { x: 0, y: 0, z: 0 });
      rollLoot(sim.ctx, mob, meta);
      const crown = (mob.loot?.items ?? []).find((s) => s.itemId === CROWN);
      if (crown) mintedSerial = crown.instance?.serial;
    }
    // The offline ledger is shared across the loop, so the first mint is serial 1.
    expect(mintedSerial).toBe(1);
  });

  it('is replay-deterministic: same seed, same kill => same serials and mint events', () => {
    const run = () => {
      const sim = makeSim(0);
      const pid = sim.addPlayer('warrior', 'Looter');
      const meta = sim.ctx.players.get(pid);
      if (!meta) throw new Error('no meta');
      const serials: (number | undefined)[] = [];
      for (let seed = 0; seed < 120; seed++) {
        sim.rng = new Rng(seed);
        const mob = createMob(-1, MOBS[NYX], MOBS[NYX].minLevel, { x: 0, y: 0, z: 0 });
        rollLoot(sim.ctx, mob, meta);
        const crown = (mob.loot?.items ?? []).find((s) => s.itemId === CROWN);
        if (crown) serials.push(crown.instance?.serial);
      }
      return serials;
    };
    const a = run();
    const b = run();
    expect(a).toEqual(b);
    // Serials mint in strict 1,2,3,... order (no gaps, no repeats).
    expect(a).toEqual(a.map((_, i) => i + 1));
    expect(a.length).toBeGreaterThan(0);
  });

  it('grants the serialed relic and emits a limitedMint attribution event', () => {
    const sim = makeSim(0);
    const pid = sim.addPlayer('warrior', 'Winner');
    const meta = sim.ctx.players.get(pid);
    if (!meta) throw new Error('no meta');
    // Solo looter: the crown lands straight in the winner's bags (no roll), so
    // looting the corpse grants it and fires the mint event.
    let minted = false;
    for (let seed = 0; seed < 400 && !minted; seed++) {
      sim.rng = new Rng(seed);
      const mob = createMob(sim.nextId++, MOBS[NYX], MOBS[NYX].minLevel, { x: 0, y: 0, z: 0 });
      mob.dead = true;
      mob.lootable = true;
      mob.tappedById = pid;
      mob.lootRecipientIds = [pid];
      const items: LootSlot[] = [];
      appendLimitedDrops(sim.ctx, mob, items, false, (itemId) => ({ itemId, count: 1 }));
      const crown = items.find((s) => s.itemId === CROWN);
      if (!crown) continue;
      minted = true;
      mob.loot = { copper: 0, items };
      sim.entities.set(mob.id, mob);
      const before = sim.events.length;
      sim.lootCorpse(mob.id, pid);
      const mintEv = sim.events
        .slice(before)
        .find((e: SimEvent): e is Extract<SimEvent, { type: 'limitedMint' }> => {
          return e.type === 'limitedMint';
        });
      expect(mintEv).toBeTruthy();
      expect(mintEv?.itemId).toBe(CROWN);
      expect(mintEv?.serial).toBe(crown.instance?.serial);
      expect(mintEv?.supply).toBe(ITEMS[CROWN].limitedSupply);
      expect(mintEv?.name).toBe('Winner');
      // The winner physically holds the serialed copy.
      const held = meta.inventory.find((s) => s.itemId === CROWN);
      expect(held?.instance?.serial).toBe(crown.instance?.serial);
    }
    expect(minted).toBe(true);
  });
});
