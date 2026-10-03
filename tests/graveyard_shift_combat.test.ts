import { describe, expect, it } from 'vitest';
import { activePvpOpponentIds, isAttackableEntity } from '../src/game/interactions';
import { CRYPT_DOOR_POS, dungeonAt } from '../src/sim/data';
import { graveyardShiftRunFor } from '../src/sim/graveyard_shift';
import {
  adventurerMarkerAura,
  graveyardShiftPairHostile,
  isGraveyardShiftAdventurer,
} from '../src/sim/graveyard_shift/hostility';
import { morthenIdentityAura } from '../src/sim/graveyard_shift/morthen_identity';
import { GRAVEYARD_SHIFT_PARTY } from '../src/sim/graveyard_shift/run_party';
import { instanceClaimHolds } from '../src/sim/instances/dungeons';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';
import { isPvpHostilePlayer } from '../src/ui/pvp_hostile_core';
import { EMPTY_TEST_WORLD } from './sim_shared';

function shiftSim() {
  const sim = new Sim({
    seed: 42,
    playerClass: 'warrior',
    devCommands: true,
    offlineHost: true,
    world: EMPTY_TEST_WORLD,
  });
  sim.setPlayerLevel(10);
  return sim;
}

function start(sim: Sim) {
  sim.chat('/dev graveyardshift start');
  const run = graveyardShiftRunFor(sim.ctx, sim.playerId);
  expect(run).not.toBeNull();
  return run!;
}

const meta = (sim: Sim, pid = sim.playerId) => (sim as any).players.get(pid);
const isHostile = (sim: Sim, a: Entity, b: Entity) => (sim as any).isHostileTo(a, b) as boolean;
const isFriendly = (sim: Sim, a: Entity, b: Entity) => (sim as any).isFriendlyTo(a, b) as boolean;

function lethal(sim: Sim, source: Entity | null, target: Entity) {
  (sim as any).dealDamage(source, target, target.maxHp + 500, false, 'physical', null, 'hit', true);
}

function logs(events: { type: string; text?: string }[]): string[] {
  return events.flatMap((ev) => (ev.type === 'log' && ev.text ? [ev.text] : []));
}

function bare(id: number, auras: Entity['auras']): Entity {
  return { id, kind: 'player', auras } as unknown as Entity;
}

describe('Graveyard Shift adventurers', () => {
  it('the pair rule: Morthen against the adventurers, both ways, and nobody else', () => {
    const boss = bare(1, [morthenIdentityAura(1)]);
    const bot = bare(2, [adventurerMarkerAura(2)]);
    const bot2 = bare(3, [adventurerMarkerAura(3)]);
    const stranger = bare(4, []);
    expect(graveyardShiftPairHostile(boss, bot)).toBe(true);
    expect(graveyardShiftPairHostile(bot, boss)).toBe(true);
    expect(graveyardShiftPairHostile(bot, bot2)).toBe(false);
    expect(graveyardShiftPairHostile(bot, stranger)).toBe(false);
    expect(graveyardShiftPairHostile(stranger, boss)).toBe(false);
  });

  it('fields the fixed party at level 10 in the chamber, as plain unflagged players', () => {
    const sim = shiftSim();
    const run = start(sim);
    expect(run.bots.map((b) => b.role)).toEqual(['tank', 'healer', 'dps']);
    run.bots.forEach((bot, i) => {
      const e = sim.entities.get(bot.pid)!;
      const m = meta(sim, bot.pid);
      expect(e.name).toBe(GRAVEYARD_SHIFT_PARTY[i].name);
      expect(m.cls).toBe(GRAVEYARD_SHIFT_PARTY[i].cls);
      expect(e.level).toBe(10);
      expect(isGraveyardShiftAdventurer(e)).toBe(true);
      expect(instanceClaimHolds(run.slot, e.pos)).toBe(true);
      expect(m.isDevBot).toBeFalsy();
      expect(m.characterId).toBeUndefined();
    });
  });

  it('is hostile in the sim both ways, and the bots stay friendly to each other', () => {
    const sim = shiftSim();
    const run = start(sim);
    const [tank, healer] = run.bots.map((b) => sim.entities.get(b.pid)!);
    expect(isHostile(sim, sim.player, tank)).toBe(true);
    expect(isHostile(sim, tank, sim.player)).toBe(true);
    expect(isHostile(sim, tank, healer)).toBe(false);
    expect(isFriendly(sim, healer, tank)).toBe(true);
  });

  it('the client readouts agree: red, attackable, right-click to attack', () => {
    const sim = shiftSim();
    const run = start(sim);
    const tank = sim.entities.get(run.bots[0].pid)!;
    expect(isPvpHostilePlayer(sim as any, tank)).toBe(true);
    const opponents = activePvpOpponentIds(sim as any);
    expect([...opponents].sort()).toEqual(run.bots.map((b) => b.pid).sort());
    expect(isAttackableEntity(tank, sim.playerId, opponents)).toBe(true);
  });

  it('killing an adventurer pays nothing and moves none of the real counters', () => {
    const sim = shiftSim();
    const run = start(sim);
    const m = meta(sim);
    // The session damage tallies (never persisted) do count the run's blows.
    const tally = () => {
      const { kills, deaths, xpGained, lootCopper, levelUps } = m.counters;
      return { kills, deaths, xpGained, lootCopper, levelUps, honor: m.honor, xp: m.xp };
    };
    const before = tally();
    const tank = sim.entities.get(run.bots[0].pid)!;
    lethal(sim, sim.player, tank);
    expect(tank.dead).toBe(true);
    sim.tick();
    expect(tally()).toEqual(before);
  });

  it('killing every adventurer wins: the party is cleared and the owner walks out', () => {
    const sim = shiftSim();
    const run = start(sim);
    const pids = run.bots.map((b) => b.pid);
    for (const pid of pids) lethal(sim, sim.player, sim.entities.get(pid)!);
    const events = sim.tick();
    expect(logs(events)).toContain('[dev] Graveyard Shift ended (won).');
    expect(graveyardShiftRunFor(sim.ctx, sim.playerId)).toBeNull();
    for (const pid of pids) {
      expect(sim.ctx.players.has(pid)).toBe(false);
      expect(sim.entities.has(pid)).toBe(false);
    }
    expect(dungeonAt(sim.player.pos.x)).toBeNull();
  });

  it('a lethal blow from any source clamps to 1 hp, never kills, and loses the run', () => {
    const sim = shiftSim();
    start(sim);
    const deaths = meta(sim).counters.deaths;
    lethal(sim, null, sim.player);
    expect(sim.player.dead).toBe(false);
    expect(sim.player.hp).toBe(1);
    lethal(sim, null, sim.player);
    expect(sim.player.hp).toBe(1);
    const events = sim.tick();
    expect(events.some((ev) => ev.type === 'playerDeath')).toBe(false);
    expect(logs(events)).toContain('[dev] Graveyard Shift ended (lost).');
    expect(sim.player.dead).toBe(false);
    expect(meta(sim).counters.deaths).toBe(deaths);
    const p = sim.player;
    expect(Math.hypot(p.pos.x - CRYPT_DOOR_POS.x, p.pos.z - CRYPT_DOOR_POS.z)).toBeLessThan(10);
  });

  it('a loss and a wipe of the party in the same tick count as a loss', () => {
    const sim = shiftSim();
    const run = start(sim);
    for (const bot of run.bots) lethal(sim, sim.player, sim.entities.get(bot.pid)!);
    lethal(sim, null, sim.player);
    expect(logs(sim.tick())).toContain('[dev] Graveyard Shift ended (lost).');
  });

  it('an adventurer that leaves the chamber leaves the run; the last one leaving ends it', () => {
    const sim = shiftSim();
    const run = start(sim);
    const [first, ...rest] = run.bots.map((b) => b.pid);
    sim.entities.get(first)!.pos = sim.ctx.groundPos(30, 30);
    sim.tick();
    expect(run.bots.map((b) => b.pid)).toEqual(rest);
    expect(sim.ctx.players.has(first)).toBe(false);
    for (const pid of rest) sim.entities.get(pid)!.pos = sim.ctx.groundPos(30, 30);
    expect(logs(sim.tick())).toContain('[dev] Graveyard Shift ended (won).');
  });

  it('a shift nobody finishes ends on the timeout', () => {
    const sim = shiftSim();
    const run = start(sim);
    (run as any).startedTick = sim.ctx.tickCount - 15 * 60 * 20;
    expect(logs(sim.tick())).toContain('[dev] Graveyard Shift ended (aborted).');
    expect(sim.ctx.players.size).toBe(1);
  });

  it('idle adventurers stay put for a long shift (no tutorial ferry, no wandering)', () => {
    const sim = shiftSim();
    const run = start(sim);
    for (let i = 0; i < 20 * 30; i++) sim.tick();
    expect(graveyardShiftRunFor(sim.ctx, sim.playerId)).toBe(run);
    for (const bot of run.bots) {
      expect(instanceClaimHolds(run.slot, sim.entities.get(bot.pid)!.pos)).toBe(true);
    }
  });
});
