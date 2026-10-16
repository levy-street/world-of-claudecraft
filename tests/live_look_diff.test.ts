// The per-frame look diffs the renderer's entity loop delegates to
// src/render/live_look_diff.ts: the helm eye and a pushed redesign recompose a
// COMPOSED body (by nulling the remembered key); a WOC player's redesign also
// replaces its fixed body file, while a mech keeps its cosmetic body;
// a WOC body's worn armor is a dressing call on the settled visual, players
// only. Each rule broke a real screen before it was pinned here, so every arm
// has a decisive negative beside its positive.
import { describe, expect, it, vi } from 'vitest';
import { setModularLookProvider } from '../src/render/characters';
import { DEFAULT_APPEARANCE } from '../src/render/characters/modular';
import {
  diffComposedLook,
  diffWornArmor,
  type LiveLookView,
  type WocDressable,
} from '../src/render/live_look_diff';
import { createPlayer } from '../src/sim/entity';
import type { Entity } from '../src/sim/types';

function player(over: Partial<Entity> = {}): Entity {
  const e = createPlayer(1, 'mage', { x: 0, y: 0, z: 0 }, 'Tester');
  return Object.assign(e, over);
}

function view(over: Partial<LiveLookView> = {}): LiveLookView {
  return { visualKey: 'player_mage', helmHidden: false, modularAppearance: undefined, ...over };
}

const composedLook = { app: DEFAULT_APPEARANCE, worn: {} } as never;

describe('diffComposedLook', () => {
  it('recomposes a composed body when the helm eye flips, and remembers the bit', () => {
    setModularLookProvider(() => composedLook);
    try {
      const v = view({ helmHidden: false });
      diffComposedLook(player({ helmHidden: true }), v);
      expect(v.visualKey).toBeNull();
      expect(v.helmHidden).toBe(true);
    } finally {
      setModularLookProvider(null);
    }
  });

  it('leaves a fixed rig alone on a helm flip (nothing composed to take off)', () => {
    setModularLookProvider(() => null);
    try {
      const v = view({ helmHidden: false });
      diffComposedLook(player({ helmHidden: true }), v);
      expect(v.visualKey).toBe('player_mage');
      expect(v.helmHidden).toBe(true);
    } finally {
      setModularLookProvider(null);
    }
  });

  it('never rebuilds a mech wearer for a helm flip', () => {
    setModularLookProvider(() => composedLook);
    try {
      const v = view();
      diffComposedLook(player({ helmHidden: true, skinCatalog: 'mech' } as Partial<Entity>), v);
      expect(v.visualKey).toBe('player_mage');
    } finally {
      setModularLookProvider(null);
    }
  });

  it('recomposes on a redesign that changed VALUE, not on a reassigned equal look', () => {
    setModularLookProvider(() => composedLook);
    try {
      const before = { gender: 'female' };
      const same = { gender: 'female' };
      const v = view({ modularAppearance: before });
      diffComposedLook(player({ modularAppearance: same }), v);
      expect(v.visualKey).toBe('player_mage');
      expect(v.modularAppearance).toBe(same); // the reference is re-copied either way

      const changed = { gender: 'male' };
      diffComposedLook(player({ modularAppearance: changed }), v);
      expect(v.visualKey).toBeNull();
      expect(v.modularAppearance).toBe(changed);
    } finally {
      setModularLookProvider(null);
    }
  });

  it('recomposes a previously composed body whose look was CLEARED', () => {
    setModularLookProvider(() => null);
    try {
      // A non-player disables the new WOC-player branch, so this fails if the
      // previous composed appearance stops keeping the old clear-look arm alive.
      const v = view({ visualKey: 'npc_guard_modular', modularAppearance: { gender: 'female' } });
      diffComposedLook(player({ kind: 'npc', templateId: 'guard', modularAppearance: null }), v);
      expect(v.visualKey).toBeNull();
      expect(v.modularAppearance).toBeNull();
    } finally {
      setModularLookProvider(null);
    }
  });

  it.each(['warrior', 'mage', 'rogue'] as const)(
    'rebuilds a fixed %s when its first female appearance arrives',
    (cls) => {
      setModularLookProvider(() => null);
      try {
        const appearance = { gender: 'female' };
        const v = view({ visualKey: `player_${cls}`, modularAppearance: undefined });
        diffComposedLook(player({ templateId: cls, modularAppearance: appearance }), v);
        expect(v.visualKey).toBeNull();
        expect(v.modularAppearance).toBe(appearance);
      } finally {
        setModularLookProvider(null);
      }
    },
  );

  it('keeps an equal fixed-body appearance without rebuilding while remembering the new reference', () => {
    setModularLookProvider(() => null);
    try {
      const appearance = { gender: 'female' };
      const v = view({ visualKey: 'player_mage_female', modularAppearance: { gender: 'female' } });
      diffComposedLook(player({ modularAppearance: appearance }), v);
      expect(v.visualKey).toBe('player_mage_female');
      expect(v.modularAppearance).toBe(appearance);
    } finally {
      setModularLookProvider(null);
    }
  });

  it('keeps a mech body when the wearer receives a female redesign', () => {
    setModularLookProvider(() => null);
    try {
      const appearance = { gender: 'female' };
      const v = view({ visualKey: 'player_mech' });
      diffComposedLook(player({ skinCatalog: 'mech', modularAppearance: appearance }), v);
      expect(v.visualKey).toBe('player_mech');
      expect(v.modularAppearance).toBe(appearance);
    } finally {
      setModularLookProvider(null);
    }
  });

  it('does not treat a non-player on a class rig as a WOC player redesign', () => {
    setModularLookProvider(() => null);
    try {
      const appearance = { gender: 'female' };
      const v = view();
      diffComposedLook(player({ kind: 'mob', modularAppearance: appearance }), v);
      expect(v.visualKey).toBe('player_mage');
      expect(v.modularAppearance).toBe(appearance);
    } finally {
      setModularLookProvider(null);
    }
  });
});

describe('diffWornArmor', () => {
  function dressable(): WocDressable & { calls: unknown[][] } {
    const calls: unknown[][] = [];
    return {
      calls,
      setWocEquipment: vi.fn((equipped, helmHidden) => {
        calls.push([equipped, helmHidden]);
        return true;
      }),
    };
  }

  it('dresses a player from its worn set and helm bit', () => {
    const d = dressable();
    const equipped = { helmet: 'mistveil_cord' };
    expect(diffWornArmor(player({ equippedItems: equipped, helmHidden: true }), d)).toBe(true);
    expect(d.calls).toEqual([[equipped, true]]);
  });

  it('leaves a non-player on its default kit (a mob has no worn set)', () => {
    const d = dressable();
    const mob = player();
    mob.kind = 'mob';
    expect(diffWornArmor(mob, d)).toBe(false);
    expect(d.calls).toEqual([]);
  });
});

describe('WOC modular head (in place)', () => {
  it('keeps a WOC body on a head-only redesign and rebuilds it on a body-type change', () => {
    setModularLookProvider(() => null);
    try {
      const before = { ...DEFAULT_APPEARANCE, headHair: 'swept' };
      const v = view({ visualKey: 'player_mage', modularAppearance: before });
      const faceOnly = { ...DEFAULT_APPEARANCE, headHair: 'mohawk', hairHue: 8 };
      diffComposedLook(player({ modularAppearance: faceOnly }), v);
      expect(v.visualKey).toBe('player_mage');
      expect(v.modularAppearance).toBe(faceOnly);
      const female = { ...faceOnly, gender: 'female' };
      diffComposedLook(player({ modularAppearance: female }), v);
      expect(v.visualKey).toBeNull();
    } finally {
      setModularLookProvider(null);
    }
  });

  it('forwards the player appearance to the head dressing and reports its change', () => {
    const app = { ...DEFAULT_APPEARANCE };
    const setWocHeadLook = vi.fn(() => true);
    const setWocEquipment = vi.fn(() => false);
    const changed = diffWornArmor(player({ modularAppearance: app }), {
      setWocEquipment,
      setWocHeadLook,
    });
    expect(setWocHeadLook).toHaveBeenCalledWith(app);
    expect(changed).toBe(true);
    // a non-player never reaches it
    const mobHead = vi.fn(() => true);
    diffWornArmor(player({ kind: 'mob' }), { setWocEquipment, setWocHeadLook: mobHead });
    expect(mobHead).not.toHaveBeenCalled();
  });
});

describe('WOC body size (in place)', () => {
  it('keeps a WOC body on a size-only redesign (no rebuild)', () => {
    setModularLookProvider(() => null);
    try {
      const before = { ...DEFAULT_APPEARANCE, bodyScale: 1 };
      const v = view({ visualKey: 'player_mage', modularAppearance: before });
      const smaller = { ...DEFAULT_APPEARANCE, bodyScale: 0.95 };
      diffComposedLook(player({ modularAppearance: smaller }), v);
      expect(v.visualKey).toBe('player_mage');
      expect(v.modularAppearance).toBe(smaller);
    } finally {
      setModularLookProvider(null);
    }
  });

  it('forwards the clamped size every frame and reports only a real change', () => {
    let size = 1;
    const setBodyScale = vi.fn((s: number) => {
      if (s === size) return false;
      size = s;
      return true;
    });
    const setWocEquipment = vi.fn(() => false);
    const setWocHeadLook = vi.fn(() => false);
    const d = { setWocEquipment, setWocHeadLook, setBodyScale };
    expect(diffWornArmor(player({ modularAppearance: { bodyScale: 0.95 } }), d)).toBe(true);
    expect(setBodyScale).toHaveBeenLastCalledWith(0.95);
    // the same size again: forwarded (the visual short-circuits), no change reported
    expect(diffWornArmor(player({ modularAppearance: { bodyScale: 0.95 } }), d)).toBe(false);
    // hostile or missing values clamp to the slider's range, never past it
    diffWornArmor(player({ modularAppearance: { bodyScale: 0.01 } }), d);
    expect(setBodyScale).toHaveBeenLastCalledWith(0.95);
    diffWornArmor(player({ modularAppearance: { bodyScale: 9 } }), d);
    expect(setBodyScale).toHaveBeenLastCalledWith(1.05);
    diffWornArmor(player({ modularAppearance: { bodyScale: 'tiny' } }), d);
    expect(setBodyScale).toHaveBeenLastCalledWith(1);
    diffWornArmor(player({ modularAppearance: null }), d);
    expect(setBodyScale).toHaveBeenLastCalledWith(1);
    // a mob on a WOC body keeps the authored size
    const mobSize = vi.fn(() => true);
    diffWornArmor(player({ kind: 'mob', modularAppearance: { bodyScale: 0.95 } }), {
      setWocEquipment,
      setBodyScale: mobSize,
    });
    expect(mobSize).not.toHaveBeenCalled();
  });
});
