import { describe, expect, it } from 'vitest';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import type { PlayerMeta } from '../src/sim/sim';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';

// Reproduces: "if you die in a raid/group you don't get to loot at all."
// A party member who is downed during the fight, but whose corpse is still
// next to the mob when it dies, must keep classic group rights: kill credit,
// shared XP, quest progress, and loot eligibility. The bug was that the
// eligibility loops in handleDeath and partyLootCandidatesForMob filtered on
// `!entity.dead`, silently dropping the fallen member from every reward.

type SimInternals = {
  players: Map<number, PlayerMeta>;
  entities: Map<number, Entity>;
  // parties / partyByPid moved onto the PartyMachine (src/sim/social/party.ts, A1).
  party: {
    parties: Map<
      number,
      {
        id: number;
        leader: number;
        members: number[];
        lootStrategies: { currency: string; commonItems: string; premiumItems: string };
      }
    >;
    partyByPid: Map<number, number>;
  };
  handleDeath: (mob: Entity, killer: Entity | null) => void;
  partyLootCandidatesForMob: (mob: Entity) => PlayerMeta[];
};

function mustNumber(value: number | undefined, label: string): number {
  if (value === undefined) throw new Error(`missing ${label}`);
  return value;
}

function setup() {
  const sim = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
  const internals = sim as unknown as SimInternals;
  // Survivor lands the killing blow; Faller dies during the fight.
  const survivor = sim.addPlayer('warrior', 'Survivor');
  const faller = sim.addPlayer('mage', 'Faller');
  sim.tick();
  sim.partyInvite(faller, survivor);
  sim.partyAccept(faller);

  // Both stand on the mob so the party-XP range gate is trivially satisfied.
  const sE = internals.entities.get(survivor)!;
  const fE = internals.entities.get(faller)!;
  for (const e of [sE, fE]) {
    e.pos = { x: 0, y: 0, z: 0 };
    e.prevPos = { x: 0, y: 0, z: 0 };
  }

  const template = MOBS.forest_wolf;
  const mob = createMob(9999, template, template.maxLevel, { x: 0, y: 0, z: 0 });
  mob.tappedById = survivor; // the group owns the tag
  internals.entities.set(mob.id, mob);

  return { sim, internals, survivor, faller, sE, fE, mob };
}

describe('downed party member keeps loot/xp rights (classic group rules)', () => {
  it('a fallen member whose corpse is in range still earns shared kill XP', () => {
    const { internals, faller, fE, mob } = setup();
    fE.dead = true; // downed during the fight, corpse left on the mob

    const before = mustNumber(internals.players.get(faller)?.lifetimeXp, 'before xp');
    internals.handleDeath(mob, internals.entities.get(mob.tappedById!) ?? null);
    const after = mustNumber(internals.players.get(faller)?.lifetimeXp, 'after xp');

    expect(after).toBeGreaterThan(before);
  });

  it('a fallen member is still a loot candidate for currency split / need-greed rolls', () => {
    const { internals, survivor, faller, fE, mob } = setup();
    fE.dead = true;

    const party = internals.party.parties.get(internals.party.partyByPid.get(survivor)!)!;
    party.lootStrategies.currency = 'fair-split';

    const candidates = internals.partyLootCandidatesForMob(mob).map((m) => m.entityId);
    expect(candidates).toContain(faller);
    expect(candidates).toContain(survivor);
  });

  it('a fallen member who releases spirit after the kill is still a loot candidate', () => {
    const { sim, internals, survivor, faller, fE, mob } = setup();
    const sE = internals.entities.get(survivor)!;
    for (const e of [sE, fE, mob]) {
      e.pos = { x: 120, y: 0, z: 120 };
      e.prevPos = { ...e.pos };
    }
    fE.dead = true;

    internals.handleDeath(mob, internals.entities.get(mob.tappedById!) ?? null);
    expect(mob.lootRecipientIds).toEqual(expect.arrayContaining([survivor, faller]));
    sim.releaseSpirit(faller);

    const candidates = internals.partyLootCandidatesForMob(mob).map((m) => m.entityId);
    expect(candidates).toContain(faller);
    expect(candidates).toContain(survivor);
  });

  it('an alive nearby member still earns XP (no regression)', () => {
    const { internals, faller, mob } = setup();
    // faller stays alive this time
    const before = mustNumber(internals.players.get(faller)?.lifetimeXp, 'before xp');
    internals.handleDeath(mob, internals.entities.get(mob.tappedById!) ?? null);
    const after = mustNumber(internals.players.get(faller)?.lifetimeXp, 'after xp');
    expect(after).toBeGreaterThan(before);
  });

  it('a member out of range gets nothing, alive or dead', () => {
    const { internals, faller, fE, mob } = setup();
    fE.pos = { x: 500, y: 0, z: 500 }; // far from the kill
    fE.prevPos = { ...fE.pos };
    const before = internals.players.get(faller)?.lifetimeXp;
    internals.handleDeath(mob, internals.entities.get(mob.tappedById!) ?? null);
    const after = internals.players.get(faller)?.lifetimeXp;
    expect(after).toBe(before);
  });
});
