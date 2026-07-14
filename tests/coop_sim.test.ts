import { describe, expect, it } from 'vitest';
import {
  COOP_RESPAWN_COUNTDOWN_MS,
  COOP_RESURRECT_RETRY_MS,
  CoopRespawnTimer,
} from '../src/game/coop_respawn';
import { Sim } from '../src/sim/sim';

function makeSim() {
  return new Sim({ seed: 42, playerClass: 'warrior', playerName: 'Parent' });
}

function dist(a: { x: number; z: number }, b: { x: number; z: number }): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

describe('addPlayer spawnNearPid (couch co-op joins)', () => {
  it('spawns the joiner beside the anchor player, not at the world start', () => {
    const sim = makeSim();
    const p1 = sim.playerId;
    // Move Player 1 well away from the start so "near P1" is distinguishable.
    const away = sim.groundPos(sim.player.pos.x + 60, sim.player.pos.z + 40);
    sim.player.pos.x = away.x;
    sim.player.pos.y = away.y;
    sim.player.pos.z = away.z;
    const p2 = sim.addPlayer('mage', 'Kid', { spawnNearPid: p1 });
    const e2 = sim.entities.get(p2);
    expect(e2).toBeDefined();
    expect(dist(e2!.pos, sim.player.pos)).toBeLessThan(12);
  });

  it('fans multiple joiners out instead of stacking them on one spot', () => {
    const sim = makeSim();
    const p1 = sim.playerId;
    const p2 = sim.addPlayer('mage', 'KidOne', { spawnNearPid: p1 });
    const p3 = sim.addPlayer('rogue', 'KidTwo', { spawnNearPid: p1 });
    const e2 = sim.entities.get(p2);
    const e3 = sim.entities.get(p3);
    expect(dist(e2!.pos, e3!.pos)).toBeGreaterThan(0.5);
  });

  it('a saved position always wins over spawnNearPid', () => {
    const sim = makeSim();
    const p1 = sim.playerId;
    const p2 = sim.addPlayer('mage', 'Kid', { spawnNearPid: p1 });
    // Park the character somewhere specific, save, and drop them.
    const e2 = sim.entities.get(p2)!;
    const parked = sim.groundPos(e2.pos.x + 45, e2.pos.z + 25);
    e2.pos.x = parked.x;
    e2.pos.y = parked.y;
    e2.pos.z = parked.z;
    const state = sim.serializeCharacter(p2)!;
    sim.removePlayer(p2);
    // Move the anchor away; a rejoin with a saved state must land at the
    // saved spot, not chase the anchor.
    const away = sim.groundPos(sim.player.pos.x - 80, sim.player.pos.z - 60);
    sim.player.pos.x = away.x;
    sim.player.pos.z = away.z;
    const p2again = sim.addPlayer('mage', 'Kid', { spawnNearPid: p1, state });
    expect(dist(sim.entities.get(p2again)!.pos, parked)).toBeLessThan(5);
  });

  it('an unknown anchor falls back to the world start', () => {
    const sim = makeSim();
    const start = sim.groundPos(sim.player.pos.x, sim.player.pos.z);
    const p2 = sim.addPlayer('mage', 'Kid', { spawnNearPid: 999999 });
    // Player 1 has not moved, so the start fallback lands near them anyway;
    // the point is that a bogus pid must not throw.
    expect(dist(sim.entities.get(p2)!.pos, start)).toBeLessThan(30);
  });
});

describe('movePlayerNear (co-op regroup)', () => {
  it('snaps a local player next to the anchor and grounds them', () => {
    const sim = makeSim();
    const p1 = sim.playerId;
    const p2 = sim.addPlayer('mage', 'Kid', { spawnNearPid: p1 });
    const e2 = sim.entities.get(p2)!;
    e2.pos.x += 300;
    e2.pos.z += 300;
    expect(sim.movePlayerNear(p2, p1)).toBe(true);
    expect(dist(e2.pos, sim.player.pos)).toBeLessThan(12);
    expect(e2.vy).toBe(0);
    expect(e2.onGround).toBe(true);
  });

  it('refuses unknown pids, self-moves, and non-player anchors', () => {
    const sim = makeSim();
    const p1 = sim.playerId;
    const p2 = sim.addPlayer('mage', 'Kid', { spawnNearPid: p1 });
    expect(sim.movePlayerNear(999999, p1)).toBe(false);
    expect(sim.movePlayerNear(p2, 999999)).toBe(false);
    expect(sim.movePlayerNear(p2, p2)).toBe(false);
    // A mob id is not a player anchor.
    const mob = [...sim.entities.values()].find((e) => e.kind === 'mob');
    if (mob) expect(sim.movePlayerNear(p2, mob.id)).toBe(false);
  });
});

describe('per-player movement in one shared offline sim', () => {
  it('drives each local player from their own moveInput without cross-talk', () => {
    const sim = makeSim();
    const p1 = sim.playerId;
    const p2 = sim.addPlayer('mage', 'Kid', { spawnNearPid: p1 });
    const e1 = sim.entities.get(p1)!;
    const e2 = sim.entities.get(p2)!;
    const start1 = { ...e1.pos };
    const start2 = { ...e2.pos };
    const meta2 = sim.players.get(p2)!;
    e2.facing = 0; // travel along +z
    meta2.moveInput.forward = true;
    for (let i = 0; i < 40; i++) sim.tick();
    expect(dist(e2.pos, start2)).toBeGreaterThan(2);
    expect(dist(e1.pos, start1)).toBeLessThan(0.5);
  });

  it('local players party up through the normal sim party commands', () => {
    const sim = makeSim();
    const p1 = sim.playerId;
    const p2 = sim.addPlayer('mage', 'KidOne', { spawnNearPid: p1 });
    const p3 = sim.addPlayer('rogue', 'KidTwo', { spawnNearPid: p1 });
    const p4 = sim.addPlayer('priest', 'KidThree', { spawnNearPid: p1 });
    sim.tick();
    for (const pid of [p2, p3, p4]) {
      sim.partyInvite(pid, p1);
      sim.partyAccept(pid);
    }
    // p1 is the primary player, so the IWorld partyInfo view is their party.
    expect(sim.partyInfo?.members.length).toBe(4);
  });

  it('removePlayer drops the local player and their entity', () => {
    const sim = makeSim();
    const p2 = sim.addPlayer('mage', 'Kid', { spawnNearPid: sim.playerId });
    sim.removePlayer(p2);
    expect(sim.entities.has(p2)).toBe(false);
    expect(sim.players.has(p2)).toBe(false);
  });
});

describe('CoopRespawnTimer + sim death round trip', () => {
  it('counts down, releases, resurrects at the Spirit Healer, then regroups', () => {
    const sim = makeSim();
    const p1 = sim.playerId;
    const p2 = sim.addPlayer('mage', 'Kid', { spawnNearPid: p1 });
    const e2 = sim.entities.get(p2)!;
    sim.tick();
    e2.hp = 0;
    e2.dead = true;

    const timer = new CoopRespawnTimer();
    const acts: string[] = [];
    // Drive ~20 seconds of frames; apply each action to the sim like the host does.
    for (let ms = 0; ms < 20000; ms += 100) {
      const act = timer.step({ dead: e2.dead, ghost: e2.ghost === true }, 100);
      if (!act) continue;
      acts.push(act);
      if (act === 'release') sim.releaseSpirit(p2);
      else if (act === 'resurrect') sim.resurrectAtSpiritHealer(p2);
      else if (act === 'regroup') sim.movePlayerNear(p2, p1);
      if (act === 'regroup') break;
    }
    expect(acts[0]).toBe('release');
    expect(acts).toContain('resurrect');
    expect(acts[acts.length - 1]).toBe('regroup');
    expect(e2.dead).toBe(false);
    expect(dist(e2.pos, sim.player.pos)).toBeLessThan(12);
  });

  it('the countdown is visible and the release fires exactly once', () => {
    const timer = new CoopRespawnTimer();
    const dead = { dead: true, ghost: false };
    expect(timer.step(dead, 100)).toBeNull();
    expect(timer.remainingMs()).toBe(COOP_RESPAWN_COUNTDOWN_MS - 100);
    expect(timer.step(dead, COOP_RESPAWN_COUNTDOWN_MS)).toBe('release');
    // Still dead, not yet a ghost (release in flight): no duplicate release.
    expect(timer.step(dead, 100)).toBeNull();
  });

  it('as a ghost it retries the resurrect on a pace, not every frame', () => {
    const timer = new CoopRespawnTimer();
    timer.step({ dead: true, ghost: false }, COOP_RESPAWN_COUNTDOWN_MS); // -> release
    expect(timer.step({ dead: true, ghost: true }, 16)).toBe('resurrect');
    expect(timer.step({ dead: true, ghost: true }, 16)).toBeNull();
    expect(timer.step({ dead: true, ghost: true }, COOP_RESURRECT_RETRY_MS)).toBe('resurrect');
  });

  it('an alive player never triggers anything', () => {
    const timer = new CoopRespawnTimer();
    expect(timer.step({ dead: false, ghost: false }, 1000)).toBeNull();
    expect(timer.remainingMs()).toBe(0);
  });
});
