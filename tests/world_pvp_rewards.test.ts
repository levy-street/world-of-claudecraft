import { describe, expect, it } from 'vitest';
import {
  ARENA_X,
  BG_X,
  BUILTIN_WORLD,
  DELVE_X_MIN,
  DUNGEON_X_THRESHOLD,
  DUNGEONS,
  instanceOrigin,
  RIFT_X_MIN,
  YUMI_MAZE_X,
} from '../src/sim/data';
import { worldPvpInfoFor } from '../src/sim/pvp/world_pvp';
import { worldPvpRewardPause } from '../src/sim/pvp/world_pvp_rewards';
import {
  sanitizeWorldPvpRewardTicks,
  WORLD_PVP_MAX_REWARD_TICKS,
  WORLD_PVP_TITLE_THRESHOLDS,
} from '../src/sim/pvp/world_pvp_rewards_rules';
import { Sim } from '../src/sim/sim';
import { BG_MAX_DURATION } from '../src/sim/social/battleground';
import { TICK_RATE } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';

function fixture() {
  const sim = new Sim({
    seed: 7,
    playerClass: 'warrior',
    noPlayer: true,
    world: { ...BUILTIN_WORLD, camps: [], npcs: {}, groundObjects: [] },
  });
  const pid = sim.addPlayer('warrior', 'Flagbearer');
  sim.setPlayerLevel(20, pid);
  const player = sim.entities.get(pid)!;
  player.pos = { x: 60, y: groundHeight(60, 700, 7), z: 700 };
  player.prevPos = { ...player.pos };
  const meta = sim.players.get(pid)!;
  return { sim, pid, meta };
}

describe('World PvP rewards', () => {
  it('pins the five title thresholds and seven-day counter cap', () => {
    expect(WORLD_PVP_TITLE_THRESHOLDS).toEqual([
      { id: 'pvp_flag_1h', hours: 1 },
      { id: 'pvp_flag_3h', hours: 3 },
      { id: 'pvp_flag_6h', hours: 6 },
      { id: 'pvp_flag_24h', hours: 24 },
      { id: 'pvp_flag_168h', hours: 168 },
    ]);
    expect(WORLD_PVP_MAX_REWARD_TICKS).toBe(12_096_000);
  });
  it('enables on contested ground, freezes on sanctuary ground through logout, and resumes on exit', () => {
    const { sim, pid, meta } = fixture();
    const player = sim.entities.get(pid)!;
    player.pos.x = 60;
    player.pos.z = 700;
    sim.setWorldPvpFlag(true, pid);
    expect(meta.worldPvp!.flagged).toBe(true);
    meta.worldPvp!.rewardTicks = 3600 * TICK_RATE - 1;
    player.pos.x = -360;
    player.pos.z = 0;
    sim.tick();
    expect(meta.worldPvp!.rewardTicks).toBe(3600 * TICK_RATE - 1);
    expect(meta.deedsEarned.has('pvp_flag_1h')).toBe(false);
    const saved = sim.serializeCharacter(pid)!;
    sim.removePlayer(pid);
    const restoredPid = sim.addPlayer('warrior', 'Flagbearer', {
      state: saved,
    });
    const restored = sim.players.get(restoredPid)!;
    expect(sim.entities.get(restoredPid)!.pos.x).toBe(-360);
    sim.tick();
    expect(restored.worldPvp!.flagged).toBe(true);
    expect(restored.worldPvp!.rewardTicks).toBe(3600 * TICK_RATE - 1);
    sim.entities.get(restoredPid)!.pos.x = 60;
    sim.entities.get(restoredPid)!.pos.z = 700;
    sim.tick();
    expect(restored.worldPvp!.rewardTicks).toBe(3600 * TICK_RATE);
    expect(restored.deedsEarned.has('pvp_flag_1h')).toBe(true);
  });

  it('pauses inside a dungeon, granting no title there, and resumes back in the open world', () => {
    const { sim, pid, meta } = fixture();
    sim.setWorldPvpFlag(true, pid);
    meta.worldPvp!.rewardTicks = 3600 * TICK_RATE - 1;
    expect(worldPvpInfoFor(sim.ctx, pid)!.rewardPause).toBeNull();
    expect(sim.enterDungeon('hollow_crypt', pid)).toBe(true);
    expect(sim.entities.get(pid)!.pos.x).toBeGreaterThan(DUNGEON_X_THRESHOLD);
    for (let tick = 0; tick < 5 * TICK_RATE; tick++) sim.tick();
    expect(meta.worldPvp!.flagged).toBe(true);
    expect(meta.worldPvp!.rewardTicks).toBe(3600 * TICK_RATE - 1);
    expect(meta.deedsEarned.has('pvp_flag_1h')).toBe(false);
    expect(worldPvpInfoFor(sim.ctx, pid)!.rewardPause).toBe('instance');
    expect(sim.leaveDungeon(pid)).toBe(true);
    expect(sim.entities.get(pid)!.pos.x).toBeLessThanOrEqual(DUNGEON_X_THRESHOLD);
    sim.entities.get(pid)!.pos = { x: 60, y: groundHeight(60, 700, 7), z: 700 };
    sim.tick();
    expect(meta.worldPvp!.rewardTicks).toBe(3600 * TICK_RATE);
    expect(meta.deedsEarned.has('pvp_flag_1h')).toBe(true);
    expect(worldPvpInfoFor(sim.ctx, pid)!.rewardPause).toBeNull();
  });

  it.each([
    ['1v1', 2],
    ['fiesta', 4],
    ['yumi3', 6],
    ['battleground', 10],
  ] as const)('accumulates deed time in a seated %s match', (format, count) => {
    const { sim, pid, meta } = fixture();
    sim.setWorldPvpFlag(true, pid);
    const pids = [pid];
    for (let i = 1; i < count; i++) {
      const other = sim.addPlayer('warrior', `Rival${i}`);
      sim.setPlayerLevel(20, other);
      pids.push(other);
    }
    for (const fighter of pids) {
      if (format === 'battleground') sim.bgQueueJoin(fighter);
      else sim.arenaQueueJoin(fighter, format);
    }
    sim.tick();
    if (format === 'battleground') {
      for (const fighter of pids) sim.bgRespond(true, fighter);
    }
    expect(sim.bgMatches.has(pid) || sim.arenaMatches.has(pid)).toBe(true);
    const player = sim.entities.get(pid)!;
    expect(player.pos.x).toBeGreaterThan(DUNGEON_X_THRESHOLD);
    meta.worldPvp!.rewardTicks = 3600 * TICK_RATE - 1;
    expect(worldPvpInfoFor(sim.ctx, pid)!.rewardPause).toBeNull();
    const events = sim.tick();
    expect(meta.worldPvp!.rewardTicks).toBe(3600 * TICK_RATE);
    expect(meta.deedsEarned.has('pvp_flag_1h')).toBe(true);
    expect(
      events.filter((e) => e.type === 'deedUnlocked' && e.deedId === 'pvp_flag_1h'),
    ).toHaveLength(1);

    player.dead = true;
    sim.tick();
    expect(meta.worldPvp!.rewardTicks).toBe(3600 * TICK_RATE);
    expect(worldPvpInfoFor(sim.ctx, pid)!.rewardPause).toBe('dead');
    player.dead = false;
    sim.tick();
    expect(meta.worldPvp!.rewardTicks).toBe(3600 * TICK_RATE + 1);

    for (let tick = 0; tick < 12 * TICK_RATE; tick++) {
      const match = sim.bgMatches.get(pid) ?? sim.arenaMatches.get(pid)!;
      if (match.state === 'active') break;
      sim.tick();
    }
    const match = sim.bgMatches.get(pid) ?? sim.arenaMatches.get(pid)!;
    expect(match.state).toBe('active');
    const beforeActive = meta.worldPvp!.rewardTicks!;
    sim.tick();
    expect(meta.worldPvp!.rewardTicks).toBe(beforeActive + 1);
    expect(worldPvpInfoFor(sim.ctx, pid)!.rewardPause).toBeNull();
    if (format === 'battleground') {
      sim.bgMatches.get(pid)!.timer = BG_MAX_DURATION;
      sim.tick();
      expect(match.state).toBe('ended');
    } else {
      sim.ctx.endArenaMatch(sim.arenaMatches.get(pid)!, null, 'timeout');
      expect(match.state).toBe('over');
    }
    const beforeReturn = meta.worldPvp!.rewardTicks!;
    sim.tick();
    expect(meta.worldPvp!.rewardTicks).toBe(beforeReturn + 1);
    expect(worldPvpInfoFor(sim.ctx, pid)!.rewardPause).toBeNull();

    // Standing on a PvP floor without membership must not earn time.
    sim.bgMatches.delete(pid);
    sim.arenaMatches.delete(pid);
    expect(worldPvpInfoFor(sim.ctx, pid)!.rewardPause).toBe('instance');
    sim.tick();
    expect(meta.worldPvp!.rewardTicks).toBe(beforeReturn + 1);
  });

  it('pauses on instance ground without match membership and in the sanctuary', () => {
    const { sim, pid, meta } = fixture();
    const dawnhold = instanceOrigin(DUNGEONS.dawnhold_castle.index, 2);
    const paused: Array<[string, number, number]> = [
      ['first dungeon band', instanceOrigin(0, 0).x, instanceOrigin(0, 0).z],
      ['overflow dungeon band (Dawnhold Castle)', dawnhold.x, dawnhold.z],
      ['delve', DELVE_X_MIN, -1250],
      ['arena', ARENA_X, -1250],
      ['rift', RIFT_X_MIN, -1250],
      ['maze', YUMI_MAZE_X, -1250],
      ['battleground', BG_X, -1250],
      ['Proving Shore sanctuary', -360, 0],
    ];
    const at = (x: number, z: number, dead = false) =>
      worldPvpRewardPause(sim.ctx, { id: pid, dead, pos: { x, y: 0, z } });
    for (const [where, x, z] of paused) {
      expect(at(x, z), where).toBe(where.includes('sanctuary') ? 'sanctuary' : 'instance');
    }
    expect(at(0, 0), 'Eastbrook Vale').toBe('sanctuary');
    expect(at(60, 700), 'Thornpeak Heights').toBeNull();
    expect(at(DUNGEON_X_THRESHOLD, 0), 'the plane edge').toBeNull();
    // Death outranks the ground: a corpse is never reachable, wherever it lies.
    expect(at(0, 0, true), 'dead in Eastbrook Vale').toBe('dead');
    expect(at(dawnhold.x, dawnhold.z, true), 'dead inside a dungeon').toBe('dead');
    sim.setWorldPvpFlag(true, pid);
    const player = sim.entities.get(pid)!;
    player.pos.x = dawnhold.x;
    player.pos.z = dawnhold.z;
    sim.tick();
    expect(meta.worldPvp!.rewardTicks ?? 0).toBe(0);
  });

  it('pauses while dead, as a corpse and as a released ghost, and resumes on resurrection', () => {
    const { sim, pid, meta } = fixture();
    sim.setWorldPvpFlag(true, pid);
    meta.worldPvp!.rewardTicks = 3600 * TICK_RATE - 1;
    const player = sim.entities.get(pid)!;
    sim.ctx.dealDamage(null, player, 9_999_999, false, 'physical', null, 'hit');
    expect(player.dead).toBe(true);
    for (let tick = 0; tick < 5 * TICK_RATE; tick++) sim.tick();
    expect(meta.worldPvp!.flagged).toBe(true);
    expect(meta.worldPvp!.rewardTicks).toBe(3600 * TICK_RATE - 1);
    expect(meta.deedsEarned.has('pvp_flag_1h')).toBe(false);
    expect(worldPvpInfoFor(sim.ctx, pid)!.rewardPause).toBe('dead');
    sim.releaseSpirit(pid);
    expect(player.ghost).toBe(true);
    for (let tick = 0; tick < 5 * TICK_RATE; tick++) sim.tick();
    expect(meta.worldPvp!.rewardTicks).toBe(3600 * TICK_RATE - 1);
    expect(worldPvpInfoFor(sim.ctx, pid)!.rewardPause).toBe('dead');
    player.pos = { ...player.corpsePos! };
    sim.resurrectAtCorpse(pid);
    expect(player.dead).toBe(false);
    sim.tick();
    expect(meta.worldPvp!.rewardTicks).toBe(3600 * TICK_RATE);
    expect(meta.deedsEarned.has('pvp_flag_1h')).toBe(true);
    expect(worldPvpInfoFor(sim.ctx, pid)!.rewardPause).toBeNull();
  });

  it('publishes only whole played minutes while saving precise ticks', () => {
    const { sim, pid, meta } = fixture();
    sim.setWorldPvpFlag(true, pid);
    meta.worldPvp!.rewardTicks = 60 * TICK_RATE - 2;
    expect(worldPvpInfoFor(sim.ctx, pid)!.rewardSeconds).toBe(0);
    sim.tick();
    expect(worldPvpInfoFor(sim.ctx, pid)!.rewardSeconds).toBe(0);
    sim.tick();
    expect(worldPvpInfoFor(sim.ctx, pid)!.rewardSeconds).toBe(60);
    sim.tick();
    expect(worldPvpInfoFor(sim.ctx, pid)!.rewardSeconds).toBe(60);
    expect(sim.serializeCharacter(pid)!.worldPvp!.rewardTicks).toBe(60 * TICK_RATE + 1);
  });

  it.each(WORLD_PVP_TITLE_THRESHOLDS)(
    'grants $id exactly at $hours played hours and never repeats',
    ({ id, hours }) => {
      const { sim, pid, meta } = fixture();
      sim.setWorldPvpFlag(true, pid);
      meta.worldPvp!.rewardTicks = hours * 3600 * TICK_RATE - 2;
      sim.tick();
      expect(meta.deedsEarned.has(id)).toBe(false);
      const events = sim.tick();
      expect(meta.deedsEarned.has(id)).toBe(true);
      expect(events.filter((e) => e.type === 'deedUnlocked' && e.deedId === id)).toHaveLength(1);
      meta.worldPvp!.rewardTicks = hours * 3600 * TICK_RATE - 1;
      expect(sim.tick().filter((e) => e.type === 'deedUnlocked' && e.deedId === id)).toHaveLength(
        0,
      );
      const saved = sim.serializeCharacter(pid)!;
      sim.removePlayer(pid);
      const other = fixture().sim;
      const restoredPid = other.addPlayer('warrior', 'Flagbearer', {
        state: saved,
      });
      expect(other.players.get(restoredPid)!.deedsEarned.has(id)).toBe(true);
    },
  );

  it('preserves fractional played seconds across logout without counting time away', () => {
    const { sim, pid, meta } = fixture();
    sim.setWorldPvpFlag(true, pid);
    for (let tick = 0; tick < 23; tick++) sim.tick();
    expect(meta.worldPvp!.rewardTicks).toBe(23);
    const saved = sim.serializeCharacter(pid)!;
    sim.removePlayer(pid);
    const other = fixture().sim;
    other.time = 900_000;
    const restoredPid = other.addPlayer('warrior', 'Flagbearer', {
      state: saved,
    });
    const restored = other.players.get(restoredPid)!;
    expect(restored.worldPvp!.rewardTicks).toBe(23);
    other.tick();
    expect(restored.worldPvp!.rewardTicks).toBe(24);
    expect(other.serializeCharacter(restoredPid)!.worldPvp!.rewardTicks).toBe(24);
  });

  it('stops progress for a leaving character and caps the counter at seven days', () => {
    const { sim, pid, meta } = fixture();
    sim.setWorldPvpFlag(true, pid);
    meta.leaving = true;
    sim.tick();
    expect(meta.worldPvp!.rewardTicks ?? 0).toBe(0);
    meta.leaving = false;
    meta.worldPvp!.rewardTicks = WORLD_PVP_MAX_REWARD_TICKS;
    sim.tick();
    expect(meta.worldPvp!.rewardTicks).toBe(WORLD_PVP_MAX_REWARD_TICKS);
  });

  it('resets on an accepted off request, stops progress during disarm, and starts fresh if cancelled', () => {
    const { sim, pid, meta } = fixture();
    sim.setWorldPvpFlag(true, pid);
    meta.worldPvp!.rewardTicks = 3600 * TICK_RATE - 1;
    sim.tick();
    sim.time += 10;
    sim.setWorldPvpFlag(false, pid);
    expect(meta.worldPvp!.flagged).toBe(true);
    expect(meta.worldPvp!.rewardTicks).toBe(0);
    sim.tick();
    expect(meta.worldPvp!.rewardTicks).toBe(0);
    const saved = sim.serializeCharacter(pid)!;
    const other = fixture().sim;
    const restoredPid = other.addPlayer('warrior', 'Flagbearer', {
      state: saved,
    });
    expect(other.players.get(restoredPid)!.worldPvp!.disarmAt).not.toBeNull();
    sim.time += 10;
    sim.setWorldPvpFlag(true, pid);
    sim.tick();
    expect(meta.worldPvp!.rewardTicks).toBe(1);
    expect(meta.deedsEarned.has('pvp_flag_1h')).toBe(true);
  });

  it('sanitizes loaded fractional and oversized counters, discarding unarmed progress', () => {
    const { sim, pid } = fixture();
    sim.setWorldPvpFlag(true, pid);
    const saved = sim.serializeCharacter(pid)!;
    const cases = [
      { record: { flagged: true, rewardTicks: 12.8 }, expected: 12 },
      { record: { flagged: true, rewardTicks: Number.MAX_SAFE_INTEGER }, expected: 12_096_000 },
      { record: { flagged: false, rewardTicks: 72_000 }, expected: 0 },
      { record: { flagged: true, disarmRemaining: 100, rewardTicks: 72_000 }, expected: 0 },
    ];
    for (const { record, expected } of cases) {
      const restoredPid = sim.addPlayer('warrior', 'Counter', {
        state: { ...saved, worldPvp: record },
      });
      expect(sim.players.get(restoredPid)!.worldPvp?.rewardTicks ?? 0).toBe(expected);
      expect(sim.serializeCharacter(restoredPid)!.worldPvp?.rewardTicks ?? 0).toBe(expected);
      expect(sim.players.get(restoredPid)!.deedsEarned.has('pvp_flag_1h')).toBe(false);
    }
  });

  it('keeps an earned and selected PvP title and its renown when its streak resets and reloads', () => {
    const { sim, pid, meta } = fixture();
    sim.setWorldPvpFlag(true, pid);
    sim.tick(); // Settle the fixture's level and discovery deeds before the PvP grant.
    const before = meta.renown;
    meta.worldPvp!.rewardTicks = 71_999;
    sim.tick();
    expect(meta.renown).toBe(before + 5);
    sim.setActiveTitle('pvp_flag_1h', pid);
    expect(meta.activeTitle).toBe('pvp_flag_1h');
    sim.time += 10;
    sim.setWorldPvpFlag(false, pid);
    const saved = sim.serializeCharacter(pid)!;
    const restoredPid = sim.addPlayer('warrior', 'Titlebearer', { state: saved });
    const restored = sim.players.get(restoredPid)!;
    expect(restored.worldPvp!.rewardTicks ?? 0).toBe(0);
    expect(restored.activeTitle).toBe('pvp_flag_1h');
    expect(restored.deedsEarned.has('pvp_flag_1h')).toBe(true);
    const controlDeeds = { ...saved.deeds };
    delete controlDeeds.pvp_flag_1h;
    const controlPid = sim.addPlayer('warrior', 'WithoutTitle', {
      state: { ...saved, deeds: controlDeeds, activeTitle: null, renown: 999_999 },
    });
    // Loading may grant unrelated migration/discovery deeds to both records.
    // The earned PvP title still contributes exactly five authoritative renown.
    expect(restored.renown - sim.players.get(controlPid)!.renown).toBe(5);
  });

  it('normalizes legacy and malformed saves, and disabled realms restore no rewards', () => {
    const { sim, pid } = fixture();
    sim.setWorldPvpFlag(true, pid);
    const saved = sim.serializeCharacter(pid)!;
    for (const rewardTicks of [undefined, NaN, Infinity, -1, '100']) {
      const restoredPid = sim.addPlayer('warrior', 'Legacy', {
        state: {
          ...saved,
          worldPvp: { flagged: true, rewardTicks: rewardTicks as number },
        },
      });
      expect(sim.players.get(restoredPid)!.worldPvp!.rewardTicks ?? 0).toBe(0);
    }
    expect(sanitizeWorldPvpRewardTicks(12.8)).toBe(12);
    expect(sanitizeWorldPvpRewardTicks(Number.MAX_SAFE_INTEGER)).toBe(WORLD_PVP_MAX_REWARD_TICKS);
    const disabled = new Sim({
      seed: 7,
      playerClass: 'warrior',
      noPlayer: true,
      worldPvpDisabled: true,
    });
    const restoredPid = disabled.addPlayer('warrior', 'Disabled', {
      state: saved,
    });
    const meta = disabled.players.get(restoredPid)!;
    expect(meta.worldPvp?.rewardTicks ?? 0).toBe(0);
    // No flag is ever armed under the kill switch, so even inside an instance
    // the readout never claims a paused streak.
    disabled.entities.get(restoredPid)!.pos.x = instanceOrigin(0, 0).x;
    expect(disabled.worldPvpInfoFor(restoredPid)!.rewardPause).toBeNull();
  });
});
