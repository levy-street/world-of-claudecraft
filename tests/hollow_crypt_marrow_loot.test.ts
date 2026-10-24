// Sexton Marrow's loot (playtest, 2026-10-12: "no loot on first boss"). A five
// player party kills him for real, through sim.tick(), on both difficulties:
// the kill rolls his table, and the party can still take it after the minute a
// group spends on his Restless Bones, a resurrection or an unanswered roll. The
// wing bosses carry no `boss` flag, so before MobTemplate.bossCorpseHold their
// corpse decayed on the 60 s trash window with the loot still on it.

import { describe, expect, it, vi } from 'vitest';
import { HEROIC_BOSS_LOOT } from '../src/sim/content/heroic_loot';
import { ITEMS, MOBS } from '../src/sim/data';
import { BELL_YARD, MARROW_ID } from '../src/sim/encounters/hollow_crypt';
import { BOSS_CORPSE_HOLD_SECONDS, bossCorpseHoldSeconds } from '../src/sim/mob/boss_corpse_hold';
import type { Entity } from '../src/sim/types';
import { boss, cryptFight, type Fight, put, run, until } from './helpers/crypt_boss_fight';

vi.setConfig({ testTimeout: 240_000 });

const KEEP = new Set([MARROW_ID]);
const MID = { x: BELL_YARD.x, z: BELL_YARD.z };

/** A real kill: the tank holds him in the yard, all five deal damage through
 *  the damage path (the tap, the threat, the Tolls' immunity, the death). */
function killMarrow(difficulty: 'normal' | 'heroic'): { f: Fight; marrow: Entity } {
  const f = cryptFight(difficulty, 4, KEEP);
  const marrow = boss(f, MARROW_ID);
  const party = [f.tank, ...f.others];
  const spots = [
    [MID.x, MID.z + 3.5],
    [MID.x - 12, MID.z - 8],
    [MID.x + 12, MID.z - 8],
    [MID.x - 12, MID.z + 10],
    [MID.x + 12, MID.z + 10],
  ];
  const hold = () => {
    for (const [i, p] of party.entries()) put(f, p, spots[i][0], spots[i][1]);
  };
  hold();
  f.sim.ctx.aggroMob(marrow, f.tank, false);
  const chunk = Math.ceil(marrow.maxHp / 40);
  let clock = 0;
  const dead = until(
    f,
    () => marrow.dead,
    90,
    () => {
      hold();
      clock++;
      if (clock % 10 !== 0 || marrow.dead) return;
      for (const p of party) {
        if (marrow.dead) break;
        f.sim.ctx.dealDamage(p, marrow, chunk, false, 'physical', null, 'hit', false, {
          mult: p === f.tank ? 8 : 1,
        });
      }
    },
  );
  expect(dead).toBe(true);
  return { f, marrow };
}

function equipment(marrow: Entity): string[] {
  return (marrow.loot?.items ?? [])
    .map((s) => s.itemId)
    .filter((id) => ITEMS[id]?.slot !== undefined);
}

describe('Sexton Marrow: the wing bosses hold their corpse like a boss', () => {
  it('opts the three wing bosses into the boss corpse hold', () => {
    for (const id of [MARROW_ID, 'rimeweb', 'cantor_ilvane']) {
      const t = MOBS[id];
      expect(t.boss, id).toBeUndefined();
      expect(HEROIC_BOSS_LOOT[id], id).toBeDefined();
      expect(t.bossCorpseHold, id).toBe(true);
    }
  });
});

for (const difficulty of ['normal', 'heroic'] as const) {
  describe(`Sexton Marrow's loot (${difficulty}, five players)`, () => {
    it('a real kill rolls his table for the whole party and the party can take it late', () => {
      const { f, marrow } = killMarrow(difficulty);
      const party = [f.tank, ...f.others];
      // The kill rolled: money, one piece of equipment, the whole party on it.
      expect(marrow.lootable).toBe(true);
      expect(marrow.loot?.copper ?? 0).toBeGreaterThan(0);
      const pieces = equipment(marrow);
      expect(pieces.length).toBeGreaterThanOrEqual(1);
      expect(party.map((p) => p.id)).toContain(marrow.tappedById);
      expect([...(marrow.lootRecipientIds ?? [])].sort()).toEqual(party.map((p) => p.id).sort());
      expect(bossCorpseHoldSeconds(MOBS[MARROW_ID], marrow)).toBe(BOSS_CORPSE_HOLD_SECONDS);
      // Seventy five seconds pass beside the body (his Restless Bones, a
      // resurrection): the corpse still stands and still pays.
      run(f, 75);
      expect(marrow.lootable).toBe(true);
      const looter = f.others[0];
      put(f, looter, marrow.pos.x - f.ox + 1, marrow.pos.z - f.oz);
      const before = f.sim.players.get(looter.id)?.copper ?? 0;
      expect(f.sim.lootCorpse(marrow.id, looter.id)).toBe(true);
      expect(f.sim.players.get(looter.id)?.copper ?? 0).toBeGreaterThan(before);
      // The piece goes to the party's roll; everyone needs, somebody wins it.
      for (const p of party) {
        for (const roll of f.sim.activeLootRolls(p.id))
          f.sim.submitLootRoll(roll.rollId, 'need', p.id);
      }
      run(f, 1);
      const held = party.reduce((n, p) => n + f.sim.countItem(pieces[0], p.id), 0);
      expect(held).toBe(1);
    });
  });
}

describe("Sexton Marrow's loot: a roll nobody answers", () => {
  it('returns the piece to a corpse that still stands, and the next looter takes it', () => {
    const { f, marrow } = killMarrow('normal');
    const party = [f.tank, ...f.others];
    const piece = equipment(marrow)[0];
    const looter = f.others[1];
    put(f, looter, marrow.pos.x - f.ox + 1, marrow.pos.z - f.oz);
    expect(f.sim.lootCorpse(marrow.id, looter.id)).toBe(true);
    expect(f.sim.activeLootRolls(f.tank.id).length).toBeGreaterThan(0);
    // Nobody presses a button: the roll times out and everyone has passed.
    run(f, 70);
    expect(f.sim.activeLootRolls(f.tank.id)).toHaveLength(0);
    expect(party.reduce((n, p) => n + f.sim.countItem(piece, p.id), 0)).toBe(0);
    expect(marrow.lootable).toBe(true);
    expect(f.sim.lootCorpse(marrow.id, looter.id)).toBe(true);
    expect(f.sim.countItem(piece, looter.id)).toBe(1);
  });
});
