import { describe, expect, it, vi } from 'vitest';
import { HEROIC_BOSS_LOOT } from '../src/sim/content/heroic_loot';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import {
  activeLootRolls,
  awardSharedLootItem,
  distributeLootCopper,
  lootRollGroupStatus,
  lootSlotVisibleTo,
  partyLootCandidatesForMob,
  pickRollGroupWinner,
  pruneCorpseLoot,
  rollLoot,
  submitLootRoll,
} from '../src/sim/loot/loot_roll';
import { Rng } from '../src/sim/rng';
import type { PlayerMeta } from '../src/sim/sim';
import { Sim } from '../src/sim/sim';
import type { Entity, LootEntry, LootSlot, SimEvent } from '../src/sim/types';

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

function playerMeta(sim: Sim, pid: number): PlayerMeta {
  const meta = sim.ctx.players.get(pid);
  if (!meta) throw new Error(`expected player ${pid}`);
  return meta;
}

function lootRollEvent(sim: Sim): Extract<SimEvent, { type: 'lootRoll' }> {
  const event = sim.events.find((e): e is Extract<SimEvent, { type: 'lootRoll' }> => {
    return e.type === 'lootRoll';
  });
  if (!event) throw new Error('expected loot roll event');
  return event;
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
    const meta = playerMeta(sim, pid);
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

  // Reproduces the raid-loot duplicate bug: Nythraxis has 4 independent rollGroups
  // (2 helm slots, 2 shoulder slots) and several items (e.g. soulflame_mantle,
  // crownforged_dreadhelm, nighttalon_crown/shoulderguards) appear in every one of
  // them. With no cross-group duplicate guard, a single kill can hand out the same
  // piece twice (or more), so a 9-person raid's 4 drops can collapse to 2-3 distinct
  // items instead of a spread. This must never happen: every item awarded by one
  // rollLoot call is unique.
  it('never awards the same item id twice from one kill (raid boss, cross-group dedup)', () => {
    // Reuse one Sim/player and re-seed only the rng between draws (constructing a
    // fresh Sim per iteration is what pushed this over the shared-runner default
    // test timeout in CI). 60 independent draws is already far past the ~57%
    // per-kill duplicate rate the unfixed table produced.
    const template = MOBS.nythraxis_scourge_of_thornpeak;
    const sim = makeSim(0);
    const pid = sim.addPlayer('warrior', 'Looter');
    const meta = playerMeta(sim, pid);
    for (let seed = 0; seed < 60; seed++) {
      sim.rng = new Rng(seed);
      const mob = createMob(-1, template, template.minLevel, { x: 0, y: 0, z: 0 });
      rollLoot(sim.ctx, mob, meta);
      const ids = (mob.loot?.items ?? []).map((s) => s.itemId);
      // Every one of the 4 groups sums to 100% chance, so a kill must never come
      // up empty; asserting this keeps the uniqueness check below from passing
      // vacuously against a 0-item corpse.
      expect(ids.length).toBeGreaterThan(0);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});

describe('loot_roll: pickRollGroupWinner (cross-group fall-forward)', () => {
  it('returns the plain partition winner when nothing in the group was awarded yet', () => {
    const group: LootEntry[] = [
      { itemId: 'a', chance: 0.5 },
      { itemId: 'b', chance: 0.5 },
    ];
    expect(pickRollGroupWinner(0.1, group, new Set())?.itemId).toBe('a');
    expect(pickRollGroupWinner(0.6, group, new Set())?.itemId).toBe('b');
  });

  it('falls forward to the next entry in the SAME group on a collision, preserving the drop', () => {
    const group = [
      { itemId: 'a', chance: 0.5 },
      { itemId: 'b', chance: 0.5 },
    ];
    // roll=0.1 partitions to 'a'; 'a' is already awarded elsewhere this kill, so
    // the slot must still produce 'b' rather than dropping nothing.
    expect(pickRollGroupWinner(0.1, group, new Set(['a']))?.itemId).toBe('b');
  });

  it('wraps around the group when the collision is near the end', () => {
    const group = [
      { itemId: 'a', chance: 0.34 },
      { itemId: 'b', chance: 0.33 },
      { itemId: 'c', chance: 0.33 },
    ];
    // roll=0.9 partitions to 'c'; both 'c' and 'a' are already awarded, so the
    // wraparound scan must land on 'b'.
    expect(pickRollGroupWinner(0.9, group, new Set(['c', 'a']))?.itemId).toBe('b');
  });

  it('returns null only when every entry in the group is already awarded', () => {
    const group = [
      { itemId: 'a', chance: 0.5 },
      { itemId: 'b', chance: 0.5 },
    ];
    expect(pickRollGroupWinner(0.1, group, new Set(['a', 'b']))).toBeNull();
  });
});

describe('loot_roll: probability tables', () => {
  it('keeps every chance valid and every exclusive group at or below 100%', () => {
    const problems: string[] = [];

    for (const [mobId, mob] of Object.entries(MOBS)) {
      const groupTotals = new Map<string, number>();
      for (const [index, entry] of mob.loot.entries()) {
        if (!Number.isFinite(entry.chance) || entry.chance < 0 || entry.chance > 1) {
          problems.push(`${mobId}.loot[${index}] has invalid chance ${entry.chance}`);
        }
        if (entry.rollGroup) {
          groupTotals.set(entry.rollGroup, (groupTotals.get(entry.rollGroup) ?? 0) + entry.chance);
        }
      }
      for (const [group, total] of groupTotals) {
        if (total > 1 + Number.EPSILON) {
          problems.push(`${mobId}.${group} totals ${total}`);
        }
      }
    }

    expect(problems).toEqual([]);
  });
});

describe('loot_roll: need-greed resolution (module entry)', () => {
  it('need beats greed; the winner receives the item and others get nothing', () => {
    const { sim, a, b, c } = partyOfThree();
    const mob = deadCorpse(sim, a, [a, b, c], {
      copper: 0,
      items: [{ itemId: 'greyjaw_hide_boots', count: 1 }],
    });
    awardSharedLootItem(sim.ctx, 'greyjaw_hide_boots', mob, playerMeta(sim, a));
    const rollId = lootRollEvent(sim).rollId;
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
      awardSharedLootItem(sim.ctx, 'greyjaw_hide_boots', mob, playerMeta(sim, a));
      const rollId = lootRollEvent(sim).rollId;
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

  it('breaks an exact d100 tie with a separate random draw', () => {
    const { sim, a, b, c } = partyOfThree();
    const mob = deadCorpse(sim, a, [a, b, c], {
      copper: 0,
      items: [{ itemId: 'greyjaw_hide_boots', count: 1 }],
    });
    awardSharedLootItem(sim.ctx, 'greyjaw_hide_boots', mob, playerMeta(sim, a));
    const rollId = lootRollEvent(sim).rollId;
    const int = vi
      .spyOn(sim.ctx.rng, 'int')
      .mockReturnValueOnce(50)
      .mockReturnValueOnce(50)
      .mockReturnValueOnce(1);

    submitLootRoll(sim.ctx, rollId, 'need', a);
    submitLootRoll(sim.ctx, rollId, 'need', b);
    submitLootRoll(sim.ctx, rollId, 'pass', c);

    expect(int).toHaveBeenNthCalledWith(3, 0, 1);
    expect(sim.countItem('greyjaw_hide_boots', a)).toBe(0);
    expect(sim.countItem('greyjaw_hide_boots', b)).toBe(1);
  });

  it('when everyone passes, the item returns to the corpse as an open slot for all', () => {
    const { sim, a, b, c } = partyOfThree();
    const mob = deadCorpse(sim, a, [a, b, c], {
      copper: 0,
      items: [{ itemId: 'greyjaw_hide_boots', count: 1 }],
    });
    awardSharedLootItem(sim.ctx, 'greyjaw_hide_boots', mob, playerMeta(sim, a));
    // Starting the roll pulls the item off the corpse (lootCorpse zeroes the slot and
    // prunes it); model that so the only slot left is whatever the roll returns.
    mob.loot = { copper: 0, items: [] };
    const rollId = lootRollEvent(sim).rollId;
    submitLootRoll(sim.ctx, rollId, 'pass', a);
    submitLootRoll(sim.ctx, rollId, 'pass', b);
    submitLootRoll(sim.ctx, rollId, 'pass', c);
    expect([a, b, c].every((pid) => sim.countItem('greyjaw_hide_boots', pid) === 0)).toBe(true);
    const returned = mob.loot?.items.find((s) => s.itemId === 'greyjaw_hide_boots');
    expect(returned?.openToAll).toBe(true);
    // The roll is closed and no longer offered to anyone.
    expect(activeLootRolls(sim.ctx, a)).toHaveLength(0);
  });

  it('removes a logged-out candidate before resolving so their winning item is conserved', () => {
    const { sim, a, b, c } = partyOfThree();
    const mob = deadCorpse(sim, a, [a, b, c], {
      copper: 0,
      items: [{ itemId: 'greyjaw_hide_boots', count: 1 }],
    });
    awardSharedLootItem(sim.ctx, 'greyjaw_hide_boots', mob, playerMeta(sim, a));
    // Starting a roll removes the source item from ordinary corpse loot. Keep
    // only a returned slot as the conservation signal.
    mob.loot = { copper: 0, items: [] };
    const rollId = lootRollEvent(sim).rollId;

    submitLootRoll(sim.ctx, rollId, 'need', a);
    sim.removePlayer(a); // explicit logout forfeits the unresolved roll
    submitLootRoll(sim.ctx, rollId, 'pass', b);
    submitLootRoll(sim.ctx, rollId, 'pass', c);

    expect((sim as any).pendingLootRolls.has(rollId)).toBe(false);
    const returned = mob.loot?.items.find((s) => s.itemId === 'greyjaw_hide_boots');
    expect(returned).toMatchObject({ count: 1, openToAll: true });
  });

  it('resolves a two-needer roll when the leaver was the last undecided candidate, awarding a live winner', () => {
    const resolveHolder = (seed: number) => {
      const { sim, a, b, c } = partyOfThree(seed);
      const mob = deadCorpse(sim, a, [a, b, c], {
        copper: 0,
        items: [{ itemId: 'greyjaw_hide_boots', count: 1 }],
      });
      awardSharedLootItem(sim.ctx, 'greyjaw_hide_boots', mob, playerMeta(sim, a));
      // The roll pulls the item off the corpse; model that so a wrong
      // return-to-corpse would surface as a leftover slot.
      mob.loot = { copper: 0, items: [] };
      const rollId = lootRollEvent(sim).rollId;
      submitLootRoll(sim.ctx, rollId, 'need', b);
      submitLootRoll(sim.ctx, rollId, 'need', c);
      // `a` never answered: the leave itself is the last-candidate trigger that
      // runs resolveLootRoll (the only leave-path branch that resolves a roll).
      sim.removePlayer(a);
      expect((sim as any).pendingLootRolls.has(rollId)).toBe(false);
      expect(sim.countItem('greyjaw_hide_boots', a)).toBe(0);
      // Won by a live needer, not scattered back to the corpse.
      expect(mob.loot?.items.find((s) => s.itemId === 'greyjaw_hide_boots')).toBeUndefined();
      const holder = [b, c].find((pid) => sim.countItem('greyjaw_hide_boots', pid) === 1);
      return holder ?? -1;
    };
    const winner = resolveHolder(2024);
    expect(winner).not.toBe(-1);
    expect(resolveHolder(2024)).toBe(winner); // deterministic per seed
  });

  it('draws the resolve-time tie-break on the leave path when the two remaining needers tie', () => {
    const { sim, a, b, c } = partyOfThree();
    const mob = deadCorpse(sim, a, [a, b, c], {
      copper: 0,
      items: [{ itemId: 'greyjaw_hide_boots', count: 1 }],
    });
    awardSharedLootItem(sim.ctx, 'greyjaw_hide_boots', mob, playerMeta(sim, a));
    mob.loot = { copper: 0, items: [] };
    const rollId = lootRollEvent(sim).rollId;
    // Force both needers to the same d100 so resolveLootRoll must break the tie;
    // delegate every other draw so the unrelated leave teardown stays deterministic.
    const realInt = sim.ctx.rng.int.bind(sim.ctx.rng);
    const int = vi.spyOn(sim.ctx.rng, 'int').mockImplementation((min: number, max: number) => {
      if (min === 1 && max === 100) return 50; // tie the two needers
      if (min === 0 && max === 1) return 1; // tie-break selects the second contender
      return realInt(min, max);
    });

    submitLootRoll(sim.ctx, rollId, 'need', b);
    submitLootRoll(sim.ctx, rollId, 'need', c);
    sim.removePlayer(a); // the leave resolves the tied roll and must draw the tie-break

    expect(int).toHaveBeenCalledWith(0, 1); // the resolve-time tie-break fired on the leave path
    expect((sim as any).pendingLootRolls.has(rollId)).toBe(false);
    // Exactly one live needer holds it; the leaver never does.
    expect(sim.countItem('greyjaw_hide_boots', a)).toBe(0);
    expect(sim.countItem('greyjaw_hide_boots', b) + sim.countItem('greyjaw_hide_boots', c)).toBe(1);
  });

  it('returns the item if an abruptly missing winner bypassed normal leave reconciliation', () => {
    const { sim, a, b, c } = partyOfThree();
    const mob = deadCorpse(sim, a, [a, b, c], {
      copper: 0,
      items: [{ itemId: 'greyjaw_hide_boots', count: 1 }],
    });
    awardSharedLootItem(sim.ctx, 'greyjaw_hide_boots', mob, playerMeta(sim, a));
    mob.loot = { copper: 0, items: [] };
    const rollId = lootRollEvent(sim).rollId;
    submitLootRoll(sim.ctx, rollId, 'need', a);

    // Defensive path only: normal logout calls removePlayerFromLootRolls first.
    sim.entities.delete(a);
    sim.players.delete(a);
    submitLootRoll(sim.ctx, rollId, 'greed', b);
    submitLootRoll(sim.ctx, rollId, 'pass', c);

    expect((sim as any).pendingLootRolls.has(rollId)).toBe(false);
    expect(sim.countItem('greyjaw_hide_boots', b)).toBe(0);
    expect(mob.loot?.items.find((slot) => slot.itemId === 'greyjaw_hide_boots')).toMatchObject({
      count: 1,
      openToAll: true,
    });
  });
});

describe('loot_roll: group roll status + resolution broadcast (module entry)', () => {
  function openRoll() {
    const fixture = partyOfThree();
    const { sim, a, b, c } = fixture;
    const mob = deadCorpse(sim, a, [a, b, c], {
      copper: 0,
      items: [{ itemId: 'greyjaw_hide_boots', count: 1 }],
    });
    awardSharedLootItem(sim.ctx, 'greyjaw_hide_boots', mob, playerMeta(sim, a));
    return { ...fixture, rollId: lootRollEvent(sim).rollId };
  }

  it('shows every candidate undecided when the roll opens, to every party member', () => {
    const { sim, a, b, c } = openRoll();
    for (const viewer of [a, b, c]) {
      const status = lootRollGroupStatus(sim.ctx, viewer);
      expect(status).toHaveLength(1);
      expect(status[0].itemId).toBe('greyjaw_hide_boots');
      expect(status[0].entries).toEqual([
        { pid: a, name: 'Aaa', choice: null },
        { pid: b, name: 'Bbb', choice: null },
        { pid: c, name: 'Ccc', choice: null },
      ]);
    }
  });

  it('reveals each choice as it lands, including for a player who already answered, and never the roll number', () => {
    const { sim, a, b, c, rollId } = openRoll();
    submitLootRoll(sim.ctx, rollId, 'need', a);
    submitLootRoll(sim.ctx, rollId, 'pass', c);
    // a has answered (no longer prompted) but still watches the group status.
    expect(activeLootRolls(sim.ctx, a)).toHaveLength(0);
    for (const viewer of [a, b, c]) {
      const entries = lootRollGroupStatus(sim.ctx, viewer)[0].entries;
      expect(entries.map((e) => e.choice)).toEqual(['need', null, 'pass']);
      // Choice only: the d100 result must not leak before resolution.
      for (const entry of entries) expect(entry).not.toHaveProperty('roll');
    }
  });

  it('broadcasts every need/greed roll to the whole party at resolution, then the winner line', () => {
    const { sim, a, b, c, rollId } = openRoll();
    submitLootRoll(sim.ctx, rollId, 'greed', b);
    submitLootRoll(sim.ctx, rollId, 'need', a);
    submitLootRoll(sim.ctx, rollId, 'pass', c);
    const lootTexts = (pid: number) =>
      sim.events
        .filter((e): e is Extract<SimEvent, { type: 'loot' }> => e.type === 'loot' && e.pid === pid)
        .map((e) => e.text);
    for (const viewer of [a, b, c]) {
      const texts = lootTexts(viewer);
      const needLine = texts.find((t) => t.startsWith('Need Roll - '));
      const greedLine = texts.find((t) => t.startsWith('Greed Roll - '));
      expect(needLine).toMatch(/^Need Roll - \d+ for \[\[i:greyjaw_hide_boots\]\] by Aaa$/);
      expect(greedLine).toMatch(/^Greed Roll - \d+ for \[\[i:greyjaw_hide_boots\]\] by Bbb$/);
      // Winner line still closes the roll, after the per-roller reveals.
      const winLine = texts.find((t) => t.includes(' wins '));
      expect(winLine).toMatch(/^Aaa wins \[\[i:greyjaw_hide_boots\]\] \(\d+\)$/);
      expect(texts.indexOf(needLine as string)).toBeLessThan(texts.indexOf(winLine as string));
    }
    // The passer has no roll to reveal.
    expect(lootTexts(a).some((t) => t.includes('by Ccc'))).toBe(false);
    // Resolved roll leaves the group status.
    expect(lootRollGroupStatus(sim.ctx, a)).toHaveLength(0);
  });

  it('hides a curate-phase master roll from the group status', () => {
    const { sim, a, rollId } = openRoll();
    const roll = (sim as any).pendingLootRolls.get(rollId);
    roll.masterLooter = a;
    expect(lootRollGroupStatus(sim.ctx, a)).toHaveLength(0);
  });
});

describe('loot_roll: fair-split copper (module entry)', () => {
  it('splits copper deterministically with a non-zero remainder (Fisher-Yates draw)', () => {
    const run = () => {
      const { sim, a, b, c } = partyOfThree(99);
      const mob = deadCorpse(sim, a, [a, b, c], { copper: 100, items: [] });
      const before = [a, b, c].map((pid) => playerMeta(sim, pid).copper);
      distributeLootCopper(sim.ctx, mob, playerMeta(sim, a));
      const after = [a, b, c].map((pid) => playerMeta(sim, pid).copper);
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
      const before = [a, b, c].map((pid) => playerMeta(sim, pid).copper);
      distributeLootCopper(sim.ctx, mob, playerMeta(sim, a));
      const after = [a, b, c].map((pid) => playerMeta(sim, pid).copper);
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
    const meta = playerMeta(sim, a);
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

describe('loot_roll: heroic-append cross-group dedup arm', () => {
  // The heroic-append branch in rollLoot shares pickRollGroupWinner and
  // awardedItemIds with the base-table branch, and this is exercised directly
  // above. What is NOT covered by real content is the case that arm exists to
  // guard: a heroic table sharing an item id with the base table (or with
  // itself across a rollGroup) for the SAME mob. Today no such overlap exists,
  // which is exactly why a future content edit could silently reintroduce a
  // duplicate award with zero coverage; pin the disjointness invariant so any
  // future edit that breaks it fails loudly here instead.
  it('never shares an item id across a mob’s own heroic rollGroups', () => {
    const problems: string[] = [];
    for (const [mobId, entries] of Object.entries(HEROIC_BOSS_LOOT)) {
      const seenPerGroup = new Map<string, Set<string>>();
      for (const entry of entries) {
        if (!entry.rollGroup || !entry.itemId) continue;
        for (const [otherGroup, ids] of seenPerGroup) {
          if (otherGroup === entry.rollGroup) continue;
          if (ids.has(entry.itemId)) {
            problems.push(
              `${mobId}: ${entry.itemId} appears in both ${otherGroup} and ${entry.rollGroup}`,
            );
          }
        }
        const set = seenPerGroup.get(entry.rollGroup) ?? new Set<string>();
        set.add(entry.itemId);
        seenPerGroup.set(entry.rollGroup, set);
      }
    }
    expect(problems).toEqual([]);
  });

  it('never shares an item id with the same mob’s base loot table', () => {
    const problems: string[] = [];
    for (const [mobId, heroicEntries] of Object.entries(HEROIC_BOSS_LOOT)) {
      const template = MOBS[mobId];
      if (!template) continue;
      const baseIds = new Set(
        template.loot.flatMap((entry: LootEntry) => (entry.itemId ? [entry.itemId] : [])),
      );
      for (const entry of heroicEntries) {
        if (entry.itemId && baseIds.has(entry.itemId)) {
          problems.push(`${mobId}: heroic entry ${entry.itemId} also appears in the base table`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  // Direct exercise of the heroic-append arm's dedup path (should-fix from
  // review: the arm was reachable in code but untested, since no real heroic
  // table currently collides -- confirmed by the disjointness pins above).
  // Temporarily substitutes a synthetic two-group heroic table for one real
  // boss id, engineered to collide by construction, so the SAME code path
  // rollLoot runs against real content is proven to fall forward here too.
  it('falls forward inside the heroic-append branch on a forced collision', () => {
    const template = MOBS.morthen;
    const original = HEROIC_BOSS_LOOT.morthen;
    HEROIC_BOSS_LOOT.morthen = [
      { itemId: 'collision_item', chance: 1, rollGroup: 'heroic_test_1' },
      { itemId: 'collision_item', chance: 0.5, rollGroup: 'heroic_test_2' },
      { itemId: 'other_item', chance: 0.5, rollGroup: 'heroic_test_2' },
    ];
    try {
      const sim = makeSim(0);
      const pid = sim.addPlayer('warrior', 'Looter');
      const meta = playerMeta(sim, pid);
      const mob = createMob(-1, template, template.minLevel, { x: 0, y: 0, z: 0 });
      sim.ctx.instances.push({
        id: -1,
        dungeonId: 'hollow_crypt',
        difficulty: 'heroic',
        partyKey: 'test-party',
        mobIds: [mob.id],
      } as unknown as (typeof sim.ctx.instances)[number]);
      // heroic_test_1's single entry always wins (chance 1); heroic_test_2's
      // roll of 0.1 partitions to its own collision_item entry (index 0,
      // chance 0.5), which is already awarded by heroic_test_1, so it must
      // fall forward to other_item rather than dropping nothing.
      vi.spyOn(sim.ctx.rng, 'next').mockReturnValue(0.1);
      rollLoot(sim.ctx, mob, meta);
      const ids = (mob.loot?.items ?? []).map((s) => s.itemId);
      expect(ids.filter((id) => id === 'collision_item').length).toBe(1);
      expect(ids).toContain('other_item');
    } finally {
      HEROIC_BOSS_LOOT.morthen = original;
    }
  });
});
