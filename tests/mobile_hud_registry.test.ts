import { describe, expect, it } from 'vitest';
import {
  MOBILE_HUD_CONTEXTS,
  MOBILE_HUD_EDITOR_CONTEXTS,
  resolveMobileHudEditorContext,
} from '../src/ui/mobile_hud_context';
import type {
  MobileHudContextId,
  MobileHudEditCapability,
  MobileHudSurfaceDescriptor,
} from '../src/ui/mobile_hud_editor_types';
import {
  buildMobileHudRegistry,
  MOBILE_HUD_CONTEXT_ALIASES,
  MOBILE_HUD_CONTEXT_DESCRIPTORS,
  MOBILE_HUD_REGISTRY,
  MOBILE_HUD_SHARED_ACTION_DESCRIPTORS,
  MOBILE_HUD_SHARED_COMPOSITE_DESCRIPTORS,
  mergeMobileHudPlacementDefaults,
} from '../src/ui/mobile_hud_registry';
import { createMobileHudDefaultPlacements } from '../src/ui/mobile_hud_registry_defaults';

const descriptor = (
  overrides: Partial<MobileHudSurfaceDescriptor> = {},
): MobileHudSurfaceDescriptor => ({
  id: 'action.a1',
  class: 'movable',
  coordinateHost: 'body-visual',
  visibleIn: ['world.base'],
  validateIn: ['world.base'],
  defaultSize: { width: 48, height: 48 },
  edgeMargin: 4,
  comfortPadding: 2,
  scaleLimits: { min: 0.8, max: 1.4, step: 0.1 },
  capabilities: ['scale'],
  mirrorPolicy: 'position',
  ...overrides,
});

describe('createMobileHudDefaultPlacements', () => {
  it('keeps device-specific placements in a pure data module', () => {
    const defaults = createMobileHudDefaultPlacements();

    expect(defaults.phone['action.a1']).toEqual({
      anchor: 'bottom-right',
      offsetX: -178,
      offsetY: -70,
      scale: 1,
    });
    expect(defaults.tablet['action.a1']).toEqual({
      anchor: 'bottom-right',
      offsetX: -212,
      offsetY: -90,
      scale: 1,
    });
    expect(defaults.tablet['status.arena.generic']).toEqual(defaults.phone['status.arena.generic']);
  });
});

describe('buildMobileHudRegistry schema invariants', () => {
  it('builds a minimal immutable registry with sparse valid defaults', () => {
    const registry = buildMobileHudRegistry({
      descriptors: [descriptor()],
      defaults: {
        phone: {
          'action.a1': { anchor: 'bottom-right', offsetX: -20, offsetY: -20, scale: 1 },
        },
      },
    });
    expect(registry.descriptors.map((entry) => entry.id)).toEqual(['action.a1']);
    expect(registry.getDescriptor('action.a1')?.defaultSize).toEqual({ width: 48, height: 48 });
    expect(Object.isFrozen(registry)).toBe(true);
    expect(Object.isFrozen(registry.descriptors[0])).toBe(true);
  });

  it('rejects duplicate stable surface IDs', () => {
    expect(() => buildMobileHudRegistry({ descriptors: [descriptor(), descriptor()] })).toThrow(
      'duplicate mobile HUD surface id: action.a1',
    );
  });

  it('rejects unknown context IDs in descriptor context sets', () => {
    expect(() =>
      buildMobileHudRegistry({
        descriptors: [descriptor({ visibleIn: ['world.unknown' as MobileHudContextId] })],
      }),
    ).toThrow('action.a1 visibleIn contains unknown context: world.unknown');
  });

  it('rejects unsupported or internally inconsistent capabilities', () => {
    expect(() =>
      buildMobileHudRegistry({
        descriptors: [descriptor({ capabilities: ['scale', 'rotate' as MobileHudEditCapability] })],
      }),
    ).toThrow('action.a1 has unsupported capability: rotate');
    expect(() =>
      buildMobileHudRegistry({ descriptors: [descriptor({ capabilities: ['scale', 'reverse'] })] }),
    ).toThrow('action.a1 reverse capability requires orientation');
  });

  it('rejects placement fields that the descriptor does not support', () => {
    expect(() =>
      buildMobileHudRegistry({
        descriptors: [descriptor()],
        defaults: {
          phone: {
            'action.a1': {
              anchor: 'bottom-right',
              offsetX: -20,
              offsetY: -20,
              scale: 1,
              orientation: 'vertical',
            },
          },
        },
      }),
    ).toThrow('action.a1 default orientation requires orientation capability');
  });

  it('requires visibleIn to be a subset of validateIn', () => {
    expect(() =>
      buildMobileHudRegistry({
        descriptors: [
          descriptor({
            visibleIn: ['world.base', 'arena.standard'],
            validateIn: ['world.base'],
          }),
        ],
      }),
    ).toThrow('action.a1 visible context is not validated: arena.standard');
  });

  it('requires overlap declarations to be reciprocal', () => {
    expect(() =>
      buildMobileHudRegistry({
        descriptors: [
          descriptor({ id: 'action.a1', allowOverlapWith: ['action.a2'] }),
          descriptor({ id: 'action.a2' }),
        ],
      }),
    ).toThrow('overlap declaration must be reciprocal: action.a1 <-> action.a2');
  });

  it('keeps informational policy movable and foreground policy protected', () => {
    expect(() =>
      buildMobileHudRegistry({
        descriptors: [descriptor({ overlapPolicy: 'foreground-overlay' })],
      }),
    ).toThrow('action.a1 foreground overlays must be protected surfaces');
    expect(() =>
      buildMobileHudRegistry({
        descriptors: [
          {
            ...descriptor(),
            class: 'protected',
            capabilities: [],
            scaleLimits: undefined,
            protectedFootprint: () => ({ x: 0, y: 0, width: 40, height: 40 }),
            overlapPolicy: 'informational-overlay',
          },
        ],
      }),
    ).toThrow('action.a1 informational overlays must be movable surfaces');
  });
});

describe('shared mobile HUD action and joystick descriptors', () => {
  it('registers every combat seat individually instead of persisting the action ring', () => {
    expect(MOBILE_HUD_SHARED_ACTION_DESCRIPTORS.map((entry) => entry.id)).toEqual([
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
    ]);
  });

  it('makes every shared descriptor visible and validated in all 16 contexts', () => {
    const expectedContexts = [
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
    ];
    for (const entry of MOBILE_HUD_SHARED_ACTION_DESCRIPTORS) {
      expect(entry.visibleIn, `${entry.id} visibleIn`).toEqual(expectedContexts);
      expect(entry.validateIn, `${entry.id} validateIn`).toEqual(expectedContexts);
    }
  });

  it('pins one 48px target floor and DOM binding per combat seat', () => {
    const expectedBindings = new Map([
      ['action.a1', '#mobile-action-ring > .mobile-action-slot[data-mobile-index="0"]'],
      ['action.a2', '#mobile-action-ring > .mobile-action-slot[data-mobile-index="1"]'],
      ['action.a3', '#mobile-action-ring > .mobile-action-slot[data-mobile-index="2"]'],
      ['action.a4', '#mobile-action-ring > .mobile-action-slot[data-mobile-index="3"]'],
      ['action.a5', '#mobile-action-ring > .mobile-action-slot[data-mobile-index="4"]'],
      ['action.attack', '#mobile-action-attack'],
      ['action.target', '#mobile-target-cycle'],
      ['action.jump_use', '#mobile-jump'],
      ['action.page', '#mobile-action-page-toggle'],
    ]);
    for (const entry of MOBILE_HUD_SHARED_ACTION_DESCRIPTORS.slice(0, 9)) {
      expect(entry.minimumTargetSize, `${entry.id} target floor`).toEqual({
        width: 48,
        height: 48,
      });
      expect(entry.binding?.rootSelector, `${entry.id} binding`).toBe(
        expectedBindings.get(entry.id),
      );
      expect(entry.binding?.coordinateHost).toBe('body-visual');
      expect(entry.mirrorPolicy).toBe('position');
      expect(entry.capabilities).toEqual(['scale']);
    }
  });

  it('keeps Jump larger while preserving the shared accessibility floor', () => {
    const jump = MOBILE_HUD_SHARED_ACTION_DESCRIPTORS.find(
      (entry) => entry.id === 'action.jump_use',
    );
    expect(jump?.defaultSize).toEqual({ width: 56, height: 56 });
    expect(jump?.profileSizes?.tablet).toEqual({ width: 64, height: 64 });
    expect(jump?.scaleLimits).toEqual({ min: 0.9, max: 1.5, step: 0.1 });
  });

  it('pins the Movement capture envelope and its resting joystick dependent root', () => {
    const movement = MOBILE_HUD_SHARED_ACTION_DESCRIPTORS.find(
      (entry) => entry.id === 'control.movement',
    );
    expect(movement).toMatchObject({
      defaultSize: { width: 134, height: 172 },
      minimumTargetSize: { width: 112, height: 112 },
      comfortPadding: 4,
      scaleLimits: { min: 0.9, max: 1.4, step: 0.1 },
      binding: {
        rootSelector: '#mobile-move-zone',
        dependentRootSelectors: ['#mobile-move-joystick'],
        editorVisualSelectors: ['#mobile-move-joystick'],
        coordinateHost: 'body-visual',
      },
    });
  });

  it('pins the View reserve and optional joystick to one body-visual descriptor', () => {
    const view = MOBILE_HUD_SHARED_ACTION_DESCRIPTORS.find((entry) => entry.id === 'control.view');
    expect(view).toMatchObject({
      defaultSize: { width: 220, height: 100 },
      minimumTargetSize: { width: 82, height: 82 },
      comfortPadding: 2,
      scaleLimits: { min: 0.9, max: 1.4, step: 0.1 },
      binding: {
        rootSelector: '#mobile-controls',
        dependentRootSelectors: ['#mobile-camera-joystick'],
        editorVisualSelectors: ['#mobile-camera-joystick'],
        editorVisibility: 'force-existing-root',
        coordinateHost: 'body-visual',
      },
    });
  });

  it('uses the action root as the editor visual by default and never the camera root container', () => {
    const attack = MOBILE_HUD_SHARED_ACTION_DESCRIPTORS.find(
      (entry) => entry.id === 'action.attack',
    );
    const view = MOBILE_HUD_SHARED_ACTION_DESCRIPTORS.find((entry) => entry.id === 'control.view');

    expect(attack?.binding?.editorVisualSelectors).toBeUndefined();
    expect(view?.binding?.rootSelector).toBe('#mobile-controls');
    expect(view?.binding?.editorVisualSelectors).toEqual(['#mobile-camera-joystick']);
    expect(view?.binding?.editorVisualSelectors).not.toContain('#mobile-controls');
  });
});

describe('shared mobile HUD composite descriptors', () => {
  it('registers the nine semantic composites and frames', () => {
    expect(MOBILE_HUD_SHARED_COMPOSITE_DESCRIPTORS.map((entry) => entry.id)).toEqual([
      'utility.consumables',
      'pet.commands',
      'party',
      'menu.top',
      'minimap.cluster',
      'frame.target',
      'frame.player',
      'auras.player_buffs',
      'auras.player_debuffs',
    ]);
  });

  it('assigns only the approved editing capabilities', () => {
    expect(
      Object.fromEntries(
        MOBILE_HUD_SHARED_COMPOSITE_DESCRIPTORS.map((entry) => [entry.id, entry.capabilities]),
      ),
    ).toEqual({
      'utility.consumables': ['scale', 'opening-direction'],
      'pet.commands': ['scale', 'orientation', 'reverse'],
      party: ['scale', 'orientation', 'reverse'],
      'menu.top': ['scale', 'orientation', 'reverse'],
      'minimap.cluster': ['scale'],
      'frame.target': ['scale'],
      'frame.player': ['scale'],
      'auras.player_buffs': ['scale', 'orientation', 'reverse'],
      'auras.player_debuffs': ['scale', 'orientation', 'reverse'],
    });
  });

  it('models closed and six-slot Consumables footprints in every opening direction', () => {
    const consumables = MOBILE_HUD_SHARED_COMPOSITE_DESCRIPTORS.find(
      (entry) => entry.id === 'utility.consumables',
    );
    expect(consumables?.minimumTargetSize).toEqual({ width: 48, height: 48 });
    expect(consumables?.variants?.map((variant) => [variant.id, variant.size])).toEqual([
      ['closed', { width: 48, height: 48 }],
      ['expanded-left-6', { width: 206, height: 100 }],
      ['expanded-right-6', { width: 206, height: 100 }],
      ['expanded-up-6', { width: 100, height: 206 }],
      ['expanded-down-6', { width: 100, height: 206 }],
    ]);
  });

  it('pins maximum Party and pet command footprints with their 40px target floors', () => {
    const party = MOBILE_HUD_SHARED_COMPOSITE_DESCRIPTORS.find((entry) => entry.id === 'party');
    const pet = MOBILE_HUD_SHARED_COMPOSITE_DESCRIPTORS.find(
      (entry) => entry.id === 'pet.commands',
    );
    expect(party?.minimumTargetSize).toEqual({ width: 40, height: 40 });
    expect(party?.variants?.map((variant) => [variant.id, variant.size])).toContainEqual([
      'expanded-five-with-leave',
      { width: 444, height: 40 },
    ]);
    expect(pet?.minimumTargetSize).toEqual({ width: 40, height: 40 });
    expect(pet?.variants?.map((variant) => [variant.id, variant.size])).toContainEqual([
      'all-seven-buttons',
      { width: 284, height: 40 },
    ]);
  });

  it('keeps Minimap dependents, target auras, and player bars on their parent binding', () => {
    const bindings = Object.fromEntries(
      MOBILE_HUD_SHARED_COMPOSITE_DESCRIPTORS.map((entry) => [
        entry.id,
        entry.binding?.dependentRootSelectors ?? [],
      ]),
    );
    expect(bindings['minimap.cluster']).toEqual([
      '#zone-label',
      '#minimap-disc',
      '#minimap-clock',
      '#minimap-coords',
      '#compass',
      '#raid-lockout',
      '#mail-indicator',
      '#minimap-zoom',
    ]);
    expect(bindings['frame.target']).toEqual(['#tf-debuffs']);
    expect(bindings['frame.player']).toEqual(['#xpbar', '#castbar', '#swingbar']);
  });

  it('targets only the visible base HUD for editor selection outlines', () => {
    const visuals = Object.fromEntries(
      MOBILE_HUD_REGISTRY.descriptors.map((entry) => [
        entry.id,
        entry.binding?.editorVisualSelectors,
      ]),
    );

    expect(visuals['control.movement']).toEqual(['#mobile-move-joystick']);
    expect(visuals['control.view']).toEqual(['#mobile-camera-joystick']);
    expect(visuals['utility.consumables']).toEqual(['#mobile-consumables-toggle']);
    expect(visuals['minimap.cluster']).toEqual(['#minimap-disc']);
    expect(visuals['auras.player_buffs']).toEqual(['#buff-bar .buff']);
    expect(visuals['auras.player_debuffs']).toEqual(['#debuff-bar .buff']);
  });

  it('measures dynamic composites from their painted children instead of transparent roots', () => {
    const geometrySelectors = Object.fromEntries(
      MOBILE_HUD_SHARED_COMPOSITE_DESCRIPTORS.map((entry) => [
        entry.id,
        entry.binding?.editorGeometrySelectors,
      ]),
    );

    expect(geometrySelectors['pet.commands']).toEqual(['#petbar .pet-btn .icon-label']);
    expect(geometrySelectors.party).toEqual([
      '#party-chip .ui-icon',
      '#party-frames .party-frame',
      '#party-leave .ui-icon',
    ]);
    expect(geometrySelectors['menu.top']).toEqual([
      '#mobile-menu-collapse-toggle',
      '#mobile-combat-buttons > .mobile-btn',
    ]);
    expect(geometrySelectors['frame.target']).toEqual([
      '#target-frame > .portrait-wrap > .portrait',
      '#target-frame > .portrait-wrap > .level-chip',
      '#target-frame > .portrait-wrap > #tf-elite-tag',
      '#target-frame > .uf-bars',
      '#target-frame > .uf-bars > #tf-castbar',
      '#target-frame > #tf-debuffs > .buff',
    ]);
    expect(geometrySelectors['frame.player']).toEqual([
      '#player-frame > .portrait-wrap > .portrait',
      '#player-frame > .portrait-wrap > .level-chip',
      '#player-frame > .uf-bars',
      '#player-frame > .uf-bars > #combo-row',
      '#castbar',
      '#swingbar',
    ]);
  });

  it('keeps Player interaction on its root while live geometry owns visual overflow', () => {
    const player = MOBILE_HUD_SHARED_COMPOSITE_DESCRIPTORS.find(
      (entry) => entry.id === 'frame.player',
    );

    expect(player?.defaultSize).toEqual({ width: 300, height: 68 });
    expect(player?.variants).toBeUndefined();
    expect(player?.primaryFootprint).toBeUndefined();
    expect(player?.binding?.editorPseudoGeometry).toEqual([
      { selector: '#player-frame', pseudo: '::before' },
    ]);
  });

  it('keeps Target interaction fixed while reserving its measured aura overflow', () => {
    const target = MOBILE_HUD_SHARED_COMPOSITE_DESCRIPTORS.find(
      (entry) => entry.id === 'frame.target',
    );

    expect(target?.primaryFootprint).toBeTypeOf('function');
    expect(target?.variants?.map(({ id, size }) => ({ id, size }))).toEqual([
      { id: 'base', size: { width: 236, height: 68 } },
      { id: 'with-target-auras', size: { width: 236, height: 142 } },
    ]);
  });

  it('measures action artwork from centered pseudo-faces, not transparent hitboxes', () => {
    for (const descriptor of MOBILE_HUD_SHARED_ACTION_DESCRIPTORS.filter((entry) =>
      entry.id.startsWith('action.'),
    )) {
      expect(descriptor.binding?.editorGeometrySelectors).toEqual([]);
      expect(descriptor.binding?.editorPseudoGeometry).toEqual([
        { selector: descriptor.binding?.rootSelector, pseudo: '::before' },
      ]);
    }
  });

  it('keeps runtime root sizing independent from worst-case validation variants', () => {
    const runtimeSizing = Object.fromEntries(
      MOBILE_HUD_SHARED_COMPOSITE_DESCRIPTORS.map((entry) => [
        entry.id,
        entry.binding?.runtimeSizing ?? 'validation-footprint',
      ]),
    );

    expect(runtimeSizing).toMatchObject({
      'utility.consumables': 'validation-footprint',
      'pet.commands': 'intrinsic',
      party: 'intrinsic',
      'menu.top': 'intrinsic',
      'minimap.cluster': 'validation-footprint',
      'frame.target': 'base-footprint',
      'frame.player': 'base-footprint',
      'auras.player_buffs': 'intrinsic',
      'auras.player_debuffs': 'intrinsic',
    });
  });

  it('pins populated eight-aura horizontal and vertical footprints independently', () => {
    for (const id of ['auras.player_buffs', 'auras.player_debuffs'] as const) {
      const descriptor = MOBILE_HUD_SHARED_COMPOSITE_DESCRIPTORS.find((entry) => entry.id === id);
      expect(descriptor?.variants?.map((variant) => [variant.id, variant.size])).toEqual([
        ['populated-horizontal-8', { width: 252, height: 28 }],
        ['populated-vertical-8', { width: 28, height: 252 }],
      ]);
    }
  });

  it('does not register Quest Tracker or Meters as layout surfaces', () => {
    const ids = MOBILE_HUD_SHARED_COMPOSITE_DESCRIPTORS.map((entry) => entry.id);
    expect(ids.some((id) => id.includes('quest'))).toBe(false);
    expect(ids.some((id) => id.includes('meter'))).toBe(false);
  });
});

describe('context-specific mobile HUD descriptors', () => {
  it('keeps every dropdown preview signature unique and aliases only equivalent states', () => {
    const signature = (contextId: MobileHudContextId): string =>
      MOBILE_HUD_REGISTRY.descriptors
        .filter(
          (entry) =>
            entry.visibleIn.includes(contextId) &&
            !entry.visibleIn.includes('world.base') &&
            entry.overlapPolicy !== 'foreground-overlay',
        )
        .map((entry) => entry.id)
        .sort()
        .join('|');
    const editorSignatures = MOBILE_HUD_EDITOR_CONTEXTS.map((context) => signature(context.id));

    expect(new Set(editorSignatures).size).toBe(MOBILE_HUD_EDITOR_CONTEXTS.length);
    for (const context of MOBILE_HUD_CONTEXTS) {
      expect(signature(context.id)).toBe(signature(resolveMobileHudEditorContext(context.id)));
    }
  });

  it('expands the three named context aliases exactly', () => {
    expect(MOBILE_HUD_CONTEXT_ALIASES).toEqual({
      FIESTA_ALL: [
        'arena.fiesta.base',
        'arena.fiesta.pending',
        'arena.fiesta.respawn',
        'arena.fiesta.offer',
        'arena.fiesta.respawn_offer',
      ],
      YUMI_ACTIVE: ['arena.yumi.base', 'arena.yumi.respawn'],
      VALE_MATCH_ALL: ['vale_cup.match', 'vale_cup.match.charge'],
    });
  });

  it('registers every approved movable status and protected ghost', () => {
    expect(MOBILE_HUD_CONTEXT_DESCRIPTORS.map((entry) => entry.id)).toEqual([
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
      'tracker.delve',
      'protected.system.center_message',
    ]);
  });

  it('pins exact visible and validation memberships for each context surface', () => {
    const memberships = Object.fromEntries(
      MOBILE_HUD_CONTEXT_DESCRIPTORS.map((entry) => [entry.id, entry.visibleIn]),
    );
    expect(memberships).toEqual({
      'status.arena.generic': [
        'arena.standard',
        ...MOBILE_HUD_CONTEXT_ALIASES.FIESTA_ALL,
        'arena.yumi.returning',
      ],
      'status.arena.fiesta_score': MOBILE_HUD_CONTEXT_ALIASES.FIESTA_ALL,
      'status.arena.fiesta_pending': ['arena.fiesta.pending'],
      'protected.arena.fiesta_respawn': ['arena.fiesta.respawn', 'arena.fiesta.respawn_offer'],
      'protected.arena.fiesta_offer': ['arena.fiesta.offer', 'arena.fiesta.respawn_offer'],
      'status.arena.yumi': MOBILE_HUD_CONTEXT_ALIASES.YUMI_ACTIVE,
      'protected.arena.yumi_respawn': ['arena.yumi.respawn'],
      'status.vale_cup.indicator': ['world.vale_cup_indicator'],
      'protected.vale_cup.briefing': ['vale_cup.briefing'],
      'status.vale_cup.match': MOBILE_HUD_CONTEXT_ALIASES.VALE_MATCH_ALL,
      'status.vale_cup.charge': ['vale_cup.match.charge'],
      'protected.vale_cup.betting': ['vale_cup.spectator.betting'],
      'tracker.delve': ['instance.delve'],
      'protected.system.center_message': [
        'world.base',
        'world.vale_cup_indicator',
        'arena.standard',
        ...MOBILE_HUD_CONTEXT_ALIASES.FIESTA_ALL,
        'arena.yumi.base',
        'arena.yumi.respawn',
        'arena.yumi.returning',
        'vale_cup.briefing',
        ...MOBILE_HUD_CONTEXT_ALIASES.VALE_MATCH_ALL,
        'vale_cup.spectator.betting',
        'instance.delve',
      ],
    });
    for (const entry of MOBILE_HUD_CONTEXT_DESCRIPTORS) {
      expect(entry.validateIn, `${entry.id} validateIn`).toEqual(entry.visibleIn);
    }
  });

  it('keeps protected ghosts fixed and gives only movable statuses scale capability', () => {
    for (const entry of MOBILE_HUD_CONTEXT_DESCRIPTORS) {
      if (entry.class === 'protected') {
        expect(entry.capabilities, entry.id).toEqual([]);
        expect(entry.protectedFootprint, entry.id).toBeTypeOf('function');
      } else {
        expect(entry.capabilities, entry.id).toEqual(['scale']);
        expect(entry.scaleLimits, entry.id).toEqual({
          min:
            entry.id === 'status.arena.yumi' || entry.id === 'status.vale_cup.indicator' ? 1 : 0.8,
          max: 1.4,
          step: 0.1,
        });
        expect(entry.protectedFootprint, entry.id).toBeUndefined();
      }
    }
  });

  it('gives every movable context status a full-size empty editor placeholder', () => {
    for (const entry of MOBILE_HUD_CONTEXT_DESCRIPTORS.filter(
      (descriptor) => descriptor.class === 'movable',
    )) {
      expect(entry.binding?.editorPlaceholderWhenEmpty, entry.id).toBe(true);
      expect(entry.binding?.editorPlaceholderUsesLayoutFootprint, entry.id).toBe(true);
    }
  });

  it('classifies informational and foreground overlays explicitly', () => {
    expect(
      Object.fromEntries(
        MOBILE_HUD_REGISTRY.descriptors
          .filter((entry) => entry.overlapPolicy)
          .map((entry) => [entry.id, entry.overlapPolicy]),
      ),
    ).toEqual({
      'auras.player_buffs': 'informational-overlay',
      'auras.player_debuffs': 'informational-overlay',
      'status.arena.generic': 'informational-overlay',
      'status.arena.fiesta_score': 'informational-overlay',
      'status.arena.fiesta_pending': 'informational-overlay',
      'protected.arena.fiesta_respawn': 'foreground-overlay',
      'protected.arena.fiesta_offer': 'foreground-overlay',
      'protected.arena.yumi_respawn': 'foreground-overlay',
      'protected.vale_cup.briefing': 'foreground-overlay',
      'status.vale_cup.match': 'informational-overlay',
      'status.vale_cup.charge': 'informational-overlay',
      'protected.vale_cup.betting': 'foreground-overlay',
      'tracker.delve': 'informational-overlay',
      'protected.system.center_message': 'foreground-overlay',
    });
    expect(MOBILE_HUD_REGISTRY.getDescriptor('status.vale_cup.indicator')?.overlapPolicy).toBe(
      undefined,
    );
    expect(MOBILE_HUD_REGISTRY.getDescriptor('status.arena.yumi')?.overlapPolicy).toBe(undefined);
  });
});

describe('protected mobile HUD footprint audit', () => {
  const geometry = (id: string, width: number) => ({
    id,
    width,
    height: 360,
    visualOffsetX: 0,
    visualOffsetY: 0,
    safeAreaInsets: { top: 0, right: 0, bottom: 0, left: 0 },
  });
  const protectedDescriptor = (
    id: 'protected.arena.fiesta_respawn' | 'protected.arena.fiesta_offer',
    x: (width: number) => number,
    allowProtectedOverlapWith?: readonly (
      | 'protected.arena.fiesta_respawn'
      | 'protected.arena.fiesta_offer'
    )[],
  ): MobileHudSurfaceDescriptor => ({
    id,
    class: 'protected',
    coordinateHost: 'ui-author',
    visibleIn: ['arena.fiesta.respawn_offer'],
    validateIn: ['arena.fiesta.respawn_offer'],
    defaultSize: { width: 100, height: 100 },
    edgeMargin: 0,
    comfortPadding: 0,
    capabilities: [],
    mirrorPolicy: 'none',
    allowProtectedOverlapWith,
    protectedFootprint: (viewport) => ({
      x: x(viewport.width),
      y: 0,
      width: 100,
      height: 100,
    }),
  });

  it('rejects an actual protected intersection without an exception', () => {
    expect(() =>
      buildMobileHudRegistry({
        descriptors: [
          protectedDescriptor('protected.arena.fiesta_respawn', () => 0),
          protectedDescriptor('protected.arena.fiesta_offer', () => 50),
        ],
        geometryAuditCases: [
          { contextId: 'arena.fiesta.respawn_offer', geometry: geometry('phone-740', 740) },
        ],
      }),
    ).toThrow(
      'protected mobile HUD footprints overlap: protected.arena.fiesta_respawn <-> protected.arena.fiesta_offer in arena.fiesta.respawn_offer at phone-740',
    );
  });

  it('rejects a one-sided protected exception before geometry is audited', () => {
    expect(() =>
      buildMobileHudRegistry({
        descriptors: [
          protectedDescriptor('protected.arena.fiesta_respawn', () => 0, [
            'protected.arena.fiesta_offer',
          ]),
          protectedDescriptor('protected.arena.fiesta_offer', () => 50),
        ],
      }),
    ).toThrow(
      'protected overlap declaration must be reciprocal: protected.arena.fiesta_respawn <-> protected.arena.fiesta_offer',
    );
  });

  it('audits every responsive geometry instead of accepting a wide-only fit', () => {
    expect(() =>
      buildMobileHudRegistry({
        descriptors: [
          protectedDescriptor('protected.arena.fiesta_respawn', () => 0),
          protectedDescriptor('protected.arena.fiesta_offer', (width) => (width < 800 ? 50 : 120)),
        ],
        geometryAuditCases: [
          { contextId: 'arena.fiesta.respawn_offer', geometry: geometry('wide', 844) },
          { contextId: 'arena.fiesta.respawn_offer', geometry: geometry('compact', 740) },
        ],
      }),
    ).toThrow('in arena.fiesta.respawn_offer at compact');
  });

  it('accepts an intersecting pair only with a reciprocal explicit exception', () => {
    expect(() =>
      buildMobileHudRegistry({
        descriptors: [
          protectedDescriptor('protected.arena.fiesta_respawn', () => 0, [
            'protected.arena.fiesta_offer',
          ]),
          protectedDescriptor('protected.arena.fiesta_offer', () => 50, [
            'protected.arena.fiesta_respawn',
          ]),
        ],
        geometryAuditCases: [
          { contextId: 'arena.fiesta.respawn_offer', geometry: geometry('phone-740', 740) },
        ],
      }),
    ).not.toThrow();
  });
});

describe('complete mobile HUD defaults and DOM adapter metadata', () => {
  const movableIds = MOBILE_HUD_REGISTRY.descriptors
    .filter((entry) => entry.class === 'movable')
    .map((entry) => entry.id);

  it('combines all shared and context descriptors into one registry', () => {
    expect(MOBILE_HUD_REGISTRY.descriptors).toHaveLength(34);
    expect(new Set(MOBILE_HUD_REGISTRY.descriptors.map((entry) => entry.id)).size).toBe(34);
  });

  it('defines deterministic phone and tablet defaults for every movable surface only', () => {
    expect(Object.keys(MOBILE_HUD_REGISTRY.defaults.phone ?? {}).sort()).toEqual(
      [...movableIds].sort(),
    );
    expect(Object.keys(MOBILE_HUD_REGISTRY.defaults.tablet ?? {}).sort()).toEqual(
      [...movableIds].sort(),
    );
    for (const descriptor of MOBILE_HUD_REGISTRY.descriptors) {
      if (descriptor.class === 'protected') {
        expect(MOBILE_HUD_REGISTRY.defaults.phone?.[descriptor.id], descriptor.id).toBeUndefined();
        expect(MOBILE_HUD_REGISTRY.defaults.tablet?.[descriptor.id], descriptor.id).toBeUndefined();
      }
    }
  });

  it('binds every movable root to its actual coordinate host and a stable property prefix', () => {
    for (const descriptor of MOBILE_HUD_REGISTRY.descriptors) {
      if (descriptor.class === 'protected') continue;
      expect(descriptor.binding, descriptor.id).toMatchObject({
        surfaceId: descriptor.id,
        coordinateHost: descriptor.coordinateHost,
        cssPropertyPrefix: `--mobile-hud-${descriptor.id.replaceAll('.', '-')}`,
      });
      expect(descriptor.binding?.rootSelector, descriptor.id).toMatch(/^#/);
    }
  });

  it('keeps only body controls in visual space and every HUD-owned root in author space', () => {
    const bodyIds = MOBILE_HUD_REGISTRY.descriptors
      .filter((entry) => entry.class === 'movable' && entry.coordinateHost === 'body-visual')
      .map((entry) => entry.id);
    expect(bodyIds).toEqual([
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
      'menu.top',
    ]);
    expect(
      MOBILE_HUD_REGISTRY.descriptors
        .filter((entry) => entry.class === 'movable' && entry.coordinateHost === 'ui-author')
        .every((entry) => entry.binding?.coordinateHost === 'ui-author'),
    ).toBe(true);
  });

  it('marks Movement so the custom adapter never replaces its runtime floating left and top', () => {
    expect(MOBILE_HUD_REGISTRY.getDescriptor('control.movement')?.binding).toMatchObject({
      rootSelector: '#mobile-move-zone',
      preserveRuntimePosition: true,
    });
  });

  it('inserts a registered default when persisted placements predate that descriptor', () => {
    const merged = mergeMobileHudPlacementDefaults(MOBILE_HUD_REGISTRY, 'phone', {
      'action.a1': { anchor: 'center', offsetX: 12, offsetY: 8, scale: 1.2 },
    });
    expect(merged['action.a1']).toEqual({
      anchor: 'center',
      offsetX: 12,
      offsetY: 8,
      scale: 1.2,
    });
    expect(merged['status.vale_cup.charge']).toEqual(
      MOBILE_HUD_REGISTRY.defaults.phone?.['status.vale_cup.charge'],
    );
    expect(Object.keys(merged).sort()).toEqual([...movableIds].sort());
  });
});
