// The Trinket spell (src/sim/content/trinket_spell.ts): the class-neutral
// ability every character knows, whose press uses whichever trinket is worn
// (src/sim/combat/trinkets.ts castTrinketSpell), against a real Sim.
import { describe, expect, it } from 'vitest';
import { buildClientAbilityPresentation } from '../src/net/ability_presentation';
import { TRINKET_EQUIP_LOCKOUT } from '../src/sim/combat/trinkets';
import { ABILITIES, abilitiesKnownAt, CLASSES } from '../src/sim/content/classes';
import { emptyAllocation } from '../src/sim/content/talents';
import { TRINKET_SPELL, TRINKET_SPELL_ID } from '../src/sim/content/trinket_spell';
import { TRINKET_AURA, TRINKET_SPECS, trinketCooldownKey } from '../src/sim/content/trinkets';
import { membershipAbilities } from '../src/sim/membership_abilities';
import { Sim } from '../src/sim/sim';
import { trinketSpellItemId, withTrinketSpell } from '../src/sim/trinket_spell';
import type { Entity, PlayerClass, SimEvent } from '../src/sim/types';

function fresh(cls: PlayerClass = 'warrior', seed = 11): Sim {
  const sim = new Sim({ seed, playerClass: cls, autoEquip: true });
  sim.setPlayerLevel(20);
  sim.drainEvents();
  return sim;
}

function wear(sim: Sim, itemId: string): void {
  sim.addItem(itemId, 1);
  sim.equipItem(itemId);
  // Skip the 30 sec on-equip lockout: these tests exercise the use itself.
  sim.player.cooldowns.delete(trinketCooldownKey(itemId));
  expect(sim.equipment.trinket).toBe(itemId);
  sim.drainEvents();
}

const aura = (e: Entity, id: string) => e.auras.find((a) => a.id === id);
const errors = (events: SimEvent[]): string[] =>
  events.flatMap((ev) => (ev.type === 'error' ? [ev.text] : []));
const knownIds = (sim: Sim): string[] => sim.known.map((k) => k.def.id);

describe('the Trinket spell grant', () => {
  it.each(Object.keys(CLASSES) as PlayerClass[])(
    '%s knows it once, after the whole class kit',
    (cls) => {
      const kit = abilitiesKnownAt(cls, 1);
      // No class kit lists it: the grant lives outside abilitiesKnownAt.
      expect(kit.some((k) => k.def.id === TRINKET_SPELL_ID)).toBe(false);
      const known = withTrinketSpell(kit);
      expect(known.map((k) => k.def.id)).toEqual([...kit.map((k) => k.def.id), TRINKET_SPELL_ID]);
      // Idempotent: a rebuilt list never carries it twice.
      expect(withTrinketSpell(known).map((k) => k.def.id)).toEqual(known.map((k) => k.def.id));
      // The Courier (the other class-neutral grant) lands after it, so a
      // membership lapse never moves the Trinket spell's slot.
      const member = membershipAbilities(known, true).map((k) => k.def.id);
      expect(member.slice(-2)).toEqual([TRINKET_SPELL_ID, 'courier']);
    },
  );

  it('is a registered, effect-free, off-GCD instant', () => {
    expect(ABILITIES[TRINKET_SPELL_ID]).toBe(TRINKET_SPELL);
    expect(TRINKET_SPELL.effects).toEqual([]);
    expect(TRINKET_SPELL.offGcd).toBe(true);
    expect(TRINKET_SPELL.cooldown).toBe(0);
    expect(TRINKET_SPELL.passive).toBeUndefined();
  });

  it('a live character knows it at level 1 and keeps it through a level-up', () => {
    const sim = new Sim({ seed: 3, playerClass: 'mage', autoEquip: true });
    expect(knownIds(sim).filter((id) => id === TRINKET_SPELL_ID)).toHaveLength(1);
    sim.setPlayerLevel(20);
    expect(knownIds(sim).filter((id) => id === TRINKET_SPELL_ID)).toHaveLength(1);
    // The kit's own slots are unchanged by the grant (RL action slot order).
    const kit = abilitiesKnownAt('mage', 20).map((k) => k.def.id);
    expect(knownIds(sim).slice(0, kit.length)).toEqual(kit);
  });

  it('the client mirror rebuilds the same grant', () => {
    const presentation = buildClientAbilityPresentation(
      'priest',
      20,
      {
        talents: emptyAllocation(),
        loadouts: [],
        activeLoadout: 0,
        equipment: {},
        questsDone: new Set(),
      },
      null,
      [],
    );
    const ids = presentation.known.map((k) => k.def.id);
    expect(ids.filter((id) => id === TRINKET_SPELL_ID)).toHaveLength(1);
    expect(ids[ids.length - 1]).toBe(TRINKET_SPELL_ID);
  });
});

describe('what a press uses', () => {
  it('is the worn trinket when it has a mechanic, else nothing', () => {
    expect(trinketSpellItemId(null)).toBeNull();
    expect(trinketSpellItemId(undefined)).toBeNull();
    expect(trinketSpellItemId('wayfarers_lodestone')).toBe('wayfarers_lodestone');
    // A trinket that only works on its own still shows on the button.
    expect(TRINKET_SPECS.barrowstone_heart.use.kind).toBe('passiveOnly');
    expect(trinketSpellItemId('barrowstone_heart')).toBe('barrowstone_heart');
    // Not a trinket at all.
    expect(trinketSpellItemId('minor_healing_potion')).toBeNull();
  });
});

describe('casting the Trinket spell', () => {
  it('says so when no usable trinket is worn, and starts nothing', () => {
    const sim = fresh();
    expect(sim.equipment.trinket).toBeUndefined();
    sim.castAbility(TRINKET_SPELL_ID);
    expect(errors(sim.drainEvents())).toEqual(['You are not wearing a trinket you can use.']);
    expect(sim.player.gcdRemaining).toBe(0);
    expect(sim.player.cooldowns.size).toBe(0);
  });

  it('uses the worn trinket exactly as clicking it does', () => {
    const sim = fresh();
    wear(sim, 'wayfarers_lodestone');
    sim.castAbility(TRINKET_SPELL_ID);
    expect(errors(sim.drainEvents())).toEqual([]);
    expect(aura(sim.player, TRINKET_AURA.sprint)?.kind).toBe('buff_speed');
    // The trinket's own cooldown runs under its own key; the spell has none.
    expect(sim.player.cooldowns.get(trinketCooldownKey('wayfarers_lodestone'))).toBe(
      TRINKET_SPECS.wayfarers_lodestone.cooldown,
    );
    expect(sim.player.cooldowns.has(TRINKET_SPELL_ID)).toBe(false);
    // No global cooldown, like a trinket clicked on the bar.
    expect(sim.player.gcdRemaining).toBe(0);
    // Still worn, never consumed.
    expect(sim.equipment.trinket).toBe('wayfarers_lodestone');

    // A second press answers with the trinket's own refusal.
    sim.player.auras = sim.player.auras.filter((a) => a.id !== TRINKET_AURA.sprint);
    sim.castAbility(TRINKET_SPELL_ID);
    expect(errors(sim.drainEvents())).toEqual(['That item is not ready yet.']);
    expect(aura(sim.player, TRINKET_AURA.sprint)).toBeUndefined();
  });

  it('follows the trinket slot when a different trinket is equipped', () => {
    const sim = fresh();
    wear(sim, 'gamblers_die');
    sim.addItem('wayfarers_lodestone', 1);
    sim.equipItem('wayfarers_lodestone');
    expect(sim.equipment.trinket).toBe('wayfarers_lodestone');
    // The freshly worn trinket carries its on-equip lockout, and the spell
    // respects it: the press does not fall back to the trinket taken off.
    expect(sim.player.cooldowns.get(trinketCooldownKey('wayfarers_lodestone'))).toBe(
      TRINKET_EQUIP_LOCKOUT,
    );
    sim.drainEvents();
    sim.castAbility(TRINKET_SPELL_ID);
    expect(errors(sim.drainEvents())).toEqual(['That item is not ready yet.']);
    expect(sim.player.cooldowns.has(trinketCooldownKey('gamblers_die'))).toBe(false);

    sim.player.cooldowns.delete(trinketCooldownKey('wayfarers_lodestone'));
    sim.castAbility(TRINKET_SPELL_ID);
    expect(aura(sim.player, TRINKET_AURA.sprint)?.kind).toBe('buff_speed');
    expect(sim.player.cooldowns.has(trinketCooldownKey('gamblers_die'))).toBe(false);
  });

  it('ignores the global cooldown and a cast in progress', () => {
    const sim = fresh('mage');
    wear(sim, 'wayfarers_lodestone');
    sim.player.gcdRemaining = 1.2;
    sim.player.castingAbility = 'cinderbolt';
    sim.player.castRemaining = 2;
    sim.castAbility(TRINKET_SPELL_ID);
    expect(errors(sim.drainEvents())).toEqual([]);
    expect(aura(sim.player, TRINKET_AURA.sprint)?.kind).toBe('buff_speed');
    // The cast and the global cooldown it interrupted neither: both run on.
    expect(sim.player.castingAbility).toBe('cinderbolt');
    expect(sim.player.gcdRemaining).toBe(1.2);
    // And it never took the spell-queue slot.
    expect(sim.player.queuedCastAbility ?? null).toBeNull();
  });

  it('answers for a trinket that only works on its own', () => {
    const sim = fresh();
    wear(sim, 'barrowstone_heart');
    sim.castAbility(TRINKET_SPELL_ID);
    expect(errors(sim.drainEvents())).toEqual(['It works on its own.']);
    expect(sim.player.cooldowns.has(trinketCooldownKey('barrowstone_heart'))).toBe(false);
  });

  it('refuses a dead player with the item refusal', () => {
    const sim = fresh();
    wear(sim, 'wayfarers_lodestone');
    sim.player.dead = true;
    sim.castAbility(TRINKET_SPELL_ID);
    expect(errors(sim.drainEvents())).toEqual(['You are dead.']);
    expect(sim.player.cooldowns.has(trinketCooldownKey('wayfarers_lodestone'))).toBe(false);
  });
});
