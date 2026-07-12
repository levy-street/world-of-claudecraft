import {
  MOBILE_HUD_CONTEXTS,
  MOBILE_HUD_GEOMETRY_MATRIX,
  type MobileHudGeometryMatrixFixture,
} from './mobile_hud_context';
import {
  COLLISION_EPSILON_CSS_PX,
  isMobileHudPlacement,
  MOBILE_HUD_ANCHORS,
  type MobileHudAnchor,
  type MobileHudContextId,
  type MobileHudDraft,
  type MobileHudMirrorPolicy,
  type MobileHudOpeningDirection,
  type MobileHudPlacement,
  type MobileHudPoint,
  type MobileHudProfileId,
  type MobileHudRect,
  type MobileHudSize,
  type MobileHudSurfaceDescriptor,
  type MobileHudSurfaceId,
  type MobileHudValidationFailure,
  type MobileHudViewportGeometry,
} from './mobile_hud_editor_types';
import type { MobileHudRegistry } from './mobile_hud_registry';

export { COLLISION_EPSILON_CSS_PX };

export interface MobileHudAnchoredOffset {
  anchor: MobileHudAnchor;
  offsetX: number;
  offsetY: number;
}

function anchorFactors(anchor: MobileHudAnchor): readonly [number, number] {
  switch (anchor) {
    case 'top-left':
      return [0, 0];
    case 'top-center':
      return [0.5, 0];
    case 'top-right':
      return [1, 0];
    case 'center-left':
      return [0, 0.5];
    case 'center':
      return [0.5, 0.5];
    case 'center-right':
      return [1, 0.5];
    case 'bottom-left':
      return [0, 1];
    case 'bottom-center':
      return [0.5, 1];
    case 'bottom-right':
      return [1, 1];
  }
}

function anchorTopLeft(
  anchor: MobileHudAnchor,
  size: MobileHudSize,
  geometry: MobileHudViewportGeometry,
): MobileHudPoint {
  const [xFactor, yFactor] = anchorFactors(anchor);
  const safeX = geometry.visualOffsetX + geometry.safeAreaInsets.left;
  const safeY = geometry.visualOffsetY + geometry.safeAreaInsets.top;
  const safeWidth = geometry.width - geometry.safeAreaInsets.left - geometry.safeAreaInsets.right;
  const safeHeight = geometry.height - geometry.safeAreaInsets.top - geometry.safeAreaInsets.bottom;
  return {
    x: safeX + (safeWidth - size.width) * xFactor,
    y: safeY + (safeHeight - size.height) * yFactor,
  };
}

export function resolveMobileHudAnchorTopLeft(
  anchor: MobileHudAnchor,
  offsetX: number,
  offsetY: number,
  size: MobileHudSize,
  geometry: MobileHudViewportGeometry,
): MobileHudPoint {
  const origin = anchorTopLeft(anchor, size, geometry);
  return { x: origin.x + offsetX, y: origin.y + offsetY };
}

export function invertMobileHudAnchorTopLeft(
  topLeft: MobileHudPoint,
  size: MobileHudSize,
  geometry: MobileHudViewportGeometry,
): MobileHudAnchoredOffset {
  let nearest: MobileHudAnchoredOffset | undefined;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const anchor of MOBILE_HUD_ANCHORS) {
    const origin = anchorTopLeft(anchor, size, geometry);
    const offsetX = topLeft.x - origin.x;
    const offsetY = topLeft.y - origin.y;
    const distance = offsetX * offsetX + offsetY * offsetY;
    if (distance < nearestDistance) {
      nearest = { anchor, offsetX, offsetY };
      nearestDistance = distance;
    }
  }
  if (!nearest) throw new Error('mobile HUD anchor inventory is empty');
  return nearest;
}

const MIRRORED_ANCHORS: Readonly<Record<MobileHudAnchor, MobileHudAnchor>> = {
  'top-left': 'top-right',
  'top-center': 'top-center',
  'top-right': 'top-left',
  'center-left': 'center-right',
  center: 'center',
  'center-right': 'center-left',
  'bottom-left': 'bottom-right',
  'bottom-center': 'bottom-center',
  'bottom-right': 'bottom-left',
};

function mirrorOpeningDirection(direction: MobileHudOpeningDirection): MobileHudOpeningDirection {
  if (direction === 'left') return 'right';
  if (direction === 'right') return 'left';
  return direction;
}

export function mirrorMobileHudPlacement(
  placement: MobileHudPlacement,
  mirrorPolicy: MobileHudMirrorPolicy,
): MobileHudPlacement {
  const mirrored = { ...placement };
  if (mirrorPolicy === 'none') return mirrored;
  mirrored.anchor = MIRRORED_ANCHORS[placement.anchor];
  mirrored.offsetX = -placement.offsetX;
  if (placement.openingDirection !== undefined) {
    mirrored.openingDirection = mirrorOpeningDirection(placement.openingDirection);
  }
  if (
    mirrorPolicy === 'position-and-order' &&
    placement.orientation !== 'vertical' &&
    placement.reverse !== undefined
  ) {
    mirrored.reverse = !placement.reverse;
  }
  return mirrored;
}

export interface MobileHudResolvedSurfaceGeometry {
  unscaledSize: MobileHudSize;
  scaledSize: MobileHudSize;
  canonicalRect: MobileHudRect;
  interactiveRect: MobileHudRect;
  editorFallbackRect: MobileHudRect;
  collisionRect: MobileHudRect;
  boundsRect: MobileHudRect;
  previewRect: MobileHudRect;
  scaleValid: boolean;
  targetSizeValid: boolean;
  activeVariantIds: readonly string[];
}

interface MobileHudResolvedFootprint {
  size: MobileHudSize;
  activeVariantIds: readonly string[];
}

function resolveUnscaledFootprint(
  descriptor: MobileHudSurfaceDescriptor,
  profileId: MobileHudProfileId,
  placement: MobileHudPlacement,
  contextId: MobileHudContextId,
): MobileHudResolvedFootprint {
  const profileSize = descriptor.profileSizes?.[profileId] ?? descriptor.defaultSize;
  const orientation = placement.orientation ?? 'horizontal';
  let width =
    descriptor.capabilities.includes('orientation') && orientation === 'vertical'
      ? profileSize.height
      : profileSize.width;
  let height =
    descriptor.capabilities.includes('orientation') && orientation === 'vertical'
      ? profileSize.width
      : profileSize.height;
  const activeVariantIds: string[] = [];
  const openingDirection = placement.openingDirection ?? 'right';
  for (const variant of descriptor.variants ?? []) {
    if (variant.contexts && !variant.contexts.includes(contextId)) continue;
    if (descriptor.capabilities.includes('opening-direction')) {
      if (variant.id !== 'closed' && !variant.id.includes(`-${openingDirection}-`)) continue;
    }
    if (descriptor.capabilities.includes('orientation')) {
      const verticalVariant = variant.id.includes('vertical');
      if ((orientation === 'vertical') !== verticalVariant) continue;
    }
    activeVariantIds.push(variant.id);
    width = Math.max(width, variant.size.width);
    height = Math.max(height, variant.size.height);
  }
  return { size: { width, height }, activeVariantIds: Object.freeze(activeVariantIds) };
}

function validScale(descriptor: MobileHudSurfaceDescriptor, scale: number): boolean {
  const limits = descriptor.scaleLimits;
  if (!limits) return scale === 1;
  const epsilon = 1e-9;
  if (scale < limits.min - epsilon || scale > limits.max + epsilon) return false;
  const steps = (scale - limits.min) / limits.step;
  return Math.abs(steps - Math.round(steps)) <= epsilon;
}

function clampRectToSafeViewport(
  rect: MobileHudRect,
  geometry: MobileHudViewportGeometry,
  edgeMargin: number,
): MobileHudRect {
  const minimumX = geometry.visualOffsetX + geometry.safeAreaInsets.left + edgeMargin;
  const minimumY = geometry.visualOffsetY + geometry.safeAreaInsets.top + edgeMargin;
  const maximumX = Math.max(
    minimumX,
    geometry.visualOffsetX +
      geometry.width -
      geometry.safeAreaInsets.right -
      edgeMargin -
      rect.width,
  );
  const maximumY = Math.max(
    minimumY,
    geometry.visualOffsetY +
      geometry.height -
      geometry.safeAreaInsets.bottom -
      edgeMargin -
      rect.height,
  );
  return {
    x: Math.min(maximumX, Math.max(minimumX, rect.x)),
    y: Math.min(maximumY, Math.max(minimumY, rect.y)),
    width: rect.width,
    height: rect.height,
  };
}

export function resolveMobileHudSurfaceGeometry(
  descriptor: MobileHudSurfaceDescriptor,
  profileId: MobileHudProfileId,
  placement: MobileHudPlacement,
  geometry: MobileHudViewportGeometry,
  contextId: MobileHudContextId,
): MobileHudResolvedSurfaceGeometry {
  const footprint = resolveUnscaledFootprint(descriptor, profileId, placement, contextId);
  const unscaledSize = footprint.size;
  const scaledSize = {
    width: unscaledSize.width * placement.scale,
    height: unscaledSize.height * placement.scale,
  };
  const topLeft = resolveMobileHudAnchorTopLeft(
    placement.anchor,
    placement.offsetX,
    placement.offsetY,
    scaledSize,
    geometry,
  );
  const canonicalRect = { ...topLeft, ...scaledSize };
  const footprintInput = {
    profileId,
    placement,
    contextId,
    layoutSize: unscaledSize,
  };
  const primaryFootprint = descriptor.primaryFootprint?.(footprintInput) ?? {
    x: 0,
    y: 0,
    ...unscaledSize,
  };
  const editorFallbackFootprint =
    descriptor.editorFallbackFootprint?.(footprintInput) ?? primaryFootprint;
  const interactiveRect = {
    x: canonicalRect.x + primaryFootprint.x * placement.scale,
    y: canonicalRect.y + primaryFootprint.y * placement.scale,
    width: primaryFootprint.width * placement.scale,
    height: primaryFootprint.height * placement.scale,
  };
  const editorFallbackRect = {
    x: canonicalRect.x + editorFallbackFootprint.x * placement.scale,
    y: canonicalRect.y + editorFallbackFootprint.y * placement.scale,
    width: editorFallbackFootprint.width * placement.scale,
    height: editorFallbackFootprint.height * placement.scale,
  };
  const padding = descriptor.comfortPadding;
  const collisionRect = {
    x: interactiveRect.x - padding,
    y: interactiveRect.y - padding,
    width: interactiveRect.width + padding * 2,
    height: interactiveRect.height + padding * 2,
  };
  const boundsSource = descriptor.constrainLayoutToViewport ? canonicalRect : interactiveRect;
  const boundsRect = {
    x: boundsSource.x - padding,
    y: boundsSource.y - padding,
    width: boundsSource.width + padding * 2,
    height: boundsSource.height + padding * 2,
  };
  const targetSourceSize = descriptor.profileSizes?.[profileId] ?? descriptor.defaultSize;
  const targetSizeValid = descriptor.minimumTargetSize
    ? targetSourceSize.width * placement.scale >= descriptor.minimumTargetSize.width &&
      targetSourceSize.height * placement.scale >= descriptor.minimumTargetSize.height
    : true;
  return {
    unscaledSize,
    scaledSize,
    canonicalRect,
    interactiveRect,
    editorFallbackRect,
    collisionRect,
    boundsRect,
    previewRect: clampRectToSafeViewport(interactiveRect, geometry, descriptor.edgeMargin),
    scaleValid: validScale(descriptor, placement.scale),
    targetSizeValid,
    activeVariantIds: footprint.activeVariantIds,
  };
}

export interface ValidateMobileHudContextOptions {
  registry: MobileHudRegistry;
  profileId: MobileHudProfileId;
  placements: Partial<Record<MobileHudSurfaceId, MobileHudPlacement>>;
  baselinePlacements?: Partial<Record<MobileHudSurfaceId, MobileHudPlacement>>;
  geometry: MobileHudViewportGeometry;
  contextId: MobileHudContextId;
  isSurfaceAvailable?(surfaceId: MobileHudSurfaceId): boolean;
}

function placementUsesUnsupportedCapability(
  descriptor: MobileHudSurfaceDescriptor,
  placement: MobileHudPlacement,
): boolean {
  return (
    (placement.orientation !== undefined && !descriptor.capabilities.includes('orientation')) ||
    (placement.reverse !== undefined && !descriptor.capabilities.includes('reverse')) ||
    (placement.openingDirection !== undefined &&
      !descriptor.capabilities.includes('opening-direction'))
  );
}

function isRectWithinSafeMargin(
  rect: MobileHudRect,
  geometry: MobileHudViewportGeometry,
  margin: number,
): boolean {
  const left = geometry.visualOffsetX + geometry.safeAreaInsets.left + margin;
  const top = geometry.visualOffsetY + geometry.safeAreaInsets.top + margin;
  const right = geometry.visualOffsetX + geometry.width - geometry.safeAreaInsets.right - margin;
  const bottom = geometry.visualOffsetY + geometry.height - geometry.safeAreaInsets.bottom - margin;
  return (
    rect.x >= left - COLLISION_EPSILON_CSS_PX &&
    rect.y >= top - COLLISION_EPSILON_CSS_PX &&
    rect.x + rect.width <= right + COLLISION_EPSILON_CSS_PX &&
    rect.y + rect.height <= bottom + COLLISION_EPSILON_CSS_PX
  );
}

function rectsOverlap(a: MobileHudRect, b: MobileHudRect): boolean {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return width > COLLISION_EPSILON_CSS_PX && height > COLLISION_EPSILON_CSS_PX;
}

export function validateMobileHudContext(
  options: ValidateMobileHudContextOptions,
): readonly MobileHudValidationFailure[] {
  const { registry, profileId, placements, geometry, contextId } = options;
  const failures: MobileHudValidationFailure[] = [];
  const failure = (
    reason: MobileHudValidationFailure['reason'],
    surfaceIds: readonly MobileHudSurfaceId[],
    activeVariantIds?: readonly string[],
  ): void => {
    failures.push({
      reason,
      profileId,
      contextId,
      surfaceIds,
      viewportId: geometry.id,
      activeVariantIds,
    });
  };
  const active: {
    descriptor: MobileHudSurfaceDescriptor;
    rect: MobileHudRect;
    activeVariantIds: readonly string[];
  }[] = [];

  for (const descriptor of registry.descriptors) {
    if (options.isSurfaceAvailable && !options.isSurfaceAvailable(descriptor.id)) continue;
    if (!descriptor.validateIn.includes(contextId)) continue;
    if (descriptor.class === 'protected') {
      const rect = descriptor.protectedFootprint?.(geometry);
      if (rect) active.push({ descriptor, rect, activeVariantIds: [] });
      continue;
    }

    const placement = placements[descriptor.id];
    if (!isMobileHudPlacement(placement)) {
      failure('invalid-placement', [descriptor.id]);
      continue;
    }
    if (placementUsesUnsupportedCapability(descriptor, placement)) {
      failure('unsupported-capability', [descriptor.id]);
    }
    const resolved = resolveMobileHudSurfaceGeometry(
      descriptor,
      profileId,
      placement,
      geometry,
      contextId,
    );
    if (!resolved.scaleValid) {
      failure('scale-out-of-range', [descriptor.id], resolved.activeVariantIds);
    }
    if (!resolved.targetSizeValid) {
      failure('target-too-small', [descriptor.id], resolved.activeVariantIds);
    }
    if (!isRectWithinSafeMargin(resolved.boundsRect, geometry, descriptor.edgeMargin)) {
      failure('out-of-bounds', [descriptor.id], resolved.activeVariantIds);
    }
    active.push({
      descriptor,
      // Pairwise Save blocking follows the actual interactive footprint. The
      // comfort padding remains a safe-edge constraint, but must not turn a
      // visible gap between two buttons into a reported overlap.
      rect: resolved.interactiveRect,
      activeVariantIds: resolved.activeVariantIds,
    });
  }

  for (let index = 0; index < active.length; index += 1) {
    const current = active[index];
    for (let otherIndex = index + 1; otherIndex < active.length; otherIndex += 1) {
      const other = active[otherIndex];
      if (!rectsOverlap(current.rect, other.rect)) continue;
      if (current.descriptor.class === 'protected' && other.descriptor.class === 'protected') {
        continue;
      }
      if (current.descriptor.overlapPolicy || other.descriptor.overlapPolicy) continue;
      const surfaceIds = [current.descriptor.id, other.descriptor.id] as const;
      const activeVariantIds = Object.freeze([
        ...new Set([...current.activeVariantIds, ...other.activeVariantIds]),
      ]);
      if (current.descriptor.class === 'protected' || other.descriptor.class === 'protected') {
        failure('protected-overlap', surfaceIds, activeVariantIds);
        continue;
      }
      if (surfaceIds.includes('control.view')) {
        failure('view-intrusion', surfaceIds, activeVariantIds);
        continue;
      }
      if (
        current.descriptor.allowOverlapWith?.includes(other.descriptor.id) &&
        other.descriptor.allowOverlapWith?.includes(current.descriptor.id)
      ) {
        continue;
      }
      failure('overlap', surfaceIds, activeVariantIds);
    }
  }

  if (!options.baselinePlacements) return Object.freeze(failures);
  const baselineFailures = validateMobileHudContext({
    registry,
    profileId,
    placements: options.baselinePlacements,
    geometry,
    contextId,
    isSurfaceAvailable: options.isSurfaceAvailable,
  });
  const baselineKeys = new Set(
    baselineFailures.map((failure) =>
      JSON.stringify([failure.reason, failure.surfaceIds, failure.activeVariantIds]),
    ),
  );
  const placementMatchesBaseline = (surfaceId: MobileHudSurfaceId): boolean => {
    const descriptor = registry.getDescriptor(surfaceId);
    if (descriptor?.class === 'protected') return true;
    return (
      JSON.stringify(placements[surfaceId]) ===
      JSON.stringify(options.baselinePlacements?.[surfaceId])
    );
  };
  const resolvedRect = (
    surfaceId: MobileHudSurfaceId,
    sourcePlacements: Partial<Record<MobileHudSurfaceId, MobileHudPlacement>>,
    collision: boolean,
  ): MobileHudRect | null => {
    const descriptor = registry.getDescriptor(surfaceId);
    if (!descriptor) return null;
    if (descriptor.class === 'protected') return descriptor.protectedFootprint?.(geometry) ?? null;
    const placement = sourcePlacements[surfaceId];
    if (!isMobileHudPlacement(placement)) return null;
    const resolved = resolveMobileHudSurfaceGeometry(
      descriptor,
      profileId,
      placement,
      geometry,
      contextId,
    );
    return collision ? resolved.boundsRect : resolved.interactiveRect;
  };
  const magnitude = (
    target: MobileHudValidationFailure,
    sourcePlacements: Partial<Record<MobileHudSurfaceId, MobileHudPlacement>>,
  ): number => {
    if (
      target.reason === 'overlap' ||
      target.reason === 'view-intrusion' ||
      target.reason === 'protected-overlap'
    ) {
      const first = resolvedRect(target.surfaceIds[0], sourcePlacements, false);
      const second = resolvedRect(target.surfaceIds[1], sourcePlacements, false);
      if (!first || !second) return Number.POSITIVE_INFINITY;
      const width = Math.max(
        0,
        Math.min(first.x + first.width, second.x + second.width) - Math.max(first.x, second.x),
      );
      const height = Math.max(
        0,
        Math.min(first.y + first.height, second.y + second.height) - Math.max(first.y, second.y),
      );
      return width * height;
    }
    const surfaceId = target.surfaceIds[0];
    const descriptor = registry.getDescriptor(surfaceId);
    const placement = sourcePlacements[surfaceId];
    if (!descriptor || !isMobileHudPlacement(placement)) return Number.POSITIVE_INFINITY;
    if (target.reason === 'out-of-bounds') {
      const rect = resolvedRect(surfaceId, sourcePlacements, true);
      if (!rect) return Number.POSITIVE_INFINITY;
      const left = geometry.visualOffsetX + geometry.safeAreaInsets.left + descriptor.edgeMargin;
      const top = geometry.visualOffsetY + geometry.safeAreaInsets.top + descriptor.edgeMargin;
      const right =
        geometry.visualOffsetX +
        geometry.width -
        geometry.safeAreaInsets.right -
        descriptor.edgeMargin;
      const bottom =
        geometry.visualOffsetY +
        geometry.height -
        geometry.safeAreaInsets.bottom -
        descriptor.edgeMargin;
      return (
        Math.max(0, left - rect.x) +
        Math.max(0, top - rect.y) +
        Math.max(0, rect.x + rect.width - right) +
        Math.max(0, rect.y + rect.height - bottom)
      );
    }
    if (target.reason === 'scale-out-of-range' && descriptor.scaleLimits) {
      return Math.max(
        0,
        descriptor.scaleLimits.min - placement.scale,
        placement.scale - descriptor.scaleLimits.max,
      );
    }
    if (target.reason === 'target-too-small' && descriptor.minimumTargetSize) {
      const source = descriptor.profileSizes?.[profileId] ?? descriptor.defaultSize;
      return (
        Math.max(0, descriptor.minimumTargetSize.width - source.width * placement.scale) +
        Math.max(0, descriptor.minimumTargetSize.height - source.height * placement.scale)
      );
    }
    return 1;
  };
  return Object.freeze(
    failures.filter((failure) => {
      const key = JSON.stringify([failure.reason, failure.surfaceIds, failure.activeVariantIds]);
      if (!baselineKeys.has(key)) return true;
      if (failure.surfaceIds.every((surfaceId) => placementMatchesBaseline(surfaceId)))
        return false;
      const baselineMagnitude = magnitude(failure, options.baselinePlacements ?? {});
      const currentMagnitude = magnitude(failure, placements);
      return currentMagnitude > baselineMagnitude + COLLISION_EPSILON_CSS_PX;
    }),
  );
}

export interface ValidateMobileHudLayoutMatrixOptions {
  registry: MobileHudRegistry;
  profiles: Partial<
    Record<MobileHudProfileId, Partial<Record<MobileHudSurfaceId, MobileHudPlacement>>>
  >;
  baselineProfiles?: Partial<
    Record<MobileHudProfileId, Partial<Record<MobileHudSurfaceId, MobileHudPlacement>>>
  >;
  matrix?: readonly MobileHudGeometryMatrixFixture[];
  onCase?(fixture: MobileHudGeometryMatrixFixture): void;
  isSurfaceAvailable?(surfaceId: MobileHudSurfaceId): boolean;
}

function matrixFailureKey(failure: MobileHudValidationFailure): string {
  return JSON.stringify([
    failure.reason,
    failure.profileId,
    failure.contextId,
    failure.surfaceIds,
    failure.viewportId,
    failure.safeAreaFixtureId,
    failure.activeVariantIds,
  ]);
}

export function validateMobileHudLayoutMatrix(
  options: ValidateMobileHudLayoutMatrixOptions,
): readonly MobileHudValidationFailure[] {
  const failures: MobileHudValidationFailure[] = [];
  const seen = new Set<string>();
  for (const fixture of options.matrix ?? MOBILE_HUD_GEOMETRY_MATRIX) {
    const placements = options.profiles[fixture.profileId];
    if (!placements) continue;
    options.onCase?.(fixture);
    const contextFailures = validateMobileHudContext({
      registry: options.registry,
      profileId: fixture.profileId,
      placements,
      baselinePlacements: options.baselineProfiles?.[fixture.profileId],
      geometry: fixture.geometry,
      contextId: fixture.context.id,
      isSurfaceAvailable: options.isSurfaceAvailable,
    });
    for (const contextFailure of contextFailures) {
      const enriched = {
        ...contextFailure,
        safeAreaFixtureId: `${fixture.sideInset.id}/${fixture.bottomInset.id}`,
      };
      const key = matrixFailureKey(enriched);
      if (seen.has(key)) continue;
      seen.add(key);
      failures.push(Object.freeze(enriched));
    }
  }
  return Object.freeze(failures);
}

export interface MobileHudPreviewTransform {
  sourceOrigin: MobileHudPoint;
  sourceSize: MobileHudSize;
  contentRect: MobileHudRect;
  scale: number;
}

export function createMobileHudPreviewTransform(
  source: MobileHudViewportGeometry,
  previewRect: MobileHudRect,
): MobileHudPreviewTransform {
  if (
    source.width <= 0 ||
    source.height <= 0 ||
    previewRect.width <= 0 ||
    previewRect.height <= 0
  ) {
    throw new Error('mobile HUD preview geometry must have positive dimensions');
  }
  const scale = Math.min(previewRect.width / source.width, previewRect.height / source.height);
  const width = source.width * scale;
  const height = source.height * scale;
  return Object.freeze({
    sourceOrigin: Object.freeze({ x: source.visualOffsetX, y: source.visualOffsetY }),
    sourceSize: Object.freeze({ width: source.width, height: source.height }),
    contentRect: Object.freeze({
      x: previewRect.x + (previewRect.width - width) / 2,
      y: previewRect.y + (previewRect.height - height) / 2,
      width,
      height,
    }),
    scale,
  });
}

export function mapMobileHudVisualPointToPreview(
  point: MobileHudPoint,
  transform: MobileHudPreviewTransform,
): MobileHudPoint {
  return {
    x: transform.contentRect.x + (point.x - transform.sourceOrigin.x) * transform.scale,
    y: transform.contentRect.y + (point.y - transform.sourceOrigin.y) * transform.scale,
  };
}

export function mapMobileHudPreviewPointToCanonical(
  point: MobileHudPoint,
  transform: MobileHudPreviewTransform,
): MobileHudPoint {
  return {
    x: transform.sourceOrigin.x + (point.x - transform.contentRect.x) / transform.scale,
    y: transform.sourceOrigin.y + (point.y - transform.contentRect.y) / transform.scale,
  };
}

export function mapMobileHudPreviewDeltaToCanonical(
  delta: MobileHudPoint,
  transform: MobileHudPreviewTransform,
): MobileHudPoint {
  return { x: delta.x / transform.scale, y: delta.y / transform.scale };
}

export function mapMobileHudAuthorPointToVisual(
  point: MobileHudPoint,
  uiScale: number,
  geometry: Pick<MobileHudViewportGeometry, 'visualOffsetX' | 'visualOffsetY'>,
): MobileHudPoint {
  return {
    x: geometry.visualOffsetX + point.x * uiScale,
    y: geometry.visualOffsetY + point.y * uiScale,
  };
}

export function mapMobileHudVisualPointToAuthor(
  point: MobileHudPoint,
  uiScale: number,
  geometry: Pick<MobileHudViewportGeometry, 'visualOffsetX' | 'visualOffsetY'>,
): MobileHudPoint {
  if (!Number.isFinite(uiScale) || uiScale <= 0)
    throw new Error('mobile HUD UI Scale must be positive');
  return {
    x: (point.x - geometry.visualOffsetX) / uiScale,
    y: (point.y - geometry.visualOffsetY) / uiScale,
  };
}

export type MobileHudDraftAction =
  | { type: 'set-locked'; locked: boolean }
  | { type: 'select-surface'; surfaceId: MobileHudSurfaceId | null }
  | { type: 'set-context'; contextId: MobileHudContextId }
  | {
      type: 'nudge-selected';
      deltaX: number;
      deltaY: number;
      handedness: 'left' | 'right';
    }
  | { type: 'scale-selected'; steps: number; handedness: 'left' | 'right' }
  | { type: 'toggle-orientation'; handedness: 'left' | 'right' }
  | { type: 'toggle-reverse'; handedness: 'left' | 'right' }
  | { type: 'cycle-opening-direction'; handedness: 'left' | 'right' }
  | { type: 'reset-selected' }
  | { type: 'reset-all' }
  | { type: 'show-next-failure' }
  | { type: 'restore-entry' }
  | {
      type: 'move-selected';
      topLeft: MobileHudPoint;
      size: MobileHudSize;
      geometry: MobileHudViewportGeometry;
      handedness: 'left' | 'right';
    };

export interface MobileHudDraftReducerEnvironment {
  registry: MobileHudRegistry;
}

function replaceDraftPlacement(
  draft: MobileHudDraft,
  surfaceId: MobileHudSurfaceId,
  placement: MobileHudPlacement,
): MobileHudDraft {
  const { document: layoutDocument } = draft;
  const profilePlacements = layoutDocument.profiles[draft.activeProfileId] ?? {};
  return {
    ...draft,
    document: {
      ...layoutDocument,
      profiles: {
        ...layoutDocument.profiles,
        [draft.activeProfileId]: {
          ...profilePlacements,
          [surfaceId]: placement,
        },
      },
    },
  };
}

export function reduceMobileHudDraft(
  draft: MobileHudDraft,
  action: MobileHudDraftAction,
  environment: MobileHudDraftReducerEnvironment,
): MobileHudDraft {
  const { document: layoutDocument } = draft;
  if (action.type === 'set-locked') {
    return action.locked === draft.locked ? draft : { ...draft, locked: action.locked };
  }

  if (action.type === 'set-context') {
    const context = MOBILE_HUD_CONTEXTS.find((candidate) => candidate.id === action.contextId);
    if (!context) return draft;
    const selected = draft.selectedSurfaceId
      ? environment.registry.getDescriptor(draft.selectedSurfaceId)
      : undefined;
    const selectedSurfaceId =
      selected?.class === 'movable' && selected.visibleIn.includes(action.contextId)
        ? selected.id
        : null;
    if (
      draft.contextId === action.contextId &&
      draft.sceneId === context.sceneId &&
      draft.selectedSurfaceId === selectedSurfaceId
    ) {
      return draft;
    }
    return {
      ...draft,
      sceneId: context.sceneId,
      contextId: action.contextId,
      selectedSurfaceId,
    };
  }

  if (draft.locked) return draft;

  if (action.type === 'select-surface') {
    if (action.surfaceId === null) {
      return draft.selectedSurfaceId === null ? draft : { ...draft, selectedSurfaceId: null };
    }
    const descriptor = environment.registry.getDescriptor(action.surfaceId);
    if (descriptor?.class !== 'movable' || !descriptor.visibleIn.includes(draft.contextId)) {
      return draft;
    }
    return draft.selectedSurfaceId === action.surfaceId
      ? draft
      : { ...draft, selectedSurfaceId: action.surfaceId };
  }

  if (action.type === 'reset-all') {
    const defaults = environment.registry.defaults[draft.activeProfileId];
    if (!defaults) return draft;
    return {
      ...draft,
      document: {
        ...layoutDocument,
        profiles: {
          ...layoutDocument.profiles,
          [draft.activeProfileId]: { ...defaults },
        },
      },
    };
  }

  if (action.type === 'show-next-failure') {
    if (draft.failures.length === 0) return draft;
    const activeFailureIndex = ((draft.activeFailureIndex ?? -1) + 1) % draft.failures.length;
    const activeFailure = draft.failures[activeFailureIndex];
    const context = MOBILE_HUD_CONTEXTS.find(
      (candidate) => candidate.id === activeFailure.contextId,
    );
    if (!context) return draft;
    const selectedSurfaceId =
      activeFailure.surfaceIds.find(
        (surfaceId) => environment.registry.getDescriptor(surfaceId)?.class === 'movable',
      ) ?? null;
    return {
      ...draft,
      activeFailureIndex,
      activeProfileId: activeFailure.profileId,
      sceneId: context.sceneId,
      contextId: activeFailure.contextId,
      selectedSurfaceId,
    };
  }

  if (action.type === 'restore-entry') {
    if (layoutDocument === draft.entryDocument && draft.activeFailureIndex === null) return draft;
    return { ...draft, document: draft.entryDocument, activeFailureIndex: null };
  }

  const surfaceId = draft.selectedSurfaceId;
  if (!surfaceId) return draft;
  const descriptor = environment.registry.getDescriptor(surfaceId);
  const canonical = layoutDocument.profiles[draft.activeProfileId]?.[surfaceId];
  if (descriptor?.class !== 'movable' || !canonical) return draft;

  if (action.type === 'reset-selected') {
    const defaultPlacement = environment.registry.defaults[draft.activeProfileId]?.[surfaceId];
    return defaultPlacement
      ? replaceDraftPlacement(draft, surfaceId, { ...defaultPlacement })
      : draft;
  }

  if (action.type === 'nudge-selected') {
    const displayed =
      action.handedness === 'left'
        ? mirrorMobileHudPlacement(canonical, descriptor.mirrorPolicy)
        : canonical;
    const nudgedDisplayed = {
      ...displayed,
      offsetX: displayed.offsetX + action.deltaX,
      offsetY: displayed.offsetY + action.deltaY,
    };
    const nudgedCanonical =
      action.handedness === 'left'
        ? mirrorMobileHudPlacement(nudgedDisplayed, descriptor.mirrorPolicy)
        : nudgedDisplayed;
    return replaceDraftPlacement(draft, surfaceId, nudgedCanonical);
  }

  if (action.type === 'scale-selected') {
    if (!descriptor.capabilities.includes('scale') || !descriptor.scaleLimits) return draft;
    const nextScale = Math.min(
      descriptor.scaleLimits.max,
      Math.max(
        descriptor.scaleLimits.min,
        canonical.scale + action.steps * descriptor.scaleLimits.step,
      ),
    );
    const roundedScale = Number(nextScale.toFixed(10));
    return roundedScale === canonical.scale
      ? draft
      : replaceDraftPlacement(draft, surfaceId, { ...canonical, scale: roundedScale });
  }

  if (action.type === 'toggle-orientation') {
    if (!descriptor.capabilities.includes('orientation')) return draft;
    const orientation =
      (canonical.orientation ?? 'horizontal') === 'horizontal' ? 'vertical' : 'horizontal';
    return replaceDraftPlacement(draft, surfaceId, { ...canonical, orientation });
  }

  if (action.type === 'toggle-reverse') {
    if (!descriptor.capabilities.includes('reverse')) return draft;
    return replaceDraftPlacement(draft, surfaceId, {
      ...canonical,
      reverse: !(canonical.reverse ?? false),
    });
  }

  if (action.type === 'cycle-opening-direction') {
    if (!descriptor.capabilities.includes('opening-direction')) return draft;
    const displayed =
      action.handedness === 'left'
        ? mirrorMobileHudPlacement(canonical, descriptor.mirrorPolicy)
        : canonical;
    const directions: readonly MobileHudOpeningDirection[] = ['left', 'right', 'up', 'down'];
    const currentIndex = directions.indexOf(displayed.openingDirection ?? 'right');
    const openingDirection = directions[(currentIndex + 1) % directions.length];
    const updatedDisplayed = { ...displayed, openingDirection };
    const updatedCanonical =
      action.handedness === 'left'
        ? mirrorMobileHudPlacement(updatedDisplayed, descriptor.mirrorPolicy)
        : updatedDisplayed;
    return replaceDraftPlacement(draft, surfaceId, updatedCanonical);
  }

  const displayed =
    action.handedness === 'left'
      ? mirrorMobileHudPlacement(canonical, descriptor.mirrorPolicy)
      : canonical;
  const anchored = invertMobileHudAnchorTopLeft(action.topLeft, action.size, action.geometry);
  const movedDisplayed = { ...displayed, ...anchored };
  const movedCanonical =
    action.handedness === 'left'
      ? mirrorMobileHudPlacement(movedDisplayed, descriptor.mirrorPolicy)
      : movedDisplayed;
  return replaceDraftPlacement(draft, surfaceId, movedCanonical);
}

function valuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (typeof left !== 'object' || left === null || typeof right !== 'object' || right === null) {
    return false;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    return left.every((value, index) => valuesEqual(value, right[index]));
  }
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord).sort();
  const rightKeys = Object.keys(rightRecord).sort();
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every(
    (key, index) => key === rightKeys[index] && valuesEqual(leftRecord[key], rightRecord[key]),
  );
}

export function isMobileHudDraftDirty(draft: MobileHudDraft): boolean {
  const { document: layoutDocument } = draft;
  return !valuesEqual(layoutDocument, draft.entryDocument);
}
