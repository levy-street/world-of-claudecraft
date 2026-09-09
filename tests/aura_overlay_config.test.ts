import { beforeEach, describe, expect, it } from 'vitest';
import {
  AuraOverlayConfigStore,
  defaultAuraOverlayConfig,
  genericPaletteColor,
  sanitizeAuraOverlayConfig,
} from '../src/ui/aura_overlay_config';

beforeEach(() => {
  const values = new Map<string, string>();
  (globalThis as { localStorage?: Storage }).localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
    clear: () => values.clear(),
    key: (index) => [...values.keys()][index] ?? null,
    get length() {
      return values.size;
    },
  };
});

describe('aura overlay config', () => {
  it('defaults off with centered crescents and a compact icon row below the player', () => {
    expect(defaultAuraOverlayConfig('revenge_free')).toMatchObject({
      enabled: false,
      showIcon: true,
      showArcs: false,
      showGroundRing: true,
      iconPosX: 0.44,
      iconPosY: 0.7,
      arcsPosX: 0.5,
      arcsPosY: 0.56,
      opacity: 0.7,
      scale: 0.8,
      arcsScale: 0.8,
      groundScale: 1,
      groundOrder: 0,
      color: '#ffe14d',
    });
    const ids = [
      'revenge_free',
      'battle_trance',
      'raised_guard',
      'iron_resolve',
      'overpower_charge',
      'sudden_death',
      'victory_rush',
      'enrage',
    ] as const;
    const defaults = ids.map(defaultAuraOverlayConfig);
    expect(defaults.map((config) => config.arcsScale)).toEqual([
      0.8, 0.9, 1, 1.1, 1.2, 1.3, 1.4, 1.5,
    ]);
    expect(defaults.map((config) => config.iconPosX)).toEqual([
      0.44, 0.44, 0.5, 0.56, 0.5, 0.56, 0.47, 0.53,
    ]);
    expect(defaults.every((config) => config.iconPosY === 0.7)).toBe(true);
    expect(defaults.every((config) => config.scale === 0.8)).toBe(true);
    expect(defaults.every((config) => config.arcsPosX === 0.5 && config.arcsPosY === 0.56)).toBe(
      true,
    );
  });

  it('provides staggered class-themed defaults for Mage procs', () => {
    expect(defaultAuraOverlayConfig('heating_up')).toMatchObject({
      enabled: false,
      iconPosX: 0.47,
      iconPosY: 0.7,
      scale: 0.8,
      arcsScale: 0.9,
      color: '#ff4b2b',
    });
    expect(defaultAuraOverlayConfig('hot_streak')).toMatchObject({
      iconPosX: 0.53,
      arcsScale: 1.1,
      color: '#ffd43b',
    });
    expect(defaultAuraOverlayConfig('fingers_of_frost').color).toBe('#59d8ff');
    expect(defaultAuraOverlayConfig('brain_freeze').color).toBe('#4d8dff');
    expect(defaultAuraOverlayConfig('arcane_charge').color).toBe('#8b5cf6');
    expect(defaultAuraOverlayConfig('aether_rush').color).toBe('#d946ef');
    expect(defaultAuraOverlayConfig('perfect_moment').color).toBe('#6d28d9');
  });

  it('provides stable class palettes and row slots for generated talent procs', () => {
    // Pinned against the live CHOICE_ROWS: only a proc whose responses map to
    // a drawable aura kind earns generated meta, and the reworked hunter,
    // paladin, and shaman trees currently carry none, so those classes resolve
    // through the generic fallback and are intentionally absent here.
    expect(defaultAuraOverlayConfig('dru_ironhide_reflex')).toMatchObject({
      iconPosX: 0.38,
      iconPosY: 0.7,
      scale: 0.8,
      arcsScale: 0.9,
      color: '#f59e0b',
    });
    expect(defaultAuraOverlayConfig('rog_slipstream')).toMatchObject({
      iconPosX: 0.32,
      iconPosY: 0.7,
      arcsScale: 0.8,
      color: '#facc15',
    });
    expect(defaultAuraOverlayConfig('dru_gripping_ambush')).toMatchObject({
      iconPosX: 0.44,
      iconPosY: 0.7,
      arcsScale: 1,
      color: '#60a5fa',
    });
    expect(defaultAuraOverlayConfig('rog_improved_evasion').color).toBe('#dc2626');
    expect(defaultAuraOverlayConfig('pri_inner_fire').color).toBe('#facc15');
    expect(defaultAuraOverlayConfig('wlk_curse_mastery').color).toBe('#c026d3');
  });

  it('clamps malformed values and rejects invalid colors', () => {
    expect(
      sanitizeAuraOverlayConfig('revenge_free', {
        iconPosX: 9,
        iconPosY: -2,
        arcsPosX: 9,
        arcsPosY: -2,
        opacity: 0,
        scale: 99,
        arcsScale: 0,
        groundScale: 99,
        enabled: 'yes',
        color: 'red',
      }),
    ).toMatchObject({
      iconPosX: 1,
      iconPosY: 0,
      arcsPosX: 1,
      arcsPosY: 0,
      opacity: 0.25,
      scale: 1.6,
      arcsScale: 0.65,
      groundScale: 1.6,
      enabled: false,
      color: '#ffe14d',
    });
  });

  it('persists independently per character and proc', () => {
    const raido = new AuraOverlayConfigStore('warrior:Raido');
    raido.patch('revenge_free', {
      iconPosX: 0.25,
      arcsPosX: 0.35,
      opacity: 0.5,
      scale: 0.8,
      arcsScale: 1.4,
      showGroundRing: false,
      groundScale: 1.3,
      groundOrder: 3,
      color: '#123abc',
    });
    raido.patch('victory_rush', { iconPosX: 0.75 });

    expect(new AuraOverlayConfigStore('warrior:Raido').get('revenge_free')).toMatchObject({
      iconPosX: 0.25,
      arcsPosX: 0.35,
      scale: 0.8,
      arcsScale: 1.4,
      showGroundRing: false,
      groundScale: 1.3,
      groundOrder: 3,
      color: '#123abc',
    });
    expect(new AuraOverlayConfigStore('warrior:Raido').get('victory_rush').iconPosX).toBe(0.75);
    expect(new AuraOverlayConfigStore('warrior:Other').get('revenge_free').iconPosX).toBe(0.44);
  });

  it('persists shared crescent and ground-ring block scales', () => {
    const store = new AuraOverlayConfigStore('warrior:Raido');

    store.patchLayout({ crescentBlockScale: 1.25 });
    expect(store.getLayout()).toEqual({
      crescentBlockScale: 1.25,
      groundRingBlockScale: 1,
    });
    store.patchLayout({ groundRingBlockScale: 1.4 });

    expect(new AuraOverlayConfigStore('warrior:Raido').getLayout()).toEqual({
      crescentBlockScale: 1.25,
      groundRingBlockScale: 1.4,
    });
  });

  it('recovers from corrupt stored JSON', () => {
    localStorage.setItem('woc_aura_overlays:warrior:Raido', '{broken');
    const store = new AuraOverlayConfigStore('warrior:Raido');
    expect(store.get('revenge_free')).toEqual(defaultAuraOverlayConfig('revenge_free'));
    store.patch('revenge_free', { iconPosX: 0.64 });
    expect(new AuraOverlayConfigStore('warrior:Raido').get('revenge_free').iconPosX).toBe(0.64);
  });

  it('resets only position without changing appearance', () => {
    const store = new AuraOverlayConfigStore('warrior:Raido');
    store.patch('revenge_free', {
      iconPosX: 0.1,
      iconPosY: 0.9,
      arcsPosX: 0.2,
      arcsPosY: 0.8,
      opacity: 0.4,
      enabled: false,
    });
    expect(store.resetPosition('revenge_free')).toMatchObject({
      iconPosX: 0.44,
      iconPosY: 0.7,
      arcsPosX: 0.5,
      arcsPosY: 0.56,
      opacity: 0.4,
      enabled: false,
    });
  });

  it('discards pre-release configurations from an older layout version', () => {
    localStorage.setItem(
      'woc_aura_overlays:warrior:Raido',
      JSON.stringify({
        __layoutVersion: 6,
        revenge_free: {
          ...defaultAuraOverlayConfig('revenge_free'),
          iconPosX: 0.2,
          arcsScale: 1.55,
          groundOrder: 4,
        },
      }),
    );

    const store = new AuraOverlayConfigStore('warrior:Raido');

    expect(store.get('revenge_free')).toEqual(defaultAuraOverlayConfig('revenge_free'));
    expect(JSON.parse(localStorage.getItem('woc_aura_overlays:warrior:Raido') ?? '{}')).toEqual({
      __layoutVersion: 8,
    });
  });

  it('discards pre-release configurations without a layout version', () => {
    localStorage.setItem(
      'woc_aura_overlays:warrior:Raido',
      JSON.stringify({
        revenge_free: {
          ...defaultAuraOverlayConfig('revenge_free'),
          iconPosX: 0.2,
        },
      }),
    );

    const store = new AuraOverlayConfigStore('warrior:Raido');

    expect(store.get('revenge_free')).toEqual(defaultAuraOverlayConfig('revenge_free'));
    expect(JSON.parse(localStorage.getItem('woc_aura_overlays:warrior:Raido') ?? '{}')).toEqual({
      __layoutVersion: 8,
    });
  });
});

describe('AuraOverlayConfigStore watchlist', () => {
  it('persists the picked spells and reads them back on the next session', () => {
    const store = new AuraOverlayConfigStore('warrior:Raido');
    expect(store.getWatched()).toEqual([]);

    store.setWatched(['watch:recklessness', 'watch:die_by_sword']);

    expect(new AuraOverlayConfigStore('warrior:Raido').getWatched()).toEqual([
      'watch:recklessness',
      'watch:die_by_sword',
    ]);
  });

  it('scopes the watchlist per character, like every other aura setting', () => {
    new AuraOverlayConfigStore('warrior:Raido').setWatched(['watch:recklessness']);
    expect(new AuraOverlayConfigStore('warrior:Other').getWatched()).toEqual([]);
  });

  it('keeps the watchlist through a per-proc write and vice versa', () => {
    const store = new AuraOverlayConfigStore('warrior:Raido');
    store.setWatched(['watch:recklessness']);
    store.patch('watch:recklessness', { color: '#123456' });
    store.patchLayout({ crescentBlockScale: 1.2 });

    const reloaded = new AuraOverlayConfigStore('warrior:Raido');
    expect(reloaded.getWatched()).toEqual(['watch:recklessness']);
    expect(reloaded.get('watch:recklessness').color).toBe('#123456');
    expect(reloaded.getLayout().crescentBlockScale).toBe(1.2);
  });

  it('drops junk out of a corrupted watchlist instead of failing the boot', () => {
    localStorage.setItem(
      'woc_aura_overlays:warrior:Raido',
      JSON.stringify({ __layoutVersion: 8, __watched: ['watch:a', 'revenge_free', 3, 'watch:a'] }),
    );
    expect(new AuraOverlayConfigStore('warrior:Raido').getWatched()).toEqual(['watch:a']);
  });

  it('reports a saved config apart from a defaulted one, and never for a reserved key', () => {
    const store = new AuraOverlayConfigStore('warrior:Raido');
    expect(store.has('watch:recklessness')).toBe(false);
    store.patch('watch:recklessness', { enabled: true });
    expect(store.has('watch:recklessness')).toBe(true);
    store.setWatched(['watch:recklessness']);
    store.patchLayout({ crescentBlockScale: 1.2 });
    expect(store.has('__watched')).toBe(false);
    expect(store.has('__layout')).toBe(false);
    expect(store.has('__layoutVersion')).toBe(false);
  });
});

describe('genericPaletteColor', () => {
  it('walks the class palette so consecutive watched spells differ', () => {
    const shaman = [0, 1, 2, 3].map((slot) => genericPaletteColor('shaman', slot));
    expect(new Set(shaman).size).toBe(4);
    expect(shaman[0]).toBe('#22d3ee');
  });

  it('gives Warrior and Mage a rotating fallback, since neither has a generic row', () => {
    // Both carry bespoke per-proc tables instead, so an unhandled lookup used to
    // collapse every watched spell on those classes onto one gold.
    for (const playerClass of ['warrior', 'mage']) {
      const colors = [0, 1, 2, 3].map((slot) => genericPaletteColor(playerClass, slot));
      expect(new Set(colors).size).toBe(4);
    }
  });

  it('wraps past the end of a palette and survives a junk slot', () => {
    expect(genericPaletteColor('shaman', 7)).toBe(genericPaletteColor('shaman', 0));
    expect(genericPaletteColor('shaman', -3)).toBe(genericPaletteColor('shaman', 0));
    expect(genericPaletteColor('shaman', Number.NaN)).toBe(genericPaletteColor('shaman', 0));
  });
});
