// A resurrected owner gets their pet back.
//
// A pet does not outlive its owner: the handleDeath player arm routes the owner's
// living pet into handleDeath too, so a hunter's beast and a mage's elemental are
// left as corpses and a warlock's demon unravels seconds later. Nothing undid
// that. Every way back to life (the corpse run, the Spirit Healer, the /unstuck
// graveyard revive) stood the OWNER up alone and left them owing a Revive Pet
// cast, or a fresh summon with its cost and cooldown, for a death the
// resurrection had just undone.
//
// src/sim/pet/pet_owner_revive.ts closes that round trip on top of the shared
// src/sim/pet/pet_return.ts core. These tests drive the real Sim end to end,
// across all three pet classes (each arm of the restore) and each revive path,
// and pin the guards that keep it from becoming a free pet.

import { describe, expect, it } from 'vitest';
import { BUILTIN_WORLD } from '../src/sim/data';
import {
  abandonPet,
  PET_REVIVE_HP_FRACTION,
  restorePet,
  summonPet,
} from '../src/sim/pet/pet_commands';
import type { Sim as SimType } from '../src/sim/sim';
import { Sim } from '../src/sim/sim';
import { moveToGraveyardForUnstuck, reviveAtGraveyardForUnstuck } from '../src/sim/spirit';
import { dist2d, type Entity, type WorldContent } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';

type AnySim = SimType & Record<string, any>;

// The same stripped world the arena suites use: nothing here reads ambient
// content, and empty camps keep each tick cheap. services (graveyards + their
// Spirit Healers) is deliberately kept, since the death loop needs it.
const TEST_WORLD: WorldContent = {
  ...BUILTIN_WORLD,
  camps: [],
  npcs: {},
  groundObjects: [],
};

const BEAST_TEMPLATE = 'wild_boar';
const ELEMENTAL_TEMPLATE = 'water_elemental';
const DEMON_TEMPLATE = 'emberkin';

function makeWorld(): AnySim {
  return new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true, world: TEST_WORLD }) as AnySim;
}

function teleport(sim: AnySim, pid: number, x: number, z: number): void {
  const e = sim.entities.get(pid)!;
  e.pos.x = x;
  e.pos.z = z;
  e.pos.y = groundHeight(x, z, sim.cfg.seed);
  e.prevPos = { ...e.pos };
  sim.rebucket(e);
}

// A hunter's beast, through the ordinary load path, so it is a real owned entity
// with no taming or camp setup in this stripped world.
function giveBeast(sim: AnySim, pid: number, hp = 40): Entity {
  const owner = sim.entities.get(pid)!;
  restorePet(sim.ctx, owner, {
    templateId: BEAST_TEMPLATE,
    name: 'Rip',
    level: owner.level,
    hp,
    dead: false,
    mode: 'defensive',
  });
  return sim.petOf(pid, true)!;
}

// A summoned pet (mage elemental, warlock demon) through the ordinary summon path.
function giveSummon(sim: AnySim, pid: number, templateId: string): Entity {
  summonPet(sim.ctx, sim.entities.get(pid)!, templateId);
  return sim.petOf(pid)!;
}

function kill(sim: AnySim, e: Entity): void {
  sim.dealDamage(null, e, e.maxHp + 100, false, 'physical', null, 'hit', true);
}

// Set an owner up at level 12 with a pet, out in the open world.
function ownerWithPet(
  cls: 'hunter' | 'mage' | 'warlock',
  petHp = 40,
): {
  sim: AnySim;
  pid: number;
  owner: Entity;
  pet: Entity;
} {
  const sim = makeWorld();
  const pid = sim.addPlayer(cls, 'Owner') as number;
  sim.setPlayerLevel(12, pid);
  teleport(sim, pid, 0, -40);
  const owner = sim.entities.get(pid)!;
  const pet =
    cls === 'hunter'
      ? giveBeast(sim, pid, petHp)
      : giveSummon(sim, pid, cls === 'mage' ? ELEMENTAL_TEMPLATE : DEMON_TEMPLATE);
  if (cls !== 'hunter') pet.hp = petHp;
  return { sim, pid, owner, pet };
}

// Walk the ghost back to within CORPSE_REZ_RANGE of its body and resurrect there.
function runBackAndResurrect(sim: AnySim, pid: number): void {
  const owner = sim.entities.get(pid)!;
  const corpse = owner.corpsePos!;
  owner.pos = { ...corpse };
  owner.prevPos = { ...owner.pos };
  sim.rebucket(owner);
  sim.resurrectAtCorpse(pid);
}

const revivedHp = (pet: Entity): number =>
  Math.max(1, Math.min(pet.maxHp, Math.round(pet.maxHp * PET_REVIVE_HP_FRACTION)));

describe('a resurrected owner gets the pet their death took', () => {
  it('revives a hunter beast IN PLACE on the corpse run, at a Revive Pet share', () => {
    const { sim, pid, owner, pet } = ownerWithPet('hunter', 3);
    const petId = pet.id;

    kill(sim, owner);
    expect(pet.dead).toBe(true);

    // Releasing is not a resurrection: the spirit rises, the beast stays down.
    sim.releaseSpirit(pid);
    expect(owner.ghost).toBe(true);
    expect(pet.dead).toBe(true);

    runBackAndResurrect(sim, pid);
    expect(owner.dead).toBe(false);

    // Same entity: the beast keeps its corpse, so it is stood back up, not rebuilt.
    const back = sim.petOf(pid)!;
    expect(back.id).toBe(petId);
    expect(back.dead).toBe(false);
    expect(back.hp).toBe(revivedHp(back));
    // Decisively not "whatever it was carrying" (3) and not a free full heal.
    expect(back.hp).toBeGreaterThan(3);
    expect(back.hp).toBeLessThan(back.maxHp);
    expect(back.aiState).toBe('idle');
    expect(back.corpseTimer).toBe(0);
    expect(dist2d(back.pos, owner.pos)).toBeLessThan(4);
  });

  it('revives a mage water elemental IN PLACE at the Spirit Healer', () => {
    const { sim, pid, owner, pet } = ownerWithPet('mage', 5);
    const petId = pet.id;

    kill(sim, owner);
    expect(pet.dead).toBe(true);
    // An elemental is not a demon: its corpse never unravels, so it is the
    // in-place arm even after a long wait.
    for (let i = 0; i < 20 * 10; i++) sim.tick();
    expect(sim.entities.has(petId)).toBe(true);

    // Release puts the ghost on the graveyard, where the angel already hovers.
    sim.releaseSpirit(pid);
    expect(sim.resurrectAtSpiritHealer(pid)).toBe(true);

    const back = sim.petOf(pid)!;
    expect(back.id).toBe(petId);
    expect(back.dead).toBe(false);
    expect(back.hp).toBe(revivedHp(back));
    expect(back.hp).toBeGreaterThan(5);
    expect(dist2d(back.pos, owner.pos)).toBeLessThan(4);
  });

  it('REBUILDS a warlock demon the unravel took, on the /unstuck graveyard revive', () => {
    const { sim, pid, owner, pet } = ownerWithPet('warlock', 30);
    const petId = pet.id;
    const petName = pet.name;

    kill(sim, owner);
    expect(pet.dead).toBe(true);
    // The demon corpse unravels within seconds: there is nothing left to revive.
    for (let i = 0; i < 20 * 5; i++) sim.tick();
    expect(sim.entities.has(petId)).toBe(false);
    expect(sim.petOf(pid, true)).toBeNull();

    sim.releaseSpirit(pid);
    reviveAtGraveyardForUnstuck(sim.ctx, pid);
    expect(owner.dead).toBe(false);

    const back = sim.petOf(pid)!;
    expect(back.id).not.toBe(petId); // rebuilt, so a NEW entity
    expect(back.templateId).toBe(DEMON_TEMPLATE);
    expect(back.name).toBe(petName);
    expect(back.dead).toBe(false);
    expect(back.hp).toBe(revivedHp(back));
    expect(back.hp).toBeLessThan(back.maxHp);
    expect(dist2d(back.pos, owner.pos)).toBeLessThan(4);
  });

  it('tells the owner their pet is back, once, in the same words Revive Pet uses', () => {
    const { sim, pid, owner, pet } = ownerWithPet('hunter');
    kill(sim, owner);
    sim.releaseSpirit(pid);
    const before = sim.tick(); // drain the release tick's events
    expect(before.some((ev: any) => ev.text?.includes('returns to your side'))).toBe(false);

    runBackAndResurrect(sim, pid);
    const events = sim.tick();
    const lines = events.filter((ev: any) => ev.type === 'log' && ev.pid === pid);
    expect(lines.filter((ev: any) => ev.text === `${pet.name} returns to your side.`)).toHaveLength(
      1,
    );
  });
});

describe('the pet return never hands back a pet the death did not take', () => {
  it('leaves a pet that was ALREADY dead before its owner fell', () => {
    const { sim, pid, owner, pet } = ownerWithPet('hunter');
    kill(sim, pet); // the beast falls first: this death is not the owner's
    expect(pet.dead).toBe(true);

    kill(sim, owner);
    sim.releaseSpirit(pid);
    runBackAndResurrect(sim, pid);

    expect(owner.dead).toBe(false);
    expect(pet.dead).toBe(true); // still owed a Revive Pet cast, exactly as before
    expect(sim.petOf(pid)).toBeNull();
  });

  it('never re-creates a corpse the owner abandoned themselves', () => {
    const { sim, pid, owner, pet } = ownerWithPet('hunter');
    kill(sim, owner);
    const petId = pet.id;
    abandonPet(sim.ctx, pid); // a deliberate part, not something the death took
    expect(sim.entities.has(petId)).toBe(false);

    sim.releaseSpirit(pid);
    runBackAndResurrect(sim, pid);

    expect(owner.dead).toBe(false);
    expect(sim.petOf(pid, true)).toBeNull();
  });

  it('never overwrites a pet the owner already has standing', () => {
    const { sim, pid, owner, pet } = ownerWithPet('warlock');
    kill(sim, owner);
    for (let i = 0; i < 20 * 5; i++) sim.tick(); // the first demon unravels
    expect(sim.entities.has(pet.id)).toBe(false);

    const resummoned = giveSummon(sim, pid, DEMON_TEMPLATE);
    const resummonedHp = resummoned.hp;

    sim.releaseSpirit(pid);
    reviveAtGraveyardForUnstuck(sim.ctx, pid);

    const live = [...sim.entities.values()].filter(
      (e: Entity) => e.kind === 'mob' && e.ownerId === pid,
    );
    expect(live).toHaveLength(1);
    expect(live[0].id).toBe(resummoned.id);
    expect(live[0].hp).toBe(resummonedHp); // untouched by the revive
  });

  it('does not revive a dead pet when /unstuck only MOVES a living owner', () => {
    const { sim, pid, owner, pet } = ownerWithPet('hunter');
    kill(sim, pet);
    expect(owner.dead).toBe(false);

    moveToGraveyardForUnstuck(sim.ctx, pid);

    expect(owner.dead).toBe(false);
    expect(pet.dead).toBe(true); // unstuck is a move, not a resurrection
  });

  it('hands the pet back only ONCE per death', () => {
    const { sim, pid, owner } = ownerWithPet('hunter');
    kill(sim, owner);
    sim.releaseSpirit(pid);
    runBackAndResurrect(sim, pid);

    const back = sim.petOf(pid)!;
    kill(sim, back); // the owner loses the beast again, on their own time
    sim.revivePlayerAt(pid, owner.pos, 1); // a second revive owes nothing
    expect(sim.petOf(pid)).toBeNull();
    expect(back.dead).toBe(true);
  });
});

describe('the pet return is deterministic', () => {
  const run = (cls: 'hunter' | 'warlock') => {
    const { sim, pid, owner } = ownerWithPet(cls);
    kill(sim, owner);
    for (let i = 0; i < 20 * 5; i++) sim.tick();
    sim.releaseSpirit(pid);
    reviveAtGraveyardForUnstuck(sim.ctx, pid);
    const pet = sim.petOf(pid);
    return {
      templateId: pet?.templateId ?? null,
      hp: pet?.hp ?? null,
      maxHp: pet?.maxHp ?? null,
      dead: pet?.dead ?? null,
    };
  };

  it('replays identically for an in-place revive and for a rebuild', () => {
    expect(run('hunter')).toEqual(run('hunter'));
    expect(run('warlock')).toEqual(run('warlock'));
    expect(run('warlock').templateId).toBe(DEMON_TEMPLATE); // the rebuild really ran
  });
});
