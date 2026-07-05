import { describe, expect, it } from 'vitest';
import {
  firstVisiblePage,
  IP_ROUTE_PERMISSION,
  NAV_SECTIONS,
  PAGES,
  visibleNavSections,
} from '../src/admin/pages/pages';
import type { AdminPermission } from '../src/admin/permissions';

const can = (granted: AdminPermission[]) => (permission: AdminPermission) =>
  granted.includes(permission);

describe('admin nav visibility', () => {
  it('keeps every section and item for a full permission set', () => {
    const all = PAGES.map((item) => item.permission);
    expect(visibleNavSections(can(all))).toEqual(NAV_SECTIONS);
  });

  it('drops every section without a granted permission and keeps the rest whole', () => {
    // accounts.read gates both players items (accounts + characters), so the
    // whole players section stays and every other section (each needing a
    // permission not granted here) drops out entirely.
    const sections = visibleNavSections(can(['accounts.read']));
    expect(sections.map((section) => section.id)).toEqual(['players']);
    const players = sections[0];
    expect(players.items.map((item) => item.id)).toEqual(['accounts', 'characters']);
    expect(players.defaultPage).toBe('accounts');
  });

  it('resolves the first visible page for the route guard fallback', () => {
    expect(firstVisiblePage(can(['support.read']))).toBe('bug-reports');
    expect(firstVisiblePage(can(['botdetector.read']))).toBe('suspicious-players');
    expect(firstVisiblePage(can([]))).toBeNull();
  });

  it('requires accounts.read for the IP associations detail route', () => {
    expect(IP_ROUTE_PERMISSION).toBe('accounts.read');
  });
});
