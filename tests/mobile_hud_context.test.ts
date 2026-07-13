import { describe, expect, it } from 'vitest';
import {
  isMobileHudSurfaceAvailable,
  MOBILE_HUD_BOTTOM_INSET_FIXTURES,
  MOBILE_HUD_CONTEXTS,
  MOBILE_HUD_EDITOR_CONTEXTS,
  MOBILE_HUD_GEOMETRY_MATRIX,
  MOBILE_HUD_SCENES,
  MOBILE_HUD_SIDE_INSET_FIXTURES,
  MOBILE_HUD_VIEWPORTS,
  type MobileHudRuntimeSnapshot,
  resolveMobileHudContext,
  resolveMobileHudEditorContext,
} from '../src/ui/mobile_hud_context';

describe('mobile HUD surface availability', () => {
  it.each([
    ['hunter', true],
    ['warlock', true],
    ['rogue', false],
    ['mage', false],
    ['warrior', false],
  ] as const)('gates Pet Controls for %s', (playerClass, expected) => {
    expect(isMobileHudSurfaceAvailable('pet.commands', playerClass)).toBe(expected);
    expect(isMobileHudSurfaceAvailable('action.attack', playerClass)).toBe(true);
  });
});

describe('mobile HUD context fixtures', () => {
  it('groups every canonical context into exactly one of eight editor scenes', () => {
    expect(MOBILE_HUD_SCENES).toEqual([
      { id: 'world', contextIds: ['world.base', 'world.vale_cup_indicator'] },
      { id: 'arena.standard', contextIds: ['arena.standard'] },
      {
        id: 'arena.fiesta',
        contextIds: [
          'arena.fiesta.base',
          'arena.fiesta.pending',
          'arena.fiesta.respawn',
          'arena.fiesta.offer',
          'arena.fiesta.respawn_offer',
        ],
      },
      {
        id: 'arena.yumi',
        contextIds: ['arena.yumi.base', 'arena.yumi.respawn', 'arena.yumi.returning'],
      },
      { id: 'vale_cup.briefing', contextIds: ['vale_cup.briefing'] },
      { id: 'vale_cup.match', contextIds: ['vale_cup.match', 'vale_cup.match.charge'] },
      { id: 'vale_cup.spectator', contextIds: ['vale_cup.spectator.betting'] },
      { id: 'instance.delve', contextIds: ['instance.delve'] },
    ]);
    const grouped = MOBILE_HUD_SCENES.flatMap((scene) => scene.contextIds);
    expect(new Set(grouped).size).toBe(16);
    expect(grouped).toEqual(MOBILE_HUD_CONTEXTS.map((context) => context.id));
  });

  it('pins all 16 contexts to their preview scenes', () => {
    expect(MOBILE_HUD_CONTEXTS.map(({ id, sceneId }) => [id, sceneId])).toEqual([
      ['world.base', 'world'],
      ['world.vale_cup_indicator', 'world'],
      ['arena.standard', 'arena.standard'],
      ['arena.fiesta.base', 'arena.fiesta'],
      ['arena.fiesta.pending', 'arena.fiesta'],
      ['arena.fiesta.respawn', 'arena.fiesta'],
      ['arena.fiesta.offer', 'arena.fiesta'],
      ['arena.fiesta.respawn_offer', 'arena.fiesta'],
      ['arena.yumi.base', 'arena.yumi'],
      ['arena.yumi.respawn', 'arena.yumi'],
      ['arena.yumi.returning', 'arena.yumi'],
      ['vale_cup.briefing', 'vale_cup.briefing'],
      ['vale_cup.match', 'vale_cup.match'],
      ['vale_cup.match.charge', 'vale_cup.match'],
      ['vale_cup.spectator.betting', 'vale_cup.spectator'],
      ['instance.delve', 'instance.delve'],
    ]);
  });

  it('offers only nine unique editor previews and aliases equivalent runtime states', () => {
    expect(MOBILE_HUD_EDITOR_CONTEXTS.map((context) => context.id)).toEqual([
      'world.base',
      'world.vale_cup_indicator',
      'arena.standard',
      'arena.fiesta.base',
      'arena.fiesta.pending',
      'arena.yumi.base',
      'vale_cup.match',
      'vale_cup.match.charge',
      'instance.delve',
    ]);
    expect(resolveMobileHudEditorContext('arena.fiesta.respawn')).toBe('arena.fiesta.base');
    expect(resolveMobileHudEditorContext('arena.fiesta.offer')).toBe('arena.fiesta.base');
    expect(resolveMobileHudEditorContext('arena.fiesta.respawn_offer')).toBe('arena.fiesta.base');
    expect(resolveMobileHudEditorContext('arena.yumi.respawn')).toBe('arena.yumi.base');
    expect(resolveMobileHudEditorContext('arena.yumi.returning')).toBe('arena.standard');
    expect(resolveMobileHudEditorContext('vale_cup.briefing')).toBe('world.base');
    expect(resolveMobileHudEditorContext('vale_cup.spectator.betting')).toBe('world.base');
  });

  it('pins the five phone and one tablet canonical viewports', () => {
    expect(MOBILE_HUD_VIEWPORTS).toEqual([
      { id: 'phone-740x360', profileId: 'phone', width: 740, height: 360 },
      { id: 'phone-844x390', profileId: 'phone', width: 844, height: 390 },
      { id: 'phone-915x412', profileId: 'phone', width: 915, height: 412 },
      { id: 'phone-932x430', profileId: 'phone', width: 932, height: 430 },
      { id: 'phone-1280x720', profileId: 'phone', width: 1280, height: 720 },
      { id: 'tablet-1024x768', profileId: 'tablet', width: 1024, height: 768 },
    ]);
  });

  it('pins the four side-inset and two bottom-inset fixtures', () => {
    expect(MOBILE_HUD_SIDE_INSET_FIXTURES).toEqual([
      { id: 'side-none', left: 0, right: 0 },
      { id: 'side-left-50', left: 50, right: 0 },
      { id: 'side-right-50', left: 0, right: 50 },
      { id: 'side-bilateral-50', left: 50, right: 50 },
    ]);
    expect(MOBILE_HUD_BOTTOM_INSET_FIXTURES).toEqual([
      { id: 'bottom-0', bottom: 0 },
      { id: 'bottom-24', bottom: 24 },
    ]);
  });

  it('builds the complete 768-case profile geometry and context matrix', () => {
    expect(MOBILE_HUD_GEOMETRY_MATRIX).toHaveLength(6 * 4 * 2 * 16);
    expect(new Set(MOBILE_HUD_GEOMETRY_MATRIX.map((fixture) => fixture.id)).size).toBe(768);
    for (const viewport of MOBILE_HUD_VIEWPORTS) {
      expect(
        MOBILE_HUD_GEOMETRY_MATRIX.filter((fixture) => fixture.viewport.id === viewport.id),
      ).toHaveLength(4 * 2 * 16);
    }
  });

  it('combines side and bottom fixtures into exact safe-area geometry', () => {
    const fixture = MOBILE_HUD_GEOMETRY_MATRIX.find(
      (candidate) =>
        candidate.viewport.id === 'phone-844x390' &&
        candidate.sideInset.id === 'side-bilateral-50' &&
        candidate.bottomInset.id === 'bottom-24' &&
        candidate.context.id === 'arena.fiesta.respawn_offer',
    );
    expect(fixture?.geometry).toEqual({
      id: 'phone-844x390/side-bilateral-50/bottom-24',
      width: 844,
      height: 390,
      visualOffsetX: 0,
      visualOffsetY: 0,
      safeAreaInsets: { top: 0, right: 50, bottom: 24, left: 50 },
    });
  });

  it('freezes every canonical fixture and matrix entry', () => {
    for (const collection of [
      MOBILE_HUD_SCENES,
      MOBILE_HUD_CONTEXTS,
      MOBILE_HUD_VIEWPORTS,
      MOBILE_HUD_SIDE_INSET_FIXTURES,
      MOBILE_HUD_BOTTOM_INSET_FIXTURES,
      MOBILE_HUD_GEOMETRY_MATRIX,
    ]) {
      expect(Object.isFrozen(collection)).toBe(true);
      expect(collection.every((entry) => Object.isFrozen(entry))).toBe(true);
    }
  });
});

const runtimeSnapshot = (
  overrides: Partial<MobileHudRuntimeSnapshot> = {},
): MobileHudRuntimeSnapshot => ({
  valeCupPlayerState: 'none',
  valeCupShootCharging: false,
  arenaMode: 'none',
  arenaPlayerDown: false,
  arenaFiestaOfferVisible: false,
  arenaFiestaPending: false,
  arenaYumiReturning: false,
  valeCupSpectatorBetting: false,
  delveActive: false,
  valeCupIndicatorVisible: false,
  ...overrides,
});

describe('resolveMobileHudContext', () => {
  it.each([
    ['world.base', {}],
    ['world.vale_cup_indicator', { valeCupIndicatorVisible: true }],
    ['arena.standard', { arenaMode: 'standard' }],
    ['arena.fiesta.base', { arenaMode: 'fiesta' }],
    ['arena.fiesta.pending', { arenaMode: 'fiesta', arenaFiestaPending: true }],
    ['arena.fiesta.respawn', { arenaMode: 'fiesta', arenaPlayerDown: true }],
    ['arena.fiesta.offer', { arenaMode: 'fiesta', arenaFiestaOfferVisible: true }],
    [
      'arena.fiesta.respawn_offer',
      { arenaMode: 'fiesta', arenaPlayerDown: true, arenaFiestaOfferVisible: true },
    ],
    ['arena.yumi.base', { arenaMode: 'yumi' }],
    ['arena.yumi.respawn', { arenaMode: 'yumi', arenaPlayerDown: true }],
    ['arena.yumi.returning', { arenaMode: 'yumi', arenaYumiReturning: true }],
    ['vale_cup.briefing', { valeCupPlayerState: 'briefing' }],
    ['vale_cup.match', { valeCupPlayerState: 'match' }],
    ['vale_cup.match.charge', { valeCupPlayerState: 'match', valeCupShootCharging: true }],
    ['vale_cup.spectator.betting', { valeCupSpectatorBetting: true }],
    ['instance.delve', { delveActive: true }],
  ] as const)('resolves %s from its normalized snapshot', (expected, overrides) => {
    expect(resolveMobileHudContext(runtimeSnapshot(overrides))).toBe(expected);
  });

  it('gives a player-owned Vale Cup state priority over Arena and emits one development diagnostic', () => {
    const diagnostics: string[] = [];
    const result = resolveMobileHudContext(
      runtimeSnapshot({ valeCupPlayerState: 'match', arenaMode: 'fiesta' }),
      { development: true, onDiagnostic: (diagnostic) => diagnostics.push(diagnostic) },
    );
    expect(result).toBe('vale_cup.match');
    expect(diagnostics).toEqual(['vale-cup-player-state-with-arena']);
  });

  it('does not emit the malformed Cup plus Arena diagnostic outside development', () => {
    const diagnostics: string[] = [];
    resolveMobileHudContext(runtimeSnapshot({ valeCupPlayerState: 'match', arenaMode: 'yumi' }), {
      development: false,
      onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    });
    expect(diagnostics).toEqual([]);
  });

  it('gives Arena priority over Delve and spectator betting', () => {
    expect(
      resolveMobileHudContext(
        runtimeSnapshot({
          arenaMode: 'standard',
          delveActive: true,
          valeCupSpectatorBetting: true,
        }),
      ),
    ).toBe('arena.standard');
  });

  it('hides Fiesta pending behind an offer or respawn state', () => {
    expect(
      resolveMobileHudContext(
        runtimeSnapshot({
          arenaMode: 'fiesta',
          arenaFiestaPending: true,
          arenaPlayerDown: true,
          arenaFiestaOfferVisible: true,
        }),
      ),
    ).toBe('arena.fiesta.respawn_offer');
  });
});
