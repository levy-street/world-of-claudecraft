// The Assist pet stance (src/sim/pet/pet_assist.ts): the pet attacks only the
// owner's active target, and only once the owner has cast an ability on it. It
// never answers an enemy that attacks the owner, and switching target without
// casting stands it down.

import { describe, expect, it } from 'vitest';
import { BUILTIN_WORLD } from '../src/sim/data';
import { petPickTarget, updatePet } from '../src/sim/pet/pet_ai';
import {
  isPetMode,
  notePetAssistCast,
  PET_MODES,
  petAssistKeepsTarget,
  petAssistTargetId,
} from '../src/sim/pet/pet_assist';
import { Sim } from '../src/sim/sim';
import type { Entity, WorldContent } from '../src/sim/types';
import { expectDefined } from './helpers/defined';

const TEST_WORLD: WorldContent = {
  ...BUILTIN_WORLD,
  camps: BUILTIN_WORLD.camps.filter((c) => c.mobId === 'forest_wolf'),
  npcs: {},
  groundObjects: [],
};

function place(e: Entity, x: number, z: number): void {
  e.pos = { x, y: e.pos.y, z };
  e.prevPos = { ...e.pos };
}

// A hunter, a wolf adopted as its pet, and two wild hostiles, everyone else far away.
function setup() {
  const sim = new Sim({ seed: 7, playerClass: 'hunter', noPlayer: true, world: TEST_WORLD });
  const pid = sim.addPlayer('hunter', 'Owner');
  const owner = expectDefined(sim.entities.get(pid));
  const wild = [...sim.entities.values()].filter(
    (e) => e.kind === 'mob' && !e.dead && e.ownerId === null,
  );
  const [pet, a, b] = [expectDefined(wild[0]), expectDefined(wild[1]), expectDefined(wild[2])];
  pet.ownerId = pid;
  pet.hostile = false;
  pet.hp = pet.maxHp;
  a.hostile = true;
  b.hostile = true;
  for (const e of sim.entities.values()) {
    if (![pid, pet.id, a.id, b.id].includes(e.id)) place(e, 5000, 5000);
  }
  place(owner, 0, 0);
  place(pet, 1, 0);
  place(a, 2, 0);
  place(b, 0, 3);
  for (const m of [a, b]) {
    m.aggroTargetId = null;
    m.threat.clear();
  }
  owner.targetId = null;
  owner.autoAttack = false;
  pet.petMode = 'assist';
  const meta = expectDefined(sim.meta(pid));
  meta.lastActiveTick = sim.tickCount;
  sim.grid.refresh(sim.entities.values());
  return { sim, pid, owner, pet, a, b, meta };
}

describe('pet stance list', () => {
  it('adds Assist after the three classic stances', () => {
    expect(PET_MODES).toEqual(['passive', 'defensive', 'aggressive', 'assist']);
    expect(isPetMode('assist')).toBe(true);
    expect(isPetMode('follow')).toBe(false);
    expect(isPetMode(undefined)).toBe(false);
  });
});

describe('the owner half: which cast an assisting pet follows', () => {
  const caster = { id: 1 } as Entity;
  const enemy = { id: 2, dead: false } as Entity;
  const ally = { id: 3, dead: false } as Entity;
  const ctx = { isHostileTo: (_a: Entity, t: Entity) => t.id === enemy.id };

  it('records a cast on an enemy, and keeps it through a friendly or self cast', () => {
    const meta: { petAssistTargetId?: number | null } = {};
    notePetAssistCast(ctx, caster, meta, enemy);
    expect(meta.petAssistTargetId).toBe(2);
    notePetAssistCast(ctx, caster, meta, ally);
    notePetAssistCast(ctx, caster, meta, caster);
    notePetAssistCast(ctx, caster, meta, null);
    expect(meta.petAssistTargetId).toBe(2);
  });

  it('hands the pet only the active target, and only when it was the one cast on', () => {
    expect(petAssistTargetId({ targetId: 2 }, { petAssistTargetId: 2 })).toBe(2);
    expect(petAssistTargetId({ targetId: 4 }, { petAssistTargetId: 2 })).toBeNull();
    expect(petAssistTargetId({ targetId: null }, { petAssistTargetId: 2 })).toBeNull();
    expect(petAssistTargetId({ targetId: 2 }, undefined)).toBeNull();
    expect(petAssistKeepsTarget({ targetId: 2 }, enemy)).toBe(true);
    expect(petAssistKeepsTarget({ targetId: 4 }, enemy)).toBe(false);
  });
});

describe('an assisting pet in the sim', () => {
  it('ignores an enemy attacking its owner, which a defensive pet would answer', () => {
    const { sim, pid, owner, pet, a } = setup();
    a.aggroTargetId = owner.id;
    a.threat.set(owner.id, 10);
    expect(petPickTarget(sim.ctx, pet, owner)).toBeNull();
    pet.petMode = 'defensive';
    expect(petPickTarget(sim.ctx, pet, owner)?.id).toBe(a.id);
    expect(pid).toBe(owner.id);
  });

  it('ignores the active target until the owner casts on it, even mid auto-attack', () => {
    const { sim, owner, pet, a } = setup();
    owner.targetId = a.id;
    owner.autoAttack = true;
    a.threat.set(owner.id, 10);
    expect(petPickTarget(sim.ctx, pet, owner)).toBeNull();
  });

  it('attacks the enemy a real cast was aimed at', () => {
    const { sim, pid, owner, pet, a, meta } = setup();
    owner.targetId = a.id;
    owner.facing = Math.atan2(a.pos.x - owner.pos.x, a.pos.z - owner.pos.z);
    sim.castAbility('raptor_strike', pid);
    expect(meta.petAssistTargetId).toBe(a.id);
    expect(petPickTarget(sim.ctx, pet, owner)?.id).toBe(a.id);
    updatePet(sim.ctx, pet);
    expect(pet.aggroTargetId).toBe(a.id);
  });

  it('stands down when the owner switches target, until they cast on the new one', () => {
    const { sim, owner, pet, a, b, meta } = setup();
    owner.targetId = a.id;
    meta.petAssistTargetId = a.id;
    updatePet(sim.ctx, pet);
    expect(pet.aggroTargetId).toBe(a.id);

    owner.targetId = b.id; // tab to b, no cast yet
    updatePet(sim.ctx, pet);
    expect(pet.aggroTargetId).toBeNull();

    meta.petAssistTargetId = b.id; // now cast on b
    updatePet(sim.ctx, pet);
    expect(pet.aggroTargetId).toBe(b.id);
  });

  it('drops a target the owner clears', () => {
    const { sim, owner, pet, a, meta } = setup();
    owner.targetId = a.id;
    meta.petAssistTargetId = a.id;
    updatePet(sim.ctx, pet);
    owner.targetId = null;
    updatePet(sim.ctx, pet);
    expect(pet.aggroTargetId).toBeNull();
  });

  it('switches stance through the command, and refuses an unknown one', () => {
    const { sim, pid, pet } = setup();
    sim.setPetMode('defensive', pid);
    expect(pet.petMode).toBe('defensive');
    sim.setPetMode('assist', pid);
    expect(pet.petMode).toBe('assist');
    sim.setPetMode('follow' as never, pid);
    expect(pet.petMode).toBe('assist');
  });
});
