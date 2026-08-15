import { describe, expect, it } from 'vitest';
import { parseAdminAccountSort } from '../server/admin_accounts_sort';

describe('admin account list sorting', () => {
  it('defaults to the newest-account-first order the fixed ORDER BY used', () => {
    expect(parseAdminAccountSort(new URLSearchParams())).toEqual({
      sort: 'id',
      dir: 'desc',
    });
  });

  it('accepts every allowlisted sort column with its column default direction', () => {
    expect(parseAdminAccountSort(new URLSearchParams({ sort: 'username', dir: 'asc' }))).toEqual({
      sort: 'username',
      dir: 'asc',
    });
    expect(parseAdminAccountSort(new URLSearchParams({ sort: 'username' }))).toEqual({
      sort: 'username',
      dir: 'asc',
    });
    expect(parseAdminAccountSort(new URLSearchParams({ sort: 'character_count' }))).toEqual({
      sort: 'character_count',
      dir: 'desc',
    });
    expect(parseAdminAccountSort(new URLSearchParams({ sort: 'max_level' }))).toEqual({
      sort: 'max_level',
      dir: 'desc',
    });
    expect(parseAdminAccountSort(new URLSearchParams({ sort: 'playtime_seconds' }))).toEqual({
      sort: 'playtime_seconds',
      dir: 'desc',
    });
    expect(parseAdminAccountSort(new URLSearchParams({ sort: 'created_at', dir: 'asc' }))).toEqual({
      sort: 'created_at',
      dir: 'asc',
    });
    expect(parseAdminAccountSort(new URLSearchParams({ sort: 'last_login', dir: 'asc' }))).toEqual({
      sort: 'last_login',
      dir: 'asc',
    });
  });

  it('rejects arbitrary sort values even when their direction is otherwise valid', () => {
    expect(
      parseAdminAccountSort(
        new URLSearchParams({ sort: 'created_at; DROP TABLE accounts', dir: 'desc' }),
      ),
    ).toEqual({ sort: 'id', dir: 'desc' });
  });

  it('uses the selected column default when the direction is invalid', () => {
    expect(
      parseAdminAccountSort(new URLSearchParams({ sort: 'username', dir: 'sideways' })),
    ).toEqual({ sort: 'username', dir: 'asc' });
    expect(
      parseAdminAccountSort(new URLSearchParams({ sort: 'max_level', dir: 'sideways' })),
    ).toEqual({ sort: 'max_level', dir: 'desc' });
  });
});
