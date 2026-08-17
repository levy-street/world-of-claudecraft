// Resurrection reach (src/sim/combat/resurrection_reach.ts): every player-cast
// resurrection requires the dead ally's BODY to be within range AND in line of
// sight of the caster, and the accepted offer only teleports the target to the
// caster while the caster is still within that reach of the body.
//
// This closes the raid/heroic lockout bypass: lockouts are enforced only at the
// dungeon door (instances/dungeons.ts enterDungeon), while an accepted
// resurrection teleports the dead player straight to the caster, so a caster
// standing inside a locked instance could pull a lockout-barred player past the
// door gate by resurrecting them.

import { describe, expect, it } from 'vitest';
import { RESURRECTION_RANGE, resurrectionReachError } from '../src/sim/combat/resurrection_reach';
import { ABILITIES, arenaOrigin } from '../src/sim/data';
import { DUNGEON_WALL_X } from '../src/sim/dungeon_layout';
import { enterDungeon, instanceInfoAt } from '../src/sim/instances/dungeons';
import { Sim } from '../src/sim/sim';
import { dist2d, type Entity, type SimEvent } from '../src/sim/types';

type AnySim = Sim & Record<string, any>;

const SINGLE_REZ = 'temporal_reversal';
const MASS_REZ = 'collective_reversal';

// An arcane mage of 20 owns both the single-target and the mass resurrection.
function chronomancer(seed = 73): { sim: AnySim; mage: Entity } {
  const sim = new Sim({ seed, playerClass: 'mage' }) as AnySim;
  sim.setPlayerLevel(20);
  expect(sim.setSpec('arcane')).toBe(true);
  sim.tick();
  const mage = sim.player;
  mage.resource = mage.maxResource;
  return { sim, mage };
}

function addToGroup(sim: AnySim, leader: Entity, name: string): Entity {
  const pid = sim.addPlayer('warrior', name);
  sim.partyInvite(pid, leader.id);
  sim.partyAccept(pid);
  return sim.entities.get(pid) as Entity;
}

function killAt(entity: Entity, x: number, z: number): void {
  entity.pos = { x, y: entity.pos.y, z };
  entity.prevPos = { ...entity.pos };
  entity.dead = true;
  entity.ghost = false;
  entity.corpsePos = { ...entity.pos };
  entity.hp = 0;
  entity.resource = 0;
}

function errorTexts(events: SimEvent[]): string[] {
  return events.filter((e) => e.type === 'error').map((e) => (e as { text: string }).text);
}

describe('resurrection ability content', () => {
  it('authors every resurrection range at or under the reach ceiling', () => {
    // resurrectionCastRange silently caps an authored range at the ceiling, so
    // a rez authored beyond it would have its tooltip range quietly ignored:
    // refuse the authoring here instead.
    const rezAbilities = Object.values(ABILITIES).filter(
      (ability) =>
        ability.targetsDead ||
        ability.effects.some(
          (effect) => effect.type === 'resurrectAlly' || effect.type === 'massResurrectGroup',
        ),
    );
    expect(rezAbilities.length).toBeGreaterThanOrEqual(4);
    for (const ability of rezAbilities) {
      expect(ability.range, ability.id).toBeLessThanOrEqual(RESURRECTION_RANGE);
    }
  });
});

describe('resurrectionReachError', () => {
  it('accepts a body inside RESURRECTION_RANGE and refuses one beyond it', () => {
    const { sim, mage } = chronomancer();
    const fallen = addToGroup(sim, mage, 'Fallen');
    // A collider-free corridor for seed 73 (x = 2, z in [38, 117]), so only
    // distance decides the verdict here; the LOS arm has its own test below.
    mage.pos = { x: 2, y: mage.pos.y, z: 38 };
    mage.prevPos = { ...mage.pos };
    killAt(fallen, 2, 38 + RESURRECTION_RANGE - 1);
    expect(resurrectionReachError(sim.ctx, mage, fallen, RESURRECTION_RANGE)).toBeNull();
    killAt(fallen, 2, 38 + RESURRECTION_RANGE + 6);
    expect(resurrectionReachError(sim.ctx, mage, fallen, RESURRECTION_RANGE)).toBe('range');
  });

  it('measures the BODY, not the released ghost', () => {
    const { sim, mage } = chronomancer();
    const fallen = addToGroup(sim, mage, 'Ghosted');
    // Body in reach, ghost far away: reachable.
    killAt(fallen, mage.pos.x + 5, mage.pos.z);
    fallen.ghost = true;
    fallen.pos = { x: mage.pos.x + 300, y: fallen.pos.y, z: mage.pos.z + 300 };
    fallen.prevPos = { ...fallen.pos };
    expect(resurrectionReachError(sim.ctx, mage, fallen, RESURRECTION_RANGE)).toBeNull();
    // Body far away, ghost standing beside the caster: NOT reachable.
    killAt(fallen, mage.pos.x + 200, mage.pos.z);
    fallen.ghost = true;
    fallen.pos = { x: mage.pos.x + 1, y: fallen.pos.y, z: mage.pos.z + 1 };
    fallen.prevPos = { ...fallen.pos };
    expect(resurrectionReachError(sim.ctx, mage, fallen, RESURRECTION_RANGE)).toBe('range');
  });

  it('refuses a body on the far side of a wall (line of sight)', () => {
    const { sim, mage } = chronomancer();
    const fallen = addToGroup(sim, mage, 'Walled');
    // The arena side wall: 3 yd apart, well inside range, no line of sight
    // (the same fixture tests/arena.test.ts pins lineOfSightClear with).
    const o = arenaOrigin(0);
    mage.pos = { x: o.x + DUNGEON_WALL_X - 1.5, y: mage.pos.y, z: o.z };
    mage.prevPos = { ...mage.pos };
    killAt(fallen, o.x + DUNGEON_WALL_X + 1.5, o.z);
    expect(resurrectionReachError(sim.ctx, mage, fallen, RESURRECTION_RANGE)).toBe('los');
  });
});

describe('single-target resurrection reach', () => {
  it('refuses the cast when the body is out of line of sight', () => {
    const { sim, mage } = chronomancer();
    const fallen = addToGroup(sim, mage, 'Walled');
    const o = arenaOrigin(0);
    mage.pos = { x: o.x + DUNGEON_WALL_X - 1.5, y: mage.pos.y, z: o.z };
    mage.prevPos = { ...mage.pos };
    killAt(fallen, o.x + DUNGEON_WALL_X + 1.5, o.z);

    sim.castAbilityOn(SINGLE_REZ, fallen.id);
    const events = sim.tick();
    expect(mage.castingAbility).toBeNull();
    expect(errorTexts(events)).toContain('Line of sight.');
    expect(sim.pendingResurrections.has(fallen.id)).toBe(false);
  });

  it('re-checks reach when the cast finishes, not only when it starts', () => {
    const { sim, mage } = chronomancer();
    const fallen = addToGroup(sim, mage, 'Dragged');
    killAt(fallen, mage.pos.x + 5, mage.pos.z);

    sim.castAbilityOn(SINGLE_REZ, fallen.id);
    expect(mage.castingAbility).toBe(SINGLE_REZ);
    sim.tick();
    // The caster is displaced mid-cast (knockback/teleport): the finish must
    // refuse rather than hand out a cross-map resurrection offer.
    mage.pos = { x: mage.pos.x + 200, y: mage.pos.y, z: mage.pos.z + 200 };
    mage.prevPos = { ...mage.pos };
    let events: SimEvent[] = [];
    for (let tick = 0; tick < 60 && mage.castingAbility; tick++) events = sim.tick();
    expect(errorTexts(events)).toContain('Out of range.');
    expect(sim.pendingResurrections.has(fallen.id)).toBe(false);
    expect(fallen.dead).toBe(true);
  });
});

describe('mass resurrection reach', () => {
  it('offers only the dead members whose bodies are within reach', () => {
    const { sim, mage } = chronomancer();
    const near = addToGroup(sim, mage, 'Near');
    const far = addToGroup(sim, mage, 'Far');
    killAt(near, mage.pos.x + 3, mage.pos.z + 2);
    killAt(far, mage.pos.x + 120, mage.pos.z + 80);

    mage.targetId = null;
    sim.castAbility(MASS_REZ);
    expect(mage.castingAbility).toBe(MASS_REZ);
    let events: SimEvent[] = [];
    for (let tick = 0; tick < 160 && mage.castingAbility; tick++) events = sim.tick();

    expect(events).toContainEqual(
      expect.objectContaining({ type: 'resurrectionOffer', pid: near.id }),
    );
    expect(events).not.toContainEqual(
      expect.objectContaining({ type: 'resurrectionOffer', pid: far.id }),
    );
    expect(sim.pendingResurrections.has(near.id)).toBe(true);
    expect(sim.pendingResurrections.has(far.id)).toBe(false);
  });

  it('refuses to start when every dead member is out of reach', () => {
    const { sim, mage } = chronomancer();
    const far = addToGroup(sim, mage, 'Far');
    killAt(far, mage.pos.x + 120, mage.pos.z + 80);
    const mana = mage.resource;

    mage.targetId = null;
    sim.castAbility(MASS_REZ);
    const events = sim.tick();
    expect(mage.castingAbility).toBeNull();
    expect(mage.resource).toBe(mana);
    expect(errorTexts(events)).toContain('Out of range.');
  });

  it('cancels mid-cast when the caster is displaced out of reach', () => {
    const { sim, mage } = chronomancer();
    const fallen = addToGroup(sim, mage, 'Left Behind');
    killAt(fallen, mage.pos.x + 3, mage.pos.z);
    const mana = mage.resource;

    mage.targetId = null;
    sim.castAbility(MASS_REZ);
    expect(mage.castingAbility).toBe(MASS_REZ);
    sim.tick();
    // The caster is displaced mid-cast: cancel now, not 6 seconds later at a
    // finish that must refuse anyway.
    mage.pos = { x: mage.pos.x + 200, y: mage.pos.y, z: mage.pos.z + 200 };
    mage.prevPos = { ...mage.pos };
    const events = sim.tick();

    expect(mage.castingAbility).toBeNull();
    expect(errorTexts(events)).toContain('Out of range.');
    expect(events).toContainEqual({ type: 'castStop', entityId: mage.id, success: false });
    expect(mage.resource).toBe(mana);
    expect(fallen.dead).toBe(true);
  });

  it('still refuses with the no-dead-members message when nobody is dead', () => {
    const { sim, mage } = chronomancer();
    addToGroup(sim, mage, 'Alive');

    mage.targetId = null;
    sim.castAbility(MASS_REZ);
    const events = sim.tick();
    expect(mage.castingAbility).toBeNull();
    expect(errorTexts(events)).toContain('There are no dead group members to resurrect.');
  });
});

describe('lockout bypass via resurrection is closed', () => {
  it('a caster inside an instance cannot resurrect a body left outside', () => {
    const { sim, mage } = chronomancer();
    const fallen = addToGroup(sim, mage, 'Locked Out');
    killAt(fallen, mage.pos.x + 3, mage.pos.z);

    expect(enterDungeon(sim.ctx, 'hollow_crypt', mage.id)).toBe(true);
    expect(instanceInfoAt(sim.ctx, mage.pos)).not.toBeNull();
    expect(dist2d(mage.pos, fallen.corpsePos ?? fallen.pos)).toBeGreaterThan(RESURRECTION_RANGE);

    mage.targetId = null;
    sim.castAbility(MASS_REZ);
    let events = sim.tick();
    expect(mage.castingAbility).toBeNull();
    expect(errorTexts(events)).toContain('Out of range.');

    sim.castAbilityOn(SINGLE_REZ, fallen.id);
    events = sim.tick();
    expect(mage.castingAbility).toBeNull();
    expect(errorTexts(events)).toContain('Out of range.');
    expect(sim.pendingResurrections.has(fallen.id)).toBe(false);
  });

  it('an offer cast outside cannot ferry the target in after the caster zones', () => {
    const { sim, mage } = chronomancer();
    const fallen = addToGroup(sim, mage, 'Ferried');
    killAt(fallen, mage.pos.x + 3, mage.pos.z);
    const castSpot = { x: mage.pos.x, z: mage.pos.z };

    sim.castAbilityOn(SINGLE_REZ, fallen.id);
    for (let tick = 0; tick < 60 && mage.castingAbility; tick++) sim.tick();
    expect(sim.pendingResurrections.has(fallen.id)).toBe(true);

    // The caster walks into the instance during the 30 s offer window.
    expect(enterDungeon(sim.ctx, 'hollow_crypt', mage.id)).toBe(true);
    sim.respondToResurrection(true, fallen.id);

    expect(fallen.dead).toBe(false);
    // The revive fell back to where the offer was cast, never the instance.
    expect(instanceInfoAt(sim.ctx, fallen.pos)).toBeNull();
    expect(dist2d(fallen.pos, mage.pos)).toBeGreaterThan(RESURRECTION_RANGE);
    expect(dist2d(fallen.pos, { ...castSpot, y: 0 })).toBeLessThan(5);
  });

  it('an accept still arrives at a caster who stayed within reach of the body', () => {
    const { sim, mage } = chronomancer();
    const fallen = addToGroup(sim, mage, 'Chained');
    killAt(fallen, mage.pos.x + 3, mage.pos.z);

    sim.castAbilityOn(SINGLE_REZ, fallen.id);
    for (let tick = 0; tick < 60 && mage.castingAbility; tick++) sim.tick();
    expect(sim.pendingResurrections.has(fallen.id)).toBe(true);

    // The caster drifts a few yards but stays within reach: the live caster
    // remains the arrival anchor, exactly as before.
    mage.pos = { x: mage.pos.x + 10, y: mage.pos.y, z: mage.pos.z + 5 };
    mage.prevPos = { ...mage.pos };
    sim.respondToResurrection(true, fallen.id);

    expect(fallen.dead).toBe(false);
    expect(dist2d(fallen.pos, mage.pos)).toBeLessThan(2);
  });
});
