<script lang="ts">
  import { onMount, type Component } from 'svelte';
  import { auth } from './state/auth.svelte';
  import { session } from './state/session.svelte';
  import { t } from './i18n';
  import {
    currentAdminRoute,
    routeHref,
    setAdminNavigation,
    shouldHandleNavigation,
    type AdminRoute,
  } from './navigation';
  import {
    type AdminPage,
    firstVisiblePage,
    IP_ROUTE_PERMISSION,
    itemForPage,
  } from './pages/pages';
  import Login from './components/Login.svelte';
  import AdminShell from './components/AdminShell.svelte';
  import Overview from './pages/Overview.svelte';
  import Accounts from './pages/Accounts.svelte';
  import Characters from './pages/Characters.svelte';
  import Usage from './pages/Usage.svelte';
  import Moderation from './pages/Moderation.svelte';
  import SuspiciousPlayers from './pages/SuspiciousPlayers.svelte';
  import DetectionCalibration from './pages/DetectionCalibration.svelte';
  import AntibotConfig from './pages/AntibotConfig.svelte';
  import SharedIps from './pages/SharedIps.svelte';
  import ChatFilter from './pages/ChatFilter.svelte';
  import BlockedIps from './pages/BlockedIps.svelte';
  import BugReports from './pages/BugReports.svelte';
  import IpAssociations from './pages/IpAssociations.svelte';
  import Staff from './pages/Staff.svelte';

  // Root of the admin SPA. Shows the login overlay until authed, then the shared
  // navigation shell and the routed page. The {#key session.locale} wrapper
  // re-renders everything when the locale changes, since the admin t() reads a
  // module-level current locale that Svelte does not track. Each page owns its own
  // data fetching and live timers (mounted/unmounted with the route).
  let route = $state<AdminRoute>(currentAdminRoute());
  const PAGE_COMPONENTS = {
    overview: Overview,
    accounts: Accounts,
    characters: Characters,
    usage: Usage,
    moderation: Moderation,
    'suspicious-players': SuspiciousPlayers,
    'detection-calibration': DetectionCalibration,
    'antibot-config': AntibotConfig,
    'shared-ips': SharedIps,
    'chat-filter': ChatFilter,
    'blocked-ips': BlockedIps,
    'bug-reports': BugReports,
    staff: Staff,
  } satisfies Record<AdminPage, Component>;
  // Permission route guard (presentation only; the server re-checks every
  // call): a route the operator cannot open renders their first visible page
  // instead. The URL is left alone so a later role change makes it work again.
  let guardedRoute = $derived.by((): AdminRoute | null => {
    if (!auth.permissionsLoaded) return null;
    const permission =
      route.page === 'ip' ? IP_ROUTE_PERMISSION : itemForPage(route.page).permission;
    if (auth.can(permission)) return route;
    const fallback = firstVisiblePage((candidate) => auth.can(candidate));
    return fallback === null ? null : { page: fallback };
  });
  let Page = $derived(
    guardedRoute === null || guardedRoute.page === 'ip' ? null : PAGE_COMPONENTS[guardedRoute.page],
  );

  setAdminNavigation({
    navigate(event, nextRoute) {
      if (!shouldHandleNavigation(event)) return;
      event.preventDefault();
      const href = routeHref(nextRoute);
      const currentHref = `${location.pathname}${location.search}${location.hash}`;
      if (href === currentHref) return;
      history.pushState({ ...history.state, adminRoute: true }, '', href);
      route = nextRoute;
    },
    back(event) {
      if (!shouldHandleNavigation(event) || !history.state?.adminRoute) return;
      event.preventDefault();
      history.back();
    },
  });

  onMount(() => {
    void auth.hydrate();
    const syncLocation = () => {
      route = currentAdminRoute();
    };
    window.addEventListener('popstate', syncLocation);
    return () => window.removeEventListener('popstate', syncLocation);
  });
</script>

{#key session.locale}
  {#if !auth.authed}
    <Login />
  {:else if guardedRoute !== null}
    <AdminShell route={guardedRoute}>
      {#if guardedRoute.page === 'ip'}
        {#key guardedRoute.ip}
          <IpAssociations ip={guardedRoute.ip} />
        {/key}
      {:else if Page}
        <Page />
      {/if}
    </AdminShell>
  {:else}
    <!-- Authed but no page to show: the boot /me hydrate is pending or failed,
         or the operator's roles grant no visible page. Never a blank screen. -->
    <div class="session-state">
      {#if auth.hydrateFailed}
        <p>{t('auth.sessionLoadFailed')}</p>
        <button type="button" onclick={() => void auth.hydrate()}>{t('auth.retry')}</button>
      {:else if auth.permissionsLoaded}
        <p>{t('auth.noAccess')}</p>
        <button type="button" onclick={() => auth.logout()}>{t('auth.signOut')}</button>
      {:else}
        <p>{t('auth.loadingSession')}</p>
      {/if}
    </div>
  {/if}
{/key}

<style>
  .session-state {
    display: grid;
    justify-items: center;
    gap: 12px;
    padding: 80px 20px;
    color: var(--text-soft);
    text-align: center;
  }
</style>
