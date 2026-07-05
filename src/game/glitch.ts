// Optional Glitch platform integration: install validation, Aegis heartbeat,
// progression submission helpers, and cloud-save slot 0 for Glitch-launched play.

export const GLITCH_API_BASE_URL = 'https://api.glitch.fun/api';
export const GLITCH_TITLE_ID = '8254e0f9-6c3a-4c94-8a16-570157b9df3b';

const INSTALL_ID_KEY = 'woc_glitch_install_id';
const DEVICE_ID_KEY = 'woc_glitch_device_id';
const SLOT_ZERO_VERSION_KEY = 'woc_glitch_save_slot_0_version';
const HEARTBEAT_MS = 60_000;
const AUTOSAVE_MS = 30_000;

export type GlitchFetch = typeof fetch;

export interface GlitchStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

export interface GlitchConfig {
  enabled: boolean;
  apiBaseUrl: string;
  titleId: string;
  titleToken: string;
  gameVersion: string;
}

export interface GlitchSession {
  installId: string;
  deviceId: string;
  userName: string;
  licenseType: string | null;
  serverTime: string | null;
  launchedByGlitch: boolean;
  apiBaseUrl: string;
  titleId: string;
  titleToken: string;
  gameVersion: string;
}

export interface GlitchInstallValidation {
  valid: boolean;
  userName: string | null;
  licenseType: string | null;
  serverTime: string | null;
  reason: string | null;
}

export interface GlitchCloudSave<State> {
  saveId: string;
  slotIndex: number;
  version: number;
  characterClass: string | null;
  state: State | null;
}

export interface GlitchConflict {
  status: 'conflict';
  conflict_id: string;
  save_id?: string;
  server_version?: number;
  client_version?: number;
  your_base_version?: number;
  message?: string;
}

export type GlitchSaveResult =
  | { status: 'saved'; version: number; saveId: string | null }
  | { status: 'conflict'; conflict: GlitchConflict }
  | { status: 'unavailable'; reason: string };

export interface ProgressionPayload {
  scores?: Record<string, number>;
  stats?: Record<string, number>;
}

export interface ProgressionRunBody {
  idempotency_key: string;
  payload: ProgressionPayload;
  trust_level?: 'unverified' | 'verified';
  platform?: string;
}

export interface GlitchBehaviorEventBody {
  step_key: string;
  action_key: string;
  metadata?: Record<string, unknown>;
  event_timestamp?: string;
}

export class GlitchApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly data: unknown,
  ) {
    super(message);
    this.name = 'GlitchApiError';
  }
}

export function readGlitchConfig(env: Record<string, unknown>, gameVersion: string): GlitchConfig {
  const enabled = String(env.VITE_GLITCH_ENABLED ?? '') === '1';
  const titleToken = String(env.VITE_GLITCH_TITLE_TOKEN ?? '').trim();
  const titleId = String(env.VITE_GLITCH_TITLE_ID ?? GLITCH_TITLE_ID).trim() || GLITCH_TITLE_ID;
  const apiBaseUrl =
    String(env.VITE_GLITCH_API_BASE_URL ?? GLITCH_API_BASE_URL).trim() || GLITCH_API_BASE_URL;
  return {
    enabled: enabled && titleToken.length > 0,
    apiBaseUrl: stripTrailingSlash(apiBaseUrl),
    titleId,
    titleToken,
    gameVersion,
  };
}

export function parseGlitchLaunchInstallId(search: string): string | null {
  const value = new URLSearchParams(search).get('install_id')?.trim() ?? '';
  return isUuid(value) ? value : null;
}

export function safeGlitchUserName(value: unknown): string {
  const raw = typeof value === 'string' ? value : '';
  const printable = Array.from(raw)
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code >= 32 && code !== 127;
    })
    .join('');
  const compact = printable.replace(/\s+/g, ' ').trim();
  if (!compact) return 'Guest Player';
  return Array.from(compact).slice(0, 48).join('');
}

export function readGlitchDefaultClass(
  env: Record<string, unknown>,
  allowedClasses: readonly string[],
): string {
  const raw = String(env.VITE_GLITCH_DEFAULT_CLASS ?? 'warrior')
    .trim()
    .toLowerCase();
  return allowedClasses.includes(raw) ? raw : 'warrior';
}

export async function bootstrapGlitchSession(opts: {
  config: GlitchConfig;
  storage: GlitchStorage | null;
  search: string;
  fetchImpl?: GlitchFetch;
  randomUUID?: () => string;
}): Promise<GlitchSession | null> {
  const { config, storage } = opts;
  if (!config.enabled || !storage) return null;

  const fetchImpl = opts.fetchImpl ?? fetch;
  const deviceId = readOrCreateDeviceId(storage, opts.randomUUID);
  const launchInstallId = parseGlitchLaunchInstallId(opts.search);
  const storedInstallId = readStorage(storage, INSTALL_ID_KEY);
  const installId = launchInstallId ?? (isUuid(storedInstallId) ? storedInstallId : null);
  let validation: GlitchInstallValidation | null = null;
  let resolvedInstallId = installId;
  let createUserName: string | null = null;

  if (resolvedInstallId) {
    try {
      validation = await validateInstall(config, resolvedInstallId, fetchImpl);
    } catch (err) {
      if (!(err instanceof GlitchApiError && err.status === 404)) throw err;
      validation = {
        valid: false,
        userName: null,
        licenseType: null,
        serverTime: null,
        reason: 'INSTALL_NOT_FOUND',
      };
    }
    if (!validation.valid && validation.reason === 'INSTALL_NOT_FOUND') {
      const created = await createInstall(config, deviceId, fetchImpl, resolvedInstallId);
      resolvedInstallId = created.id;
      createUserName = created.userName;
      validation = await validateInstall(config, resolvedInstallId, fetchImpl);
    }
  } else {
    const created = await createInstall(config, deviceId, fetchImpl, null);
    resolvedInstallId = created.id;
    createUserName = created.userName;
    validation = await validateInstall(config, resolvedInstallId, fetchImpl);
  }

  if (!resolvedInstallId || !validation?.valid) {
    throw new GlitchApiError(
      validation?.reason ?? 'Glitch install validation failed.',
      validation?.reason === 'INSTALL_NOT_FOUND' ? 404 : 403,
      validation,
    );
  }

  writeStorage(storage, INSTALL_ID_KEY, resolvedInstallId);
  return {
    installId: resolvedInstallId,
    deviceId,
    userName: safeGlitchUserName(validation.userName ?? createUserName),
    licenseType: validation.licenseType,
    serverTime: validation.serverTime,
    launchedByGlitch: launchInstallId !== null,
    apiBaseUrl: config.apiBaseUrl,
    titleId: config.titleId,
    titleToken: config.titleToken,
    gameVersion: config.gameVersion,
  };
}

export function startGlitchInstallHeartbeat(opts: {
  session: GlitchSession;
  fetchImpl?: GlitchFetch;
  setIntervalImpl?: typeof window.setInterval;
  clearIntervalImpl?: typeof window.clearInterval;
}): () => void {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const setIntervalImpl = opts.setIntervalImpl ?? window.setInterval.bind(window);
  const clearIntervalImpl = opts.clearIntervalImpl ?? window.clearInterval.bind(window);
  let stopped = false;

  const beat = () => {
    void createInstall(
      opts.session,
      opts.session.deviceId,
      fetchImpl,
      opts.session.installId,
    ).catch(() => {
      // Heartbeat failures are non-fatal to the local session; the next beat retries.
    });
  };
  beat();
  const id = setIntervalImpl(beat, HEARTBEAT_MS);
  return () => {
    if (stopped) return;
    stopped = true;
    clearIntervalImpl(id);
  };
}

export async function submitGlitchProgressionRun(
  session: GlitchSession,
  body: ProgressionRunBody,
  fetchImpl: GlitchFetch = fetch,
): Promise<unknown> {
  try {
    return await glitchRequest(
      session,
      `/titles/${session.titleId}/installs/${session.installId}/submit`,
      { method: 'POST', body },
      fetchImpl,
    );
  } catch (err) {
    if (err instanceof GlitchApiError && err.status === 409) return err.data;
    throw err;
  }
}

export async function readGlitchLeaderboard(
  session: GlitchSession,
  apiKey: string,
  opts: { aroundMe?: boolean; seasonId?: string } = {},
  fetchImpl: GlitchFetch = fetch,
): Promise<unknown> {
  const query = new URLSearchParams();
  if (opts.aroundMe) {
    query.set('around_me', 'true');
    query.set('install_id', session.installId);
  }
  if (opts.seasonId) query.set('season_id', opts.seasonId);
  const suffix = query.size > 0 ? `?${query.toString()}` : '';
  return glitchRequest(
    session,
    `/titles/${session.titleId}/leaderboards/${encodeURIComponent(apiKey)}${suffix}`,
    { method: 'GET' },
    fetchImpl,
  );
}

export async function readGlitchAchievements(
  session: GlitchSession,
  fetchImpl: GlitchFetch = fetch,
): Promise<unknown> {
  return glitchRequest(
    session,
    `/titles/${session.titleId}/installs/${session.installId}/achievements`,
    { method: 'GET' },
    fetchImpl,
  );
}

export async function readGlitchStats(
  session: GlitchSession,
  fetchImpl: GlitchFetch = fetch,
): Promise<unknown> {
  return glitchRequest(
    session,
    `/titles/${session.titleId}/installs/${session.installId}/stats`,
    { method: 'GET' },
    fetchImpl,
  );
}

export async function sendGlitchBehaviorEvent(
  session: GlitchSession,
  event: GlitchBehaviorEventBody,
  fetchImpl: GlitchFetch = fetch,
): Promise<unknown> {
  return glitchRequest(
    session,
    `/titles/${session.titleId}/events`,
    {
      method: 'POST',
      body: {
        game_install_id: session.installId,
        step_key: event.step_key,
        action_key: event.action_key,
        ...(event.metadata === undefined ? {} : { metadata: event.metadata }),
        ...(event.event_timestamp === undefined ? {} : { event_timestamp: event.event_timestamp }),
      },
    },
    fetchImpl,
  );
}

export async function loadGlitchCharacterSave<State>(
  session: GlitchSession,
  fetchImpl: GlitchFetch = fetch,
): Promise<GlitchCloudSave<State> | null> {
  const data = await glitchRequest(
    session,
    `/titles/${session.titleId}/installs/${session.installId}/saves`,
    { method: 'GET' },
    fetchImpl,
  );
  const saves = Array.isArray(data)
    ? data
    : Array.isArray((data as { data?: unknown }).data)
      ? (data as { data: unknown[] }).data
      : [];
  const slot = saves.find((item) => {
    const save = item as { slot_index?: unknown };
    return save.slot_index === 0;
  }) as Record<string, unknown> | undefined;
  if (!slot) return null;

  const payload = typeof slot.payload === 'string' ? slot.payload : '';
  const parsed = payload ? parseCharacterSavePayload<State>(payload) : null;
  return {
    saveId: typeof slot.id === 'string' ? slot.id : '',
    slotIndex: 0,
    version: typeof slot.version === 'number' ? slot.version : 0,
    characterClass:
      parsed?.characterClass ??
      (slot.metadata &&
      typeof slot.metadata === 'object' &&
      typeof (slot.metadata as Record<string, unknown>).character_class === 'string'
        ? String((slot.metadata as Record<string, unknown>).character_class)
        : null),
    state: parsed?.state ?? null,
  };
}

export async function storeGlitchCharacterSave<State>(opts: {
  session: GlitchSession;
  storage: GlitchStorage | null;
  characterClass: string;
  state: State;
  baseVersion?: number;
  fetchImpl?: GlitchFetch;
  now?: () => Date;
}): Promise<GlitchSaveResult> {
  const { session, storage } = opts;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const timestamp = (opts.now ?? (() => new Date()))().toISOString();
  const raw = JSON.stringify({
    schema_version: 1,
    character_class: opts.characterClass,
    character_state: opts.state,
    saved_at: timestamp,
  });
  const bytes = new TextEncoder().encode(raw);
  const payload = bytesToBase64(bytes);
  const checksum = await sha256Hex(bytes);
  const storedBase = Number(readStorage(storage, SLOT_ZERO_VERSION_KEY) ?? 0);
  const baseVersion = opts.baseVersion ?? (Number.isFinite(storedBase) ? storedBase : 0);

  try {
    const data = await glitchRequest(
      session,
      `/titles/${session.titleId}/installs/${session.installId}/saves`,
      {
        method: 'POST',
        body: {
          slot_index: 0,
          payload,
          checksum,
          save_type: 'auto',
          client_timestamp: timestamp,
          base_version: baseVersion,
          slot_name: 'World of ClaudeCraft',
          metadata: { character_class: opts.characterClass },
          device_id: session.deviceId,
          platform: 'web',
          game_version: session.gameVersion,
          last_played_at: timestamp,
        },
      },
      fetchImpl,
    );
    const saved = unwrapData(data) as Record<string, unknown>;
    const version = typeof saved.version === 'number' ? saved.version : baseVersion;
    writeStorage(storage, SLOT_ZERO_VERSION_KEY, String(version));
    return {
      status: 'saved',
      version,
      saveId: typeof saved.id === 'string' ? saved.id : null,
    };
  } catch (err) {
    if (err instanceof GlitchApiError && err.status === 409) {
      return { status: 'conflict', conflict: err.data as GlitchConflict };
    }
    if (err instanceof GlitchApiError && err.status === 403) {
      return { status: 'unavailable', reason: readErrorCode(err.data) ?? 'GUEST_NOT_ALLOWED' };
    }
    throw err;
  }
}

export function startGlitchCharacterAutosave<State>(opts: {
  session: GlitchSession;
  storage: GlitchStorage | null;
  characterClass: string;
  stateProvider: () => State | null;
  baseVersion?: number;
  fetchImpl?: GlitchFetch;
  setIntervalImpl?: typeof window.setInterval;
  clearIntervalImpl?: typeof window.clearInterval;
  onConflict?: (conflict: GlitchConflict) => void;
  onUnavailable?: (reason: string) => void;
}): () => void {
  const setIntervalImpl = opts.setIntervalImpl ?? window.setInterval.bind(window);
  const clearIntervalImpl = opts.clearIntervalImpl ?? window.clearInterval.bind(window);
  let stopped = false;
  let saving = false;
  let baseVersion = opts.baseVersion;

  const save = async () => {
    if (stopped || saving) return;
    const state = opts.stateProvider();
    if (!state) return;
    saving = true;
    try {
      const result = await storeGlitchCharacterSave({
        session: opts.session,
        storage: opts.storage,
        characterClass: opts.characterClass,
        state,
        baseVersion,
        fetchImpl: opts.fetchImpl,
      });
      if (result.status === 'saved') {
        baseVersion = result.version;
      } else if (result.status === 'conflict') {
        opts.onConflict?.(result.conflict);
        stop();
      } else if (result.status === 'unavailable') {
        opts.onUnavailable?.(result.reason);
        stop();
      }
    } finally {
      saving = false;
    }
  };

  const id = setIntervalImpl(() => void save(), AUTOSAVE_MS);
  const stop = () => {
    if (stopped) return;
    stopped = true;
    clearIntervalImpl(id);
  };
  void save();
  return stop;
}

async function validateInstall(
  config: Pick<GlitchConfig, 'apiBaseUrl' | 'titleId' | 'titleToken'>,
  installId: string,
  fetchImpl: GlitchFetch,
): Promise<GlitchInstallValidation> {
  const data = await glitchRequest(
    config,
    `/titles/${config.titleId}/installs/${installId}/validate`,
    { method: 'POST' },
    fetchImpl,
  );
  const src = unwrapData(data) as Record<string, unknown>;
  return {
    valid: src.valid === true,
    userName: typeof src.user_name === 'string' ? src.user_name : null,
    licenseType: typeof src.license_type === 'string' ? src.license_type : null,
    serverTime: typeof src.server_time === 'string' ? src.server_time : null,
    reason: typeof src.reason === 'string' ? src.reason : null,
  };
}

async function createInstall(
  config: Pick<GlitchConfig, 'apiBaseUrl' | 'titleId' | 'titleToken' | 'gameVersion'>,
  deviceId: string,
  fetchImpl: GlitchFetch,
  userInstallId: string | null,
): Promise<{ id: string; userName: string | null }> {
  const body: Record<string, unknown> = userInstallId
    ? {
        user_install_id: userInstallId,
        platform: 'web',
        device_type: 'desktop',
        operating_system: 'browser',
        game_version: config.gameVersion,
        referral_source: 'other',
      }
    : {
        device_id: deviceId,
        platform: 'web',
        version: config.gameVersion,
      };
  const data = await glitchRequest(
    config,
    `/titles/${config.titleId}/installs`,
    { method: 'POST', body },
    fetchImpl,
  );
  const src = unwrapData(data) as Record<string, unknown>;
  const id = typeof src.id === 'string' ? src.id : '';
  if (!isUuid(id))
    throw new GlitchApiError('Glitch create install did not return an id.', 500, data);
  return {
    id,
    userName: typeof src.user_name === 'string' ? src.user_name : null,
  };
}

async function glitchRequest(
  config: Pick<GlitchConfig, 'apiBaseUrl' | 'titleToken'>,
  path: string,
  opts: { method: 'GET' | 'POST'; body?: unknown },
  fetchImpl: GlitchFetch,
): Promise<unknown> {
  const response = await fetchImpl(`${config.apiBaseUrl}${path}`, {
    method: opts.method,
    headers: {
      Authorization: `Bearer ${config.titleToken}`,
      ...(opts.body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new GlitchApiError(
      readErrorCode(data) ?? `Glitch request failed (${response.status})`,
      response.status,
      data,
    );
  }
  return data;
}

function parseCharacterSavePayload<State>(
  payload: string,
): { characterClass: string | null; state: State | null } | null {
  try {
    const raw = new TextDecoder().decode(base64ToBytes(payload));
    const data = JSON.parse(raw) as Record<string, unknown>;
    if (
      data.schema_version === 1 &&
      data.character_state &&
      typeof data.character_state === 'object'
    ) {
      return {
        characterClass: typeof data.character_class === 'string' ? data.character_class : null,
        state: data.character_state as State,
      };
    }
    return { characterClass: null, state: data as State };
  } catch {
    return null;
  }
}

function readOrCreateDeviceId(storage: GlitchStorage, randomUUID?: () => string): string {
  const existing = readStorage(storage, DEVICE_ID_KEY);
  if (existing) return existing;
  const id =
    randomUUID?.() ??
    globalThis.crypto?.randomUUID?.() ??
    `device-${Date.now().toString(36)}-${Math.floor(Math.random() * 1_000_000).toString(36)}`;
  writeStorage(storage, DEVICE_ID_KEY, id);
  return id;
}

function readStorage(storage: GlitchStorage | null, key: string): string | null {
  if (!storage) return null;
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(storage: GlitchStorage | null, key: string, value: string): void {
  if (!storage) return;
  try {
    storage.setItem(key, value);
  } catch {
    /* storage unavailable */
  }
}

function unwrapData(value: unknown): unknown {
  return value && typeof value === 'object' && 'data' in value
    ? (value as { data: unknown }).data
    : value;
}

function readErrorCode(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const src = value as Record<string, unknown>;
  if (typeof src.code === 'string') return src.code;
  if (typeof src.reason === 'string') return src.reason;
  if (typeof src.error === 'string') return src.error;
  if (typeof src.message === 'string') return src.message;
  return null;
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

function isUuid(value: string | null): value is string {
  return (
    !!value &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  );
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const input = new Uint8Array(bytes.length);
  input.set(bytes);
  const hash = await crypto.subtle.digest('SHA-256', input.buffer);
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
