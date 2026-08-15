// Displacement teardown for the profession sessions: every teleport
// path and a /follow tow across a zone line cancel a live gather or fishing
// session through the ONE shared helper
// (src/sim/professions/session_teardown.ts). Direct pos writes deliberately
// do NOT cancel (pinned in gathering_rhythm.test.ts), which is also what
// lets these fixtures place a live session where a path needs it.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GATHER_NODES } from '../src/sim/content/gather_nodes';
import { DELVES, LAKE, PORTALS } from '../src/sim/data';
import { advanceDelveModule, ejectToDelveDoor, failDelveRun } from '../src/sim/delves/runs';
import { handleDevChat } from '../src/sim/dev_commands';
import { enterDungeon, leaveDungeon } from '../src/sim/instances/dungeons';
import { updatePortalTriggers } from '../src/sim/portals';
import { startFishing } from '../src/sim/professions/fishing';
import { cancelProfessionSessionOnDisplacement } from '../src/sim/professions/session_teardown';
import { RIFT_EVENT_INSTANCE_CAP } from '../src/sim/rift/runs';
import { Sim } from '../src/sim/sim';
import { moveToGraveyardForUnstuck } from '../src/sim/spirit';
import { type Entity, FISHING_CAST_ID, GATHER_CAST_ID } from '../src/sim/types';
import { terrainHeight } from '../src/sim/world';

const NODE = GATHER_NODES[0]; // ore_eastbrook_1, tier 1

function makeSim(seed = 4242): Sim {
  return new Sim({ seed, playerClass: 'warrior', autoEquip: true });
}

function teleportTo(sim: Sim, pid: number, x: number, z: number): void {
  const p = sim.entities.get(pid);
  if (!p) throw new Error(`missing entity ${pid}`);
  p.pos.x = x;
  p.pos.z = z;
  p.pos.y = terrainHeight(x, z, sim.cfg.seed);
  p.prevPos = { ...p.pos };
}

function despawnMobs(sim: Sim): void {
  for (const e of sim.entities.values()) {
    if (e.kind !== 'mob') continue;
    e.dead = true;
    e.hp = 0;
    e.aiState = 'dead';
    e.respawnTimer = 9999;
    e.corpseTimer = 9999;
    e.inCombat = false;
  }
}

// Real gather session on the shipped tier-1 node.
function startGatherSession(sim: Sim, pid: number): Entity {
  sim.addItem('copper_mining_pick', 1, pid);
  teleportTo(sim, pid, NODE.pos.x, NODE.pos.z);
  expect(sim.harvestNode(NODE.id, undefined, pid)).toBe(true);
  const p = sim.entities.get(pid);
  if (!p) throw new Error('missing entity');
  expect(p.castingAbility).toBe(GATHER_CAST_ID);
  return p;
}

// Real fishing session at the vale lake's south shore.
function startFishingSession(sim: Sim, pid: number): Entity {
  sim.addItem('simple_fishing_pole', 1, pid);
  const pz = LAKE.z - LAKE.radius - 2;
  teleportTo(sim, pid, LAKE.x, pz);
  const p = sim.entities.get(pid);
  if (!p) throw new Error('missing entity');
  p.facing = Math.atan2(0, LAKE.z - pz);
  const meta = sim.players.get(pid);
  if (!meta) throw new Error('missing meta');
  startFishing(sim.ctx, p, meta);
  expect(p.castingAbility).toBe(FISHING_CAST_ID);
  expect(p.fishCastZoneId).toBe('eastbrook_vale');
  return p;
}

// A session placed by direct field assignment (the parity-drive precedent),
// for paths whose precondition is a place with no real water or nodes.
function assignFishingSession(sim: Sim, pid: number): Entity {
  const p = sim.entities.get(pid);
  if (!p) throw new Error('missing entity');
  p.castingAbility = FISHING_CAST_ID;
  p.castTotal = 15;
  p.castRemaining = 15;
  p.fishBiteAtTick = sim.tickCount + 100;
  // An ARMED reel window, so expectSessionEnded's fishReelDeadlineTick check
  // asserts a real clear rather than a field that was already zero.
  p.fishReelDeadlineTick = sim.tickCount + 120;
  p.fishCastZoneId = 'eastbrook_vale';
  return p;
}

function expectSessionEnded(sim: Sim, p: Entity): void {
  expect(p.castingAbility).toBeNull();
  expect(p.gatherCastNodeId).toBe('');
  expect(p.fishBiteAtTick).toBe(0);
  expect(p.fishReelDeadlineTick).toBe(0);
  expect(p.fishCastZoneId).toBe('');
  expect(sim.drainEvents()).toContainEqual(
    expect.objectContaining({ type: 'castStop', success: false }),
  );
}

describe('the shared displacement helper', () => {
  it('cancels a gather or fishing session, and ONLY those', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    const p = startGatherSession(sim, pid);
    sim.drainEvents();
    cancelProfessionSessionOnDisplacement(sim.ctx, p);
    expectSessionEnded(sim, p);
    // A spell cast gains NO new cancel path here.
    p.castingAbility = 'fireball';
    p.castRemaining = 2;
    cancelProfessionSessionOnDisplacement(sim.ctx, p);
    expect(p.castingAbility).toBe('fireball');
    p.castingAbility = null;
    p.castRemaining = 0;
    // Mobs are never touched.
    const mob = [...sim.entities.values()].find((e) => e.kind === 'mob');
    if (mob) {
      mob.castingAbility = 'fireball';
      cancelProfessionSessionOnDisplacement(sim.ctx, mob);
      expect(mob.castingAbility).toBe('fireball');
      mob.castingAbility = null;
    }
  });

  it('the gather timer survives the cancel (nothing was spent)', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    const p = startGatherSession(sim, pid);
    cancelProfessionSessionOnDisplacement(sim.ctx, p);
    expect(sim.nodeHarvestableByMeFor(NODE.id, pid)).toBe(true);
  });
});

describe('teleports cancel a live session', () => {
  it('dungeon entry cancels a gather cast', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    const p = startGatherSession(sim, pid);
    sim.drainEvents();
    expect(enterDungeon(sim.ctx, 'hollow_crypt', pid)).toBe(true);
    expectSessionEnded(sim, p);
  });

  it('dungeon exit cancels a session', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    expect(enterDungeon(sim.ctx, 'hollow_crypt', pid)).toBe(true);
    const p = assignFishingSession(sim, pid);
    sim.drainEvents();
    expect(leaveDungeon(sim.ctx, pid)).toBe(true);
    expectSessionEnded(sim, p);
  });

  it('delve entry cancels a fishing session', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    sim.setPlayerLevel(DELVES.collapsed_reliquary.minLevel, pid);
    const p = startFishingSession(sim, pid);
    // Walking to the door would cancel via move input; the direct placement
    // does not (pinned), so the ENTRY is provably the operative cause.
    const door = DELVES.collapsed_reliquary.doorPos;
    teleportTo(sim, pid, door.x, door.z);
    sim.drainEvents();
    sim.enterDelve('collapsed_reliquary', 'normal', pid);
    expect(sim.delveRunForPlayer(pid)).not.toBeNull();
    expectSessionEnded(sim, p);
  });

  it('delve exit, eject, fail, and module advance each cancel a session', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    sim.setPlayerLevel(DELVES.collapsed_reliquary.minLevel, pid);
    const door = DELVES.collapsed_reliquary.doorPos;
    teleportTo(sim, pid, door.x, door.z);
    sim.enterDelve('collapsed_reliquary', 'normal', pid);
    const run = sim.delveRunForPlayer(pid);
    expect(run).not.toBeNull();
    if (!run) throw new Error('missing run');
    const p = assignFishingSession(sim, pid);
    sim.drainEvents();
    run.exitPortalOpen = true; // the advance gates on the opened portal
    advanceDelveModule(sim.ctx, run);
    expectSessionEnded(sim, p);

    assignFishingSession(sim, pid);
    sim.drainEvents();
    ejectToDelveDoor(sim.ctx, pid, DELVES[run.delveId]);
    expectSessionEnded(sim, p);

    sim.enterDelve('collapsed_reliquary', 'normal', pid);
    const run2 = sim.delveRunForPlayer(pid);
    if (!run2) throw new Error('missing second run');
    assignFishingSession(sim, pid);
    sim.drainEvents();
    failDelveRun(sim.ctx, run2);
    expectSessionEnded(sim, p);

    sim.enterDelve('collapsed_reliquary', 'normal', pid);
    expect(sim.delveRunForPlayer(pid)).not.toBeNull();
    assignFishingSession(sim, pid);
    sim.drainEvents();
    sim.leaveDelve(pid);
    expectSessionEnded(sim, p);
  });

  it('a revive teleport cancels even a LIVE caster session (revivePlayerAt)', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    const p = startFishingSession(sim, pid);
    expect(p.dead).toBe(false);
    sim.drainEvents();
    sim.revivePlayerAt(pid, { x: 10, y: 0, z: 10 }, 1);
    expectSessionEnded(sim, p);
  });

  it('rift entry and rift exit each cancel a session (the v0.32.0 teleport family)', () => {
    // The rift portals arrived with the v0.32.0 expansion as a whole new
    // teleport family with the enterDungeon displacement recipe but not the
    // teardown call; the release-merge audit caught the bypass. A player can
    // interact with an overworld portal mid-gather, so the entry drives a
    // REAL session; the exit uses the assigned fixture like the other
    // instance exits.
    const sim = makeSim();
    const pid = sim.playerId;
    const p = startGatherSession(sim, pid);
    sim.drainEvents();
    sim.enterRift(4242, 15, pid);
    expectSessionEnded(sim, p);
    const p2 = assignFishingSession(sim, pid);
    sim.drainEvents();
    sim.leaveRift(pid);
    expectSessionEnded(sim, p2);
  });

  it('an overworld portal pair cancels a session (proximity teleport)', () => {
    // One of the three remaining sites of the teardown wave: reverting its
    // call left the suite green before this case existed.
    const sim = makeSim();
    const pid = sim.playerId;
    const portal = PORTALS[0];
    const p = sim.entities.get(pid);
    if (!p) throw new Error('missing entity');
    p.pos.x = portal.a.x;
    p.pos.z = portal.a.z;
    p.prevPos = { ...p.pos };
    const live = assignFishingSession(sim, pid);
    sim.drainEvents();
    updatePortalTriggers(sim.ctx, p);
    expectSessionEnded(sim, live);
  });

  it('the rift descend and /dev mountquest sites carry the teardown call (source pins)', () => {
    // The descend loop needs a cleared floor and the mountquest hop a dev
    // flag, so these two sites are pinned at the source beside their
    // displacement writes; tests/professions_mount_interlock.test.ts and the
    // merge-settlement drive also exercise both live (descentOpen forced,
    // dev sim), so these are the placement half, not the only coverage.
    // Comment-stripped first: a comment quoting the call syntax inside the
    // proximity window must not satisfy a CALL pin (the source-scrape trap).
    const strip = (code: string): string =>
      code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    const riftSrc = strip(
      readFileSync(new URL('../src/sim/rift/runs.ts', import.meta.url), 'utf8'),
    );
    const descendAt = riftSrc.indexOf('for (const id of descenders)');
    expect(descendAt).toBeGreaterThan(-1);
    const cancelAt = riftSrc.indexOf('cancelProfessionSessionOnDisplacement(ctx, e)', descendAt);
    expect(cancelAt).toBeGreaterThan(descendAt);
    expect(cancelAt).toBeLessThan(riftSrc.indexOf('e.pos = ctx.groundPos', descendAt));
    const devSrc = strip(
      readFileSync(new URL('../src/sim/dev_commands.ts', import.meta.url), 'utf8'),
    );
    const hopAt = devSrc.indexOf('groundPos(marla.pos.x + 2');
    expect(hopAt).toBeGreaterThan(-1);
    const devCancelAt = devSrc.lastIndexOf(
      'cancelProfessionSessionOnDisplacement(ctx, entity)',
      hopAt,
    );
    expect(devCancelAt).toBeGreaterThan(-1);
    expect(hopAt - devCancelAt).toBeLessThan(400);
  });

  it('/dev tp cancels a session', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    const p = startGatherSession(sim, pid);
    sim.drainEvents();
    handleDevChat(sim.ctx, '/dev tp 50 50', pid);
    expectSessionEnded(sim, p);
  });
});

describe('a /follow tow across a zone line cancels the session', () => {
  function setupTow(sim: Sim, followerZ: number) {
    despawnMobs(sim);
    const followerPid = sim.playerId;
    const leaderPid = sim.addPlayer('warrior', 'Leader');
    const follower = startFishingSession(sim, followerPid);
    // Direct placement near the eastbrook/mirefen line at z=180 (a direct
    // pos write never cancels; the pinned zone survives the setup).
    teleportTo(sim, followerPid, 0, followerZ);
    teleportTo(sim, leaderPid, 0, followerZ + 3);
    const leader = sim.entities.get(leaderPid);
    const leaderMeta = sim.players.get(leaderPid);
    if (!leader || !leaderMeta) throw new Error('missing leader');
    leader.facing = 0; // north, +z
    follower.followTargetId = leaderPid;
    return { follower, leader, leaderMeta };
  }

  it('crossing z=180 while towed ends the session', () => {
    const sim = makeSim();
    const { follower, leader, leaderMeta } = setupTow(sim, 176);
    leaderMeta.moveInput.forward = true;
    let crossed = false;
    for (let i = 0; i < 80; i++) {
      sim.tick();
      leader.facing = 0;
      if (follower.pos.z > 180) {
        crossed = true;
        break;
      }
    }
    expect(crossed).toBe(true);
    expect(follower.castingAbility).toBeNull();
    expect(follower.fishCastZoneId).toBe('');
  });

  it('a tow that stays inside the zone does NOT cancel', () => {
    const sim = makeSim();
    const { follower, leader, leaderMeta } = setupTow(sim, 150);
    leaderMeta.moveInput.forward = true;
    for (let i = 0; i < 20; i++) {
      sim.tick();
      leader.facing = 0;
    }
    // Towed several yards north, still in eastbrook: the session lives.
    expect(follower.pos.z).toBeGreaterThan(151);
    expect(follower.pos.z).toBeLessThan(180);
    expect(follower.castingAbility).toBe(FISHING_CAST_ID);
    expect(follower.fishCastZoneId).toBe('eastbrook_vale');
  });
});

describe('the unstuck graveyard move is a displacement', () => {
  it('cancels a session on the living-player unstuck teleport (doctrine: every teleport)', () => {
    // The unstuck countdown gates reject a casting player, so a REAL session
    // cannot reach moveToGraveyardForUnstuck today; the assigned-session
    // fixture exists for exactly this shape, and the pin holds the v0.33.0
    // path to the every-teleport doctrine so a future session state that
    // stops riding castingAbility cannot slip through it.
    const sim = makeSim();
    const pid = sim.playerId;
    const p = assignFishingSession(sim, pid);
    sim.drainEvents();
    moveToGraveyardForUnstuck(sim.ctx, pid);
    expectSessionEnded(sim, p);
  });
});

describe('a denied rift entry is not a displacement', () => {
  it('a pool-full rift denial leaves a live gather session untouched', () => {
    // The v0.33.0 sync composed the release's event-instance cap early
    // return (src/sim/rift/runs.ts, enterRift) ahead of the branch's
    // cancelProfessionSessionOnDisplacement call: a denied entrant was
    // never displaced, so the cancel must NOT run. Fill the per-event cap,
    // then have a live gatherer knock on the full pool.
    const sim = new Sim({ seed: 4242, playerClass: 'warrior', autoEquip: true, riftPortals: true });
    const pid = sim.playerId;
    const fillers = Array.from({ length: RIFT_EVENT_INSTANCE_CAP }, (_, index) =>
      sim.addPlayer('warrior', `Rifter${index}`),
    );
    for (const filler of fillers) sim.enterRift(424242, 20, filler);
    const p = startGatherSession(sim, pid);
    sim.drainEvents();
    sim.enterRift(424242, 20, pid);
    // The exact pool-denial line, so a different early return (a level gate,
    // a distance gate) cannot green this test vacuously.
    expect(sim.drainEvents()).toContainEqual(
      expect.objectContaining({
        type: 'error',
        pid,
        text: 'All rifts are unstable right now. Try again soon.',
      }),
    );
    expect(p.castingAbility).toBe(GATHER_CAST_ID);
  });
});
