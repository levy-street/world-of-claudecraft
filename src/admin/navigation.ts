import { getContext, setContext } from 'svelte';
import { type AdminPage, PAGES } from './pages/pages';

export interface AdminNavigation {
  navigate: (event: MouseEvent, route: AdminRoute) => void;
  back: (event: MouseEvent) => void;
}

export type AdminRoute = { page: AdminPage } | { page: 'ip'; ip: string };

const NAVIGATION_CONTEXT = Symbol('admin-navigation');

export function setAdminNavigation(navigation: AdminNavigation): void {
  setContext(NAVIGATION_CONTEXT, navigation);
}

// Links remain valid native anchors without a provider, which keeps isolated
// component tests and no-JS navigation functional instead of hiding a no-op.
export function getAdminNavigation(): AdminNavigation | null {
  return getContext<AdminNavigation | undefined>(NAVIGATION_CONTEXT) ?? null;
}

export function parseAdminRoute(url: URL): AdminRoute {
  const page = url.searchParams.get('page');
  const ip = url.searchParams.get('ip')?.trim();
  if (page === 'ip' && ip) return { page: 'ip', ip };
  if (PAGES.some((candidate) => candidate.id === page)) {
    return { page: page as AdminPage };
  }
  // Backward compatibility for IP links created before page became explicit.
  if (page === null && ip) return { page: 'ip', ip };
  return { page: 'overview' };
}

export function currentAdminRoute(): AdminRoute {
  return parseAdminRoute(new URL(window.location.href));
}

export function routeHref(route: AdminRoute): string {
  const url = new URL(window.location.href);
  url.searchParams.set('page', route.page);
  if (route.page === 'ip') url.searchParams.set('ip', route.ip);
  else url.searchParams.delete('ip');
  return `${url.pathname}${url.search}${url.hash}`;
}

export function shouldHandleNavigation(event: MouseEvent): boolean {
  return event.button === 0 && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey;
}
