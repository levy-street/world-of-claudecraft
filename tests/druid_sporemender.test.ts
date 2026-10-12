// Groveheart's Sporemender Form (combat/druid_sporemender.ts): the healer twin
// of Moonwing Form. Pins the spec gate, the second Groveheart signature beside
// Fleetmend, the toggle, the +40% armor, the 20% slower pace, the +20% healing
// done on BOTH direct heals and owned HoT ticks (read live from the form aura),
// the Loping Stride grant on the shift, and that every caster-form spell stays
// castable while worn.
import { describe, expect, it } from 'vitest';
import { updateAuras } from '../src/sim/combat/auras';
import {
  SPOREMENDER_ARMOR_MULT,
  SPOREMENDER_HEALING_DONE_PCT,
  SPOREMENDER_MOVE_SPEED_MULT,
  sporemenderHealingDoneMult,
} from '../src/sim/combat/druid_sporemender';
import { hasFormRequirement } from '../src/sim/combat/form_requirement';
import { applyHeal } from '../src/sim/combat/heal';
import { ABILITIES } from '../src/sim/content/classes';
import { specSignatureIds, TALENTS } from '../src/sim/content/talents';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { moveSpeedMult } from '../src/sim/player_motion';
import { Sim } from '../src/sim/sim';
import type { Aura, Entity, SimEvent } from '../src/sim/types';
import { isFormAuraKind, MAX_LEVEL } from '../src/sim/types';
import { SPEC_CARD_INFO } from '../src/ui/class_details_data';
import { tEntity } from '../src/ui/entity_i18n';
import { cooldownClassAbilityIds } from '../src/ui/hud/cooldown_manager/cooldown_manager_catalog';
import { ensureLocaleLoaded, setLanguage } from '../src/ui/i18n';
import { tTalent } from '../src/ui/talent_i18n';
import { EMPTY_TEST_WORLD } from './sim_shared';

function druid(spec: 'balance' | 'feral' | 'restoration', seed = 4410) {
  const sim = new Sim({ seed, playerClass: 'druid', world: EMPTY_TEST_WORLD });
  sim.setPlayerLevel(MAX_LEVEL);
  expect(sim.setSpec(spec)).toBe(true);
  return sim;
}

function knownIds(sim: Sim): string[] {
  const meta = sim.players.get(sim.playerId);
  if (!meta) throw new Error('missing player meta');
  return meta.known.map((ability) => ability.def.id);
}

function wearsForm(entity: Entity): boolean {
  return entity.auras.some((aura) => aura.kind === 'form_sporemender');
}

function hot(sourceId: number, value: number): Aura {
  return {
    id: 'rejuvenation',
    name: 'Sporemending',
    kind: 'hot',
    remaining: 12,
    duration: 12,
    value,
    sourceId,
    tickInterval: 3,
    tickTimer: 0.01,
  } as Aura;
}

describe('Sporemender Form: definition and spec gate', () => {
  it('is a Restoration-only druid caster form that toggles a form aura', () => {
    const def = ABILITIES.sporemender_form;
    expect(def).toMatchObject({
      name: 'Sporemender Form',
      class: 'druid',
      specs: ['restoration'],
      castTime: 0,
      cooldown: 0,
      requiresTarget: false,
    });
    expect(def.effects).toEqual([
      { type: 'selfBuff', kind: 'form_sporemender', value: 0, duration: 3600 },
    ]);
    expect(isFormAuraKind('form_sporemender')).toBe(true);
  });

  it('only a Groveheart druid knows it', () => {
    expect(knownIds(druid('restoration'))).toContain('sporemender_form');
    expect(knownIds(druid('balance'))).not.toContain('sporemender_form');
    expect(knownIds(druid('feral'))).not.toContain('sporemender_form');
  });

  it('is a Groveheart signature beside Fleetmend, granted on the spec pick', () => {
    const groveheart = TALENTS.druid.specs.find((spec) => spec.id === 'restoration');
    if (!groveheart) throw new Error('missing Groveheart spec');
    expect(groveheart.signature).toBe('swiftmend');
    expect(specSignatureIds(groveheart)).toEqual(['swiftmend', 'sporemender_form']);
    // Like Moonwing for Moongrove, the signature grant arrives with the spec,
    // ahead of the form's level-10 learn level.
    const sim = new Sim({ seed: 4410, playerClass: 'druid', world: EMPTY_TEST_WORLD });
    sim.setPlayerLevel(5);
    expect(sim.setSpec('restoration')).toBe(true);
    expect(knownIds(sim)).toEqual(expect.arrayContaining(['swiftmend', 'sporemender_form']));
    expect(ABILITIES.sporemender_form.description).toContain('(Groveheart signature)');
    // The tooltip's numbers are the live constants, not free-standing copy.
    const pct = (fraction: number): string => `${Math.round(fraction * 100)}%`;
    const tooltip = ABILITIES.sporemender_form.description;
    expect(tooltip).toContain(`healing done by ${pct(SPOREMENDER_HEALING_DONE_PCT)}`);
    expect(tooltip).toContain(`armor by ${pct(SPOREMENDER_ARMOR_MULT - 1)}`);
    expect(tooltip).toContain(`movement speed by ${pct(1 - SPOREMENDER_MOVE_SPEED_MULT)}`);
    expect(tooltip).toContain('All of your caster-form spells stay usable.');
  });

  it('shows both Groveheart signatures on the talent spec page', async () => {
    const groveheart = TALENTS.druid.specs.find((spec) => spec.id === 'restoration');
    if (!groveheart) throw new Error('missing Groveheart spec');
    try {
      await ensureLocaleLoaded('en');
      setLanguage('en');
      expect(tTalent({ kind: 'talentSpec', spec: groveheart, field: 'description' })).toContain(
        'Signatures: Fleetmend and Sporemender Form.',
      );
      // A one-signature spec keeps its singular line byte for byte.
      const moongrove = TALENTS.druid.specs.find((spec) => spec.id === 'balance');
      if (!moongrove) throw new Error('missing Moongrove spec');
      expect(tTalent({ kind: 'talentSpec', spec: moongrove, field: 'description' })).toMatch(
        / Signature: Moonwing Form\.$/,
      );
      // The generated locales list both localized names too.
      await ensureLocaleLoaded('zh_CN');
      setLanguage('zh_CN');
      const zh = tTalent({ kind: 'talentSpec', spec: groveheart, field: 'description' });
      for (const id of ['swiftmend', 'sporemender_form']) {
        expect(zh).toContain(tEntity({ kind: 'ability', id, field: 'name' }));
      }
    } finally {
      setLanguage('en');
    }
    // The spec card shows it as an example tile, and the cooldown manager
    // offers it like every other signature.
    expect(SPEC_CARD_INFO.druid.restoration.examples).toContain('sporemender_form');
    expect(cooldownClassAbilityIds('druid')).toContain('sporemender_form');
  });

  it('respeccing away from Groveheart strips the worn form', () => {
    const sim = druid('restoration');
    sim.castAbility('sporemender_form', sim.playerId);
    expect(wearsForm(sim.player)).toBe(true);
    expect(sim.setSpec('balance')).toBe(true);
    expect(wearsForm(sim.player)).toBe(false);
  });
});

describe('Sporemender Form: shifting', () => {
  it('raises armor by 40%, keeps the mana bar, and shifts back out on recast', () => {
    expect(SPOREMENDER_ARMOR_MULT).toBe(1.4);
    const sim = druid('restoration');
    const p = sim.player;
    const casterArmor = p.stats.armor;
    expect(p.resourceType).toBe('mana');

    sim.castAbility('sporemender_form', sim.playerId);
    expect(wearsForm(p)).toBe(true);
    expect(p.stats.armor).toBe(Math.round(casterArmor * SPOREMENDER_ARMOR_MULT));
    expect(p.resourceType).toBe('mana');

    // Past the GCD, the same button returns to caster form.
    for (let tick = 0; tick < 40; tick++) sim.tick();
    sim.castAbility('sporemender_form', sim.playerId);
    expect(wearsForm(p)).toBe(false);
    expect(p.stats.armor).toBe(casterArmor);
  });

  it('grants Loping Stride on the shift, like every druid form button', () => {
    const sim = druid('restoration');
    sim.castAbility('sporemender_form', sim.playerId);
    expect(sim.player.auras.some((aura) => aura.id === 'loping_stride')).toBe(true);
  });

  it('walks at 80% speed while worn, and at full speed again once shifted out', () => {
    expect(SPOREMENDER_MOVE_SPEED_MULT).toBe(0.8);
    const sim = druid('restoration');
    const p = sim.player;
    expect(moveSpeedMult(p)).toBe(1);
    sim.castAbility('sporemender_form', sim.playerId);
    // Drop the Loping Stride burst the shift grants to read the bare form pace.
    p.auras = p.auras.filter((aura) => aura.id !== 'loping_stride');
    expect(moveSpeedMult(p)).toBeCloseTo(0.8, 10);

    for (let tick = 0; tick < 40; tick++) sim.tick();
    sim.castAbility('sporemender_form', sim.playerId);
    expect(wearsForm(p)).toBe(false);
    p.auras = p.auras.filter((aura) => aura.id !== 'loping_stride');
    expect(moveSpeedMult(p)).toBe(1);
  });

  it('scales the final pace: speed bursts and snares still apply on top', () => {
    const sim = druid('restoration');
    const p = sim.player;
    sim.castAbility('sporemender_form', sim.playerId);
    p.auras = p.auras.filter((aura) => aura.id !== 'loping_stride');
    const aura = (id: string, kind: Aura['kind'], value: number): Aura =>
      ({ id, name: id, kind, remaining: 10, duration: 10, value, sourceId: p.id }) as Aura;

    p.auras.push(aura('test_burst', 'buff_speed', 1.4));
    expect(moveSpeedMult(p)).toBeCloseTo(1.4 * 0.8, 10);
    p.auras = p.auras.filter((a) => a.id !== 'test_burst');

    p.auras.push(aura('test_snare', 'slow', 0.5));
    expect(moveSpeedMult(p)).toBeCloseTo(0.5 * 0.8, 10);
    // A form penalty, not a snare: slow immunity lifts the snare, never the pace.
    p.auras.push(aura('test_immune', 'slow_immunity', 1));
    expect(moveSpeedMult(p)).toBeCloseTo(0.8, 10);
  });

  it('keeps the healing spellbook castable while worn', () => {
    const sim = druid('restoration');
    sim.castAbility('sporemender_form', sim.playerId);
    for (let tick = 0; tick < 40; tick++) sim.tick();
    sim.castAbility('rejuvenation', sim.playerId);
    expect(wearsForm(sim.player)).toBe(true);
    expect(sim.player.auras.some((aura) => aura.kind === 'hot' && aura.id === 'rejuvenation')).toBe(
      true,
    );
  });
});

describe('Sporemender Form: +20% healing done', () => {
  it('contributes exactly 1.2 while worn and exactly 1 otherwise', () => {
    const sim = druid('restoration');
    expect(sporemenderHealingDoneMult(sim.player)).toBe(1);
    expect(sporemenderHealingDoneMult(null)).toBe(1);
    sim.castAbility('sporemender_form', sim.playerId);
    expect(sporemenderHealingDoneMult(sim.player)).toBe(1 + SPOREMENDER_HEALING_DONE_PCT);
    expect(SPOREMENDER_HEALING_DONE_PCT).toBe(0.2);
  });

  it('scales a direct heal by 20%', () => {
    const sim = druid('restoration');
    const healer = sim.player;
    const allyId = sim.addPlayer('warrior', 'Tank');
    sim.setPlayerLevel(MAX_LEVEL, allyId);
    const ally = sim.entities.get(allyId);
    if (!ally) throw new Error('missing ally');
    ally.hp = 1;
    const before = applyHeal(sim.ctx, healer, ally, 100, 'Heal', 'healing_touch', false, false);
    expect(before).toBe(100);

    sim.castAbility('sporemender_form', sim.playerId);
    ally.hp = 1;
    const inForm = applyHeal(sim.ctx, healer, ally, 100, 'Heal', 'healing_touch', false, false);
    expect(inForm).toBe(120);
  });

  it('scales the wearer HoT ticks live, and never another healer HoT', () => {
    const sim = druid('restoration');
    const healer = sim.player;
    const otherId = sim.addPlayer('priest', 'Other');
    const allyId = sim.addPlayer('warrior', 'Tank');
    sim.setPlayerLevel(MAX_LEVEL, allyId);
    const ally = sim.entities.get(allyId);
    if (!ally) throw new Error('missing ally');

    const tickFor = (sourceId: number): number => {
      ally.hp = 1;
      ally.auras = ally.auras.filter((aura) => aura.kind !== 'hot');
      ally.auras.push(hot(sourceId, 50));
      const start = ally.hp;
      updateAuras(sim.ctx, ally);
      return ally.hp - start;
    };

    expect(tickFor(healer.id)).toBe(50);
    sim.castAbility('sporemender_form', sim.playerId);
    expect(tickFor(healer.id)).toBe(60);
    expect(tickFor(otherId)).toBe(50);
  });
});

describe('Sporemender Form: every caster-form spell stays usable', () => {
  // Two identical Groveheart druids, one shifted into Sporemender Form and one
  // left in caster form, cast the same spell at the same hostile target with
  // full mana: every spell must answer identically (same refusal, or the same
  // cast start / global cooldown / cooldown), so the form never gates a spell
  // the caster form can use. Form toggles and Bruin/Cat-only abilities are the
  // only exclusions: they belong to a form kit, not the caster spellbook.
  function rigFor(shifted: boolean): { sim: Sim; p: Entity } {
    const sim = druid('restoration', 9131);
    const p = sim.player;
    if (shifted) sim.castAbility('sporemender_form', sim.playerId);
    for (let tick = 0; tick < 60; tick++) sim.tick();
    const mob = createMob(9820, MOBS.forest_wolf, 20, {
      x: p.pos.x,
      y: p.pos.y,
      z: p.pos.z + 6,
    });
    mob.hostile = true;
    mob.maxHp = mob.hp = 1_000_000;
    (sim as unknown as { addEntity(entity: Entity): void }).addEntity(mob);
    sim.targetEntity(mob.id);
    p.facing = 0;
    p.resource = p.maxResource;
    p.hp = Math.floor(p.maxHp / 2);
    return { sim, p };
  }

  function outcome(shifted: boolean, abilityId: string) {
    const { sim, p } = rigFor(shifted);
    expect(wearsForm(p)).toBe(shifted);
    sim.castAbility(abilityId, sim.playerId);
    const events: SimEvent[] = sim.tick();
    const errors = events
      .filter((event): event is Extract<SimEvent, { type: 'error' }> => event.type === 'error')
      .map((event) => event.text);
    return {
      errors,
      started: p.castingAbility === abilityId || p.gcdRemaining > 0 || p.cooldowns.has(abilityId),
      formAfter: p.auras.find((aura) => isFormAuraKind(aura.kind))?.kind ?? null,
    };
  }

  const casterSpells = (() => {
    const known = knownIds(druid('restoration', 9131));
    return known.filter((id) => {
      const def = ABILITIES[id];
      if (!def || hasFormRequirement(def)) return false;
      return !def.effects.some(
        (effect) => effect.type === 'selfBuff' && isFormAuraKind(effect.kind),
      );
    });
  })();

  it('covers a real caster spellbook', () => {
    expect(casterSpells).toEqual(
      expect.arrayContaining(['rejuvenation', 'regrowth', 'healing_touch', 'swiftmend', 'wrath']),
    );
    expect(casterSpells.length).toBeGreaterThanOrEqual(15);
  });

  it.each(casterSpells)('%s answers the same in Sporemender Form as in caster form', (id) => {
    const caster = outcome(false, id);
    const shifted = outcome(true, id);
    expect(shifted.errors).not.toContain("You can't do that while shapeshifted.");
    expect(shifted.errors).toEqual(caster.errors);
    expect(shifted.started).toBe(caster.started);
    // A caster spell never shifts the druid out of the form. Prowl is the one
    // spell that shifts by itself (into Cat Form) from caster form too, and it
    // lands the druid in that same form from Sporemender Form.
    expect(shifted.formAfter).toBe(caster.formAfter ?? 'form_sporemender');
  });

  it('actually starts most of them (the sweep is not vacuous)', () => {
    const started = casterSpells.filter((id) => outcome(true, id).started);
    expect(started.length).toBeGreaterThanOrEqual(Math.ceil(casterSpells.length / 2));
    expect(started).toEqual(expect.arrayContaining(['rejuvenation', 'regrowth', 'wrath']));
  });
});
