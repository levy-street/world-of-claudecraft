// Cowardly mobs (sentient families: humanoid/kobold/murloc/troll) panic at low HP
// instead of fighting to the death: they turn and run from their attacker for a few
// seconds. While running they look each tick for a LOCAL idle same-family ally (within
// FLEE_HELP_RADIUS); the instant they reach the first one, that local cluster joins the
// fight and the fleer turns back to re-engage WITH it. First contact ends the flee, so
// allies further down the lane are NOT chained in. If it finds no one, it recovers its
// nerve on its own. They flee only ONCE per pull, and elites/bosses/beasts never flee.
import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';
import { DT, dist2d, RUN_SPEED } from '../src/sim/types';

function makeSim() {
  return new Sim({ seed: 42, playerClass: 'warrior', autoEquip: true });
}

function wildMobs(sim: Sim): Entity[] {
  return [...sim.entities.values()].filter(
    (e) => e.kind === 'mob' && !e.dead && e.ownerId === null,
  );
}

// Put a wild mob into an active fight with the player at low HP, as a chosen family.
function engageLowHp(sim: Sim, mob: Entity, templateId: string, hpFrac: number) {
  mob.templateId = templateId;
  mob.hostile = true;
  mob.maxHp = 1000;
  mob.hp = Math.round(mob.maxHp * hpFrac);
  mob.auras = [];
  mob.enraged = false;
  mob.hasFled = false;
  mob.fleeTimer = 0;
  mob.fleeReturnTimer = 0;
  mob.pos = { x: sim.player.pos.x + 3, z: sim.player.pos.z, y: sim.player.pos.y };
  mob.prevPos = { ...mob.pos };
  mob.spawnPos = { ...mob.pos };
  mob.leashAnchor = { ...mob.pos };
  mob.aiState = 'attack';
  mob.aggroTargetId = sim.playerId;
  mob.inCombat = true;
}

function moveEntityToward(e: Entity, target: Entity, step: number) {
  const dx = target.pos.x - e.pos.x;
  const dz = target.pos.z - e.pos.z;
  const d = Math.hypot(dx, dz);
  if (d <= 0) return;
  const s = Math.min(step, d);
  e.pos.x += (dx / d) * s;
  e.pos.z += (dz / d) * s;
  e.prevPos = { ...e.pos };
}

describe('cowardly mobs flee at low HP', () => {
  it('a low-HP humanoid panics and enters the flee state', () => {
    const sim = makeSim();
    const mob = wildMobs(sim)[0];
    engageLowHp(sim, mob, 'gravecaller_cultist', 0.15);

    sim.tick();

    expect(sim.entities.get(mob.id)!.aiState).toBe('flee');
    expect(mob.hasFled).toBe(true);
  });

  it('a healthy humanoid stands and fights (no flee above the threshold)', () => {
    const sim = makeSim();
    const mob = wildMobs(sim)[0];
    engageLowHp(sim, mob, 'gravecaller_cultist', 0.5);

    sim.tick();

    expect(sim.entities.get(mob.id)!.aiState).toBe('attack');
  });

  it('runs AWAY from its attacker while fleeing', () => {
    const sim = makeSim();
    const mob = wildMobs(sim)[0];
    engageLowHp(sim, mob, 'gravecaller_cultist', 0.1);

    const before = dist2d(mob.pos, sim.player.pos);
    for (let i = 0; i < 10; i++) sim.tick();

    expect(mob.aiState === 'flee' || mob.hasFled).toBe(true);
    expect(dist2d(mob.pos, sim.player.pos)).toBeGreaterThan(before);
  });

  it('does not flee faster than a player can run', () => {
    const sim = makeSim();
    const mob = wildMobs(sim)[0];
    engageLowHp(sim, mob, 'gravecaller_cultist', 0.1);
    mob.moveSpeed = RUN_SPEED * 2;

    sim.tick();
    expect(mob.aiState).toBe('flee');
    const before = { ...mob.pos };

    sim.tick();

    expect(dist2d(before, mob.pos)).toBeLessThanOrEqual(RUN_SPEED * DT + 1e-6);
  });

  it('stays in the pull instead of evade-resetting when the player chases a fleeing mob', () => {
    const sim = makeSim();
    const mob = wildMobs(sim)[0];
    engageLowHp(sim, mob, 'gravecaller_cultist', 0.1);
    mob.moveSpeed = RUN_SPEED * 2;

    sim.tick();
    expect(mob.aiState).toBe('flee');

    for (let i = 0; i < 20 * 6; i++) {
      moveEntityToward(sim.player, mob, RUN_SPEED * DT);
      sim.tick();
      if (mob.aiState === 'attack') break;
    }

    expect(mob.aiState).toBe('attack');
    expect(mob.hp).toBeLessThan(mob.maxHp);
    expect(mob.hasFled).toBe(true);
  });

  it('re-engages instead of evade-resetting when fleeing reaches the leash edge', () => {
    const sim = makeSim();
    const mob = wildMobs(sim)[0];
    engageLowHp(sim, mob, 'gravecaller_cultist', 0.1);
    mob.leashAnchor = { x: mob.pos.x - 44.9, z: mob.pos.z, y: mob.pos.y };
    sim.player.pos = { x: mob.pos.x - 20, z: mob.pos.z, y: mob.pos.y };

    sim.tick();
    expect(mob.aiState).toBe('flee');

    sim.tick();

    expect(mob.aiState).toBe('chase');
    expect(mob.hp).toBeLessThan(mob.maxHp);
    expect(mob.hasFled).toBe(true);

    sim.tick();

    expect(mob.aiState).not.toBe('evade');
    expect(mob.hp).toBeLessThan(mob.maxHp);
  });

  it('runs to the first local same-family ally it reaches, then turns back to re-engage WITH it', () => {
    const sim = makeSim();
    const mobs = wildMobs(sim);
    const fleer = mobs[0];
    const ally = mobs.find((m) => m.id !== fleer.id)!;
    engageLowHp(sim, fleer, 'gravecaller_cultist', 0.12);
    // Park the player far away (-x) so the idle ally cannot detect it on its own
    // (idle proximity aggro reaches at most 20yd). That isolates the flee path: only
    // the flee rally can pull the ally. The fleer runs the opposite way (+x).
    sim.player.pos = { x: fleer.pos.x - 200, z: fleer.pos.z, y: fleer.pos.y };
    sim.player.prevPos = { ...sim.player.pos };
    // an idle same-family ally a couple of yards down the escape lane: the fleer comes
    // within the 5yd social radius of it almost as soon as it starts running.
    ally.templateId = 'gravecaller_cultist';
    ally.hostile = true;
    ally.dead = false;
    ally.aiState = 'idle';
    ally.aggroTargetId = null;
    ally.pos = { x: fleer.pos.x + 2, z: fleer.pos.z, y: fleer.pos.y };
    ally.prevPos = { ...ally.pos };
    ally.spawnPos = { ...ally.pos };

    // The fleer enters flee, runs out, reaches the ally and rallies it.
    for (let i = 0; i < 40 && sim.entities.get(ally.id)!.aiState === 'idle'; i++) sim.tick();

    // The ally joined the fight (re-engages the attacker), and the fleer turned back to
    // fight again WITH it rather than running out the whole flee window alone.
    expect(sim.entities.get(ally.id)!.aggroTargetId).toBe(sim.playerId);
    expect(sim.entities.get(ally.id)!.aiState).toBe('chase');
    expect(sim.entities.get(fleer.id)!.aiState).not.toBe('flee');
  });

  it('does NOT chain the whole lane: first contact ends the flee, allies further down stay idle', () => {
    const sim = makeSim();
    const mobs = wildMobs(sim);
    const fleer = mobs[0];
    engageLowHp(sim, fleer, 'gravecaller_cultist', 0.12);
    // Park the player far away (-x); the fleer runs the opposite way (+x) down a lane.
    // Isolates the rally from idle proximity aggro (which reaches at most 20yd).
    sim.player.pos = { x: fleer.pos.x - 200, z: fleer.pos.z, y: fleer.pos.y };
    sim.player.prevPos = { ...sim.player.pos };
    const near = mobs[1];
    const far = mobs[2];
    // `near` sits a few yards down the lane: the fleer reaches it, rallies it, and turns
    // back toward the player. `far` is well beyond that first contact. Because the flee
    // ENDS on first contact (the fleer heads back the way it came), `far` is never
    // reached, so it stays idle. That is the no-chain guarantee: one local cluster, not
    // the whole pack.
    for (const [m, dx] of [
      [near, 6],
      [far, 40],
    ] as const) {
      m.templateId = 'gravecaller_cultist';
      m.hostile = true;
      m.dead = false;
      m.aiState = 'idle';
      m.aggroTargetId = null;
      m.pos = { x: fleer.pos.x + dx, z: fleer.pos.z, y: fleer.pos.y };
      m.prevPos = { ...m.pos };
      m.spawnPos = { ...m.pos };
    }

    for (let i = 0; i < 40 && sim.entities.get(near.id)!.aiState === 'idle'; i++) sim.tick();

    expect(sim.entities.get(near.id)!.aiState).toBe('chase');
    expect(sim.entities.get(far.id)!.aiState).toBe('idle');
    expect(sim.entities.get(far.id)!.aggroTargetId).toBe(null);
  });

  it('recovers its nerve after the flee window and re-engages', () => {
    const sim = makeSim();
    const mob = wildMobs(sim)[0];
    engageLowHp(sim, mob, 'gravecaller_cultist', 0.1);
    // keep the player on top of the mob so it never outruns the leash
    sim.tick();
    expect(mob.aiState).toBe('flee');

    for (let i = 0; i < 200; i++) {
      sim.player.pos = { ...mob.pos }; // shadow it so it stays leashed
      sim.tick();
      if (mob.aiState === 'attack') break;
    }
    expect(mob.aiState).toBe('attack');
  });

  it('flees only once per pull', () => {
    const sim = makeSim();
    const mob = wildMobs(sim)[0];
    engageLowHp(sim, mob, 'gravecaller_cultist', 0.1);
    sim.tick();
    expect(mob.aiState).toBe('flee');

    // force it back to fighting, then drop it low again — it must NOT flee a 2nd time
    mob.aiState = 'attack';
    mob.fleeTimer = 0;
    mob.hp = Math.round(mob.maxHp * 0.05);
    sim.player.pos = { ...mob.pos };
    sim.tick();

    expect(mob.aiState).not.toBe('flee');
  });
});

describe('brave mobs never flee', () => {
  it('a low-HP beast fights to the death', () => {
    const sim = makeSim();
    const mob = wildMobs(sim)[0];
    engageLowHp(sim, mob, 'forest_wolf', 0.05);

    sim.tick();

    expect(sim.entities.get(mob.id)!.aiState).not.toBe('flee');
  });

  it('an elite humanoid does not flee', () => {
    const sim = makeSim();
    const mob = wildMobs(sim)[0];
    engageLowHp(sim, mob, 'tidebound_acolyte', 0.05); // humanoid, elite

    sim.tick();

    expect(sim.entities.get(mob.id)!.aiState).not.toBe('flee');
  });
});
