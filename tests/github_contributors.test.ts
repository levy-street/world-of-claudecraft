import { describe, expect, it } from 'vitest';
import {
  contributorsToMap,
  parseContributorsPage,
  parseNextPageUrl,
} from '../server/github_contributors';

describe('parseContributorsPage', () => {
  it('keeps real users with a positive commit count, dropping bots and anonymous', () => {
    const page = [
      { login: 'FernandoX7', type: 'User', contributions: 821 },
      { login: 'jgyy', type: 'User', contributions: 664 },
      { login: 'dependabot[bot]', type: 'Bot', contributions: 50 },
      { name: 'someone@example.com', type: 'Anonymous', contributions: 9 },
      { login: 'ghost', type: 'User', contributions: 0 },
      { login: 'neg', type: 'User', contributions: -3 },
    ];
    expect(parseContributorsPage(page)).toEqual([
      { login: 'FernandoX7', commits: 821 },
      { login: 'jgyy', commits: 664 },
    ]);
  });

  it('floors fractional contribution counts and tolerates junk entries', () => {
    expect(parseContributorsPage([{ login: 'x', type: 'User', contributions: 12.9 }])).toEqual([
      { login: 'x', commits: 12 },
    ]);
    expect(
      parseContributorsPage([null, 7, { type: 'User' }, { login: 'y', type: 'User' }]),
    ).toEqual([]);
    expect(parseContributorsPage('not an array' as unknown)).toEqual([]);
  });
});

describe('parseNextPageUrl', () => {
  it('extracts the rel="next" link, ignoring other rels', () => {
    const header =
      '<https://api.github.com/repositories/1/contributors?per_page=100&page=2>; rel="next", ' +
      '<https://api.github.com/repositories/1/contributors?per_page=100&page=5>; rel="last"';
    expect(parseNextPageUrl(header)).toBe(
      'https://api.github.com/repositories/1/contributors?per_page=100&page=2',
    );
  });

  it('returns null when there is no next page or no header', () => {
    expect(parseNextPageUrl('<https://api.github.com/x?page=5>; rel="last"')).toBeNull();
    expect(parseNextPageUrl(null)).toBeNull();
    expect(parseNextPageUrl('')).toBeNull();
  });
});

describe('contributorsToMap', () => {
  it('builds a lowercase-keyed lookup for case-insensitive logins', () => {
    const map = contributorsToMap([
      { login: 'FernandoX7', commits: 821 },
      { login: 'JGYY', commits: 664 },
    ]);
    expect(map.get('fernandox7')).toBe(821);
    expect(map.get('jgyy')).toBe(664);
    expect(map.get('unknown')).toBeUndefined();
  });
});
