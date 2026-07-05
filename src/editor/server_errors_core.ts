// Server error-code -> translation-key mapping for the map editor. The server
// speaks stable snake_case codes ({ error: 'version_conflict' }, see
// server/maps.ts + server/user_assets.ts); the client owns the human copy, so
// this pure table is the single place route drift or a new code lands. DOM- and
// i18n-runtime-free: it returns keys, the DOM layer renders them through t().

import type { TranslationKey } from '../ui/i18n.catalog';

const KNOWN_CODES = [
  'invalid_map_name',
  'map_name_not_allowed',
  'invalid_map_doc',
  'invalid_version',
  'map_limit_reached',
  'map_not_found',
  'version_conflict',
  'slug_unavailable',
  'map_too_large',
  'invalid_glb',
  'asset_blocked',
  'asset_limit_reached',
  'asset_storage_limit_reached',
  'asset_too_large',
  'asset_not_found',
  'rate_limited',
] as const;

type KnownCode = (typeof KNOWN_CODES)[number];

const KNOWN = new Set<string>(KNOWN_CODES);

/**
 * The editor.serverError.* key for a wire error code. Unknown codes (including
 * bad_json / bad_request and free-text legacy errors) collapse to `unknown`;
 * an auth failure (HTTP 401, whatever the body) maps to `unauthorized`; a
 * transport failure (no response at all) maps to `network`.
 */
export function editorErrorKey(code: string | null, status?: number): TranslationKey {
  if (status === 401) return 'editor.serverError.unauthorized';
  if (code === null) return 'editor.serverError.network';
  // Client-side abort of a stalled request (net.ts CALL_TIMEOUT_MS), not a
  // server wire code.
  if (code === 'timeout') return 'editor.serverError.timeout';
  if (KNOWN.has(code)) return `editor.serverError.${code as KnownCode}`;
  // 'rate limited' (with a space) is the legacy free-text throttle body.
  if (code === 'rate limited') return 'editor.serverError.rate_limited';
  return 'editor.serverError.unknown';
}
