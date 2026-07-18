import { describe, expect, it, vi } from 'vitest';
import { ClientWorld } from '../src/net/online';
import { abilitiesKnownAt } from '../src/sim/content/classes';
import { computeTalentModifiers, emptyAllocation } from '../src/sim/content/talents';
import { ABILITIES } from '../src/sim/data';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';
import { en, es, es_ES } from '../src/ui/i18n.resolved.generated';
import { abilityIconRecipe, hasExplicitAbilityIcon } from '../src/ui/icons';

const ABILITY_ID = 'collective_reversal';

function chronomancer(): { sim: Sim; mage: Entity } {
  const sim = new Sim({ seed: 73, playerClass: 'mage' });
  sim.setPlayerLevel(20);
  expect(sim.setSpec('arcane')).toBe(true);
  sim.tick();
  const mage = sim.player;
  mage.resource = mage.maxResource;
  return { sim, mage };
}

function addToGroup(sim: Sim, leader: Entity, cls: 'mage' | 'priest' | 'warrior', name: string) {
  const pid = sim.addPlayer(cls, name);
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

describe('Collective Reversal content', () => {
  it('belongs only to Chronomancy and is a seven-second untargeted mass resurrection', () => {
    const def = ABILITIES[ABILITY_ID];
    expect(def).toMatchObject({
      class: 'mage',
      specs: ['arcane'],
      learnLevel: 8,
      castTime: 7,
      requiresTarget: false,
      requiresOutOfCombat: true,
    });
    expect(def.effects).toContainEqual({ type: 'massResurrectGroup', hpFrac: 0.3 });

    const known = (spec: 'arcane' | 'fire' | 'frost') =>
      abilitiesKnownAt(
        'mage',
        8,
        computeTalentModifiers('mage', { ...emptyAllocation(), spec }),
      ).map((ability) => ability.def.id);
    expect(known('arcane')).toContain(ABILITY_ID);
    expect(known('fire')).not.toContain(ABILITY_ID);
    expect(known('frost')).not.toContain(ABILITY_ID);
  });

  it('ships distinct icon and localized spellbook text', () => {
    expect(hasExplicitAbilityIcon(ABILITY_ID)).toBe(true);
    expect(abilityIconRecipe(ABILITY_ID)).not.toEqual(abilityIconRecipe('temporal_reversal'));
    expect(en.entities.abilities.collective_reversal.name).toBe('Collective Reversal');
    expect(en.entities.abilities.collective_reversal.description).toContain('group or raid');
    expect(en.entities.abilities.collective_reversal.description).toContain('30%');
    expect(es.entities.abilities.collective_reversal.name).toBe('Reversión colectiva');
    expect(es.entities.abilities.collective_reversal.description).toContain('grupo o banda');
    expect(es.entities.abilities.collective_reversal.description).toContain('30%');
    expect(es_ES.entities.abilities.collective_reversal).toEqual(
      es.entities.abilities.collective_reversal,
    );
  });
});

describe('Collective Reversal behavior', () => {
  it('finishes after seven seconds and offers every dead raid member a resurrection', () => {
    const { sim, mage } = chronomancer();
    const fallenWarrior = addToGroup(sim, mage, 'warrior', 'Fallen Warrior');
    const fallenPriest = addToGroup(sim, mage, 'priest', 'Fallen Priest');
    const livingMage = addToGroup(sim, mage, 'mage', 'Living Mage');
    const fallenMage = addToGroup(sim, mage, 'mage', 'Fallen Mage');
    sim.convertPartyToRaid(mage.id);
    expect(sim.partyOf(mage.id)?.raid).toBe(true);

    killAt(fallenWarrior, mage.pos.x + 3, mage.pos.z + 2);
    killAt(fallenPriest, mage.pos.x + 120, mage.pos.z + 80);
    const priestCorpse = { ...(fallenPriest.corpsePos ?? fallenPriest.pos) };
    fallenPriest.ghost = true;
    fallenPriest.pos = { x: mage.pos.x + 200, y: mage.pos.y, z: mage.pos.z + 200 };
    fallenPriest.prevPos = { ...fallenPriest.pos };
    killAt(fallenMage, mage.pos.x - 90, mage.pos.z - 70);
    const livingHp = livingMage.hp;

    const strangerId = sim.addPlayer('priest', 'Stranger');
    const stranger = sim.entities.get(strangerId) as Entity;
    killAt(stranger, mage.pos.x + 1, mage.pos.z + 1);

    mage.targetId = null;
    sim.castAbility(ABILITY_ID);
    expect(mage.castingAbility).toBe(ABILITY_ID);
    expect(mage.castTotal).toBeCloseTo(7, 6);

    for (let tick = 0; tick < 139; tick++) sim.tick();
    expect(fallenWarrior.dead).toBe(true);
    expect(fallenPriest.dead).toBe(true);
    expect(fallenMage.dead).toBe(true);

    const completionEvents = sim.tick();
    mage.pos.x += 50;
    mage.pos.z += 50;
    const currentCasterPosition = { x: mage.pos.x, z: mage.pos.z };
    for (const offered of [fallenWarrior, fallenPriest, fallenMage]) {
      expect(offered.dead).toBe(true);
      expect(completionEvents).toContainEqual(
        expect.objectContaining({
          type: 'resurrectionOffer',
          pid: offered.id,
          fromName: mage.name,
        }),
      );
      sim.respondToResurrection(true, offered.id);
      expect(offered.dead).toBe(false);
      expect(offered.ghost).toBe(false);
      expect(offered.corpsePos).toBeNull();
      expect(offered.pos.x).toBe(currentCasterPosition.x);
      expect(offered.pos.z).toBe(currentCasterPosition.z);
      expect(offered.hp).toBe(Math.round(offered.maxHp * 0.3));
    }
    expect(livingMage.hp).toBe(livingHp);
    expect(stranger.dead).toBe(true);
    expect(completionEvents).toContainEqual(
      expect.objectContaining({
        type: 'spellfxAt',
        x: priestCorpse.x,
        z: priestCorpse.z,
        school: 'arcane',
      }),
    );
  });

  it('does not start without a dead group member or while the caster is in combat', () => {
    const { sim, mage } = chronomancer();
    const mana = mage.resource;

    sim.castAbility(ABILITY_ID);
    expect(mage.castingAbility).toBeNull();
    expect(mage.resource).toBe(mana);

    const fallen = addToGroup(sim, mage, 'warrior', 'Fallen');
    killAt(fallen, mage.pos.x + 2, mage.pos.z);
    mage.inCombat = true;
    sim.castAbility(ABILITY_ID);
    expect(mage.castingAbility).toBeNull();
    expect(fallen.dead).toBe(true);
    expect(mage.resource).toBe(mana);
  });

  it('cancels authoritatively if the caster enters combat during the cast', () => {
    const { sim, mage } = chronomancer();
    const fallen = addToGroup(sim, mage, 'warrior', 'Fallen During Pull');
    killAt(fallen, mage.pos.x + 2, mage.pos.z);
    const mana = mage.resource;

    sim.castAbility(ABILITY_ID);
    expect(mage.castingAbility).toBe(ABILITY_ID);
    sim.tick();
    mage.inCombat = true;
    const events = sim.tick();

    expect(mage.castingAbility).toBeNull();
    expect(fallen.dead).toBe(true);
    expect(mage.resource).toBe(mana);
    expect(events).toContainEqual({ type: 'castStop', entityId: mage.id, success: false });
  });

  it('cancels cleanly if another source revives every group member first', () => {
    const { sim, mage } = chronomancer();
    const fallen = addToGroup(sim, mage, 'priest', 'Already Revived');
    killAt(fallen, mage.pos.x + 2, mage.pos.z);

    sim.castAbility(ABILITY_ID);
    sim.tick();
    fallen.dead = false;
    fallen.hp = fallen.maxHp;
    const events = sim.tick();

    expect(mage.castingAbility).toBeNull();
    expect(events).toContainEqual({ type: 'castStop', entityId: mage.id, success: false });
    expect(events).not.toContainEqual({ type: 'castStop', entityId: mage.id, success: true });
  });
});

describe('Collective Reversal online command path', () => {
  it('uses the standard authoritative no-target cast command', () => {
    const client = Object.create(ClientWorld.prototype) as {
      castAbility(abilityId: string): void;
      cmd: ReturnType<typeof vi.fn>;
    };
    Object.assign(client, {
      entities: new Map([[1, { id: 1, targetId: null }]]),
      playerId: 1,
      eventQueue: [],
      known: [{ def: ABILITIES[ABILITY_ID] }],
      cmd: vi.fn(),
    });

    client.castAbility(ABILITY_ID);

    expect(client.cmd).toHaveBeenCalledWith({ cmd: 'cast', ability: ABILITY_ID });
  });

  it('sends the resurrection response over the dedicated combat command', () => {
    const client = Object.create(ClientWorld.prototype) as {
      respondToResurrection(accept: boolean): void;
      cmd: ReturnType<typeof vi.fn>;
    };
    client.cmd = vi.fn();

    client.respondToResurrection(true);

    expect(client.cmd).toHaveBeenCalledWith({ cmd: 'resurrect_respond', accept: true });
  });
});
