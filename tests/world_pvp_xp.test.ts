import { describe, expect, it } from 'vitest';
import { grantXp } from '../src/sim/combat/damage';
import { BUILTIN_WORLD } from '../src/sim/data';
import { awardFactionReputation, maxStandingForLevel } from '../src/sim/factions';
import { Sim } from '../src/sim/sim';
import { MAX_LEVEL } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';

function fixture(level = 10, worldPvpDisabled = false) {
  const sim = new Sim({
    seed: 7,
    playerClass: 'warrior',
    noPlayer: true,
    worldPvpDisabled,
    world: { ...BUILTIN_WORLD, camps: [], npcs: {}, groundObjects: [] },
  });
  const pid = sim.addPlayer('warrior', 'Flagbearer');
  sim.setPlayerLevel(level, pid);
  const player = sim.entities.get(pid)!;
  player.pos = { x: 60, y: groundHeight(60, 700, 7), z: 700 };
  player.prevPos = { ...player.pos };
  const meta = sim.players.get(pid)!;
  return { sim, pid, player, meta };
}

describe('World PvP XP bonus', () => {
  it.each([10, MAX_LEVEL])('awards exactly 10 percent extra lifetime XP at level %s', (level) => {
    const { sim, pid, meta } = fixture(level);
    sim.setWorldPvpFlag(true, pid);
    expect(meta.worldPvp!.flagged).toBe(true);
    const before = meta.lifetimeXp;
    const counters = meta.counters.xpGained;
    grantXp(sim.ctx, 100, meta);
    expect(meta.lifetimeXp - before).toBe(110);
    expect(meta.counters.xpGained - counters).toBe(110);
  });
  it('applies before rested kill XP and consumes the matching rested amount', () => {
    const { sim, pid, meta } = fixture();
    sim.setWorldPvpFlag(true, pid);
    meta.restedXp = 1000;
    const before = meta.lifetimeXp;
    const bar = meta.xp;
    grantXp(sim.ctx, 100, meta, { fromKill: true });
    expect(meta.lifetimeXp - before).toBe(220);
    expect(meta.xp - bar).toBe(220);
    expect(meta.restedXp).toBe(890);
  });
  it('boosts non-kill XP without consuming rested XP', () => {
    const { sim, pid, meta } = fixture();
    sim.setWorldPvpFlag(true, pid);
    meta.restedXp = 1000;
    const before = meta.lifetimeXp;
    grantXp(sim.ctx, 100, meta);
    expect(meta.lifetimeXp - before).toBe(110);
    expect(meta.restedXp).toBe(1000);
  });
  it('leaves unflagged awards unchanged and stops the bonus during pending disarm', () => {
    const { sim, pid, meta } = fixture();
    let before = meta.lifetimeXp;
    grantXp(sim.ctx, 100, meta);
    expect(meta.lifetimeXp - before).toBe(100);
    sim.setWorldPvpFlag(true, pid);
    sim.time += 10;
    sim.setWorldPvpFlag(false, pid);
    expect(meta.worldPvp!.flagged).toBe(true);
    expect(meta.worldPvp!.disarmAt).not.toBeNull();
    before = meta.lifetimeXp;
    grantXp(sim.ctx, 100, meta);
    expect(meta.lifetimeXp - before).toBe(100);
  });
  it('does not boost awards when the realm disables world PvP', () => {
    const { sim, meta } = fixture(10, true);
    // Even a stale flag must not bypass the realm switch.
    meta.worldPvp = { flagged: true, disarmAt: null, kills: 0, deaths: 0 };
    const before = meta.lifetimeXp;
    grantXp(sim.ctx, 100, meta);
    expect(meta.lifetimeXp - before).toBe(100);
  });
  it('rounds boosted awards down and leaves non-positive awards inert', () => {
    const { sim, pid, meta } = fixture();
    sim.setWorldPvpFlag(true, pid);
    let before = meta.lifetimeXp;
    grantXp(sim.ctx, 19, meta);
    expect(meta.lifetimeXp - before).toBe(20);
    before = meta.lifetimeXp;
    grantXp(sim.ctx, 0, meta);
    grantXp(sim.ctx, -10, meta);
    expect(meta.lifetimeXp).toBe(before);
  });
  it('awards exactly 10 percent extra faction reputation while armed', () => {
    const { sim, pid, meta } = fixture(MAX_LEVEL);
    const bonus = { worldPvpBonus: true };
    expect(awardFactionReputation(meta, 'rift_watch', 100, MAX_LEVEL, bonus).gained).toBe(100);
    sim.setWorldPvpFlag(true, pid);
    expect(meta.worldPvp!.flagged).toBe(true);
    expect(awardFactionReputation(meta, 'rift_watch', 100, MAX_LEVEL, bonus).gained).toBe(110);
    // Rounds down, and non-positive awards stay inert.
    expect(awardFactionReputation(meta, 'rift_watch', 19, MAX_LEVEL, bonus).gained).toBe(20);
    expect(awardFactionReputation(meta, 'rift_watch', 0, MAX_LEVEL, bonus).gained).toBe(0);
    expect(meta.factions.rift_watch).toBe(230);
  });
  it('stops the reputation bonus during pending disarm and for exact grants', () => {
    const { sim, pid, meta } = fixture(MAX_LEVEL);
    sim.setWorldPvpFlag(true, pid);
    // Callers that do not opt in (the dev grant) stay exact.
    expect(awardFactionReputation(meta, 'rift_watch', 100, MAX_LEVEL).gained).toBe(100);
    sim.time += 10;
    sim.setWorldPvpFlag(false, pid);
    expect(meta.worldPvp!.disarmAt).not.toBeNull();
    expect(
      awardFactionReputation(meta, 'rift_watch', 100, MAX_LEVEL, { worldPvpBonus: true }).gained,
    ).toBe(100);
  });
  it('applies the reputation bonus before the standing cap clamps it', () => {
    const { sim, pid, meta } = fixture(MAX_LEVEL);
    sim.setWorldPvpFlag(true, pid);
    // 105 headroom: the unboosted 100 would fit, the boosted 110 is clamped.
    meta.factions.rift_watch = maxStandingForLevel(MAX_LEVEL) - 105;
    const result = awardFactionReputation(meta, 'rift_watch', 100, MAX_LEVEL, {
      worldPvpBonus: true,
    });
    expect(result.gained).toBe(105);
    expect(result.capped).toBe(true);
    expect(meta.factions.rift_watch).toBe(maxStandingForLevel(MAX_LEVEL));
  });
  it('does not boost a stored flag-down record', () => {
    const { sim, meta } = fixture();
    meta.worldPvp = { flagged: false, disarmAt: null, kills: 0, deaths: 0 };
    const before = meta.lifetimeXp;
    grantXp(sim.ctx, 100, meta);
    expect(meta.lifetimeXp - before).toBe(100);
  });
  it('replays XP state and emitted amounts without consuming RNG', () => {
    const replay = () => {
      const { sim, pid, meta } = fixture();
      let draws = 0;
      sim.rng.setObserver(() => {
        draws++;
      });
      const before = meta.lifetimeXp;
      sim.setWorldPvpFlag(true, pid);
      grantXp(sim.ctx, 100, meta);
      meta.restedXp = 1000;
      grantXp(sim.ctx, 100, meta, { fromKill: true });
      sim.time += 10;
      sim.setWorldPvpFlag(false, pid);
      grantXp(sim.ctx, 100, meta);
      expect(draws).toBe(0);
      const amounts = sim.events
        .filter((event) => event.type === 'xp')
        .map((event) => event.amount);
      expect(amounts).toEqual([110, 220, 100]);
      expect(meta.lifetimeXp - before).toBe(430);
      sim.rng.setObserver(null);
      return {
        lifetimeXp: meta.lifetimeXp,
        xp: meta.xp,
        rested: meta.restedXp,
        counters: meta.counters.xpGained,
        amounts,
        nextDraw: sim.rng.next(),
      };
    };
    expect(replay()).toEqual(replay());
  });
});
