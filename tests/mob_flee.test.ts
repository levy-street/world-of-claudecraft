// Cowardly mobs (sentient families: humanoid/kobold/murloc/troll) panic at low HP
// instead of fighting to the death: they turn and run from their attacker for a few
// seconds, rallying nearby same-family allies, then recover their nerve. They flee
// only ONCE per pull, and elites/bosses/beasts never flee.
import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { dist2d } from '../src/sim/types';
import type { Entity } from '../src/sim/types';

function makeSim() {
  return new Sim({ seed: 42, playerClass: 'warrior', autoEquip: true });
}

function wildMobs(sim: Sim): Entity[] {
  return [...sim.entities.values()].filter((e) => e.kind === 'mob' && !e.dead && e.ownerId === null);
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
  mob.pos = { x: sim.player.pos.x + 3, z: sim.player.pos.z, y: sim.player.pos.y };
  mob.prevPos = { ...mob.pos };
  mob.spawnPos = { ...mob.pos };
  mob.leashAnchor = { ...mob.pos };
  mob.aiState = 'attack';
  mob.aggroTargetId = sim.playerId;
  mob.inCombat = true;
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

  it('calls a nearby same-family ally into the fight when it flees', () => {
    const sim = makeSim();
    const mobs = wildMobs(sim);
    const fleer = mobs[0];
    const ally = mobs.find((m) => m.id !== fleer.id)!;
    engageLowHp(sim, fleer, 'gravecaller_cultist', 0.12);
    // an idle same-family ally standing right next to the fleer
    ally.templateId = 'gravecaller_cultist';
    ally.hostile = true;
    ally.dead = false;
    ally.aiState = 'idle';
    ally.aggroTargetId = null;
    ally.pos = { x: fleer.pos.x + 2, z: fleer.pos.z, y: fleer.pos.y };
    ally.prevPos = { ...ally.pos };

    sim.tick();

    expect(sim.entities.get(ally.id)!.aggroTargetId).toBe(sim.playerId);
    expect(sim.entities.get(ally.id)!.aiState).toBe('chase');
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
