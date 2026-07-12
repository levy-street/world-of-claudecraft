import type {
  MobileHudContextId,
  MobileHudProfileId,
  MobileHudSceneId,
  MobileHudSurfaceId,
  MobileHudViewportGeometry,
} from './mobile_hud_editor_types';

const PET_CAPABLE_CLASSES = new Set(['hunter', 'warlock']);

export function isMobileHudSurfaceAvailable(
  surfaceId: MobileHudSurfaceId,
  playerClass: string,
): boolean {
  return surfaceId !== 'pet.commands' || PET_CAPABLE_CLASSES.has(playerClass);
}

export interface MobileHudSceneFixture {
  id: MobileHudSceneId;
  contextIds: readonly MobileHudContextId[];
}

export interface MobileHudContextFixture {
  id: MobileHudContextId;
  sceneId: MobileHudSceneId;
}

export interface MobileHudViewportFixture {
  id: string;
  profileId: MobileHudProfileId;
  width: number;
  height: number;
}

export interface MobileHudSideInsetFixture {
  id: string;
  left: number;
  right: number;
}

export interface MobileHudBottomInsetFixture {
  id: string;
  bottom: number;
}

export interface MobileHudGeometryMatrixFixture {
  id: string;
  profileId: MobileHudProfileId;
  viewport: MobileHudViewportFixture;
  sideInset: MobileHudSideInsetFixture;
  bottomInset: MobileHudBottomInsetFixture;
  context: MobileHudContextFixture;
  geometry: MobileHudViewportGeometry;
}

export interface MobileHudRuntimeSnapshot {
  valeCupPlayerState: 'none' | 'briefing' | 'match';
  valeCupShootCharging: boolean;
  arenaMode: 'none' | 'standard' | 'fiesta' | 'yumi';
  arenaPlayerDown: boolean;
  arenaFiestaOfferVisible: boolean;
  arenaFiestaPending: boolean;
  arenaYumiReturning: boolean;
  valeCupSpectatorBetting: boolean;
  delveActive: boolean;
  valeCupIndicatorVisible: boolean;
}

export type MobileHudContextDiagnostic = 'vale-cup-player-state-with-arena';

export interface MobileHudContextResolverOptions {
  development?: boolean;
  onDiagnostic?(diagnostic: MobileHudContextDiagnostic): void;
}

function contextIds<const T extends readonly MobileHudContextId[]>(...ids: T): T {
  return Object.freeze(ids);
}

export const MOBILE_HUD_SCENES: readonly MobileHudSceneFixture[] = Object.freeze([
  Object.freeze({
    id: 'world',
    contextIds: contextIds('world.base', 'world.vale_cup_indicator'),
  }),
  Object.freeze({ id: 'arena.standard', contextIds: contextIds('arena.standard') }),
  Object.freeze({
    id: 'arena.fiesta',
    contextIds: contextIds(
      'arena.fiesta.base',
      'arena.fiesta.pending',
      'arena.fiesta.respawn',
      'arena.fiesta.offer',
      'arena.fiesta.respawn_offer',
    ),
  }),
  Object.freeze({
    id: 'arena.yumi',
    contextIds: contextIds('arena.yumi.base', 'arena.yumi.respawn', 'arena.yumi.returning'),
  }),
  Object.freeze({ id: 'vale_cup.briefing', contextIds: contextIds('vale_cup.briefing') }),
  Object.freeze({
    id: 'vale_cup.match',
    contextIds: contextIds('vale_cup.match', 'vale_cup.match.charge'),
  }),
  Object.freeze({
    id: 'vale_cup.spectator',
    contextIds: contextIds('vale_cup.spectator.betting'),
  }),
  Object.freeze({ id: 'instance.delve', contextIds: contextIds('instance.delve') }),
]);

export const MOBILE_HUD_CONTEXTS: readonly MobileHudContextFixture[] = Object.freeze([
  Object.freeze({ id: 'world.base', sceneId: 'world' }),
  Object.freeze({ id: 'world.vale_cup_indicator', sceneId: 'world' }),
  Object.freeze({ id: 'arena.standard', sceneId: 'arena.standard' }),
  Object.freeze({ id: 'arena.fiesta.base', sceneId: 'arena.fiesta' }),
  Object.freeze({ id: 'arena.fiesta.pending', sceneId: 'arena.fiesta' }),
  Object.freeze({ id: 'arena.fiesta.respawn', sceneId: 'arena.fiesta' }),
  Object.freeze({ id: 'arena.fiesta.offer', sceneId: 'arena.fiesta' }),
  Object.freeze({ id: 'arena.fiesta.respawn_offer', sceneId: 'arena.fiesta' }),
  Object.freeze({ id: 'arena.yumi.base', sceneId: 'arena.yumi' }),
  Object.freeze({ id: 'arena.yumi.respawn', sceneId: 'arena.yumi' }),
  Object.freeze({ id: 'arena.yumi.returning', sceneId: 'arena.yumi' }),
  Object.freeze({ id: 'vale_cup.briefing', sceneId: 'vale_cup.briefing' }),
  Object.freeze({ id: 'vale_cup.match', sceneId: 'vale_cup.match' }),
  Object.freeze({ id: 'vale_cup.match.charge', sceneId: 'vale_cup.match' }),
  Object.freeze({ id: 'vale_cup.spectator.betting', sceneId: 'vale_cup.spectator' }),
  Object.freeze({ id: 'instance.delve', sceneId: 'instance.delve' }),
]);

const MOBILE_HUD_EDITOR_CONTEXT_ALIASES: Readonly<Record<MobileHudContextId, MobileHudContextId>> =
  Object.freeze({
    'world.base': 'world.base',
    'world.vale_cup_indicator': 'world.vale_cup_indicator',
    'arena.standard': 'arena.standard',
    'arena.fiesta.base': 'arena.fiesta.base',
    'arena.fiesta.pending': 'arena.fiesta.pending',
    'arena.fiesta.respawn': 'arena.fiesta.base',
    'arena.fiesta.offer': 'arena.fiesta.base',
    'arena.fiesta.respawn_offer': 'arena.fiesta.base',
    'arena.yumi.base': 'arena.yumi.base',
    'arena.yumi.respawn': 'arena.yumi.base',
    'arena.yumi.returning': 'arena.standard',
    'vale_cup.briefing': 'world.base',
    'vale_cup.match': 'vale_cup.match',
    'vale_cup.match.charge': 'vale_cup.match.charge',
    'vale_cup.spectator.betting': 'world.base',
    'instance.delve': 'instance.delve',
  });

export const MOBILE_HUD_EDITOR_CONTEXTS: readonly MobileHudContextFixture[] = Object.freeze(
  MOBILE_HUD_CONTEXTS.filter(
    (context) => MOBILE_HUD_EDITOR_CONTEXT_ALIASES[context.id] === context.id,
  ),
);

export function resolveMobileHudEditorContext(contextId: MobileHudContextId): MobileHudContextId {
  return MOBILE_HUD_EDITOR_CONTEXT_ALIASES[contextId];
}

export const MOBILE_HUD_VIEWPORTS: readonly MobileHudViewportFixture[] = Object.freeze([
  Object.freeze({ id: 'phone-740x360', profileId: 'phone', width: 740, height: 360 }),
  Object.freeze({ id: 'phone-844x390', profileId: 'phone', width: 844, height: 390 }),
  Object.freeze({ id: 'phone-915x412', profileId: 'phone', width: 915, height: 412 }),
  Object.freeze({ id: 'phone-932x430', profileId: 'phone', width: 932, height: 430 }),
  Object.freeze({ id: 'phone-1280x720', profileId: 'phone', width: 1280, height: 720 }),
  Object.freeze({ id: 'tablet-1024x768', profileId: 'tablet', width: 1024, height: 768 }),
]);

export const MOBILE_HUD_SIDE_INSET_FIXTURES: readonly MobileHudSideInsetFixture[] = Object.freeze([
  Object.freeze({ id: 'side-none', left: 0, right: 0 }),
  Object.freeze({ id: 'side-left-50', left: 50, right: 0 }),
  Object.freeze({ id: 'side-right-50', left: 0, right: 50 }),
  Object.freeze({ id: 'side-bilateral-50', left: 50, right: 50 }),
]);

export const MOBILE_HUD_BOTTOM_INSET_FIXTURES: readonly MobileHudBottomInsetFixture[] =
  Object.freeze([
    Object.freeze({ id: 'bottom-0', bottom: 0 }),
    Object.freeze({ id: 'bottom-24', bottom: 24 }),
  ]);

function buildGeometryMatrix(): readonly MobileHudGeometryMatrixFixture[] {
  const matrix: MobileHudGeometryMatrixFixture[] = [];
  for (const viewport of MOBILE_HUD_VIEWPORTS) {
    for (const sideInset of MOBILE_HUD_SIDE_INSET_FIXTURES) {
      for (const bottomInset of MOBILE_HUD_BOTTOM_INSET_FIXTURES) {
        const geometryId = `${viewport.id}/${sideInset.id}/${bottomInset.id}`;
        const geometry: MobileHudViewportGeometry = Object.freeze({
          id: geometryId,
          width: viewport.width,
          height: viewport.height,
          visualOffsetX: 0,
          visualOffsetY: 0,
          safeAreaInsets: Object.freeze({
            top: 0,
            right: sideInset.right,
            bottom: bottomInset.bottom,
            left: sideInset.left,
          }),
        });
        for (const context of MOBILE_HUD_CONTEXTS) {
          matrix.push(
            Object.freeze({
              id: `${geometryId}/${context.id}`,
              profileId: viewport.profileId,
              viewport,
              sideInset,
              bottomInset,
              context,
              geometry,
            }),
          );
        }
      }
    }
  }
  return Object.freeze(matrix);
}

export const MOBILE_HUD_GEOMETRY_MATRIX = buildGeometryMatrix();

export function resolveMobileHudContext(
  snapshot: MobileHudRuntimeSnapshot,
  options: MobileHudContextResolverOptions = {},
): MobileHudContextId {
  if (snapshot.valeCupPlayerState !== 'none') {
    if (snapshot.arenaMode !== 'none' && options.development) {
      options.onDiagnostic?.('vale-cup-player-state-with-arena');
    }
    if (snapshot.valeCupPlayerState === 'briefing') return 'vale_cup.briefing';
    if (snapshot.valeCupShootCharging) return 'vale_cup.match.charge';
    return 'vale_cup.match';
  }

  if (snapshot.arenaMode === 'standard') return 'arena.standard';
  if (snapshot.arenaMode === 'fiesta') {
    if (snapshot.arenaPlayerDown && snapshot.arenaFiestaOfferVisible) {
      return 'arena.fiesta.respawn_offer';
    }
    if (snapshot.arenaFiestaOfferVisible) return 'arena.fiesta.offer';
    if (snapshot.arenaPlayerDown) return 'arena.fiesta.respawn';
    if (snapshot.arenaFiestaPending) return 'arena.fiesta.pending';
    return 'arena.fiesta.base';
  }
  if (snapshot.arenaMode === 'yumi') {
    if (snapshot.arenaYumiReturning) return 'arena.yumi.returning';
    if (snapshot.arenaPlayerDown) return 'arena.yumi.respawn';
    return 'arena.yumi.base';
  }

  if (snapshot.valeCupSpectatorBetting) return 'vale_cup.spectator.betting';
  if (snapshot.delveActive) return 'instance.delve';
  if (snapshot.valeCupIndicatorVisible) return 'world.vale_cup_indicator';
  return 'world.base';
}
