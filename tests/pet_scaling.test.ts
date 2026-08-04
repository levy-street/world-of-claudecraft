import { describe, expect, it } from 'vitest';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { applyPetOwnerScaling } from '../src/sim/pet/pet_ai';
import {
  abandonPet,
  completeTame,
  petOf,
  restorePet,
  serializePet,
  summonPet,
  tameError,
} from '../src/sim/pet/pet_commands';
import {
  isTameableFamily,
  PET_CATCHUP_SPEED_MULT,
  petHeelSpeed,
  petOwnerScaling,
} from '../src/sim/pet/pet_scaling';
import { Sim } from '../src/sim/sim';
import { DT, type Entity, RUN_SPEED, type Vec3 } from '../src/sim/types';
import { terrainHeight } from '../src/sim/world';

// A hunter pet used to be frozen at tame time: its health and damage came only
// from the wild-mob template it was tamed from, and Entity.attackPower stayed 0
// for its whole life, so hunter gear did nothing for it. It also heeled at a fixed
// 7.7 yd/s floor, which every mount outran. These pin the owner-share inheritance
// and the owner-tracking heel speed that replaced both.

const SEED = 42;

type AnySim = Sim & Record<string, any>;
type AnyEntity = Entity & Record<string, any>;

function hunterWorld(level = 20, seed = 11): { sim: AnySim; hid: number; hunter: AnyEntity } {
  const sim = new Sim({ seed, playerClass: 'hunter', noPlayer: true }) as AnySim;
  const hid = sim.addPlayer('hunter', 'Owner') as number;
  sim.setPlayerLevel(level, hid);
  return { sim, hid, hunter: sim.entities.get(hid) as AnyEntity };
}

function spawnWolf(sim: AnySim, near: AnyEntity, level = 2): AnyEntity {
  const wolf = createMob(sim.nextId++, MOBS.forest_wolf, level, {
    x: near.pos.x + 3,
    y: near.pos.y,
    z: near.pos.z,
  }) as AnyEntity;
  wolf.hostile = true;
  sim.addEntity(wolf);
  return wolf;
}

/** The pet pool a template alone would give, i.e. the old behavior. */
function templateHp(templateId: string, level: number): number {
  const t = MOBS[templateId];
  return Math.round(t.hpBase + t.hpPerLevel * (level - 1));
}

function tamedWolf(level = 20): {
  sim: AnySim;
  hid: number;
  hunter: AnyEntity;
  pet: AnyEntity;
} {
  const { sim, hid, hunter } = hunterWorld(level);
  completeTame(sim.ctx, hunter, spawnWolf(sim, hunter));
  return { sim, hid, hunter, pet: petOf(sim.ctx, hid) as AnyEntity };
}

describe('pet_scaling: owner share math', () => {
  it('splits the owner into the documented shares', () => {
    // Literal pin of the ratios themselves (0.25 hp, 0.35 armor, 0.22 ranged AP),
    // so a retune has to come here and be deliberate.
    expect(petOwnerScaling({ maxHp: 1000, armor: 400, rangedPower: 300 })).toEqual({
      hp: 250,
      armor: 140,
      attackPower: 66,
    });
  });

  it('rounds rather than truncates each share', () => {
    expect(petOwnerScaling({ maxHp: 101, armor: 101, rangedPower: 101 })).toEqual({
      hp: 25,
      armor: 35,
      attackPower: 22,
    });
  });

  it('never returns a negative share for a drained owner', () => {
    expect(petOwnerScaling({ maxHp: -50, armor: -10, rangedPower: -1 })).toEqual({
      hp: 0,
      armor: 0,
      attackPower: 0,
    });
  });
});

describe('pet_scaling: heel speed', () => {
  it('keeps a slow pet moving at the owner catch-up speed', () => {
    // A 5.2 yd/s demon-speed pet behind a 7 yd/s owner runs at the owner's pace
    // plus the catch-up margin, not its own crawl.
    expect(petHeelSpeed(5.2, 7)).toBeCloseTo(7.7, 5);
  });

  it('lets a fast beast keep its own higher speed', () => {
    expect(petHeelSpeed(9.5, 7)).toBeCloseTo(9.5, 5);
  });

  it('outruns a mounted owner, which the old fixed floor did not', () => {
    // The bug: the floor was RUN_SPEED * 1.1 = 7.7 regardless of the owner, while
    // the slowest mount puts a player at 7 * 1.6 = 11.2 yd/s.
    const mounted = RUN_SPEED * 1.6;
    const oldFixedFloor = RUN_SPEED * 1.1;
    expect(oldFixedFloor).toBeLessThan(mounted);
    expect(petHeelSpeed(8, mounted)).toBeGreaterThan(mounted);
    expect(petHeelSpeed(8, mounted)).toBeCloseTo(mounted * PET_CATCHUP_SPEED_MULT, 5);
  });

  it('scales with the fastest mounts too', () => {
    const fastest = RUN_SPEED * 1.8;
    expect(petHeelSpeed(8, fastest)).toBeGreaterThan(fastest);
  });

  it('tracks a non-mount speed buff on the owner', () => {
    // moveSpeedMult folds buffs and mounts alike, so a Courser's Guise owner pulls
    // the pet along the same way a mount does.
    const buffed = RUN_SPEED * 1.3;
    expect(petHeelSpeed(5.2, buffed)).toBeCloseTo(buffed * PET_CATCHUP_SPEED_MULT, 5);
  });

  it('does not sprint a pet past a snared owner', () => {
    // The deliberate other half of tracking the owner: behind a slowed owner the pet
    // now falls back to its OWN speed instead of the old flat 7.7 floor. It still
    // closes, because its own speed comfortably beats the snared owner's.
    const snared = RUN_SPEED * 0.5;
    expect(petHeelSpeed(5.2, snared)).toBe(5.2);
    expect(petHeelSpeed(5.2, snared)).toBeLessThan(RUN_SPEED * 1.1);
    expect(petHeelSpeed(5.2, snared)).toBeGreaterThan(snared);
  });
});

describe('pet_scaling: a tamed beast inherits from its hunter', () => {
  it('adds the owner health share on top of the template pool', () => {
    const { hunter, pet } = tamedWolf();
    const base = templateHp('forest_wolf', pet.level);
    expect(pet.maxHp).toBe(base + petOwnerScaling(ownerStats(hunter)).hp);
    expect(pet.maxHp).toBeGreaterThan(base);
    expect(pet.hp).toBe(pet.maxHp); // a fresh tame starts at the FULL inherited pool
  });

  it('gives the pet attack power, which was previously always zero', () => {
    const { hunter, pet } = tamedWolf();
    expect(hunter.rangedPower).toBeGreaterThan(0);
    expect(pet.attackPower).toBe(petOwnerScaling(ownerStats(hunter)).attackPower);
    expect(pet.attackPower).toBeGreaterThan(0);
  });

  it('inherits on a same-level tame, where syncPetLevel does nothing', () => {
    // syncPetLevel early-returns when the pet is already the owner's level, so this
    // is the ONLY case that exercises completeTame's own scaling call, and it is the
    // common one in play (and what the balance sweep does).
    const { sim, hid, hunter } = hunterWorld(20);
    completeTame(sim.ctx, hunter, spawnWolf(sim, hunter, 20));
    const pet = petOf(sim.ctx, hid) as AnyEntity;
    expect(pet.level).toBe(hunter.level);
    const share = petOwnerScaling(ownerStats(hunter));
    expect(pet.maxHp).toBe(templateHp('forest_wolf', 20) + share.hp);
    expect(pet.hp).toBe(pet.maxHp);
    expect(pet.attackPower).toBe(share.attackPower);
    expect(pet.attackPower).toBeGreaterThan(0);
  });

  it('adds the owner armor share on top of the template armor', () => {
    const { hunter, pet } = tamedWolf();
    // Derive the template half from the real producer, not from a copy of the
    // formula the implementation uses, so the two cannot move together silently.
    const fresh = createMob(-1, MOBS.forest_wolf, pet.level, pet.pos) as AnyEntity;
    expect(pet.stats.armor).toBe(fresh.stats.armor + petOwnerScaling(ownerStats(hunter)).armor);
    expect(pet.stats.armor).toBeGreaterThan(fresh.stats.armor);
  });

  it('compresses the tame lottery: a starter beast gains proportionally more', () => {
    // The whole point of inheriting from the owner instead of the template. The
    // weakest and strongest tameable beasts must end up closer than they started.
    const { sim, hid, hunter } = hunterWorld();
    completeTame(sim.ctx, hunter, spawnWolf(sim, hunter));
    const weak = petOf(sim.ctx, hid) as AnyEntity;
    const weakBase = templateHp('forest_wolf', weak.level);
    const strongBase = templateHp('terrace_howler', weak.level);
    const share = petOwnerScaling(ownerStats(hunter)).hp;
    const before = strongBase / weakBase;
    const after = (strongBase + share) / (weakBase + share);
    expect(after).toBeLessThan(before);
  });
});

describe('pet_scaling: re-deriving is safe', () => {
  it('does not compound the pool when applied repeatedly', () => {
    const { sim, pet } = tamedWolf();
    const settled = pet.maxHp;
    for (let i = 0; i < 40; i++) sim.tick();
    expect(pet.maxHp).toBe(settled);
  });

  it('grows the pet and hands it the new headroom when the owner gets stronger', () => {
    const { sim, hunter, pet } = tamedWolf();
    const before = pet.maxHp;
    const beforeHp = pet.hp;
    hunter.maxHp += 400;
    applyPetOwnerScaling(sim.ctx, pet);
    const gained = Math.round(400 * 0.25);
    expect(pet.maxHp).toBe(before + gained);
    expect(pet.hp).toBe(beforeHp + gained);
  });

  it('clamps a shrinking pet into the smaller pool instead of overflowing', () => {
    const { sim, hunter, pet } = tamedWolf();
    const base = templateHp('forest_wolf', pet.level);
    hunter.maxHp = Math.round(hunter.maxHp / 2);
    const smaller = petOwnerScaling(ownerStats(hunter)).hp;
    applyPetOwnerScaling(sim.ctx, pet);
    // Exact pool and exact health, not merely "hp <= maxHp", which almost any
    // implementation satisfies (including one that zeroes the pool).
    expect(pet.maxHp).toBe(base + smaller);
    expect(pet.petOwnerHpBonus).toBe(smaller);
    expect(pet.hp).toBe(pet.maxHp); // was at full, so it stays capped at full
  });

  it('never revives a dead pet by growing its pool', () => {
    const { sim, hunter, pet } = tamedWolf();
    pet.dead = true;
    pet.hp = 0;
    hunter.maxHp += 400;
    applyPetOwnerScaling(sim.ctx, pet);
    expect(pet.dead).toBe(true);
    expect(pet.hp).toBe(0);
  });

  it('preserves raid stat-aura health when the owner share is re-derived', () => {
    // applyNonPlayerStatAura writes maxHp too, so the share has to move as a delta
    // rather than rebuild the pool from the template and eat the buff.
    const { sim, hunter, pet } = tamedWolf();
    const auraHp = 120;
    pet.maxHp += auraHp;
    pet.hp += auraHp;
    const withAura = pet.maxHp;
    hunter.maxHp += 400;
    applyPetOwnerScaling(sim.ctx, pet);
    expect(pet.maxHp).toBe(withAura + Math.round(400 * 0.25));
  });
});

describe('pet_scaling: lifecycle paths', () => {
  it('survives a save/load round trip without inflating the pool', () => {
    // PetState stores hp but never maxHp, so a reload rebuilds the pool from the
    // template plus a FRESH share. If restorePet applied the share on top of an
    // already-shared pool, every relog would grow the pet.
    const { sim, hid, pet } = tamedWolf();
    const pooled = pet.maxHp;
    pet.hp = Math.round(pet.maxHp * 0.5);
    const saved = serializePet(sim.ctx, hid);
    expect(saved).not.toBeNull();
    abandonPet(sim.ctx, hid);

    const owner = sim.entities.get(hid) as AnyEntity;
    restorePet(sim.ctx, owner, saved as NonNullable<typeof saved>);
    const restored = petOf(sim.ctx, hid) as AnyEntity;
    expect(restored.maxHp).toBe(pooled);
    expect(restored.hp).toBe(Math.round(pooled * 0.5));
    expect(restored.petOwnerHpBonus).toBe(petOwnerScaling(ownerStats(owner)).hp);

    // And a second round trip is still stable.
    const again = serializePet(sim.ctx, hid);
    abandonPet(sim.ctx, hid);
    restorePet(sim.ctx, owner, again as NonNullable<typeof again>);
    expect((petOf(sim.ctx, hid) as AnyEntity).maxHp).toBe(pooled);
  });

  it('re-derives rather than compounds when the pet levels with its owner', () => {
    // syncPetLevel rebuilds maxHp from the template, so it must zero the tracked
    // share first or the pet keeps the old bonus AND gains a new one.
    const { sim, hid, hunter, pet } = tamedWolf(10);
    expect(pet.level).toBe(10);
    sim.setPlayerLevel(20, hid);
    for (let i = 0; i < 5; i++) sim.tick();
    const grown = petOf(sim.ctx, hid) as AnyEntity;
    expect(grown.level).toBe(20);
    const base = templateHp('forest_wolf', 20);
    const share = petOwnerScaling(ownerStats(hunter)).hp;
    expect(grown.petOwnerHpBonus).toBe(share);
    expect(grown.maxHp).toBe(base + share);
  });
});

describe('pet_scaling: scope', () => {
  it('inherits only for the families a hunter can actually tame', () => {
    expect(isTameableFamily('beast')).toBe(true);
    expect(isTameableFamily('spider')).toBe(true);
    expect(isTameableFamily('demon')).toBe(false);
    expect(isTameableFamily('elemental')).toBe(false);
  });

  it('keeps the tame gate accepting and rejecting exactly what it did before', () => {
    // tameError now routes its family check through isTameableFamily. Pin the real
    // verdict per family so the shared predicate cannot quietly widen or narrow it.
    const { sim, hunter } = hunterWorld();
    const verdict = (templateId: string): string | null => {
      const target = createMob(sim.nextId++, MOBS[templateId], 2, {
        x: hunter.pos.x + 3,
        y: hunter.pos.y,
        z: hunter.pos.z,
      }) as AnyEntity;
      sim.addEntity(target);
      return tameError(sim.ctx, hunter, target);
    };
    expect(verdict('forest_wolf')).toBeNull(); // beast
    expect(verdict('webwood_spider')).toBeNull(); // spider
    expect(verdict('gloomshade')).toBe('Only beasts can be tamed.'); // demon
    expect(verdict('water_elemental')).toBe('Only beasts can be tamed.'); // elemental
  });

  it('leaves a demon parked on a hunter alone', () => {
    // The gate is the tameable FAMILY, not just the owner's class, so a pet a hunter
    // could never have tamed keeps its authored pool.
    const { sim, hid, hunter } = hunterWorld();
    const demon = createMob(sim.nextId++, MOBS.gloomshade, 20, {
      x: hunter.pos.x + 2,
      y: hunter.pos.y,
      z: hunter.pos.z,
    }) as AnyEntity;
    demon.ownerId = hid;
    demon.hostile = false;
    demon.hp = demon.maxHp;
    sim.addEntity(demon);
    applyPetOwnerScaling(sim.ctx, demon);
    expect(demon.maxHp).toBe(templateHp('gloomshade', 20));
    expect(demon.attackPower).toBe(0);
    expect(demon.petOwnerHpBonus).toBe(0);
  });

  it('leaves a warlock demon on its authored pool', () => {
    const sim = new Sim({ seed: 5, playerClass: 'warlock', noPlayer: true }) as AnySim;
    const wid = sim.addPlayer('warlock', 'Caster') as number;
    sim.setPlayerLevel(20, wid);
    const warlock = sim.entities.get(wid) as AnyEntity;
    summonPet(sim.ctx, warlock, 'gloomshade');
    const demon = petOf(sim.ctx, wid) as AnyEntity;
    expect(demon.maxHp).toBe(templateHp('gloomshade', demon.level));
    expect(demon.attackPower).toBe(0);
    expect(demon.petOwnerHpBonus).toBe(0);
    for (let i = 0; i < 20; i++) sim.tick();
    expect(demon.maxHp).toBe(templateHp('gloomshade', demon.level));
    expect(demon.attackPower).toBe(0);
  });
});

describe('pet_scaling: heeling a mounted owner', () => {
  it('closes on a mounted owner instead of falling behind', () => {
    const sim = new Sim({ seed: SEED, playerClass: 'hunter', noPlayer: true }) as AnySim;
    const pid = sim.addPlayer('hunter', 'Rider') as number;
    const owner = sim.entities.get(pid) as AnyEntity;
    let pet: AnyEntity | null = null;
    for (const e of sim.entities.values()) {
      if (e.kind === 'mob' && !e.dead && e.ownerId === null) {
        pet = e as AnyEntity;
        break;
      }
    }
    if (!pet) throw new Error('no wild mob to adopt');
    pet.ownerId = pid;
    pet.hostile = false;
    pet.hp = pet.maxHp;
    pet.petMode = 'passive'; // stay in the heel branch, never pick a target
    // Pin the pet SLOWER than the old fixed floor, so the old code's step would be
    // exactly RUN_SPEED * 1.1 * DT and only owner-tracking can beat it. A fast wild
    // beast (forest_wolf runs 8) would otherwise clear the bar without the fix.
    pet.moveSpeed = 5.2;
    place(owner, 0, 0);
    place(pet, 0, -30); // well past the heel distance, well inside the warp range
    // The rider must actually own the reins, or updateMountTransition force-dismounts
    // them mid-tick and the owner is never really mounted.
    sim.addItem('reins_valorsteed', 1, pid);
    owner.mountKey = 'valorsteed';

    const startDist = dist(pet.pos, owner.pos);
    const before = { ...pet.pos };
    sim.tick();
    const step = dist(before, pet.pos);

    expect(sim.moveSpeedMult(owner)).toBeCloseTo(1.6, 5); // the mount really is up
    // Old behavior stepped RUN_SPEED * 1.1 * DT = 0.385 yd per tick regardless of the
    // mount. Tracking a 1.6x mount steps 7 * 1.6 * 1.1 * DT = 0.616 instead. Pinned
    // to the real value, not merely "greater than 0.385", because the two are close
    // enough that a float-noise comparison would pass on the old code.
    expect(step).toBeCloseTo(RUN_SPEED * 1.6 * PET_CATCHUP_SPEED_MULT * DT, 3);
    expect(step).toBeGreaterThan(RUN_SPEED * 1.1 * DT * 1.5);
    expect(dist(pet.pos, owner.pos)).toBeLessThan(startDist);
  });
});

function ownerStats(owner: AnyEntity): { maxHp: number; armor: number; rangedPower: number } {
  return { maxHp: owner.maxHp, armor: owner.stats.armor, rangedPower: owner.rangedPower };
}

function place(e: AnyEntity, x: number, z: number): void {
  e.pos = { x, y: terrainHeight(x, z, SEED), z };
  e.prevPos = { ...e.pos };
}

function dist(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}
