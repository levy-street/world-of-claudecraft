export type AdminGuildSort = 'name' | 'created_at' | 'member_count';
export type AdminGuildSortDirection = 'asc' | 'desc';

export interface AdminGuildSortParams {
  sort: AdminGuildSort;
  dir: AdminGuildSortDirection;
}

export function parseAdminGuildSort(params: URLSearchParams): AdminGuildSortParams {
  const requestedSort = params.get('sort');
  if (
    requestedSort !== null &&
    requestedSort !== 'name' &&
    requestedSort !== 'created_at' &&
    requestedSort !== 'member_count'
  ) {
    return { sort: 'name', dir: 'asc' };
  }
  const sort: AdminGuildSort = requestedSort ?? 'name';
  const requestedDirection = params.get('dir');
  const defaultDirection: AdminGuildSortDirection = sort === 'name' ? 'asc' : 'desc';
  const dir: AdminGuildSortDirection =
    requestedDirection === 'asc' || requestedDirection === 'desc'
      ? requestedDirection
      : defaultDirection;
  return { sort, dir };
}
