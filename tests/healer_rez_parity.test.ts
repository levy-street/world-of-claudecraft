// Healer resurrection parity (owner directive 2026-09-01, recorded in
// docs/design/resurrection-cooldowns.md): every primary healer class fields a
// resurrection, and every healer rez shares the five-minute cooldown. Benison/Doctrine priests and Groveheart druids gain their rezzes
// here (prayer_of_returning, wildwake, grove_awakening); the paladin's Recall
// the Fallen joins the shared cooldown. Chronomancy's Temporal Reversal keeps
// its deliberately longer ten-minute combat-rez cooldown.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ABILITIES, abilitiesKnownAt } from '../src/sim/content/classes';
import { computeTalentModifiers, emptyAllocation } from '../src/sim/content/talents';
import { Sim } from '../src/sim/sim';
import type { Entity, PlayerClass, SimEvent } from '../src/sim/types';
import { en, zh_CN } from '../src/ui/i18n.resolved.generated';
import { abilityIconRecipe, hasExplicitAbilityIcon } from '../src/ui/icons';

const SHARED_REZ_COOLDOWN = 300;

function knownAt(playerClass: PlayerClass, spec: string): Set<string> {
  const mods = computeTalentModifiers(playerClass, { ...emptyAllocation(), spec }, 20);
  return new Set(abilitiesKnownAt(playerClass, 20, mods).map((ability) => ability.def.id));
}

function advance(sim: Sim, seconds: number): SimEvent[] {
  const events: SimEvent[] = [];
  for (let tick = 0; tick < seconds * 20; tick++) events.push(...sim.tick());
  return events;
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

function healerSim(playerClass: PlayerClass, spec: string, seed: number): Sim {
  const sim = new Sim({ seed, playerClass });
  sim.setPlayerLevel(20);
  expect(sim.setSpec(spec)).toBe(true);
  sim.tick();
  sim.player.resource = sim.player.maxResource;
  return sim;
}

function addFallenPartyMember(sim: Sim, name: string): Entity {
  const pid = sim.addPlayer('warrior', name);
  sim.partyInvite(pid, sim.playerId);
  sim.partyAccept(pid);
  const fallen = sim.entities.get(pid) as Entity;
  killAt(fallen, sim.player.pos.x + 2, sim.player.pos.z);
  return fallen;
}

describe('healer resurrection cooldown parity', () => {
  it('gives every healer rez the shared five-minute cooldown', () => {
    for (const id of [
      'recall_the_fallen',
      'ancestor_return',
      'prayer_of_returning',
      'wildwake',
      'grove_awakening',
    ]) {
      expect(ABILITIES[id].cooldown, id).toBe(SHARED_REZ_COOLDOWN);
    }
    // The mass rezzes stay pinned to the Chronomancy twin so no group revive
    // outclasses another; the cooldown limits repeats across encounters,
    // while requiresOutOfCombat blocks casts during an active combat hold.
    for (const id of ['prayer_of_returning', 'grove_awakening']) {
      const def = ABILITIES[id];
      expect(def.cooldown, id).toBe(ABILITIES.collective_reversal.cooldown);
      expect(def.cooldown, id).toBeGreaterThan(def.castTime + 5);
    }
    // Deliberately unchanged: Chronomancy's combat rez keeps a death costlier.
    expect(ABILITIES.temporal_reversal.cooldown).toBe(600);
  });

  it('renders the single-rez glyph in the ability school, not a hardcoded arcane', () => {
    // The resurrectAlly dispatch emits school: ability.school so Wildwake
    // blooms nature and the Sunmender rite holy. The renderer's temporalGlyph
    // branch must thread ev.school through, or the sim-side school is dead at
    // the pixel. Source pin, since the renderer has no unit seam here.
    const rendererSource = readFileSync(
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/render/renderer.ts'),
      'utf8',
    );
    const branchStart = rendererSource.indexOf("ev.fx === 'temporalGlyph'");
    expect(branchStart).toBeGreaterThan(-1);
    const branch = rendererSource.slice(branchStart, rendererSource.indexOf('} else', branchStart));
    expect(branch).toContain('wardBloom(ev.targetId, ev.school)');
    expect(branch).not.toContain("'arcane'");
  });

  it('refuses both new mass rezzes in combat: requiresOutOfCombat is live', () => {
    const cases = [
      { playerClass: 'priest' as const, spec: 'holy', id: 'prayer_of_returning', seed: 4484 },
      { playerClass: 'druid' as const, spec: 'restoration', id: 'grove_awakening', seed: 4485 },
    ];
    for (const { playerClass, spec, id, seed } of cases) {
      const sim = healerSim(playerClass, spec, seed);
      const fallen = addFallenPartyMember(sim, 'Fallen In Combat');

      // A dead member is in reach and mana is full: only the combat gate may
      // refuse this cast.
      sim.player.inCombat = true;
      sim.player.combatTimer = 0;
      const mana = sim.player.resource;
      sim.castAbility(id);
      expect(sim.player.castingAbility, id).toBeNull();
      expect(sim.player.resource, id).toBe(mana);
      expect(fallen.dead, id).toBe(true);

      // Leaving combat with everything else unchanged lets the identical cast
      // start, proving the refusal above was the combat gate.
      sim.player.inCombat = false;
      sim.castAbility(id);
      expect(sim.player.castingAbility, id).toBe(id);
    }
  });
});

describe('Prayer of Returning content', () => {
  it('belongs to both healing priest specs as a seven-second out-of-combat mass rez', () => {
    expect(ABILITIES.prayer_of_returning).toMatchObject({
      class: 'priest',
      specs: ['holy', 'discipline'],
      learnLevel: 20,
      castTime: 7,
      cooldown: SHARED_REZ_COOLDOWN,
      requiresTarget: false,
      requiresOutOfCombat: true,
    });
    expect(ABILITIES.prayer_of_returning.effects).toContainEqual({
      type: 'massResurrectGroup',
      hpFrac: 0.3,
    });
    expect(knownAt('priest', 'holy')).toContain('prayer_of_returning');
    expect(knownAt('priest', 'discipline')).toContain('prayer_of_returning');
    expect(knownAt('priest', 'shadow')).not.toContain('prayer_of_returning');
  });

  it('ships a distinct icon and localized spellbook text', () => {
    expect(hasExplicitAbilityIcon('prayer_of_returning')).toBe(true);
    expect(abilityIconRecipe('prayer_of_returning')).not.toEqual(
      abilityIconRecipe('collective_reversal'),
    );
    expect(abilityIconRecipe('prayer_of_returning')).not.toEqual(
      abilityIconRecipe('prayer_of_healing'),
    );
    expect(en.entities.abilities.prayer_of_returning.name).toBe('Prayer of Returning');
    expect(en.entities.abilities.prayer_of_returning.description).toContain('group or raid');
    expect(en.entities.abilities.prayer_of_returning.description).toContain('30%');
    // The M16 non-Latin fills land in the same change as the wordy English rows.
    expect(zh_CN.entities.abilities.prayer_of_returning.name).toBe('归返祈祷');
    expect(zh_CN.entities.abilities.prayer_of_returning.description).toContain('30%');
  });

  it('revives every offered dead group member and then runs the cooldown', () => {
    const sim = healerSim('priest', 'holy', 4481);
    const fallen = addFallenPartyMember(sim, 'Fallen Friend');

    sim.castAbility('prayer_of_returning');
    expect(sim.player.castingAbility).toBe('prayer_of_returning');
    advance(sim, 7.05);
    expect(sim.player.castingAbility).toBeNull();
    sim.respondToResurrection(true, fallen.id);
    expect(fallen.dead).toBe(false);
    expect(fallen.hp / fallen.maxHp).toBeGreaterThanOrEqual(0.29);
    expect(fallen.hp / fallen.maxHp).toBeLessThanOrEqual(0.31);

    const remaining = sim.player.cooldowns.get('prayer_of_returning') ?? 0;
    expect(remaining).toBeGreaterThan(290);
    expect(remaining).toBeLessThanOrEqual(SHARED_REZ_COOLDOWN);

    // The same member dies again with the priest unambiguously out of combat and
    // full on mana: only the cooldown may refuse the second cast.
    killAt(fallen, sim.player.pos.x + 2, sim.player.pos.z);
    sim.player.inCombat = false;
    sim.player.combatTimer = 99;
    sim.player.resource = sim.player.maxResource;
    sim.castAbility('prayer_of_returning');
    expect(sim.player.castingAbility).toBeNull();
    expect(fallen.dead).toBe(true);
    sim.player.cooldowns.delete('prayer_of_returning');
    sim.castAbility('prayer_of_returning');
    expect(sim.player.castingAbility).toBe('prayer_of_returning');
  });
});

describe('Grove Awakening content', () => {
  it('belongs only to Groveheart as a seven-second out-of-combat mass rez', () => {
    expect(ABILITIES.grove_awakening).toMatchObject({
      class: 'druid',
      specs: ['restoration'],
      learnLevel: 20,
      castTime: 7,
      cooldown: SHARED_REZ_COOLDOWN,
      requiresTarget: false,
      requiresOutOfCombat: true,
    });
    expect(ABILITIES.grove_awakening.effects).toContainEqual({
      type: 'massResurrectGroup',
      hpFrac: 0.3,
    });
    expect(knownAt('druid', 'restoration')).toContain('grove_awakening');
    expect(knownAt('druid', 'balance')).not.toContain('grove_awakening');
    expect(knownAt('druid', 'feral')).not.toContain('grove_awakening');
    expect(hasExplicitAbilityIcon('grove_awakening')).toBe(true);
    expect(abilityIconRecipe('grove_awakening')).not.toEqual(abilityIconRecipe('ancestor_return'));
    expect(en.entities.abilities.grove_awakening.name).toBe('Grove Awakening');
    expect(zh_CN.entities.abilities.grove_awakening.name).toBe('林地觉醒');
  });

  it('revives an offered dead group member out of combat', () => {
    const sim = healerSim('druid', 'restoration', 4482);
    const fallen = addFallenPartyMember(sim, 'Fallen Grove');

    sim.castAbility('grove_awakening');
    expect(sim.player.castingAbility).toBe('grove_awakening');
    advance(sim, 7.05);
    expect(sim.player.castingAbility).toBeNull();
    sim.respondToResurrection(true, fallen.id);
    expect(fallen.dead).toBe(false);
    expect(fallen.hp / fallen.maxHp).toBeGreaterThanOrEqual(0.29);
    expect(fallen.hp / fallen.maxHp).toBeLessThanOrEqual(0.31);
    const remaining = sim.player.cooldowns.get('grove_awakening') ?? 0;
    expect(remaining).toBeGreaterThan(290);
  });
});

describe('Wildwake content', () => {
  it('is the Groveheart in-combat single rez on the shared five-minute cooldown', () => {
    expect(ABILITIES.wildwake).toMatchObject({
      class: 'druid',
      specs: ['restoration'],
      learnLevel: 16,
      castTime: 2,
      cooldown: SHARED_REZ_COOLDOWN,
      range: 30,
      requiresTarget: true,
      targetType: 'friendly',
      targetsDead: true,
    });
    expect(ABILITIES.wildwake.requiresOutOfCombat).toBeUndefined();
    expect(ABILITIES.wildwake.effects).toContainEqual({ type: 'resurrectAlly', hpFrac: 0.35 });
    expect(knownAt('druid', 'restoration')).toContain('wildwake');
    expect(knownAt('druid', 'balance')).not.toContain('wildwake');
    expect(knownAt('druid', 'feral')).not.toContain('wildwake');
    expect(hasExplicitAbilityIcon('wildwake')).toBe(true);
    expect(abilityIconRecipe('wildwake')).not.toEqual(abilityIconRecipe('temporal_reversal'));
    expect(en.entities.abilities.wildwake.name).toBe('Wildwake');
    expect(en.entities.abilities.wildwake.description).toContain('35%');
    expect(zh_CN.entities.abilities.wildwake.name).toBe('野性复苏');
  });

  it('revives a dead group member mid-combat with nature-school spellfx', () => {
    const sim = healerSim('druid', 'restoration', 4483);
    const fallen = addFallenPartyMember(sim, 'Fallen Wild');

    // The cast must start while the druid is IN combat: that is the whole point
    // of a combat rez (requiresOutOfCombat would refuse right here).
    sim.player.inCombat = true;
    sim.player.combatTimer = 0;
    sim.player.targetId = fallen.id;
    sim.castAbility('wildwake');
    expect(sim.player.castingAbility).toBe('wildwake');
    const events = advance(sim, 2.05);
    expect(sim.player.castingAbility).toBeNull();
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'spellfx', ability: 'wildwake', school: 'nature' }),
    );

    sim.respondToResurrection(true, fallen.id);
    expect(fallen.dead).toBe(false);
    expect(fallen.hp / fallen.maxHp).toBeGreaterThanOrEqual(0.34);
    expect(fallen.hp / fallen.maxHp).toBeLessThanOrEqual(0.36);

    const remaining = sim.player.cooldowns.get('wildwake') ?? 0;
    expect(remaining).toBeGreaterThan(290);
    expect(remaining).toBeLessThanOrEqual(SHARED_REZ_COOLDOWN);
  });
});
