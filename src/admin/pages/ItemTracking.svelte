<script lang="ts">
  import { onMount } from 'svelte';
  import { apiGet } from '../api';
  import Badge from '../components/Badge.svelte';
  import Panel from '../components/Panel.svelte';
  import PermissionDenied from '../components/PermissionDenied.svelte';
  import { fmtDate, fmtNumber } from '../format';
  import { t } from '../i18n';
  import { type AdminLoadFailure, classifyAdminLoadFailure } from '../load_failure';
  import type { ItemLedgerEvent, ItemLedgerHistory, ItemLedgerPage } from '../types';

  const PAGE_LIMIT = 50;
  const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

  // The recent-events feed (newest first, cursor-paged) and the per-guid
  // lookup are two independent reads on one page: the feed answers "what
  // dropped lately", the lookup answers "where has THIS copy been".
  let feed = $state<ItemLedgerPage | null>(null);
  let feedFailed = $state<AdminLoadFailure>('none');
  let loadingMore = $state(false);
  let loadMoreFailed = $state(false);
  let feedRequest = 0;

  let guidInput = $state('');
  let history = $state<ItemLedgerHistory | null>(null);
  let historyFailed = $state<AdminLoadFailure>('none');
  let historyInvalid = $state(false);
  let historyLoading = $state(false);
  let historyRequest = 0;

  function kindLabel(kind: ItemLedgerEvent['kind']): string {
    switch (kind) {
      case 'mint':
        return t('itemTracking.kind.mint');
      case 'transfer':
        return t('itemTracking.kind.transfer');
      case 'modify':
        return t('itemTracking.kind.modify');
      case 'consume':
        return t('itemTracking.kind.consume');
      case 'derive':
        return t('itemTracking.kind.derive');
    }
  }

  // A copy's birth reads green, its end amber: a guid seen in any row AFTER
  // its consume row is a duplicate, so the end has to stand out.
  function kindVariant(kind: ItemLedgerEvent['kind']): 'success' | 'neutral' | 'warn' {
    if (kind === 'mint' || kind === 'derive') return 'success';
    return kind === 'consume' ? 'warn' : 'neutral';
  }

  async function loadFeed(beforeId: number | null): Promise<void> {
    const append = beforeId !== null;
    const current = ++feedRequest;
    if (append) {
      loadingMore = true;
      loadMoreFailed = false;
    } else {
      feed = null;
      feedFailed = 'none';
    }
    try {
      const params = new URLSearchParams({ limit: String(PAGE_LIMIT) });
      if (beforeId !== null) params.set('beforeId', String(beforeId));
      const result = await apiGet<ItemLedgerPage>(`/admin/api/item-ledger?${params}`);
      if (current !== feedRequest) return;
      feed =
        append && feed !== null ? { ...result, events: [...feed.events, ...result.events] } : result;
      feedFailed = 'none';
      loadMoreFailed = false;
    } catch (err) {
      if (current !== feedRequest) return;
      if (append) loadMoreFailed = true;
      else feedFailed = classifyAdminLoadFailure(err);
    } finally {
      if (current === feedRequest) loadingMore = false;
    }
  }

  async function lookup(): Promise<void> {
    const guid = guidInput.trim().toLowerCase();
    historyInvalid = !GUID_RE.test(guid);
    if (historyInvalid) {
      history = null;
      return;
    }
    const current = ++historyRequest;
    historyLoading = true;
    historyFailed = 'none';
    try {
      const result = await apiGet<ItemLedgerHistory>(`/admin/api/items/${guid}`);
      if (current !== historyRequest) return;
      history = result;
    } catch (err) {
      if (current !== historyRequest) return;
      history = null;
      historyFailed = classifyAdminLoadFailure(err);
    } finally {
      if (current === historyRequest) historyLoading = false;
    }
  }

  function pick(guid: string): void {
    guidInput = guid;
    void lookup();
  }

  onMount(() => {
    void loadFeed(null);
  });
</script>

{#snippet EventRows(events: ItemLedgerEvent[])}
  {#each events as ev (ev.id)}
    <tr>
      <td>{fmtDate(ev.occurredAt)}</td>
      <td><Badge variant={kindVariant(ev.kind)}>{kindLabel(ev.kind)}</Badge></td>
      <td class="mono">{ev.itemId}</td>
      <td>{ev.quality}</td>
      <td>{ev.characterName}</td>
      <td class="mono">{ev.source}</td>
      <td class="mono">{ev.zone ?? ''}</td>
      <td class="mono">{ev.detail ?? ''}</td>
      <td>
        <button type="button" class="link-button mono" onclick={() => pick(ev.guid)}>
          {ev.guid}
        </button>
      </td>
      <td>
        {#if ev.relatedGuid}
          <button
            type="button"
            class="link-button mono"
            onclick={() => ev.relatedGuid && pick(ev.relatedGuid)}
          >
            {ev.relatedGuid}
          </button>
        {/if}
      </td>
    </tr>
  {/each}
{/snippet}

<div class="item-tracking-page">
  <p class="description">{t('itemTracking.description')}</p>

  <Panel title={t('itemTracking.lookupTitle')} hint={t('itemTracking.lookupHint')}>
    <form
      class="lookup-form"
      onsubmit={(e) => {
        e.preventDefault();
        void lookup();
      }}
    >
      <label class="lookup-label">
        <span>{t('itemTracking.guidLabel')}</span>
        <input
          type="text"
          bind:value={guidInput}
          placeholder={t('itemTracking.guidPlaceholder')}
          spellcheck="false"
          autocomplete="off"
        />
      </label>
      <button type="submit" disabled={historyLoading}>{t('itemTracking.lookup')}</button>
    </form>
    {#if historyInvalid}
      <div class="request-state" role="alert">{t('itemTracking.invalidGuid')}</div>
    {:else if historyFailed === 'forbidden'}
      <PermissionDenied />
    {:else if historyFailed === 'error'}
      <div class="request-state" role="alert">{t('itemTracking.lookupFailed')}</div>
    {:else if historyLoading}
      <div class="request-state" role="status">{t('itemTracking.loading')}</div>
    {:else if history !== null}
      {#if history.events.length === 0}
        <div class="empty">{t('itemTracking.emptyHistory')}</div>
      {:else}
        <!-- svelte-ignore a11y_no_noninteractive_tabindex (keyboard-scrollable table region) -->
        <div
          class="table-scroll"
          role="region"
          aria-label={t('itemTracking.historyCaption')}
          tabindex="0"
        >
          <table class="ledger-table">
            <caption>{t('itemTracking.historyCaption')}</caption>
            <thead>
              <tr>
                <th>{t('itemTracking.colWhen')}</th>
                <th>{t('itemTracking.colEvent')}</th>
                <th>{t('itemTracking.colItem')}</th>
                <th>{t('itemTracking.colQuality')}</th>
                <th>{t('itemTracking.colCharacter')}</th>
                <th>{t('itemTracking.colSource')}</th>
                <th>{t('itemTracking.colZone')}</th>
                <th>{t('itemTracking.colDetail')}</th>
                <th>{t('itemTracking.colGuid')}</th>
                <th>{t('itemTracking.colRelated')}</th>
              </tr>
            </thead>
            <tbody>{@render EventRows(history.events)}</tbody>
          </table>
        </div>
      {/if}
    {/if}
  </Panel>

  {#if feedFailed === 'forbidden'}
    <Panel>
      <PermissionDenied />
    </Panel>
  {:else if feedFailed === 'error'}
    <Panel>
      <div class="request-state" role="alert">
        <p>{t('itemTracking.loadFailed')}</p>
        <button type="button" onclick={() => void loadFeed(null)}>{t('itemTracking.retry')}</button>
      </div>
    </Panel>
  {:else if feed === null}
    <Panel>
      <div class="request-state" role="status">{t('itemTracking.loading')}</div>
    </Panel>
  {:else}
    <Panel title={t('itemTracking.recentTitle')} hint={t('itemTracking.recentHint')}>
      {#if feed.events.length === 0}
        <div class="empty">{t('itemTracking.emptyRecent')}</div>
      {:else}
        <!-- svelte-ignore a11y_no_noninteractive_tabindex (keyboard-scrollable table region) -->
        <div
          class="table-scroll"
          role="region"
          aria-label={t('itemTracking.recentCaption')}
          tabindex="0"
        >
          <table class="ledger-table">
            <caption>{t('itemTracking.recentCaption')}</caption>
            <thead>
              <tr>
                <th>{t('itemTracking.colWhen')}</th>
                <th>{t('itemTracking.colEvent')}</th>
                <th>{t('itemTracking.colItem')}</th>
                <th>{t('itemTracking.colQuality')}</th>
                <th>{t('itemTracking.colCharacter')}</th>
                <th>{t('itemTracking.colSource')}</th>
                <th>{t('itemTracking.colZone')}</th>
                <th>{t('itemTracking.colDetail')}</th>
                <th>{t('itemTracking.colGuid')}</th>
                <th>{t('itemTracking.colRelated')}</th>
              </tr>
            </thead>
            <tbody>{@render EventRows(feed.events)}</tbody>
          </table>
        </div>
        {#if feed.hasMore}
          <div class="load-more">
            <button
              type="button"
              disabled={loadingMore}
              onclick={() => void loadFeed(feed?.nextBeforeId ?? null)}
            >
              {loadingMore ? t('itemTracking.loadingMore') : t('itemTracking.loadMore')}
            </button>
            {#if loadMoreFailed}
              <span role="alert">{t('itemTracking.loadMoreFailed')}</span>
            {/if}
          </div>
        {/if}
        <p class="count">{t('itemTracking.shown', { count: fmtNumber(feed.events.length) })}</p>
      {/if}
    </Panel>
  {/if}
</div>

<style>
  .item-tracking-page {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .description {
    margin: 0;
    color: var(--muted);
  }
  .lookup-form {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: flex-end;
    margin-bottom: 12px;
  }
  .lookup-label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    flex: 1 1 320px;
  }
  .lookup-label input {
    width: 100%;
    font-family: var(--mono, monospace);
  }
  .mono {
    font-family: var(--mono, monospace);
    font-size: 0.9em;
    word-break: break-all;
  }
  .link-button {
    background: none;
    border: none;
    padding: 0;
    color: var(--link, inherit);
    cursor: pointer;
    text-decoration: underline;
  }
  .table-scroll {
    overflow-x: auto;
  }
  .ledger-table {
    width: 100%;
    border-collapse: collapse;
  }
  .ledger-table th,
  .ledger-table td {
    text-align: left;
    padding: 6px 8px;
    border-bottom: 1px solid var(--border);
    vertical-align: top;
  }
  .ledger-table caption {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
  }
  .empty,
  .request-state {
    padding: 12px 0;
    color: var(--muted);
  }
  .load-more {
    display: flex;
    gap: 12px;
    align-items: center;
    margin-top: 12px;
  }
  .count {
    margin: 8px 0 0;
    color: var(--muted);
  }
</style>
