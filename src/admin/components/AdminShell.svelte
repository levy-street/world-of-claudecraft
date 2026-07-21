<script lang="ts">
  import type { Snippet } from 'svelte';
  import { auth } from '../state/auth.svelte';
  import { t } from '../i18n';
  import { setAccountModalController } from '../account_modal';
  import type { AdminRoute } from '../navigation';
  import { itemForPage, type AdminPage } from '../pages/pages';
  import AdminNav from './AdminNav.svelte';
  import AccountModal from './AccountModal.svelte';
  import PageHeader from './PageHeader.svelte';

  let { route, children }: { route: AdminRoute; children: Snippet } = $props();
  let navOpen = $state(false);
  let navToggle: HTMLButtonElement;
  let accountModalId = $state<number | null>(null);
  let accountModalChanged = $state<(() => void) | null>(null);
  let page = $derived<AdminPage>(route.page === 'ip' ? 'shared-ips' : route.page);
  let pageTitle = $derived(t(itemForPage(page).labelKey));

  function closeNav(returnFocus = false): void {
    navOpen = false;
    if (returnFocus) navToggle.focus();
  }

  function closeAccountModal(): void {
    accountModalId = null;
    accountModalChanged = null;
  }

  setAccountModalController({
    open(accountId, onChanged) {
      accountModalId = accountId;
      accountModalChanged = onChanged ?? null;
    },
    close() {
      closeAccountModal();
    },
  });

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape' && navOpen) closeNav(true);
  }

  $effect(() => {
    route;
    navOpen = false;
    closeAccountModal();
  });
</script>

<svelte:window onkeydown={onKeydown} />

<div class="admin-layout">
  <AdminNav
    {route}
    open={navOpen}
    onSelect={() => closeNav()}
    onClose={() => closeNav(true)}
  />
  {#if navOpen}
    <button
      class="nav-scrim"
      type="button"
      aria-label={t('nav.closeMenu')}
      onclick={() => closeNav(true)}
    ></button>
  {/if}
  <div class="workspace">
    <header class="workspace-topbar">
      <div class="mobile-brand">
        <button
          class="nav-toggle"
          bind:this={navToggle}
          type="button"
          aria-label={navOpen ? t('nav.closeMenu') : t('nav.openMenu')}
          aria-expanded={navOpen}
          aria-controls="admin-navigation"
          onclick={() => (navOpen = !navOpen)}
        >
          <span aria-hidden="true"></span>
          <span aria-hidden="true"></span>
          <span aria-hidden="true"></span>
        </button>
        <span class="app-title">{t('app.shortTitle')}</span>
      </div>
      <div class="who">
        <span>{t('auth.signedInAs')}</span> <span id="who-name">{auth.name}</span>
        <button type="button" onclick={() => auth.logout()}>{t('auth.signOut')}</button>
      </div>
    </header>
    <main id="admin-content">
      {#if route.page !== 'ip'}
        <PageHeader title={pageTitle} />
      {/if}
      {@render children()}
    </main>
  </div>
</div>

{#if accountModalId !== null}
  {#key accountModalId}
    <AccountModal
      accountId={accountModalId}
      onChanged={accountModalChanged ?? undefined}
      onClose={() => closeAccountModal()}
    />
  {/key}
{/if}

<style>
  .admin-layout {
    display: grid;
    grid-template-columns: 220px minmax(0, 1fr);
    min-height: 100vh;
  }

  .workspace {
    min-width: 0;
    background: var(--bg-app);
  }

  .workspace-topbar {
    display: flex;
    min-height: 58px;
    align-items: center;
    justify-content: flex-end;
    padding: 0 24px;
    border-bottom: 1px solid var(--border-subtle);
  }

  .mobile-brand {
    display: none;
    min-width: 0;
    align-items: center;
    gap: 10px;
  }

  .app-title {
    color: var(--gold);
    font-family: var(--title-font);
    text-shadow: 1px 1px 2px #000;
  }

  .app-title {
    overflow: hidden;
    font-size: 18px;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .who {
    flex: none;
    color: var(--text-dim);
    font-size: 12px;
  }

  .who button,
  .nav-toggle {
    background: var(--btn-flat-bg);
    color: var(--text-soft);
    border: 1px solid var(--border-soft);
    border-radius: 3px;
    cursor: pointer;
  }

  .who button {
    margin-left: 12px;
    padding: 4px 10px;
  }

  .who button:hover,
  .nav-toggle:hover {
    color: var(--text-bright);
    border-color: var(--gold-dim);
  }

  .who button:focus-visible,
  .nav-toggle:focus-visible {
    outline: 2px solid var(--gold);
    outline-offset: 2px;
  }

  .nav-toggle {
    display: none;
    width: 40px;
    height: 40px;
    padding: 9px;
  }

  .nav-toggle span {
    display: block;
    height: 2px;
    margin: 4px 0;
    background: currentColor;
  }

  main {
    min-width: 0;
    padding: 22px 24px 60px;
  }

  .nav-scrim {
    display: none;
  }

  @media (pointer: coarse) {
    .who button {
      min-height: 40px;
    }
  }

  @media (max-width: 800px) {
    .admin-layout {
      display: block;
    }

    .workspace-topbar {
      justify-content: space-between;
      gap: 12px;
      padding: 0 14px;
    }

    .mobile-brand {
      display: flex;
    }

    .nav-toggle {
      display: block;
      flex: none;
    }

    .who > span:first-child {
      display: none;
    }

    main {
      padding: 18px 14px 40px;
    }

    .nav-scrim {
      display: block;
      position: fixed;
      z-index: 30;
      inset: 0;
      width: 100%;
      height: 100%;
      background: #000a;
      border: 0;
      cursor: pointer;
    }
  }
</style>
