// The Graveyard Shift kit and identity aura are not in ABILITIES, so every shared
// name and description resolver needs its arm or the HUD shows a raw id.
import { describe, expect, it } from 'vitest';
import { ABILITIES } from '../src/sim/data';
import { MORTHEN_KIT, morthenKitKnown } from '../src/sim/graveyard_shift/kit';
import {
  MORTHEN_IDENTITY_AURA_ID,
  morthenIdentityAura,
} from '../src/sim/graveyard_shift/morthen_identity';
import type { AbilityDef } from '../src/sim/types';
import { abilityDisplayDescription } from '../src/ui/ability_description';
import { abilityDisplayName, abilityDisplayNameFromSource } from '../src/ui/ability_display_name';
import { auraDisplayNameForHud, auraDisplayNameFromSource } from '../src/ui/aura_display_name';
import { castDisplayName } from '../src/ui/cast_display_name';
import {
  graveyardShiftAbilityDescription,
  graveyardShiftAbilityName,
  graveyardShiftAuraName,
  isGraveyardShiftAbilityId,
} from '../src/ui/graveyard_shift_text_core';

const NAMES: Record<string, string> = {
  gshift_sextons_chain: "Sexton's Chain",
  gshift_shadow_pulse: 'Shadow Pulse',
  gshift_raise_fallen: 'Raise the Fallen',
};

const kitDef = (id: string): AbilityDef => MORTHEN_KIT.find((def) => def.id === id)!;

describe('Graveyard Shift display text', () => {
  it('keeps the kit out of ABILITIES (the reason these arms exist)', () => {
    for (const def of MORTHEN_KIT) {
      expect(ABILITIES[def.id]).toBeUndefined();
      expect(isGraveyardShiftAbilityId(def.id)).toBe(true);
    }
    expect(isGraveyardShiftAbilityId('fireball')).toBe(false);
  });

  it('gives every kit ability a name row and a description row', () => {
    // Iterates the kit itself, so a new ability without its text rows reds here.
    for (const def of MORTHEN_KIT) {
      const name = graveyardShiftAbilityName(def.id);
      const description = graveyardShiftAbilityDescription(def.id);
      expect(name, def.id).toBeTruthy();
      expect(description, def.id).toBeTruthy();
      expect(name).not.toMatch(/gshift_/);
      expect(description).not.toMatch(/gshift_/);
    }
  });

  it('names every kit ability through its key in every name resolver', () => {
    for (const def of MORTHEN_KIT) {
      const name = NAMES[def.id];
      expect(graveyardShiftAbilityName(def.id)).toBe(name);
      expect(abilityDisplayName(def)).toBe(name);
      expect(castDisplayName(def.id)).toBe(name);
      expect(abilityDisplayNameFromSource(def.name)).toBe(name);
    }
    expect(graveyardShiftAbilityName('fireball')).toBeNull();
    expect(abilityDisplayName(ABILITIES.fireball)).toBe('Cinderbolt');
  });

  it('names the identity aura and the auras a kit cast applies', () => {
    const identity = morthenIdentityAura(1);
    expect(identity.id).toBe(MORTHEN_IDENTITY_AURA_ID);
    expect(graveyardShiftAuraName(identity.name)).toBe('Morthen the Gravecaller');
    expect(auraDisplayNameFromSource(identity.name)).toBe('Morthen the Gravecaller');
    expect(auraDisplayNameForHud(identity.name, null)).toBe('Morthen the Gravecaller');
    // The Chain's silence and slow, and the Pulse's daze, carry their ability's name.
    expect(auraDisplayNameForHud("Sexton's Chain", null)).toBe("Sexton's Chain");
    expect(graveyardShiftAuraName("Sexton's Chain")).toBe("Sexton's Chain");
    expect(graveyardShiftAuraName('Shadow Pulse')).toBe('Shadow Pulse');
    expect(graveyardShiftAuraName('Fortitude')).toBeNull();
    // The retired kit names no longer resolve through this module.
    expect(graveyardShiftAuraName('Marked for the Barrow')).toBeNull();
    expect(graveyardShiftAuraName('Barrow Shroud')).toBeNull();
  });

  it('describes each kit ability with the numbers its effects carry', () => {
    const text = (id: string) => graveyardShiftAbilityDescription(id)!;
    expect(text('gshift_shadow_pulse')).toBe(
      'Release a pulse of shadow that deals 24 to 36 Shadow damage to each enemy within 12 yards in your line of sight. Each enemy hit is knocked back 8 yards and slowed by 30% for 3 sec.',
    );
    expect(text('gshift_sextons_chain')).toBe(
      'Drag your target to within 3 yards of you and slow it by 50% for 2 sec. A spell it is casting is interrupted and that school is locked for 2 sec, and the target is silenced for 2 sec.',
    );
    expect(text('gshift_raise_fallen')).toBe(
      'Raise the nearest corpse within 20 yards as a skeleton that fights for you for 20 sec. Each corpse rises only once.',
    );
    expect(graveyardShiftAbilityDescription('fireball')).toBeNull();
  });

  it('reads the numbers live from the kit, not from the copy', () => {
    const def = kitDef('gshift_shadow_pulse');
    const hit = def.effects.find((effect) => effect.type === 'aoeDamage') as {
      min: number;
      max: number;
    };
    const { min, max } = hit;
    hit.min = 13;
    hit.max = 19;
    try {
      expect(graveyardShiftAbilityDescription(def.id)).toContain('26 to 38 Shadow damage');
    } finally {
      hit.min = min;
      hit.max = max;
    }
  });

  it('routes the shared tooltip description through the kit arm', () => {
    for (const known of morthenKitKnown()) {
      const prose = abilityDisplayDescription(known, '');
      expect(prose).toBe(graveyardShiftAbilityDescription(known.def.id));
      expect(prose).not.toMatch(/gshift_/);
    }
  });

  it('names the adventurer marker aura through its key', () => {
    expect(graveyardShiftAuraName('Adventurer')).toBe('Adventurer');
    expect(auraDisplayNameFromSource('Adventurer')).toBe('Adventurer');
  });
});
