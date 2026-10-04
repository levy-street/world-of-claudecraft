// The Graveyard Shift on a realm shared with other players: its adventurer
// bots are nobody's to whisper, inspect, invite, trade with or duel; their say
// lines reach the run's owner alone; "is this a bot" is an O(1) set lookup; and
// a realm runs a few shifts at once at most, leaving the Hollow Crypt's other
// slots to real groups.
import { describe, expect, it } from 'vitest';
import {
  GRAVEYARD_SHIFT_MAX_CONCURRENT_RUNS,
  startGraveyardShift,
} from '../src/sim/graveyard_shift/run_lifecycle';
import { graveyardShiftRunFor, isGraveyardShiftBotPid } from '../src/sim/graveyard_shift/run_state';
import { Sim } from '../src/sim/sim';
import { findPlayerByName, resolveWhisperTarget } from '../src/sim/social/chat';
import type { SimEvent } from '../src/sim/types';
import { EMPTY_TEST_WORLD } from './sim_shared';

function realm() {
  const sim = new Sim({
    seed: 42,
    playerClass: 'warrior',
    devCommands: true,
    offlineHost: true,
    world: EMPTY_TEST_WORLD,
  });
  sim.setPlayerLevel(15);
  return sim;
}

const shiftFor = (sim: Sim, pid: number) => {
  sim.setPlayerLevel(15, pid);
  return startGraveyardShift(sim.ctx, pid, 'dev');
};

describe('the adventurer bots on a shared realm', () => {
  it('are known in O(1) for the run and forgotten with it', () => {
    const sim = realm();
    expect(shiftFor(sim, sim.playerId)).toBeNull();
    const run = graveyardShiftRunFor(sim.ctx, sim.playerId)!;
    expect(run.bots).toHaveLength(5);
    expect(sim.ctx.graveyardShiftRuns.botPids.size).toBe(5);
    for (const bot of run.bots) expect(isGraveyardShiftBotPid(sim.ctx, bot.pid)).toBe(true);
    expect(isGraveyardShiftBotPid(sim.ctx, sim.playerId)).toBe(false);
    run.pendingOutcome = 'aborted';
    sim.tick();
    expect(sim.ctx.graveyardShiftRuns.botPids.size).toBe(0);
  });

  it('forget a bot that strays out of the claim, mid-run', () => {
    const sim = realm();
    shiftFor(sim, sim.playerId);
    const run = graveyardShiftRunFor(sim.ctx, sim.playerId)!;
    const stray = run.bots[4].pid;
    const e = sim.entities.get(stray)!;
    // The Crypt door outside, far from the slot.
    e.pos = sim.ctx.groundPos(80, 90);
    e.prevPos = { ...e.pos };
    sim.ctx.rebucket(e);
    sim.tick();
    expect(graveyardShiftRunFor(sim.ctx, sim.playerId)).toBe(run);
    expect(run.bots.map((b) => b.pid)).not.toContain(stray);
    expect(run.bots).toHaveLength(4);
    expect(isGraveyardShiftBotPid(sim.ctx, stray)).toBe(false);
    expect(sim.ctx.graveyardShiftRuns.botPids.size).toBe(4);
    expect(sim.ctx.players.has(stray)).toBe(false);
  });

  it('cannot be found by name: whispers and lookups reach real players only', () => {
    const sim = realm();
    const other = sim.addPlayer('mage', 'Bystander');
    shiftFor(sim, sim.playerId);
    expect(findPlayerByName(sim.ctx, 'Bulwarkbro')).toBeNull();
    expect(resolveWhisperTarget(sim.ctx, 'Bulwarkbro hello')).toEqual({
      error: "There is no player named 'Bulwarkbro' online.",
    });
    // A real player sharing a bot's name is found, never shadowed by the bot.
    const twin = sim.addPlayer('rogue', 'Stabbyjoe');
    expect(findPlayerByName(sim.ctx, 'Stabbyjoe')?.entityId).toBe(twin);
    const whisper = resolveWhisperTarget(sim.ctx, 'Stabbyjoe hi');
    expect(whisper && 'target' in whisper ? whisper.target.entityId : null).toBe(twin);
    expect(findPlayerByName(sim.ctx, 'Bystander')?.entityId).toBe(other);
  });

  it('refuse a party invite, a trade and a duel from a real player', () => {
    const sim = realm();
    shiftFor(sim, sim.playerId);
    const bot = graveyardShiftRunFor(sim.ctx, sim.playerId)!.bots[0].pid;
    const other = sim.addPlayer('mage', 'Bystander');
    // Stand right next to the bot so range is never the reason.
    const botE = sim.entities.get(bot)!;
    const otherE = sim.entities.get(other)!;
    otherE.pos = { ...botE.pos };
    sim.partyInvite(bot, other);
    sim.tradeRequest(bot, other);
    sim.duelRequest(bot, other);
    expect(sim.ctx.partyInvites.has(bot)).toBe(false);
    expect(sim.ctx.tradeInvites.has(bot)).toBe(false);
    expect(sim.ctx.duelInvites.has(bot)).toBe(false);
    // The same calls on real players on the very same spot go through: the bot
    // guard, not the place, is what refused them (one target each, as a pending
    // invite of one kind blocks the others).
    const reals = ['Partner', 'Trader', 'Duelist'].map((name) => {
      const pid = sim.addPlayer('rogue', name);
      const e = sim.entities.get(pid)!;
      e.pos = { ...botE.pos };
      return pid;
    });
    sim.partyInvite(reals[0], other);
    sim.tradeRequest(reals[1], other);
    sim.duelRequest(reals[2], other);
    expect(sim.ctx.partyInvites.get(reals[0])?.fromPid).toBe(other);
    expect(sim.ctx.tradeInvites.get(reals[1])?.fromPid).toBe(other);
    expect(sim.ctx.duelInvites.get(reals[2])?.fromPid).toBe(other);
  });

  it('cannot be inspected, invited or followed by name through chat commands', () => {
    const sim = realm();
    const other = sim.addPlayer('mage', 'Bystander');
    shiftFor(sim, sim.playerId);
    const errorsOf = (line: string) => {
      sim.drainEvents();
      sim.chat(line, other);
      return sim
        .drainEvents()
        .filter((ev): ev is Extract<SimEvent, { type: 'error' }> => ev.type === 'error')
        .filter((ev) => ev.pid === other)
        .map((ev) => ev.text);
    };
    const missing = ["There is no player named 'Bulwarkbro' online."];
    expect(errorsOf('/inspect Bulwarkbro')).toEqual(missing);
    expect(errorsOf('/invite Bulwarkbro')).toEqual(missing);
    expect(sim.ctx.partyInvites.size).toBe(0);
    expect(errorsOf('/follow Bulwarkbro')).toEqual(missing);
    expect(sim.entities.get(other)!.followTargetId).toBeNull();
    // A real player is found by the same commands.
    sim.addPlayer('rogue', 'Realone');
    expect(errorsOf('/inspect Realone')[0]).toMatch(/^Realone: Level /);
  });

  it('speak to the run owner alone, even with someone else standing beside them', () => {
    const sim = realm();
    const bystander = sim.addPlayer('mage', 'Bystander');
    shiftFor(sim, sim.playerId);
    const run = graveyardShiftRunFor(sim.ctx, sim.playerId)!;
    // Put the owner and the bystander among the party, in earshot of everyone.
    const tank = sim.entities.get(run.bots[0].pid)!;
    for (const pid of [sim.playerId, bystander]) {
      const e = sim.entities.get(pid)!;
      e.pos = { ...tank.pos };
      e.prevPos = { ...tank.pos };
    }
    const heard: SimEvent[] = [];
    for (let i = 0; i < 20 * 20; i++) heard.push(...sim.tick());
    const says = heard.filter(
      (ev): ev is Extract<SimEvent, { type: 'chat' }> =>
        ev.type === 'chat' && ev.textKey?.startsWith('graveyardShift.say.') === true,
    );
    expect(says.length).toBeGreaterThan(0);
    expect(says.every((ev) => ev.pid === sim.playerId)).toBe(true);
  });

  it('a realm runs at most four shifts at once', () => {
    expect(GRAVEYARD_SHIFT_MAX_CONCURRENT_RUNS).toBe(4);
    const sim = realm();
    const pids = [sim.playerId];
    for (let i = 0; i < 4; i++) pids.push(sim.addPlayer('warrior', `Owner${i}`));
    for (const pid of pids.slice(0, 4)) expect(shiftFor(sim, pid)).toBeNull();
    expect(shiftFor(sim, pids[4])).toBe('Every crypt is busy. Try again soon.');
    // One ends: the next may start.
    graveyardShiftRunFor(sim.ctx, pids[0])!.pendingOutcome = 'aborted';
    sim.tick();
    expect(shiftFor(sim, pids[4])).toBeNull();
  });
});
