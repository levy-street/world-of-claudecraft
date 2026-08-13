// Recall the Fallen upgrades in place for the healer: from level 16 a Sunmender's
// rite calls back the whole group instead of the one body it was begun over. The
// other two specs keep the single-target rite at every level.
//
// Pinned at both layers: the predicate's spec/level edges, and the live dispatch,
// because "one button, two behaviours" is only true if the effect path agrees
// with the predicate.

import { describe, expect, it } from 'vitest';
import {
  RITE_OF_MANY_ABILITY_ID,
  RITE_OF_MANY_LEVEL,
  riteAnswersTheWholeGroup,
} from '../src/sim/combat/paladin_rite_of_many';
import { ABILITIES } from '../src/sim/content/classes';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';

type AnySim = Sim & Record<string, any>;

// A Sunmender who has already earned the rite, at the level under test.
function sunmender(level: number): { sim: AnySim; paladin: Entity } {
  const sim = new Sim({ seed: 616, playerClass: 'paladin', autoEquip: true }) as AnySim;
  sim.setPlayerLevel(level);
  expect(sim.setSpec('holy')).toBe(true);
  // The rite is quest-earned, not trained: hand it the completed chain.
  const meta = sim.players.get(sim.playerId)!;
  meta.questsDone.add('q_rite_of_redemption');
  sim.setPlayerLevel(level);
  const paladin = sim.player as Entity;
  paladin.resource = paladin.maxResource;
  return { sim, paladin };
}

function addFallen(sim: AnySim, leader: Entity, name: string): Entity {
  const pid = sim.addPlayer('warrior', name);
  sim.partyInvite(pid, leader.id);
  sim.partyAccept(pid);
  const member = sim.entities.get(pid) as Entity;
  member.pos = { x: leader.pos.x + 2, y: leader.pos.y, z: leader.pos.z + 2 };
  member.prevPos = { ...member.pos };
  member.dead = true;
  member.ghost = false;
  member.corpsePos = { ...member.pos };
  member.hp = 0;
  member.resource = 0;
  return member;
}

// Drives one full rite and returns the ids it offered a resurrection to.
function riteOffers(sim: AnySim, at: Entity): Set<number> {
  sim.targetEntity(at.id);
  sim.castAbility(RITE_OF_MANY_ABILITY_ID);
  const offered = new Set<number>();
  for (let tick = 0; tick < 20 * 9; tick++) {
    for (const event of sim.tick()) {
      if (event.type === 'resurrectionOffer' && event.pid !== undefined) {
        offered.add(event.pid);
      }
    }
  }
  return offered;
}

describe('Rite of many: the predicate', () => {
  it('answers for the group only as Holy, only from level 16', () => {
    expect(riteAnswersTheWholeGroup(RITE_OF_MANY_ABILITY_ID, 'holy', RITE_OF_MANY_LEVEL)).toBe(
      true,
    );
    expect(riteAnswersTheWholeGroup(RITE_OF_MANY_ABILITY_ID, 'holy', 20)).toBe(true);
  });

  it('keeps the single-target rite one level short of the upgrade', () => {
    expect(riteAnswersTheWholeGroup(RITE_OF_MANY_ABILITY_ID, 'holy', RITE_OF_MANY_LEVEL - 1)).toBe(
      false,
    );
  });

  it('keeps the single-target rite for the other specs at every level', () => {
    for (const spec of ['protection', 'retribution']) {
      for (const level of [RITE_OF_MANY_LEVEL, 20]) {
        expect(
          riteAnswersTheWholeGroup(RITE_OF_MANY_ABILITY_ID, spec, level),
          `${spec} at ${level}`,
        ).toBe(false);
      }
    }
    // No spec chosen yet, and a caller that cannot say: both fail closed.
    expect(riteAnswersTheWholeGroup(RITE_OF_MANY_ABILITY_ID, null, 20)).toBe(false);
    expect(riteAnswersTheWholeGroup(RITE_OF_MANY_ABILITY_ID, undefined, 20)).toBe(false);
  });

  it('does not widen any other resurrection', () => {
    // Collective Reversal is already a mass rite and must not route through here;
    // Temporal Reversal is the mage's single-target one.
    expect(riteAnswersTheWholeGroup('collective_reversal', 'holy', 20)).toBe(false);
    expect(riteAnswersTheWholeGroup('temporal_reversal', 'holy', 20)).toBe(false);
  });

  it('upgrades a rite the paladin can actually own by then', () => {
    // The quest that teaches it opens at 6, so the level 16 upgrade can never be
    // stranded behind an ability the healer has not earned yet.
    const def = ABILITIES[RITE_OF_MANY_ABILITY_ID];
    expect(def).toBeDefined();
    expect(def.learnLevel).toBeLessThanOrEqual(RITE_OF_MANY_LEVEL);
    expect(def.effects.some((e) => e.type === 'resurrectAlly')).toBe(true);
  });
});

describe('Rite of many: the live cast', () => {
  it('calls back every fallen member for a Sunmender of 16', () => {
    const { sim, paladin } = sunmender(RITE_OF_MANY_LEVEL);
    const first = addFallen(sim, paladin, 'Fallen One');
    const second = addFallen(sim, paladin, 'Fallen Two');

    const offered = riteOffers(sim, first);
    expect(offered.has(first.id), 'the body the rite was begun over').toBe(true);
    expect(offered.has(second.id), 'the other fallen member').toBe(true);
  });

  it('still calls back only the target one level short of the upgrade', () => {
    const { sim, paladin } = sunmender(RITE_OF_MANY_LEVEL - 1);
    const first = addFallen(sim, paladin, 'Fallen One');
    const second = addFallen(sim, paladin, 'Fallen Two');

    const offered = riteOffers(sim, first);
    expect(offered.has(first.id)).toBe(true);
    expect(offered.has(second.id), 'must stay single-target below 16').toBe(false);
  });
});
