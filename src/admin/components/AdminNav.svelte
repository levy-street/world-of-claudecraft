<script lang="ts">
  import { tick } from 'svelte';
  import { t } from '../i18n';
  import {
    getAdminNavigation,
    routeHref,
    shouldHandleNavigation,
    type AdminRoute,
  } from '../navigation';
  import { type AdminPage, visibleNavSections } from '../pages/pages';
  import { auth } from '../state/auth.svelte';

  let {
    route,
    open = false,
    onSelect,
    onClose,
  }: {
    route: AdminRoute;
    open?: boolean;
    onSelect: () => void;
    onClose: () => void;
  } = $props();

  const navigation = getAdminNavigation();
  let sidebar: HTMLElement;
  let activePage = $derived<AdminPage>(route.page === 'ip' ? 'shared-ips' : route.page);
  // Presentation only: the server enforces the same route->permission mapping.
  let sections = $derived(visibleNavSections((permission) => auth.can(permission)));

  $effect(() => {
    if (!open) return;
    void tick().then(() => sidebar.querySelector<HTMLElement>('button, a')?.focus());
  });

  function navigate(event: MouseEvent, page: AdminPage): void {
    if (shouldHandleNavigation(event)) onSelect();
    navigation?.navigate(event, { page });
  }
</script>

<aside id="admin-navigation" bind:this={sidebar} class:open aria-label={t('nav.primaryLabel')}>
  <header class="sidebar-header">
    <span class="sidebar-brand">{t('app.shortTitle')}</span>
    <button class="nav-close" type="button" aria-label={t('nav.closeMenu')} onclick={onClose}>
      <span aria-hidden="true"></span>
    </button>
  </header>
  <nav>
    {#each sections as section (section.id)}
      {@const sectionActive = section.items.some((item) => item.id === activePage)}
      <div class="nav-section">
        {#if section.labelKey}
          <a
            class="nav-section-title"
            class:active-section={sectionActive}
            href={routeHref({ page: section.defaultPage })}
            onclick={(event) => navigate(event, section.defaultPage)}
          >{t(section.labelKey)}</a>
        {/if}
        <ul class:standalone={!section.labelKey}>
          {#each section.items as item (item.id)}
            <li>
              <a
                class="nav-page"
                class:active={item.id === activePage}
                aria-current={item.id === activePage ? 'page' : undefined}
                href={routeHref({ page: item.id })}
                onclick={(event) => navigate(event, item.id)}
              >{t(item.labelKey)}</a>
            </li>
          {/each}
        </ul>
      </div>
    {/each}
  </nav>
</aside>

<style>
  aside {
    position: sticky;
    top: 0;
    width: 220px;
    min-width: 220px;
    height: 100vh;
    overflow-y: auto;
    background: #0b0b11;
    border-right: 1px solid var(--border-subtle);
  }

  .sidebar-header {
    display: flex;
    min-height: 58px;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 0 16px;
    border-bottom: 1px solid var(--border-subtle);
  }

  .sidebar-brand {
    color: var(--gold);
    font-family: var(--title-font);
    font-size: 19px;
    font-weight: 600;
    white-space: nowrap;
    text-shadow: 1px 1px 2px #000;
  }

  nav,
  .nav-section {
    display: grid;
  }

  nav {
    gap: 16px;
    padding: 16px 12px;
  }

  .nav-close {
    display: none;
  }

  .nav-section {
    gap: 5px;
  }

  .nav-section-title,
  .nav-page {
    display: flex;
    align-items: center;
    min-height: 36px;
    border-radius: 4px;
    text-decoration: none;
  }

  .nav-section-title {
    padding: 7px 9px;
    color: var(--gold-dim);
    font-family: var(--title-font);
    font-size: 13px;
    letter-spacing: 0.5px;
    text-transform: uppercase;
  }

  .nav-section-title.active-section {
    color: var(--gold);
  }

  ul {
    display: grid;
    gap: 3px;
    list-style: none;
    padding-left: 10px;
  }

  ul.standalone {
    padding-left: 0;
  }

  .nav-page {
    padding: 7px 10px;
    color: var(--text-soft);
    border-left: 2px solid transparent;
  }

  .nav-page:hover,
  .nav-section-title:hover {
    color: var(--text-bright);
    background: #1a160f;
  }

  .nav-page.active {
    color: var(--gold);
    background: #241a0e;
    border-left-color: var(--gold);
  }

  .nav-page:focus-visible,
  .nav-section-title:focus-visible {
    outline: 2px solid var(--gold);
    outline-offset: 2px;
  }

  @media (pointer: coarse) {
    .nav-section-title,
    .nav-page {
      min-height: 40px;
    }
  }

  @media (max-width: 800px) {
    aside {
      position: fixed;
      z-index: 40;
      top: 0;
      bottom: 0;
      left: 0;
      width: min(82vw, 280px);
      height: 100vh;
      border-width: 0 1px 0 0;
      transform: translateX(-105%);
      visibility: hidden;
    }

    aside.open {
      transform: translateX(0);
      visibility: visible;
    }

    .nav-close {
      display: block;
      width: 40px;
      height: 40px;
      flex: none;
      background: var(--btn-flat-bg);
      color: var(--text-soft);
      border: 1px solid var(--border-soft);
      border-radius: 3px;
      cursor: pointer;
    }

    .nav-close:hover {
      color: var(--text-bright);
      border-color: var(--gold-dim);
    }

    .nav-close:focus-visible {
      outline: 2px solid var(--gold);
      outline-offset: 2px;
    }

    .nav-close span::before,
    .nav-close span::after {
      content: "";
      display: block;
      width: 20px;
      height: 2px;
      margin: auto;
      background: currentColor;
    }

    .nav-close span::before {
      transform: rotate(45deg);
    }

    .nav-close span::after {
      transform: translateY(-2px) rotate(-45deg);
    }
  }
</style>
