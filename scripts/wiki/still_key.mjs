// Single source of truth for a Guide model still's identity, shared by the content
// generator (build_content.mjs, which bakes the still URL onto each figure) and the
// still renderer (render_model_stills.mjs, which writes the file). Keeping the key in one
// JS module means the baked path and the rendered filename can never drift.
//
// A still is keyed by (model visual key, tint), because many creatures share one rig but
// differ only by tint, and the viewer bakes tint into the body materials (a partial lerp
// that CSS cannot reproduce). So one image per distinct (model, tint) pair, deduped.

/** Stable filename stem for a figure's still, e.g. "mob_wolf__7f8c8d" or "player_mage". */
export function stillKey(model, tintHex) {
  const tint = tintHex ? `__${String(tintHex).replace(/^#/, '').toLowerCase()}` : '';
  return `${model}${tint}`;
}

// Served from a top-level /guide-stills/ path (NOT under /wiki): the dev server proxies
// /wiki* to the legacy wiki container and the guide SPA owns /wiki/* routes, so a sibling
// path keeps these plain static images out of both in dev and prod.
export const STILLS_DIR = 'guide-stills';

/** Public URL the Guide serves the still from (committed under public/guide-stills/). */
export function stillUrl(model, tintHex) {
  if (!model) return null;
  return `/${STILLS_DIR}/${stillKey(model, tintHex)}.webp`;
}
