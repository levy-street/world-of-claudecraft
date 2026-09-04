/**
 * Trim a possibly-null string and cap it at `max` characters, or null when the
 * result is empty. Used for the request-metadata columns (ip, userAgent).
 *
 * Extracted from server/db.ts so the market sold-volume schema wiring
 * (qr-19-sold-volume-four-seam-wiring, Phase 19) could land without growing the
 * db.ts monolith; a pure sibling with no pg dependency of its own.
 */
export function cleanMetadataText(value: string | null | undefined, max: number): string | null {
  const text = typeof value === 'string' ? value.trim() : '';
  return text ? text.slice(0, max) : null;
}
