<script lang="ts">
  import { onMount } from 'svelte';
  import { apiGet } from '../api';
  import {
    dailyRewardEventPresentation,
    rewardEventDate,
  } from '../daily_reward_event_log';
  import { fmtDate, fmtNumber } from '../format';
  import { t } from '../i18n';
  import { auth } from '../state/auth.svelte';
  import type { DailyRewardPointEventLog } from '../types';

  let { accountId }: { accountId: number } = $props();

  let day = $state('');
  let currentRewardDay = $state('');
  let data = $state<DailyRewardPointEventLog | null>(null);
  let loading = $state(false);
  let failed = $state(false);
  let requestId = 0;

  async function refresh(): Promise<void> {
    const currentRequest = ++requestId;
    loading = true;
    failed = false;
    try {
      const params = new URLSearchParams({ limit: '100' });
      if (day) params.set('day', day);
      const result = await apiGet<DailyRewardPointEventLog>(
        `/admin/api/accounts/${accountId}/daily-rewards-events?${params}`,
      );
      if (currentRequest !== requestId) return;
      data = result;
      if (!currentRewardDay) currentRewardDay = result.day;
      if (!day) day = result.day;
    } catch (err) {
      if (currentRequest !== requestId) return;
      if (!auth.handleAuthFailure(err)) failed = true;
    } finally {
      if (currentRequest === requestId) loading = false;
    }
  }

  function selectRelativeDay(offset: number): void {
    const baseDay = currentRewardDay || data?.day;
    if (!baseDay) return;
    day = rewardEventDate(baseDay, offset);
    void refresh();
  }

  onMount(() => {
    void refresh();
    return () => {
      requestId += 1;
    };
  });
</script>

<section class="reward-events">
  <div class="reward-events-toolbar">
    <label>
      <span>{t('accountRewards.date')}</span>
      <input type="date" bind:value={day} onchange={() => void refresh()} />
    </label>
    <div class="relative-days">
      <button type="button" disabled={loading} onclick={() => selectRelativeDay(0)}>
        {t('accountRewards.today')}
      </button>
      <button type="button" disabled={loading} onclick={() => selectRelativeDay(-1)}>
        {t('accountRewards.yesterday')}
      </button>
    </div>
  </div>

  {#if loading && data === null}
    <div class="empty">{t('accountRewards.loading')}</div>
  {:else if failed}
    <div class="empty">{t('accountRewards.loadFailed')}</div>
  {:else if data && data.rows.length === 0}
    <div class="empty">{t('accountRewards.empty')}</div>
  {:else if data}
    <div class="reward-events-summary">
      {t('accountRewards.summary', {
        events: fmtNumber(data.total),
        points: fmtNumber(data.rows[0]?.totalPoints ?? 0),
      })}
      {#if data.truncated}
        <span>
          {t('accountRewards.truncated', {
            shown: fmtNumber(data.rows.length),
            total: fmtNumber(data.total),
          })}
        </span>
      {/if}
      {#if loading}<span>{t('accountRewards.loading')}</span>{/if}
    </div>
    <div class="table-scroll">
      <table>
        <thead>
          <tr>
            <th>{t('accountRewards.colTimestamp')}</th>
            <th class="num">{t('accountRewards.colPoints')}</th>
            <th class="num">{t('accountRewards.colTotal')}</th>
            <th>{t('accountRewards.colAction')}</th>
          </tr>
        </thead>
        <tbody>
          {#each data.rows as event (event.id)}
            {@const presented = dailyRewardEventPresentation(event)}
            <tr>
              <td><time datetime={event.createdAt}>{fmtDate(event.createdAt)}</time></td>
              <td class="num positive">+{fmtNumber(event.points)}</td>
              <td class="num">{fmtNumber(event.totalPoints)}</td>
              <td class="event-action">
                <strong>{presented.action}</strong>
                {#if presented.details.length > 0}
                  <small>{presented.details.join(' · ')}</small>
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</section>

<style>
  .reward-events {
    min-height: 260px;
  }

  .reward-events-toolbar {
    display: flex;
    align-items: end;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 14px;
  }

  .reward-events-toolbar label {
    display: grid;
    gap: 5px;
    color: var(--text-dim);
    font-size: var(--font-size-small);
  }

  .relative-days {
    display: flex;
    gap: 8px;
  }

  .reward-events-summary {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 16px;
    margin-bottom: 10px;
    color: var(--text-soft);
    font-size: var(--font-size-small);
  }

  .reward-events-summary span {
    color: var(--text-dim);
  }

  .positive {
    color: var(--success);
    font-weight: 700;
  }

  .event-action {
    min-width: 280px;
  }

  .event-action strong,
  .event-action small {
    display: block;
  }

  .event-action small {
    margin-top: 3px;
    color: var(--text-dim);
  }

  @media (max-width: 680px) {
    .reward-events-toolbar {
      align-items: stretch;
      flex-direction: column;
    }

    .relative-days button {
      flex: 1;
    }
  }
</style>
