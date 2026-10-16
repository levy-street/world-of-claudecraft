// Pure decisions for "keep this generated plant": the slug it is filed under,
// the asset id it becomes, and the round-trip payload that lets a baked GLB be
// re-opened in the generator instead of being a dead end.
//
// WHY BAKE AT ALL. A generated plant lives as PARAMETERS. It is rebuilt
// procedurally every session, it cannot be handed to another map or reviewed
// in the asset browser, and, because it is procedural, it never reaches the
// placement batching path the way a catalogue GLB does. Baking turns it into
// an ordinary catalogue asset: batched, collision-bakeable, publishable.
//
// DOM-free and deterministic. The exporter half (which needs three.js) is
// foliage_bake.ts; the write half is the /__studio_asset/save dev endpoint.

import { type FoliageParams, foliageKindOf, sanitizeFoliageParams } from '../sim/foliage_params';

/** Matches the dev endpoint's own guard, and the catalogue's id grammar. */
export const BAKE_SLUG_RE = /^[a-z0-9][a-z0-9_]{0,63}$/;

/** The category baked plants are filed under: one folder, so a maker can see
 *  everything the generator has produced in one place in the asset browser. */
export const BAKE_CATEGORY = 'generated';

/** Bumped when the extras payload changes shape, so a future generator can
 *  tell an old bake's parameters from a new one's. */
export const BAKE_EXTRAS_VERSION = 1;

/** Turn a maker's label into a slug, or null when nothing usable is left. */
export function foliageSlug(label: string): string | null {
  const slug = label
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64);
  return BAKE_SLUG_RE.test(slug) ? slug : null;
}

/** The catalogue id a baked plant takes: category-qualified and stable, the
 *  same grammar gen_asset_catalog.mjs derives for every other model. */
export function bakedAssetId(slug: string): string {
  return `${BAKE_CATEGORY}/${slug}`;
}

/** Repo path the GLB is written to, relative to public/. */
export function bakedAssetPath(slug: string): string {
  return `models/${BAKE_CATEGORY}/${slug}.glb`;
}

export interface FoliageBakeExtras {
  /** Marker so a foreign GLB's extras can never be mistaken for ours. */
  wocFoliage: number;
  slug: string;
  label: string;
  kind: string;
  /** The exact parameters this GLB was grown from. */
  params: FoliageParams;
  /** The leaf atlas the cards use, recorded so a maker (and any future
   *  loader-side texture dedupe) can tell which bakes share one. Bakes must
   *  share the generator's atlas set: 200 variants each carrying their own
   *  would undo the batching win the bake exists to get. */
  leafSet?: string;
}

/** The payload written into the GLB's root extras. */
export function foliageBakeExtras(
  slug: string,
  label: string,
  params: FoliageParams,
): FoliageBakeExtras {
  const extras: FoliageBakeExtras = {
    wocFoliage: BAKE_EXTRAS_VERSION,
    slug,
    label,
    kind: foliageKindOf(params),
    params: { ...params },
  };
  if (params.leafSet) extras.leafSet = params.leafSet;
  return extras;
}

/**
 * Read a baked asset's source parameters back out of its extras, sanitized, or
 * null when this GLB was not one of ours. Re-opening a bake in the generator
 * and re-baking it is the whole reason the payload is there.
 */
export function foliageParamsFromExtras(extras: unknown): FoliageParams | null {
  if (!extras || typeof extras !== 'object') return null;
  const e = extras as Record<string, unknown>;
  if (typeof e.wocFoliage !== 'number') return null;
  return sanitizeFoliageParams(e.params);
}

export interface FoliageBakeRequest {
  slug: string;
  label: string;
  /** Base64 of the binary GLB. JSON transport keeps the endpoint the same
   *  shape as the other five dev write routes. */
  glbBase64: string;
  extras: FoliageBakeExtras;
}

/** Ceiling on a single baked plant, enforced on both ends. A generated bush is
 *  tens of kilobytes; anything near this is a runaway leaf count. */
export const MAX_BAKE_BYTES = 24 * 1024 * 1024;

export type BakeRejection =
  | 'bad_slug'
  | 'empty_label'
  | 'no_geometry'
  | 'too_large'
  | 'not_our_extras';

/**
 * Everything the endpoint will check, checked here first so the editor can
 * refuse with a specific reason instead of surfacing an HTTP 400. Returns null
 * when the request is good.
 */
export function validateBakeRequest(req: FoliageBakeRequest): BakeRejection | null {
  if (!BAKE_SLUG_RE.test(req.slug)) return 'bad_slug';
  if (req.label.trim().length === 0) return 'empty_label';
  if (req.glbBase64.length === 0) return 'no_geometry';
  // Base64 carries 3 bytes per 4 characters.
  if ((req.glbBase64.length * 3) / 4 > MAX_BAKE_BYTES) return 'too_large';
  if (foliageParamsFromExtras(req.extras) === null) return 'not_our_extras';
  return null;
}
