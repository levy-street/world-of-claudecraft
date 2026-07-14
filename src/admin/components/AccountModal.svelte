<script lang="ts">
  import { onMount } from 'svelte';
  import type { AccountDetail as AccountDetailData } from '../types';
  import { apiGet } from '../api';
  import { recentAccountIps } from '../account_ips';
  import { accountStatusFor } from '../account_status';
  import { auth } from '../state/auth.svelte';
  import { fmtDate, fmtNumber } from '../format';
  import { t } from '../i18n';
  import AccountDetail from '../pages/AccountDetail.svelte';
  import AccountIndicators from './AccountIndicators.svelte';
  import IpLink from './IpLink.svelte';
  import ModalDialog from './ModalDialog.svelte';

  let {
    accountId,
    onClose,
    onChanged,
  }: {
    accountId: number;
    onClose: () => void;
    onChanged?: () => void;
  } = $props();

  let detail = $state<AccountDetailData | null>(null);
  let failed = $state(false);
  let requestId = 0;

  let recentIps = $derived(detail ? recentAccountIps(detail) : []);

  async function refresh(clear = true): Promise<void> {
    const currentRequest = ++requestId;
    if (clear) detail = null;
    failed = false;
    try {
      const result = await apiGet<AccountDetailData>(`/admin/api/accounts/${accountId}`);
      if (currentRequest !== requestId) return;
      detail = result;
    } catch (err) {
      if (currentRequest !== requestId) return;
      if (!auth.handleAuthFailure(err)) failed = true;
    }
  }

  onMount(() => {
    void refresh();
    return () => {
      requestId += 1;
    };
  });
</script>

<ModalDialog
  labelledBy="account-modal-title"
  closeLabel={t('accountModal.close')}
  width="1240px"
  {onClose}
>
  <div class="account-modal-content">
    <header>
      <div>
        <div class="account-title">
          <h2 id="account-modal-title">
            {#if detail}
              {t('accountModal.title', { username: detail.username })}
            {:else}
              {t('accountModal.loadingTitle', { id: fmtNumber(accountId) })}
            {/if}
          </h2>
          {#if detail}
            <AccountIndicators
              isAdmin={detail.isAdmin}
              isAi={detail.isAi}
              isStreamer={detail.isStreamer}
              online={detail.online}
              status={accountStatusFor(detail)}
              suspendedUntil={detail.suspendedUntil}
              size="medium"
            />
          {/if}
        </div>
        {#if detail}
          <dl class="account-summary">
            <div>
              <dt>{t('accounts.colId')}</dt>
              <dd>{fmtNumber(detail.id)}</dd>
            </div>
            <div>
              <dt>{t('accounts.colRegistered')}</dt>
              <dd>{fmtDate(detail.createdAt)}</dd>
            </div>
            <div>
              <dt>{t('accounts.colLastLogin')}</dt>
              <dd>{detail.lastLogin ? fmtDate(detail.lastLogin) : t('common.never')}</dd>
            </div>
          </dl>
        {/if}
      </div>
      <button
        class="account-modal-close"
        type="button"
        data-modal-focus
        aria-label={t('accountModal.close')}
        onclick={onClose}
      >
        <span aria-hidden="true"></span>
      </button>
    </header>

    <div class="account-modal-body">
      {#if failed}
        <div class="empty">{t('accountModal.loadFailed')}</div>
      {:else if detail === null}
        <div class="empty">{t('accountModal.loading')}</div>
      {:else}
        <AccountDetail
          {detail}
          includeAdminControls={auth.can('moderation.act')}
          onChanged={() => {
            void refresh(false);
            onChanged?.();
          }}
        />
        <section class="recent-ips">
          <h3>{t('accountModal.recentIps')}</h3>
          {#if recentIps.length === 0}
            <div class="empty">{t('blockedIps.noKnownIps')}</div>
          {:else}
            <div class="recent-ip-list">
              {#each recentIps as entry (entry.ip)}
                <div class="recent-ip">
                  <IpLink ip={entry.ip} />
                  <span>
                    {entry.lastSeenAt
                      ? fmtDate(entry.lastSeenAt)
                      : t('common.unknown')}
                  </span>
                </div>
              {/each}
            </div>
          {/if}
        </section>
      {/if}
    </div>
  </div>
</ModalDialog>

<style>
  header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
    padding: 16px 18px;
    border-bottom: 1px solid var(--border-subtle);
  }

  h2 {
    color: var(--gold);
    font-family: var(--title-font);
    font-size: 21px;
    line-height: 1.2;
    text-shadow: 1px 1px 2px #000;
  }

  .account-title {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .account-summary {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 18px;
    margin-top: 8px;
    color: var(--text-dim);
    font-size: var(--font-size-small);
  }

  .account-summary div {
    display: flex;
    gap: 5px;
  }

  .account-summary dt::after {
    content: ":";
  }

  .account-summary dd {
    color: var(--text-soft);
  }

  .account-modal-close {
    position: relative;
    width: 40px;
    min-width: 40px;
    height: 40px;
    padding: 0;
    background: var(--btn-flat-bg);
  }

  .account-modal-close span::before,
  .account-modal-close span::after {
    content: "";
    position: absolute;
    top: 18px;
    left: 9px;
    width: 20px;
    height: 2px;
    background: currentColor;
  }

  .account-modal-close span::before {
    transform: rotate(45deg);
  }

  .account-modal-close span::after {
    transform: rotate(-45deg);
  }

  .account-modal-body {
    max-height: calc(100vh - 145px);
    overflow: auto;
    padding: 18px;
    container-type: inline-size;
  }

  .recent-ips {
    margin: 18px 0 0;
    padding-top: 14px;
    border-top: 1px solid var(--border-subtle);
  }

  .recent-ips h3 {
    margin-bottom: 10px;
    color: var(--gold-dim);
    font-family: var(--title-font);
    font-size: 15px;
  }

  .recent-ip-list {
    display: grid;
    gap: 6px;
  }

  .recent-ip {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 7px 9px;
    background: var(--surface-inset);
    border: 1px solid var(--border-subtle);
    border-radius: 4px;
  }

  .recent-ip span {
    color: var(--text-dim);
    font-size: var(--font-size-small);
  }

  @media (max-width: 800px) {
    header {
      padding: 12px 14px;
    }

    .account-modal-body {
      max-height: calc(100vh - 120px);
      padding: 14px;
    }
  }
</style>
