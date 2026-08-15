// "Keening Wail" elite mechanic: a mob with a `terrify` template field
// periodically shrieks while in melee combat, fearing every player inside its
// radius into a panicked flee. It is the fear analogue of Shuddering Stomp — timed and
// room-wide rather than on-hit like `dread` — and reuses the same `fear_incap`
// aura the player-cast Fear applies. Telegraphed: the first wail only lands one
// full interval after the fight begins, and the telegraph re-arms on evade.
import { describe, expect, it } from 'vitest';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';

function makeSim() {
  return new Sim({ seed: 42, playerClass: 'warrior', autoEquip: true });
}

// Spawn a wailing elite locked in melee on the player and return it.
function engagedWailer(sim: Sim): Entity {
  const mob = createMob(900200, MOBS.sister_nhalia, 12, { ...sim.player.pos });
  mob.spawnPos = { ...sim.player.pos }; // sit on the player: in radius, no leash
  mob.aiState = 'attack';
  mob.aggroTargetId = sim.playerId;
  mob.inCombat = true;
  (sim as any).addEntity(mob);
  return mob;
}

const fearAura = (e: Entity) =>
  e.auras.find((a) => a.id === 'fear_incap' && a.kind === 'incapacitate');

// The wail spares the boss's current aggro target (the tank), so every fear
// assertion reads a second, non-tank player standing beside the tank.
function addBystander(sim: Sim, mob: Entity): Entity {
  const id = sim.addPlayer('mage', 'Bystander');
  const bystander = sim.entities.get(id)!;
  bystander.maxHp = 5000;
  bystander.hp = 5000;
  bystander.pos = { ...mob.pos };
  return bystander;
}

describe('Keening Wail elite mechanic', () => {
  it("Sister Nhalia carries a Banshee's Wail", () => {
    expect(MOBS.sister_nhalia.terrify?.name).toBe('Keening Wail');
  });

  it('is telegraphed: a freshly spawned wailer waits one interval before its first scream', () => {
    const mob = createMob(900201, MOBS.sister_nhalia, 12, { x: 0, y: 0, z: 0 });
    expect(mob.terrifyTimer).toBe(MOBS.sister_nhalia.terrify!.every);
  });

  it('fears a player in radius when the timer elapses and resets the timer', () => {
    const sim = makeSim();
    const mob = engagedWailer(sim);
    sim.player.maxHp = 5000;
    sim.player.hp = 5000;
    const bystander = addBystander(sim, mob);
    mob.terrifyTimer = 0.001; // due now
    (sim as any).updateMob(mob);

    const aura = fearAura(bystander);
    expect(aura?.name).toBe('Keening Wail');
    expect(aura?.kind).toBe('incapacitate');
    expect(aura?.breaksOnDamage).toBe(true);
    expect(aura?.duration).toBe(MOBS.sister_nhalia.terrify!.duration); // mob source → full duration (DR is PvP-only)
    expect(Number.isFinite(aura!.value)).toBe(true); // value is the panic heading
    expect(Math.abs(aura!.value)).toBeLessThanOrEqual(Math.PI);
    expect(mob.terrifyTimer).toBeCloseTo(MOBS.sister_nhalia.terrify!.every, 5);
  });

  it('the fear aura drives the panicked flee movement', () => {
    const sim = makeSim();
    const mob = engagedWailer(sim);
    sim.player.maxHp = 5000;
    sim.player.hp = 5000;
    const bystander = addBystander(sim, mob);
    mob.terrifyTimer = 0.001;
    (sim as any).updateMob(mob);
    expect(fearAura(bystander)).toBeDefined();
    expect((sim as any).updateFearMovement(bystander)).toBe(true);
  });

  it('fears only players inside the wail radius', () => {
    const sim = makeSim();
    const mob = engagedWailer(sim);
    sim.player.maxHp = 5000;
    sim.player.hp = 5000;
    const bystander = addBystander(sim, mob);

    const farId = sim.addPlayer('mage', 'Faraway');
    const far = sim.entities.get(farId)!;
    far.maxHp = 5000;
    far.hp = 5000;
    far.pos = { ...mob.pos };
    far.pos.x += MOBS.sister_nhalia.terrify!.radius + 5;

    mob.terrifyTimer = 0.001;
    (sim as any).updateMob(mob);

    expect(fearAura(bystander)).toBeDefined(); // in radius → feared
    expect(fearAura(far)).toBeUndefined(); // out of radius → spared
  });

  it('spares the current aggro target: the tank is exempt from the wail', () => {
    const sim = makeSim();
    const mob = engagedWailer(sim);
    sim.player.maxHp = 5000;
    sim.player.hp = 5000;

    const offId = sim.addPlayer('mage', 'Bystander');
    const off = sim.entities.get(offId)!;
    off.maxHp = 5000;
    off.hp = 5000;
    off.pos = { ...mob.pos }; // in radius beside the tank

    mob.terrifyTimer = 0.001;
    (sim as any).updateMob(mob);

    expect(fearAura(sim.player)).toBeUndefined(); // the tank holds the boss: exempt
    expect(fearAura(off)).toBeDefined(); // everyone else in radius still flees
  });

  it('does not scream before the timer elapses', () => {
    const sim = makeSim();
    const mob = engagedWailer(sim);
    mob.terrifyTimer = 5; // not due yet
    (sim as any).updateMob(mob);

    expect(fearAura(sim.player)).toBeUndefined();
    expect(mob.terrifyTimer).toBeLessThan(5);
  });

  it('re-arms the telegraph delay when the mob evades home', () => {
    const sim = makeSim();
    const mob = engagedWailer(sim);
    mob.terrifyTimer = 0;
    (sim as any).resetEvadingMob(mob);
    expect(mob.terrifyTimer).toBe(MOBS.sister_nhalia.terrify!.every);
  });

  it('a normal mob without a terrify template never gains the fear', () => {
    const sim = makeSim();
    const wolf = createMob(900202, MOBS.forest_wolf, 5, { ...sim.player.pos });
    wolf.spawnPos = { ...sim.player.pos };
    wolf.aiState = 'attack';
    wolf.aggroTargetId = sim.playerId;
    wolf.inCombat = true;
    (sim as any).addEntity(wolf);
    wolf.terrifyTimer = 0.001;
    (sim as any).updateMob(wolf);

    expect(fearAura(sim.player)).toBeUndefined();
  });
});
