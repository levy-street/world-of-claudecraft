import { describe, expect, it } from 'vitest';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import {
  activeLootRolls,
  awardSharedLootItem,
  distributeLootCopper,
  lootSlotVisibleTo,
  partyLootCandidatesForMob,
  pruneCorpseLoot,
  rollLoot,
  submitLootRoll,
} from '../src/sim/loot/loot_roll';
import { Sim } from '../src/sim/sim';
import type { Entity, LootSlot } from '../src/sim/types';

// Direct unit tests for the extracted loot-distribution module (L1). These drive the
// module's exported `(ctx, ...)` functions through `sim.ctx` (the real SimContext
// seam), not through Sim's thin delegates, so the module is covered on its own. They
// pin drop-rate + need-greed resolution + fair-split determinism, the everyone-passes
// return-to-corpse branch, and the visibility/prune helpers.

const makeSim = (seed = 42) => new Sim({ seed, playerClass: 'warrior', noPlayer: true });

function partyOfThree(seed = 42) {
  const sim = makeSim(seed);
  const a = sim.addPlayer('warrior', 'Aaa');
  const b = sim.addPlayer('mage', 'Bbb');
  const c = sim.addPlayer('rogue', 'Ccc');
  sim.partyInvite(b, a);
  sim.partyAccept(b);
  sim.partyInvite(c, a);
  sim.partyAccept(c);
  return { sim, a, b, c };
}

// A pre-killed corpse with an explicit death-time recipient snapshot, so the
// candidate set is deterministic without depending on positions/range.
function deadCorpse(
  sim: Sim,
  tapper: number,
  recipients: number[],
  loot: { copper: number; items: LootSlot[] },
): Entity {
  const mob = createMob(sim.nextId++, MOBS.forest_wolf, 2, { x: 0, y: 0, z: 0 });
  mob.dead = true;
  mob.lootable = true;
  mob.tappedById = tapper;
  mob.lootRecipientIds = recipients;
  mob.loot = loot;
  sim.entities.set(mob.id, mob);
  return mob;
}

describe('loot_roll: rollLoot producer (drop-rate determinism)', () => {
  function dropRate(seed: number, mobId: string, itemId: string, n: number): number {
    const sim = makeSim(seed);
    const pid = sim.addPlayer('warrior', 'Looter');
    const meta = sim.ctx.players.get(pid)!;
    const template = MOBS[mobId];
    let hits = 0;
    for (let i = 0; i < n; i++) {
      const mob = createMob(-1, template, template.minLevel, { x: 0, y: 0, z: 0 });
      rollLoot(sim.ctx, mob, meta);
      if (mob.loot?.items.some((s) => s.itemId === itemId)) hits++;
    }
    return hits / n;
  }

  it('is deterministic via the module entry: identical seed reproduces the exact rate', () => {
    expect(dropRate(7, 'bastion_revenant', 'mistveil_cord', 4000)).toBe(
      dropRate(7, 'bastion_revenant', 'mistveil_cord', 4000),
    );
  });

  it('drops a configured item near its intended rate (rollGroup partition draw fires)', () => {
    const rate = dropRate(1234, 'bastion_revenant', 'mistveil_cord', 8000);
    expect(rate).toBeGreaterThan(0.04);
    expect(rate).toBeLessThan(0.08);
  });
});

describe('loot_roll: need-greed resolution (module entry)', () => {
  it('need beats greed; the winner receives the item and others get nothing', () => {
    const { sim, a, b, c } = partyOfThree();
    const mob = deadCorpse(sim, a, [a, b, c], {
      copper: 0,
      items: [{ itemId: 'greyjaw_hide_boots', count: 1 }],
    });
    awardSharedLootItem(sim.ctx, 'greyjaw_hide_boots', mob, sim.ctx.players.get(a)!);
    const rollId = sim.events.find((e) => e.type === 'lootRoll')!.rollId as number;
    submitLootRoll(sim.ctx, rollId, 'greed', b);
    submitLootRoll(sim.ctx, rollId, 'need', a);
    submitLootRoll(sim.ctx, rollId, 'pass', c);
    expect(sim.countItem('greyjaw_hide_boots', a)).toBe(1);
    expect(sim.countItem('greyjaw_hide_boots', b)).toBe(0);
    expect(sim.countItem('greyjaw_hide_boots', c)).toBe(0);
  });

  it('ties between two needers break by the higher d100 roll, deterministically per seed', () => {
    const resolveWinner = () => {
      const { sim, a, b, c } = partyOfThree(2024);
      const mob = deadCorpse(sim, a, [a, b, c], {
        copper: 0,
        items: [{ itemId: 'greyjaw_hide_boots', count: 1 }],
      });
      awardSharedLootItem(sim.ctx, 'greyjaw_hide_boots', mob, sim.ctx.players.get(a)!);
      const rollId = sim.events.find((e) => e.type === 'lootRoll')!.rollId as number;
      submitLootRoll(sim.ctx, rollId, 'need', a);
      submitLootRoll(sim.ctx, rollId, 'need', b);
      submitLootRoll(sim.ctx, rollId, 'pass', c);
      // Exactly one of a/b ends up holding the item.
      const holder = [a, b].find((pid) => sim.countItem('greyjaw_hide_boots', pid) === 1);
      return holder ?? -1;
    };
    const winner = resolveWinner();
    expect(winner).not.toBe(-1);
    expect(resolveWinner()).toBe(winner);
  });

  it('when everyone passes, the item returns to the corpse as an open slot for all', () => {
    const { sim, a, b, c } = partyOfThree();
    const mob = deadCorpse(sim, a, [a, b, c], {
      copper: 0,
      items: [{ itemId: 'greyjaw_hide_boots', count: 1 }],
    });
    awardSharedLootItem(sim.ctx, 'greyjaw_hide_boots', mob, sim.ctx.players.get(a)!);
    // Starting the roll pulls the item off the corpse (lootCorpse zeroes the slot and
    // prunes it); model that so the only slot left is whatever the roll returns.
    mob.loot = { copper: 0, items: [] };
    const rollId = sim.events.find((e) => e.type === 'lootRoll')!.rollId as number;
    submitLootRoll(sim.ctx, rollId, 'pass', a);
    submitLootRoll(sim.ctx, rollId, 'pass', b);
    submitLootRoll(sim.ctx, rollId, 'pass', c);
    expect([a, b, c].every((pid) => sim.countItem('greyjaw_hide_boots', pid) === 0)).toBe(true);
    const returned = mob.loot?.items.find((s) => s.itemId === 'greyjaw_hide_boots');
    expect(returned?.openToAll).toBe(true);
    // The roll is closed and no longer offered to anyone.
    expect(activeLootRolls(sim.ctx, a)).toHaveLength(0);
  });
});

describe('loot_roll: fair-split copper (module entry)', () => {
  it('splits copper deterministically with a non-zero remainder (Fisher-Yates draw)', () => {
    const run = () => {
      const { sim, a, b, c } = partyOfThree(99);
      const mob = deadCorpse(sim, a, [a, b, c], { copper: 100, items: [] });
      const before = [a, b, c].map((pid) => sim.ctx.players.get(pid)!.copper);
      distributeLootCopper(sim.ctx, mob, sim.ctx.players.get(a)!);
      const after = [a, b, c].map((pid) => sim.ctx.players.get(pid)!.copper);
      return after.map((v, i) => v - before[i]);
    };
    const shares = run();
    expect(run()).toEqual(shares); // deterministic per seed
    expect(shares.reduce((s, v) => s + v, 0)).toBe(100); // nothing lost
    expect(shares.filter((v) => v === 34)).toHaveLength(1); // the remainder went to one member
    expect(shares.filter((v) => v === 33)).toHaveLength(2);
  });

  it('splits deterministically with remainder > 1 (multiple Fisher-Yates draws)', () => {
    // 101 over 3 -> base 33, remainder 2 -> the swap loop runs TWICE (rng.int(0,2)
    // then rng.int(1,2)), exercising the i>0 swap the remainder==1 case never hits.
    const run = () => {
      const { sim, a, b, c } = partyOfThree(123);
      const mob = deadCorpse(sim, a, [a, b, c], { copper: 101, items: [] });
      const before = [a, b, c].map((pid) => sim.ctx.players.get(pid)!.copper);
      distributeLootCopper(sim.ctx, mob, sim.ctx.players.get(a)!);
      const after = [a, b, c].map((pid) => sim.ctx.players.get(pid)!.copper);
      return after.map((v, i) => v - before[i]);
    };
    const shares = run();
    expect(run()).toEqual(shares); // deterministic per seed
    expect(shares.reduce((s, v) => s + v, 0)).toBe(101); // nothing lost
    expect(shares.filter((v) => v === 34)).toHaveLength(2); // two members got a remainder unit
    expect(shares.filter((v) => v === 33)).toHaveLength(1);
  });

  it('falls back to looter-takes-all when there is no party split', () => {
    const sim = makeSim(7);
    const a = sim.addPlayer('warrior', 'Solo');
    const mob = deadCorpse(sim, a, [a], { copper: 50, items: [] });
    const meta = sim.ctx.players.get(a)!;
    const before = meta.copper;
    distributeLootCopper(sim.ctx, mob, meta);
    expect(meta.copper - before).toBe(50);
    expect(mob.loot?.copper).toBe(0);
  });
});

describe('loot_roll: corpse-loot helpers (module entry)', () => {
  it('lootSlotVisibleTo honors openToAll / personalFor / unrestricted slots', () => {
    expect(lootSlotVisibleTo({ itemId: 'x', count: 1, openToAll: true }, 5)).toBe(true);
    expect(lootSlotVisibleTo({ itemId: 'x', count: 1, personalFor: [5] }, 5)).toBe(true);
    expect(lootSlotVisibleTo({ itemId: 'x', count: 1, personalFor: [5] }, 6)).toBe(false);
    expect(lootSlotVisibleTo({ itemId: 'x', count: 1 }, 6)).toBe(true);
  });

  it('pruneCorpseLoot clears an emptied corpse and clamps the corpse timer down', () => {
    const sim = makeSim();
    const mob = createMob(sim.nextId++, MOBS.forest_wolf, 2, { x: 0, y: 0, z: 0 });
    mob.dead = true;
    mob.lootable = true;
    mob.corpseTimer = 60;
    mob.loot = { copper: 0, items: [{ itemId: 'x', count: 0 }] };
    sim.entities.set(mob.id, mob);
    pruneCorpseLoot(sim.ctx, mob);
    expect(mob.loot).toBeNull();
    expect(mob.lootable).toBe(false);
    expect(mob.corpseTimer).toBe(4);
  });

  it('partyLootCandidatesForMob prefers the death-time recipient snapshot', () => {
    const { sim, a, b, c } = partyOfThree();
    const mob = deadCorpse(sim, a, [a, c], { copper: 0, items: [] });
    const ids = partyLootCandidatesForMob(sim.ctx, mob).map((m) => m.entityId);
    expect(ids).toEqual([a, c]);
    expect(ids).not.toContain(b);
  });
});
