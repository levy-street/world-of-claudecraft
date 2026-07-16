import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { adminPathKnown, permissionForAdminRoute } from '../server/admin_routes';

// Route-coverage guard: every /admin/api route handled by server/admin.ts must
// have a declared permission in admin_routes.ts. handleAdminApi fails closed on
// unmapped paths, so a missing entry would 404 a brand-new route; this test
// turns that into a red test at development time instead. It scans the handler
// source for both route forms (exact-string compares and regex matches) and
// synthesizes a concrete path for each.

const source = readFileSync('server/admin.ts', 'utf8');

function literalRoutes(): string[] {
  return [...source.matchAll(/path === '(\/admin\/api\/[^']+)'/g)].map((m) => m[1]);
}

function regexRoutes(): { pattern: RegExp; sample: string }[] {
  return [...source.matchAll(/\/\^(\\\/admin\\\/api[^\n]*?)\$\/(?:\.exec)?/g)].map((m) => {
    const body = m[1];
    const pattern = new RegExp(`^${body}$`);
    const sample = body
      .replaceAll('\\/', '/')
      .replaceAll('(\\d+)', '123')
      // Alternation groups keep their first branch, e.g. (suspend|unsuspend|...).
      .replace(/\(([a-z-]+)(?:\|[a-z-]+)+\)/g, '$1');
    return { pattern, sample };
  });
}

describe('admin route permission map', () => {
  it('finds both route forms in the handler source (scan sanity)', () => {
    expect(literalRoutes().length).toBeGreaterThanOrEqual(15);
    expect(regexRoutes().length).toBeGreaterThanOrEqual(8);
  });

  it('synthesizes samples that match their own source regex', () => {
    for (const { pattern, sample } of regexRoutes()) {
      expect(sample, `sample for ${pattern}`).toMatch(pattern);
    }
  });

  it('maps every handled route to a permission (GET or POST)', () => {
    const paths = [...literalRoutes(), ...regexRoutes().map((r) => r.sample)];
    for (const path of paths) {
      if (path === '/admin/api/login') continue;
      const mapped = permissionForAdminRoute('GET', path) ?? permissionForAdminRoute('POST', path);
      expect(mapped, `unmapped admin route: ${path}`).not.toBeNull();
    }
  });

  it('spot-checks the mapping decisions', () => {
    expect(permissionForAdminRoute('GET', '/admin/api/overview')).toBe('analytics.read');
    expect(permissionForAdminRoute('GET', '/admin/api/provider-usage')).toBe('ops_usage.read');
    expect(permissionForAdminRoute('GET', '/admin/api/accounts/42')).toBe('accounts.read');
    expect(permissionForAdminRoute('GET', '/admin/api/accounts/42/daily-rewards-events')).toBe(
      'accounts.read',
    );
    expect(permissionForAdminRoute('POST', '/admin/api/accounts/42/reset-password')).toBe(
      'accounts.password',
    );
    expect(permissionForAdminRoute('GET', '/admin/api/blocked-ips')).toBe('moderation.read');
    expect(permissionForAdminRoute('GET', '/admin/api/moderation/history')).toBe('moderation.read');
    expect(permissionForAdminRoute('POST', '/admin/api/blocked-ips')).toBe('ipblocks.manage');
    expect(permissionForAdminRoute('POST', '/admin/api/moderation/accounts/42/ban')).toBe(
      'moderation.act',
    );
    expect(
      permissionForAdminRoute('POST', '/admin/api/moderation/accounts/42/daily-rewards-ban'),
    ).toBe('moderation.act');
    expect(
      permissionForAdminRoute('POST', '/admin/api/moderation/accounts/42/daily-rewards-ip-ban'),
    ).toBe('moderation.act');
    expect(permissionForAdminRoute('POST', '/admin/api/chat-filter/config')).toBe(
      'chatfilter.manage',
    );
    expect(permissionForAdminRoute('GET', '/admin/api/suspicious-players')).toBe(
      'botdetector.read',
    );
    expect(permissionForAdminRoute('POST', '/admin/api/maps/9/unpublish')).toBe('content.moderate');
    expect(permissionForAdminRoute('GET', '/admin/api/me')).toBe('any');
    expect(permissionForAdminRoute('POST', '/admin/api/staff/roles')).toBe('staff.manage');
  });

  it('distinguishes wrong-method hits from unknown paths', () => {
    expect(permissionForAdminRoute('POST', '/admin/api/overview')).toBeNull();
    expect(adminPathKnown('/admin/api/overview')).toBe(true);
    expect(adminPathKnown('/admin/api/nonexistent')).toBe(false);
  });
});
