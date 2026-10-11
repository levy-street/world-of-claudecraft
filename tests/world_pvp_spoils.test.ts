// World PvP spoils (src/sim/pvp/world_pvp_spoils.ts): a flagged-vs-flagged
// world kill drops the killing blow's share of the gold stake on the loser's
// body beside a trophy skull named for them, and the killer loots both through
// the ordinary corpse path. Pinned here: what drops and when (both flags
// required, the killing blow only, a broke purse still drops the skull), who
// may take it, and the settle rules that keep the drop from ever being denied
// or destroyed (release, revive, the zone-pass sweep, a departed killer, full
// bags, a second death before the sweep).
import { describe, expect, it } from 'vitest';
import { corpseIndicatorFor } from '../src/sim/corpse_loot_state';
import { BUILTIN_WORLD, ITEMS, ZONES } from '../src/sim/data';
import { isMaterialItemId } from '../src/sim/material_ids';
import {
  settleAllWorldPvpSpoils,
  WORLD_PVP_SKULL_ITEM_ID,
  WORLD_PVP_STAKE_CAP_COPPER,
  worldPvpSpoilsLine,
} from '../src/sim/pvp';
import { WORLD_PVP_TOGGLE_COOLDOWN } from '../src/sim/pvp/world_pvp';
import { Sim } from '../src/sim/sim';
import type { Entity, SimEvent, WorldContent } from '../src/sim/types';
import { DT } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';

const ARENA_FREE_WORLD: WorldContent = {
  ...BUILTIN_WORLD,
  camps: [],
  npcs: {},
  groundObjects: [],
};
const SEED = 7;
const CONTESTED = { x: 60, z: 700 };
const FFA = { x: 353.8, z: 2262.4 };

function world(): Sim {
  return new Sim({ seed: SEED, playerClass: 'warrior', noPlayer: true, world: ARENA_FREE_WORLD });
}

function place(sim: Sim, pid: number, spot: { x: number; z: number }, dx = 0): void {
  const e = ent(sim, pid);
  e.pos = { x: spot.x + dx, y: groundHeight(spot.x + dx, spot.z, SEED), z: spot.z };
  e.prevPos = { ...e.pos };
}

function fighter(sim: Sim, name: string, characterId: number, dx: number, level = 20): number {
  const pid = sim.addPlayer('warrior', name, { autoEquip: true, characterId });
  sim.setPlayerLevel(level, pid);
  const e = ent(sim, pid);
  e.hp = e.maxHp;
  place(sim, pid, CONTESTED, dx);
  return pid;
}

function ent(sim: Sim, pid: number): Entity {
  const entity = sim.entities.get(pid);
  if (!entity) throw new Error(`missing entity ${pid}`);
  return entity;
}

function partyMembersOf(sim: Sim, pid: number): number[] {
  const party = sim.partyOf(pid);
  if (!party) throw new Error(`missing party for ${pid}`);
  return party.members;
}

function playerNamed(sim: Sim, name: string) {
  const player = [...sim.players.values()].find((m) => m.name === name);
  if (!player) throw new Error(`missing player ${name}`);
  return player;
}

function flag(sim: Sim, pid: number): void {
  (sim as unknown as { time: number }).time += WORLD_PVP_TOGGLE_COOLDOWN + 1;
  sim.setWorldPvpFlag(true, pid);
  expect(ent(sim, pid).pvpFlag).toBe(true);
}

function slay(sim: Sim, killerPid: number, victimPid: number): void {
  const victim = ent(sim, victimPid);
  sim.ctx.dealDamage(
    ent(sim, killerPid),
    victim,
    victim.hp + 1_000,
    false,
    'physical',
    'Slam',
    'hit',
  );
  expect(victim.dead).toBe(true);
}

function hit(sim: Sim, attackerPid: number, victimPid: number): void {
  sim.ctx.dealDamage(
    ent(sim, attackerPid),
    ent(sim, victimPid),
    5,
    false,
    'physical',
    'Slam',
    'hit',
  );
}

function tickSeconds(sim: Sim, seconds: number): void {
  for (let i = 0; i < Math.round(seconds / DT); i++) sim.tick();
}

function metaOf(sim: Sim, pid: number) {
  const meta = sim.meta(pid);
  if (!meta) throw new Error(`missing player meta ${pid}`);
  return meta;
}

function skullsOf(sim: Sim, pid: number) {
  return metaOf(sim, pid).inventory.filter((s) => s.itemId === WORLD_PVP_SKULL_ITEM_ID);
}

/** One victim's bucket on a skull stack: the victim recorded as a gatherer is
 *  (their character identity and the name they died under). */
function victim(id: number, name: string, count = 1) {
  return { source: { gatherer: { kind: 'character' as const, id, name } }, count };
}

/** Whose skulls a slot holds, as [name, count] pairs. */
function victims(slot: {
  materialSources?: readonly { source: { gatherer?: { name: string } }; count: number }[];
}) {
  return (slot.materialSources ?? []).map((b) => [b.source.gatherer?.name ?? '', b.count]);
}

/** Fill every slot a skull could use. The skull is a provenance-tracked
 *  material, so it may also sit in a material-only bag pool: the filler must be
 *  a material too (copper ore, which never shares a skull's stack), or the
 *  general slots fill while the skull still has room. Bounded so a regression
 *  can never hang the suite. Call it BEFORE placing any skull stack: a skull
 *  stack with room always answers "room left". */
function fillBags(sim: Sim, pid: number): void {
  const meta = metaOf(sim, pid);
  for (let i = 0; i < 500 && sim.ctx.canAddItem(WORLD_PVP_SKULL_ITEM_ID, 1, pid); i++) {
    meta.inventory.push({ itemId: 'copper_ore', count: 1 });
  }
  expect(sim.ctx.canAddItem(WORLD_PVP_SKULL_ITEM_ID, 1, pid)).toBe(false);
}

function logLines(sim: Sim, pid: number): string[] {
  return sim.events
    .filter((ev): ev is Extract<SimEvent, { type: 'log' }> => ev.type === 'log' && ev.pid === pid)
    .map((ev) => ev.text);
}

function lootTexts(sim: Sim, pid: number): string[] {
  return sim.events
    .filter((ev): ev is Extract<SimEvent, { type: 'loot' }> => ev.type === 'loot' && ev.pid === pid)
    .map((ev) => ev.text);
}

/** Aleph (killer) and Bet (victim), both flagged on contested ground, Bet
 *  holding 2g so the stake is 20s. */
function duel() {
  const sim = world();
  const a = fighter(sim, 'Aleph', 1001, 0);
  const b = fighter(sim, 'Bet', 1002, 2);
  flag(sim, a);
  flag(sim, b);
  metaOf(sim, a).copper = 0;
  metaOf(sim, b).copper = 20_000;
  sim.events = [];
  return { sim, a, b };
}

describe('the drop', () => {
  it('a flagged kill drops the blow share and the named skull on the body, not in the purse', () => {
    const { sim, a, b } = duel();
    slay(sim, a, b);
    const body = ent(sim, b);
    // The victim is charged at the kill; the killer is paid only by looting.
    expect(metaOf(sim, b).copper).toBe(18_000);
    expect(metaOf(sim, a).copper).toBe(0);
    expect(body.lootable).toBe(true);
    expect(body.tappedById).toBe(a);
    expect(body.loot).toEqual({
      copper: 2_000,
      items: [
        {
          itemId: WORLD_PVP_SKULL_ITEM_ID,
          count: 1,
          personalFor: [a],
          materialSources: [victim(1002, 'Bet')],
        },
      ],
    });
    expect(sim.worldPvpBooks.spoils.get(b)).toBe(a);
    expect(logLines(sim, a)).toEqual(['You defeat Bet.', worldPvpSpoilsLine('Bet')]);
    expect(worldPvpSpoilsLine('Bet')).toBe("Loot Bet's body to claim your spoils.");
    expect(logLines(sim, b)).toContain('Aleph defeats you and takes 20s from your purse.');
  });

  it('the killer loots both through the corpse path; the body empties and the row clears', () => {
    const { sim, a, b } = duel();
    slay(sim, a, b);
    sim.events = [];
    expect(sim.lootCorpse(b, a)).toBe(true);
    expect(metaOf(sim, a).copper).toBe(2_000);
    const skulls = skullsOf(sim, a);
    expect(skulls).toHaveLength(1);
    // A plain stack (no per-copy payload) whose one source bucket names Bet.
    expect(skulls[0].instance).toBeUndefined();
    expect(skulls[0].materialSources).toEqual([victim(1002, 'Bet')]);
    expect(lootTexts(sim, a)).toContain('You loot 20s.');
    expect(lootTexts(sim, a)).toContain('You receive: Trophy Skull.');
    expect(ent(sim, b).lootable).toBe(false);
    expect(ent(sim, b).loot).toBeNull();
    tickSeconds(sim, 1); // the zone pass drops the spent row
    expect(sim.worldPvpBooks.spoils.has(b)).toBe(false);
    expect(ent(sim, b).tappedById).toBeNull();
    expect(ent(sim, b).corpseTimer).toBe(0);
  });

  it('a broke victim still drops the skull; the gold slot is simply empty', () => {
    const { sim, a, b } = duel();
    metaOf(sim, b).copper = 5; // 10% floors to nothing
    slay(sim, a, b);
    expect(ent(sim, b).loot?.copper).toBe(0);
    expect(ent(sim, b).loot?.items.map((s) => s.itemId)).toEqual([WORLD_PVP_SKULL_ITEM_ID]);
    sim.lootCorpse(b, a);
    expect(skullsOf(sim, a)).toHaveLength(1);
    expect(metaOf(sim, b).copper).toBe(5);
  });

  it('the stake cap still binds what drops', () => {
    const { sim, a, b } = duel();
    metaOf(sim, b).copper = 10_000_000;
    slay(sim, a, b);
    expect(ent(sim, b).loot?.copper).toBe(WORLD_PVP_STAKE_CAP_COPPER);
  });

  it('only the killing blow share drops: an assisting contributor is still paid purse to purse', () => {
    const { sim, a, b } = duel();
    const c = fighter(sim, 'Gimel', 1003, 4);
    flag(sim, c);
    metaOf(sim, c).copper = 0;
    metaOf(sim, b).copper = 10_000; // stake 1000 across 2: 500 each
    hit(sim, c, b);
    slay(sim, a, b);
    expect(metaOf(sim, c).copper).toBe(500);
    expect(ent(sim, b).loot?.copper).toBe(500);
    expect(metaOf(sim, b).copper).toBe(9_000);
    expect(skullsOf(sim, c)).toHaveLength(0);
  });

  it('no flag, no drop: an unflagged victim or an unflagged blow on free-for-all ground drops nothing', () => {
    const sim = world();
    const a = fighter(sim, 'Aleph', 1001, 0);
    const b = fighter(sim, 'Bet', 1002, 2);
    place(sim, a, FFA, 0);
    place(sim, b, FFA, 2);
    expect(ZONES.some((z) => z.worldPvp === 'ffa')).toBe(true);
    // Unflagged victim: the blow marks the attacker, but the victim stakes nothing.
    metaOf(sim, b).copper = 20_000;
    slay(sim, a, b);
    expect(ent(sim, a).pvpFlag).toBe(true);
    expect(ent(sim, b).lootable).toBe(false);
    expect(sim.worldPvpBooks.spoils.size).toBe(0);
    // Flagged victim, unflagged blow (hitting a flagged player never marks).
    const c = fighter(sim, 'Gimel', 1003, 0);
    const d = fighter(sim, 'Dalet', 1004, 2);
    place(sim, c, FFA, 4);
    place(sim, d, FFA, 6);
    flag(sim, d);
    metaOf(sim, d).copper = 20_000;
    slay(sim, c, d);
    expect(ent(sim, c).pvpFlag).toBeFalsy();
    expect(ent(sim, d).lootable).toBe(false);
    expect(skullsOf(sim, c)).toHaveLength(0);
  });

  it('a grey kill and a fully decayed repeat kill drop nothing', () => {
    const sim = world();
    const high = fighter(sim, 'Cap', 1001, 0, 20);
    const low = fighter(sim, 'Low', 1002, 2, 14);
    flag(sim, high);
    flag(sim, low);
    slay(sim, high, low);
    expect(ent(sim, low).lootable).toBe(false);
    // The DR: three paid kills of one victim in the hour, then nothing.
    const { sim: s2, a, b } = duel();
    for (let i = 0; i < 4; i++) {
      const body = ent(s2, b);
      if (i > 0) {
        s2.resurrectAtSpiritHealer(b);
        body.dead = false;
        body.hp = body.maxHp;
        place(s2, b, CONTESTED, 2);
        hit(s2, a, b);
      }
      slay(s2, a, b);
      if (i < 3) expect(body.lootable).toBe(true);
      else expect(body.lootable).toBe(false);
      s2.lootCorpse(b, a);
    }
  });
});

describe('who may take it', () => {
  it.each(['release', 'revive', 'logout', 'shutdown'] as const)(
    '%s tops up an existing skull stack when every bag slot is occupied',
    (settlement) => {
      const { sim, a, b } = duel();
      const meta = metaOf(sim, a);
      fillBags(sim, a);
      // An earlier skull from someone else, in place of one filler: skulls share
      // one stack whoever they name, so its spare room is the only room left.
      meta.inventory[0] = {
        itemId: WORLD_PVP_SKULL_ITEM_ID,
        count: 1,
        materialSources: [victim(1007, 'Zed')],
      };
      const slots = meta.inventory.length;
      slay(sim, a, b);
      sim.events = [];
      if (settlement === 'release') sim.releaseSpirit(b);
      else if (settlement === 'revive') sim.revivePlayerAt(b, { ...ent(sim, b).pos });
      else if (settlement === 'logout') sim.preparePlayerLeave(a);
      else settleAllWorldPvpSpoils(sim.ctx);
      const skulls = skullsOf(sim, a);
      expect(skulls).toHaveLength(1);
      expect(skulls[0].count).toBe(2);
      expect(victims(skulls[0]).sort()).toEqual([
        ['Bet', 1],
        ['Zed', 1],
      ]);
      expect(meta.inventory).toHaveLength(slots);
      expect(meta.copper).toBe(2_000);
      expect(sim.worldPvpBooks.spoils.size).toBe(0);
      expect(sim.events.some((ev) => ev.type === 'error')).toBe(false);
    },
  );

  it.each([{ count: 20 }])(
    'settlement refuses a full skull stack with no free slot: %j',
    ({ count }) => {
      const { sim, a, b } = duel();
      const meta = metaOf(sim, a);
      // Fill before inserting the skull so its stack room cannot mask full slots.
      fillBags(sim, a);
      meta.inventory[0] = {
        itemId: WORLD_PVP_SKULL_ITEM_ID,
        count,
        materialSources: [victim(1007, 'Zed', count)],
      };
      const before = structuredClone(meta.inventory);
      slay(sim, a, b);
      sim.events = [];
      sim.releaseSpirit(b);
      expect(meta.inventory).toEqual(before);
      expect(meta.copper).toBe(2_000);
      expect(
        sim.events.some((ev) => ev.type === 'error' && ev.text === 'Your bags are full.'),
      ).toBe(true);
    },
  );

  it('a stranger cannot loot the body; the killer can', () => {
    const { sim, a, b } = duel();
    const stranger = fighter(sim, 'Zayin', 1009, 1);
    slay(sim, a, b);
    sim.events = [];
    expect(sim.lootCorpse(b, stranger)).toBe(false);
    expect(metaOf(sim, stranger).copper).toBe(0);
    expect(ent(sim, b).loot?.copper).toBe(2_000);
    expect(sim.lootCorpse(b, a)).toBe(true);
  });

  it('the victim cannot deny the drop by releasing: the killer is paid on release', () => {
    const { sim, a, b } = duel();
    slay(sim, a, b);
    sim.events = [];
    sim.releaseSpirit(b);
    expect(ent(sim, b).ghost).toBe(true);
    expect(metaOf(sim, a).copper).toBe(2_000);
    expect(skullsOf(sim, a)).toHaveLength(1);
    expect(lootTexts(sim, a)).toContain('You loot 20s.');
    expect(ent(sim, b).lootable).toBe(false);
    expect(ent(sim, b).loot).toBeNull();
    expect(sim.worldPvpBooks.spoils.size).toBe(0);
  });

  it('a revive settles at once, with no zone pass needed', () => {
    const { sim, a, b } = duel();
    slay(sim, a, b);
    sim.revivePlayerAt(b, { ...ent(sim, b).pos });
    expect(ent(sim, b).dead).toBe(false);
    expect(metaOf(sim, a).copper).toBe(2_000);
    expect(skullsOf(sim, a)).toHaveLength(1);
    expect(sim.worldPvpBooks.spoils.size).toBe(0);
  });

  it('a partial loot leaves the skull on the body, and release settles the rest', () => {
    const { sim, a, b } = duel();
    slay(sim, a, b);
    // Take only the gold: the skull slot is left by filling Aleph's bags.
    const room = metaOf(sim, a);
    fillBags(sim, a);
    sim.lootCorpse(b, a);
    expect(metaOf(sim, a).copper).toBe(2_000);
    expect(ent(sim, b).loot?.items).toHaveLength(1);
    // Make room, then Bet stands up at the spirit healer: the skull goes to Aleph.
    room.inventory.pop();
    sim.releaseSpirit(b);
    expect(skullsOf(sim, a)).toHaveLength(1);
    expect(sim.worldPvpBooks.spoils.size).toBe(0);
  });

  it('a body that stands up by any other route is settled by the zone pass', () => {
    const { sim, a, b } = duel();
    slay(sim, a, b);
    const body = ent(sim, b);
    body.dead = false; // a revive path that does not settle
    body.hp = body.maxHp;
    tickSeconds(sim, 1);
    expect(metaOf(sim, a).copper).toBe(2_000);
    expect(skullsOf(sim, a)).toHaveLength(1);
    expect(body.lootable).toBe(false);
    expect(sim.worldPvpBooks.spoils.size).toBe(0);
  });

  it('a second death before the sweep pays the earlier killer first, never overwrites', () => {
    const { sim, a, b } = duel();
    const c = fighter(sim, 'Gimel', 1003, 4);
    flag(sim, c);
    metaOf(sim, c).copper = 0;
    slay(sim, a, b);
    const body = ent(sim, b);
    body.dead = false;
    body.hp = body.maxHp;
    hit(sim, c, b);
    slay(sim, c, b);
    expect(metaOf(sim, a).copper).toBe(2_000); // Aleph's unlooted share, settled
    expect(skullsOf(sim, a)).toHaveLength(1);
    expect(body.tappedById).toBe(c);
    expect(sim.worldPvpBooks.spoils.get(b)).toBe(c);
  });

  it('a killer removed from the world is paid on the way out; a killer already gone refunds the victim', () => {
    const { sim, a, b } = duel();
    slay(sim, a, b);
    expect(metaOf(sim, b).copper).toBe(18_000);
    const killer = metaOf(sim, a);
    sim.removePlayer(a);
    expect(killer.copper).toBe(2_000); // settled into the leaving purse
    expect(ent(sim, b).loot).toBeNull();
    sim.releaseSpirit(b);
    expect(metaOf(sim, b).copper).toBe(18_000);
    // A killer missing at settle time (no leave hook ran): the gold goes home.
    const { sim: s2, a: k, b: v } = duel();
    slay(s2, k, v);
    s2.players.delete(k);
    s2.releaseSpirit(v);
    expect(metaOf(s2, v).copper).toBe(20_000);
    expect(ent(s2, v).loot).toBeNull();
  });

  it('full bags on settle keep the gold flowing and say so for the skull', () => {
    const { sim, a, b } = duel();
    slay(sim, a, b);
    const meta = metaOf(sim, a);
    fillBags(sim, a);
    sim.events = [];
    sim.releaseSpirit(b);
    expect(meta.copper).toBe(2_000);
    expect(skullsOf(sim, a)).toHaveLength(0);
    expect(
      sim.events.some(
        (ev) => ev.type === 'error' && ev.pid === a && ev.text === 'Your bags are full.',
      ),
    ).toBe(true);
  });

  it('every skull shares one stack, and the stack remembers whose each one is', () => {
    const { sim, a, b } = duel();
    const c = fighter(sim, 'Gimel', 1003, 4);
    flag(sim, c);
    slay(sim, a, b);
    sim.lootCorpse(b, a);
    hit(sim, a, c);
    slay(sim, a, c);
    sim.lootCorpse(c, a);
    sim.resurrectAtSpiritHealer(b);
    const body = ent(sim, b);
    body.dead = false;
    body.hp = body.maxHp;
    place(sim, b, CONTESTED, 2);
    hit(sim, a, b);
    slay(sim, a, b);
    sim.lootCorpse(b, a);
    const skulls = skullsOf(sim, a);
    expect(skulls).toHaveLength(1);
    expect(skulls[0].count).toBe(3);
    expect(victims(skulls[0]).sort()).toEqual([
      ['Bet', 2],
      ['Gimel', 1],
    ]);
  });
});

describe('review hardening: rights, leave, shutdown, the interact key, the icon', () => {
  it("the killer's party mate can open neither the gold nor the skull, and sees no loot icon", () => {
    const { sim, a, b } = duel();
    const mate = fighter(sim, 'Hey', 1005, 1);
    sim.partyInvite(mate, a);
    sim.partyAccept(mate);
    expect(sim.partyOf(a)?.members).toContain(mate);
    slay(sim, a, b);
    expect(sim.lootCorpse(b, mate)).toBe(false);
    expect(metaOf(sim, mate).copper).toBe(0);
    expect(ent(sim, b).loot?.copper).toBe(2_000);
    const party = partyMembersOf(sim, a);
    expect(corpseIndicatorFor(ent(sim, b), mate, party)).toBe('none');
    expect(corpseIndicatorFor(ent(sim, b), a, party)).toBe('loot');
    expect(corpseIndicatorFor(ent(sim, b), 9_999, null)).toBe('none');
    // A plain dead player (no spoils) never shows the icon.
    sim.lootCorpse(b, a);
    expect(corpseIndicatorFor(ent(sim, b), a, party)).toBe('none');
  });

  it('the interact key loots a targeted body, like a corpse', () => {
    const { sim, a, b } = duel();
    slay(sim, a, b);
    sim.targetEntity(b, a);
    sim.interact(a);
    expect(metaOf(sim, a).copper).toBe(2_000);
    expect(skullsOf(sim, a)).toHaveLength(1);
  });

  it('a standing player is never lootable, even with a stale spoils row', () => {
    const { sim, a, b } = duel();
    slay(sim, a, b);
    const body = ent(sim, b);
    body.dead = false; // stood up by a route that did not settle, before the sweep
    expect(sim.lootCorpse(b, a)).toBe(false);
    expect(metaOf(sim, a).copper).toBe(0);
    tickSeconds(sim, 1);
    expect(metaOf(sim, a).copper).toBe(2_000);
  });

  it('a victim who logs out dead pays the killer before leaving (no gold sink)', () => {
    const { sim, a, b } = duel();
    slay(sim, a, b);
    sim.preparePlayerLeave(b);
    expect(metaOf(sim, a).copper).toBe(2_000);
    expect(skullsOf(sim, a)).toHaveLength(1);
    sim.removePlayer(b);
    tickSeconds(sim, 1);
    expect(metaOf(sim, a).copper).toBe(2_000);
    // A host without the prepare hook (offline, headless) settles on removal.
    const { sim: s2, a: k, b: v } = duel();
    slay(s2, k, v);
    s2.removePlayer(v);
    expect(metaOf(s2, k).copper).toBe(2_000);
  });

  it('a killer who logs out is paid into the purse their leave snapshot saves', () => {
    const { sim, a, b } = duel();
    slay(sim, a, b);
    sim.preparePlayerLeave(a);
    expect(metaOf(sim, a).copper).toBe(2_000);
    expect(ent(sim, b).loot).toBeNull();
    // A settle that lands while the killer is already leaving refunds the victim.
    const { sim: s2, a: k, b: v } = duel();
    slay(s2, k, v);
    metaOf(s2, k).leaving = true;
    s2.releaseSpirit(v);
    expect(metaOf(s2, k).copper).toBe(0);
    expect(metaOf(s2, v).copper).toBe(20_000);
  });

  it('a graceful shutdown settles every body before the final save', () => {
    const { sim, a, b } = duel();
    const c = fighter(sim, 'Gimel', 1003, 4);
    flag(sim, c);
    metaOf(sim, c).copper = 20_000;
    slay(sim, a, b);
    hit(sim, a, c);
    slay(sim, a, c);
    settleAllWorldPvpSpoils(sim.ctx);
    expect(metaOf(sim, a).copper).toBe(4_000);
    expect(sim.worldPvpBooks.spoils.size).toBe(0);
  });

  it('gold settled off the body books the same looted-gold tally as a corpse take', () => {
    const looted = duel();
    slay(looted.sim, looted.a, looted.b);
    looted.sim.lootCorpse(looted.b, looted.a);
    const settled = duel();
    slay(settled.sim, settled.a, settled.b);
    settled.sim.releaseSpirit(settled.b);
    expect(metaOf(settled.sim, settled.a).counters.lootCopper).toBe(2_000);
    expect(metaOf(looted.sim, looted.a).counters.lootCopper).toBe(2_000);
  });
});

describe('/dev pvpbot (the solo playtest target)', () => {
  it('spawns a flagged bot at your level with 10g, and killing it drops the spoils', () => {
    const sim = new Sim({
      seed: SEED,
      playerClass: 'warrior',
      noPlayer: true,
      devCommands: true,
      world: ARENA_FREE_WORLD,
    });
    const me = fighter(sim, 'Aleph', 1001, 0, 18);
    flag(sim, me);
    sim.chat('/dev pvpbot Bet', me);
    const bot = playerNamed(sim, 'Bet');
    const body = ent(sim, bot.entityId);
    expect(body.level).toBe(18);
    expect(body.pvpFlag).toBe(true);
    expect(bot.copper).toBe(100_000);
    expect(
      Math.hypot(body.pos.x - ent(sim, me).pos.x, body.pos.z - ent(sim, me).pos.z),
    ).toBeLessThan(5);
    slay(sim, me, bot.entityId);
    expect(body.loot?.copper).toBe(10_000);
    expect(sim.lootCorpse(bot.entityId, me)).toBe(true);
    expect(metaOf(sim, me).copper).toBe(10_000);
    // The dev bot carries a dev identity, so its skull still names it.
    expect(victims(skullsOf(sim, me)[0])).toEqual([['Bet', 1]]);
  });

  it('is refused on a realm without dev commands', () => {
    const sim = world();
    const me = fighter(sim, 'Aleph', 1001, 0);
    sim.chat('/dev pvpbot Bet', me);
    expect([...sim.players.values()].some((m) => m.name === 'Bet')).toBe(false);
  });
});

describe('the trophy item', () => {
  it('is a vendor-worthless junk keepsake', () => {
    const def = ITEMS[WORLD_PVP_SKULL_ITEM_ID];
    expect(def).toMatchObject({
      name: 'Trophy Skull',
      kind: 'junk',
      quality: 'common',
      sellValue: 0,
      noVendorSell: true,
    });
    // A provenance-tracked stack, the way gathered materials are.
    expect(isMaterialItemId(WORLD_PVP_SKULL_ITEM_ID)).toBe(true);
  });
});
