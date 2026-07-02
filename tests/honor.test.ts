import { describe, expect, it } from 'vitest';
import {
  HONOR_PER_PLAYER_KILL,
  grantPvpHonor,
  honorRankFor,
  normalizeHonor,
} from '../src/sim/honor';
import { Sim, type CharacterState, type PlayerMeta } from '../src/sim/sim';
import type { Entity, PlayerClass } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';

function makeWorld() {
  return new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
}

function entity(sim: Sim, pid: number): Entity {
  const e = sim.entities.get(pid);
  expect(e).toBeDefined();
  return e as Entity;
}

function meta(sim: Sim, pid: number): PlayerMeta {
  const m = sim.meta(pid);
  expect(m).not.toBeNull();
  return m as PlayerMeta;
}

function state(sim: Sim, pid: number): CharacterState {
  const saved = sim.serializeCharacter(pid);
  expect(saved).not.toBeNull();
  return saved as CharacterState;
}

function teleport(sim: Sim, pid: number, x: number, z: number) {
  const e = entity(sim, pid);
  e.pos.x = x;
  e.pos.z = z;
  e.pos.y = groundHeight(x, z, sim.cfg.seed);
  e.prevPos = { ...e.pos };
  (sim as unknown as { rebucket(e: Entity): void }).rebucket(e);
}

function queueDuo(
  aClass: PlayerClass = 'warrior',
  bClass: PlayerClass = 'mage',
): { sim: Sim; a: number; b: number } {
  const sim = makeWorld();
  const a = sim.addPlayer(aClass, 'Aleph');
  const b = sim.addPlayer(bClass, 'Bet');
  teleport(sim, a, 0, -40);
  teleport(sim, b, 6, -40);
  sim.arenaQueueJoin(a);
  sim.arenaQueueJoin(b);
  sim.tick();
  return { sim, a, b };
}

function startBout(sim: Sim) {
  for (let i = 0; i < 20 * 6; i++) {
    sim.tick();
    const match = sim.arenaMatchFor([...sim.arenaMatches.keys()][0] ?? -1);
    if (match?.state === 'active') return;
  }
}

describe('PvP honor', () => {
  it('normalizes honor counters and resolves the rank ladder', () => {
    expect(normalizeHonor(undefined)).toBe(0);
    expect(normalizeHonor(-4)).toBe(0);
    expect(normalizeHonor(12.9)).toBe(12);
    expect(honorRankFor(0).id).toBe('unranked');
    expect(honorRankFor(99).id).toBe('unranked');
    expect(honorRankFor(100).id).toBe('skirmisher');
    expect(honorRankFor(500).id).toBe('champion');
    expect(honorRankFor(99999).id).toBe('high_marshal');
  });

  it('grants spendable and lifetime honor from honorable kills', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Honored');
    const playerMeta = meta(sim, pid);

    expect(grantPvpHonor(playerMeta, 125.9)).toBe(125);
    expect(playerMeta.pvpHonor).toBe(125);
    expect(playerMeta.lifetimePvpHonor).toBe(125);
    expect(playerMeta.lifetimeHonorableKills).toBe(1);
    expect(honorRankFor(playerMeta.lifetimePvpHonor).id).toBe('skirmisher');
  });

  it('awards honor when an active arena player kills a hostile player', () => {
    const { sim, a, b } = queueDuo();
    startBout(sim);
    const attacker = entity(sim, a);
    const victim = entity(sim, b);

    sim.dealDamage(attacker, victim, 99999, false, 'physical', null, 'hit');

    expect(meta(sim, a).pvpHonor).toBe(HONOR_PER_PLAYER_KILL);
    expect(meta(sim, a).lifetimePvpHonor).toBe(HONOR_PER_PLAYER_KILL);
    expect(meta(sim, a).lifetimeHonorableKills).toBe(1);
    expect(meta(sim, b).pvpHonor).toBe(0);
    expect(meta(sim, b).lifetimeHonorableKills).toBe(0);
  });

  it('does not award honor for non-player-caused deaths', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Faller');
    const player = entity(sim, pid);

    sim.dealDamage(null, player, 99999, false, 'physical', null, 'hit');

    expect(meta(sim, pid).pvpHonor).toBe(0);
    expect(meta(sim, pid).lifetimePvpHonor).toBe(0);
    expect(meta(sim, pid).lifetimeHonorableKills).toBe(0);
  });

  it('round-trips honor counters and backfills legacy saves', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('rogue', 'Saver');
    grantPvpHonor(meta(sim, pid), 250);
    const saved = state(sim, pid);

    const sim2 = makeWorld();
    const loaded = sim2.addPlayer('rogue', 'Saver', { state: saved });
    expect(meta(sim2, loaded).pvpHonor).toBe(250);
    expect(meta(sim2, loaded).lifetimePvpHonor).toBe(250);
    expect(meta(sim2, loaded).lifetimeHonorableKills).toBe(1);

    const legacy = { ...saved };
    delete legacy.pvpHonor;
    delete legacy.lifetimePvpHonor;
    delete legacy.lifetimeHonorableKills;
    const sim3 = makeWorld();
    const legacyPid = sim3.addPlayer('rogue', 'Legacy', { state: legacy });
    expect(meta(sim3, legacyPid).pvpHonor).toBe(0);
    expect(meta(sim3, legacyPid).lifetimePvpHonor).toBe(0);
    expect(meta(sim3, legacyPid).lifetimeHonorableKills).toBe(0);
  });
});
