// Recall the Fallen was the one healer resurrection that demanded a selected
// corpse: every other healer's out-of-combat rez is a targetless group sweep, so
// a paladin pressing the button with nobody (or a living member) selected got
// "You must target a dead ally in your group." while standing on the body. An
// out-of-combat single rez now picks its own fallen ally when the press names
// none (src/sim/combat/fallen_ally_target.ts); the combat rezzes keep requiring
// an explicit dead target, because in a fight WHICH body gets the res is the call.

import { describe, expect, it } from 'vitest';
import {
  autoPicksFallenAlly,
  isFallenGroupMember,
  pickFallenAlly,
} from '../src/sim/combat/fallen_ally_target';
import { ABILITIES } from '../src/sim/content/classes';
import { BUILTIN_WORLD } from '../src/sim/data';
import { Sim } from '../src/sim/sim';
import type { Entity, PlayerClass, SimEvent, WorldContent } from '../src/sim/types';
import { placePlayerInOpenField } from './helpers/open_field';

const REZ = 'recall_the_fallen';

// No ambient camps or npcs: every body and caster here is placed by hand.
const TEST_WORLD: WorldContent = { ...BUILTIN_WORLD, camps: [], npcs: {}, groundObjects: [] };

function caster(playerClass: PlayerClass, spec: string, level: number): { sim: Sim; p: Entity } {
  const sim = new Sim({ seed: 616, playerClass, autoEquip: true, world: TEST_WORLD });
  sim.setPlayerLevel(level);
  expect(sim.setSpec(spec)).toBe(true);
  // The paladin rite is quest-earned, not trained: hand it the completed chain.
  sim.players.get(sim.playerId)?.questsDone.add('q_rite_of_redemption');
  sim.setPlayerLevel(level);
  placePlayerInOpenField(sim);
  const p = sim.player as Entity;
  p.resource = p.maxResource;
  return { sim, p };
}

function member(sim: Sim, leader: Entity, name: string, dx: number, dz = 0): Entity {
  const pid = sim.addPlayer('warrior', name);
  sim.partyInvite(pid, leader.id);
  sim.partyAccept(pid);
  placePlayerInOpenField(sim, pid, { x: dx, z: dz });
  return sim.entities.get(pid) as Entity;
}

function fall(e: Entity): Entity {
  e.dead = true;
  e.ghost = false;
  e.corpsePos = { ...e.pos };
  e.hp = 0;
  e.resource = 0;
  return e;
}

function errorsOf(events: SimEvent[]): string[] {
  return events.flatMap((e) => (e.type === 'error' ? [e.text] : []));
}

// Runs the rest of the cast and returns every pid a resurrection was offered to.
function finishOffers(sim: Sim): Set<number> {
  const offered = new Set<number>();
  for (let tick = 0; tick < 20 * 9; tick++) {
    for (const event of sim.tick()) {
      if (event.type === 'resurrectionOffer' && event.pid !== undefined) offered.add(event.pid);
    }
  }
  return offered;
}

describe('autoPicksFallenAlly', () => {
  it('knows every single-target rez in the table', () => {
    // Derived from the live table, so a new dead-target ability has to be sorted
    // into combat (explicit target) or out of combat (auto-pick) here.
    const deadTargeted = Object.values(ABILITIES)
      .filter((def) => def.targetsDead)
      .map((def) => def.id)
      .sort();
    expect(deadTargeted).toEqual(['recall_the_fallen', 'temporal_reversal', 'wildwake']);
    expect(deadTargeted.filter((id) => autoPicksFallenAlly(ABILITIES[id]))).toEqual([REZ]);
  });

  it('covers the out-of-combat single rez and nothing else', () => {
    expect(autoPicksFallenAlly(ABILITIES[REZ])).toBe(true);
    // The combat rezzes keep the explicit dead target.
    expect(autoPicksFallenAlly(ABILITIES.temporal_reversal)).toBe(false);
    expect(autoPicksFallenAlly(ABILITIES.wildwake)).toBe(false);
    // The group rezzes carry no target at all and never reach this rule.
    for (const id of ['prayer_of_returning', 'ancestor_return', 'grove_awakening']) {
      expect(autoPicksFallenAlly(ABILITIES[id]), id).toBe(false);
    }
  });
});

describe('pickFallenAlly', () => {
  it('picks the nearest fallen member in reach, not the first on the roster', () => {
    const { sim, p } = caster('paladin', 'protection', 12);
    const far = fall(member(sim, p, 'Far Fallen', 12));
    const near = fall(member(sim, p, 'Near Fallen', 4));
    expect(pickFallenAlly(sim.ctx, p, 30)).toBe(near);
    expect(isFallenGroupMember(sim.ctx, p, far)).toBe(true);
  });

  it('breaks an exact distance tie on roster order', () => {
    const { sim, p } = caster('paladin', 'protection', 12);
    const first = fall(member(sim, p, 'First Fallen', 5));
    fall(member(sim, p, 'Second Fallen', -5));
    expect(pickFallenAlly(sim.ctx, p, 30)).toBe(first);
  });

  it('keeps a fallen member the caster already selected, even when another is nearer', () => {
    const { sim, p } = caster('paladin', 'protection', 12);
    const chosen = fall(member(sim, p, 'Chosen Fallen', 10));
    fall(member(sim, p, 'Nearer Fallen', 3));
    sim.targetEntity(chosen.id);
    expect(pickFallenAlly(sim.ctx, p, 30)).toBe(chosen);
  });

  it('measures reach to the released body, not to the ghost at the graveyard', () => {
    const { sim, p } = caster('paladin', 'protection', 12);
    const ghost = fall(member(sim, p, 'Released', 6));
    ghost.ghost = true;
    ghost.pos = { x: ghost.pos.x + 500, y: ghost.pos.y, z: ghost.pos.z };
    expect(pickFallenAlly(sim.ctx, p, 30)).toBe(ghost);
  });

  it('skips the living, strangers, and bodies beyond reach', () => {
    const { sim, p } = caster('paladin', 'protection', 12);
    member(sim, p, 'Living Tank', 2);
    fall(member(sim, p, 'Beyond Reach', 35));
    const strangerPid = sim.addPlayer('warrior', 'Stranger');
    placePlayerInOpenField(sim, strangerPid, { x: 3 });
    const stranger = fall(sim.entities.get(strangerPid) as Entity);
    expect(isFallenGroupMember(sim.ctx, p, stranger)).toBe(false);
    expect(pickFallenAlly(sim.ctx, p, 30)).toBeNull();
  });

  it('keeps a selected fallen member even beyond reach', () => {
    const { sim, p } = caster('paladin', 'protection', 12);
    const chosen = fall(member(sim, p, 'Chosen Far', 35));
    fall(member(sim, p, 'In Reach', 4));
    sim.targetEntity(chosen.id);
    expect(pickFallenAlly(sim.ctx, p, 30)).toBe(chosen);
  });

  it('ranks released members by the body, not the ghost', () => {
    const { sim, p } = caster('paladin', 'protection', 12);
    const nearBody = fall(member(sim, p, 'Near Body', 6));
    nearBody.ghost = true;
    nearBody.pos = { x: nearBody.pos.x + 500, y: nearBody.pos.y, z: nearBody.pos.z };
    const farBody = fall(member(sim, p, 'Far Body', 12));
    farBody.ghost = true;
    farBody.pos = { x: p.pos.x + 1, y: farBody.pos.y, z: p.pos.z };
    expect(pickFallenAlly(sim.ctx, p, 30)).toBe(nearBody);
  });

  it('ranks a body already holding a live offer behind every body without one', () => {
    const { sim, p } = caster('paladin', 'protection', 12);
    const offeredNear = fall(member(sim, p, 'Offered Near', 3));
    const freeFar = fall(member(sim, p, 'Free Far', 12));
    const offer = (e: Entity, expiresAt: number) =>
      sim.ctx.pendingResurrections.set(e.id, {
        casterId: 999,
        hpFrac: 0.3,
        fallbackDestination: { ...p.pos },
        expiresAt,
        maxRange: 40,
      });
    offer(offeredNear, sim.ctx.time + 20);
    expect(pickFallenAlly(sim.ctx, p, 30)).toBe(freeFar);
    // An expired offer no longer counts: nearest wins again.
    offer(offeredNear, sim.ctx.time);
    expect(pickFallenAlly(sim.ctx, p, 30)).toBe(offeredNear);
    // Every body offered: still the nearest, rather than nobody.
    offer(offeredNear, sim.ctx.time + 20);
    offer(freeFar, sim.ctx.time + 20);
    expect(pickFallenAlly(sim.ctx, p, 30)).toBe(offeredNear);
  });

  it('never picks a Thornhollow Fields fighter, who revives on the team wave', () => {
    const { sim, p } = caster('paladin', 'protection', 12);
    const fighter = fall(member(sim, p, 'Fighter', 3));
    const other = fall(member(sim, p, 'Other', 9));
    // Presence in bgMatches is the whole rule offerResurrection applies.
    sim.ctx.bgMatches.set(fighter.id, {} as never);
    expect(pickFallenAlly(sim.ctx, p, 30)).toBe(other);
    sim.ctx.bgMatches.set(other.id, {} as never);
    expect(pickFallenAlly(sim.ctx, p, 30)).toBeNull();
  });

  it('picks nobody for a caster with no group', () => {
    const { sim, p } = caster('paladin', 'protection', 12);
    expect(pickFallenAlly(sim.ctx, p, 30)).toBeNull();
  });
});

describe('Recall the Fallen with no dead target selected', () => {
  for (const spec of ['protection', 'retribution'] as const) {
    it(`raises the nearest fallen member for a ${spec} paladin who selected nobody`, () => {
      const { sim, p } = caster('paladin', spec, 12);
      const fallen = fall(member(sim, p, 'Fallen', 2));
      sim.targetEntity(null);

      sim.castAbility(REZ);
      const events = sim.tick();
      expect(errorsOf(events)).toEqual([]);
      expect(p.castingAbility).toBe(REZ);
      expect(finishOffers(sim)).toEqual(new Set([fallen.id]));
    });
  }

  it('looks past a living member the paladin has selected', () => {
    const { sim, p } = caster('paladin', 'protection', 12);
    const tank = member(sim, p, 'Living Tank', 3);
    const fallen = fall(member(sim, p, 'Fallen', 6));
    sim.targetEntity(tank.id);

    sim.castAbility(REZ);
    expect(p.castingAbility).toBe(REZ);
    expect(finishOffers(sim)).toEqual(new Set([fallen.id]));
  });

  it('does not let a party-frame hover over a living member steal a selected body', () => {
    const { sim, p } = caster('paladin', 'protection', 12);
    const tank = member(sim, p, 'Living Tank', 3);
    const chosen = fall(member(sim, p, 'Chosen Fallen', 10));
    fall(member(sim, p, 'Nearer Fallen', 4));
    sim.targetEntity(chosen.id);

    // The mouse rests on the tank's frame as the key goes down.
    sim.castAbilityOn(REZ, tank.id);
    expect(p.castingAbility).toBe(REZ);
    expect(finishOffers(sim)).toEqual(new Set([chosen.id]));
  });

  it('calls back the whole group for a Sunmender of 16 with nobody selected', () => {
    const { sim, p } = caster('paladin', 'holy', 16);
    const first = fall(member(sim, p, 'Fallen One', 3));
    const second = fall(member(sim, p, 'Fallen Two', -4));
    sim.targetEntity(null);

    sim.castAbility(REZ);
    expect(p.castingAbility).toBe(REZ);
    expect(finishOffers(sim)).toEqual(new Set([first.id, second.id]));
  });

  it('refuses with the group-rez wording when nobody is dead, spending nothing', () => {
    const { sim, p } = caster('paladin', 'protection', 12);
    member(sim, p, 'Living Tank', 3);
    const mana = p.resource;

    sim.castAbility(REZ);
    expect(errorsOf(sim.tick())).toEqual(['There are no dead group members to resurrect.']);
    expect(p.castingAbility).toBeNull();
    // A cast that starts arms the global cooldown at once; mana and the rez
    // cooldown bill at the finish, so the whole cast time must pass clean too.
    expect(p.gcdRemaining).toBe(0);
    finishOffers(sim);
    expect(p.resource).toBe(mana);
    expect(p.cooldowns.has(REZ)).toBe(false);
  });

  it('refuses the same way for a paladin with no group at all', () => {
    const { sim, p } = caster('paladin', 'protection', 12);
    sim.castAbility(REZ);
    expect(errorsOf(sim.tick())).toEqual(['There are no dead group members to resurrect.']);
    expect(p.castingAbility).toBeNull();
  });

  it('refuses out of range when every body is beyond reach', () => {
    const { sim, p } = caster('paladin', 'protection', 12);
    fall(member(sim, p, 'Beyond Reach', 35));
    const mana = p.resource;

    sim.castAbility(REZ);
    expect(errorsOf(sim.tick())).toEqual(['Out of range.']);
    expect(p.castingAbility).toBeNull();
    expect(p.gcdRemaining).toBe(0);
    finishOffers(sim);
    expect(p.resource).toBe(mana);
    expect(p.cooldowns.has(REZ)).toBe(false);
  });

  it('keeps a selected body beyond reach when a hover over a living frame rides the press', () => {
    // The auto-pick's own current-target arm: the hover (a living member) fails
    // the explicit resolution, and the selected body must still win over a
    // nearer one in reach.
    const { sim, p } = caster('paladin', 'protection', 12);
    const tank = member(sim, p, 'Living Tank', 3);
    const chosen = fall(member(sim, p, 'Chosen Far', 35));
    fall(member(sim, p, 'In Reach', 4));
    sim.targetEntity(chosen.id);

    sim.castAbilityOn(REZ, tank.id);
    expect(errorsOf(sim.tick())).toEqual(['Out of range.']);
    expect(p.castingAbility).toBeNull();
  });

  it('keeps an explicitly selected body out of range rather than swapping it', () => {
    const { sim, p } = caster('paladin', 'protection', 12);
    const chosen = fall(member(sim, p, 'Chosen Far', 35));
    fall(member(sim, p, 'In Reach', 4));
    sim.targetEntity(chosen.id);

    sim.castAbility(REZ);
    expect(errorsOf(sim.tick())).toEqual(['Out of range.']);
    expect(p.castingAbility).toBeNull();
  });
});

describe('combat resurrections still need an explicit dead target', () => {
  it('refuses Temporal Reversal with nobody selected even with a body in reach', () => {
    const { sim, p } = caster('mage', 'arcane', 16);
    const fallen = fall(member(sim, p, 'Fallen', 2));
    sim.targetEntity(null);

    sim.castAbility('temporal_reversal');
    expect(errorsOf(sim.tick())).toEqual(['You must target a dead ally in your group.']);
    expect(p.castingAbility).toBeNull();

    // The same body, selected, casts: the refusal above was the missing target.
    sim.targetEntity(fallen.id);
    sim.castAbility('temporal_reversal');
    expect(p.castingAbility).toBe('temporal_reversal');
  });
});
