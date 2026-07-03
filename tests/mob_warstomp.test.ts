// "Shuddering Stomp" boss mechanic: a mob with a `stomp` template field periodically
// slams the ground while in melee combat, stunning (and optionally damaging)
// every player inside its radius. It is telegraphed — the first slam only lands
// one full interval after the fight begins — and resets on evade/respawn.
import { describe, expect, it } from 'vitest';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';

function makeSim() {
  return new Sim({ seed: 42, playerClass: 'warrior', autoEquip: true });
}

// Spawn a stomping boss locked in melee on the player and return it.
function engagedStomper(sim: Sim): Entity {
  const mob = createMob(900100, MOBS.korgath_the_bound, 20, { ...sim.player.pos });
  mob.spawnPos = { ...sim.player.pos }; // sit on the player: in melee + stomp radius, no leash
  mob.aiState = 'attack';
  mob.aggroTargetId = sim.playerId;
  mob.inCombat = true;
  (sim as any).addEntity(mob);
  return mob;
}

const stompAura = (e: Entity) => e.auras.find((a) => a.id === 'stomp_stun');

describe('Shuddering Stomp boss mechanic', () => {
  it('Korgath the Bound carries a Shuddering Stomp', () => {
    expect(MOBS.korgath_the_bound.stomp?.name).toBe('Shuddering Stomp');
  });

  it('is telegraphed: a freshly spawned stomper waits one interval before its first slam', () => {
    const sim = makeSim();
    const mob = createMob(900101, MOBS.korgath_the_bound, 20, { x: 0, y: 0, z: 0 });
    expect(mob.stompTimer).toBe(MOBS.korgath_the_bound.stomp!.every);
  });

  it('stuns a player in radius when the timer elapses and resets the timer', () => {
    const sim = makeSim();
    const mob = engagedStomper(sim);
    sim.player.maxHp = 5000;
    sim.player.hp = 5000; // survive the slam so the stun can land
    mob.stompTimer = 0.001; // due now
    (sim as any).updateMob(mob);

    const aura = stompAura(sim.player);
    expect(aura?.kind).toBe('stun');
    expect(aura?.name).toBe('Shuddering Stomp');
    expect(mob.stompTimer).toBeCloseTo(MOBS.korgath_the_bound.stomp!.every, 5);
  });

  it('damages the player when the stomp carries a damage range', () => {
    const sim = makeSim();
    const mob = engagedStomper(sim);
    sim.player.maxHp = 5000;
    sim.player.hp = 5000;
    mob.stompTimer = 0.001;
    (sim as any).updateMob(mob);

    expect(sim.player.hp).toBeLessThan(5000);
  });

  it('stuns only players inside the stomp radius', () => {
    const sim = makeSim();
    const mob = engagedStomper(sim); // boss meleeing player one, on top of them
    sim.player.maxHp = 5000;
    sim.player.hp = 5000;

    // A second player well outside the slam radius.
    const farId = sim.addPlayer('mage', 'Faraway');
    const far = sim.entities.get(farId)!;
    far.maxHp = 5000;
    far.hp = 5000;
    far.pos = { ...mob.pos };
    far.pos.x += MOBS.korgath_the_bound.stomp!.radius + 5;

    mob.stompTimer = 0.001;
    (sim as any).updateMob(mob);

    expect(stompAura(sim.player)).toBeDefined(); // in radius → stunned
    expect(stompAura(far)).toBeUndefined(); // out of radius → spared
  });

  it('does not slam before the timer elapses', () => {
    const sim = makeSim();
    const mob = engagedStomper(sim);
    mob.stompTimer = 5; // not due yet
    (sim as any).updateMob(mob);

    expect(stompAura(sim.player)).toBeUndefined();
    expect(mob.stompTimer).toBeLessThan(5);
  });

  it('re-arms the telegraph delay when the mob evades home', () => {
    const sim = makeSim();
    const mob = engagedStomper(sim);
    mob.stompTimer = 0;
    (sim as any).resetEvadingMob(mob);
    expect(mob.stompTimer).toBe(MOBS.korgath_the_bound.stomp!.every);
  });

  it('a normal mob without a stomp template never gains a stomp aura', () => {
    const sim = makeSim();
    const wolf = createMob(900102, MOBS.forest_wolf, 5, { ...sim.player.pos });
    wolf.spawnPos = { ...sim.player.pos };
    wolf.aiState = 'attack';
    wolf.aggroTargetId = sim.playerId;
    wolf.inCombat = true;
    (sim as any).addEntity(wolf);
    wolf.stompTimer = 0.001;
    (sim as any).updateMob(wolf);

    expect(stompAura(sim.player)).toBeUndefined();
  });
});
