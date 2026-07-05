// A wild mob retreating home after a leash break (aiState 'evade') has dropped
// its hate table and will not fight back. It must be immune to damage while it
// resets, otherwise a player can chip it down — or kill it outright — for a
// risk-free kill, which also breaks the classic reset contract.
import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';
import { dist2d } from '../src/sim/types';

function makeSim() {
  return new Sim({ seed: 42, playerClass: 'warrior', autoEquip: true });
}

function nearestMob(sim: Sim): Entity {
  let best: Entity | null = null;
  let bestD = Infinity;
  for (const e of sim.entities.values()) {
    if (e.kind !== 'mob' || e.dead || e.ownerId !== null) continue;
    const d = dist2d(sim.player.pos, e.pos);
    if (d < bestD) {
      bestD = d;
      best = e;
    }
  }
  return best!;
}

function hit(sim: Sim, source: Entity, target: Entity, amount: number) {
  (sim as any).dealDamage(source, target, amount, false, 'physical', null, 'hit', true);
}

describe('evading mobs are immune while resetting', () => {
  it('takes no damage and gains no threat from a hit while evading', () => {
    const sim = makeSim();
    const wolf = nearestMob(sim);
    wolf.maxHp = 5000;
    wolf.hp = 5000;
    wolf.aiState = 'evade';
    wolf.threat.clear();

    hit(sim, sim.player, wolf, 1000);

    expect(wolf.hp).toBe(5000);
    expect(wolf.threat.size).toBe(0);
    expect(wolf.dead).toBe(false);
  });

  it('cannot be killed while evading', () => {
    const sim = makeSim();
    const wolf = nearestMob(sim);
    wolf.maxHp = 50;
    wolf.hp = 50;
    wolf.aiState = 'evade';

    hit(sim, sim.player, wolf, 99999);

    expect(wolf.dead).toBe(false);
    expect(wolf.hp).toBe(50);
  });

  it('still takes damage normally once it is fighting again', () => {
    const sim = makeSim();
    const wolf = nearestMob(sim);
    wolf.maxHp = 5000;
    wolf.hp = 5000;
    wolf.aiState = 'attack';
    wolf.threat.clear();

    hit(sim, sim.player, wolf, 100);

    expect(wolf.hp).toBe(4900);
    expect(wolf.threat.get(sim.playerId)).toBeCloseTo(100, 5);
  });

  it('does not make an owned pet immune if stale evade state leaks onto it', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true, autoEquip: true });
    const attackerId = sim.addPlayer('warrior', 'Attacker');
    const ownerId = sim.addPlayer('hunter', 'Owner');
    const attacker = sim.entities.get(attackerId);
    if (!attacker) throw new Error('missing attacker');
    const pet = nearestMob(sim);
    pet.ownerId = ownerId;
    pet.hostile = false;
    pet.aiState = 'evade';
    pet.maxHp = 5000;
    pet.hp = 5000;

    hit(sim, attacker, pet, 1000);

    expect(pet.hp).toBe(4000);
    expect(pet.dead).toBe(false);
  });
});

// An evading mob walks a STRAIGHT line home with no pathfinding, and resolvePosition
// only pushes a body radially OUT of a collider — never around it. So an evading mob
// whose line home crosses a prop (the Gravecaller Encampment tent/campfire/crate) or
// deep water freezes at the obstacle's edge. Because evading mobs are immune, a
// permanent stall is a permanently unkillable mob — the Gravecaller Summoners that
// pinned on their own camp props and blocked progression. Once stalled, the mob
// phases through the blocker just far enough to clear it, then walks home and resets.
describe('an evading mob that cannot path home recovers instead of getting stuck', () => {
  const WORLD_SEED = 20061; // the live world seed
  const CAMP_TENT = { x: -3, z: 505, y: 0 }; // the prop the summoners pin against

  // the summoner that spawns closest to the camp tent — the one players see stuck
  function tentSummoner(sim: Sim): Entity {
    const mobs = [...sim.entities.values()].filter(
      (e) => e.kind === 'mob' && e.templateId === 'gravecaller_summoner',
    );
    return mobs.sort((a, b) => dist2d(a.spawnPos, CAMP_TENT) - dist2d(b.spawnPos, CAMP_TENT))[0];
  }

  it('frees a tent-pinned Gravecaller Summoner and makes it killable again', () => {
    const sim = new Sim({ seed: WORLD_SEED, playerClass: 'warrior', autoEquip: true });
    const mob = tentSummoner(sim);
    expect(mob).toBeTruthy();
    sim.player.pos = { x: 9999, z: 9999, y: 0 }; // out of aggro range

    const home = { ...mob.spawnPos };
    // place it on the far side of the tent from its spawn, so the straight line home
    // runs through the tent collider — exactly how a kited summoner ends up stuck.
    const dx = CAMP_TENT.x - home.x,
      dz = CAMP_TENT.z - home.z;
    const len = Math.hypot(dx, dz) || 1;
    mob.maxHp = 200;
    mob.hp = 50;
    mob.auras = [];
    mob.pos = { x: CAMP_TENT.x + (dx / len) * 2.5, z: CAMP_TENT.z + (dz / len) * 2.5, y: 0 };
    mob.prevPos = { ...mob.pos };
    mob.evadeStall = 0;
    mob.aiState = 'evade';
    mob.aggroTargetId = null;
    mob.leashAnchor = null;
    mob.threat.clear();

    // pinned at the tent on the first tick: still evading, and immune to a huge hit
    // (the anti risk-free-kill contract still holds while it resets)
    sim.tick();
    expect(sim.entities.get(mob.id)!.aiState).toBe('evade');
    hit(sim, sim.player, mob, 99999);
    expect(mob.dead).toBe(false);

    // it must free itself (phase past the tent, walk home) and reset to a clean idle
    let reset = false;
    for (let i = 0; i < 300; i++) {
      // 15s, comfortably past the stall timeout + walk
      sim.tick();
      if (sim.entities.get(mob.id)!.aiState === 'idle') {
        reset = true;
        break;
      }
    }
    expect(reset).toBe(true);
    expect(dist2d(mob.pos, home)).toBeLessThan(0.5); // back at its spawn
    expect(mob.hp).toBe(mob.maxHp); // healed, ready to be fought again
  });

  it('phases through the tent only — leaves it clear of the prop, not teleported home', () => {
    const sim = new Sim({ seed: WORLD_SEED, playerClass: 'warrior', autoEquip: true });
    const mob = tentSummoner(sim);
    sim.player.pos = { x: 9999, z: 9999, y: 0 };

    const home = { ...mob.spawnPos };
    const dx = CAMP_TENT.x - home.x,
      dz = CAMP_TENT.z - home.z;
    const len = Math.hypot(dx, dz) || 1;
    mob.maxHp = 200;
    mob.hp = 50;
    mob.auras = [];
    mob.pos = { x: CAMP_TENT.x + (dx / len) * 2.5, z: CAMP_TENT.z + (dz / len) * 2.5, y: 0 };
    mob.prevPos = { ...mob.pos };
    mob.evadeStall = 0;
    mob.aiState = 'evade';
    mob.threat.clear();

    // tick until it has left the tent's collision radius (proof it moved, not jumped)
    let maxStepSeen = 0;
    let prev = { ...mob.pos };
    for (let i = 0; i < 300; i++) {
      sim.tick();
      maxStepSeen = Math.max(maxStepSeen, dist2d(mob.pos, prev));
      prev = { ...mob.pos };
      if (sim.entities.get(mob.id)!.aiState === 'idle') break;
    }
    // it traversed in small local steps (walking + at most a collision ejection
    // out of the prop) — never a cross-map snap home like the old teleport reset
    expect(maxStepSeen).toBeLessThan(3);
  });

  it('does not disturb a normal short evade across open ground', () => {
    const sim = new Sim({ seed: WORLD_SEED, playerClass: 'warrior', autoEquip: true });
    const mob = tentSummoner(sim);
    sim.player.pos = { x: 9999, z: 9999, y: 0 };

    mob.maxHp = 200;
    mob.hp = 50;
    mob.pos = { x: mob.spawnPos.x + 20, z: mob.spawnPos.z, y: 0 }; // open land, no prop between
    mob.evadeStall = 0;
    mob.aiState = 'evade';
    mob.threat.clear();

    let reset = false;
    for (let i = 0; i < 200; i++) {
      sim.tick();
      if (sim.entities.get(mob.id)!.aiState === 'idle') {
        reset = true;
        break;
      }
    }
    expect(reset).toBe(true);
    // it walked home under its own power (no snap needed): well within ~20yd of spawn
    expect(dist2d(mob.pos, mob.spawnPos)).toBeLessThan(0.5);
  });
});
