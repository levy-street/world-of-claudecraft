export const MOBILE_HUD_LAYOUT_SCHEMA_VERSION = 1 as const;
export const MOBILE_HUD_LAYOUT_STORAGE_KEY = 'woc_mobile_hud_layout_v1' as const;
export const COLLISION_EPSILON_CSS_PX = 0.5 as const;

export const MOBILE_HUD_PROFILE_IDS = ['phone', 'tablet'] as const;
export type MobileHudProfileId = (typeof MOBILE_HUD_PROFILE_IDS)[number];

export const MOBILE_HUD_COORDINATE_HOSTS = ['body-visual', 'ui-author'] as const;
export type MobileHudCoordinateHost = (typeof MOBILE_HUD_COORDINATE_HOSTS)[number];

export const MOBILE_HUD_ANCHORS = [
  'top-left',
  'top-center',
  'top-right',
  'center-left',
  'center',
  'center-right',
  'bottom-left',
  'bottom-center',
  'bottom-right',
] as const;
export type MobileHudAnchor = (typeof MOBILE_HUD_ANCHORS)[number];

export const MOBILE_HUD_SCENE_IDS = [
  'world',
  'arena.standard',
  'arena.fiesta',
  'arena.yumi',
  'vale_cup.briefing',
  'vale_cup.match',
  'vale_cup.spectator',
  'instance.delve',
] as const;
export type MobileHudSceneId = (typeof MOBILE_HUD_SCENE_IDS)[number];

export const MOBILE_HUD_CONTEXT_IDS = [
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
] as const;
export type MobileHudContextId = (typeof MOBILE_HUD_CONTEXT_IDS)[number];

export const MOBILE_HUD_SURFACE_IDS = [
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
] as const;
export type MobileHudSurfaceId = (typeof MOBILE_HUD_SURFACE_IDS)[number];

export type MobileHudOrientation = 'horizontal' | 'vertical';
export type MobileHudOpeningDirection = 'left' | 'right' | 'up' | 'down';
export type MobileHudHandedness = 'left' | 'right';

export interface MobileHudPlacement {
  anchor: MobileHudAnchor;
  offsetX: number;
  offsetY: number;
  scale: number;
  orientation?: MobileHudOrientation;
  reverse?: boolean;
  openingDirection?: MobileHudOpeningDirection;
}

export interface MobileHudLayoutDocumentV1 {
  schemaVersion: 1;
  enabled: boolean;
  profiles: Partial<
    Record<MobileHudProfileId, Partial<Record<MobileHudSurfaceId, MobileHudPlacement>>>
  >;
}

export interface MobileHudLayoutStorage {
  load(): Promise<string | null>;
  save(serialized: string): Promise<void>;
}

export interface MobileHudPoint {
  x: number;
  y: number;
}

export interface MobileHudSize {
  width: number;
  height: number;
}

export interface MobileHudRect extends MobileHudPoint, MobileHudSize {}

export interface MobileHudSafeAreaInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface MobileHudViewportGeometry extends MobileHudSize {
  id: string;
  visualOffsetX: number;
  visualOffsetY: number;
  safeAreaInsets: MobileHudSafeAreaInsets;
}

export type MobileHudSurfaceClass = 'movable' | 'protected';
export type MobileHudOverlapPolicy = 'informational-overlay' | 'foreground-overlay';
export type MobileHudEditCapability = 'scale' | 'orientation' | 'reverse' | 'opening-direction';
export type MobileHudMirrorPolicy = 'position' | 'position-and-order' | 'none';

export interface MobileHudScaleLimits {
  min: number;
  max: number;
  step: number;
}

export interface MobileHudFootprintVariant {
  id: string;
  size: MobileHudSize;
  contexts?: readonly MobileHudContextId[];
}

export interface MobileHudPrimaryFootprintInput {
  profileId: MobileHudProfileId;
  placement: MobileHudPlacement;
  contextId: MobileHudContextId;
  layoutSize: MobileHudSize;
}

export interface MobileHudSurfaceDescriptor {
  id: MobileHudSurfaceId;
  class: MobileHudSurfaceClass;
  coordinateHost: MobileHudCoordinateHost;
  visibleIn: readonly MobileHudContextId[];
  validateIn: readonly MobileHudContextId[];
  defaultSize: MobileHudSize;
  profileSizes?: Partial<Record<MobileHudProfileId, MobileHudSize>>;
  minimumTargetSize?: MobileHudSize;
  edgeMargin: number;
  comfortPadding: number;
  scaleLimits?: MobileHudScaleLimits;
  capabilities: readonly MobileHudEditCapability[];
  mirrorPolicy: MobileHudMirrorPolicy;
  variants?: readonly MobileHudFootprintVariant[];
  primaryFootprint?(input: MobileHudPrimaryFootprintInput): MobileHudRect;
  editorFallbackFootprint?(input: MobileHudPrimaryFootprintInput): MobileHudRect;
  constrainLayoutToViewport?: boolean;
  overlapPolicy?: MobileHudOverlapPolicy;
  allowOverlapWith?: readonly MobileHudSurfaceId[];
  allowProtectedOverlapWith?: readonly MobileHudSurfaceId[];
  protectedFootprint?(geometry: MobileHudViewportGeometry): MobileHudRect;
  binding?: MobileHudDomBinding;
}

export interface MobileHudDomBinding {
  surfaceId: MobileHudSurfaceId;
  coordinateHost: MobileHudCoordinateHost;
  rootSelector: string;
  dependentRootSelectors?: readonly string[];
  editorVisualSelectors?: readonly string[];
  editorGeometrySelectors?: readonly string[];
  editorPseudoGeometry?: readonly MobileHudPseudoGeometryBinding[];
  runtimeSizing?: 'validation-footprint' | 'base-footprint' | 'intrinsic';
  editorPlaceholderWhenEmpty?: boolean;
  editorPlaceholderUsesLayoutFootprint?: boolean;
  editorVisibility?: 'live-if-visible' | 'force-existing-root' | 'ghost-only';
  cssPropertyPrefix: string;
  preserveRuntimePosition?: boolean;
}

export interface MobileHudPseudoGeometryBinding {
  selector: string;
  pseudo: '::before' | '::after';
}

export type MobileHudValidationReason =
  | 'invalid-placement'
  | 'unsupported-capability'
  | 'scale-out-of-range'
  | 'target-too-small'
  | 'out-of-bounds'
  | 'overlap'
  | 'view-intrusion'
  | 'protected-overlap';

export interface MobileHudValidationFailure {
  reason: MobileHudValidationReason;
  profileId: MobileHudProfileId;
  contextId: MobileHudContextId;
  surfaceIds: readonly MobileHudSurfaceId[];
  handedness?: MobileHudHandedness;
  viewportId?: string;
  safeAreaFixtureId?: string;
  activeVariantIds?: readonly string[];
}

export interface MobileHudDraft {
  document: MobileHudLayoutDocumentV1;
  entryDocument: MobileHudLayoutDocumentV1;
  activeProfileId: MobileHudProfileId;
  sceneId: MobileHudSceneId;
  contextId: MobileHudContextId;
  selectedSurfaceId: MobileHudSurfaceId | null;
  locked: boolean;
  failures: readonly MobileHudValidationFailure[];
  activeFailureIndex: number | null;
}

const ORIENTATIONS: readonly MobileHudOrientation[] = ['horizontal', 'vertical'];
const OPENING_DIRECTIONS: readonly MobileHudOpeningDirection[] = ['left', 'right', 'up', 'down'];

export function isMobileHudPlacement(value: unknown): value is MobileHudPlacement {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const placement = value as Record<string, unknown>;
  if (!MOBILE_HUD_ANCHORS.includes(placement.anchor as MobileHudAnchor)) return false;
  if (typeof placement.offsetX !== 'number' || !Number.isFinite(placement.offsetX)) return false;
  if (typeof placement.offsetY !== 'number' || !Number.isFinite(placement.offsetY)) return false;
  if (
    typeof placement.scale !== 'number' ||
    !Number.isFinite(placement.scale) ||
    placement.scale <= 0
  )
    return false;
  if (
    placement.orientation !== undefined &&
    !ORIENTATIONS.includes(placement.orientation as MobileHudOrientation)
  )
    return false;
  if (placement.reverse !== undefined && typeof placement.reverse !== 'boolean') return false;
  if (
    placement.openingDirection !== undefined &&
    !OPENING_DIRECTIONS.includes(placement.openingDirection as MobileHudOpeningDirection)
  )
    return false;
  return true;
}
