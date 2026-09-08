import { describe, expect, it } from 'vitest';
import {
  HUNTER_CLAP_RADIUS,
  HunterClapContacts,
  hunterPetComponent,
} from '../src/render/hunter_pet_component_core';
import { ABILITIES } from '../src/sim/data';

describe('Hunter component identity and simultaneous pet ownership', () => {
  it('recognizes secondary labels without replaying the command', () => {
    expect(hunterPetComponent(`${ABILITIES.unleash_beast.name} Clap`)).toBe('clap');
    expect(hunterPetComponent('Frenzy Cleave')).toBe('cleave');
    for (const label of [ABILITIES.unleash_beast.name, 'Attack', 'Clap', '', undefined])
      expect(hunterPetComponent(label)).toBeNull();
    expect(HUNTER_CLAP_RADIUS).toBe(6);
  });
  it('groups victims across a frame boundary but keeps two pets and later casts independent', () => {
    const contacts = new HunterClapContacts();
    expect(contacts.admit(2, 1)).toBe(true);
    expect(contacts.admit(2, 1.03)).toBe(false);
    expect(contacts.admit(3, 1.03)).toBe(true);
    expect(contacts.admit(2, 2.5)).toBe(true);
    contacts.reset();
    expect(contacts.admit(2, 2.51)).toBe(true);
    expect(contacts.admit(2, 0)).toBe(true);
  });
});
