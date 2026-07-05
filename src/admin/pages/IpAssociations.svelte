<script lang="ts">
  import { onMount } from 'svelte';
  import type { IpAssociationsData } from '../types';
  import { apiGet, apiPost } from '../api';
  import { blockExpiryIso } from '../block_expiry';
  import { auth } from '../state/auth.svelte';
  import { getAdminNavigation, routeHref } from '../navigation';
  import { fmtDate, fmtNumber } from '../format';
  import { localizeAdminError, t } from '../i18n';
  import Badge from '../components/Badge.svelte';
  import AccountIndicators from '../components/AccountIndicators.svelte';
  import AccountLink from '../components/AccountLink.svelte';
  import IpBlockDialog from '../components/IpBlockDialog.svelte';
  import PageHeader from '../components/PageHeader.svelte';
  import Pager from '../components/Pager.svelte';
  import Panel from '../components/Panel.svelte';

  let { ip }: { ip: string } = $props();

  let data = $state<IpAssociationsData | null>(null);
  let failed = $state(false);
  let page = $state(1);
  let blockDialogOpen = $state(false);
  let actionPending = $state(false);
  let requestId = 0;
  const navigation = getAdminNavigation();

  async function refresh(): Promise<void> {
    const currentRequest = ++requestId;
    const params = new URLSearchParams({ ip, page: String(page) });
    try {
      const result = await apiGet<IpAssociationsData>(`/admin/api/ip-associations?${params}`);
      if (currentRequest !== requestId) return;
      data = result;
      failed = false;
    } catch (err) {
      if (currentRequest !== requestId) return;
      if (!auth.handleAuthFailure(err)) failed = true;
    }
  }

  function changePage(nextPage: number): void {
    page = nextPage;
    void refresh();
  }

  function back(event: MouseEvent): void {
    navigation?.back(event);
  }

  function fail(err: unknown, fallbackKey: string): void {
    if (!auth.handleAuthFailure(err)) {
      window.alert(err instanceof Error ? localizeAdminError(err.message) : t(fallbackKey));
    }
  }

  async function blockIp(reason: string, duration: string): Promise<void> {
    if (actionPending) return;
    actionPending = true;
    try {
      await apiPost('/admin/api/blocked-ips', {
        ip,
        reason,
        expiresAt: blockExpiryIso(duration),
      });
      blockDialogOpen = false;
      await refresh();
    } catch (err) {
      fail(err, 'blockedIps.addFailed');
    } finally {
      actionPending = false;
    }
  }

  async function unblockIp(): Promise<void> {
    if (actionPending) return;
    actionPending = true;
    try {
      await apiPost('/admin/api/blocked-ips/delete', { ip });
      await refresh();
    } catch (err) {
      fail(err, 'blockedIps.removeFailed');
    } finally {
      actionPending = false;
    }
  }

  onMount(() => {
    void refresh();
  });
</script>

<div class="ip-page">
  {#snippet blockedBadge()}
    <Badge variant="bad">{t('ipAssociations.blocked')}</Badge>
  {/snippet}

  {#snippet pageActions()}
    {#if data?.blocked}
      <button type="button" disabled={actionPending} onclick={() => void unblockIp()}>
        {t('blockedIps.unblock')}
      </button>
    {:else}
      <button
        class="block-action"
        type="button"
        disabled={actionPending}
        onclick={() => (blockDialogOpen = true)}
      >
        {t('ipAssociations.blockAction')}
      </button>
    {/if}
  {/snippet}

  <PageHeader
    title={t('ipAssociations.title', { ip })}
    badge={data?.blocked ? blockedBadge : undefined}
    actions={data ? pageActions : undefined}
  />

  <a class="back-link" href={routeHref({ page: 'shared-ips' })} onclick={back}>{t('ipAssociations.back')}</a>

  <Panel>
    {#if failed}
      <div class="empty">{t('ipAssociations.loadFailed')}</div>
    {:else if data === null}
      <div class="empty">{t('ipAssociations.loading')}</div>
    {:else if data.accounts.length === 0}
      <div class="empty">{t('ipAssociations.noAccounts')}</div>
    {:else}
      <div class="summary">
        <span>{t('ipAssociations.accountCount', { count: fmtNumber(data.total) })}</span>
      </div>

      <div class="account-list">
        {#each data.accounts as account (account.accountId)}
          <section class="ip-account">
            <div class="account-heading">
              <div>
                <strong>
                  <AccountLink
                    accountId={account.accountId}
                    label={account.username}
                    onChanged={() => void refresh()}
                  />
                </strong>
                <span class="hint">{t('ipAssociations.accountId', { id: fmtNumber(account.accountId) })}</span>
                <AccountIndicators
                  isAdmin={account.isAdmin}
                  online={account.online}
                  status={account.status}
                  suspendedUntil={account.suspendedUntil}
                />
              </div>
              <span class="hint">{t('ipAssociations.lastSeen', { value: fmtDate(account.lastSeenAt) })}</span>
            </div>

            <div class="account-meta">{t('ipAssociations.createdAt', { value: fmtDate(account.createdAt) })}</div>

            {#if account.characters.length === 0}
              {#if account.createdWithIp && account.lastLoginWithIp}
                <div class="match-reason">{t('ipAssociations.matchedCreationAndLogin')}</div>
              {:else if account.createdWithIp}
                <div class="match-reason">{t('ipAssociations.matchedCreation')}</div>
              {:else if account.lastLoginWithIp}
                <div class="match-reason">{t('ipAssociations.matchedLastLogin')}</div>
              {/if}
              <div class="empty">{t('ipAssociations.noCharacters')}</div>
            {:else}
              <div class="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>{t('ipAssociations.colCharacter')}</th>
                      <th>{t('ipAssociations.colRealm')}</th>
                      <th>{t('ipAssociations.colLastSeen')}</th>
                      <th class="num">{t('ipAssociations.colSessions')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {#each account.characters as character (`${character.characterId ?? 'deleted'}:${character.characterName}`)}
                      <tr>
                        <td>
                          {character.characterName}
                          {#if character.characterId === null}
                            <span class="hint">{t('ipAssociations.deletedCharacter')}</span>
                          {/if}
                        </td>
                        <td>{character.realm ?? t('common.unknown')}</td>
                        <td>{fmtDate(character.lastSeenAt)}</td>
                        <td class="num">{fmtNumber(character.sessionCount)}</td>
                      </tr>
                    {/each}
                  </tbody>
                </table>
              </div>
            {/if}
          </section>
        {/each}
      </div>

      {#if data.total > data.limit}
        <Pager
          total={data.total}
          page={data.page}
          limit={data.limit}
          layout="footer"
          onPage={changePage}
        />
      {/if}
    {/if}
  </Panel>
</div>

{#if blockDialogOpen}
  <IpBlockDialog
    {ip}
    submitting={actionPending}
    onConfirm={(reason, duration) => void blockIp(reason, duration)}
    onCancel={() => {
      if (!actionPending) blockDialogOpen = false;
    }}
  />
{/if}

<style>
  .ip-page {
    display: grid;
    gap: 10px;
  }

  .back-link {
    display: inline-flex;
    align-items: center;
    width: fit-content;
  }

  .back-link:focus-visible {
    outline: 2px solid var(--gold);
    outline-offset: 2px;
  }

  .summary,
  .account-heading {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .summary {
    margin-bottom: 12px;
  }

  .block-action {
    border-color: var(--color-danger-border);
    color: var(--color-danger);
  }

  .block-action:hover {
    border-color: var(--color-danger);
    color: var(--text);
  }

  .account-list {
    display: grid;
    gap: 12px;
  }

  .ip-account {
    margin: 0;
    padding: 10px;
    background: var(--surface-sunken);
    border: 1px solid var(--border-subtle);
    border-radius: 4px;
  }

  .account-heading {
    justify-content: space-between;
    margin-bottom: 8px;
  }

  .account-heading > div {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .hint {
    color: var(--text-dim);
    font-size: var(--font-size-small);
  }

  .account-meta,
  .match-reason {
    color: var(--text-dim);
    font-size: var(--font-size-small);
  }

  .account-meta {
    margin-bottom: 8px;
  }

  .match-reason {
    margin-top: 4px;
  }

  @media (max-width: 700px) {
    .account-heading {
      align-items: flex-start;
      flex-direction: column;
    }
  }

  @media (pointer: coarse) {
    .back-link {
      min-width: 40px;
      min-height: 40px;
    }
  }
</style>
