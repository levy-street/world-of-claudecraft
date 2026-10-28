import { describe, expect, it } from 'vitest';
import { canObserveEntity } from '../server/entity_observation';
import { startAutoAttack } from '../src/sim/combat/auto_attack';
import { dropTargetsOnStealth } from '../src/sim/combat/stealth';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { petPickTarget } from '../src/sim/pet/pet_ai';
import { Sim } from '../src/sim/sim';
import {
  hiddenFromHostile,
  hostileCanSeeStealthed,
  PVP_STEALTH_DETECTION_BASE,
  PVP_STEALTH_DETECTION_CONE_DEG,
  PVP_STEALTH_DETECTION_HYSTERESIS,
  PVP_STEALTH_DETECTION_REAR_MULT,
  petCanSeeStealthedTarget,
  pvpStealthDetectionRadius,
} from '../src/sim/threat';
import type { Aura, Entity } from '../src/sim/types';

// Stealth Rework, detection cone: an enemy PLAYER or PET spots a stealthed
// player through the mob multiplier on a base of 20 yd in front of the observer
// and half that behind. Vanish and Greater Invisibility stay full escapes. The
// server snapshot filter, the sim's cast/auto-attack gates, pet sight and the
// stealth-entry target drop all apply the same rule.

type TestSim = Sim & { addEntity(entity: Entity): void; nextId: number };

function stealthAura(id = 'stealth'): Aura {
  return {
    id,
    name: 'Duskveil',
    kind: 'stealth',
    remaining: 3600,
    duration: 3600,
    value: 0.5,
    sourceId: 0,
    school: 'physical',
  };
}

// A level-20 rogue and a level-20 warrior in an active duel (hostile to each
// other). The warrior stands at the origin of the test and faces +z.
function duel(): { sim: TestSim; rogue: Entity; foe: Entity } {
  const sim = new Sim({ seed: 11, playerClass: 'rogue', autoEquip: true }) as TestSim;
  sim.setPlayerLevel(20);
  const foeId = sim.addPlayer('warrior', 'Foe');
  const d = {
    a: sim.playerId,
    b: foeId,
    state: 'active' as const,
    timer: 0,
    controlled: new Map(),
  };
  sim.ctx.duels.set(sim.playerId, d);
  sim.ctx.duels.set(foeId, d);
  const rogue = sim.player;
  const foe = sim.entities.get(foeId)!;
  foe.level = 20;
  foe.pos = { ...rogue.pos };
  foe.facing = 0; // forward is +z
  return { sim, rogue, foe };
}

function hide(rogue: Entity, id = 'stealth'): void {
  rogue.auras.push(stealthAura(id));
  rogue.stealthed = true;
}

// Place `e` at an offset (x, z) from `from`.
function placeFrom(e: Entity, from: Entity, dx: number, dz: number): void {
  e.pos = { x: from.pos.x + dx, y: from.pos.y, z: from.pos.z + dz };
}

const d2 = (a: Entity, b: Entity): number => (a.pos.x - b.pos.x) ** 2 + (a.pos.z - b.pos.z) ** 2;

describe('PvP detection radius', () => {
  it('is 5 yd inside the 45 degree cone and 2.5 yd outside it at equal level', () => {
    const { rogue, foe } = duel();
    expect(PVP_STEALTH_DETECTION_BASE).toBe(20);
    expect(PVP_STEALTH_DETECTION_REAR_MULT).toBe(0.5);
    expect(PVP_STEALTH_DETECTION_CONE_DEG).toBe(45);
    placeFrom(rogue, foe, 0, 3);
    expect(pvpStealthDetectionRadius(foe, rogue)).toBeCloseTo(5);
    placeFrom(rogue, foe, 0, -3);
    expect(pvpStealthDetectionRadius(foe, rogue)).toBeCloseTo(2.5);
    // Straight to the side is outside the cone: the flank gets the short radius.
    placeFrom(rogue, foe, 3, 0);
    expect(pvpStealthDetectionRadius(foe, rogue)).toBeCloseTo(2.5);
    // The cone edge is 22.5 degrees off the facing, on either side.
    const at = (deg: number) => {
      const r = (deg * Math.PI) / 180;
      placeFrom(rogue, foe, 3 * Math.sin(r), 3 * Math.cos(r));
      return pvpStealthDetectionRadius(foe, rogue);
    };
    expect(at(22)).toBeCloseTo(5);
    expect(at(-22)).toBeCloseTo(5);
    expect(at(23)).toBeCloseTo(2.5);
    expect(at(-23)).toBeCloseTo(2.5);
    // A flanker at 3 yd is unseen; once held, the front radius applies all round.
    hide(rogue);
    placeFrom(rogue, foe, 3, 0);
    expect(hostileCanSeeStealthed(foe, rogue)).toBe(false);
    expect(hostileCanSeeStealthed(foe, rogue, true)).toBe(true);
  });

  it('scales with the level gap through the mob multiplier', () => {
    const { rogue, foe } = duel();
    placeFrom(rogue, foe, 0, 3);
    foe.level = 23; // 0.25 + 3 * 0.08 = 0.49
    expect(pvpStealthDetectionRadius(foe, rogue)).toBeCloseTo(9.8);
    foe.level = 30; // clamped to 1.0
    expect(pvpStealthDetectionRadius(foe, rogue)).toBeCloseTo(20);
    foe.level = 15; // clamped to the 0.1 floor
    expect(pvpStealthDetectionRadius(foe, rogue)).toBeCloseTo(2);
  });

  it('sees a stealther inside the radius, not outside it, front and rear', () => {
    const { rogue, foe } = duel();
    hide(rogue);
    placeFrom(rogue, foe, 0, 4.9);
    expect(hostileCanSeeStealthed(foe, rogue)).toBe(true);
    placeFrom(rogue, foe, 0, 5.1);
    expect(hostileCanSeeStealthed(foe, rogue)).toBe(false);
    placeFrom(rogue, foe, 0, -2.4);
    expect(hostileCanSeeStealthed(foe, rogue)).toBe(true);
    placeFrom(rogue, foe, 0, -2.6);
    expect(hostileCanSeeStealthed(foe, rogue)).toBe(false);
    // Once held, the front radius plus the hysteresis applies.
    expect(PVP_STEALTH_DETECTION_HYSTERESIS).toBe(1);
    placeFrom(rogue, foe, 0, 5.5);
    expect(hostileCanSeeStealthed(foe, rogue, true)).toBe(true);
  });

  it('keeps a held stealther through a turn: the held radius ignores the arc', () => {
    const { rogue, foe } = duel();
    hide(rogue);
    placeFrom(rogue, foe, 0, -4); // behind, past the 2.5 yd rear radius
    expect(hostileCanSeeStealthed(foe, rogue)).toBe(false); // cannot SPOT it
    expect(hostileCanSeeStealthed(foe, rogue, true)).toBe(true); // but KEEPS it
    placeFrom(rogue, foe, 0, -6.5);
    expect(hostileCanSeeStealthed(foe, rogue, true)).toBe(false);
  });

  it('never sees through Vanish or Greater Invisibility, always sees the unstealthed', () => {
    const { rogue, foe } = duel();
    placeFrom(rogue, foe, 0, 1);
    expect(hostileCanSeeStealthed(foe, rogue)).toBe(true);
    hide(rogue, 'vanish');
    expect(hostileCanSeeStealthed(foe, rogue)).toBe(false);
    rogue.auras = [stealthAura('greater_invisibility')];
    expect(hostileCanSeeStealthed(foe, rogue)).toBe(false);
    rogue.auras = [stealthAura('invisibility')]; // the potion is plain stealth
    expect(hostileCanSeeStealthed(foe, rogue)).toBe(true);
  });
});

describe('server snapshot filter', () => {
  it('ships a stealthed enemy only inside the detection radius', () => {
    const { sim, rogue, foe } = duel();
    hide(rogue);
    placeFrom(rogue, foe, 0, 4);
    expect(canObserveEntity(sim, foe, rogue, d2(foe, rogue))).toBe(true);
    placeFrom(rogue, foe, 0, -4); // same distance, behind
    expect(canObserveEntity(sim, foe, rogue, d2(foe, rogue))).toBe(false);
    placeFrom(rogue, foe, 0, 30);
    expect(canObserveEntity(sim, foe, rogue, d2(foe, rogue))).toBe(false);
  });

  it('keeps an already-shipped stealther out to the hysteresis margin', () => {
    const { sim, rogue, foe } = duel();
    hide(rogue);
    placeFrom(rogue, foe, 0, 5.5);
    expect(canObserveEntity(sim, foe, rogue, d2(foe, rogue), false)).toBe(false);
    expect(canObserveEntity(sim, foe, rogue, d2(foe, rogue), true)).toBe(true);
    placeFrom(rogue, foe, 0, 6.5);
    expect(canObserveEntity(sim, foe, rogue, d2(foe, rogue), true)).toBe(false);
  });

  it('keeps shipping a known stealther the viewer turns away from', () => {
    const { sim, rogue, foe } = duel();
    hide(rogue);
    placeFrom(rogue, foe, 0, -4); // behind the viewer
    expect(canObserveEntity(sim, foe, rogue, d2(foe, rogue), false)).toBe(false);
    expect(canObserveEntity(sim, foe, rogue, d2(foe, rogue), true)).toBe(true);
  });

  it('never ships a Vanished enemy, even point blank', () => {
    const { sim, rogue, foe } = duel();
    hide(rogue, 'vanish');
    placeFrom(rogue, foe, 0, 0.5);
    expect(canObserveEntity(sim, foe, rogue, d2(foe, rogue), true)).toBe(false);
  });
});

describe('sim gates follow the same rule', () => {
  it('hiddenFromHostile allows the hysteresis margin and refuses beyond it', () => {
    const { rogue, foe } = duel();
    hide(rogue);
    placeFrom(rogue, foe, 0, 5.5);
    expect(hiddenFromHostile(foe, rogue)).toBe(false);
    placeFrom(rogue, foe, 0, 6.5);
    expect(hiddenFromHostile(foe, rogue)).toBe(true);
  });

  it('an enemy can start auto-attack on a stealther it detects, not on one it cannot', () => {
    const { sim, rogue, foe } = duel();
    hide(rogue);
    foe.targetId = rogue.id;
    placeFrom(rogue, foe, 0, 20);
    startAutoAttack(sim.ctx, foe.id);
    expect(foe.autoAttack).toBe(false);
    placeFrom(rogue, foe, 0, 2);
    startAutoAttack(sim.ctx, foe.id);
    expect(foe.autoAttack).toBe(true);
  });

  it('a running auto-attack stops once the stealther slips out of detection', () => {
    const { sim, rogue, foe } = duel();
    hide(rogue);
    foe.targetId = rogue.id;
    placeFrom(rogue, foe, 0, 2);
    startAutoAttack(sim.ctx, foe.id);
    expect(foe.autoAttack).toBe(true);
    placeFrom(rogue, foe, 0, 20);
    rogue.prevPos = { ...rogue.pos };
    sim.tick();
    expect(foe.autoAttack).toBe(false);
  });
});

describe('entering stealth drops only the enemies that lose sight', () => {
  it('a close enemy facing the caster keeps its target, a distant one drops it', () => {
    const { sim, rogue, foe } = duel();
    placeFrom(rogue, foe, 0, 3);
    foe.targetId = rogue.id;
    hide(rogue);
    dropTargetsOnStealth(sim.ctx, rogue);
    expect(foe.targetId).toBe(rogue.id);
    placeFrom(rogue, foe, 0, 15);
    dropTargetsOnStealth(sim.ctx, rogue);
    expect(foe.targetId).toBe(null);
  });

  it('never keeps a lock on a feigning stealther, however close', () => {
    const { sim, rogue, foe } = duel();
    placeFrom(rogue, foe, 0, 1);
    foe.targetId = rogue.id;
    hide(rogue);
    rogue.auras.push({ ...stealthAura('play_dead'), kind: 'feign_death' });
    dropTargetsOnStealth(sim.ctx, rogue);
    expect(foe.targetId).toBe(null);
  });

  it('a close enemy pet keeps its lock, a distant one drops it', () => {
    const { sim, rogue, foe } = duel();
    const pet = createMob(sim.nextId++, MOBS.forest_wolf, 20, { ...foe.pos });
    pet.ownerId = foe.id;
    pet.facing = 0;
    sim.addEntity(pet);
    placeFrom(rogue, pet, 0, 3);
    pet.aggroTargetId = rogue.id;
    hide(rogue);
    dropTargetsOnStealth(sim.ctx, rogue);
    expect(pet.aggroTargetId).toBe(rogue.id);
    placeFrom(rogue, pet, 0, 15);
    dropTargetsOnStealth(sim.ctx, rogue);
    expect(pet.aggroTargetId).toBe(null);
  });
});

describe('pet sight', () => {
  it('a pet sees a stealthed player in its detection radius and nothing beyond', () => {
    const { sim, rogue, foe } = duel();
    const pet = createMob(sim.nextId++, MOBS.forest_wolf, 20, { ...foe.pos });
    pet.facing = 0;
    hide(rogue);
    placeFrom(rogue, pet, 0, 3);
    expect(petCanSeeStealthedTarget(rogue, pet)).toBe(true);
    placeFrom(rogue, pet, 0, 12);
    expect(petCanSeeStealthedTarget(rogue, pet)).toBe(false);
    // Without an observing pet the answer stays the old blind one.
    expect(petCanSeeStealthedTarget(rogue)).toBe(false);
    // Play Dead is never seen, stealthed or not.
    rogue.auras = [{ ...stealthAura('play_dead'), kind: 'feign_death' }];
    placeFrom(rogue, pet, 0, 1);
    expect(petCanSeeStealthedTarget(rogue, pet)).toBe(false);
  });

  it('an aggressive pet never auto-acquires a stealthed player, even in sight', () => {
    const { sim, rogue, foe } = duel();
    const pet = createMob(sim.nextId++, MOBS.forest_wolf, 20, { ...foe.pos });
    pet.ownerId = foe.id;
    pet.hostile = false;
    pet.facing = 0;
    pet.petMode = 'aggressive';
    sim.addEntity(pet);
    const meta = sim.players.get(foe.id)!;
    meta.lastActiveTick = sim.tickCount; // an active owner: the auto-pull gate is open
    placeFrom(rogue, pet, 0, 3); // 3 yd in front: inside the pet's detection radius
    const pick = () => {
      sim.grid.refresh(sim.entities.values());
      return petPickTarget(sim.ctx, pet, foe);
    };
    // Control: the same rogue unstealthed is pulled by the aggressive stance.
    expect(pick()?.id).toBe(rogue.id);
    hide(rogue);
    expect(petCanSeeStealthedTarget(rogue, pet)).toBe(true);
    // (A wild mob in the test world may still be picked: never the rogue.)
    expect(pick()?.id).not.toBe(rogue.id);
    // Every stealth aura counts, Tactical Camo included.
    rogue.auras = [stealthAura('tactical_camo')];
    expect(pick()?.id).not.toBe(rogue.id);
    // The owner spotting and fighting the stealther still sends the pet in.
    foe.targetId = rogue.id;
    foe.inCombat = true;
    expect(pick()?.id).toBe(rogue.id);
  });
});
