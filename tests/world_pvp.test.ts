// World PvP (the /pvp flag, src/sim/pvp/world_pvp.ts): the flag lifecycle
// (raise, the 5-minute disarm and its in-combat deferral, the toggle cooldown,
// the realm kill switch, the /pvp chat arms), the hostility arm in isHostileTo
// (mutual flag, the party exemption (guildmates fight), the jail and instanced-PvP arms,
// the #96 griefing invariant for everyone unflagged), the kill resolution (the
// gold stake and the honor pool split across the killing blow, the damagers
// and their healers; the grey rule; the persisted per-victim diminishing
// returns; the paid-death guard), the healer auto-flag, the books sweep, the
// persistence round trip, and the determinism guarantees.
import { describe, expect, it } from 'vitest';
import { applyHeal } from '../src/sim/combat/heal';
import { BUILTIN_WORLD, PLAYER_START, ZONES } from '../src/sim/data';
import {
  WORLD_PVP_ASSIST_WINDOW,
  WORLD_PVP_DISARM_SECONDS,
  WORLD_PVP_DR_WINDOW_SECONDS,
  WORLD_PVP_KILL_HONOR,
  WORLD_PVP_MIN_LEVEL,
  WORLD_PVP_STAKE_CAP_COPPER,
} from '../src/sim/pvp';
import {
  WORLD_PVP_AID_REFUSED_LINE,
  WORLD_PVP_AIDED_LINE,
  WORLD_PVP_FFA_ENTER_LINE,
  WORLD_PVP_FFA_LEAVE_LINE,
  WORLD_PVP_MARKED_LINE,
  WORLD_PVP_SANCTUARY_LINE,
  WORLD_PVP_TOGGLE_COOLDOWN,
  worldPvpDefeatLine,
  worldPvpKillLine,
  worldPvpOnOwnedPetDamaged,
  worldPvpOnPlayerAided,
  worldPvpOnPlayerDamaged,
  worldPvpOnPlayerDeath,
} from '../src/sim/pvp/world_pvp';
import { Sim } from '../src/sim/sim';
import type { Entity, SimConfig, SimEvent, WorldContent } from '../src/sim/types';
import { DT } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';

// Two-or-more-player fights need no ambient world: strip the camps, NPCs and
// ground objects (the pvp_safety.test.ts precedent) so a minute of sim time is
// cheap, while every terrain field stays BUILTIN_WORLD's.
const ARENA_FREE_WORLD: WorldContent = {
  ...BUILTIN_WORLD,
  camps: [],
  npcs: {},
  groundObjects: [],
};

const DAY_ONE = '2026-07-08';
const DAY_TWO = '2026-07-09';

function world(extra: Partial<SimConfig> = {}): Sim {
  const sim = new Sim({
    seed: 7,
    playerClass: 'warrior',
    noPlayer: true,
    world: ARENA_FREE_WORLD,
    ...extra,
  });
  sim.resetDay = DAY_ONE;
  return sim;
}

const SEED = 7;
/** Contested ground (the mutual-flag rule), a free-for-all zone, and the two
 *  sanctuaries, by zone id; placeIn stands a player on the zone's graveyard
 *  (open ground, no hub colliders). Every fighter starts on contested ground:
 *  the default spawn is Eastbrook Vale, a sanctuary, where nobody is hostile. */
const CONTESTED_ZONE = 'thornpeak_heights';
const FFA_ZONE = 'drakelands';
const STARTER_ZONE = 'eastbrook_vale';
const TUTORIAL_ZONE = 'proving_shore';

/** Open ground with a clear line of sight inside the two zones that host
 *  casts (a graveyard's stones block a shield); the sanctuaries use their
 *  graveyards, which only ever host a hostility check. */
const OPEN_GROUND: Record<string, { x: number; z: number }> = {
  [CONTESTED_ZONE]: { x: 60, z: 700 },
  [FFA_ZONE]: { x: 353.8, z: 2262.4 },
  [STARTER_ZONE]: { x: PLAYER_START.x, z: PLAYER_START.z },
};

function placeIn(sim: Sim, pid: number, zoneId: string, dx = 0): void {
  const zone = ZONES.find((z) => z.id === zoneId);
  if (!zone) throw new Error(`no zone ${zoneId}`);
  const spot = OPEN_GROUND[zoneId] ?? zone.graveyard;
  const e = sim.entities.get(pid)!;
  const x = spot.x + dx;
  const z = spot.z;
  e.pos = { x, y: groundHeight(x, z, SEED), z };
  e.prevPos = { ...e.pos };
}

function addFighter(
  sim: Sim,
  name: string,
  level = 20,
  characterId?: number,
  cls: 'warrior' | 'priest' | 'mage' = 'warrior',
): number {
  const pid = sim.addPlayer(cls, name, { autoEquip: true, characterId });
  sim.setPlayerLevel(level, pid);
  const e = sim.entities.get(pid)!;
  e.hp = e.maxHp;
  e.resource = e.maxResource;
  placeIn(sim, pid, CONTESTED_ZONE);
  return pid;
}

function ent(sim: Sim, pid: number): Entity {
  return sim.entities.get(pid)!;
}

function standTogether(sim: Sim, pids: number[]): void {
  const anchor = ent(sim, pids[0]);
  pids.slice(1).forEach((pid, i) => {
    const e = ent(sim, pid);
    e.pos = { ...anchor.pos, x: anchor.pos.x + 2 * (i + 1) };
    e.prevPos = { ...e.pos };
  });
}

function logLines(sim: Sim, pid: number): string[] {
  return sim.events
    .filter((ev): ev is Extract<SimEvent, { type: 'log' }> => ev.type === 'log' && ev.pid === pid)
    .map((ev) => ev.text);
}

function errorLines(sim: Sim, pid: number): string[] {
  return sim.events
    .filter(
      (ev): ev is Extract<SimEvent, { type: 'error' }> => ev.type === 'error' && ev.pid === pid,
    )
    .map((ev) => ev.text);
}

function honorEvents(sim: Sim, pid: number) {
  return sim.events.filter(
    (ev): ev is Extract<SimEvent, { type: 'honor' }> => ev.type === 'honor' && ev.pid === pid,
  );
}

function tickSeconds(sim: Sim, seconds: number): void {
  for (let i = 0; i < Math.round(seconds / DT); i++) sim.tick();
}

/** Tick, collecting one player's log lines from every tick's event window
 *  (tick() RETURNS the window's events and clears the queue). */
function tickCollecting(sim: Sim, seconds: number, pid: number): string[] {
  const seen: string[] = [];
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    for (const ev of sim.tick()) {
      if (ev.type === 'log' && ev.pid === pid) seen.push(ev.text);
    }
  }
  return seen;
}

/** Jump the sim clock without paying for the ticks (the toggle cooldown, the
 *  assist window); one tick follows so the clocks settle. */
function advanceClock(sim: Sim, seconds: number): void {
  (sim as unknown as { time: number }).time += seconds;
  sim.tick();
}

/** Past the toggle cooldown, so back-to-back flag changes are accepted. */
function cool(sim: Sim): void {
  advanceClock(sim, WORLD_PVP_TOGGLE_COOLDOWN + 1);
}

function flag(sim: Sim, pid: number, on = true): void {
  cool(sim);
  sim.setWorldPvpFlag(on, pid);
}

/** A lethal hit through the real damage hub (the same path every cast ends in). */
function slay(sim: Sim, killerPid: number, victimPid: number): void {
  const killer = ent(sim, killerPid);
  const victim = ent(sim, victimPid);
  sim.ctx.dealDamage(killer, victim, victim.hp + 1_000, false, 'physical', 'Mortal Strike', 'hit');
}

function hit(sim: Sim, attackerPid: number, victimPid: number, amount = 5): void {
  sim.ctx.dealDamage(
    ent(sim, attackerPid),
    ent(sim, victimPid),
    amount,
    false,
    'physical',
    'Slam',
    'hit',
  );
}

function heal(sim: Sim, healerPid: number, targetPid: number): void {
  const target = ent(sim, targetPid);
  target.hp = Math.max(1, target.hp - 50);
  applyHeal(sim.ctx, ent(sim, healerPid), target, 40, 'Flash Heal', null, false, false);
}

function revive(sim: Sim, pid: number): void {
  const e = ent(sim, pid);
  e.dead = false;
  e.hp = e.maxHp;
}

describe('the tuning literals the copy and the docs quote', () => {
  it('pins the level gate, the assist window, the disarm, the cooldown, the pool and the cap', () => {
    expect(WORLD_PVP_MIN_LEVEL).toBe(10);
    expect(WORLD_PVP_ASSIST_WINDOW).toBe(10);
    expect(WORLD_PVP_DISARM_SECONDS).toBe(300);
    expect(WORLD_PVP_TOGGLE_COOLDOWN).toBe(2);
    expect(WORLD_PVP_KILL_HONOR).toBe(10);
    expect(WORLD_PVP_STAKE_CAP_COPPER).toBe(50_000);
  });
});

describe('the /pvp flag lifecycle', () => {
  it('raises the flag through the command and mirrors it onto the entity', () => {
    const sim = world();
    const a = addFighter(sim, 'Aleph');
    expect(sim.worldPvpInfoFor(a)).toEqual({
      flagged: false,
      disarmRemaining: null,
      kills: 0,
      deaths: 0,
      levelLocked: false,
      zone: 'contested',
      enabled: true,
    });
    sim.setWorldPvpFlag(true, a);
    expect(ent(sim, a).pvpFlag).toBe(true);
    expect(sim.meta(a)!.worldPvp).toMatchObject({
      flagged: true,
      disarmAt: null,
      kills: 0,
      deaths: 0,
    });
    expect(logLines(sim, a)).toContain('World PvP enabled: other flagged players can attack you.');
    expect(sim.worldPvpInfoFor(a)!.flagged).toBe(true);
  });

  it('refuses below the minimum level and leaves no record behind', () => {
    const sim = world();
    const a = addFighter(sim, 'Novice', 9);
    expect(sim.worldPvpInfoFor(a)!.levelLocked).toBe(true);
    sim.setWorldPvpFlag(true, a);
    expect(ent(sim, a).pvpFlag).toBeUndefined();
    expect(sim.meta(a)!.worldPvp).toBeUndefined();
    expect(errorLines(sim, a)).toContain('You must be at least level 10 to enable World PvP.');
  });

  it('refuses on a realm whose kill switch is set, and loads a saved flag down', () => {
    const open = world();
    const seed = addFighter(open, 'Seed', 20, 77);
    open.setWorldPvpFlag(true, seed);
    const saved = open.serializeCharacter(seed)!;
    const closed = world({ worldPvpDisabled: true });
    const a = addFighter(closed, 'Aleph');
    closed.setWorldPvpFlag(true, a);
    expect(ent(closed, a).pvpFlag).toBeUndefined();
    expect(errorLines(closed, a)).toContain('World PvP is disabled on this realm.');
    const loaded = closed.addPlayer('warrior', 'Seed', { state: saved, characterId: 77 });
    expect(ent(closed, loaded).pvpFlag).toBeFalsy();
    expect(closed.worldPvpInfoFor(loaded)!.flagged).toBe(false);
  });

  it('lowering starts the countdown, the flag stays up until it runs out', () => {
    const sim = world();
    const a = addFighter(sim, 'Aleph');
    flag(sim, a);
    flag(sim, a, false);
    expect(ent(sim, a).pvpFlag).toBe(true);
    expect(sim.worldPvpInfoFor(a)!.disarmRemaining).toBe(300);
    expect(logLines(sim, a)).toContain('World PvP will be disabled in 5 minutes.');
    tickSeconds(sim, WORLD_PVP_DISARM_SECONDS - 1);
    expect(ent(sim, a).pvpFlag).toBe(true);
    expect(sim.worldPvpInfoFor(a)!.disarmRemaining).toBe(1);
    const seen = tickCollecting(sim, 2, a);
    expect(ent(sim, a).pvpFlag).toBe(false);
    expect(sim.worldPvpInfoFor(a)!).toMatchObject({ flagged: false, disarmRemaining: null });
    expect(seen).toContain('World PvP disabled.');
  });

  it('reports the countdown in whole seconds so the self wire elides it between seconds', () => {
    const sim = world();
    const a = addFighter(sim, 'Aleph');
    flag(sim, a);
    flag(sim, a, false);
    for (let i = 0; i < 7; i++) {
      sim.tick();
      expect(Number.isInteger(sim.worldPvpInfoFor(a)!.disarmRemaining)).toBe(true);
    }
  });

  it('a running countdown is deferred while the player is in combat', () => {
    const sim = world();
    const a = addFighter(sim, 'Aleph');
    flag(sim, a);
    flag(sim, a, false);
    tickSeconds(sim, WORLD_PVP_DISARM_SECONDS - 1);
    // A fight is on as the clock runs out (the engaged pass keeps inCombat up
    // for 5 s after the last blow): the flag must not fall mid-swing.
    for (let i = 0; i < 20 * 3; i++) {
      ent(sim, a).combatTimer = 0;
      sim.tick();
    }
    expect(ent(sim, a).inCombat).toBe(true);
    expect(sim.worldPvpInfoFor(a)!.disarmRemaining).toBe(0);
    expect(ent(sim, a).pvpFlag).toBe(true);
    // The fight ends: the deferred drop lands on the next tick.
    ent(sim, a).combatTimer = 60;
    sim.tick();
    expect(ent(sim, a).inCombat).toBe(false);
    expect(ent(sim, a).pvpFlag).toBe(false);
  });

  it('raising again during the countdown cancels it; the toggle reads a countdown as off', () => {
    const sim = world();
    const a = addFighter(sim, 'Aleph');
    flag(sim, a);
    flag(sim, a, false);
    flag(sim, a);
    expect(sim.worldPvpInfoFor(a)!.disarmRemaining).toBeNull();
    expect(logLines(sim, a)).toContain('World PvP stays enabled.');
    tickSeconds(sim, WORLD_PVP_DISARM_SECONDS + 5);
    expect(ent(sim, a).pvpFlag).toBe(true);
    // Bare /pvp: armed -> starts the countdown; during the countdown -> re-arms.
    cool(sim);
    sim.chat('/pvp', a);
    expect(sim.worldPvpInfoFor(a)!.disarmRemaining).toBe(300);
    cool(sim);
    sim.chat('/pvp', a);
    expect(sim.worldPvpInfoFor(a)!.disarmRemaining).toBeNull();
    expect(ent(sim, a).pvpFlag).toBe(true);
  });

  it('holds a cooldown between accepted changes, so the flag cannot be flapped', () => {
    const sim = world();
    const a = addFighter(sim, 'Aleph');
    sim.setWorldPvpFlag(true, a);
    sim.setWorldPvpFlag(false, a);
    expect(sim.worldPvpInfoFor(a)!.disarmRemaining).toBeNull();
    expect(errorLines(sim, a)).toContain('World PvP: wait a moment before switching again.');
    cool(sim);
    sim.setWorldPvpFlag(false, a);
    expect(sim.worldPvpInfoFor(a)!.disarmRemaining).toBe(300);
  });

  it('answers every no-op with its own error line', () => {
    const sim = world();
    const a = addFighter(sim, 'Aleph');
    sim.setWorldPvpFlag(false, a);
    expect(errorLines(sim, a)).toContain('World PvP is already disabled.');
    flag(sim, a);
    flag(sim, a);
    expect(errorLines(sim, a)).toContain('World PvP is already enabled.');
    flag(sim, a, false);
    flag(sim, a, false);
    expect(errorLines(sim, a)).toContain('World PvP is already switching off.');
  });

  it('/pvp on|enable, /pvp off|disable, a bad argument and an extra word route through chat', () => {
    const sim = world();
    const a = addFighter(sim, 'Aleph');
    cool(sim);
    sim.chat('/pvp enable', a);
    expect(ent(sim, a).pvpFlag).toBe(true);
    cool(sim);
    sim.chat('/pvp OFF', a);
    expect(sim.worldPvpInfoFor(a)!.disarmRemaining).toBe(300);
    cool(sim);
    sim.chat('/pvp on', a);
    expect(sim.worldPvpInfoFor(a)!.disarmRemaining).toBeNull();
    cool(sim);
    sim.chat('/pvp disable', a);
    expect(sim.worldPvpInfoFor(a)!.disarmRemaining).toBe(300);
    sim.chat('/pvp maybe', a);
    expect(errorLines(sim, a)).toContain('Usage: /pvp, /pvp on, or /pvp off.');
    sim.chat('/pvp on extra', a);
    expect(errorLines(sim, a).some((line) => line.startsWith('Unknown command: /pvp'))).toBe(true);
    // /arena and /rating keep the arena readout; /pvp no longer aliases it.
    sim.chat('/arena', a);
    expect(errorLines(sim, a).some((line) => line.startsWith('Arena: 1v1 Rating'))).toBe(true);
  });
});

describe('hostility: the world arm of isHostileTo', () => {
  it('two flagged strangers can target and auto-attack each other; unflagged pairs cannot (#96)', () => {
    const sim = world();
    const a = addFighter(sim, 'Aleph');
    const b = addFighter(sim, 'Bet');
    standTogether(sim, [a, b]);
    expect(sim.isHostileTo(ent(sim, a), ent(sim, b))).toBe(false);
    flag(sim, a);
    // One-sided: a flagged player is NOT hostile to an unflagged one, either way.
    expect(sim.isHostileTo(ent(sim, a), ent(sim, b))).toBe(false);
    expect(sim.isHostileTo(ent(sim, b), ent(sim, a))).toBe(false);
    flag(sim, b);
    expect(sim.isHostileTo(ent(sim, a), ent(sim, b))).toBe(true);
    expect(sim.isHostileTo(ent(sim, b), ent(sim, a))).toBe(true);
    // The real attack path: an auto-attack lands only once both are flagged.
    const startHp = ent(sim, b).hp;
    ent(sim, a).facing = Math.atan2(
      ent(sim, b).pos.x - ent(sim, a).pos.x,
      ent(sim, b).pos.z - ent(sim, a).pos.z,
    );
    sim.targetEntity(b, a);
    sim.startAutoAttack(a);
    tickSeconds(sim, 6);
    expect(ent(sim, b).hp).toBeLessThan(startHp);
  });

  it('an unflagged player cannot be hit by a flagged one through the swing loop', () => {
    const sim = world();
    const a = addFighter(sim, 'Aleph');
    const b = addFighter(sim, 'Bet');
    standTogether(sim, [a, b]);
    flag(sim, a);
    const startHp = ent(sim, b).hp;
    sim.targetEntity(b, a);
    sim.startAutoAttack(a);
    tickSeconds(sim, 6);
    expect(ent(sim, b).hp).toBe(startHp);
  });

  it('party mates are exempt both ways even when both are flagged; guildmates are not', () => {
    const sim = world();
    const a = addFighter(sim, 'Aleph');
    const b = addFighter(sim, 'Bet');
    const c = addFighter(sim, 'Gimel');
    for (const pid of [a, b, c]) flag(sim, pid);
    sim.partyInvite(b, a);
    sim.partyAccept(b);
    expect(sim.partyOf(a)?.members).toContain(b);
    expect(sim.isHostileTo(ent(sim, a), ent(sim, b))).toBe(false);
    expect(sim.isHostileTo(ent(sim, b), ent(sim, a))).toBe(false);
    expect(sim.isHostileTo(ent(sim, a), ent(sim, c))).toBe(true);
    // A guild is no shield outside a group (owner spec): only a party is.
    sim.setPlayerGuild(a, 'Ravens');
    sim.setPlayerGuild(c, 'Ravens');
    expect(sim.isHostileTo(ent(sim, a), ent(sim, c))).toBe(true);
    expect(sim.isHostileTo(ent(sim, c), ent(sim, a))).toBe(true);
  });

  it('the jail brawl and a live battleground or arena keep the world arm off', () => {
    const sim = world();
    const a = addFighter(sim, 'Aleph');
    const b = addFighter(sim, 'Bet');
    flag(sim, a);
    flag(sim, b);
    expect(sim.isHostileTo(ent(sim, a), ent(sim, b))).toBe(true);
    ent(sim, b).jailed = true;
    expect(sim.isHostileTo(ent(sim, a), ent(sim, b))).toBe(false);
    expect(sim.isHostileTo(ent(sim, b), ent(sim, a))).toBe(false);
    ent(sim, b).jailed = false;
    // A live match on EITHER side suppresses the world arm (that mode's rules win).
    sim.bgMatches.set(a, { state: 'active' } as never);
    expect(sim.isHostileTo(ent(sim, b), ent(sim, a))).toBe(false);
    sim.bgMatches.delete(a);
    sim.arenaMatches.set(b, { state: 'active' } as never);
    expect(sim.isHostileTo(ent(sim, a), ent(sim, b))).toBe(false);
    sim.arenaMatches.delete(b);
    expect(sim.isHostileTo(ent(sim, a), ent(sim, b))).toBe(true);
  });

  it('an unflagged bystander is hostile to nobody and nobody is hostile to them', () => {
    const sim = world();
    const a = addFighter(sim, 'Aleph');
    const b = addFighter(sim, 'Bet');
    const c = addFighter(sim, 'Gimel');
    flag(sim, a);
    flag(sim, b);
    expect(sim.isHostileTo(ent(sim, c), ent(sim, a))).toBe(false);
    expect(sim.isHostileTo(ent(sim, a), ent(sim, c))).toBe(false);
    expect(sim.isHostileTo(ent(sim, a), ent(sim, b))).toBe(true);
  });
});

describe('kill resolution: the stake and the honor pool', () => {
  function duel(): { sim: Sim; a: number; b: number } {
    const sim = world();
    const a = addFighter(sim, 'Aleph', 20, 1001);
    const b = addFighter(sim, 'Bet', 20, 1002);
    standTogether(sim, [a, b]);
    flag(sim, a);
    flag(sim, b);
    sim.events = [];
    return { sim, a, b };
  }

  it('a clean 1v1 moves 10% of the purse and the whole honor pool to the killer', () => {
    const { sim, a, b } = duel();
    sim.meta(b)!.copper = 20_000; // 2g: below the cap, so 10% = 20s
    sim.meta(a)!.copper = 0;
    slay(sim, a, b);
    expect(ent(sim, b).dead).toBe(true);
    expect(sim.meta(b)!.copper).toBe(18_000);
    expect(sim.meta(a)!.copper).toBe(2_000);
    expect(sim.meta(a)!.honor).toBe(10);
    expect(honorEvents(sim, a)).toEqual([
      { type: 'honor', pid: a, amount: 10, reason: 'world_kill' },
    ]);
    expect(logLines(sim, a)).toContain('You defeat Bet and take 20s from their purse.');
    expect(logLines(sim, b)).toContain('Aleph defeats you and takes 20s from your purse.');
    expect(sim.worldPvpInfoFor(a)).toMatchObject({ kills: 1, deaths: 0 });
    expect(sim.worldPvpInfoFor(b)).toMatchObject({ kills: 0, deaths: 1 });
  });

  it('the stake is capped at 5g on a rich purse', () => {
    const { sim, a, b } = duel();
    sim.meta(b)!.copper = 1_000_000; // 100g
    slay(sim, a, b);
    expect(sim.meta(b)!.copper).toBe(950_000);
    expect(sim.meta(a)!.copper).toBe(50_000);
    expect(logLines(sim, a)).toContain('You defeat Bet and take 5g from their purse.');
  });

  it('a broke victim pays nothing but the honor still flows', () => {
    const { sim, a, b } = duel();
    sim.meta(b)!.copper = 5;
    slay(sim, a, b);
    expect(sim.meta(b)!.copper).toBe(5);
    expect(sim.meta(a)!.copper).toBe(0);
    expect(sim.meta(a)!.honor).toBe(10);
    expect(logLines(sim, a)).toContain('You defeat Bet.');
    expect(logLines(sim, b)).toContain('Aleph defeats you.');
  });

  it('pays a death exactly once, even if the death hub is re-entered on the corpse', () => {
    const { sim, a, b } = duel();
    sim.meta(b)!.copper = 10_000;
    slay(sim, a, b);
    expect(sim.meta(a)!.copper).toBe(1_000);
    worldPvpOnPlayerDeath(sim.ctx, ent(sim, b), ent(sim, a));
    expect(sim.meta(a)!.copper).toBe(1_000);
    expect(sim.meta(b)!.copper).toBe(9_000);
    expect(sim.worldPvpInfoFor(b)!.deaths).toBe(1);
    // Standing up again (the next hit taken) re-arms the next real death.
    revive(sim, b);
    hit(sim, a, b);
    slay(sim, a, b);
    expect(sim.meta(a)!.copper).toBe(1_450); // the second kill of Bet today pays 50%
  });

  it('splits gold and honor across the killer, the damagers and their healers; the blow takes the remainder', () => {
    const sim = world();
    const a = addFighter(sim, 'Aleph', 20, 1);
    const b = addFighter(sim, 'Bet', 20, 2);
    const healer = addFighter(sim, 'Heal', 20, 3);
    const victim = addFighter(sim, 'Victim', 20, 4);
    standTogether(sim, [victim, a, b, healer]);
    for (const pid of [a, b, healer, victim]) flag(sim, pid);
    sim.meta(victim)!.copper = 10_000; // stake 1000c across 3 -> 333 each, +1 to the blow
    sim.events = [];
    hit(sim, b, victim); // b softens the victim
    heal(sim, healer, b); // the healer keeps b standing
    slay(sim, a, victim); // a lands the blow
    expect(sim.meta(a)!.copper).toBe(334);
    expect(sim.meta(b)!.copper).toBe(333);
    expect(sim.meta(healer)!.copper).toBe(333);
    expect(sim.meta(victim)!.copper).toBe(9_000);
    // The honor pool: floor(10/3) = 3 each, the blow takes the remainder.
    expect(sim.meta(a)!.honor).toBe(4);
    expect(sim.meta(b)!.honor).toBe(3);
    expect(sim.meta(healer)!.honor).toBe(3);
    expect(honorEvents(sim, b)[0]?.reason).toBe('world_assist');
    expect(honorEvents(sim, healer)[0]?.reason).toBe('world_assist');
    expect(logLines(sim, b)).toContain(
      'You defeat Victim and take 3s 33c from their purse (split 3 ways).',
    );
    expect(logLines(sim, victim)).toContain(
      'Aleph and 2 others defeat you and take 10s from your purse.',
    );
    for (const pid of [a, b, healer]) expect(sim.worldPvpInfoFor(pid)!.kills).toBe(1);
  });

  it('a two-contributor kill names one other, never "1 others"', () => {
    const sim = world();
    const a = addFighter(sim, 'Aleph', 20, 1);
    const b = addFighter(sim, 'Bet', 20, 2);
    const victim = addFighter(sim, 'Victim', 20, 3);
    standTogether(sim, [victim, a, b]);
    for (const pid of [a, b, victim]) flag(sim, pid);
    sim.meta(victim)!.copper = 10_000;
    sim.events = [];
    hit(sim, b, victim);
    slay(sim, a, victim);
    expect(logLines(sim, victim)).toContain(
      'Aleph and 1 other defeat you and take 10s from your purse.',
    );
  });

  it('an assist older than the window, a self-heal, and a dead-to-a-mob victim pay nothing', () => {
    const sim = world();
    const a = addFighter(sim, 'Aleph', 20, 1);
    const b = addFighter(sim, 'Bet', 20, 2);
    const victim = addFighter(sim, 'Victim', 20, 4);
    standTogether(sim, [victim, a, b]);
    for (const pid of [a, b, victim]) flag(sim, pid);
    sim.meta(victim)!.copper = 10_000;
    hit(sim, b, victim);
    advanceClock(sim, WORLD_PVP_ASSIST_WINDOW + 1); // b's hit ages out
    heal(sim, a, a); // self-healing is not support
    expect(sim.worldPvpBooks.recentSupport.has(a)).toBe(false);
    sim.events = [];
    slay(sim, a, victim);
    expect(sim.meta(a)!.copper).toBe(1_000);
    expect(sim.meta(b)!.copper).toBe(0);
    // A flagged player who dies to a MOB (no player behind the blow) stakes nothing.
    const mobVictim = addFighter(sim, 'Wanderer', 20, 5);
    flag(sim, mobVictim);
    sim.meta(mobVictim)!.copper = 10_000;
    sim.ctx.dealDamage(null, ent(sim, mobVictim), 100_000, false, 'physical', 'Falling', 'hit');
    expect(ent(sim, mobVictim).dead).toBe(true);
    expect(sim.meta(mobVictim)!.copper).toBe(10_000);
    expect(sim.worldPvpInfoFor(mobVictim)!.deaths).toBe(0);
  });

  it("a pet's hit is booked under its owner", () => {
    const sim = world();
    const a = addFighter(sim, 'Aleph', 20, 1);
    const victim = addFighter(sim, 'Victim', 20, 2);
    flag(sim, a);
    flag(sim, victim);
    const pet = { kind: 'mob', id: 999_999, ownerId: a } as unknown as Entity;
    worldPvpOnPlayerDamaged(sim.ctx, ent(sim, victim), pet);
    expect([...sim.worldPvpBooks.recentDamage.get(victim)!.keys()]).toEqual([a]);
  });

  it('a grey victim pays that contributor nothing and is not charged for them', () => {
    const sim = world();
    const high = addFighter(sim, 'Cap', 20, 1);
    const peer = addFighter(sim, 'Peer', 14, 2);
    const low = addFighter(sim, 'Low', 14, 3);
    standTogether(sim, [low, high, peer]);
    for (const pid of [high, peer, low]) flag(sim, pid);
    sim.meta(low)!.copper = 10_000;
    hit(sim, peer, low);
    sim.events = [];
    slay(sim, high, low);
    // The level-20 blow is grey to a level-14 victim (gap 6 > 5): only the peer pays out.
    expect(sim.meta(high)!.copper).toBe(0);
    expect(sim.meta(high)!.honor).toBe(0);
    expect(sim.meta(peer)!.copper).toBe(1_000);
    expect(sim.meta(peer)!.honor).toBe(10);
    expect(sim.meta(low)!.copper).toBe(9_000);
  });

  function killAgain(sim: Sim, a: number, b: number) {
    sim.meta(b)!.copper = 10_000;
    const before = sim.meta(a)!.copper;
    const honorBefore = sim.meta(a)!.honor;
    revive(sim, b);
    hit(sim, a, b);
    slay(sim, a, b);
    return { gold: sim.meta(a)!.copper - before, honor: sim.meta(a)!.honor - honorBefore };
  }

  it('repeated kills of the same victim decay 100/50/25/0 inside the hour and start over after it', () => {
    const { sim, a, b } = duel();
    expect(killAgain(sim, a, b)).toEqual({ gold: 1_000, honor: 10 });
    expect(killAgain(sim, a, b)).toEqual({ gold: 500, honor: 5 });
    expect(killAgain(sim, a, b)).toEqual({ gold: 250, honor: 2 });
    expect(killAgain(sim, a, b)).toEqual({ gold: 0, honor: 0 });
    expect(sim.meta(b)!.copper).toBe(10_000); // the fully decayed kill charged nothing
    // The fully decayed fourth kill paid nothing and is not counted.
    expect(sim.worldPvpBooks.killsByPair.get('character:1001>character:1002')).toMatchObject({
      count: 3,
    });
    // A calendar rollover changes nothing: the window is an hour of sim time
    // from the first kill, not a day.
    sim.resetDay = DAY_TWO;
    expect(killAgain(sim, a, b)).toEqual({ gold: 0, honor: 0 });
    expect(sim.serializeCharacter(a)!.honorArenaDaily).toBeUndefined();
    advanceClock(sim, WORLD_PVP_DR_WINDOW_SECONDS);
    expect(killAgain(sim, a, b)).toEqual({ gold: 1_000, honor: 10 });
  });

  it('keys the window by character identity, so a relog cannot reset it; the sweep drops a closed window', () => {
    const { sim, a, b } = duel();
    slay(sim, a, b);
    sim.removePlayer(a);
    const back = addFighter(sim, 'Aleph', 20, 1001);
    standTogether(sim, [b, back]);
    flag(sim, back);
    expect(killAgain(sim, back, b)).toEqual({ gold: 500, honor: 5 });
    expect(sim.worldPvpBooks.killsByPair.size).toBe(1);
    // A closed window reads as zero at once and is dropped by the next sweep.
    advanceClock(sim, WORLD_PVP_DR_WINDOW_SECONDS);
    tickSeconds(sim, 61);
    expect(sim.worldPvpBooks.killsByPair.size).toBe(0);
    expect(killAgain(sim, back, b)).toEqual({ gold: 1_000, honor: 10 });
  });

  it('the window is per contributor AND per victim: a second victim, a second killer, or the tables turned all pay in full', () => {
    const { sim, a, b } = duel();
    const c = addFighter(sim, 'Gimel', 20, 1003);
    const d = addFighter(sim, 'Dalet', 20, 1004);
    standTogether(sim, [a, c, d]);
    flag(sim, c);
    flag(sim, d);
    expect(killAgain(sim, a, b)).toEqual({ gold: 1_000, honor: 10 });
    expect(killAgain(sim, a, b)).toEqual({ gold: 500, honor: 5 });
    // A second victim for the same killer.
    expect(killAgain(sim, a, c)).toEqual({ gold: 1_000, honor: 10 });
    // A second killer for the same victim (a swapped or victim-only key
    // would read Aleph's two kills here and pay half).
    revive(sim, b);
    expect(killAgain(sim, d, b)).toEqual({ gold: 1_000, honor: 10 });
    // The tables turned: Bet's first kill of Aleph is Bet's own window.
    revive(sim, a);
    revive(sim, b);
    expect(killAgain(sim, b, a)).toEqual({ gold: 1_000, honor: 10 });
  });

  it('a blob saved with the retired UTC-day counter loads, and the counter is dropped on the next save', () => {
    const sim = world();
    const seed = addFighter(sim, 'Seed', 20, 1001);
    const state = sim.serializeCharacter(seed)! as unknown as Record<string, unknown>;
    const withOldCounter = {
      ...state,
      honorArenaDaily: {
        date: DAY_ONE,
        winsByOpponent: {},
        fiestaCompletionsByOpponent: {},
        totalWins: 0,
        worldKillsByVictim: { 'character:1002': 2 },
      },
    };
    const pid = sim.addPlayer('warrior', 'Loaded', { state: withOldCounter as never });
    expect(ent(sim, pid).pvpFlag).toBeFalsy();
    const saved = sim.serializeCharacter(pid)! as unknown as { honorArenaDaily?: object };
    expect(
      saved.honorArenaDaily === undefined || !('worldKillsByVictim' in saved.honorArenaDaily),
    ).toBe(true);
    // And the old count never reaches the new book: the first kill pays in full.
    const b = addFighter(sim, 'Bet', 20, 1002);
    standTogether(sim, [pid, b]);
    flag(sim, pid);
    flag(sim, b);
    expect(killAgain(sim, pid, b)).toEqual({ gold: 1_000, honor: 10 });
  });
});

describe('the healer rule: aiding a flagged fighter raises your own flag', () => {
  it('an unflagged healer who heals a flagged player mid-fight is flagged and then credited', () => {
    const sim = world();
    const a = addFighter(sim, 'Aleph', 20, 1);
    const healer = addFighter(sim, 'Priest', 20, 2);
    const victim = addFighter(sim, 'Victim', 20, 3);
    standTogether(sim, [victim, a, healer]);
    flag(sim, a);
    flag(sim, victim);
    sim.meta(victim)!.copper = 10_000;
    // Not yet a fight: healing a flagged idler flags nobody.
    heal(sim, healer, a);
    expect(ent(sim, healer).pvpFlag).toBeUndefined();
    // The fight starts (the victim hits back), and the next heal flags the healer.
    hit(sim, a, victim);
    hit(sim, victim, a);
    sim.events = [];
    heal(sim, healer, a);
    expect(ent(sim, healer).pvpFlag).toBe(true);
    expect(logLines(sim, healer)).toContain(
      'World PvP enabled: you aided a flagged player in combat.',
    );
    expect(sim.isHostileTo(ent(sim, victim), ent(sim, healer))).toBe(true);
    slay(sim, a, victim);
    expect(sim.meta(healer)!.copper).toBe(500);
    expect(sim.meta(a)!.copper).toBe(500);
  });

  it('an under-level healer is left unflagged and unpaid', () => {
    const sim = world();
    const a = addFighter(sim, 'Aleph', 20, 1);
    const healer = addFighter(sim, 'Novice', 9, 2);
    const victim = addFighter(sim, 'Victim', 20, 3);
    standTogether(sim, [victim, a, healer]);
    flag(sim, a);
    flag(sim, victim);
    sim.meta(victim)!.copper = 10_000;
    hit(sim, a, victim);
    heal(sim, healer, a);
    expect(ent(sim, healer).pvpFlag).toBeUndefined();
    slay(sim, a, victim);
    expect(sim.meta(healer)!.copper).toBe(0);
    expect(sim.meta(a)!.copper).toBe(1_000);
  });
});

describe('the books', () => {
  it('a hit player who leaves without dying is swept from the recency rows', () => {
    const sim = world();
    const a = addFighter(sim, 'Aleph', 20, 1);
    const b = addFighter(sim, 'Bet', 20, 2);
    standTogether(sim, [a, b]);
    flag(sim, a);
    flag(sim, b);
    hit(sim, a, b);
    expect(sim.worldPvpBooks.recentDamage.has(b)).toBe(true);
    sim.removePlayer(b);
    tickSeconds(sim, 61);
    expect(sim.worldPvpBooks.recentDamage.has(b)).toBe(false);
  });

  it('the zone pass runs on the dueness form: first tick, then every half second', () => {
    const sim = world();
    addFighter(sim, 'Aleph');
    expect(sim.worldPvpBooks.zonePassTick).toBe(Number.NEGATIVE_INFINITY);
    sim.tick();
    const first = sim.worldPvpBooks.zonePassTick;
    expect(Number.isFinite(first)).toBe(true);
    sim.tick();
    expect(sim.worldPvpBooks.zonePassTick).toBe(first);
    tickSeconds(sim, 0.5);
    expect(sim.worldPvpBooks.zonePassTick).toBe(first + 10);
  });

  it('a pending countdown whose entity is missing for a tick stays due', () => {
    const sim = world();
    const a = addFighter(sim, 'Aleph');
    flag(sim, a);
    flag(sim, a, false);
    const due = sim.worldPvpBooks.nextDisarmAt;
    advanceClock(sim, WORLD_PVP_DISARM_SECONDS - 1);
    const e = ent(sim, a);
    sim.entities.delete(a);
    advanceClock(sim, 5);
    expect(sim.worldPvpBooks.nextDisarmAt).toBe(due);
    sim.entities.set(a, e);
    sim.tick();
    expect(sim.worldPvpBooks.nextDisarmAt).toBe(Number.POSITIVE_INFINITY);
    expect(e.pvpFlag).toBe(false);
  });

  it('runs the disarm pass only when a countdown is due', () => {
    const sim = world();
    const a = addFighter(sim, 'Aleph');
    expect(sim.worldPvpBooks.nextDisarmAt).toBe(Number.POSITIVE_INFINITY);
    flag(sim, a);
    expect(sim.worldPvpBooks.nextDisarmAt).toBe(Number.POSITIVE_INFINITY);
    flag(sim, a, false);
    expect(sim.worldPvpBooks.nextDisarmAt).toBeCloseTo(sim.time + 300, 6);
    tickSeconds(sim, WORLD_PVP_DISARM_SECONDS + 1);
    expect(sim.worldPvpBooks.nextDisarmAt).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('persistence', () => {
  it('round-trips the flag, the countdown (re-anchored) and the record; an untouched character writes nothing', () => {
    const sim = world();
    const idle = addFighter(sim, 'Idle');
    expect(sim.serializeCharacter(idle)!.worldPvp).toBeUndefined();
    const a = addFighter(sim, 'Aleph');
    flag(sim, a);
    flag(sim, a, false);
    tickSeconds(sim, 100);
    sim.meta(a)!.worldPvp!.kills = 3;
    sim.meta(a)!.worldPvp!.deaths = 2;
    const saved = sim.serializeCharacter(a)!;
    expect(saved.worldPvp).toEqual({
      flagged: true,
      disarmRemaining: expect.closeTo(200, 3),
      kills: 3,
      deaths: 2,
    });
    const loaded = world();
    tickSeconds(loaded, 50); // a different sim clock: the countdown must re-anchor
    const pid = loaded.addPlayer('warrior', 'Aleph', { state: saved });
    expect(ent(loaded, pid).pvpFlag).toBe(true);
    expect(loaded.worldPvpInfoFor(pid)).toMatchObject({ flagged: true, kills: 3, deaths: 2 });
    expect(loaded.worldPvpInfoFor(pid)!.disarmRemaining).toBe(200);
    expect(loaded.worldPvpBooks.nextDisarmAt).toBeCloseTo(loaded.time + 200, 3);
    tickSeconds(loaded, 201);
    expect(ent(loaded, pid).pvpFlag).toBe(false);
  });

  it('a lowered flag with a record round-trips the record alone', () => {
    const sim = world();
    const seed = addFighter(sim, 'Seed');
    const state = sim.serializeCharacter(seed)!;
    state.worldPvp = { flagged: false, kills: 3, deaths: 2 };
    const pid = sim.addPlayer('warrior', 'Loaded', { state });
    expect(ent(sim, pid).pvpFlag).toBeFalsy();
    expect(sim.worldPvpInfoFor(pid)).toMatchObject({ flagged: false, kills: 3, deaths: 2 });
    expect(sim.serializeCharacter(pid)!.worldPvp).toEqual({ flagged: false, kills: 3, deaths: 2 });
  });

  it('tolerates malformed records: the whole thing, the countdown, a negative countdown', () => {
    const sim = world();
    const seed = addFighter(sim, 'Seed');
    const base = sim.serializeCharacter(seed)! as unknown as Record<string, unknown>;
    let n = 0;
    const load = (worldPvp: unknown) =>
      sim.addPlayer('warrior', `Loaded${n++}`, { state: { ...base, worldPvp } as never });
    const junk = load({ flagged: 'yes', kills: -4, deaths: Number.NaN, disarmRemaining: 'soon' });
    expect(ent(sim, junk).pvpFlag).toBeUndefined();
    expect(sim.meta(junk)!.worldPvp).toBeUndefined();
    const badClock = load({ flagged: true, disarmRemaining: 'soon' });
    expect(ent(sim, badClock).pvpFlag).toBe(true);
    expect(sim.worldPvpInfoFor(badClock)!.disarmRemaining).toBeNull();
    const negative = load({ flagged: true, disarmRemaining: -50 });
    expect(sim.worldPvpInfoFor(negative)!.disarmRemaining).toBe(0);
    sim.tick();
    expect(ent(sim, negative).pvpFlag).toBe(false);
  });

  it('a saved flag on a character now under the level gate loads down', () => {
    const sim = world();
    const seed = addFighter(sim, 'Seed');
    flag(sim, seed);
    const state = sim.serializeCharacter(seed)!;
    state.level = 5;
    const pid = sim.addPlayer('warrior', 'Shrunk', { state });
    expect(ent(sim, pid).pvpFlag).toBeFalsy();
    expect(sim.worldPvpInfoFor(pid)!.flagged).toBe(false);
  });
});

describe('the ground: sanctuaries', () => {
  it('a sanctuary under either player keeps two flagged strangers apart', () => {
    const sim = world();
    const a = addFighter(sim, 'Aleph');
    const b = addFighter(sim, 'Bet');
    flag(sim, a);
    flag(sim, b);
    expect(sim.isHostileTo(ent(sim, a), ent(sim, b))).toBe(true);
    for (const zone of [STARTER_ZONE, TUTORIAL_ZONE]) {
      placeIn(sim, a, zone);
      placeIn(sim, b, zone, 2);
      expect(sim.isHostileTo(ent(sim, a), ent(sim, b))).toBe(false);
      expect(sim.isHostileTo(ent(sim, b), ent(sim, a))).toBe(false);
      // One foot in: still off (the sanctuary side wins).
      placeIn(sim, b, CONTESTED_ZONE);
      expect(sim.isHostileTo(ent(sim, a), ent(sim, b))).toBe(false);
      expect(sim.isHostileTo(ent(sim, b), ent(sim, a))).toBe(false);
      placeIn(sim, a, CONTESTED_ZONE, 2);
      expect(sim.isHostileTo(ent(sim, a), ent(sim, b))).toBe(true);
    }
  });

  it('tells a FLAGGED player on entering a sanctuary, and an unflagged one nothing', () => {
    const sim = world();
    const a = addFighter(sim, 'Aleph');
    const c = addFighter(sim, 'Gimel');
    flag(sim, a);
    tickSeconds(sim, 1);
    placeIn(sim, a, STARTER_ZONE);
    placeIn(sim, c, STARTER_ZONE, 2);
    expect(tickCollecting(sim, 1, a)).toContain(WORLD_PVP_SANCTUARY_LINE);
    placeIn(sim, c, CONTESTED_ZONE);
    expect(tickCollecting(sim, 1, c)).toEqual([]);
    placeIn(sim, c, TUTORIAL_ZONE);
    expect(tickCollecting(sim, 1, c)).toEqual([]);
    expect(sim.worldPvpInfoFor(a)!.zone).toBe('sanctuary');
  });

  /** A flagged pair mid-fight on contested ground and an unflagged priest
   *  beside them: the aid hook's positive case, before anyone moves. */
  function sanctuaryAid(): { sim: Sim; a: number; priest: number } {
    const sim = world();
    const a = addFighter(sim, 'Aleph', 20, 1);
    const victim = addFighter(sim, 'Victim', 20, 2);
    const priest = addFighter(sim, 'Priest', 20, 3, 'priest');
    standTogether(sim, [victim, a, priest]);
    flag(sim, a);
    flag(sim, victim);
    hit(sim, a, victim);
    hit(sim, victim, a);
    return { sim, a, priest };
  }

  it('aid given AND received inside a sanctuary never marks the helper (the real cast)', () => {
    const { sim, a, priest } = sanctuaryAid();
    // The fighter is kited to the starter zone's edge with the priest inside it.
    placeIn(sim, priest, STARTER_ZONE);
    placeIn(sim, a, STARTER_ZONE, 2);
    sim.castAbilityOn('power_word_shield', a, priest);
    sim.tick();
    expect(ent(sim, a).auras.some((aura) => aura.kind === 'absorb')).toBe(true);
    expect(ent(sim, priest).pvpFlag).toBeUndefined();
    expect(sim.worldPvpBooks.recentSupport.has(a)).toBe(false);
  });

  it('aid GIVEN from inside a sanctuary marks nobody, the fighter still on contested ground', () => {
    const { sim, a, priest } = sanctuaryAid();
    placeIn(sim, priest, STARTER_ZONE);
    worldPvpOnPlayerAided(sim.ctx, ent(sim, a), ent(sim, priest));
    expect(ent(sim, priest).pvpFlag).toBeUndefined();
    expect(sim.worldPvpBooks.recentSupport.has(a)).toBe(false);
  });

  it('aid RECEIVED inside a sanctuary marks nobody, the helper still on contested ground', () => {
    const { sim, a, priest } = sanctuaryAid();
    placeIn(sim, a, STARTER_ZONE);
    worldPvpOnPlayerAided(sim.ctx, ent(sim, a), ent(sim, priest));
    expect(ent(sim, priest).pvpFlag).toBeUndefined();
    expect(sim.worldPvpBooks.recentSupport.has(a)).toBe(false);
  });

  it('the positive control: the same aid with both on contested ground marks the helper', () => {
    const { sim, a, priest } = sanctuaryAid();
    worldPvpOnPlayerAided(sim.ctx, ent(sim, a), ent(sim, priest));
    expect(ent(sim, priest).pvpFlag).toBe(true);
    expect(sim.worldPvpBooks.recentSupport.get(a)?.has(priest)).toBe(true);
  });
});

describe('the ground: free-for-all zones', () => {
  function brawl(): { sim: Sim; a: number; b: number } {
    const sim = world();
    const a = addFighter(sim, 'Aleph', 20, 1001);
    const b = addFighter(sim, 'Bet', 20, 1002);
    placeIn(sim, a, FFA_ZONE);
    standTogether(sim, [a, b]);
    tickSeconds(sim, 1);
    sim.events = [];
    return { sim, a, b };
  }

  it('two unflagged strangers are hostile both ways; party mates stay exempt, guildmates do not', () => {
    const { sim, a, b } = brawl();
    expect(ent(sim, a).pvpFlag).toBeUndefined();
    expect(sim.isHostileTo(ent(sim, a), ent(sim, b))).toBe(true);
    expect(sim.isHostileTo(ent(sim, b), ent(sim, a))).toBe(true);
    expect(sim.worldPvpInfoFor(a)!.zone).toBe('ffa');
    // Standing outside the zone, only the flags count again: nothing without
    // them, the ordinary mutual rule with them.
    placeIn(sim, b, CONTESTED_ZONE);
    expect(sim.isHostileTo(ent(sim, a), ent(sim, b))).toBe(false);
    expect(sim.isHostileTo(ent(sim, b), ent(sim, a))).toBe(false);
    flag(sim, a);
    flag(sim, b);
    expect(sim.isHostileTo(ent(sim, a), ent(sim, b))).toBe(true);
    expect(sim.isHostileTo(ent(sim, b), ent(sim, a))).toBe(true);
    flag(sim, a, false);
    flag(sim, b, false);
    tickSeconds(sim, WORLD_PVP_DISARM_SECONDS + 1);
    expect(ent(sim, a).pvpFlag).toBe(false);
    standTogether(sim, [a, b]);
    sim.partyInvite(b, a);
    sim.partyAccept(b);
    expect(sim.isHostileTo(ent(sim, a), ent(sim, b))).toBe(false);
    sim.partyLeave(b);
    expect(sim.isHostileTo(ent(sim, a), ent(sim, b))).toBe(true);
    sim.setPlayerGuild(a, 'Ravens');
    sim.setPlayerGuild(b, 'Ravens');
    expect(sim.isHostileTo(ent(sim, a), ent(sim, b))).toBe(true);
    expect(sim.isHostileTo(ent(sim, b), ent(sim, a))).toBe(true);
  });

  it('the first hit on an unflagged player marks the attacker; hitting a flagged player never does', () => {
    const { sim, a, b } = brawl();
    const c = addFighter(sim, 'Gimel', 20, 1003);
    const d = addFighter(sim, 'Dalet', 20, 1004);
    standTogether(sim, [a, c, d]);
    // The aggressor is marked by their own first blow.
    hit(sim, a, b);
    expect(ent(sim, a).pvpFlag).toBe(true);
    expect(ent(sim, b).pvpFlag).toBeUndefined();
    expect(logLines(sim, a)).toContain(WORLD_PVP_MARKED_LINE);
    // Self-defence: the victim hits a flagged player and stays unflagged.
    hit(sim, b, a);
    expect(ent(sim, b).pvpFlag).toBeUndefined();
    // Defending someone who is not marked: same thing.
    hit(sim, c, a);
    expect(ent(sim, c).pvpFlag).toBeUndefined();
    // A flagged player hitting an unflagged one has nothing left to raise, and
    // the unflagged one hitting back is hitting a flag.
    hit(sim, a, d);
    hit(sim, d, a);
    expect(ent(sim, d).pvpFlag).toBeUndefined();
    // The hits were booked either way (the kill they lead to pays).
    expect(sim.worldPvpBooks.recentDamage.get(a)?.has(d)).toBe(true);
  });

  it('a character under the flag level is still fair game on free-for-all ground, and is told so', () => {
    const { sim, a } = brawl();
    const novice = addFighter(sim, 'Novice', WORLD_PVP_MIN_LEVEL - 1, 1005);
    standTogether(sim, [a, novice]);
    expect(tickCollecting(sim, 1, novice)).toContain(WORLD_PVP_FFA_ENTER_LINE);
    expect(sim.isHostileTo(ent(sim, novice), ent(sim, a))).toBe(true);
    expect(sim.isHostileTo(ent(sim, a), ent(sim, novice))).toBe(true);
    // Their blow lands and is booked, but they cannot carry a flag, so it
    // marks nobody (and with no flag they stake no gold either).
    hit(sim, novice, a);
    expect(ent(sim, novice).pvpFlag).toBeUndefined();
    expect(sim.worldPvpBooks.recentDamage.get(a)?.has(novice)).toBe(true);
  });

  it('a freshly marked player cannot drop the flag the same instant (the toggle cooldown)', () => {
    const { sim, a, b } = brawl();
    hit(sim, a, b);
    expect(ent(sim, a).pvpFlag).toBe(true);
    sim.setWorldPvpFlag(false, a);
    expect(errorLines(sim, a)).toContain('World PvP: wait a moment before switching again.');
  });

  it("opening on an unflagged stranger's PET marks the attacker as opening on the stranger would", () => {
    const { sim, a, b } = brawl();
    const pet = { kind: 'mob', id: 999_999, ownerId: b } as unknown as Entity;
    worldPvpOnOwnedPetDamaged(sim.ctx, pet, ent(sim, a));
    expect(ent(sim, a).pvpFlag).toBe(true);
    expect(logLines(sim, a)).toContain(WORLD_PVP_MARKED_LINE);
    // Marking only: the pet is not the victim, so nothing is booked against the owner.
    expect(sim.worldPvpBooks.recentDamage.has(b)).toBe(false);
  });

  it("a hit on a flagged stranger's pet, or on your own pet, marks nobody", () => {
    const { sim, a, b } = brawl();
    flag(sim, b);
    const strangersPet = { kind: 'mob', id: 999_998, ownerId: b } as unknown as Entity;
    worldPvpOnOwnedPetDamaged(sim.ctx, strangersPet, ent(sim, a));
    expect(ent(sim, a).pvpFlag).toBeUndefined();
    const ownPet = { kind: 'mob', id: 999_997, ownerId: a } as unknown as Entity;
    worldPvpOnOwnedPetDamaged(sim.ctx, ownPet, ent(sim, a));
    expect(ent(sim, a).pvpFlag).toBeUndefined();
  });

  it('a mixed kill charges the victim only the flagged share: an unflagged damager and a flagged blow', () => {
    const { sim, a, b } = brawl();
    const c = addFighter(sim, 'Gimel', 20, 1003);
    standTogether(sim, [a, b, c]);
    flag(sim, b);
    flag(sim, c);
    sim.meta(b)!.copper = 10_000;
    sim.meta(a)!.copper = 0;
    sim.meta(c)!.copper = 0;
    sim.events = [];
    hit(sim, a, b); // an unflagged stranger softens the flagged victim: not marked (b is flagged)
    expect(ent(sim, a).pvpFlag).toBeUndefined();
    slay(sim, c, b);
    // Two contributors split the 10s stake 5s each, but only the flagged blow
    // takes; the victim is charged exactly what was paid out, never the full stake.
    expect(sim.meta(c)!.copper).toBe(500);
    expect(sim.meta(a)!.copper).toBe(0);
    expect(sim.meta(b)!.copper).toBe(9_500);
    expect(sim.meta(a)!.honor).toBe(5);
    expect(sim.meta(c)!.honor).toBe(5);
    expect(logLines(sim, b)).toContain('Gimel and 1 other defeat you and take 5s from your purse.');
  });

  it('killing an unflagged player pays honor but takes no gold; a flagged victim stakes as anywhere', () => {
    const { sim, a, b } = brawl();
    sim.meta(b)!.copper = 10_000;
    sim.meta(a)!.copper = 0;
    slay(sim, a, b);
    expect(ent(sim, b).dead).toBe(true);
    expect(sim.meta(b)!.copper).toBe(10_000);
    expect(sim.meta(a)!.copper).toBe(0);
    expect(sim.meta(a)!.honor).toBe(10);
    expect(logLines(sim, a)).toContain('You defeat Bet.');
    expect(logLines(sim, b)).toContain('Aleph defeats you.');
    expect(sim.worldPvpInfoFor(a)).toMatchObject({ kills: 1, deaths: 0, flagged: true });
    expect(sim.worldPvpInfoFor(b)).toMatchObject({ kills: 0, deaths: 1, flagged: false });
    // The victim flags up and stands again: the second kill inside the hour
    // stakes gold, decayed like the honor.
    revive(sim, b);
    flag(sim, b);
    sim.meta(b)!.copper = 10_000;
    hit(sim, a, b);
    slay(sim, a, b);
    expect(sim.meta(a)!.copper).toBe(500);
    expect(sim.meta(b)!.copper).toBe(9_500);
    expect(sim.meta(a)!.honor).toBe(15);
  });

  it('entering and leaving are announced once per crossing, and on logging in inside', () => {
    const sim = world();
    const a = addFighter(sim, 'Aleph');
    tickSeconds(sim, 1);
    placeIn(sim, a, FFA_ZONE);
    const entered = tickCollecting(sim, 2, a);
    expect(entered.filter((line) => line === WORLD_PVP_FFA_ENTER_LINE)).toHaveLength(1);
    expect(tickCollecting(sim, 1, a)).toEqual([]);
    placeIn(sim, a, CONTESTED_ZONE);
    const left = tickCollecting(sim, 2, a);
    expect(left.filter((line) => line === WORLD_PVP_FFA_LEAVE_LINE)).toHaveLength(1);
    expect(left).not.toContain(WORLD_PVP_FFA_ENTER_LINE);
    // A player whose first pass finds them inside the zone is told too.
    const b = addFighter(sim, 'Bet');
    placeIn(sim, b, FFA_ZONE);
    expect(tickCollecting(sim, 1, b)).toContain(WORLD_PVP_FFA_ENTER_LINE);
  });

  it('an unflagged hunter of flagged strangers earns the honor but never the gold', () => {
    const { sim, a, b } = brawl();
    flag(sim, b);
    sim.meta(b)!.copper = 10_000;
    sim.meta(a)!.copper = 0;
    slay(sim, a, b);
    // Hitting a flagged player never marks the attacker, and gold only moves
    // between two players who both carry the stake.
    expect(ent(sim, a).pvpFlag).toBeUndefined();
    expect(sim.meta(a)!.copper).toBe(0);
    expect(sim.meta(b)!.copper).toBe(10_000);
    expect(sim.meta(a)!.honor).toBe(10);
    expect(logLines(sim, a)).toContain('You defeat Bet.');
    expect(logLines(sim, b)).toContain('Aleph defeats you.');
  });

  it('a duel fought on free-for-all ground marks nobody and books nothing', () => {
    const { sim, a, b } = brawl();
    sim.duelRequest(b, a);
    sim.duelAccept(b);
    tickSeconds(sim, 4); // the duel's countdown
    expect(sim.duels.get(a)?.state).toBe('active');
    expect(sim.isHostileTo(ent(sim, a), ent(sim, b))).toBe(true); // the duel arm
    hit(sim, a, b);
    hit(sim, b, a);
    expect(ent(sim, a).pvpFlag).toBeUndefined();
    expect(ent(sim, b).pvpFlag).toBeUndefined();
    expect(sim.worldPvpBooks.recentDamage.size).toBe(0);
  });

  it('the sweep drops the zone row of a player who logged out', () => {
    const sim = world();
    const a = addFighter(sim, 'Aleph');
    tickSeconds(sim, 1);
    expect(sim.worldPvpBooks.zoneOf.has(a)).toBe(true);
    sim.removePlayer(a);
    tickSeconds(sim, 61);
    expect(sim.worldPvpBooks.zoneOf.has(a)).toBe(false);
  });

  it('the realm kill switch turns the free-for-all arm and its notices off too', () => {
    const sim = world({ worldPvpDisabled: true });
    const a = addFighter(sim, 'Aleph');
    const b = addFighter(sim, 'Bet');
    placeIn(sim, a, FFA_ZONE);
    standTogether(sim, [a, b]);
    expect(sim.isHostileTo(ent(sim, a), ent(sim, b))).toBe(false);
    expect(tickCollecting(sim, 2, a)).toEqual([]);
    expect(sim.worldPvpInfoFor(a)).toMatchObject({ zone: 'ffa', enabled: false });
  });
});

describe('aid: shields and buffs count like heals', () => {
  function fight(): { sim: Sim; a: number; victim: number; priest: number } {
    const sim = world();
    const a = addFighter(sim, 'Aleph', 20, 1);
    const victim = addFighter(sim, 'Victim', 20, 2);
    const priest = addFighter(sim, 'Priest', 20, 3, 'priest');
    standTogether(sim, [victim, a, priest]);
    flag(sim, a);
    flag(sim, victim);
    sim.meta(victim)!.copper = 10_000;
    hit(sim, a, victim);
    hit(sim, victim, a);
    sim.events = [];
    return { sim, a, victim, priest };
  }

  it('an unflagged priest who shields a flagged fighter mid-fight is flagged and credited', () => {
    const { sim, a, victim, priest } = fight();
    sim.castAbilityOn('power_word_shield', a, priest);
    // An instant cast resolves at once; the notice sits in this tick's window.
    const told = logLines(sim, priest);
    sim.tick();
    expect(ent(sim, a).auras.some((aura) => aura.kind === 'absorb')).toBe(true);
    expect(ent(sim, priest).pvpFlag).toBe(true);
    expect(told).toContain(WORLD_PVP_AIDED_LINE);
    slay(sim, a, victim);
    expect(sim.meta(priest)!.copper).toBe(500);
    expect(sim.meta(a)!.copper).toBe(500);
  });

  it('a buff does the same, and the caster is credited on the kill', () => {
    const { sim, a, victim, priest } = fight();
    sim.castAbilityOn('power_word_fortitude', a, priest);
    sim.tick();
    expect(ent(sim, a).auras.some((aura) => aura.kind === 'buff_sta_pct')).toBe(true);
    expect(ent(sim, priest).pvpFlag).toBe(true);
    slay(sim, a, victim);
    expect(sim.meta(priest)!.copper).toBe(500);
  });

  it('once flagged, aid to the ungrouped stranger is refused out loud (no silent self-cast); a party restores it', () => {
    const { sim, a, priest } = fight();
    sim.castAbilityOn('power_word_shield', a, priest);
    sim.tick();
    expect(ent(sim, priest).pvpFlag).toBe(true);
    // The helper and the fighter are now two flagged strangers: enemies.
    expect(sim.isHostileTo(ent(sim, priest), ent(sim, a))).toBe(true);
    tickSeconds(sim, 2); // past the global cooldown
    sim.events = [];
    sim.castAbilityOn('power_word_fortitude', a, priest);
    const refused = errorLines(sim, priest);
    sim.tick();
    expect(refused).toContain(WORLD_PVP_AID_REFUSED_LINE);
    expect(ent(sim, a).auras.some((aura) => aura.kind === 'buff_sta_pct')).toBe(false);
    expect(ent(sim, priest).auras.some((aura) => aura.kind === 'buff_sta_pct')).toBe(false);
    // The exemption the line points at: a party makes them friendly again.
    sim.partyInvite(a, priest);
    sim.partyAccept(a);
    tickSeconds(sim, 2);
    sim.castAbilityOn('power_word_fortitude', a, priest);
    sim.tick();
    expect(ent(sim, a).auras.some((aura) => aura.kind === 'buff_sta_pct')).toBe(true);
  });

  it('a heal with no target at all still self-casts: only a World PvP enemy on the target refuses', () => {
    const { sim, priest } = fight();
    ent(sim, priest).targetId = null;
    ent(sim, priest).hp = 1;
    sim.castAbilityOn('power_word_shield', priest, priest);
    sim.tick();
    expect(ent(sim, priest).auras.some((aura) => aura.kind === 'absorb')).toBe(true);
    expect(errorLines(sim, priest)).not.toContain(WORLD_PVP_AID_REFUSED_LINE);
  });

  it('aid to an UNFLAGGED fighter in a free-for-all brawl marks nobody', () => {
    const sim = world();
    const a = addFighter(sim, 'Aleph', 20, 1);
    const b = addFighter(sim, 'Bet', 20, 2);
    const priest = addFighter(sim, 'Priest', 20, 3, 'priest');
    placeIn(sim, a, FFA_ZONE);
    standTogether(sim, [a, b, priest]);
    // Strangers in a free-for-all zone are enemies, so a stranger's shield is
    // refused out loud (WORLD_PVP_AID_REFUSED_LINE): the priest is the
    // defender's party mate (the one exemption that makes them friendly here).
    sim.partyInvite(priest, b);
    sim.partyAccept(priest);
    expect(sim.isHostileTo(ent(sim, priest), ent(sim, b))).toBe(false);
    hit(sim, a, b); // a is marked; b is the unmarked defender
    sim.castAbilityOn('power_word_shield', b, priest);
    tickSeconds(sim, 2); // past the global cooldown; inside the assist window
    sim.castAbilityOn('power_word_fortitude', b, priest);
    sim.tick();
    expect(ent(sim, b).auras.some((aura) => aura.kind === 'absorb')).toBe(true);
    expect(ent(sim, b).auras.some((aura) => aura.kind === 'buff_sta_pct')).toBe(true);
    expect(ent(sim, priest).pvpFlag).toBeUndefined();
    expect(sim.worldPvpBooks.recentSupport.has(b)).toBe(false);
  });
});

describe('periodic harm follows the live verdict (src/sim/combat/periodic_harm.ts)', () => {
  /** An unflagged priest opens on an unflagged stranger in a free-for-all
   *  zone with a pure damage-over-time spell. The bolt lands a tick later and
   *  the first damaging tick is still three seconds out, so at return nobody
   *  is marked yet: it is the first tick that LANDS which marks the priest
   *  (the damage hook), never the cast. */
  function dotted(): { sim: Sim; priest: number; b: number } {
    const sim = world();
    const priest = addFighter(sim, 'Priest', 20, 1, 'priest');
    const b = addFighter(sim, 'Bet', 20, 2);
    placeIn(sim, priest, FFA_ZONE);
    standTogether(sim, [priest, b]);
    tickSeconds(sim, 1);
    ent(sim, priest).targetId = b; // a harmful cast reads the current target
    sim.castAbilityOn('shadow_word_pain', b, priest);
    tickSeconds(sim, 1);
    expect(hasDot(sim, b)).toBe(true);
    expect(ent(sim, priest).pvpFlag).toBeUndefined();
    expect(ent(sim, b).pvpFlag).toBeUndefined();
    return { sim, priest, b };
  }
  const hasDot = (sim: Sim, pid: number) => ent(sim, pid).auras.some((aura) => aura.kind === 'dot');

  it('keeps ticking while the pair stays hostile, and the first tick marks the caster (the control)', () => {
    const { sim, priest, b } = dotted();
    tickSeconds(sim, 7);
    expect(ent(sim, b).hp).toBeLessThan(ent(sim, b).maxHp);
    expect(hasDot(sim, b)).toBe(true);
    expect(ent(sim, priest).pvpFlag).toBe(true);
  });

  it('an unflagged victim who leaves the free-for-all ground sheds the bleed before its first tick', () => {
    const { sim, priest, b } = dotted();
    placeIn(sim, b, CONTESTED_ZONE);
    tickSeconds(sim, 7);
    expect(ent(sim, b).hp).toBe(ent(sim, b).maxHp);
    expect(hasDot(sim, b)).toBe(false);
    // No tick landed, so nothing ever marked the caster either.
    expect(ent(sim, priest).pvpFlag).toBeUndefined();
  });

  it('two flagged players keep it on contested ground; a sanctuary sheds it', () => {
    const kept = dotted();
    flag(kept.sim, kept.priest);
    flag(kept.sim, kept.b);
    placeIn(kept.sim, kept.b, CONTESTED_ZONE);
    tickSeconds(kept.sim, 7);
    expect(ent(kept.sim, kept.b).hp).toBeLessThan(ent(kept.sim, kept.b).maxHp);
    expect(hasDot(kept.sim, kept.b)).toBe(true);
    const shed = dotted();
    flag(shed.sim, shed.priest);
    flag(shed.sim, shed.b);
    placeIn(shed.sim, shed.b, STARTER_ZONE);
    tickSeconds(shed.sim, 7);
    expect(ent(shed.sim, shed.b).hp).toBe(ent(shed.sim, shed.b).maxHp);
    expect(hasDot(shed.sim, shed.b)).toBe(false);
  });

  it("a dead caster's curse still runs its course (the classic rule the re-check keeps)", () => {
    const { sim, priest, b } = dotted();
    ent(sim, priest).dead = true;
    ent(sim, priest).hp = 0;
    tickSeconds(sim, 7);
    expect(ent(sim, b).hp).toBeLessThan(ent(sim, b).maxHp);
    expect(hasDot(sim, b)).toBe(true);
  });
});

describe('determinism', () => {
  it('two identical runs agree on every purse, every honor balance and the rng position', () => {
    const run = () => {
      const sim = world();
      const a = addFighter(sim, 'Aleph', 20, 1);
      const b = addFighter(sim, 'Bet', 20, 2);
      standTogether(sim, [a, b]);
      flag(sim, a);
      flag(sim, b);
      sim.meta(b)!.copper = 12_345;
      sim.meta(a)!.copper = 100;
      hit(sim, b, a);
      slay(sim, a, b);
      flag(sim, a, false);
      tickSeconds(sim, 10);
      return {
        copper: [sim.meta(a)!.copper, sim.meta(b)!.copper],
        honor: [sim.meta(a)!.honor, sim.meta(b)!.honor],
        rng: sim.rng.next(),
        flag: [ent(sim, a).pvpFlag, sim.worldPvpInfoFor(a)!.disarmRemaining],
      };
    };
    const first = run();
    expect(run()).toEqual(first);
    expect(first.copper[0] + first.copper[1]).toBe(12_445);
  });

  it('formats the kill and defeat lines the client matcher pins', () => {
    expect(worldPvpKillLine('Bet', 0, 1)).toBe('You defeat Bet.');
    expect(worldPvpKillLine('Bet', 1_234, 1)).toBe(
      'You defeat Bet and take 12s 34c from their purse.',
    );
    expect(worldPvpKillLine('Bet', 50_000, 3)).toBe(
      'You defeat Bet and take 5g from their purse (split 3 ways).',
    );
    expect(worldPvpDefeatLine('Aleph', 0, 1)).toBe('Aleph defeats you.');
    expect(worldPvpDefeatLine('Aleph', 700, 1)).toBe(
      'Aleph defeats you and takes 7s from your purse.',
    );
    expect(worldPvpDefeatLine('Aleph', 0, 2)).toBe('Aleph and 1 other defeat you.');
    expect(worldPvpDefeatLine('Aleph', 700, 2)).toBe(
      'Aleph and 1 other defeat you and take 7s from your purse.',
    );
    expect(worldPvpDefeatLine('Aleph', 0, 3)).toBe('Aleph and 2 others defeat you.');
    expect(worldPvpDefeatLine('Aleph', 700, 3)).toBe(
      'Aleph and 2 others defeat you and take 7s from your purse.',
    );
  });
});

describe('raids earn nothing from world kills', () => {
  it('a raid member takes no honor or gold and is left out of the split', () => {
    const sim = world();
    const raid = ['R1', 'R2', 'R3', 'R4', 'R5'].map((name) => addFighter(sim, name));
    const solo = addFighter(sim, 'Solo');
    const victim = addFighter(sim, 'Victim');
    for (const pid of raid.slice(1)) {
      sim.partyInvite(pid, raid[0]);
      sim.partyAccept(pid);
    }
    sim.convertPartyToRaid(raid[0]);
    expect(sim.partyOf(raid[0])!.raid).toBe(true);
    for (const pid of [...raid, solo, victim]) flag(sim, pid);
    standTogether(sim, [victim, raid[0], solo]);
    sim.meta(victim)!.copper = 20_000;
    for (const pid of [raid[0], solo]) sim.meta(pid)!.copper = 0;
    // The lone helper and the raid's killing blow: only the helper is paid,
    // and the whole pool and the whole stake go to them.
    hit(sim, solo, victim);
    slay(sim, raid[0], victim);
    expect(ent(sim, victim).dead).toBe(true);
    expect(sim.meta(raid[0])!.honor).toBe(0);
    expect(sim.meta(raid[0])!.copper).toBe(0);
    expect(sim.meta(solo)!.honor).toBe(10);
    expect(sim.meta(solo)!.copper).toBe(2_000);
    expect(sim.meta(victim)!.copper).toBe(18_000);
  });

  it('a kill by a raid alone pays nobody and stakes nothing', () => {
    const sim = world();
    const raid = ['R1', 'R2', 'R3', 'R4', 'R5'].map((name) => addFighter(sim, name));
    const victim = addFighter(sim, 'Victim');
    for (const pid of raid.slice(1)) {
      sim.partyInvite(pid, raid[0]);
      sim.partyAccept(pid);
    }
    sim.convertPartyToRaid(raid[0]);
    for (const pid of [...raid, victim]) flag(sim, pid);
    standTogether(sim, [victim, raid[0]]);
    sim.meta(victim)!.copper = 20_000;
    slay(sim, raid[0], victim);
    expect(ent(sim, victim).dead).toBe(true);
    for (const pid of raid) expect(sim.meta(pid)!.honor, `raider ${pid}`).toBe(0);
    expect(sim.meta(victim)!.copper).toBe(20_000);
  });
});
