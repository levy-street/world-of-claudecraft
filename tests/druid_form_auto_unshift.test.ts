// Auto-unshift: a druid who presses a healing or damaging spell while wearing
// Bruin, Wolf, or Fleet Form leaves the form and casts, instead of eating
// "You can't do that while shapeshifted."
//
// The behavior spans three seams, so the cases below pin all three: the cast
// gate (src/sim/combat/casting_lifecycle.ts), the shift itself
// (src/sim/combat/form_auto_unshift.ts), and the parked-mana pool the shift
// hands back (recalcPlayerStats in src/sim/entity.ts). The negative cases
// matter as much as the positive ones: a druid must never lose a form to a
// buff, a taunt, a form button, or a cast they could not afford anyway.

import { describe, expect, it } from 'vitest';
import { ABILITIES, MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Entity, SimEvent } from '../src/sim/types';
import { placePlayerInOpenField } from './helpers/open_field';

const FORM_COST = 30;
const GCD_SETTLE_TICKS = 32;

function makeDruid(level = 20): Sim {
  const sim = new Sim({ seed: 17, playerClass: 'druid', autoEquip: true });
  sim.setPlayerLevel(level);
  placePlayerInOpenField(sim);
  sim.tick();
  sim.player.resource = sim.player.maxResource;
  return sim;
}

function addDummy(sim: Sim, id = 94001): Entity {
  const p = sim.player;
  const mob = createMob(id, MOBS.training_dummy, 20, {
    x: p.pos.x,
    y: p.pos.y,
    z: p.pos.z + 4,
  });
  (sim as unknown as { addEntity(entity: Entity): void }).addEntity(mob);
  sim.targetEntity(mob.id);
  return mob;
}

function settle(sim: Sim): void {
  for (let i = 0; i < GCD_SETTLE_TICKS; i++) sim.tick();
}

/** Enter a form through the real cast path, then let the GCD it billed lapse. */
function enterForm(sim: Sim, abilityId: 'bear_form' | 'cat_form' | 'travel_form'): void {
  sim.castAbility(abilityId);
  sim.tick();
  settle(sim);
  sim.drainEvents();
}

function errorTexts(sim: Sim): string[] {
  return sim
    .drainEvents()
    .filter((e): e is Extract<SimEvent, { type: 'error' }> => e.type === 'error')
    .map((e) => e.text);
}

function wearsAnyForm(p: Entity): boolean {
  return p.auras.some((a) => a.kind.startsWith('form_'));
}

describe('druid auto-unshift on a healing or damaging cast', () => {
  it('drops Bruin Form and casts Wildbolt, paying the parked mana', () => {
    // Arrange: a bear runs on rage, with the real mana pool parked in savedMana.
    const sim = makeDruid();
    const p = sim.player;
    const manaBefore = p.resource;
    addDummy(sim);
    enterForm(sim, 'bear_form');
    expect(p.resourceType).toBe('rage');
    expect(p.savedMana).toBe(manaBefore - FORM_COST);
    expect(p.resource).toBe(0); // no rage banked: the old gate refused here first

    // Act.
    sim.castAbility('wrath');

    // Assert: the form is gone, the mana bar is back, and the cast is running.
    expect(errorTexts(sim)).toEqual([]);
    expect(wearsAnyForm(p)).toBe(false);
    expect(p.resourceType).toBe('mana');
    expect(p.castingAbility).toBe('wrath');
  });

  it('drops Wolf Form and casts Wildmend', () => {
    const sim = makeDruid();
    const p = sim.player;
    enterForm(sim, 'cat_form');
    expect(p.resourceType).toBe('energy');

    sim.castAbility('healing_touch');

    expect(errorTexts(sim)).toEqual([]);
    expect(wearsAnyForm(p)).toBe(false);
    expect(p.resourceType).toBe('mana');
    expect(p.castingAbility).toBe('healing_touch');
  });

  it('drops Fleet Form and lands Lunar Tempest on the same press, off the GCD', () => {
    // Fleet Form is the case the shift-out cost matters most for: it never
    // swapped the bar, and Lunar Tempest is instant, so the whole press must
    // resolve in one tick with only the SPELL's own GCD charged.
    const sim = makeDruid();
    const p = sim.player;
    const mob = addDummy(sim);
    enterForm(sim, 'travel_form');
    expect(p.resourceType).toBe('mana');
    expect(p.gcdRemaining).toBe(0);
    const hpBefore = mob.hp;

    sim.castAbility('moonfire');

    // The shift and the spell both resolved inside the press: the form is
    // gone, nothing is left casting, and Lunar Tempest is already in flight.
    const events = sim.drainEvents();
    expect(events.filter((e) => e.type === 'error')).toEqual([]);
    expect(wearsAnyForm(p)).toBe(false);
    expect(p.castingAbility).toBeNull();
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'spellfx', ability: 'moonfire', targetId: mob.id }),
    );
    // The shift added no GCD of its own: what is left is Lunar Tempest's.
    expect(p.gcdRemaining).toBeGreaterThan(0);
    expect(p.gcdRemaining).toBeLessThanOrEqual(1.5);
    // ...and the bolt lands, so the press was a real cast and not a no-op.
    settle(sim);
    expect(mob.hp).toBeLessThan(hpBefore);
  });

  it('still bills cost and GCD for shifting back INTO a form', () => {
    const sim = makeDruid();
    const p = sim.player;
    addDummy(sim);
    enterForm(sim, 'bear_form');
    sim.castAbility('wrath');
    while (p.castingAbility !== null || p.gcdRemaining > 0) sim.tick();
    sim.drainEvents();
    const manaBefore = p.resource;

    sim.castAbility('bear_form');
    sim.tick();

    expect(p.auras.some((a) => a.kind === 'form_bear')).toBe(true);
    expect(p.savedMana).toBe(manaBefore - FORM_COST);
    expect(p.gcdRemaining).toBeGreaterThan(0);
  });

  it('refuses an unaffordable cast WITHOUT stripping the form, naming mana', () => {
    // The parked pool is what an auto-unshifting cast is billed against, so it
    // is what the refusal must weigh: burning the form and then reporting
    // "Not enough mana!" would cost the druid their form for nothing.
    const sim = makeDruid();
    const p = sim.player;
    addDummy(sim);
    enterForm(sim, 'bear_form');
    p.savedMana = 1;
    p.resource = 100; // a full RAGE bar must not pay for a mana spell

    sim.castAbility('wrath');

    expect(errorTexts(sim)).toEqual(['Not enough mana!']);
    expect(p.auras.some((a) => a.kind === 'form_bear')).toBe(true);
    expect(p.castingAbility).toBeNull();
  });

  it('leaves non-damaging, non-healing spells refused in form', () => {
    // Wildward is a party buff: a stray press must not cost a tank their form.
    const sim = makeDruid();
    const p = sim.player;
    enterForm(sim, 'bear_form');
    p.resource = 100; // full rage, so the refusal below is about the FORM

    sim.castAbility('mark_of_the_wild');

    expect(errorTexts(sim)).toEqual(["You can't do that while shapeshifted."]);
    expect(p.auras.some((a) => a.kind === 'form_bear')).toBe(true);
  });

  it('leaves form-locked and form-usable abilities alone', () => {
    const sim = makeDruid();
    const p = sim.player;
    addDummy(sim);
    enterForm(sim, 'bear_form');

    // requiresForm: Maul is a bear ability and must not unshift the bear.
    p.resource = 50; // rage
    sim.castAbility('maul');
    expect(errorTexts(sim)).toEqual([]);
    expect(p.auras.some((a) => a.kind === 'form_bear')).toBe(true);

    // usableInForm: Oakhide is authored to fire mid-fight from bear.
    settle(sim);
    sim.drainEvents();
    sim.castAbility('barkskin');
    expect(errorTexts(sim)).toEqual([]);
    expect(p.auras.some((a) => a.kind === 'form_bear')).toBe(true);
  });

  it('leaves the form toggle itself a plain toggle', () => {
    const sim = makeDruid();
    const p = sim.player;
    enterForm(sim, 'cat_form');
    const parked = p.savedMana;

    sim.castAbility('cat_form');
    sim.tick();

    // Toggling off is free (no cost billed), which is what tells this apart
    // from an auto-unshift plus a re-entry.
    expect(wearsAnyForm(p)).toBe(false);
    expect(p.resourceType).toBe('mana');
    expect(p.resource).toBe(parked);
  });

  it('emits the form fade so both worlds drop the shapeshift visual', () => {
    const sim = makeDruid();
    addDummy(sim);
    enterForm(sim, 'bear_form');

    sim.castAbility('wrath');

    expect(sim.drainEvents()).toContainEqual(
      expect.objectContaining({
        type: 'aura',
        targetId: sim.player.id,
        name: ABILITIES.bear_form.name,
        gained: false,
      }),
    );
  });
});

// The form is not stripped at the shapeshift gate but at the point the cast
// actually commits, so a press that clears the gate and is then refused for a
// target, range, or line-of-sight reason leaves the druid still wearing the
// beast. Reported in review on #3494: a bear tank whose target dies mid-swing
// presses Wildbolt and, under the earlier ordering, ended up formless in the
// middle of a pull with no cast to show for it.
describe('a refusal AFTER the shapeshift gate leaves the form on', () => {
  function bearWithDummy(): { sim: Sim; p: Entity; mob: Entity } {
    const sim = makeDruid();
    const mob = addDummy(sim);
    enterForm(sim, 'bear_form');
    return { sim, p: sim.player, mob };
  }

  function expectRefusedInForm(sim: Sim, p: Entity, text: string): void {
    expect(errorTexts(sim)).toEqual([text]);
    expect(p.auras.some((a) => a.kind === 'form_bear')).toBe(true);
    expect(p.resourceType).toBe('rage'); // the parked pool was never handed back
    expect(p.castingAbility).toBeNull();
  }

  it('keeps the form when the target is gone', () => {
    const { sim, p, mob } = bearWithDummy();
    mob.hp = 0;
    mob.dead = true;

    sim.castAbility('wrath');

    expectRefusedInForm(sim, p, 'You have no target.');
  });

  it('keeps the form when the target is out of range', () => {
    const { sim, p, mob } = bearWithDummy();
    // Wildbolt reaches 30 yd; park the dummy well beyond it.
    mob.pos.z = p.pos.z + 60;
    mob.prevPos = { ...mob.pos };

    sim.castAbility('wrath');

    expectRefusedInForm(sim, p, 'Out of range.');
  });

  it('keeps the form when line of sight is blocked', () => {
    const { sim, p } = bearWithDummy();
    (sim as unknown as { hasLineOfSight(): boolean }).hasLineOfSight = () => false;

    sim.castAbility('wrath');

    expectRefusedInForm(sim, p, 'Line of sight.');
  });

  it('keeps the form when a friendly heal has no valid ally target', () => {
    // The friendly ladder is a separate arm of the same ordering problem: a
    // selected ally out of reach refuses after the gate, not before it.
    const sim = makeDruid();
    const ally = addDummy(sim, 94002);
    ally.hostile = false;
    ally.kind = 'player';
    ally.pos.z = sim.player.pos.z + 60;
    ally.prevPos = { ...ally.pos };
    enterForm(sim, 'bear_form');
    const p = sim.player;

    sim.castAbility('healing_touch');

    expect(errorTexts(sim)).toEqual(['Out of range.']);
    expect(p.auras.some((a) => a.kind === 'form_bear')).toBe(true);
    expect(p.resourceType).toBe('rage');
  });

  it('still unshifts once the very same press has a valid target', () => {
    // The control for the four above: the deferral must not have turned the
    // feature off, only moved where it fires.
    const { sim, p } = bearWithDummy();

    sim.castAbility('wrath');

    expect(errorTexts(sim)).toEqual([]);
    expect(wearsAnyForm(p)).toBe(false);
    expect(p.resourceType).toBe('mana');
    expect(p.castingAbility).toBe('wrath');
  });
});

// Stalk is Wolf Form's stealth, so leaving the form has to end it by EITHER
// route. Pressing the form button by hand already does, but only as a side
// effect (casting anything breaks stealth when its effects resolve), so the
// auto-unshift had to be given the same behavior explicitly. Raised in review
// on #3494. Measured before the fix: the manual route left `[]` and unstealthed
// while the auto route left `['prowl']` still hidden for the whole 2.5s cast.
describe('Stalk leaves with the form, whichever route drops it', () => {
  function prowlingCat(): { sim: Sim; p: Entity } {
    const sim = makeDruid();
    const p = sim.player;
    enterForm(sim, 'cat_form');
    sim.castAbility('prowl');
    sim.tick();
    settle(sim);
    sim.drainEvents();
    expect(p.auras.map((a) => a.id).sort()).toEqual(['cat_form', 'prowl']);
    expect(p.stealthed).toBe(true);
    return { sim, p };
  }

  it('ends Stalk on the press, not at the cast that follows', () => {
    const { sim, p } = prowlingCat();

    sim.castAbility('healing_touch');

    // Both gone on the same press: no window of a formless, still-hidden druid
    // casting a 2.5 second heal.
    expect(p.auras.some((a) => a.kind === 'stealth')).toBe(false);
    expect(p.stealthed).toBe(false);
    expect(wearsAnyForm(p)).toBe(false);
    expect(p.castingAbility).toBe('healing_touch'); // and the cast still runs
  });

  it('emits the Stalk fade so both worlds drop the stealth visual', () => {
    const { sim, p } = prowlingCat();

    sim.castAbility('healing_touch');

    expect(sim.drainEvents()).toContainEqual(
      expect.objectContaining({
        type: 'aura',
        targetId: p.id,
        name: ABILITIES.prowl.name,
        gained: false,
      }),
    );
  });

  it('lands in the same state the manual toggle-off does', () => {
    // The decisive form of the claim: two routes out of Wolf Form, one
    // resulting state. Compared as data so a future divergence on either side
    // fails, not just a regression on the auto route.
    const manual = prowlingCat();
    manual.sim.castAbility('cat_form'); // press the form button by hand
    manual.sim.tick();

    const auto = prowlingCat();
    auto.sim.castAbility('healing_touch'); // auto-unshift
    auto.sim.tick();

    const shape = (p: Entity) => ({
      forms: p.auras.filter((a) => a.kind.startsWith('form_')).map((a) => a.id),
      stealthAuras: p.auras.filter((a) => a.kind === 'stealth').map((a) => a.id),
      stealthed: p.stealthed,
      resourceType: p.resourceType,
    });
    expect(shape(auto.p)).toEqual(shape(manual.p));
    expect(shape(auto.p)).toEqual({
      forms: [],
      stealthAuras: [],
      stealthed: false,
      resourceType: 'mana',
    });
  });
});
