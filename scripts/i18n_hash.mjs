// Content-hash helpers for the i18n status registry.
//
// Side-effect-free shared module (the same role i18n_flatten.mjs plays for the
// build): imported by scripts/i18n_scan.mjs to build the registry and by
// tests/i18n_status_registry.test.ts to assert the hash is sensitive to the
// English source AND its placeholder set. Importing this file runs NOTHING - it
// only exports pure functions, so a test can import it without triggering a
// registry regeneration.
//
// The hash answers one question: "has the English source for this key changed
// since a translation was recorded?" A translation is stale (and so its target
// locale falls back to English) when the English text OR its placeholder set
// drifts. Both must therefore feed the hash - hashing the text alone would miss a
// placeholder rename like "{name}" -> "{playerName}" that silently breaks every
// translation's interpolation (the M1c placeholder-parity guard). The placeholder
// set is sorted so it is order-independent, matching how the localization tests
// compare placeholders.
//
// Zero external deps: node:crypto's sha256 is built in and deterministic.

import { createHash } from 'node:crypto';

// U+001F (unit separator): a control char that never appears in player copy, so
// it cannot collide with text or a placeholder name and make two distinct inputs
// hash the same.
const SEP = String.fromCharCode(0x1f);

// The one regex that captures a placeholder, the `{name}` form. Identical to the
// `ph` helper in tests/localization_fixes.test.ts so the registry and the tests
// agree on what a placeholder is.
export const PLACEHOLDER_RE = /\{([A-Za-z0-9_]+)\}/g;

// Sorted, de-duplicated placeholder names in a string, e.g.
// "{name} hit {name} for {amount}" -> ["amount", "name"].
export function placeholdersOf(text) {
  const set = new Set();
  for (const m of String(text).matchAll(PLACEHOLDER_RE)) set.add(m[1]);
  return [...set].sort();
}

// Deterministic short hash of an English source string plus its sorted
// placeholder set. Truncated to 16 hex chars (64 bits) - ample to detect a
// content change without bloating the registry. Pass the placeholder array
// explicitly so callers that already computed it do not recompute; it is sorted
// here regardless so the hash is order-independent.
export function contentHash(text, placeholders = placeholdersOf(text)) {
  const canonical = `${String(text)}${SEP}${[...placeholders].sort().join(SEP)}`;
  return createHash('sha256').update(canonical, 'utf8').digest('hex').slice(0, 16);
}
