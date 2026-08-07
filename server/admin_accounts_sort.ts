// Pure sort-parameter parser for the admin Accounts list, mirroring
// admin_guilds_sort.ts: the allowlist lives here, once, and both the SQL
// ORDER BY (admin_db.ts listAccounts) and the client's sortable headers
// (Accounts.svelte) key off these same column names.

export type AdminAccountSort =
  | 'id'
  | 'username'
  | 'character_count'
  | 'max_level'
  | 'playtime_seconds'
  | 'created_at'
  | 'last_login';

export type AdminAccountSortDirection = 'asc' | 'desc';

export interface AdminAccountSortParams {
  sort: AdminAccountSort;
  dir: AdminAccountSortDirection;
}

// The allowlist: an ORDER BY column never reaches SQL unless it appears here.
export const ADMIN_ACCOUNT_SORTS: readonly AdminAccountSort[] = [
  'id',
  'username',
  'character_count',
  'max_level',
  'playtime_seconds',
  'created_at',
  'last_login',
];

export function parseAdminAccountSort(params: URLSearchParams): AdminAccountSortParams {
  const requestedSort = params.get('sort');
  if (
    requestedSort !== null &&
    !(ADMIN_ACCOUNT_SORTS as readonly string[]).includes(requestedSort)
  ) {
    return { sort: 'id', dir: 'desc' };
  }
  const sort: AdminAccountSort = (requestedSort as AdminAccountSort | null) ?? 'id';
  const requestedDirection = params.get('dir');
  const defaultDirection: AdminAccountSortDirection = sort === 'username' ? 'asc' : 'desc';
  const dir: AdminAccountSortDirection =
    requestedDirection === 'asc' || requestedDirection === 'desc'
      ? requestedDirection
      : defaultDirection;
  return { sort, dir };
}
