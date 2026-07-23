import { describe, expect, it } from 'vitest';
import {
  petFollow,
  petPickTarget,
  petRangedAttack,
  startWaterJet,
  updatePet,
} from '../src/sim/pet/pet_ai';
import { Sim } from '../src/sim/sim';
import { dist2d, type Entity } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';

// Direct unit tests for the extracted pet-AI module (P1a). They drive the moved
// functions through the real Sim.ctx seam (so the still-on-Sim helpers they reach
// back for resolve), pinning the slice's behavior independent of the parity golden.

type AnySim = Sim & Record<string, any>;
type AnyEntity = Entity & Record<string, any>;

function world(): { sim: AnySim; pid: number; owner: AnyEntity } {
  const sim = new Sim({ seed: 7, playerClass: 'hunter', noPlayer: true }) as AnySim;
  const pid = sim.addPlayer('hunter', 'Owner');
  const owner = sim.entities.get(pid) as AnyEntity;
  return { sim, pid, owner };
}

// Adopt the first wild mob as the player's pet (mirrors a completed tame/summon).
function adopt(sim: AnySim, pid: number, exclude: number[] = []): AnyEntity {
  for (const e of sim.entities.values()) {
    if (e.kind === 'mob' && !e.dead && e.ownerId === null && !exclude.includes(e.id)) {
      e.ownerId = pid;
      e.hostile = false;
      e.hp = e.maxHp;
      return e as AnyEntity;
    }
  }
  throw new Error('no wild mob to adopt');
}

function wildHostile(sim: AnySim, exclude: number[]): AnyEntity {
  for (const e of sim.entities.values()) {
    if (e.kind === 'mob' && !e.dead && e.ownerId === null && !exclude.includes(e.id)) {
      e.hostile = true;
      return e as AnyEntity;
    }
  }
  throw new Error('no wild hostile');
}

function place(e: AnyEntity, x: number, z: number): void {
  e.pos = { x, y: e.pos.y, z };
  e.prevPos = { ...e.pos };
}

// Banish every entity except the named ones far off the map so a target scan only
// sees what the test set up (the ctor seeds wild mobs around the player).
function isolate(sim: AnySim, keep: number[]): void {
  for (const e of sim.entities.values()) {
    if (!keep.includes(e.id)) place(e as AnyEntity, 5000, 5000);
  }
}

// petPickTarget scans the spatial grid (a bounded radius query), whose cell membership
// only updates on rebucket/refresh, NOT when a test mutates `pos` via place(). Rebuild
// the grid from the live positions before a pick, exactly as a real tick's end-of-tick
// grid.refresh does (server/sim.ts). Banished entities land in a far cell and the query's
// live-distance filter drops them; the placed entities land in their real cells.
function syncGrid(sim: AnySim): void {
  sim.grid.refresh(sim.entities.values());
}

// A second wild hostile mob, distinct from the first (grows the exclude set).
function wildHostile2(sim: AnySim, exclude: number[]): [AnyEntity, AnyEntity] {
  const first = wildHostile(sim, exclude);
  const second = wildHostile(sim, [...exclude, first.id]);
  return [first, second];
}

// Start an active hunter-vs-mage duel (mirrors tests/duel.test.ts) so the hunter's pet
// inherits its owner's PvP hostility toward the opponent player. Used to prove a hostile
// PLAYER is a valid petPickTarget candidate (the grid holds every kind, and the admit
// predicates carry no kind === 'mob' restriction on ownerOffense).
function startedDuelHunter(): { sim: AnySim; a: number; b: number } {
  const sim = new Sim({ seed: 7, playerClass: 'warrior', noPlayer: true }) as AnySim;
  const a = sim.addPlayer('hunter', 'Aleph', { autoEquip: true });
  const b = sim.addPlayer('mage', 'Bet', { autoEquip: true });
  const move = (pid: number, x: number, z: number): void => {
    const e = sim.entities.get(pid) as AnyEntity;
    e.pos = { x, y: groundHeight(x, z, sim.cfg.seed), z };
    e.prevPos = { ...e.pos };
    sim.rebucket(e);
  };
  move(a, 0, -40);
  move(b, 4, -40); // adjacent: within duel-request range
  sim.duelRequest(b, a);
  sim.duelAccept(b);
  for (let i = 0; i < 20 * 4; i++) {
    sim.tick(); // run the countdown out so the bout flips to 'active'
    if (sim.duels.get(a)?.state === 'active') break;
  }
  return { sim, a, b };
}

describe('pet_ai module (P1a) — direct unit tests', () => {
  it('updatePet despawns a pet whose owner is no longer a tracked player', () => {
    const { sim, pid } = world();
    const pet = adopt(sim, pid);
    expect(sim.entities.has(pet.id)).toBe(true);
    sim.players.delete(pid); // owner entity remains but is no longer a player
    updatePet(sim.ctx, pet);
    expect(sim.entities.has(pet.id)).toBe(false); // despawnPersistentPet -> dropEntity
  });

  it('updatePet heels a targetless pet toward its owner (the petFollow arm)', () => {
    const { sim, pid, owner } = world();
    const pet = adopt(sim, pid);
    pet.petMode = 'passive'; // petPickTarget returns null -> the heel arm runs
    pet.aggroTargetId = null;
    isolate(sim, [pid, pet.id]);
    place(owner, 0, 0);
    place(pet, owner.pos.x + 20, owner.pos.z);
    sim.rebucket(pet);
    const d0 = dist2d(pet.pos, owner.pos);
    updatePet(sim.ctx, pet);
    expect(pet.aggroTargetId).toBeNull();
    expect(dist2d(pet.pos, owner.pos)).toBeLessThan(d0); // stepped toward the owner
  });

  it('petPickTarget returns null for a passive pet', () => {
    const { sim, pid, owner } = world();
    const pet = adopt(sim, pid);
    pet.petMode = 'passive';
    expect(petPickTarget(sim.ctx, pet, owner)).toBeNull();
  });

  it('petPickTarget auto-pulls a nearby hostile for an ACTIVE owner, not an idle one', () => {
    const { sim, pid, owner } = world();
    const pet = adopt(sim, pid);
    pet.petMode = 'aggressive';
    const target = wildHostile(sim, [pet.id]);
    isolate(sim, [pid, pet.id, target.id]);
    place(owner, 0, 0);
    place(pet, 1, 0);
    place(target, 6, 0); // 5yd from the pet, within PET_AGGRESSIVE_RANGE (18)
    target.aggroTargetId = null; // not engaging the owner or pet
    owner.targetId = null;
    owner.autoAttack = false;
    const meta = sim.meta(pid)!;
    meta.lastActiveTick = sim.tickCount; // active: the aggressive auto-pull gate is open
    syncGrid(sim); // the grid, not the entity map, is now the scan source
    expect(petPickTarget(sim.ctx, pet, owner)?.id).toBe(target.id);
    meta.lastActiveTick = sim.tickCount - 100000; // idle: a non-engaging hostile is left alone
    expect(petPickTarget(sim.ctx, pet, owner)).toBeNull();
  });

  it('petRangedAttack hurls a fire-school bolt that deals AP-scaled damage', () => {
    const { sim, pid } = world();
    const pet = adopt(sim, pid);
    const target = wildHostile(sim, [pet.id]);
    target.maxHp = 50000;
    target.hp = 50000;
    petRangedAttack(sim.ctx, pet, target, { range: 25, school: 'fire' });
    const ev = sim.drainEvents() as Array<Record<string, any>>;
    expect(
      ev.some((e) => e.type === 'spellfx' && e.fx === 'projectile' && e.school === 'fire'),
    ).toBe(true);
    // The bolt's damage lands when it reaches the target (projectile_travel), not the
    // tick it is hurled: advance until it connects.
    let landed = false;
    for (let i = 0; i < 20 && !landed; i++) {
      landed = (sim.tick() as Array<Record<string, any>>).some(
        (e) => e.type === 'damage' && e.sourceId === pet.id && e.school === 'fire',
      );
    }
    expect(landed).toBe(true);
    expect(target.hp).toBeLessThan(target.maxHp); // the bolt never misses (crit-only roll)
  });

  it('Water Jet is a real channel that slows, blocks bolts, and breaks out of range', () => {
    const { sim, pid, owner } = world();
    const pet = adopt(sim, pid);
    const target = wildHostile(sim, [pet.id]);
    pet.templateId = 'water_elemental';
    pet.petMode = 'defensive';
    pet.aggroTargetId = target.id;
    isolate(sim, [pid, pet.id, target.id]);
    place(owner, 0, 0);
    place(pet, 1, 0);
    place(target, 10, 0);
    const ranged = {
      range: 25,
      school: 'frost' as const,
      jet: { total: 30, duration: 4, interval: 1, slow: 0.6, cooldown: 8 },
    };
    startWaterJet(sim.ctx, pet, target, ranged.jet);
    const start = sim.drainEvents();
    expect(start.some((e) => e.type === 'spellfx' && e.fx === 'bubbleBeam')).toBe(true);
    expect(pet.castingAbility).toBe('water_jet');
    expect(pet.channeling).toBe(true);
    expect(
      target.auras.some(
        (a) => a.id === 'water_jet_slow' && a.sourceId === pet.id && a.value === 0.6,
      ),
    ).toBe(true);

    const remaining = pet.castRemaining;
    updatePet(sim.ctx, pet);
    expect(pet.castRemaining).toBeLessThan(remaining);
    expect(sim.drainEvents().some((e) => e.type === 'spellfx' && e.fx === 'projectile')).toBe(
      false,
    );

    place(target, 40, 0);
    updatePet(sim.ctx, pet);
    expect(pet.castingAbility).toBeNull();
    expect(pet.channeling).toBe(false);
    expect(target.auras.some((a) => a.id === 'water_jet' || a.id === 'water_jet_slow')).toBe(false);
    expect(
      sim
        .drainEvents()
        .some((e) => e.type === 'spellfx' && e.fx === 'bubbleBeam' && e.duration === 0),
    ).toBe(true);
  });

  it('auto-casts Water Jet on cooldown only while its autocast is armed', () => {
    const { sim, pid, owner } = world();
    const pet = adopt(sim, pid);
    const target = wildHostile(sim, [pet.id]);
    pet.templateId = 'water_elemental';
    pet.petMode = 'defensive';
    pet.aggroTargetId = target.id;
    isolate(sim, [pid, pet.id, target.id]);
    place(owner, 0, 0);
    place(pet, 1, 0);
    place(target, 8, 0); // inside the 25yd jet range
    pet.petTauntTimer = 0; // the jet reuses petTauntTimer as its cooldown: available

    // Autocast OFF: the AI does its ranged attacks but never starts the jet itself.
    pet.petAutoWaterJet = false;
    updatePet(sim.ctx, pet);
    expect(pet.castingAbility).not.toBe('water_jet');

    // Arm autocast: the next AI tick with the jet off cooldown starts the channel.
    pet.petAutoWaterJet = true;
    pet.petTauntTimer = 0;
    updatePet(sim.ctx, pet);
    expect(pet.castingAbility).toBe('water_jet');
    expect(pet.channeling).toBe(true);
  });

  it('setPetAutoWaterJet toggles the flag on a jet-bearing pet', () => {
    const { sim, pid } = world();
    const pet = adopt(sim, pid);
    pet.templateId = 'water_elemental';
    sim.setPetAutoWaterJet(true, pid);
    expect(pet.petAutoWaterJet).toBe(true);
    sim.setPetAutoWaterJet(false, pid);
    expect(pet.petAutoWaterJet).toBe(false);
  });

  it('petFollow clears the cached path once the pet is at heel distance', () => {
    const { sim, pid, owner } = world();
    const pet = adopt(sim, pid);
    place(owner, 0, 0);
    place(pet, owner.pos.x + 1, owner.pos.z); // within PET_FOLLOW_DISTANCE (3.5)
    pet.petPath = [{ x: 9, y: 0, z: 9 }];
    petFollow(sim.ctx, pet, owner);
    expect(pet.petPath).toEqual([]);
  });
});

describe('pet proximity pull: a pet drags idle wild mobs like its owner', () => {
  it('an idle wild mob inside the pet reach aggros the pet, not only when struck', () => {
    const { sim, pid, owner } = world();
    const pet = adopt(sim, pid);
    const mob = wildHostile(sim, [pet.id]);
    // even level: not trivial-con, and the mob placed inside the radius floor (>=4yd)
    mob.level = 10;
    pet.level = 10;
    mob.aiState = 'idle';
    mob.aggroTargetId = null;
    mob.inCombat = false;
    place(owner, 500, 500); // owner far away: the mob cannot proximity-aggro the PLAYER
    place(pet, 100, 100);
    place(mob, 103, 100); // 3yd from the pet, well within the mob's detection radius
    sim.rebucket(pet);
    sim.rebucket(mob);
    sim.rebucket(owner);
    expect(pet.ownerId).toBe(pid); // a player-owned pet
    expect(mob.aiState).toBe('idle');
    // The pet's own tick pulls nearby idle wild mobs (no reliance on being hit first).
    updatePet(sim.ctx, pet);
    expect(mob.aggroTargetId).toBe(pet.id);
    expect(mob.aiState).not.toBe('idle');
  });
});

// petPickTarget now iterates the spatial grid within PET_ASSIST_RANGE instead of the
// whole entity roster (a CPU hot path at scale). These pin that the grid path preserves
// the exact selection contract (nearest valid hostile, strict-`<` boundary, mode ranges,
// all entity kinds) and that the one observable difference, iteration order on an exact
// distance tie, is deterministic.
describe('petPickTarget: grid scan preserves the selection contract', () => {
  const PET_ASSIST_RANGE = 50; // mirrors the module constant (how far the pet scans)
  const PET_AGGRESSIVE_RANGE = 18; // aggressive pets pull idle enemies within this

  it('selects the nearest valid hostile inside range (grid path == old full scan)', () => {
    const { sim, pid, owner } = world();
    const pet = adopt(sim, pid);
    pet.petMode = 'defensive';
    const [near, far] = wildHostile2(sim, [pet.id]);
    isolate(sim, [pid, pet.id, near.id, far.id]);
    place(owner, 0, 0);
    place(pet, 0, 0);
    place(near, 10, 0); // 10yd
    place(far, 30, 0); // 30yd: also a valid candidate, but farther
    near.aggroTargetId = owner.id; // both engage the owner (defensive admit path)
    far.aggroTargetId = owner.id;
    syncGrid(sim);
    expect(petPickTarget(sim.ctx, pet, owner)?.id).toBe(near.id);
  });

  it('resolves an exact-distance tie deterministically to the lower-cell (west) candidate', () => {
    const { sim, pid, owner } = world();
    const pet = adopt(sim, pid);
    pet.petMode = 'defensive';
    const [west, east] = wildHostile2(sim, [pet.id]);
    isolate(sim, [pid, pet.id, west.id, east.id]);
    place(owner, 0, 0);
    place(pet, 0, 0);
    place(west, -10, 0); // d = 10, grid cell cx = -1 (scanned first)
    place(east, 10, 0); // d = 10, grid cell cx = 0 (scanned after west)
    west.aggroTargetId = owner.id;
    east.aggroTargetId = owner.id;
    expect(dist2d(pet.pos, west.pos)).toBe(dist2d(pet.pos, east.pos)); // a genuine tie
    syncGrid(sim);
    // strict `d < bestD` keeps the FIRST candidate seen at the tie distance; the grid
    // scans cells in ascending cx, so the lower-x (west) candidate wins. Pinned because
    // a change to iteration order here reorders downstream combat rng draws (parity).
    expect(petPickTarget(sim.ctx, pet, owner)?.id).toBe(west.id);
    expect(petPickTarget(sim.ctx, pet, owner)?.id).toBe(west.id); // stable across calls
  });

  it('does NOT select a hostile at exactly PET_ASSIST_RANGE (strict `<` excludes the boundary)', () => {
    const { sim, pid, owner } = world();
    const pet = adopt(sim, pid);
    pet.petMode = 'defensive';
    const edge = wildHostile(sim, [pet.id]);
    isolate(sim, [pid, pet.id, edge.id]);
    place(owner, 0, 0);
    place(pet, 0, 0);
    place(edge, PET_ASSIST_RANGE, 0); // exactly 50yd: d < 50 is false
    edge.aggroTargetId = owner.id;
    syncGrid(sim);
    expect(petPickTarget(sim.ctx, pet, owner)).toBeNull();
    // control: one yard inside the boundary IS selected (proves it is the boundary,
    // not a blanket miss of the whole query)
    place(edge, PET_ASSIST_RANGE - 1, 0);
    syncGrid(sim);
    expect(petPickTarget(sim.ctx, pet, owner)?.id).toBe(edge.id);
  });

  it('aggressive mode leaves a non-engaging hostile beyond PET_AGGRESSIVE_RANGE alone', () => {
    const { sim, pid, owner } = world();
    const pet = adopt(sim, pid);
    pet.petMode = 'aggressive';
    const mob = wildHostile(sim, [pet.id]);
    isolate(sim, [pid, pet.id, mob.id]);
    place(owner, 0, 0);
    place(pet, 0, 0);
    place(mob, 30, 0); // inside the 50yd grid query, but beyond PET_AGGRESSIVE_RANGE (18)
    mob.aggroTargetId = null; // not engaging owner or pet
    owner.targetId = null;
    owner.autoAttack = false;
    const meta = sim.meta(pid)!;
    meta.lastActiveTick = sim.tickCount; // active: the aggressive gate is open
    syncGrid(sim);
    // the wider superset radius (50) surfaces this mob, but the `aggressive` predicate
    // (d <= 18) re-rejects it, exactly as the old bestD-clamped scan did.
    expect(petPickTarget(sim.ctx, pet, owner)).toBeNull();
    // control: inside PET_AGGRESSIVE_RANGE it IS auto-pulled
    place(mob, PET_AGGRESSIVE_RANGE - 3, 0);
    syncGrid(sim);
    expect(petPickTarget(sim.ctx, pet, owner)?.id).toBe(mob.id);
  });

  it('selects a hostile PLAYER in PvP (the grid holds every kind; no mob-only restriction)', () => {
    const { sim, a, b } = startedDuelHunter();
    expect(sim.duels.get(a)?.state).toBe('active');
    const owner = sim.entities.get(a) as AnyEntity;
    const enemy = sim.entities.get(b) as AnyEntity;
    const pet = adopt(sim, a); // the hunter's pet
    pet.petMode = 'defensive';
    expect(sim.isHostileTo(pet, enemy)).toBe(true); // pet inherits owner PvP hostility
    isolate(sim, [a, b, pet.id]);
    place(owner, 0, 0);
    place(pet, 0, 0);
    place(enemy, 10, 0);
    owner.targetId = enemy.id;
    owner.autoAttack = true; // ownerOffense admits the enemy player (kind is not 'mob')
    syncGrid(sim);
    expect(petPickTarget(sim.ctx, pet, owner)?.id).toBe(b);
  });

  it('centers the radius query on the PET, not the owner', () => {
    const { sim, pid, owner } = world();
    const pet = adopt(sim, pid);
    pet.petMode = 'defensive';
    const mob = wildHostile(sim, [pet.id]);
    isolate(sim, [pid, pet.id, mob.id]);
    place(owner, 0, 0);
    place(pet, 100, 0); // pet far from the owner (petPickTarget itself has no leash gate)
    place(mob, 103, 0); // 3yd from the PET, but 103yd from the owner
    mob.aggroTargetId = owner.id; // engagingUs admit
    syncGrid(sim);
    // The mob is well outside a 50yd query centered on the owner; it is selected only
    // because the scan is centered on pet.pos. Guards against a pet.pos -> owner.pos slip.
    expect(petPickTarget(sim.ctx, pet, owner)?.id).toBe(mob.id);
  });

  it('skips a dead hostile (corpse) even when it is the nearest candidate', () => {
    const { sim, pid, owner } = world();
    const pet = adopt(sim, pid);
    pet.petMode = 'defensive';
    const [corpse, live] = wildHostile2(sim, [pet.id]);
    isolate(sim, [pid, pet.id, corpse.id, live.id]);
    place(owner, 0, 0);
    place(pet, 0, 0);
    place(corpse, 5, 0); // nearest, but dead: the `m.dead` guard must skip it
    place(live, 10, 0); // farther, alive: the real pick
    corpse.aggroTargetId = owner.id;
    corpse.dead = true;
    live.aggroTargetId = owner.id;
    syncGrid(sim);
    expect(petPickTarget(sim.ctx, pet, owner)?.id).toBe(live.id);
  });

  it('admits via ownerOffense on the owner-threat disjunct (owner not auto-attacking)', () => {
    const { sim, pid, owner } = world();
    const pet = adopt(sim, pid);
    pet.petMode = 'defensive';
    const mob = wildHostile(sim, [pet.id]);
    isolate(sim, [pid, pet.id, mob.id]);
    place(owner, 0, 0);
    place(pet, 0, 0);
    place(mob, 12, 0);
    mob.aggroTargetId = null; // engagingUs is false
    owner.targetId = mob.id;
    owner.autoAttack = false; // the autoAttack disjunct is closed...
    mob.threat.set(owner.id, 1); // ...so admission must ride the owner-threat disjunct
    syncGrid(sim);
    expect(petPickTarget(sim.ctx, pet, owner)?.id).toBe(mob.id);
  });
});
