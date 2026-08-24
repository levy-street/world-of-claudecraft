<script lang="ts">
  import { onMount } from 'svelte';
  import { apiGet, apiPost } from '../api';
  import AccountLink from '../components/AccountLink.svelte';
  import Badge from '../components/Badge.svelte';
  import Pager from '../components/Pager.svelte';
  import Panel from '../components/Panel.svelte';
  import {
    allowedFlagTransitions,
    type FlagStatus,
    flagGoldTrendCopper,
    flagSeverityBadgeVariant,
    flagSeverityLabelKey,
    flagSourceLabelKey,
    flagStatusBadgeVariant,
    flagStatusLabelKey,
  } from '../flag_workflow';
  import { fmtCopper, fmtDate, fmtNumber, fmtRelative } from '../format';
  import { localizeAdminError, t } from '../i18n';
  import { auth } from '../state/auth.svelte';
  import type { AccountFlagsData, FlagListData, SuspicionFlagEventRow } from '../types';

  // The Flagged workflow queue over the persisted suspicion-flag store: every
  // account the monitoring emitters flagged, with per-flag workflow state,
  // notes, and the audit trail. Clearing is always an explicit admin action;
  // cleared/actioned flags remain in each account's history.
  type StatusFilter = 'active' | FlagStatus | 'all';

  const FILTERS: readonly StatusFilter[] = [
    'active',
    'new',
    'under_review',
    'cleared',
    'actioned',
    'all',
  ];

  let data = $state<FlagListData | null>(null);
  let failed = $state(false);
  let filter = $state<StatusFilter>('active');
  let page = $state(1);
  let expandedFlagId = $state<number | null>(null);
  let expandedEvents = $state<SuspicionFlagEventRow[] | null>(null);
  let note = $state('');
  let actionError = $state('');
  let busy = $state(false);
  let requestId = 0;

  function filterLabel(value: StatusFilter): string {
    if (value === 'active') return t('flags.filterActive');
    if (value === 'all') return t('flags.filterAll');
    return t(flagStatusLabelKey(value));
  }

  function filterCount(value: StatusFilter): number | null {
    if (!data) return null;
    if (value === 'active') return data.counts.new + data.counts.under_review;
    if (value === 'all')
      return data.counts.new + data.counts.under_review + data.counts.cleared + data.counts.actioned;
    return data.counts[value];
  }

  async function refresh(): Promise<void> {
    const currentRequest = ++requestId;
    try {
      const params = new URLSearchParams({ status: filter, page: String(page) });
      const result = await apiGet<FlagListData>(`/admin/api/flags?${params}`);
      if (currentRequest !== requestId) return;
      data = result;
      failed = false;
    } catch (err) {
      if (currentRequest !== requestId) return;
      if (!auth.handleAuthFailure(err)) failed = true;
    }
  }

  function changeFilter(next: StatusFilter): void {
    filter = next;
    page = 1;
    expandedFlagId = null;
    void refresh();
  }

  async function toggleExpand(flagId: number, accountId: number): Promise<void> {
    actionError = '';
    note = '';
    if (expandedFlagId === flagId) {
      expandedFlagId = null;
      expandedEvents = null;
      return;
    }
    expandedFlagId = flagId;
    expandedEvents = null;
    try {
      const result = await apiGet<AccountFlagsData>(`/admin/api/accounts/${accountId}/flags`);
      if (expandedFlagId !== flagId) return;
      expandedEvents = result.events.filter((event) => event.flagId === flagId);
    } catch (err) {
      if (auth.handleAuthFailure(err)) return;
      if (expandedFlagId === flagId) expandedEvents = [];
    }
  }

  async function transition(flagId: number, to: FlagStatus): Promise<void> {
    busy = true;
    actionError = '';
    try {
      await apiPost(`/admin/api/flags/${flagId}/status`, { status: to, note: note.trim() });
      note = '';
      expandedFlagId = null;
      expandedEvents = null;
      await refresh();
    } catch (err) {
      if (!auth.handleAuthFailure(err)) {
        actionError = localizeAdminError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      busy = false;
    }
  }

  async function addNote(flagId: number, accountId: number): Promise<void> {
    if (!note.trim()) {
      actionError = t('flags.noteRequired');
      return;
    }
    busy = true;
    actionError = '';
    try {
      await apiPost(`/admin/api/flags/${flagId}/note`, { note: note.trim() });
      note = '';
      const result = await apiGet<AccountFlagsData>(`/admin/api/accounts/${accountId}/flags`);
      if (expandedFlagId === flagId) {
        expandedEvents = result.events.filter((event) => event.flagId === flagId);
      }
    } catch (err) {
      if (!auth.handleAuthFailure(err)) {
        actionError = localizeAdminError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      busy = false;
    }
  }

  function transitionLabel(to: FlagStatus): string {
    switch (to) {
      case 'under_review':
        return t('flags.actionReview');
      case 'cleared':
        return t('flags.actionClear');
      case 'actioned':
        return t('flags.actionActioned');
      case 'new':
        return t('flags.statusNew');
    }
  }

  onMount(() => {
    void refresh();
    return () => {
      requestId += 1;
    };
  });
</script>

<Panel>
  <p class="hint">{t('flags.hint')}</p>
  <div class="filters" role="tablist">
    {#each FILTERS as value (value)}
      <button
        type="button"
        role="tab"
        aria-selected={filter === value}
        class:active={filter === value}
        onclick={() => changeFilter(value)}
      >
        {filterLabel(value)}
        {#if filterCount(value) !== null}
          <span class="count">{fmtNumber(filterCount(value) ?? 0)}</span>
        {/if}
      </button>
    {/each}
  </div>
  {#if failed}
    <div class="empty">{t('flags.loadFailed')}</div>
  {:else if data === null}
    <div class="empty">{t('flags.loading')}</div>
  {:else if data.rows.length === 0}
    <div class="empty">{t('flags.empty')}</div>
  {:else}
    {#if data.truncated}
      <p class="hint">{t('flags.truncated')}</p>
    {/if}
    <div class="table-scroll">
      <table>
        <thead>
          <tr>
            <th>{t('accounts.colUsername')}</th>
            <th>{t('flags.colSource')}</th>
            <th>{t('flags.colSeverity')}</th>
            <th>{t('flags.colStatus')}</th>
            <th>{t('flags.colFirstFlagged')}</th>
            <th>{t('flags.colLastSeen')}</th>
            <th class="num">{t('flags.colGoldTrend')}</th>
          </tr>
        </thead>
        {#each data.rows as flag (flag.id)}
          {@const trend = flagGoldTrendCopper(flag)}
          <tbody>
            <tr class="clickable" onclick={() => void toggleExpand(flag.id, flag.accountId)}>
              <td>
                <AccountLink
                  accountId={flag.accountId}
                  label={flag.username}
                  onChanged={() => void refresh()}
                />
                {#if flag.bannedAt}
                  <Badge variant="bad">{t('accounts.badgeBanned')}</Badge>
                {:else if flag.suspendedUntil && new Date(flag.suspendedUntil) > new Date()}
                  <Badge variant="warn">{t('accounts.badgeSuspended')}</Badge>
                {/if}
              </td>
              <td>{t(flagSourceLabelKey(flag.source))}</td>
              <td>
                <Badge variant={flagSeverityBadgeVariant(flag.severity)}>
                  {t(flagSeverityLabelKey(flag.severity))}
                </Badge>
              </td>
              <td>
                <Badge variant={flagStatusBadgeVariant(flag.status)}>
                  {t(flagStatusLabelKey(flag.status))}
                </Badge>
                {#if flag.occurrences > 1}
                  <span class="text-dim">{t('flags.occurrences', { n: fmtNumber(flag.occurrences) })}</span>
                {/if}
              </td>
              <td>{fmtDate(flag.firstSeenAt)}</td>
              <td>{fmtRelative(flag.lastSeenAt)}</td>
              <td class="num">
                {#if trend === null}
                  {t('common.emptyValue')}
                {:else}
                  <span class:trend-up={trend > 0} class:trend-down={trend < 0}>
                    {trend >= 0 ? '+' : '-'}{fmtCopper(Math.abs(trend))}
                  </span>
                {/if}
              </td>
            </tr>
            {#if expandedFlagId === flag.id}
              <tr class="detail-row">
                <td colspan="7">
                  <div class="detail">
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
                    <div class="timeline">
                      <span class="text-dim">{t('flags.auditTrail')}</span>
                      {#if expandedEvents === null}
                        <span class="text-dim">{t('flags.loading')}</span>
                      {:else if expandedEvents.length === 0}
                        <span class="text-dim">{t('flags.noEvents')}</span>
                      {:else}
                        <ul>
                          {#each expandedEvents as event (event.id)}
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
                    </div>
                    {#if auth.can('moderation.act')}
                      <div class="workflow">
                        <textarea
                          rows="2"
                          placeholder={t('flags.notePlaceholder')}
                          bind:value={note}
                        ></textarea>
                        <div class="actions">
                          {#each allowedFlagTransitions(flag.status) as to (to)}
                            <button
                              type="button"
                              disabled={busy}
                              onclick={() => void transition(flag.id, to)}
                            >
                              {transitionLabel(to)}
                            </button>
                          {/each}
                          <button
                            type="button"
                            disabled={busy}
                            onclick={() => void addNote(flag.id, flag.accountId)}
                          >
                            {t('flags.actionAddNote')}
                          </button>
                        </div>
                        {#if actionError}
                          <p class="action-error">{actionError}</p>
                        {/if}
                      </div>
                    {/if}
                  </div>
                </td>
              </tr>
            {/if}
          </tbody>
        {/each}
      </table>
    </div>
    <Pager
      total={data.total}
      page={data.page}
      limit={data.limit}
      onPage={(nextPage) => {
        page = nextPage;
        void refresh();
      }}
    />
  {/if}
</Panel>

<style>
  .filters {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin: 10px 0 14px;
  }

  .filters button {
    padding: 5px 10px;
    background: var(--control-bg);
    border: 1px solid var(--control-border);
    border-radius: 4px;
    color: var(--text);
    cursor: pointer;
    font: inherit;
  }

  .filters button.active {
    border-color: var(--gold);
    color: var(--gold);
  }

  .filters .count {
    margin-left: 4px;
    color: var(--text-dim);
  }

  .detail-row td {
    background: var(--surface-sunken);
    white-space: normal;
  }

  .detail {
    display: grid;
    gap: 10px;
    padding: 6px 4px 10px;
  }

  .details-text {
    line-height: 1.5;
    overflow-wrap: anywhere;
    /* Emitter details may span several lines. */
    white-space: pre-line;
  }

  .related {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }

  .timeline ul {
    display: grid;
    gap: 4px;
    margin: 6px 0 0;
    padding: 0;
    list-style: none;
  }

  .timeline li {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    padding: 4px 8px;
    background: var(--surface-inset);
    border-left: 2px solid var(--gold-dim);
    border-radius: 2px;
  }

  .note-text {
    overflow-wrap: anywhere;
  }

  .workflow {
    display: grid;
    gap: 8px;
  }

  .workflow textarea {
    width: 100%;
    max-width: 520px;
    resize: vertical;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .action-error {
    color: var(--color-danger);
  }

  .trend-up {
    color: var(--color-danger);
  }

  .trend-down {
    color: var(--text-dim);
  }
</style>
