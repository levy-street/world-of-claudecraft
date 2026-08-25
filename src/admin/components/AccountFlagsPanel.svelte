<script lang="ts">
  import { onMount } from 'svelte';
  import { apiGet } from '../api';
  import {
    flagGoldTrendCopper,
    flagSeverityBadgeVariant,
    flagSeverityLabelKey,
    flagSourceLabelKey,
    flagStatusBadgeVariant,
    flagStatusLabelKey,
  } from '../flag_workflow';
  import { fmtCopper, fmtDate, fmtNumber } from '../format';
  import { t } from '../i18n';
  import { auth } from '../state/auth.svelte';
  import type { AccountFlagsData } from '../types';
  import AccountLink from './AccountLink.svelte';
  import Badge from './Badge.svelte';

  // The account detail's flag history: every suspicion flag ever raised on the
  // account (active AND resolved; flags never silently disappear) with the
  // per-flag workflow audit trail. Workflow WRITES live on the Flagged page;
  // this panel is the read-side record.
  let { accountId }: { accountId: number } = $props();

  let data = $state<AccountFlagsData | null>(null);
  let failed = $state(false);
  let requestId = 0;

  async function refresh(): Promise<void> {
    const currentRequest = ++requestId;
    try {
      const result = await apiGet<AccountFlagsData>(`/admin/api/accounts/${accountId}/flags`);
      if (currentRequest !== requestId) return;
      data = result;
      failed = false;
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

<div class="flags-panel">
  <h4>{t('flags.accountHeader')}</h4>
  {#if failed}
    <div class="empty">{t('flags.loadFailed')}</div>
  {:else if data === null}
    <div class="empty">{t('flags.loading')}</div>
  {:else if data.flags.length === 0}
    <div class="empty">{t('flags.accountEmpty')}</div>
  {:else}
    <ul class="flag-list">
      {#each data.flags as flag (flag.id)}
        {@const trend = flagGoldTrendCopper(flag)}
        {@const events = data.events.filter((event) => event.flagId === flag.id)}
        <li>
          <div class="flag-head">
            <Badge variant={flagStatusBadgeVariant(flag.status)}>
              {t(flagStatusLabelKey(flag.status))}
            </Badge>
            <Badge variant={flagSeverityBadgeVariant(flag.severity)}>
              {t(flagSeverityLabelKey(flag.severity))}
            </Badge>
            <span>{t(flagSourceLabelKey(flag.source))}</span>
            <span class="text-dim">
              {t('flags.firstFlaggedAt', { when: fmtDate(flag.firstSeenAt) })}
            </span>
            {#if flag.occurrences > 1}
              <span class="text-dim">{t('flags.occurrences', { n: fmtNumber(flag.occurrences) })}</span>
            {/if}
            {#if trend !== null}
              <span class="text-dim">
                {t('flags.goldTrend', {
                  amount: `${trend >= 0 ? '+' : '-'}${fmtCopper(Math.abs(trend))}`,
                })}
              </span>
            {/if}
          </div>
          <p class="details-text">{flag.details}</p>
          {#if flag.relatedAccounts.length > 0}
            <div class="related">
              <span class="text-dim">{t('flags.relatedAccounts')}</span>
              {#each flag.relatedAccounts as related (related.accountId)}
                <AccountLink
                  accountId={related.accountId}
                  label={related.username ?? fmtNumber(related.accountId)}
                />
              {/each}
            </div>
          {/if}
          {#if events.length > 0}
            <ul class="events">
              {#each events as event (event.id)}
                <li>
                  <span class="text-dim">{fmtDate(event.createdAt)}</span>
                  <span>{event.adminUsername ?? t('common.emptyValue')}</span>
                  {#if event.fromStatus && event.toStatus}
                    <span>
                      {t(flagStatusLabelKey(event.fromStatus))}
                      <span aria-hidden="true">&rarr;</span>
                      {t(flagStatusLabelKey(event.toStatus))}
                    </span>
                  {:else}
                    <span>{t('flags.eventNote')}</span>
                  {/if}
                  {#if event.note}<span class="note-text">{event.note}</span>{/if}
                </li>
              {/each}
            </ul>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .flags-panel {
    display: grid;
    gap: 8px;
  }

  .flag-list {
    display: grid;
    gap: 10px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .flag-list > li {
    display: grid;
    gap: 6px;
    padding: 8px 10px;
    background: var(--surface-inset);
    border-left: 2px solid var(--gold-dim);
    border-radius: 2px;
  }

  .flag-head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }

  .details-text {
    line-height: 1.5;
    overflow-wrap: anywhere;
  }

  .related {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }

  .events {
    display: grid;
    gap: 3px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .events li {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    font-size: var(--font-size-small);
  }

  .note-text {
    overflow-wrap: anywhere;
  }
</style>
