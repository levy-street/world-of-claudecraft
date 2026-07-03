import { describe, expect, it } from 'vitest';
import { editorErrorKey } from '../src/editor/server_errors_core';
import { en } from '../src/ui/i18n.catalog';

// The wire error contract: every stable snake_case code the maps + user-assets
// routes can emit (server/maps.ts MapsErrorCode, server/user_assets.ts
// UserAssetsErrorCode, plus the route-level bodies in server/main.ts) resolves
// to a real editor.serverError.* catalog key.

const WIRE_CODES = [
  // MapsErrorCode
  'invalid_map_name',
  'map_name_not_allowed',
  'invalid_map_doc',
  'invalid_version',
  'map_limit_reached',
  'map_not_found',
  'version_conflict',
  'slug_unavailable',
  // UserAssetsErrorCode
  'invalid_glb',
  'asset_blocked',
  'asset_limit_reached',
  'asset_storage_limit_reached',
  // Route-level bodies (server/main.ts)
  'map_too_large',
  'asset_too_large',
  'asset_not_found',
  'rate_limited',
];

function catalogHas(key: string): boolean {
  let node: unknown = en;
  for (const part of key.split('.')) {
    if (!node || typeof node !== 'object') return false;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === 'string';
}

describe('editor server-error mapping', () => {
  it('maps every known wire code to its own catalog key', () => {
    for (const code of WIRE_CODES) {
      const key = editorErrorKey(code, 400);
      expect(key, code).toBe(`editor.serverError.${code}`);
      expect(catalogHas(key), `catalog missing ${key}`).toBe(true);
    }
  });

  it('maps a 401 to the session-expired message regardless of body', () => {
    expect(editorErrorKey('map_not_found', 401)).toBe('editor.serverError.unauthorized');
    expect(editorErrorKey(null, 401)).toBe('editor.serverError.unauthorized');
    expect(catalogHas('editor.serverError.unauthorized')).toBe(true);
  });

  it('maps a transport failure (no response) to the network message', () => {
    expect(editorErrorKey(null)).toBe('editor.serverError.network');
    expect(editorErrorKey(null, 0)).toBe('editor.serverError.network');
    expect(catalogHas('editor.serverError.network')).toBe(true);
  });

  it('collapses unknown and legacy codes safely', () => {
    expect(editorErrorKey('bad_json', 400)).toBe('editor.serverError.unknown');
    expect(editorErrorKey('bad_request', 400)).toBe('editor.serverError.unknown');
    expect(editorErrorKey('internal error', 500)).toBe('editor.serverError.unknown');
    expect(editorErrorKey('something_new_from_the_future', 400)).toBe('editor.serverError.unknown');
    // The legacy free-text throttle body still reads as a rate limit.
    expect(editorErrorKey('rate limited', 429)).toBe('editor.serverError.rate_limited');
    expect(catalogHas('editor.serverError.unknown')).toBe(true);
  });
});
