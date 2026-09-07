// The IWorldReliquary completion reads both hosts answer identically: one
// implementation over an ownership-surfaces object, so the offline Sim and the
// online ClientWorld cannot drift (each keeps a one-line delegate). Pure: no
// state, no rng, no clock.

import type { ReliquaryCatalogCompletion, ReliquaryPageCompletion } from '../world_api/reliquary';
import { RELIQUARY_PAGES_BY_ID } from './content/reliquary';
import {
  catalogRankOwned,
  catalogRelicCompletion,
  clearCountForSource,
  curatorRankFromOwned,
  pageCompletion,
} from './reliquary';

type Surfaces = Parameters<typeof catalogRelicCompletion>[0];

/** Page progress for a live page id, or null when the id is not a page. */
export function reliquaryPageCompletionFor(
  pageId: string,
  surfaces: Surfaces,
): ReliquaryPageCompletion | null {
  const page = RELIQUARY_PAGES_BY_ID[pageId];
  return page ? pageCompletion(page, surfaces) : null;
}

/** Catalog-wide unique relic progress (Overview totals, skins included). */
export function reliquaryCatalogCompletionFor(surfaces: Surfaces): ReliquaryCatalogCompletion {
  return catalogRelicCompletion(surfaces);
}

/** Curator rank; excludes account weapon skins so display matches the grant path. */
export function reliquaryCuratorRankFor(surfaces: Surfaces): number {
  return curatorRankFromOwned(catalogRankOwned(surfaces));
}

/** Lifetime clears for a page's clear source; undefined for an unknown page
 *  or one without a meter. The host hands the two counters the meter reads. */
export function reliquaryPageClearCountFor(
  pageId: string,
  host: Parameters<typeof clearCountForSource>[0],
): number | undefined {
  const page = RELIQUARY_PAGES_BY_ID[pageId];
  return page ? clearCountForSource(host, page.clearSource) : undefined;
}
