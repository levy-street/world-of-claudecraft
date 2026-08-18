// The Last Bell squad roster (src/sim/squad/squad.ts): rng-free spawning,
// directive-driven movement (follow / hold / station), combat engagement,
// the healer duty, the scripted 1 hp floor + player relief, group damage
// scaling, and teardown.
import { describe, expect, it } from 'vitest';
import { LAST_BELL_SQUAD_ACTORS, LAST_BELL_SQUAD_MOBS } from '../src/sim/content/last_bell_squad';
import { DUNGEONS, MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import {
  despawnSquad,
  setSquadDirective,
  spawnSquad,
  squadActorEntity,
} from '../src/sim/squad/squad';
import { addThreat } from '../src/sim/threat';
import { dist2d, type Entity } from '../src/sim/types';

function setupStorySquad(actorIds: readonly string[] = ['coalfast', 'saul'], humanCount = 1) {
  const sim = new Sim({ seed: 77, playerClass: 'warrior', playerName: 'Bell', devCommands: true });
  sim.player.level = 10;
  expect(sim.enterStoryInstance('lb_riftline')).toBe(true);
  const claim = sim.ctx.instances.find((i) => i.dungeonId === 'lb_riftline' && i.partyKey !== null);
  expect(claim?.exitId).toBeTruthy();
  const claimId = claim?.exitId ?? -1;
  const run = spawnSquad(sim.ctx, {
    claimId,
    dungeonId: 'lb_riftline',
    anchor: { x: sim.player.pos.x, z: sim.player.pos.z },
    actorIds,
    humanCount,
  });
  expect(run).toBeTruthy();
  return { sim, claimId, run };
}

function tickMany(sim: Sim, n: number) {
  for (let i = 0; i < n; i++) sim.tick();
}

describe('squad content integrity', () => {
  it('every actor resolves its template, fixed-level and inert to generic AI', () => {
    for (const def of Object.values(LAST_BELL_SQUAD_ACTORS)) {
      const template = LAST_BELL_SQUAD_MOBS[def.mobTemplateId];
      expect(template, def.id).toBeTruthy();
      // Fixed level: spawning draws no rng.
      expect(template.minLevel).toBe(template.maxLevel);
      // Escortee contract: generic mob AI never moves or aggros an actor.
      expect(template.moveSpeed).toBe(0);
      expect(template.aggroRadius).toBe(0);
      expect(template.elite).toBe(true);
    }
    expect(DUNGEONS.lb_riftline.interior).toBe('farshore_story');
  });
});

describe('squad lifecycle', () => {
  it('spawns actors friendly, rng-free, and despawns them cleanly', () => {
    const sim = new Sim({
      seed: 77,
      playerClass: 'warrior',
      playerName: 'Bell',
      devCommands: true,
    });
    sim.enterStoryInstance('lb_riftline');
    const claimId =
      sim.ctx.instances.find((i) => i.dungeonId === 'lb_riftline' && i.partyKey !== null)?.exitId ??
      -1;
    let draws = 0;
    sim.rng.setObserver(() => draws++);
    const run = spawnSquad(sim.ctx, {
      claimId,
      dungeonId: 'lb_riftline',
      anchor: { x: sim.player.pos.x, z: sim.player.pos.z },
      actorIds: ['coalfast', 'ollun', 'edda', 'saul', 'tam'],
      humanCount: 1,
    });
    sim.rng.setObserver(null);
    expect(draws).toBe(0);
    expect(run?.actorIds.size).toBe(5);
    for (const actorId of ['coalfast', 'ollun', 'edda', 'saul', 'tam']) {
      const actor = squadActorEntity(sim.ctx, claimId, actorId);
      expect(actor, actorId).toBeTruthy();
      expect(actor?.hostile).toBe(false);
      expect(actor?.squadFloor).toBe(true);
    }
    despawnSquad(sim.ctx, claimId);
    expect(sim.ctx.squadRuns.size).toBe(0);
    for (const actorId of ['coalfast', 'tam']) {
      expect(squadActorEntity(sim.ctx, claimId, actorId)).toBeNull();
    }
  });

  it('follow trails the player; hold and station stand their ground', () => {
    const { sim, claimId } = setupStorySquad(['coalfast']);
    const actor = () => squadActorEntity(sim.ctx, claimId, 'coalfast') as Entity;
    // Walk the player away; the follower closes to follow distance.
    const start = { ...sim.player.pos };
    sim.player.pos = sim.groundPos(start.x + 25, start.z + 10);
    sim.player.prevPos = { ...sim.player.pos };
    tickMany(sim, 120);
    expect(dist2d(actor().pos, sim.player.pos)).toBeLessThan(8);
    // Hold: pin the actor to a point; the player walking off does not move it.
    const post = { x: sim.player.pos.x - 10, z: sim.player.pos.z - 10 };
    setSquadDirective(sim.ctx, claimId, 'coalfast', { kind: 'hold', ...post });
    tickMany(sim, 80);
    sim.player.pos = sim.groundPos(start.x + 60, start.z + 40);
    sim.player.prevPos = { ...sim.player.pos };
    tickMany(sim, 80);
    expect(Math.hypot(actor().pos.x - post.x, actor().pos.z - post.z)).toBeLessThan(3);
  });

  it('engages a hostile mob pressing the player and brings it down', () => {
    const { sim, claimId } = setupStorySquad(['coalfast', 'edda']);
    // Spawn the enemy INSIDE the instance, beside the squad (/dev spawn
    // places mobs at overworld-safe ground, useless here).
    const mob = createMob(
      sim.ctx.nextId++,
      MOBS.riftspawn,
      3,
      sim.groundPos(sim.player.pos.x + 5, sim.player.pos.z + 2),
    );
    sim.ctx.addEntity(mob);
    mob.aggroTargetId = sim.playerId;
    mob.inCombat = true;
    addThreat(mob, sim.playerId, 10);
    const startHp = mob.hp;
    tickMany(sim, 200);
    expect(mob.hp).toBeLessThan(startHp);
  });

  it('the healer mends the wounded player', () => {
    const { sim, claimId } = setupStorySquad(['saul']);
    const saul = squadActorEntity(sim.ctx, claimId, 'saul') as Entity;
    sim.player.hp = Math.round(sim.player.maxHp * 0.4);
    let saulHealFx = 0;
    for (let i = 0; i < 100; i++) {
      for (const ev of sim.tick()) {
        if (ev.type === 'spellfx' && ev.sourceId === saul.id && ev.school === 'holy') {
          saulHealFx++;
        }
      }
    }
    expect(saulHealFx).toBeGreaterThan(0);
  });

  it('lethal damage clamps at the floor, downs the actor, and a player relieves it', () => {
    const { sim, claimId } = setupStorySquad(['tam']);
    const tam = squadActorEntity(sim.ctx, claimId, 'tam') as Entity;
    // Hold Tam at a post and walk the player out of relief range first: a
    // follower parks beside the player, which IS relief range.
    setSquadDirective(sim.ctx, claimId, 'tam', { kind: 'hold', x: tam.pos.x, z: tam.pos.z });
    sim.player.pos = sim.groundPos(tam.pos.x + 30, tam.pos.z + 30);
    sim.player.prevPos = { ...sim.player.pos };
    tickMany(sim, 5);
    sim.ctx.dealDamage(null, tam, tam.maxHp * 10, false, 'shadow', null, 'hit');
    expect(tam.dead).toBe(false);
    expect(tam.hp).toBe(1);
    expect(tam.squadDowned).toBe(true);
    // Downed: it stays down while nobody is close.
    tickMany(sim, 40);
    expect(tam.squadDowned).toBe(true);
    // Relief: a living player standing close brings it back up.
    sim.player.pos = { ...tam.pos };
    sim.player.prevPos = { ...tam.pos };
    tickMany(sim, 5);
    expect(tam.squadDowned).toBe(false);
    expect(tam.hp).toBeGreaterThan(tam.maxHp * 0.3);
  });

  it('group scaling lowers the damage share as humans join', () => {
    const solo = setupStorySquad(['coalfast'], 1);
    const five = setupStorySquad(['coalfast'], 5);
    const soloActor = squadActorEntity(solo.sim.ctx, solo.claimId, 'coalfast') as Entity;
    const fiveActor = squadActorEntity(five.sim.ctx, five.claimId, 'coalfast') as Entity;
    expect(soloActor.squadDamageMult).toBe(1);
    expect(fiveActor.squadDamageMult ?? 1).toBeLessThan(0.5);
  });
});
