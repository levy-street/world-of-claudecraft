import { describe, expect, it } from 'vitest';
import { BUILTIN_WORLD } from '../src/sim/data';
import {
  PET_AGGRESSIVE_RANGE,
  petFollow,
  petPickTarget,
  petRangedAttack,
  startWaterJet,
  updatePet,
} from '../src/sim/pet/pet_ai';
import { Sim } from '../src/sim/sim';
import { STEALTH_DETECTION_MULT } from '../src/sim/threat';
import { type Aura, dist2d, type Entity, type SimEvent, type WorldContent } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';
import { expectDefined } from './helpers/defined';

// Direct unit tests for the extracted pet-AI module (P1a). They drive the moved
// functions through the real Sim.ctx seam (so the still-on-Sim helpers they reach
// back for resolve), pinning the slice's behavior independent of the parity golden.

// The pets and hostiles under test are adopted/flagged wild mobs (any mob will
// do; the tests place and level them explicitly), so keep the real forest_wolf
// camps as that mob supply and strip the rest of the ambient world
// (subsystem-world pattern, see tests/dot_final_tick.test.ts).
const PET_TEST_WORLD: WorldContent = {
  ...BUILTIN_WORLD,
  camps: BUILTIN_WORLD.camps.filter((c) => c.mobId === 'forest_wolf'),
  npcs: {},
  groundObjects: [],
};

function world(): { sim: Sim; pid: number; owner: Entity } {
  const sim = new Sim({
    seed: 7,
    playerClass: 'hunter',
    noPlayer: true,
    world: PET_TEST_WORLD,
  });
  const pid = sim.addPlayer('hunter', 'Owner');
  const owner = expectDefined(sim.entities.get(pid));
  return { sim, pid, owner };
}

// Adopt the first wild mob as the player's pet (mirrors a completed tame/summon).
function adopt(sim: Sim, pid: number, exclude: number[] = []): Entity {
  for (const e of sim.entities.values()) {
    if (e.kind === 'mob' && !e.dead && e.ownerId === null && !exclude.includes(e.id)) {
      e.ownerId = pid;
      e.hostile = false;
      e.hp = e.maxHp;
      return e;
    }
  }
  throw new Error('no wild mob to adopt');
}

function wildHostile(sim: Sim, exclude: number[]): Entity {
  for (const e of sim.entities.values()) {
    if (e.kind === 'mob' && !e.dead && e.ownerId === null && !exclude.includes(e.id)) {
      e.hostile = true;
      return e;
    }
  }
  throw new Error('no wild hostile');
}

function place(e: Entity, x: number, z: number): void {
  e.pos = { x, y: e.pos.y, z };
  e.prevPos = { ...e.pos };
}

// Banish every entity except the named ones far off the map so a target scan only
// sees what the test set up (the ctor seeds wild mobs around the player).
function isolate(sim: Sim, keep: number[]): void {
  for (const e of sim.entities.values()) {
    if (!keep.includes(e.id)) place(e, 5000, 5000);
  }
}

// petPickTarget scans the spatial grid (a bounded radius query), whose cell membership
// only updates on rebucket/refresh, NOT when a test mutates `pos` via place(). Rebuild
// the grid from the live positions before a pick, exactly as a real tick's end-of-tick
// grid.refresh does (server/sim.ts). Banished entities land in a far cell and the query's
// live-distance filter drops them; the placed entities land in their real cells.
function syncGrid(sim: Sim): void {
  sim.grid.refresh(sim.entities.values());
}

// A second wild hostile mob, distinct from the first (grows the exclude set).
function wildHostile2(sim: Sim, exclude: number[]): [Entity, Entity] {
  const first = wildHostile(sim, exclude);
  const second = wildHostile(sim, [...exclude, first.id]);
  return [first, second];
}

// Start an active hunter-vs-mage duel (mirrors tests/duel.test.ts) so the hunter's pet
// inherits its owner's PvP hostility toward the opponent player. Used to prove a hostile
// PLAYER is a valid petPickTarget candidate (the grid holds every kind, and the admit
// predicates carry no kind === 'mob' restriction on ownerOffense).
function startedDuelHunter(): { sim: Sim; a: number; b: number } {
  const sim = new Sim({
    seed: 7,
    playerClass: 'warrior',
    noPlayer: true,
    world: PET_TEST_WORLD,
  });
  const a = sim.addPlayer('hunter', 'Aleph', { autoEquip: true });
  const b = sim.addPlayer('mage', 'Bet', { autoEquip: true });
  const move = (pid: number, x: number, z: number): void => {
    const e = expectDefined(sim.entities.get(pid));
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
    // Keep this direct heel assertion on an obstacle-free lane. The Eastbrook
    // landmark lot covers the old (20, 0) fixture, where correct A* routing can
    // initially step away from the owner while going around the building.
    place(owner, 0, 30);
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
    const meta = expectDefined(sim.meta(pid));
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
    const ev: SimEvent[] = sim.drainEvents();
    expect(
      ev.some((e) => e.type === 'spellfx' && e.fx === 'projectile' && e.school === 'fire'),
    ).toBe(true);
    // The bolt's damage lands when it reaches the target (projectile_travel), not the
    // tick it is hurled: advance until it connects. The bolt now rolls spell resist
    // on impact (tests/pet_ranged_resist.test.ts pins that arm); pin the hit roll to
    // succeed so this test stays about the landing damage, not the resist draw.
    sim.rng.chance = () => true;
    let landed = false;
    for (let i = 0; i < 20 && !landed; i++) {
      landed = sim
        .tick()
        .some((e) => e.type === 'damage' && e.sourceId === pet.id && e.school === 'fire');
    }
    expect(landed).toBe(true);
    expect(target.hp).toBeLessThan(target.maxHp); // a landed bolt always damages
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
  // Deliberate literal mirror, and it SHADOWS the imported symbol of the same name for
  // this block only. Kept as a literal: these cases are about the selection contract at
  // that distance, so a value derived from the module would make them self-comparisons.
  // The real constant is pinned to 18 in the stealth-band suite below.
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
    const meta = expectDefined(sim.meta(pid));
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
    const owner = expectDefined(sim.entities.get(a));
    const enemy = expectDefined(sim.entities.get(b));
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

// Assist against a hostile PLAYER. The ownerOffense clause used to carry exactly two
// signals: owner.autoAttack, and the target's hate table naming the owner. A player
// has no hate table, so against a player the threat disjunct was dead by construction
// and only a melee swing pulled the pet in. A caster attacking an enemy player with
// spells alone therefore got no pet assist at all, which is what these pin.
describe('petPickTarget: a defensive pet assists against a hostile PLAYER', () => {
  // Owner targeting the duel opponent with spells only: no swing, so autoAttack is
  // false and the hate-table disjunct cannot apply. `inCombat` is the caller-set knob.
  function spellCasterFixture(): {
    sim: Sim;
    owner: Entity;
    enemy: Entity;
    pet: Entity;
    enemyPid: number;
  } {
    const { sim, a, b } = startedDuelHunter();
    const owner = expectDefined(sim.entities.get(a));
    const enemy = expectDefined(sim.entities.get(b));
    const pet = adopt(sim, a);
    pet.petMode = 'defensive';
    isolate(sim, [a, b, pet.id]);
    place(owner, 0, 0);
    place(pet, 0, 0);
    place(enemy, 10, 0);
    owner.targetId = enemy.id;
    owner.autoAttack = false;
    syncGrid(sim);
    return { sim, owner, enemy, pet, enemyPid: b };
  }

  it('acquires the hostile player the in-combat owner is targeting without auto-attacking', () => {
    const { sim, owner, pet, enemyPid } = spellCasterFixture();
    owner.inCombat = true; // the owner is actually engaged, just not swinging
    expect(petPickTarget(sim.ctx, pet, owner)?.id).toBe(enemyPid);
  });

  it('leaves the targeted hostile player alone while the owner is NOT in combat', () => {
    const { sim, owner, pet } = spellCasterFixture();
    owner.inCombat = false; // merely targeting an enemy is not an attack
    expect(petPickTarget(sim.ctx, pet, owner)).toBeNull();
  });

  it('still returns nothing for a PASSIVE pet whose owner fights that hostile player', () => {
    const { sim, owner, pet } = spellCasterFixture();
    pet.petMode = 'passive';
    owner.inCombat = true;
    expect(petPickTarget(sim.ctx, pet, owner)).toBeNull();
  });

  it('keeps assisting through the whole inCombat LINGER, which is the disclosed cost', () => {
    // Review catch, pinned rather than left to the PR body: `inCombat` is a
    // LINGERING flag, not an instantaneous one, so a defensive pet keeps
    // initiating on the owner's target for the linger window after the fight is
    // actually over. That is bounded and gated by isHostileTo, and it is the
    // accepted cost of reading a flag the tick order publishes one tick late,
    // but it is behavior a future reader should have to change this test to
    // change, rather than discover.
    const { sim, owner, pet, enemyPid } = spellCasterFixture();
    owner.inCombat = true;
    owner.combatTimer = 0; // freshly engaged; the flag decays over PET_COMBAT_LINGER
    expect(petPickTarget(sim.ctx, pet, owner)?.id).toBe(enemyPid);

    // The moment the flag actually clears, the assist stops. The flag, not the
    // timer, is the gate: this is the boundary the fix reads.
    owner.inCombat = false;
    expect(petPickTarget(sim.ctx, pet, owner)).toBeNull();
  });

  it('leaves an untargeted hostile player alone even while the owner is in combat', () => {
    const { sim, owner, pet } = spellCasterFixture();
    owner.inCombat = true;
    owner.targetId = null; // the owner-target conjunct is the only per-target signal left
    // Without this, an in-combat owner would send the pet at every hostile player inside
    // the 50yd assist scan, not at the one the assist stance is about.
    expect(petPickTarget(sim.ctx, pet, owner)).toBeNull();
  });

  it('assists on the TARGETED player while the owner trades blows with something else', () => {
    const { sim, owner, pet, enemyPid } = spellCasterFixture();
    const elsewhere = wildHostile(sim, [pet.id]);
    place(elsewhere, 400, 400); // the owner's actual opponent, far outside the pet scan
    elsewhere.aggroTargetId = owner.id; // so inCombat is genuinely about a DIFFERENT enemy
    owner.inCombat = true;
    syncGrid(sim);
    // Pins the deliberate design decision documented at the ownerOffense site: inCombat
    // is not target-specific, so "assist my target" beats "assist whatever hit me".
    expect(petPickTarget(sim.ctx, pet, owner)?.id).toBe(enemyPid);
  });

  it('does not lend the owner-inCombat signal to the MOB arm (hate table still rules)', () => {
    const { sim, pid, owner } = world();
    const pet = adopt(sim, pid);
    pet.petMode = 'defensive';
    const mob = wildHostile(sim, [pet.id]);
    isolate(sim, [pid, pet.id, mob.id]);
    place(owner, 0, 0);
    place(pet, 0, 0);
    place(mob, 12, 0);
    mob.aggroTargetId = null; // engagingUs closed
    owner.targetId = mob.id;
    owner.autoAttack = false; // autoAttack closed
    owner.inCombat = true; // in combat with something else entirely
    mob.threat.clear(); // this mob has never heard of the owner
    syncGrid(sim);
    expect(petPickTarget(sim.ctx, pet, owner)).toBeNull();
    // control: the mob arm still admits on its own signal, the hate table
    mob.threat.set(owner.id, 1);
    syncGrid(sim);
    expect(petPickTarget(sim.ctx, pet, owner)?.id).toBe(mob.id);
  });
});

// Stealth detection. petCanSeeTarget used to pass the pet's 50yd assist RANGE as the
// stealth-detection BASE radius, which at the equal-level 0.25 multiplier let a pet
// see a stealthed player from 12.5yd, roughly three times what any mob manages from
// its own aggro radius. The base is the pet's aggro-radius analogue instead.
describe('pet stealth detection sits in the mob band, not triple it', () => {
  const PET_ASSIST_RANGE = 50; // mirrors the module constant (the old, wrong base)
  const newRadius = PET_AGGRESSIVE_RANGE * STEALTH_DETECTION_MULT; // 4.5 at equal level
  const oldRadius = PET_ASSIST_RANGE * STEALTH_DETECTION_MULT; // 12.5, the bug
  const BETWEEN = 8; // a distance the old base saw and the new one must not

  function stealthAura(): Aura {
    return {
      id: 'stealth',
      name: 'Stealth',
      kind: 'stealth',
      remaining: 3600,
      duration: 3600,
      value: 0,
      sourceId: 0,
      school: 'physical',
    };
  }

  // A hunter's pet and a stealthed, equal-level duel opponent it is hostile to.
  function stealthedOpponent(): {
    sim: Sim;
    owner: Entity;
    enemy: Entity;
    pet: Entity;
    enemyPid: number;
  } {
    const { sim, a, b } = startedDuelHunter();
    const owner = expectDefined(sim.entities.get(a));
    const enemy = expectDefined(sim.entities.get(b));
    const pet = adopt(sim, a);
    pet.petMode = 'defensive';
    pet.level = enemy.level; // equal level: the plain STEALTH_DETECTION_MULT applies
    enemy.auras.push(stealthAura());
    isolate(sim, [a, b, pet.id]);
    place(owner, 0, 0);
    place(pet, 0, 0);
    owner.targetId = enemy.id;
    owner.autoAttack = true; // admission is settled; only visibility is under test
    return { sim, owner, enemy, pet, enemyPid: b };
  }

  it('spans the change: the fixture distance lies strictly between the two radii', () => {
    // The band bounds below are DERIVED from the same two constants the production code
    // reads, so on their own they would move with any edit to either. Pin both to their
    // literal values so the fix's actual claim, 4.5yd rather than 12.5yd, is asserted.
    expect(PET_AGGRESSIVE_RANGE).toBe(18);
    expect(STEALTH_DETECTION_MULT).toBe(0.25);
    expect(newRadius).toBe(4.5);
    // Without this the two picks below could both pass on an unmoved radius.
    expect(BETWEEN).toBeGreaterThan(newRadius);
    expect(BETWEEN).toBeLessThan(oldRadius);
  });

  it('does NOT acquire a stealthed equal-level player beyond the pet aggro-radius band', () => {
    const { sim, enemy, pet, owner } = stealthedOpponent();
    place(enemy, BETWEEN, 0);
    syncGrid(sim);
    expect(petPickTarget(sim.ctx, pet, owner)).toBeNull();
  });

  it('DOES acquire the same stealthed player once inside that band', () => {
    const { sim, enemy, pet, owner, enemyPid } = stealthedOpponent();
    place(enemy, newRadius - 0.5, 0);
    syncGrid(sim);
    expect(petPickTarget(sim.ctx, pet, owner)?.id).toBe(enemyPid);
  });

  it('unstealthed, the same player at that distance is acquired normally', () => {
    const { sim, enemy, pet, owner, enemyPid } = stealthedOpponent();
    enemy.auras = enemy.auras.filter((a) => a.kind !== 'stealth');
    place(enemy, BETWEEN, 0);
    syncGrid(sim);
    expect(petPickTarget(sim.ctx, pet, owner)?.id).toBe(enemyPid);
  });

  // The damage path asks the same question and must answer it the same way, or a pet
  // that cannot see a rogue could still hit them (combat/damage.ts). Probed at the
  // picker's own boundary rather than somewhere in the band: a damage-side radius that
  // drifted from the picker's by more than 0.02yd cannot satisfy both halves of this.
  it('the dealDamage stealth gate turns over at the same boundary as the target picker', () => {
    const { sim, enemy, pet, owner, enemyPid } = stealthedOpponent();
    const hpBefore = enemy.hp;
    place(enemy, newRadius + 0.01, 0); // a hair outside: neither path may touch them
    syncGrid(sim);
    expect(petPickTarget(sim.ctx, pet, owner)).toBeNull();
    expect(sim.dealDamage(pet, enemy, 10, false, 'physical', null, 'hit')).toBe(0);
    expect(enemy.hp).toBe(hpBefore);
    place(enemy, newRadius - 0.01, 0); // a hair inside: both paths must
    syncGrid(sim);
    expect(petPickTarget(sim.ctx, pet, owner)?.id).toBe(enemyPid);
    expect(sim.dealDamage(pet, enemy, 10, false, 'physical', null, 'hit')).toBeGreaterThan(0);
    expect(enemy.hp).toBeLessThan(hpBefore);
  });
});
