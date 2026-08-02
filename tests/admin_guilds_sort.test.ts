import { describe, expect, it } from 'vitest';
import { parseAdminGuildSort } from '../server/admin_guilds_sort';

describe('admin guild list sorting', () => {
  it('defaults to the stable alphabetical directory order', () => {
    expect(parseAdminGuildSort(new URLSearchParams())).toEqual({
      sort: 'name',
      dir: 'asc',
    });
  });

  it('accepts the date and member-count sort contracts', () => {
    expect(parseAdminGuildSort(new URLSearchParams({ sort: 'created_at', dir: 'desc' }))).toEqual({
      sort: 'created_at',
      dir: 'desc',
    });
    expect(parseAdminGuildSort(new URLSearchParams({ sort: 'member_count', dir: 'asc' }))).toEqual({
      sort: 'member_count',
      dir: 'asc',
    });
    expect(parseAdminGuildSort(new URLSearchParams({ sort: 'name', dir: 'desc' }))).toEqual({
      sort: 'name',
      dir: 'desc',
    });
    expect(parseAdminGuildSort(new URLSearchParams({ sort: 'created_at', dir: 'asc' }))).toEqual({
      sort: 'created_at',
      dir: 'asc',
    });
    expect(parseAdminGuildSort(new URLSearchParams({ sort: 'created_at' }))).toEqual({
      sort: 'created_at',
      dir: 'desc',
    });
    expect(parseAdminGuildSort(new URLSearchParams({ sort: 'member_count' }))).toEqual({
      sort: 'member_count',
      dir: 'desc',
    });
  });

  it('rejects arbitrary sort values even when their direction is otherwise valid', () => {
    expect(
      parseAdminGuildSort(
        new URLSearchParams({ sort: 'created_at; DROP TABLE guilds', dir: 'desc' }),
      ),
    ).toEqual({
      sort: 'name',
      dir: 'asc',
    });
  });

  it('uses the selected column default when the direction is invalid', () => {
    expect(
      parseAdminGuildSort(new URLSearchParams({ sort: 'created_at', dir: 'sideways' })),
    ).toEqual({
      sort: 'created_at',
      dir: 'desc',
    });
  });
});
