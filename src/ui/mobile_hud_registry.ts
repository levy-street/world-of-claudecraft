import {
  MOBILE_HUD_CONTEXT_IDS,
  type MobileHudDomBinding,
  type MobileHudRect,
  type MobileHudSurfaceDescriptor,
  type MobileHudSurfaceId,
  type MobileHudViewportGeometry,
} from './mobile_hud_editor_types';
import { buildMobileHudRegistry } from './mobile_hud_registry_builder';
import { createMobileHudDefaultPlacements } from './mobile_hud_registry_defaults';

export type {
  MobileHudDefaultPlacements,
  MobileHudProtectedGeometryAuditCase,
  MobileHudRegistry,
  MobileHudRegistryDefinition,
} from './mobile_hud_registry_builder';
export {
  buildMobileHudRegistry,
  mergeMobileHudPlacementDefaults,
} from './mobile_hud_registry_builder';

const ALL_CONTEXTS = Object.freeze([...MOBILE_HUD_CONTEXT_IDS]);

function bodyBinding(
  surfaceId: MobileHudSurfaceId,
  rootSelector: string,
  dependentRootSelectors?: readonly string[],
): MobileHudDomBinding {
  return {
    surfaceId,
    coordinateHost: 'body-visual',
    rootSelector,
    dependentRootSelectors,
    cssPropertyPrefix: `--mobile-hud-${surfaceId.replaceAll('.', '-')}`,
  };
}

function actionSeatDescriptor(
  id: MobileHudSurfaceId,
  rootSelector: string,
  phoneSize = 48,
  tabletSize = 56,
  minimumScale = 1,
): MobileHudSurfaceDescriptor {
  return {
    id,
    class: 'movable',
    coordinateHost: 'body-visual',
    visibleIn: ALL_CONTEXTS,
    validateIn: ALL_CONTEXTS,
    defaultSize: { width: phoneSize, height: phoneSize },
    profileSizes: {
      phone: { width: phoneSize, height: phoneSize },
      tablet: { width: tabletSize, height: tabletSize },
    },
    minimumTargetSize: { width: 48, height: 48 },
    edgeMargin: 4,
    comfortPadding: 2,
    scaleLimits: { min: minimumScale, max: 1.5, step: 0.1 },
    capabilities: ['scale'],
    mirrorPolicy: 'position',
    binding: {
      ...bodyBinding(id, rootSelector),
      editorGeometrySelectors: [],
      editorPseudoGeometry: [{ selector: rootSelector, pseudo: '::before' }],
    },
  };
}

const sharedActionRegistry = buildMobileHudRegistry({
  descriptors: [
    actionSeatDescriptor(
      'action.a1',
      '#mobile-action-ring > .mobile-action-slot[data-mobile-index="0"]',
    ),
    actionSeatDescriptor(
      'action.a2',
      '#mobile-action-ring > .mobile-action-slot[data-mobile-index="1"]',
    ),
    actionSeatDescriptor(
      'action.a3',
      '#mobile-action-ring > .mobile-action-slot[data-mobile-index="2"]',
    ),
    actionSeatDescriptor(
      'action.a4',
      '#mobile-action-ring > .mobile-action-slot[data-mobile-index="3"]',
    ),
    actionSeatDescriptor(
      'action.a5',
      '#mobile-action-ring > .mobile-action-slot[data-mobile-index="4"]',
    ),
    actionSeatDescriptor('action.attack', '#mobile-action-attack'),
    actionSeatDescriptor('action.target', '#mobile-target-cycle'),
    actionSeatDescriptor('action.jump_use', '#mobile-jump', 56, 64, 0.9),
    actionSeatDescriptor('action.page', '#mobile-action-page-toggle'),
    {
      id: 'control.movement',
      class: 'movable',
      coordinateHost: 'body-visual',
      visibleIn: ALL_CONTEXTS,
      validateIn: ALL_CONTEXTS,
      defaultSize: { width: 134, height: 172 },
      minimumTargetSize: { width: 112, height: 112 },
      edgeMargin: 8,
      comfortPadding: 4,
      scaleLimits: { min: 0.9, max: 1.4, step: 0.1 },
      capabilities: ['scale'],
      mirrorPolicy: 'position',
      primaryFootprint: ({ layoutSize }) => ({
        x: 8,
        y: layoutSize.height - 118,
        width: 116,
        height: 116,
      }),
      binding: {
        ...bodyBinding('control.movement', '#mobile-move-zone', ['#mobile-move-joystick']),
        editorVisualSelectors: ['#mobile-move-joystick'],
        preserveRuntimePosition: true,
      },
    },
    {
      id: 'control.view',
      class: 'movable',
      coordinateHost: 'body-visual',
      visibleIn: ALL_CONTEXTS,
      validateIn: ALL_CONTEXTS,
      defaultSize: { width: 220, height: 100 },
      minimumTargetSize: { width: 82, height: 82 },
      edgeMargin: 8,
      comfortPadding: 2,
      scaleLimits: { min: 0.9, max: 1.4, step: 0.1 },
      capabilities: ['scale'],
      mirrorPolicy: 'position',
      primaryFootprint: ({ profileId, layoutSize }) => {
        const size = profileId === 'tablet' ? 96 : 82;
        return {
          x: (layoutSize.width - size) / 2,
          y: (layoutSize.height - size) / 2,
          width: size,
          height: size,
        };
      },
      binding: {
        ...bodyBinding('control.view', '#mobile-controls', ['#mobile-camera-joystick']),
        editorVisualSelectors: ['#mobile-camera-joystick'],
        editorVisibility: 'force-existing-root',
      },
    },
  ],
});

export const MOBILE_HUD_SHARED_ACTION_DESCRIPTORS = sharedActionRegistry.descriptors;

function uiBinding(
  surfaceId: MobileHudSurfaceId,
  rootSelector: string,
  dependentRootSelectors?: readonly string[],
): MobileHudDomBinding {
  return {
    surfaceId,
    coordinateHost: 'ui-author',
    rootSelector,
    dependentRootSelectors,
    cssPropertyPrefix: `--mobile-hud-${surfaceId.replaceAll('.', '-')}`,
  };
}

const sharedCompositeRegistry = buildMobileHudRegistry({
  descriptors: [
    {
      id: 'utility.consumables',
      class: 'movable',
      coordinateHost: 'body-visual',
      visibleIn: ALL_CONTEXTS,
      validateIn: ALL_CONTEXTS,
      defaultSize: { width: 48, height: 48 },
      minimumTargetSize: { width: 48, height: 48 },
      edgeMargin: 4,
      comfortPadding: 2,
      scaleLimits: { min: 1, max: 1.5, step: 0.1 },
      capabilities: ['scale', 'opening-direction'],
      mirrorPolicy: 'position-and-order',
      variants: [
        { id: 'closed', size: { width: 48, height: 48 } },
        { id: 'expanded-left-6', size: { width: 206, height: 100 } },
        { id: 'expanded-right-6', size: { width: 206, height: 100 } },
        { id: 'expanded-up-6', size: { width: 100, height: 206 } },
        { id: 'expanded-down-6', size: { width: 100, height: 206 } },
      ],
      primaryFootprint: ({ placement, layoutSize }) => ({
        x: placement.openingDirection === 'left' ? layoutSize.width - 48 : 0,
        y: placement.openingDirection === 'down' ? 0 : layoutSize.height - 48,
        width: 48,
        height: 48,
      }),
      constrainLayoutToViewport: true,
      binding: {
        ...bodyBinding('utility.consumables', '#mobile-consumables', [
          '#mobile-consumables-toggle',
          '#mobile-consumables-row',
        ]),
        editorVisualSelectors: ['#mobile-consumables-toggle'],
      },
    },
    {
      id: 'pet.commands',
      class: 'movable',
      coordinateHost: 'ui-author',
      visibleIn: ALL_CONTEXTS,
      validateIn: ALL_CONTEXTS,
      defaultSize: { width: 164, height: 40 },
      minimumTargetSize: { width: 40, height: 40 },
      edgeMargin: 4,
      comfortPadding: 2,
      scaleLimits: { min: 1, max: 1.5, step: 0.1 },
      capabilities: ['scale', 'orientation', 'reverse'],
      mirrorPolicy: 'position-and-order',
      editorFallbackFootprint: ({ placement }) =>
        placement.orientation === 'vertical'
          ? { x: 4, y: 4, width: 32, height: 156 }
          : { x: 4, y: 4, width: 156, height: 32 },
      variants: [
        { id: 'current-stance', size: { width: 164, height: 40 } },
        { id: 'all-seven-buttons', size: { width: 284, height: 40 } },
        { id: 'all-seven-buttons-vertical', size: { width: 40, height: 284 } },
      ],
      binding: {
        ...uiBinding('pet.commands', '#petbar'),
        runtimeSizing: 'intrinsic',
        editorVisualSelectors: ['#petbar .pet-btn .icon-label'],
        editorGeometrySelectors: ['#petbar .pet-btn .icon-label'],
      },
    },
    {
      id: 'party',
      class: 'movable',
      coordinateHost: 'ui-author',
      visibleIn: ALL_CONTEXTS,
      validateIn: ALL_CONTEXTS,
      defaultSize: { width: 40, height: 40 },
      minimumTargetSize: { width: 40, height: 40 },
      edgeMargin: 4,
      comfortPadding: 2,
      scaleLimits: { min: 1, max: 1.4, step: 0.1 },
      capabilities: ['scale', 'orientation', 'reverse'],
      mirrorPolicy: 'position-and-order',
      editorFallbackFootprint: () => ({ x: 6, y: 6, width: 28, height: 28 }),
      variants: [
        { id: 'collapsed', size: { width: 40, height: 40 } },
        { id: 'expanded-five-with-leave', size: { width: 444, height: 40 } },
        { id: 'expanded-five-with-leave-vertical', size: { width: 112, height: 253 } },
      ],
      binding: {
        ...uiBinding('party', '#party-frames', ['#party-chip', '.party-rows', '#party-leave']),
        runtimeSizing: 'intrinsic',
        editorVisualSelectors: ['#party-chip', '#party-frames .party-frame', '#party-leave'],
        editorGeometrySelectors: [
          '#party-chip .ui-icon',
          '#party-frames .party-frame',
          '#party-leave .ui-icon',
        ],
      },
    },
    {
      id: 'menu.top',
      class: 'movable',
      coordinateHost: 'body-visual',
      visibleIn: ALL_CONTEXTS,
      validateIn: ALL_CONTEXTS,
      defaultSize: { width: 40, height: 48 },
      minimumTargetSize: { width: 48, height: 48 },
      edgeMargin: 4,
      comfortPadding: 2,
      scaleLimits: { min: 1, max: 1.4, step: 0.1 },
      capabilities: ['scale', 'orientation', 'reverse'],
      mirrorPolicy: 'position-and-order',
      editorFallbackFootprint: () => ({ x: 0, y: 0, width: 40, height: 48 }),
      variants: [
        { id: 'collapsed', size: { width: 40, height: 48 } },
        { id: 'expanded-compact', size: { width: 196, height: 48 } },
        { id: 'expanded-standard', size: { width: 300, height: 48 } },
        { id: 'expanded-vertical', size: { width: 48, height: 300 } },
      ],
      binding: {
        ...bodyBinding('menu.top', '#mobile-combat-controls', [
          '#mobile-menu-collapse-toggle',
          '#mobile-combat-buttons',
        ]),
        runtimeSizing: 'intrinsic',
        editorVisualSelectors: [
          '#mobile-menu-collapse-toggle',
          '#mobile-combat-buttons > .mobile-btn',
        ],
        editorGeometrySelectors: [
          '#mobile-menu-collapse-toggle',
          '#mobile-combat-buttons > .mobile-btn',
        ],
      },
    },
    {
      id: 'minimap.cluster',
      class: 'movable',
      coordinateHost: 'ui-author',
      visibleIn: ALL_CONTEXTS,
      validateIn: ALL_CONTEXTS,
      defaultSize: { width: 98, height: 132 },
      edgeMargin: 4,
      comfortPadding: 2,
      scaleLimits: { min: 0.8, max: 1.4, step: 0.1 },
      capabilities: ['scale'],
      mirrorPolicy: 'position',
      primaryFootprint: () => ({ x: 0, y: 0, width: 98, height: 98 }),
      binding: {
        ...uiBinding('minimap.cluster', '#minimap-wrap', [
          '#zone-label',
          '#minimap-disc',
          '#minimap-clock',
          '#minimap-coords',
          '#compass',
          '#raid-lockout',
          '#mail-indicator',
          '#minimap-zoom',
        ]),
        editorVisualSelectors: ['#minimap-disc'],
      },
    },
    {
      id: 'frame.target',
      class: 'movable',
      coordinateHost: 'ui-author',
      visibleIn: ALL_CONTEXTS,
      validateIn: ALL_CONTEXTS,
      defaultSize: { width: 236, height: 68 },
      edgeMargin: 4,
      comfortPadding: 2,
      scaleLimits: { min: 0.8, max: 1.4, step: 0.1 },
      capabilities: ['scale'],
      mirrorPolicy: 'position',
      primaryFootprint: () => ({ x: 0, y: 0, width: 236, height: 68 }),
      editorFallbackFootprint: () => ({ x: 0, y: 0, width: 239, height: 69 }),
      variants: [
        { id: 'base', size: { width: 236, height: 68 } },
        { id: 'with-target-auras', size: { width: 236, height: 142 } },
      ],
      binding: {
        ...uiBinding('frame.target', '#target-frame', ['#tf-debuffs']),
        runtimeSizing: 'base-footprint',
        editorGeometrySelectors: [
          '#target-frame > .portrait-wrap > .portrait',
          '#target-frame > .portrait-wrap > .level-chip',
          '#target-frame > .portrait-wrap > #tf-elite-tag',
          '#target-frame > .uf-bars',
          '#target-frame > .uf-bars > #tf-castbar',
          '#target-frame > #tf-debuffs > .buff',
        ],
      },
    },
    {
      id: 'frame.player',
      class: 'movable',
      coordinateHost: 'ui-author',
      visibleIn: ALL_CONTEXTS,
      validateIn: ALL_CONTEXTS,
      defaultSize: { width: 300, height: 68 },
      edgeMargin: 4,
      comfortPadding: 2,
      scaleLimits: { min: 0.8, max: 1.4, step: 0.1 },
      capabilities: ['scale'],
      mirrorPolicy: 'position',
      editorFallbackFootprint: () => ({ x: -5, y: -5, width: 285, height: 74 }),
      binding: {
        ...uiBinding('frame.player', '#player-frame', ['#xpbar', '#castbar', '#swingbar']),
        runtimeSizing: 'base-footprint',
        editorVisualSelectors: ['#player-frame', '#castbar', '#swingbar'],
        editorGeometrySelectors: [
          '#player-frame > .portrait-wrap > .portrait',
          '#player-frame > .portrait-wrap > .level-chip',
          '#player-frame > .uf-bars',
          '#player-frame > .uf-bars > #combo-row',
          '#castbar',
          '#swingbar',
        ],
        editorPseudoGeometry: [{ selector: '#player-frame', pseudo: '::before' }],
      },
    },
    ...(['auras.player_buffs', 'auras.player_debuffs'] as const).map(
      (id): MobileHudSurfaceDescriptor => ({
        id,
        class: 'movable',
        coordinateHost: 'ui-author',
        visibleIn: ALL_CONTEXTS,
        validateIn: ALL_CONTEXTS,
        defaultSize: { width: 28, height: 28 },
        minimumTargetSize: { width: 28, height: 28 },
        edgeMargin: 4,
        comfortPadding: 2,
        scaleLimits: { min: 1, max: 1.4, step: 0.1 },
        capabilities: ['scale', 'orientation', 'reverse'],
        mirrorPolicy: 'position-and-order',
        editorFallbackFootprint: () => ({ x: 0, y: 0, width: 28, height: 28 }),
        overlapPolicy: 'informational-overlay',
        variants: [
          { id: 'populated-horizontal-8', size: { width: 252, height: 28 } },
          { id: 'populated-vertical-8', size: { width: 28, height: 252 } },
        ],
        binding: {
          ...uiBinding(id, id === 'auras.player_buffs' ? '#buff-bar' : '#debuff-bar'),
          runtimeSizing: 'intrinsic',
          editorVisualSelectors: [
            id === 'auras.player_buffs' ? '#buff-bar .buff' : '#debuff-bar .buff',
          ],
          editorPlaceholderWhenEmpty: true,
          editorPlaceholderUsesLayoutFootprint: true,
        },
      }),
    ),
  ],
});

export const MOBILE_HUD_SHARED_COMPOSITE_DESCRIPTORS = sharedCompositeRegistry.descriptors;

function contextIds<const T extends readonly (typeof MOBILE_HUD_CONTEXT_IDS)[number][]>(
  ...ids: T
): T {
  return Object.freeze(ids);
}

export const MOBILE_HUD_CONTEXT_ALIASES = Object.freeze({
  FIESTA_ALL: contextIds(
    'arena.fiesta.base',
    'arena.fiesta.pending',
    'arena.fiesta.respawn',
    'arena.fiesta.offer',
    'arena.fiesta.respawn_offer',
  ),
  YUMI_ACTIVE: contextIds('arena.yumi.base', 'arena.yumi.respawn'),
  VALE_MATCH_ALL: contextIds('vale_cup.match', 'vale_cup.match.charge'),
});

function safeViewportRect(geometry: MobileHudViewportGeometry): MobileHudRect {
  return {
    x: geometry.visualOffsetX + geometry.safeAreaInsets.left,
    y: geometry.visualOffsetY + geometry.safeAreaInsets.top,
    width: geometry.width - geometry.safeAreaInsets.left - geometry.safeAreaInsets.right,
    height: geometry.height - geometry.safeAreaInsets.top - geometry.safeAreaInsets.bottom,
  };
}

function centeredProtectedRect(
  geometry: MobileHudViewportGeometry,
  width: number,
  height: number,
  centerYRatio: number,
): MobileHudRect {
  const safe = safeViewportRect(geometry);
  const resolvedWidth = Math.min(width, safe.width);
  const resolvedHeight = Math.min(height, safe.height);
  return {
    x: safe.x + (safe.width - resolvedWidth) / 2,
    y: safe.y + safe.height * centerYRatio - resolvedHeight / 2,
    width: resolvedWidth,
    height: resolvedHeight,
  };
}

function contextStatusDescriptor(
  id: MobileHudSurfaceId,
  contexts: readonly (typeof MOBILE_HUD_CONTEXT_IDS)[number][],
  defaultSize: { width: number; height: number },
  interaction: 'informational' | 'interactive',
  primaryFootprint?: MobileHudSurfaceDescriptor['primaryFootprint'],
): MobileHudSurfaceDescriptor {
  const rootSelector = CONTEXT_STATUS_ROOT_SELECTORS[id];
  if (!rootSelector) throw new Error(`missing mobile HUD context root selector: ${id}`);
  return {
    id,
    class: 'movable',
    coordinateHost: 'ui-author',
    visibleIn: contexts,
    validateIn: contexts,
    defaultSize,
    edgeMargin: 4,
    comfortPadding: 2,
    minimumTargetSize: interaction === 'interactive' ? { width: 40, height: 40 } : undefined,
    scaleLimits: { min: interaction === 'interactive' ? 1 : 0.8, max: 1.4, step: 0.1 },
    capabilities: ['scale'],
    mirrorPolicy: 'position',
    primaryFootprint,
    overlapPolicy: interaction === 'informational' ? 'informational-overlay' : undefined,
    binding: {
      ...uiBinding(id, rootSelector),
      editorPlaceholderWhenEmpty: true,
      editorPlaceholderUsesLayoutFootprint: true,
    },
  };
}

const CONTEXT_STATUS_ROOT_SELECTORS: Partial<Record<MobileHudSurfaceId, string>> = {
  'status.arena.generic': '#arena-status',
  'status.arena.fiesta_score': '#fiesta-score',
  'status.arena.fiesta_pending': '#fiesta-pending',
  'status.arena.yumi': '#yumi-hud',
  'status.vale_cup.indicator': '#vcup-indicator',
  'status.vale_cup.match': '#vcup-match-hud',
  'status.vale_cup.charge': '#vcup-charge',
  'tracker.delve': '#delve-tracker',
};

const CENTER_MESSAGE_OVERLAPS = Object.freeze([
  'protected.arena.fiesta_respawn',
  'protected.arena.fiesta_offer',
  'protected.arena.yumi_respawn',
  'protected.vale_cup.briefing',
  'protected.vale_cup.betting',
] as const);

const contextRegistry = buildMobileHudRegistry({
  descriptors: [
    contextStatusDescriptor(
      'status.arena.generic',
      contextIds(
        'arena.standard',
        ...MOBILE_HUD_CONTEXT_ALIASES.FIESTA_ALL,
        'arena.yumi.returning',
      ),
      { width: 252, height: 62 },
      'informational',
    ),
    contextStatusDescriptor(
      'status.arena.fiesta_score',
      MOBILE_HUD_CONTEXT_ALIASES.FIESTA_ALL,
      {
        width: 390,
        height: 58,
      },
      'informational',
    ),
    contextStatusDescriptor(
      'status.arena.fiesta_pending',
      contextIds('arena.fiesta.pending'),
      {
        width: 240,
        height: 30,
      },
      'informational',
    ),
    {
      id: 'protected.arena.fiesta_respawn',
      class: 'protected',
      coordinateHost: 'ui-author',
      visibleIn: contextIds('arena.fiesta.respawn', 'arena.fiesta.respawn_offer'),
      validateIn: contextIds('arena.fiesta.respawn', 'arena.fiesta.respawn_offer'),
      defaultSize: { width: 180, height: 112 },
      edgeMargin: 0,
      comfortPadding: 0,
      capabilities: [],
      mirrorPolicy: 'none',
      overlapPolicy: 'foreground-overlay',
      allowProtectedOverlapWith: [
        'protected.arena.fiesta_offer',
        'protected.system.center_message',
      ],
      protectedFootprint: (geometry) => centeredProtectedRect(geometry, 180, 112, 0.44),
    },
    {
      id: 'protected.arena.fiesta_offer',
      class: 'protected',
      coordinateHost: 'ui-author',
      visibleIn: contextIds('arena.fiesta.offer', 'arena.fiesta.respawn_offer'),
      validateIn: contextIds('arena.fiesta.offer', 'arena.fiesta.respawn_offer'),
      defaultSize: { width: 474, height: 150 },
      edgeMargin: 0,
      comfortPadding: 0,
      capabilities: [],
      mirrorPolicy: 'none',
      overlapPolicy: 'foreground-overlay',
      allowProtectedOverlapWith: [
        'protected.arena.fiesta_respawn',
        'protected.system.center_message',
      ],
      protectedFootprint: (geometry) => {
        const safe = safeViewportRect(geometry);
        const width = Math.min(474, Math.max(1, safe.width - 24));
        const height = Math.min(150, safe.height);
        return {
          x: safe.x + (safe.width - width) / 2,
          y: Math.max(safe.y, safe.y + safe.height - 200 - height),
          width,
          height,
        };
      },
    },
    contextStatusDescriptor(
      'status.arena.yumi',
      MOBILE_HUD_CONTEXT_ALIASES.YUMI_ACTIVE,
      {
        width: 520,
        height: 54,
      },
      'interactive',
      ({ layoutSize }) => ({
        x: Math.max(0, layoutSize.width - 40),
        y: Math.max(0, (layoutSize.height - 40) / 2),
        width: Math.min(40, layoutSize.width),
        height: Math.min(40, layoutSize.height),
      }),
    ),
    {
      id: 'protected.arena.yumi_respawn',
      class: 'protected',
      coordinateHost: 'ui-author',
      visibleIn: contextIds('arena.yumi.respawn'),
      validateIn: contextIds('arena.yumi.respawn'),
      defaultSize: { width: 176, height: 94 },
      edgeMargin: 0,
      comfortPadding: 0,
      capabilities: [],
      mirrorPolicy: 'none',
      overlapPolicy: 'foreground-overlay',
      allowProtectedOverlapWith: ['protected.system.center_message'],
      protectedFootprint: (geometry) => centeredProtectedRect(geometry, 176, 94, 0.38),
    },
    contextStatusDescriptor(
      'status.vale_cup.indicator',
      contextIds('world.vale_cup_indicator'),
      {
        width: 220,
        height: 40,
      },
      'interactive',
    ),
    {
      id: 'protected.vale_cup.briefing',
      class: 'protected',
      coordinateHost: 'ui-author',
      visibleIn: contextIds('vale_cup.briefing'),
      validateIn: contextIds('vale_cup.briefing'),
      defaultSize: { width: 740, height: 360 },
      edgeMargin: 0,
      comfortPadding: 0,
      capabilities: [],
      mirrorPolicy: 'none',
      overlapPolicy: 'foreground-overlay',
      allowProtectedOverlapWith: ['protected.system.center_message'],
      protectedFootprint: safeViewportRect,
    },
    contextStatusDescriptor(
      'status.vale_cup.match',
      MOBILE_HUD_CONTEXT_ALIASES.VALE_MATCH_ALL,
      {
        width: 292,
        height: 64,
      },
      'informational',
    ),
    contextStatusDescriptor(
      'status.vale_cup.charge',
      contextIds('vale_cup.match.charge'),
      {
        width: 280,
        height: 18,
      },
      'informational',
    ),
    {
      id: 'protected.vale_cup.betting',
      class: 'protected',
      coordinateHost: 'ui-author',
      visibleIn: contextIds('vale_cup.spectator.betting'),
      validateIn: contextIds('vale_cup.spectator.betting'),
      defaultSize: { width: 420, height: 320 },
      edgeMargin: 0,
      comfortPadding: 0,
      capabilities: [],
      mirrorPolicy: 'none',
      overlapPolicy: 'foreground-overlay',
      allowProtectedOverlapWith: ['protected.system.center_message'],
      protectedFootprint: (geometry) => {
        const safe = safeViewportRect(geometry);
        const width = Math.min(420, Math.max(1, safe.width - 24));
        const y = safe.y + Math.min(64, Math.max(0, safe.height - 1));
        return {
          x: safe.x + (safe.width - width) / 2,
          y,
          width,
          height: Math.max(1, Math.min(320, safe.y + safe.height - y - 12)),
        };
      },
    },
    {
      ...contextStatusDescriptor(
        'tracker.delve',
        contextIds('instance.delve'),
        {
          width: 280,
          height: 180,
        },
        'informational',
      ),
    },
    {
      id: 'protected.system.center_message',
      class: 'protected',
      coordinateHost: 'ui-author',
      visibleIn: ALL_CONTEXTS,
      validateIn: ALL_CONTEXTS,
      defaultSize: { width: 520, height: 88 },
      edgeMargin: 0,
      comfortPadding: 0,
      capabilities: [],
      mirrorPolicy: 'none',
      overlapPolicy: 'foreground-overlay',
      allowProtectedOverlapWith: CENTER_MESSAGE_OVERLAPS,
      protectedFootprint: (geometry) => centeredProtectedRect(geometry, 520, 88, 0.25),
    },
  ],
});

export const MOBILE_HUD_CONTEXT_DESCRIPTORS = contextRegistry.descriptors;

const defaultPlacements = createMobileHudDefaultPlacements();

export const MOBILE_HUD_REGISTRY = buildMobileHudRegistry({
  descriptors: [
    ...MOBILE_HUD_SHARED_ACTION_DESCRIPTORS,
    ...MOBILE_HUD_SHARED_COMPOSITE_DESCRIPTORS,
    ...MOBILE_HUD_CONTEXT_DESCRIPTORS,
  ],
  defaults: defaultPlacements,
});

export const defaultMobileHudPlacements = MOBILE_HUD_REGISTRY.defaults;
