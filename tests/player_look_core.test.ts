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
  helmSlotAvailable,
  helmSlotAvailableForEntity,
  helmSlotAvailableForLook,
  inWorldLookFor,
  modularLookChanged,
} from '../src/render/characters/player_look_core';
import { createPlayer } from '../src/sim/entity';
import { ALL_CLASSES, type Entity, type PlayerClass } from '../src/sim/types';
import * as appearanceModule from '../src/world_api/appearance';

function playerEntity(over: Partial<Entity> = {}): Entity {
  const e = createPlayer(1, 'mage', { x: 0, y: 0, z: 0 }, 'Tester');
  return Object.assign(e, over);
}

const CLASS_KIT = (cls: PlayerClass): ArmorSetId => (cls === 'mage' ? 'mage' : 'knight');

describe('every class body is a WOC modular body, so no class composes', () => {
  const authored = DEFAULT_APPEARANCE as unknown as Record<string, unknown>;

  it('keeps the fixed class rig in-world for every class with an authored look', () => {
    for (const cls of ALL_CLASSES) {
      expect(
        inWorldLookFor(playerEntity({ templateId: cls, modularAppearance: authored }), CLASS_KIT),
        cls,
      ).toBeNull();
    }
  });

  it('agrees at char-select for every class', () => {
    for (const cls of ALL_CLASSES) {
      expect(charselectLook({ class: cls, appearance: authored }), cls).toBeNull();
    }
  });

  it('offers the helm eye exactly while a helmet item is worn', () => {
    const lookFor = (): null => null;
    expect(
      helmSlotAvailableForEntity(
        playerEntity({ templateId: 'warrior', equippedItems: {} }),
        lookFor,
      ),
    ).toBe(false);
    expect(
      helmSlotAvailableForEntity(
        playerEntity({ templateId: 'warrior', equippedItems: { helmet: 'mistveil_cord' } }),
        lookFor,
      ),
    ).toBe(true);
    expect(
      helmSlotAvailableForEntity(
        playerEntity({ templateId: 'mage', equippedItems: { helmet: 'wardweave_cowl' } }),
        lookFor,
      ),
    ).toBe(true);
  });
});

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

describe('inWorldLookFor and charselectLook (no class composes any more)', () => {
  it('returns null for a player with an authored look, a pre-creator character and a mob alike', () => {
    expect(
      inWorldLookFor(playerEntity({ modularAppearance: { gender: 'female' } }), CLASS_KIT),
    ).toBeNull();
    expect(inWorldLookFor(playerEntity({ modularAppearance: null }), CLASS_KIT)).toBeNull();
    const mob = playerEntity({ modularAppearance: { gender: 'female' } });
    mob.kind = 'mob';
    expect(inWorldLookFor(mob, CLASS_KIT)).toBeNull();
  });

  it('returns null for every roster row, stored look or not, mech or not', () => {
    expect(charselectLook({ class: 'rogue', appearance: { gender: 'female' } })).toBeNull();
    expect(charselectLook({ class: 'rogue', appearance: null })).toBeNull();
    expect(
      charselectLook({ class: 'rogue', appearance: { gender: 'female' }, skinCatalog: 'mech' }),
    ).toBeNull();
    expect(
      charselectLook({ class: 'rogue', appearance: { gender: 'male' }, helmHidden: true }),
    ).toBeNull();
  });

  it('matches the in-world answer for the same character', () => {
    const appearance = { gender: 'female', hair: 'highbun' };
    const row = charselectLook({ class: 'mage', appearance, helmHidden: true });
    const world = inWorldLookFor(
      playerEntity({ modularAppearance: appearance, helmHidden: true }),
      CLASS_KIT,
    );
    expect(row).toEqual(world);
    expect(row).toBeNull();
  });

  // The composer itself still answers for the library's own consumers (the
  // composed-body test bed, NPC modular looks): the caller-supplied armour set
  // is what it wears, never a local override.
  it('composes from the CALLER-supplied armour set', () => {
    const app = { gender: 'male' };
    expect(composedLook(app, 'mage', false)?.worn.chest).toBe('mage');
    expect(composedLook(app, 'barbarian', false)?.worn.chest).toBe('barbarian');
    expect(composedLook(app, 'knight', true)?.worn.head).toBeNull();
    expect(composedLook(app, 'knight', false)?.worn.head).not.toBeNull();
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

describe('helmSlotAvailable (issue: hide helmet does nothing)', () => {
  it('is false for a class kit whose set ships no head geometry', () => {
    // druid, the hunter's ranger kit, and rogue all leave ARMOR_BY_SET.head
    // empty: the composed body has no helm to remove, so the paperdoll eye
    // must not claim it can hide one.
    expect(helmSlotAvailable('druid', false)).toBe(false);
    expect(helmSlotAvailable('hunter', false)).toBe(false);
    expect(helmSlotAvailable('rogue', false)).toBe(false);
  });

  it('is true for a class kit whose set has a head piece', () => {
    expect(helmSlotAvailable('warrior', false)).toBe(true);
    expect(helmSlotAvailable('mage', false)).toBe(true);
    expect(helmSlotAvailable('paladin', false)).toBe(true);
  });

  it('is false for a Combat Mech wearer regardless of class kit', () => {
    // A mech is a whole replacement body that never composes the kit at all
    // (renderer.ts skips its look via the same isMechWearer guard), so even a
    // helmed class kit has nothing the eye could hide while mech-skinned.
    expect(helmSlotAvailable('warrior', true)).toBe(false);
  });
});

describe('helmSlotAvailableForLook', () => {
  it('is derived from the composed look that the renderer will draw', () => {
    expect(helmSlotAvailableForLook(null)).toBe(false);
    expect(helmSlotAvailableForLook(composedLook({ gender: 'male' }, 'knight', false))).toBe(true);
    expect(helmSlotAvailableForLook(composedLook({ gender: 'male' }, 'rogue', false))).toBe(false);
  });
});

describe('helmSlotAvailableForEntity', () => {
  it('offers the eye while a WOC body wears a helmet item, whatever the helm bit says', () => {
    // Every class rides a WOC body: the eye follows the equipped helmet item,
    // not a composed look (woc_parts_core empties the head slot on helmHidden).
    const hidden = playerEntity({
      modularAppearance: { gender: 'male' },
      helmHidden: true,
      equippedItems: { helmet: 'wardweave_cowl' },
    });
    expect(helmSlotAvailableForEntity(hidden, (e) => inWorldLookFor(e, CLASS_KIT))).toBe(true);
    const bare = playerEntity({ modularAppearance: { gender: 'male' }, helmHidden: true });
    expect(helmSlotAvailableForEntity(bare, (e) => inWorldLookFor(e, CLASS_KIT))).toBe(false);
  });

  it('returns false for fixed rigs and replacement bodies', () => {
    expect(
      helmSlotAvailableForEntity(playerEntity({ modularAppearance: null }), (e) =>
        inWorldLookFor(e, CLASS_KIT),
      ),
    ).toBe(false);
    expect(
      helmSlotAvailableForEntity(
        playerEntity({ modularAppearance: { gender: 'male' }, skinCatalog: 'mech' }),
        (e) => inWorldLookFor(e, CLASS_KIT),
      ),
    ).toBe(false);
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
