// Pure shaping of the cached Flagged-view dataset into one filtered,
// paginated response, shared by both admin dispatch arms (the dual-arm rule).
// A sibling module rather than a helper inside server/admin.ts so the filter
// defaults and the offset math carry their own unit test
// (tests/suspicion_flag_list.test.ts).

import { isSuspicionFlagStatus } from './suspicion_flag_workflow';
import type { SuspicionFlagDataset, SuspicionFlagRow } from './suspicion_flags_db';

export interface FlagListPage {
  rows: SuspicionFlagRow[];
  // Post-filter total across the CACHED dataset, which is bounded by
  // SUSPICION_FLAG_LIST_MAX; `counts` are global SQL-side totals. Under
  // truncation the two can disagree: `counts` is authoritative for the
  // per-status chips, `total` drives the pager over what is actually
  // listable, and `truncated` tells the reader which situation they are in.
  total: number;
  page: number;
  limit: number;
  counts: SuspicionFlagDataset['countsByStatus'];
  truncated: boolean;
}

/**
 * Filter and paginate the cached dataset. 'active' (the default when the
 * status param is absent or unrecognized) is new + under_review; a concrete
 * status filters to it; 'all' passes everything through.
 */
export function flagListResponse(
  dataset: SuspicionFlagDataset,
  params: Pick<URLSearchParams, 'get'>,
  pageParams: { page: number; limit: number },
): FlagListPage {
  const statusParam = params.get('status');
  const filtered = isSuspicionFlagStatus(statusParam)
    ? dataset.rows.filter((row) => row.status === statusParam)
    : statusParam === 'all'
      ? dataset.rows
      : dataset.rows.filter((row) => row.status === 'new' || row.status === 'under_review');
  const { page, limit } = pageParams;
  const offset = (page - 1) * limit;
  return {
    rows: filtered.slice(offset, offset + limit),
    total: filtered.length,
    page,
    limit,
    counts: dataset.countsByStatus,
    truncated: dataset.truncated,
  };
}
