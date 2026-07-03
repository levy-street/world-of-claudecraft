// The editor's ONLY fetch surface: every server call for maps + uploaded assets
// lives here so a route drift is a one-file fix. Auth reuses the game client's
// stored bearer session (localStorage 'woc_session', written by src/net/online.ts
// saveSession); with no token the editor runs fully offline and the UI shows the
// sign-in hint instead of calling these.
//
// Wire contract (server/main.ts + server/maps.ts + server/user_assets.ts):
//   GET    /api/maps                     -> { maps: MapSummaryWire[] }
//   POST   /api/maps {name, doc}         -> { map: MapSummaryWire }
//   GET    /api/maps/public?page&limit   -> { rows, total, page, limit }
//   GET    /api/maps/<id>                -> { map: MapFullWire } (owner or public)
//   PUT    /api/maps/<id> {doc,version,name?} -> { map } | 409 {error, version}
//   POST   /api/maps/<id>/fork {name?}   -> { map: MapFullWire }
//   POST   /api/maps/<id>/publish|unpublish -> { ok: true }
//   DELETE /api/maps/<id>                -> { ok: true }
//   POST   /api/assets?name= (GLB bytes) -> { asset, existing }
//   GET    /api/assets/mine              -> { assets: UserAssetWire[] }
//   GET    /api/assets/<sha256>.glb      -> bytes (public)
//   DELETE /api/assets/<id>              -> { ok: true }
// Errors are stable snake_case codes ({ error: '...' }), mapped to t() keys by
// server_errors_core.ts.

import type { MapDoc } from '../sim/map_doc';

const SESSION_KEY = 'woc_session'; // mirrors src/net/online.ts Api.SESSION_KEY

export interface MapSummaryWire {
  id: number;
  name: string;
  slug: string;
  version: number;
  status: 'private' | 'public';
  parentMapId: number | null;
  forkedFromVersion: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface MapFullWire extends MapSummaryWire {
  doc: MapDoc;
}

export interface UserAssetWire {
  id: number;
  sha256: string;
  byteSize: number;
  name: string | null;
  status: 'active' | 'blocked';
  createdAt: string;
  url: string;
}

/** A server call failed with a decoded error code (null = transport failure). */
export class EditorApiError extends Error {
  constructor(
    readonly code: string | null,
    readonly status: number,
    /** The current server version on a 409 version_conflict, when supplied. */
    readonly serverVersion?: number,
  ) {
    super(`editor api error: ${code ?? 'network'} (${status})`);
  }
}

export function storedSession(): { token: string; username: string } | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as { token?: unknown; username?: unknown };
    if (typeof data.token !== 'string' || typeof data.username !== 'string') return null;
    return { token: data.token, username: data.username };
  } catch {
    return null;
  }
}

export function signedIn(): boolean {
  return storedSession() !== null;
}

/**
 * Abort a stalled request after this long, surfaced as the 'timeout' error
 * code (mapped to a t() key by server_errors_core): a hung fetch must never
 * leave the topbar stuck in "saving" and Ctrl+S swallowed forever.
 */
export const CALL_TIMEOUT_MS = 20_000;

async function call(path: string, init: RequestInit = {}): Promise<any> {
  const session = storedSession();
  const headers: Record<string, string> = {
    ...((init.headers as Record<string, string>) ?? {}),
  };
  if (session) headers.Authorization = `Bearer ${session.token}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CALL_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(path, { ...init, headers, signal: controller.signal });
  } catch {
    throw new EditorApiError(controller.signal.aborted ? 'timeout' : null, 0);
  } finally {
    clearTimeout(timer);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const code = typeof data.error === 'string' ? data.error : null;
    const version = typeof data.version === 'number' ? data.version : undefined;
    throw new EditorApiError(code, res.status, version);
  }
  return data;
}

function jsonInit(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

// ---- maps -------------------------------------------------------------------

export async function listMyMaps(): Promise<MapSummaryWire[]> {
  const data = await call('/api/maps');
  return Array.isArray(data.maps) ? data.maps : [];
}

export async function listPublicMaps(
  page: number,
): Promise<{ rows: MapSummaryWire[]; total: number; page: number; limit: number }> {
  const data = await call(`/api/maps/public?page=${page}`);
  return {
    rows: Array.isArray(data.rows) ? data.rows : [],
    total: typeof data.total === 'number' ? data.total : 0,
    page: typeof data.page === 'number' ? data.page : page,
    limit: typeof data.limit === 'number' ? data.limit : 20,
  };
}

export async function getMap(id: number): Promise<MapFullWire> {
  const data = await call(`/api/maps/${id}`);
  return data.map as MapFullWire;
}

export async function createMap(name: string, doc: MapDoc): Promise<MapSummaryWire> {
  const data = await call('/api/maps', jsonInit('POST', { name, doc }));
  return data.map as MapSummaryWire;
}

export async function updateMap(
  id: number,
  doc: MapDoc,
  version: number,
  name?: string,
): Promise<MapSummaryWire> {
  const data = await call(`/api/maps/${id}`, jsonInit('PUT', { doc, version, name }));
  return data.map as MapSummaryWire;
}

export async function forkMap(id: number, name?: string): Promise<MapFullWire> {
  const data = await call(`/api/maps/${id}/fork`, jsonInit('POST', name ? { name } : {}));
  return data.map as MapFullWire;
}

export async function setMapPublished(id: number, published: boolean): Promise<void> {
  await call(`/api/maps/${id}/${published ? 'publish' : 'unpublish'}`, jsonInit('POST', {}));
}

export async function deleteServerMap(id: number): Promise<void> {
  await call(`/api/maps/${id}`, { method: 'DELETE' });
}

// ---- uploaded assets ----------------------------------------------------------

export async function uploadAsset(
  bytes: ArrayBuffer,
  name: string,
): Promise<{ asset: UserAssetWire; existing: boolean }> {
  const data = await call(`/api/assets?name=${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'model/gltf-binary' },
    body: bytes,
  });
  return { asset: data.asset as UserAssetWire, existing: data.existing === true };
}

export async function listMyAssets(): Promise<UserAssetWire[]> {
  const data = await call('/api/assets/mine');
  return Array.isArray(data.assets) ? data.assets : [];
}

export async function deleteUserAsset(id: number): Promise<void> {
  await call(`/api/assets/${id}`, { method: 'DELETE' });
}
