import { MOBILE_HUD_GEOMETRY_MATRIX } from './mobile_hud_context';
import {
  COLLISION_EPSILON_CSS_PX,
  isMobileHudPlacement,
  MOBILE_HUD_CONTEXT_IDS,
  MOBILE_HUD_SURFACE_IDS,
  type MobileHudEditCapability,
  type MobileHudPlacement,
  type MobileHudProfileId,
  type MobileHudRect,
  type MobileHudSurfaceDescriptor,
  type MobileHudSurfaceId,
  type MobileHudViewportGeometry,
} from './mobile_hud_editor_types';

export type MobileHudDefaultPlacements = Partial<
  Record<MobileHudProfileId, Partial<Record<MobileHudSurfaceId, MobileHudPlacement>>>
>;

export interface MobileHudRegistryDefinition {
  descriptors: readonly MobileHudSurfaceDescriptor[];
  defaults?: MobileHudDefaultPlacements;
  geometryAuditCases?: readonly MobileHudProtectedGeometryAuditCase[];
}

export interface MobileHudProtectedGeometryAuditCase {
  contextId: (typeof MOBILE_HUD_CONTEXT_IDS)[number];
  geometry: MobileHudViewportGeometry;
}

export interface MobileHudRegistry {
  descriptors: readonly MobileHudSurfaceDescriptor[];
  defaults: MobileHudDefaultPlacements;
  getDescriptor(id: MobileHudSurfaceId): MobileHudSurfaceDescriptor | undefined;
}

const CAPABILITIES: readonly MobileHudEditCapability[] = [
  'scale',
  'orientation',
  'reverse',
  'opening-direction',
];

function assertDescriptorSchema(descriptor: MobileHudSurfaceDescriptor): void {
  if (!MOBILE_HUD_SURFACE_IDS.includes(descriptor.id)) {
    throw new Error(`unknown mobile HUD surface id: ${descriptor.id}`);
  }
  for (const [setName, contexts] of [
    ['visibleIn', descriptor.visibleIn],
    ['validateIn', descriptor.validateIn],
  ] as const) {
    for (const context of contexts) {
      if (!MOBILE_HUD_CONTEXT_IDS.includes(context)) {
        throw new Error(`${descriptor.id} ${setName} contains unknown context: ${context}`);
      }
    }
  }
  const validated = new Set(descriptor.validateIn);
  for (const context of descriptor.visibleIn) {
    if (!validated.has(context)) {
      throw new Error(`${descriptor.id} visible context is not validated: ${context}`);
    }
  }
  for (const capability of descriptor.capabilities) {
    if (!CAPABILITIES.includes(capability)) {
      throw new Error(`${descriptor.id} has unsupported capability: ${capability}`);
    }
  }
  if (
    descriptor.capabilities.includes('reverse') &&
    !descriptor.capabilities.includes('orientation')
  ) {
    throw new Error(`${descriptor.id} reverse capability requires orientation`);
  }
  if (descriptor.capabilities.includes('scale') !== (descriptor.scaleLimits !== undefined)) {
    throw new Error(`${descriptor.id} scale capability and limits must be declared together`);
  }
  if (descriptor.class === 'protected' && descriptor.capabilities.length > 0) {
    throw new Error(`${descriptor.id} protected surfaces cannot expose edit capabilities`);
  }
  if ((descriptor.class === 'protected') !== (descriptor.protectedFootprint !== undefined)) {
    throw new Error(
      `${descriptor.id} protected surfaces require one protected footprint resolver and movable surfaces cannot declare one`,
    );
  }
  if (descriptor.overlapPolicy === 'informational-overlay' && descriptor.class !== 'movable') {
    throw new Error(`${descriptor.id} informational overlays must be movable surfaces`);
  }
  if (descriptor.overlapPolicy === 'foreground-overlay' && descriptor.class !== 'protected') {
    throw new Error(`${descriptor.id} foreground overlays must be protected surfaces`);
  }
}

function assertPlacementCapabilities(
  descriptor: MobileHudSurfaceDescriptor,
  placement: MobileHudPlacement,
): void {
  if (placement.orientation !== undefined && !descriptor.capabilities.includes('orientation')) {
    throw new Error(`${descriptor.id} default orientation requires orientation capability`);
  }
  if (placement.reverse !== undefined && !descriptor.capabilities.includes('reverse')) {
    throw new Error(`${descriptor.id} default reverse requires reverse capability`);
  }
  if (
    placement.openingDirection !== undefined &&
    !descriptor.capabilities.includes('opening-direction')
  ) {
    throw new Error(
      `${descriptor.id} default openingDirection requires opening-direction capability`,
    );
  }
}

function freezeDescriptor(descriptor: MobileHudSurfaceDescriptor): MobileHudSurfaceDescriptor {
  return Object.freeze({
    ...descriptor,
    visibleIn: Object.freeze([...descriptor.visibleIn]),
    validateIn: Object.freeze([...descriptor.validateIn]),
    defaultSize: Object.freeze({ ...descriptor.defaultSize }),
    profileSizes: descriptor.profileSizes
      ? Object.freeze(
          Object.fromEntries(
            Object.entries(descriptor.profileSizes).map(([profileId, size]) => [
              profileId,
              Object.freeze({ ...size }),
            ]),
          ),
        )
      : undefined,
    minimumTargetSize: descriptor.minimumTargetSize
      ? Object.freeze({ ...descriptor.minimumTargetSize })
      : undefined,
    scaleLimits: descriptor.scaleLimits ? Object.freeze({ ...descriptor.scaleLimits }) : undefined,
    capabilities: Object.freeze([...descriptor.capabilities]),
    variants: descriptor.variants
      ? Object.freeze(
          descriptor.variants.map((variant) =>
            Object.freeze({
              ...variant,
              size: Object.freeze({ ...variant.size }),
              contexts: variant.contexts ? Object.freeze([...variant.contexts]) : undefined,
            }),
          ),
        )
      : undefined,
    allowOverlapWith: descriptor.allowOverlapWith
      ? Object.freeze([...descriptor.allowOverlapWith])
      : undefined,
    allowProtectedOverlapWith: descriptor.allowProtectedOverlapWith
      ? Object.freeze([...descriptor.allowProtectedOverlapWith])
      : undefined,
    binding: descriptor.binding
      ? Object.freeze({
          ...descriptor.binding,
          dependentRootSelectors: descriptor.binding.dependentRootSelectors
            ? Object.freeze([...descriptor.binding.dependentRootSelectors])
            : undefined,
          editorVisualSelectors: descriptor.binding.editorVisualSelectors
            ? Object.freeze([...descriptor.binding.editorVisualSelectors])
            : undefined,
          editorGeometrySelectors: descriptor.binding.editorGeometrySelectors
            ? Object.freeze([...descriptor.binding.editorGeometrySelectors])
            : undefined,
          editorPseudoGeometry: descriptor.binding.editorPseudoGeometry
            ? Object.freeze(
                descriptor.binding.editorPseudoGeometry.map((entry) => Object.freeze({ ...entry })),
              )
            : undefined,
        })
      : undefined,
  });
}

function freezeDefaults(
  defaults: MobileHudDefaultPlacements,
  descriptorById: ReadonlyMap<MobileHudSurfaceId, MobileHudSurfaceDescriptor>,
): MobileHudDefaultPlacements {
  const frozenDefaults: MobileHudDefaultPlacements = {};
  for (const profileId of ['phone', 'tablet'] as const) {
    const placements = defaults[profileId];
    if (!placements) continue;
    const frozenPlacements: Partial<Record<MobileHudSurfaceId, MobileHudPlacement>> = {};
    for (const [surfaceId, value] of Object.entries(placements)) {
      const id = surfaceId as MobileHudSurfaceId;
      const descriptor = descriptorById.get(id);
      if (!descriptor) throw new Error(`${profileId} default references unknown surface: ${id}`);
      if (descriptor.class === 'protected') {
        throw new Error(`${descriptor.id} protected surfaces cannot have default placements`);
      }
      if (!isMobileHudPlacement(value)) {
        throw new Error(`${descriptor.id} has an invalid default placement`);
      }
      assertPlacementCapabilities(descriptor, value);
      frozenPlacements[id] = Object.freeze({ ...value });
    }
    frozenDefaults[profileId] = Object.freeze(frozenPlacements);
  }
  return Object.freeze(frozenDefaults);
}

function assertReciprocalOverlaps(
  descriptors: readonly MobileHudSurfaceDescriptor[],
  descriptorById: ReadonlyMap<MobileHudSurfaceId, MobileHudSurfaceDescriptor>,
): void {
  for (const descriptor of descriptors) {
    for (const otherId of descriptor.allowOverlapWith ?? []) {
      const other = descriptorById.get(otherId);
      if (!other?.allowOverlapWith?.includes(descriptor.id)) {
        throw new Error(`overlap declaration must be reciprocal: ${descriptor.id} <-> ${otherId}`);
      }
    }
    for (const otherId of descriptor.allowProtectedOverlapWith ?? []) {
      const other = descriptorById.get(otherId);
      if (
        descriptor.class !== 'protected' ||
        other?.class !== 'protected' ||
        !other.allowProtectedOverlapWith?.includes(descriptor.id)
      ) {
        throw new Error(
          `protected overlap declaration must be reciprocal: ${descriptor.id} <-> ${otherId}`,
        );
      }
    }
  }
}

function isFiniteRect(rect: MobileHudRect): boolean {
  return (
    Number.isFinite(rect.x) &&
    Number.isFinite(rect.y) &&
    Number.isFinite(rect.width) &&
    Number.isFinite(rect.height) &&
    rect.width > 0 &&
    rect.height > 0
  );
}

function rectanglesOverlap(a: MobileHudRect, b: MobileHudRect): boolean {
  const overlapWidth = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const overlapHeight = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return overlapWidth > COLLISION_EPSILON_CSS_PX && overlapHeight > COLLISION_EPSILON_CSS_PX;
}

function assertProtectedFootprints(
  descriptors: readonly MobileHudSurfaceDescriptor[],
  auditCases: readonly MobileHudProtectedGeometryAuditCase[],
): void {
  const protectedDescriptors = descriptors.filter((descriptor) => descriptor.class === 'protected');
  if (protectedDescriptors.length < 2) return;
  for (const auditCase of auditCases) {
    const active = protectedDescriptors.filter((descriptor) =>
      descriptor.visibleIn.includes(auditCase.contextId),
    );
    const resolved = active.map((descriptor) => {
      const footprint = descriptor.protectedFootprint?.(auditCase.geometry);
      if (!footprint || !isFiniteRect(footprint)) {
        throw new Error(
          `${descriptor.id} resolved an invalid protected footprint in ${auditCase.contextId} at ${auditCase.geometry.id}`,
        );
      }
      return { descriptor, footprint };
    });
    for (let index = 0; index < resolved.length; index += 1) {
      for (let otherIndex = index + 1; otherIndex < resolved.length; otherIndex += 1) {
        const current = resolved[index];
        const other = resolved[otherIndex];
        if (
          rectanglesOverlap(current.footprint, other.footprint) &&
          !current.descriptor.allowProtectedOverlapWith?.includes(other.descriptor.id)
        ) {
          throw new Error(
            `protected mobile HUD footprints overlap: ${current.descriptor.id} <-> ${other.descriptor.id} in ${auditCase.contextId} at ${auditCase.geometry.id}`,
          );
        }
      }
    }
  }
}

const DEFAULT_GEOMETRY_AUDIT_CASES: readonly MobileHudProtectedGeometryAuditCase[] = Object.freeze(
  MOBILE_HUD_GEOMETRY_MATRIX.map((entry) =>
    Object.freeze({ contextId: entry.context.id, geometry: entry.geometry }),
  ),
);

export function buildMobileHudRegistry(definition: MobileHudRegistryDefinition): MobileHudRegistry {
  const descriptorById = new Map<MobileHudSurfaceId, MobileHudSurfaceDescriptor>();
  const descriptors: MobileHudSurfaceDescriptor[] = [];
  for (const source of definition.descriptors) {
    if (descriptorById.has(source.id)) {
      throw new Error(`duplicate mobile HUD surface id: ${source.id}`);
    }
    assertDescriptorSchema(source);
    const descriptor = freezeDescriptor(source);
    descriptorById.set(descriptor.id, descriptor);
    descriptors.push(descriptor);
  }
  const frozenDescriptors = Object.freeze(descriptors);
  assertReciprocalOverlaps(frozenDescriptors, descriptorById);
  assertProtectedFootprints(
    frozenDescriptors,
    definition.geometryAuditCases ?? DEFAULT_GEOMETRY_AUDIT_CASES,
  );
  const defaults = freezeDefaults(definition.defaults ?? {}, descriptorById);
  return Object.freeze({
    descriptors: frozenDescriptors,
    defaults,
    getDescriptor(id: MobileHudSurfaceId) {
      return descriptorById.get(id);
    },
  });
}

export function mergeMobileHudPlacementDefaults(
  registry: MobileHudRegistry,
  profileId: MobileHudProfileId,
  placements: Partial<Record<MobileHudSurfaceId, MobileHudPlacement>> = {},
): Readonly<Partial<Record<MobileHudSurfaceId, MobileHudPlacement>>> {
  const merged: Partial<Record<MobileHudSurfaceId, MobileHudPlacement>> = {};
  for (const descriptor of registry.descriptors) {
    if (descriptor.class === 'protected') continue;
    const candidate = placements[descriptor.id] ?? registry.defaults[profileId]?.[descriptor.id];
    if (!candidate) {
      throw new Error(`${descriptor.id} has no ${profileId} mobile HUD default placement`);
    }
    if (!isMobileHudPlacement(candidate)) {
      throw new Error(`${descriptor.id} has an invalid ${profileId} mobile HUD placement`);
    }
    assertPlacementCapabilities(descriptor, candidate);
    merged[descriptor.id] = Object.freeze({ ...candidate });
  }
  return Object.freeze(merged);
}
