import { describe, expect, it } from 'vitest';
import {
  isMobileHudPlacement,
  MOBILE_HUD_ANCHORS,
  MOBILE_HUD_CONTEXT_IDS,
  MOBILE_HUD_COORDINATE_HOSTS,
  MOBILE_HUD_LAYOUT_SCHEMA_VERSION,
  MOBILE_HUD_LAYOUT_STORAGE_KEY,
  MOBILE_HUD_PROFILE_IDS,
  MOBILE_HUD_SCENE_IDS,
  MOBILE_HUD_SURFACE_IDS,
  type MobileHudLayoutDocumentV1,
  type MobileHudLayoutStorage,
  type MobileHudPlacement,
} from '../src/ui/mobile_hud_editor_types';

describe('mobile HUD editor model', () => {
  it('pins the versioned storage contract', () => {
    expect(MOBILE_HUD_LAYOUT_SCHEMA_VERSION).toBe(1);
    expect(MOBILE_HUD_LAYOUT_STORAGE_KEY).toBe('woc_mobile_hud_layout_v1_defaults_3');
  });

  it('pins the two profiles and coordinate hosts', () => {
    expect(MOBILE_HUD_PROFILE_IDS).toEqual(['phone', 'tablet']);
    expect(MOBILE_HUD_COORDINATE_HOSTS).toEqual(['body-visual', 'ui-author']);
  });

  it('pins all nine internal safe-viewport anchors', () => {
    expect(MOBILE_HUD_ANCHORS).toEqual([
      'top-left',
      'top-center',
      'top-right',
      'center-left',
      'center',
      'center-right',
      'bottom-left',
      'bottom-center',
      'bottom-right',
    ]);
  });

  it('pins the eight editor scenes', () => {
    expect(MOBILE_HUD_SCENE_IDS).toEqual([
      'world',
      'arena.standard',
      'arena.fiesta',
      'arena.yumi',
      'vale_cup.briefing',
      'vale_cup.match',
      'vale_cup.spectator',
      'instance.delve',
    ]);
  });

  it('pins every canonical validation context', () => {
    expect(MOBILE_HUD_CONTEXT_IDS).toEqual([
      'world.base',
      'world.vale_cup_indicator',
      'arena.standard',
      'arena.fiesta.base',
      'arena.fiesta.pending',
      'arena.fiesta.respawn',
      'arena.fiesta.offer',
      'arena.fiesta.respawn_offer',
      'arena.yumi.base',
      'arena.yumi.respawn',
      'arena.yumi.returning',
      'vale_cup.briefing',
      'vale_cup.match',
      'vale_cup.match.charge',
      'vale_cup.spectator.betting',
      'instance.delve',
    ]);
  });

  it('pins every movable and protected registry surface', () => {
    expect(MOBILE_HUD_SURFACE_IDS).toEqual([
      'action.a1',
      'action.a2',
      'action.a3',
      'action.a4',
      'action.a5',
      'action.attack',
      'action.target',
      'action.jump_use',
      'action.page',
      'control.movement',
      'control.view',
      'utility.consumables',
      'pet.commands',
      'party',
      'menu.top',
      'minimap.cluster',
      'frame.target',
      'frame.player',
      'auras.player_buffs',
      'auras.player_debuffs',
      'status.arena.generic',
      'status.arena.fiesta_score',
      'status.arena.fiesta_pending',
      'protected.arena.fiesta_respawn',
      'protected.arena.fiesta_offer',
      'status.arena.yumi',
      'protected.arena.yumi_respawn',
      'status.vale_cup.indicator',
      'protected.vale_cup.briefing',
      'status.vale_cup.match',
      'status.vale_cup.charge',
      'protected.vale_cup.betting',
      'tracker.deeds',
      'tracker.delve',
      'protected.system.center_message',
    ]);
  });

  it('allows sparse profile documents without duplicating layouts per scene', () => {
    const placement: MobileHudPlacement = {
      anchor: 'bottom-right',
      offsetX: -24,
      offsetY: -18,
      scale: 1,
    };
    const document: MobileHudLayoutDocumentV1 = {
      schemaVersion: 1,
      enabled: false,
      profiles: { phone: { 'action.a1': placement } },
    };
    expect(document.profiles.phone?.['action.a1']).toEqual(placement);
    expect(document.profiles.tablet).toBeUndefined();
  });

  it.each([
    ['offsetX NaN', { anchor: 'center', offsetX: Number.NaN, offsetY: 0, scale: 1 }],
    ['offsetY Infinity', { anchor: 'center', offsetX: 0, offsetY: Infinity, scale: 1 }],
    ['scale Infinity', { anchor: 'center', offsetX: 0, offsetY: 0, scale: Infinity }],
    ['zero scale', { anchor: 'center', offsetX: 0, offsetY: 0, scale: 0 }],
  ])('rejects a structurally invalid placement with %s', (_name, placement) => {
    expect(isMobileHudPlacement(placement)).toBe(false);
  });

  it('accepts a finite placement with supported optional capabilities', () => {
    expect(
      isMobileHudPlacement({
        anchor: 'top-left',
        offsetX: 12.5,
        offsetY: 8,
        scale: 1.1,
        orientation: 'vertical',
        reverse: true,
        openingDirection: 'down',
      }),
    ).toBe(true);
  });

  it('keeps storage asynchronous and independent from localStorage', async () => {
    const writes: string[] = [];
    const storage: MobileHudLayoutStorage = {
      async load() {
        return null;
      },
      async save(serialized) {
        writes.push(serialized);
      },
    };
    expect(await storage.load()).toBeNull();
    await storage.save('{}');
    expect(writes).toEqual(['{}']);
  });
});
