// @vitest-environment jsdom
import './_setup';
import { beforeEach, describe, expect, it } from 'vitest';
import { parseAdminRoute, routeHref, shouldHandleNavigation } from '../../src/admin/navigation';

describe('admin navigation', () => {
  beforeEach(() => {
    history.replaceState(null, '', '/admin?lang=en');
  });

  it('parses page and IP routes with a safe overview fallback', () => {
    expect(parseAdminRoute(new URL('https://admin.test/admin?page=moderation'))).toEqual({
      page: 'moderation',
    });
    expect(parseAdminRoute(new URL('https://admin.test/admin?page=accounts'))).toEqual({
      page: 'accounts',
    });
    expect(parseAdminRoute(new URL('https://admin.test/admin?page=shared-ips'))).toEqual({
      page: 'shared-ips',
    });
    expect(parseAdminRoute(new URL('https://admin.test/admin?page=suspicious-players'))).toEqual({
      page: 'suspicious-players',
    });
    expect(
      parseAdminRoute(new URL('https://admin.test/admin?page=ip&ip=2001%3Adb8%3A%3A1')),
    ).toEqual({ page: 'ip', ip: '2001:db8::1' });
    expect(parseAdminRoute(new URL('https://admin.test/admin?page=unknown'))).toEqual({
      page: 'overview',
    });
  });

  it('keeps unrelated query parameters while serializing one route', () => {
    expect(routeHref({ page: 'blocked-ips' })).toBe('/admin?lang=en&page=blocked-ips');
    expect(routeHref({ page: 'ip', ip: '203.0.113.7' })).toBe(
      '/admin?lang=en&page=ip&ip=203.0.113.7',
    );
  });

  it('supports legacy IP links without an explicit page', () => {
    expect(parseAdminRoute(new URL('https://admin.test/admin?ip=203.0.113.7'))).toEqual({
      page: 'ip',
      ip: '203.0.113.7',
    });
  });

  it('intercepts only unmodified primary-button navigation', () => {
    expect(shouldHandleNavigation(new MouseEvent('click', { button: 0 }))).toBe(true);
    expect(shouldHandleNavigation(new MouseEvent('click', { button: 0, ctrlKey: true }))).toBe(
      false,
    );
    expect(shouldHandleNavigation(new MouseEvent('click', { button: 1 }))).toBe(false);
  });
});
