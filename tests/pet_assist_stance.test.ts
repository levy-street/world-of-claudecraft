// The Assist pet stance (src/sim/pet/pet_assist.ts): the pet attacks only the
// owner's active target, and only once the owner has cast an ability on it. It
// never answers an enemy that attacks the owner, and switching target without
// casting stands it down.

import { describe, expect, it } from 'vitest';
import { anchorProbeInOpenField } from '../scripts/probe_anchor';
import { BUILTIN_WORLD, MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { petPickTarget, updatePet } from '../src/sim/pet/pet_ai';
import {
  expireStalePetAssistCast,
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
  const ctx = { isHostileTo: (_a: Entity, t: Entity) => t.id === enemy.id, tickCount: 0 };

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

describe('the cast record expires with its fight', () => {
  type Rec = {
    petAssistTargetId?: number | null;
    petAssistCastTick?: number;
    petAssistLiveTick?: number;
  };
  const idle = { inCombat: false, castingAbility: null };

  it('stays live while the owner is in combat or casting, however long', () => {
    const meta: Rec = { petAssistTargetId: 2, petAssistCastTick: 0 };
    expireStalePetAssistCast({ inCombat: true, castingAbility: null }, meta, 500);
    expect(meta.petAssistTargetId).toBe(2);
    expireStalePetAssistCast({ inCombat: false, castingAbility: 'aimed_shot' }, meta, 900);
    expect(meta.petAssistTargetId).toBe(2);
    expect(meta.petAssistLiveTick).toBe(900);
  });

  it('drops the record 2 sec after the last live tick, not before', () => {
    const meta: Rec = { petAssistTargetId: 2, petAssistCastTick: 0, petAssistLiveTick: 900 };
    expireStalePetAssistCast(idle, meta, 940);
    expect(meta.petAssistTargetId).toBe(2);
    expireStalePetAssistCast(idle, meta, 941);
    expect(meta.petAssistTargetId).toBeNull();
  });

  it('counts the grace from the cast when the owner was never live after it', () => {
    const meta: Rec = { petAssistTargetId: 2, petAssistCastTick: 300, petAssistLiveTick: 10 };
    expireStalePetAssistCast(idle, meta, 340);
    expect(meta.petAssistTargetId).toBe(2);
    expireStalePetAssistCast(idle, meta, 341);
    expect(meta.petAssistTargetId).toBeNull();
  });
});

// Field report (Thunzharr, the Waking Peak): a world boss resets on a wipe without
// dying and keeps its entity id, so the cast record from the last attempt let a
// plain reselect send the pet in. These run the real tick, cast and projectile path.
describe('an assisting pet across a real fight', () => {
  function fight() {
    const sim = new Sim({ seed: 4501, playerClass: 'hunter', autoEquip: true });
    sim.setPlayerLevel(20);
    sim.applyTalents({ spec: 'marksmanship', rows: {} });
    anchorProbeInOpenField(sim);
    const owner = sim.player;
    owner.facing = 0;
    owner.resource = owner.maxResource;
    const add = (id: string, dx: number, dz: number) => {
      const m = createMob(
        sim.nextId++,
        expectDefined(MOBS[id]),
        20,
        sim.groundPos(owner.pos.x + dx, owner.pos.z + dz),
      );
      sim.addEntity(m);
      return m;
    };
    const a = add('training_dummy', 0, 30);
    a.hostile = true;
    a.moveSpeed = 0;
    a.maxHp = 1e6;
    a.hp = 1e6;
    const pet = add('forest_wolf', 1, 0);
    pet.ownerId = owner.id;
    pet.hostile = false;
    pet.petMode = 'assist';
    const meta = expectDefined(sim.meta(owner.id));
    owner.targetId = a.id;
    for (let i = 0; i < 3; i++) sim.tick();
    return { sim, owner, a, pet, meta };
  }

  // Clear and reselect the target mid-fight: the pet drops it, then may take it
  // back only while the cast record still stands.
  function reselect(sim: Sim, owner: Entity, id: number): void {
    owner.targetId = null;
    sim.tick();
    owner.targetId = id;
    sim.tick();
  }

  it('keeps a cast-time opener through its flight, so a reselect mid-fight re-engages', () => {
    const { sim, owner, a, pet, meta } = fight();
    sim.castAbility('aimed_shot');
    expect(owner.castingAbility).toBe('aimed_shot');
    for (let i = 0; i < 80; i++) sim.tick();
    expect(owner.inCombat).toBe(true);
    reselect(sim, owner, a.id);
    expect(meta.petAssistTargetId).toBe(a.id);
    expect(pet.aggroTargetId).toBe(a.id);
  });

  it('keeps the record while the pet is stunned mid-fight', () => {
    const { sim, owner, a, pet, meta } = fight();
    sim.castAbility('arcane_shot');
    for (let i = 0; i < 30; i++) sim.tick();
    expect(owner.inCombat).toBe(true);
    pet.auras.push({
      id: 'test_stun',
      name: 'Test Stun',
      kind: 'stun',
      remaining: 3,
      duration: 3,
      value: 0,
      sourceId: a.id,
    } as Entity['auras'][number]);
    for (let i = 0; i < 70; i++) sim.tick();
    reselect(sim, owner, a.id);
    expect(meta.petAssistTargetId).toBe(a.id);
    expect(pet.aggroTargetId).toBe(a.id);
  });

  it('forgets the cast once the fight is over, so reselecting the same enemy does nothing', () => {
    const { sim, owner, a, pet, meta } = fight();
    sim.castAbility('arcane_shot');
    for (let i = 0; i < 30; i++) sim.tick();
    expect(meta.petAssistTargetId).toBe(a.id);

    // The fight ends (the boss resets, everyone disengages) and nobody re-casts.
    owner.autoAttack = false;
    owner.targetId = null;
    a.threat.clear();
    a.aggroTargetId = null;
    pet.aggroTargetId = null;
    for (let i = 0; i < 200; i++) sim.tick();
    expect(owner.inCombat).toBe(false);
    expect(meta.petAssistTargetId ?? null).toBeNull();

    owner.targetId = a.id;
    for (let i = 0; i < 10; i++) sim.tick();
    expect(pet.aggroTargetId).toBeNull();
  });
});
