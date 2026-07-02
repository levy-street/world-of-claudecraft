<script lang="ts">
  import { onMount, type Component } from 'svelte';
  import { auth } from './state/auth.svelte';
  import { session } from './state/session.svelte';
  import {
    currentAdminRoute,
    routeHref,
    setAdminNavigation,
    shouldHandleNavigation,
    type AdminRoute,
  } from './navigation';
  import type { AdminPage } from './pages/pages';
  import Login from './components/Login.svelte';
  import AdminShell from './components/AdminShell.svelte';
  import Overview from './pages/Overview.svelte';
  import Accounts from './pages/Accounts.svelte';
  import Characters from './pages/Characters.svelte';
  import Usage from './pages/Usage.svelte';
  import Moderation from './pages/Moderation.svelte';
  import SuspiciousPlayers from './pages/SuspiciousPlayers.svelte';
  import DetectionCalibration from './pages/DetectionCalibration.svelte';
  import SharedIps from './pages/SharedIps.svelte';
  import ChatFilter from './pages/ChatFilter.svelte';
  import BlockedIps from './pages/BlockedIps.svelte';
  import BugReports from './pages/BugReports.svelte';
  import IpAssociations from './pages/IpAssociations.svelte';

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
    'shared-ips': SharedIps,
    'chat-filter': ChatFilter,
    'blocked-ips': BlockedIps,
    'bug-reports': BugReports,
  } satisfies Record<AdminPage, Component>;
  let Page = $derived(route.page === 'ip' ? null : PAGE_COMPONENTS[route.page]);

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
  {:else}
    <AdminShell {route}>
      {#if route.page === 'ip'}
        {#key route.ip}
          <IpAssociations ip={route.ip} />
        {/key}
      {:else if Page}
        <Page />
      {/if}
    </AdminShell>
  {/if}
{/key}
