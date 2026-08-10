// Per-key interpolation plans plus a last-call memo for the t() hot path
// (hitch-elimination B3). Hot HUD, aura, and nameplate painters resolve the
// SAME (key, params) every frame; the old shape re-split the dotted key,
// re-ran the {slot} regex, and allocated a fresh replacer closure and result
// string per call. This module holds the pure pieces:
//   - compileInterpolationPlan splits a template into static chunks and slot
//     names ONCE (the only regex work, paid once per key per locale epoch);
//   - interpolateWithMemo serves a repeat of the same slot values from the
//     entry's single-slot memo with zero allocation (the compare is === over
//     the plan's own slot list; InterpolationValue is string | number, so
//     === is exact), and otherwise rebuilds by plain concatenation, storing
//     the values into a REUSED snapshot array (mutate-in-place is the cache
//     idiom here, mirroring the painter-host elision entries).
// Output is byte-identical to the legacy single-pass regex replace: an
// undefined slot value keeps its literal `{name}` token, values never re-scan
// (single left-to-right pass), and extra params are ignored.
// The OWNING cache in i18n.ts is epoch-guarded by the resolution revision
// (getI18nRevision), so a locale switch (setLanguage) or a late locale chunk
// (ensureLocaleLoaded) drops every entry; nothing here outlives a revision.
// This module is pure and host-agnostic: no DOM, no browser globals, no
// clock, no randomness. Type-only import below, so nothing of the catalog
// lands in the bundle through it.

import type { InterpolationValue, InterpolationValues } from './i18n.catalog';

export interface InterpolationPlan {
  /** The n+1 static chunks around the n slots (may be empty strings). */
  statics: string[];
  /** The n slot names in template order; duplicates are kept as-is. */
  names: string[];
  /** The raw `{name}` token per slot (the undefined-value fallback text). */
  tokens: string[];
}

export interface InterpolationMemoEntry {
  /** The resolved leaf template this entry serves (fixed for the entry's lifetime). */
  template: string;
  /** undefined = not compiled yet (lazy); null = the template has no slots. */
  plan?: InterpolationPlan | null;
  /** Slot values of the last interpolation, aligned with plan.names (reused array). */
  lastValues?: (InterpolationValue | undefined)[];
  /** The interpolated result matching lastValues. */
  lastResult?: string;
}

// Same slot grammar as the legacy interpolate() replace: {A-Za-z0-9_ runs}.
const SLOT_RE = /\{([A-Za-z0-9_]+)\}/g;

/** Split a template into its interpolation plan, or null when it has no slots. */
export function compileInterpolationPlan(template: string): InterpolationPlan | null {
  SLOT_RE.lastIndex = 0;
  let match = SLOT_RE.exec(template);
  if (!match) return null;
  const statics: string[] = [];
  const names: string[] = [];
  const tokens: string[] = [];
  let cursor = 0;
  while (match) {
    statics.push(template.slice(cursor, match.index));
    names.push(match[1]);
    tokens.push(match[0]);
    cursor = match.index + match[0].length;
    match = SLOT_RE.exec(template);
  }
  statics.push(template.slice(cursor));
  return { statics, names, tokens };
}

/**
 * Interpolate `values` into the entry's template, memoized on the last call.
 * A repeat with the same slot values (shallow === over the plan's names, so
 * params-object identity never matters) returns the stored result with zero
 * allocation and zero string composition; a change rebuilds and re-latches.
 */
export function interpolateWithMemo(
  entry: InterpolationMemoEntry,
  values: InterpolationValues,
): string {
  if (entry.plan === undefined) entry.plan = compileInterpolationPlan(entry.template);
  const plan = entry.plan;
  if (plan === null) return entry.template;
  const names = plan.names;
  const last = entry.lastValues;
  if (last !== undefined && entry.lastResult !== undefined) {
    let unchanged = true;
    for (let i = 0; i < names.length; i++) {
      if (values[names[i]] !== last[i]) {
        unchanged = false;
        break;
      }
    }
    if (unchanged) return entry.lastResult;
  }
  let snapshot = last;
  if (snapshot === undefined) {
    snapshot = new Array(names.length);
    entry.lastValues = snapshot;
  }
  let out = plan.statics[0];
  for (let i = 0; i < names.length; i++) {
    const value = values[names[i]];
    snapshot[i] = value;
    out += value === undefined ? plan.tokens[i] : typeof value === 'string' ? value : String(value);
    out += plan.statics[i + 1];
  }
  entry.lastResult = out;
  return out;
}
