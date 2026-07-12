import {
  type ValidateMobileHudLayoutMatrixOptions,
  validateMobileHudLayoutMatrix,
} from './mobile_hud_editor_core';
import {
  isMobileHudPlacement,
  MOBILE_HUD_LAYOUT_SCHEMA_VERSION,
  MOBILE_HUD_LAYOUT_STORAGE_KEY,
  MOBILE_HUD_PROFILE_IDS,
  type MobileHudLayoutDocumentV1,
  type MobileHudLayoutStorage,
  type MobileHudPlacement,
  type MobileHudProfileId,
  type MobileHudSurfaceId,
} from './mobile_hud_editor_types';
import type { MobileHudRegistry } from './mobile_hud_registry';
import { mergeMobileHudPlacementDefaults } from './mobile_hud_registry';

export type MobileHudDecodeFailureReason =
  | 'malformed-json'
  | 'invalid-root'
  | 'unsupported-version';

export type MobileHudDecodeResult =
  | {
      ok: true;
      document: MobileHudLayoutDocumentV1;
      droppedPlacementIds: readonly string[];
      ignoredSurfaceIds: readonly string[];
    }
  | { ok: false; reason: MobileHudDecodeFailureReason };

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function placementUsesSupportedCapabilities(
  placement: MobileHudPlacement,
  registry: MobileHudRegistry,
  surfaceId: MobileHudSurfaceId,
): boolean {
  const descriptor = registry.getDescriptor(surfaceId);
  if (descriptor?.class !== 'movable') return false;
  return (
    (placement.orientation === undefined || descriptor.capabilities.includes('orientation')) &&
    (placement.reverse === undefined || descriptor.capabilities.includes('reverse')) &&
    (placement.openingDirection === undefined ||
      descriptor.capabilities.includes('opening-direction'))
  );
}

export function decodeMobileHudLayoutV1(
  serialized: string,
  registry: MobileHudRegistry,
): MobileHudDecodeResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    return { ok: false, reason: 'malformed-json' };
  }
  if (!isRecord(parsed)) return { ok: false, reason: 'invalid-root' };
  if (parsed.schemaVersion !== MOBILE_HUD_LAYOUT_SCHEMA_VERSION) {
    return { ok: false, reason: 'unsupported-version' };
  }
  if (typeof parsed.enabled !== 'boolean' || !isRecord(parsed.profiles)) {
    return { ok: false, reason: 'invalid-root' };
  }

  const profiles: MobileHudLayoutDocumentV1['profiles'] = {};
  const droppedPlacementIds: string[] = [];
  const ignoredSurfaceIds: string[] = [];
  for (const profileId of MOBILE_HUD_PROFILE_IDS) {
    const sourceProfile = parsed.profiles[profileId];
    if (sourceProfile === undefined) continue;
    if (!isRecord(sourceProfile)) return { ok: false, reason: 'invalid-root' };
    const placements: Partial<Record<MobileHudSurfaceId, MobileHudPlacement>> = {};
    for (const [rawSurfaceId, value] of Object.entries(sourceProfile)) {
      const surfaceId = rawSurfaceId as MobileHudSurfaceId;
      const descriptor = registry.getDescriptor(surfaceId);
      if (descriptor?.class !== 'movable') {
        ignoredSurfaceIds.push(`${profileId}/${rawSurfaceId}`);
        continue;
      }
      if (
        !isMobileHudPlacement(value) ||
        !placementUsesSupportedCapabilities(value, registry, surfaceId)
      ) {
        droppedPlacementIds.push(`${profileId}/${surfaceId}`);
        continue;
      }
      placements[surfaceId] = { ...value };
    }
    profiles[profileId] = placements;
  }

  return {
    ok: true,
    document: {
      schemaVersion: MOBILE_HUD_LAYOUT_SCHEMA_VERSION,
      enabled: parsed.enabled,
      profiles,
    },
    droppedPlacementIds: Object.freeze(droppedPlacementIds),
    ignoredSurfaceIds: Object.freeze(ignoredSurfaceIds),
  };
}

function orderedPlacement(placement: MobileHudPlacement): MobileHudPlacement {
  return {
    anchor: placement.anchor,
    offsetX: placement.offsetX,
    offsetY: placement.offsetY,
    scale: placement.scale,
    ...(placement.orientation === undefined ? {} : { orientation: placement.orientation }),
    ...(placement.reverse === undefined ? {} : { reverse: placement.reverse }),
    ...(placement.openingDirection === undefined
      ? {}
      : { openingDirection: placement.openingDirection }),
  };
}

export function encodeMobileHudLayoutV1(
  document: MobileHudLayoutDocumentV1,
  registry: MobileHudRegistry,
): string {
  const profiles: Partial<
    Record<MobileHudProfileId, Partial<Record<MobileHudSurfaceId, MobileHudPlacement>>>
  > = {};
  for (const profileId of MOBILE_HUD_PROFILE_IDS) {
    const sourceProfile = document.profiles[profileId];
    if (!sourceProfile) continue;
    const placements: Partial<Record<MobileHudSurfaceId, MobileHudPlacement>> = {};
    for (const descriptor of registry.descriptors) {
      if (descriptor.class !== 'movable') continue;
      const placement = sourceProfile[descriptor.id];
      if (!placement) continue;
      placements[descriptor.id] = orderedPlacement(placement);
    }
    profiles[profileId] = placements;
  }
  return JSON.stringify({
    schemaVersion: MOBILE_HUD_LAYOUT_SCHEMA_VERSION,
    enabled: document.enabled,
    profiles,
  });
}

export class LocalMobileHudLayoutStorage implements MobileHudLayoutStorage {
  readonly #storage: StorageLike;

  readonly #key: string;

  constructor(storage: StorageLike = globalThis.localStorage, key = MOBILE_HUD_LAYOUT_STORAGE_KEY) {
    this.#storage = storage;
    this.#key = key;
  }

  async load(): Promise<string | null> {
    return this.#storage.getItem(this.#key);
  }

  async save(serialized: string): Promise<void> {
    this.#storage.setItem(this.#key, serialized);
  }
}

export interface LoadMobileHudLayoutOptions {
  storage: MobileHudLayoutStorage;
  registry: MobileHudRegistry;
  matrix?: ValidateMobileHudLayoutMatrixOptions['matrix'];
  isSurfaceAvailable?: ValidateMobileHudLayoutMatrixOptions['isSurfaceAvailable'];
}

export interface LoadMobileHudLayoutResult {
  document: MobileHudLayoutDocumentV1;
  profileFallbacks: readonly MobileHudProfileId[];
  sourceSerialized: string | null;
  decodeFailure?: MobileHudDecodeFailureReason | 'read-failure';
  droppedPlacementIds: readonly string[];
  ignoredSurfaceIds: readonly string[];
}

function defaultDocument(registry: MobileHudRegistry): MobileHudLayoutDocumentV1 {
  return {
    schemaVersion: MOBILE_HUD_LAYOUT_SCHEMA_VERSION,
    enabled: false,
    profiles: {
      phone: mergeMobileHudPlacementDefaults(registry, 'phone'),
      tablet: mergeMobileHudPlacementDefaults(registry, 'tablet'),
    },
  };
}

export async function loadMobileHudLayout(
  options: LoadMobileHudLayoutOptions,
): Promise<LoadMobileHudLayoutResult> {
  let sourceSerialized: string | null;
  try {
    sourceSerialized = await options.storage.load();
  } catch {
    return {
      document: defaultDocument(options.registry),
      profileFallbacks: [],
      sourceSerialized: null,
      decodeFailure: 'read-failure',
      droppedPlacementIds: [],
      ignoredSurfaceIds: [],
    };
  }
  if (sourceSerialized === null) {
    return {
      document: defaultDocument(options.registry),
      profileFallbacks: [],
      sourceSerialized,
      droppedPlacementIds: [],
      ignoredSurfaceIds: [],
    };
  }
  const decoded = decodeMobileHudLayoutV1(sourceSerialized, options.registry);
  if (!decoded.ok) {
    return {
      document: defaultDocument(options.registry),
      profileFallbacks: [],
      sourceSerialized,
      decodeFailure: decoded.reason,
      droppedPlacementIds: [],
      ignoredSurfaceIds: [],
    };
  }

  const profiles: MobileHudLayoutDocumentV1['profiles'] = {};
  const profileFallbacks: MobileHudProfileId[] = [];
  for (const profileId of MOBILE_HUD_PROFILE_IDS) {
    const merged = mergeMobileHudPlacementDefaults(
      options.registry,
      profileId,
      decoded.document.profiles[profileId],
    );
    const failures = validateMobileHudLayoutMatrix({
      registry: options.registry,
      profiles: { [profileId]: merged },
      baselineProfiles: options.registry.defaults,
      matrix: options.matrix,
      isSurfaceAvailable: options.isSurfaceAvailable,
    });
    if (failures.length > 0) {
      profileFallbacks.push(profileId);
      profiles[profileId] = mergeMobileHudPlacementDefaults(options.registry, profileId);
    } else {
      profiles[profileId] = merged;
    }
  }
  return {
    document: {
      schemaVersion: MOBILE_HUD_LAYOUT_SCHEMA_VERSION,
      enabled: decoded.document.enabled,
      profiles,
    },
    profileFallbacks: Object.freeze(profileFallbacks),
    sourceSerialized,
    droppedPlacementIds: decoded.droppedPlacementIds,
    ignoredSurfaceIds: decoded.ignoredSurfaceIds,
  };
}

export interface SaveMobileHudLayoutOptions {
  storage: MobileHudLayoutStorage;
  registry: MobileHudRegistry;
  matrix?: ValidateMobileHudLayoutMatrixOptions['matrix'];
  document: MobileHudLayoutDocumentV1;
  isSurfaceAvailable?: ValidateMobileHudLayoutMatrixOptions['isSurfaceAvailable'];
}

export type SaveMobileHudLayoutResult =
  | { ok: true; document: MobileHudLayoutDocumentV1; serialized: string }
  | {
      ok: false;
      reason: 'invalid-layout';
      failures: ReturnType<typeof validateMobileHudLayoutMatrix>;
    }
  | { ok: false; reason: 'write-failure' };

export async function saveMobileHudLayout(
  options: SaveMobileHudLayoutOptions,
): Promise<SaveMobileHudLayoutResult> {
  const failures = validateMobileHudLayoutMatrix({
    registry: options.registry,
    profiles: options.document.profiles,
    baselineProfiles: options.registry.defaults,
    matrix: options.matrix,
    isSurfaceAvailable: options.isSurfaceAvailable,
  });
  if (failures.length > 0) return { ok: false, reason: 'invalid-layout', failures };
  const activated: MobileHudLayoutDocumentV1 = {
    ...options.document,
    enabled: true,
    profiles: {
      ...options.document.profiles,
      phone: options.document.profiles.phone ? { ...options.document.profiles.phone } : undefined,
      tablet: options.document.profiles.tablet
        ? { ...options.document.profiles.tablet }
        : undefined,
    },
  };
  const serialized = encodeMobileHudLayoutV1(activated, options.registry);
  try {
    await options.storage.save(serialized);
  } catch {
    return { ok: false, reason: 'write-failure' };
  }
  return { ok: true, document: activated, serialized };
}
