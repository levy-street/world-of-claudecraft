// What a player WEARS, as a decision rather than as a thing you have to log in
// to see. Every surface that draws an authored character (the world, the
// char-select stage, the roster chip, the redesign turntable) goes through
// these three functions, and each of the rules below is one that broke a real
// screen before it was pinned here:
//
//  - a peer wearing THIS machine's stored armour-set override (the local dev
//    knob) instead of their class kit;
//  - a character with no authored look composing a default body instead of
//    keeping its class rig;
//  - a Combat Mech wearer growing a second body inside the mech;
//  - a hostile or stale wire payload reaching the compose path unclamped.

import { describe, expect, it, vi } from 'vitest';
import { type ArmorSetId, DEFAULT_APPEARANCE } from '../src/render/characters/modular';
import {
  armorSetSourceFor,
  charselectLook,
  composedLook,
  inWorldLookFor,
  modularLookChanged,
} from '../src/render/characters/player_look_core';
import { createPlayer } from '../src/sim/entity';
import type { Entity, PlayerClass } from '../src/sim/types';
import * as appearanceModule from '../src/world_api/appearance';

function playerEntity(over: Partial<Entity> = {}): Entity {
  const e = createPlayer(1, 'mage', { x: 0, y: 0, z: 0 }, 'Tester');
  return Object.assign(e, over);
}

const CLASS_KIT = (cls: PlayerClass): ArmorSetId => (cls === 'mage' ? 'mage' : 'knight');

describe('composedLook', () => {
  it('returns null with nothing authored, so the caller keeps the class rig', () => {
    expect(composedLook(null, 'knight', false)).toBeNull();
    expect(composedLook(undefined, 'knight', false)).toBeNull();
  });

  it('drops only the head piece when the helm is hidden', () => {
    const shown = composedLook({ gender: 'female' }, 'knight', false);
    const hidden = composedLook({ gender: 'female' }, 'knight', true);
    expect(shown?.worn.head).not.toBeNull();
    expect(hidden?.worn.head).toBeNull();
    // Hiding a helm must not restyle the armour under it.
    expect(hidden?.worn.chest).toBe(shown?.worn.chest);
    expect(hidden?.worn.legs).toBe(shown?.worn.legs);
  });

  it('clamps an untrusted payload to a real body instead of breaking one', () => {
    // The wire value is attacker-reachable: it is stored per character and
    // re-broadcast to everyone in view.
    const look = composedLook(
      { gender: 'nonsense', hair: '../../etc/passwd', skinLight: 9999 },
      'knight',
      false,
    );
    expect(look).not.toBeNull();
    expect(['male', 'female']).toContain(look?.app.gender);
    expect(look?.app.hair).not.toBe('../../etc/passwd');
    expect(Number.isFinite(look?.app.skinLight)).toBe(true);
  });
});

describe('inWorldLookFor', () => {
  it('composes a player carrying an authored look', () => {
    const e = playerEntity({ modularAppearance: { gender: 'female' } });
    expect(inWorldLookFor(e, CLASS_KIT)?.app.gender).toBe('female');
  });

  it('returns null for a player with no authored look (a pre-creator character)', () => {
    expect(inWorldLookFor(playerEntity({ modularAppearance: null }), CLASS_KIT)).toBeNull();
  });

  it('returns null for anything that is not a player', () => {
    const mob = playerEntity({ modularAppearance: { gender: 'female' } });
    mob.kind = 'mob';
    expect(inWorldLookFor(mob, CLASS_KIT)).toBeNull();
  });

  it('honours the entity own helm bit, not a global preference', () => {
    const shown = playerEntity({ modularAppearance: { gender: 'male' }, helmHidden: false });
    const hidden = playerEntity({ modularAppearance: { gender: 'male' }, helmHidden: true });
    expect(inWorldLookFor(shown, CLASS_KIT)?.worn.head).not.toBeNull();
    expect(inWorldLookFor(hidden, CLASS_KIT)?.worn.head).toBeNull();
  });

  it('takes the armour set from the CALLER, so a peer cannot wear a local override', () => {
    // This is the whole reason the set is a parameter: reading the dev knob
    // inside would dress every peer in whatever this machine last picked.
    const e = playerEntity({ modularAppearance: { gender: 'male' } });
    const peer = inWorldLookFor(e, CLASS_KIT);
    const overridden = inWorldLookFor(e, () => 'barbarian');
    expect(peer?.worn.chest).toBe('mage');
    expect(overridden?.worn.chest).toBe('barbarian');
  });
});

describe('charselectLook', () => {
  it('composes a roster row that has a stored look', () => {
    const look = charselectLook({ class: 'rogue', appearance: { gender: 'female' } });
    expect(look?.app.gender).toBe('female');
  });

  it('returns null for a pre-creator row', () => {
    expect(charselectLook({ class: 'rogue', appearance: null })).toBeNull();
  });

  it('never composes over the Combat Mech, which is a REPLACEMENT body', () => {
    expect(
      charselectLook({
        class: 'rogue',
        appearance: { gender: 'female' },
        skinCatalog: 'mech',
      }),
    ).toBeNull();
  });

  it('follows the row saved helm preference', () => {
    const app = { gender: 'male' };
    expect(charselectLook({ class: 'rogue', appearance: app, helmHidden: true })?.worn.head).toBe(
      null,
    );
    expect(
      charselectLook({ class: 'rogue', appearance: app, helmHidden: false })?.worn.head,
    ).not.toBeNull();
    // Absent reads as "shown", matching the sim's zero-default omission.
    expect(charselectLook({ class: 'rogue', appearance: app })?.worn.head).not.toBeNull();
  });

  it('matches the in-world answer for the same character', () => {
    // A roster row and the same character in the world must not disagree, or a
    // player picks a body at the gate and meets a different one inside.
    const appearance = { gender: 'female', hair: 'highbun' };
    const row = charselectLook({ class: 'mage', appearance, helmHidden: true });
    const world = inWorldLookFor(
      playerEntity({ modularAppearance: appearance, helmHidden: true }),
      CLASS_KIT,
    );
    expect(row).toEqual(world);
  });
});

describe('armorSetSourceFor', () => {
  it('hands the local override ONLY to the local player', () => {
    // The line that enforces "a peer cannot wear this machine's stored armour
    // set". It used to live inline in the coordinator, where no test could
    // reach it: flipping it to always return the override broke nothing.
    const override = (): ArmorSetId => 'barbarian';
    const kit = (): ArmorSetId => 'mage';
    expect(armorSetSourceFor(true, override, kit)('mage')).toBe('barbarian');
    expect(armorSetSourceFor(false, override, kit)('mage')).toBe('mage');
  });
});

describe('DEFAULT_APPEARANCE round trip', () => {
  it('survives the compose path unchanged', () => {
    const look = composedLook({ ...DEFAULT_APPEARANCE }, 'knight', false);
    expect(look?.app).toEqual(DEFAULT_APPEARANCE);
  });
});

describe('modularLookChanged', () => {
  it('returns false for the same reference (the fast path the per-frame diff relies on)', () => {
    // modularLookChanged imports sameAppearance from a DIFFERENT module
    // (world_api/appearance.ts), so a namespace spy on it here does observe
    // this call, unlike a same-module call (see the takeFarBakeBudget note in
    // modular_far_lod.test.ts for the case where a spy cannot).
    const sameAppearanceSpy = vi.spyOn(appearanceModule, 'sameAppearance');
    const look = { gender: 'female' };
    expect(modularLookChanged(look, look)).toBe(false);
    // The reference check must short-circuit before ever reaching the value
    // comparison: this runs once per entity every frame, and sameAppearance's
    // JSON.stringify is the cost the fast path exists to skip.
    expect(sameAppearanceSpy).not.toHaveBeenCalled();
    sameAppearanceSpy.mockRestore();
  });

  it('returns false from null to null', () => {
    expect(modularLookChanged(null, null)).toBe(false);
  });

  it('returns false from undefined to undefined, and across null/undefined', () => {
    expect(modularLookChanged(undefined, undefined)).toBe(false);
    expect(modularLookChanged(null, undefined)).toBe(false);
    expect(modularLookChanged(undefined, null)).toBe(false);
  });

  it('returns true from null to a look', () => {
    expect(modularLookChanged(null, { gender: 'female' })).toBe(true);
  });

  it('returns true from a look to null', () => {
    expect(modularLookChanged({ gender: 'female' }, null)).toBe(true);
  });

  it('returns false for two different references carrying identical content (the full identity-record reassignment case)', () => {
    const prev = { gender: 'female', hair: 'highbun' };
    const next = { gender: 'female', hair: 'highbun' };
    expect(prev).not.toBe(next);
    expect(modularLookChanged(prev, next)).toBe(false);
  });

  it('returns true for two different references carrying different content', () => {
    const prev = { gender: 'female', hair: 'highbun' };
    const next = { gender: 'female', hair: 'shortcrop' };
    expect(modularLookChanged(prev, next)).toBe(true);
  });
});
