// Pure, DOM/i18n-free core for the Materials Vault tab's name search, the
// vault's slice of the bank family's filter cores (bag_filter.ts,
// bank_filter.ts). The vault has no category chips and no sort (its rows
// already sit in the deterministic base-grade-adjacent order vault_view.ts
// imposes), so this is the ONE piece the bank's filter bar owns that the
// vault also needs: narrow the rendered rows to the ones whose DISPLAYED
// name contains the query. The name comes in through an injected resolver,
// the bank_filter.ts rule, so the core never imports the i18n/entity layer
// and search agrees with what the row label paints (a dormant unknown id
// renders, and is therefore searched, as its raw id).
//
// Registered in UI_PURE_CORES (tests/architecture.test.ts); unit-tested in
// tests/vault_search.test.ts.

/** The row shape this reads: what the vault view model carries per row. */
export interface VaultSearchableRow {
  itemId: string;
}

/** Resolve one row to the name its label shows. */
export type VaultRowNameResolver<T extends VaultSearchableRow> = (row: T) => string;

/** Normalize a raw search-box value to the term rows are matched on: an
 *  empty result means "show everything". Exposed so the painter decides
 *  "is a search active" by the SAME rule the filter applies (a box holding
 *  only spaces is not a search). */
export function vaultSearchTerm(query: string): string {
  return query.trim().toLowerCase();
}

/** Narrow `rows` to the ones whose displayed name contains the query
 *  (case-insensitive substring, the bags/bank rule). Returns a NEW array in
 *  the input order, never mutating it, so the view core's sort survives;
 *  an empty or whitespace-only query returns every row. */
export function filterVaultRows<T extends VaultSearchableRow>(
  rows: readonly T[],
  query: string,
  nameOf: VaultRowNameResolver<T>,
): T[] {
  const term = vaultSearchTerm(query);
  if (!term) return rows.slice();
  return rows.filter((row) => nameOf(row).toLowerCase().includes(term));
}
