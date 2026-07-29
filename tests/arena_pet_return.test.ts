// A pet that walks into an arena-shaped match alive walks back out alive.
//
// The arena return path (src/sim/social/arena.ts returnFromArena) already hands a
// fighter back the hp, resource, cooldowns, and CC DR they carried in (issue #1600)
// and stands the FIGHTER back up, but it never touched their pet: a hunter whose
// beast was killed on the sands, or dragged down by the handleDeath owner arm when
// they were eliminated, went home with a corpse and owed a Revive Pet cast for a
// death the normalized bout inflicted. src/sim/pet/pet_match_return.ts closes that
// half of the round trip; these tests drive the real Sim end to end.

import { describe, expect, it } from 'vitest';
import { BUILTIN_WORLD, DUNGEON_X_THRESHOLD } from '../src/sim/data';
import { restorePet, summonPet } from '../src/sim/pet/pet_commands';
import { snapshotMatchPet } from '../src/sim/pet/pet_match_return';
import type { Sim as SimType } from '../src/sim/sim';
import { Sim } from '../src/sim/sim';
import * as arena from '../src/sim/social/arena';
import { dist2d, type Entity, type WorldContent } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';

type AnySim = SimType & Record<string, any>;

// Same stripped world the other arena suites use: nothing here reads ambient
// content, and empty camps keep each matchmaking tick cheap.
const ARENA_TEST_WORLD: WorldContent = {
  ...BUILTIN_WORLD,
  camps: [],
  npcs: {},
  groundObjects: [],
};

const PET_TEMPLATE = 'wild_boar';
const DEMON_TEMPLATE = 'emberkin';

function makeWorld(): AnySim {
  return new Sim({
    seed: 42,
    playerClass: 'warrior',
    noPlayer: true,
    world: ARENA_TEST_WORLD,
  }) as AnySim;
}

function teleport(sim: AnySim, pid: number, x: number, z: number): void {
  const e = sim.entities.get(pid)!;
  e.pos.x = x;
  e.pos.z = z;
  e.pos.y = groundHeight(x, z, sim.cfg.seed);
  e.prevPos = { ...e.pos };
  sim.rebucket(e);
}

// Give a hunter a live pet through the ordinary load path (restorePet), so the
// beast is a real owned entity with no taming/camp setup in this stripped world.
function givePet(sim: AnySim, pid: number, dead = false): Entity {
  const owner = sim.entities.get(pid)!;
  restorePet(sim.ctx, owner, {
    templateId: PET_TEMPLATE,
    name: 'Rip',
    level: owner.level,
    hp: dead ? 0 : 40,
    dead,
    mode: 'defensive',
  });
  return sim.petOf(pid, true)!;
}

// Give a warlock a live demon through the ordinary summon path.
function giveDemon(sim: AnySim, pid: number): Entity {
  summonPet(sim.ctx, sim.entities.get(pid)!, DEMON_TEMPLATE);
  return sim.petOf(pid)!;
}

// Queue a pet class (with whatever pet state the caller set up) against one
// opponent and tick until the bout is live.
function liveBout(opts: { cls?: 'hunter' | 'warlock'; petDead?: boolean } = {}): {
  sim: AnySim;
  hunter: number;
  foe: number;
  pet: Entity;
  match: any;
} {
  const cls = opts.cls ?? 'hunter';
  const sim = makeWorld();
  const hunter = sim.addPlayer(cls, cls === 'hunter' ? 'Rexx' : 'Gulda');
  const foe = sim.addPlayer('mage', 'Bet');
  teleport(sim, hunter, 0, -40);
  teleport(sim, foe, 6, -40);
  const pet = cls === 'warlock' ? giveDemon(sim, hunter) : givePet(sim, hunter, opts.petDead);
  arena.arenaQueueJoin(sim.ctx, hunter);
  arena.arenaQueueJoin(sim.ctx, foe);
  for (let i = 0; i < 20 * 8; i++) {
    sim.tick();
    const m = arena.arenaMatchFor(sim.ctx, hunter);
    if (m && m.state === 'active') break;
  }
  return { sim, hunter, foe, pet, match: arena.arenaMatchFor(sim.ctx, hunter) };
}

describe('arena pet return: the snapshot', () => {
  it('records a living pet by entity id and carried hp, and nothing for a corpse', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('hunter', 'Rexx');
    expect(snapshotMatchPet(sim.ctx, pid)).toBeNull(); // petless fighter: nothing owed

    const pet = givePet(sim, pid);
    pet.hp = 27;
    expect(snapshotMatchPet(sim.ctx, pid)).toMatchObject({
      petId: pet.id,
      hp: 27,
      state: { templateId: PET_TEMPLATE, dead: false },
    });

    sim.ctx.handleDeath(pet, null);
    // A fighter who queues with a corpse is owed nothing, so the arena can never
    // be farmed as a free pet revive.
    expect(snapshotMatchPet(sim.ctx, pid)).toBeNull();
  });

  it('seats the snapshot on the match at formation', () => {
    const { match, hunter, foe, pet } = liveBout();
    // Snapshot is taken at formation; use the snapshotted hp (pet may regen
    // during the pre-match ticks before the bout goes active).
    const snap = match.preMatchPets.get(hunter);
    expect(snap).toMatchObject({ petId: pet.id });
    expect(snap?.hp).toBeTypeOf('number');
    expect(match.preMatchPets.has(foe)).toBe(false); // the mage has no pet
  });
});

describe('arena pet return: a beast killed on the sands', () => {
  it('stands the pet back up beside its owner, at the hp it walked in with', () => {
    const { sim, hunter, pet, match } = liveBout();
    const hpIn = match.preMatchPets.get(hunter)!.hp;
    const maxHpIn = pet.maxHp;
    // The bout kills the beast outright.
    sim.ctx.handleDeath(pet, null);
    expect(pet.dead).toBe(true);

    arena.endArenaMatch(sim.ctx, match, 'B', 'forfeit');

    const after = sim.petOf(hunter);
    expect(after).not.toBeNull();
    expect(after!.id).toBe(pet.id); // the same beast, not a replacement
    expect(after!.dead).toBe(false);
    expect(after!.aiState).toBe('idle');
    expect(after!.hp).toBe(hpIn);
    expect(after!.corpseTimer).toBe(0);
    expect(after!.lootable).toBe(false);
    // The revive must not re-run the death's stat-aura unwind: a second pass
    // would double-subtract a buff's contribution and shrink the pool.
    expect(after!.maxHp).toBe(maxHpIn);

    // Home in the world beside its owner, never left behind on the sands.
    const owner = sim.entities.get(hunter)!;
    expect(owner.pos.x).toBeLessThan(DUNGEON_X_THRESHOLD);
    expect(after!.pos.x).toBeLessThan(DUNGEON_X_THRESHOLD);
    expect(dist2d(after!.pos, owner.pos)).toBeLessThan(6);
  });

  it('survives the owner being eliminated (the pet dies with them, both come back)', () => {
    const { sim, hunter, foe, pet, match } = liveBout();
    const hpIn = match.preMatchPets.get(hunter)!.hp;
    const owner = sim.entities.get(hunter)!;
    const enemy = sim.entities.get(foe)!;
    // A real killing blow from the other side: the elimination arm marks the
    // defeat, handleDeath takes the owner's pet down with them, and the wipe ends
    // the bout on its own timer.
    sim.ctx.dealDamage(enemy, owner, owner.hp + 500, false, 'physical', 'Test Blow', 'hit');
    expect(pet.dead).toBe(true);

    for (let i = 0; i < 20 * 8; i++) {
      sim.tick();
      if (!arena.arenaMatchFor(sim.ctx, hunter)) break;
    }
    expect(arena.arenaMatchFor(sim.ctx, hunter)).toBeNull(); // the bout is over

    const after = sim.petOf(hunter);
    expect(after).not.toBeNull();
    expect(after!.id).toBe(pet.id);
    expect(after!.dead).toBe(false);
    expect(after!.hp).toBe(hpIn);
    expect(sim.entities.get(hunter)!.dead).toBe(false);
  });
});

// A demon does not leave a corpse to revive: handleDeath gives it corpseTimer 3 and
// updateMob then unravels the entity, so the warlock arm has to rebuild it.
describe('arena pet return: a demon that unravels', () => {
  function unravel(sim: AnySim, petId: number): void {
    for (let i = 0; i < 20 * 5; i++) {
      sim.tick();
      if (!sim.entities.get(petId)) return;
    }
    throw new Error('the demon corpse never unravelled');
  }

  it('rebuilds the warlock a demon after its corpse has unravelled', () => {
    const { sim, hunter: lock, pet, match } = liveBout({ cls: 'warlock' });
    const hpIn = pet.hp;
    sim.ctx.handleDeath(pet, null);
    unravel(sim, pet.id);
    expect(sim.petOf(lock, true)).toBeNull(); // nothing left to revive in place

    arena.endArenaMatch(sim.ctx, match, 'B', 'forfeit');

    const after = sim.petOf(lock);
    expect(after).not.toBeNull();
    expect(after!.templateId).toBe(DEMON_TEMPLATE);
    expect(after!.name).toBe(pet.name);
    expect(after!.dead).toBe(false);
    expect(after!.hp).toBe(hpIn);
    expect(after!.ownerId).toBe(lock);
    // Exactly one demon: the rebuild must never leave a second entity behind.
    const owned = [...sim.entities.values()].filter((e: Entity) => e.ownerId === lock);
    expect(owned).toHaveLength(1);

    const owner = sim.entities.get(lock)!;
    expect(after!.pos.x).toBeLessThan(DUNGEON_X_THRESHOLD);
    expect(dist2d(after!.pos, owner.pos)).toBeLessThan(6);
  });

  it('leaves a demon the warlock re-summoned mid-bout alone', () => {
    const { sim, hunter: lock, pet, match } = liveBout({ cls: 'warlock' });
    sim.ctx.handleDeath(pet, null);
    unravel(sim, pet.id);
    const resummoned = giveDemon(sim, lock); // the warlock pays for a fresh one
    resummoned.hp = 5;

    arena.endArenaMatch(sim.ctx, match, 'B', 'forfeit');

    const after = sim.petOf(lock)!;
    expect(after.id).toBe(resummoned.id); // the pet they chose to keep
    expect(after.hp).toBe(5); // untouched: it is not the pet the bout killed
    const owned = [...sim.entities.values()].filter((e: Entity) => e.ownerId === lock);
    expect(owned).toHaveLength(1);
  });

  it('never rebuilds a demon that died outside a match', () => {
    const sim = makeWorld();
    const lock = sim.addPlayer('warlock', 'Gulda');
    teleport(sim, lock, 0, -40);
    const pet = giveDemon(sim, lock);
    sim.ctx.handleDeath(pet, null);
    for (let i = 0; i < 20 * 5; i++) sim.tick();
    // No match, so no snapshot and no rebuild: an open-world demon death is still
    // a re-summon, exactly as before this fix.
    expect(sim.petOf(lock, true)).toBeNull();
  });
});

describe('arena pet return: what it must NOT do', () => {
  it('leaves a pet that walked in dead exactly as dead (no free revive)', () => {
    const { sim, hunter, pet, match } = liveBout({ petDead: true });
    expect(pet.dead).toBe(true);

    arena.endArenaMatch(sim.ctx, match, 'B', 'forfeit');

    const after = sim.petOf(hunter, true);
    expect(after!.id).toBe(pet.id);
    expect(after!.dead).toBe(true);
    expect(after!.hp).toBe(0);
    expect(sim.petOf(hunter)).toBeNull(); // still no LIVING pet
  });

  it('does not rebuild a beast the owner abandoned AFTER the bout killed it', () => {
    // abandonPet takes dead pets too (petOf includeDead) and drops the entity, so a
    // killed-then-abandoned beast reaches the return path looking exactly like an
    // unravelled demon. Keying the rebuild on the unravel, not the death, is what
    // tells them apart (PR 2944 review).
    const { sim, hunter, pet, match } = liveBout();
    sim.ctx.handleDeath(pet, null);
    sim.abandonPet(hunter);
    expect(sim.entities.get(pet.id)).toBeUndefined();

    arena.endArenaMatch(sim.ctx, match, 'B', 'forfeit');

    expect(sim.petOf(hunter, true)).toBeNull(); // abandoned stays abandoned
  });

  it('does not resurrect a pet the owner deliberately parted with mid-bout', () => {
    const { sim, hunter, pet, match } = liveBout();
    sim.abandonPet(hunter); // the beast goes back to the wild, by choice
    expect(sim.entities.get(pet.id)).toBeUndefined();

    arena.endArenaMatch(sim.ctx, match, 'B', 'forfeit');

    expect(sim.petOf(hunter, true)).toBeNull(); // no pet is handed back
  });

  it('leaves a pet that survived the bout untouched (no free heal on the way out)', () => {
    const { sim, hunter, pet, match } = liveBout();
    pet.hp = 3; // limped out of the fight

    arena.endArenaMatch(sim.ctx, match, 'B', 'forfeit');

    const after = sim.petOf(hunter)!;
    expect(after.id).toBe(pet.id);
    expect(after.dead).toBe(false);
    expect(after.hp).toBe(3); // exactly what the bout left it at
  });
});
