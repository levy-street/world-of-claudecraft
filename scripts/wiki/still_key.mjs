// Single source of truth for a Guide model still's identity, shared by the content
// generator (build_content.mjs, which bakes the still URL onto each figure) and the
// still renderer (render_model_stills.mjs, which writes the file). Keeping the key in one
// JS module means the baked path and the rendered filename can never drift.
//
// A still is keyed by (model visual key, tint, tint strength), because many creatures share
// one rig but differ only by tint, and the viewer bakes tint into the body materials (a
// partial lerp that CSS cannot reproduce). One image per distinct (model, tint, tintStrength)
// combination, deduped.

// Must match the manifest fallback a VisualDef without an explicit tintStrength resolves to
// (src/render/characters/manifest.ts VisualDef.tintStrength, mirrored in build_content.mjs
// modelKeyFor and read by src/guide/viewer/model.ts). Kept in sync by hand: the two call
// sites are few and both point back at this comment.
const DEFAULT_TINT_STRENGTH = 0.4;

/**
 * Stable filename stem for a figure's still, e.g. "mob_wolf__7f8c8d" or "player_mage".
 * `tintStrength` only changes the key when it is defined AND differs from the manifest
 * default, so untouched figures keep their existing filename (no churn), while a
 * strength-only content change (tint unchanged) mints a new key: the old committed WebP
 * becomes an orphan and the new one is missing, so tests/guide.test.ts fails until both are
 * fixed by regenerating (the whole point: a strength-only change can no longer hide).
 */
export function stillKey(model, tintHex, tintStrength) {
  const tint = tintHex ? `__${String(tintHex).replace(/^#/, '').toLowerCase()}` : '';
  const strength =
    tintStrength !== undefined && tintStrength !== DEFAULT_TINT_STRENGTH
      ? `__s${Math.round(tintStrength * 100)}`
      : '';
  return `${model}${tint}${strength}`;
}

// Served from a top-level /guide-stills/ path (NOT under /wiki): the dev server proxies
// /wiki* to the legacy wiki container and the guide SPA owns /wiki/* routes, so a sibling
// path keeps these plain static images out of both in dev and prod.
export const STILLS_DIR = 'guide-stills';

/** Public URL the Guide serves the still from (committed under public/guide-stills/). */
export function stillUrl(model, tintHex, tintStrength) {
  if (!model) return null;
  return `/${STILLS_DIR}/${stillKey(model, tintHex, tintStrength)}.webp`;
}
