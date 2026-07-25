<script lang="ts">
  import { onMount } from 'svelte';
  import type { AdminPluginRow, AdminPluginsData, PendingPluginVersionRow } from '../types';
  import { apiGet, apiPost } from '../api';
  import { auth } from '../state/auth.svelte';
  import { localizeAdminError, t } from '../i18n';
  import { fmtDate, fmtNumber, fmtRelative } from '../format';
  import {
    type PluginReviewAction,
    buildReviewRequest,
    flagsSummary,
    pluginCategoryKey,
    pluginStatusKey,
    pluginStatusVariant,
  } from '../plugin_review';
  import AccountLink from '../components/AccountLink.svelte';
  import Badge from '../components/Badge.svelte';
  import ConfirmDialog from '../components/ConfirmDialog.svelte';
  import ModerationActionPrompt from '../components/ModerationActionPrompt.svelte';
  import Pager from '../components/Pager.svelte';
  import Panel from '../components/Panel.svelte';

  // Plugin store moderation: the pending-version review queue (approve/reject
  // with a note through the moderation prompt; a rejection requires the note so
  // the author gets feedback) and the paginated all-plugins list with the
  // delist/relist kill switch. Fetches on mount plus a manual refresh (the
  // sibling moderation pages' model); the server re-checks content.moderate on
  // every call. Source and metadata are author-controlled text and render only
  // through Svelte {...} auto-escaping, never {@html}.
  const LIMIT = 50;

  let queue = $state<PendingPluginVersionRow[] | null>(null);
  let queueFailed = $state(false);
  let plugins = $state<AdminPluginsData | null>(null);
  let pluginsFailed = $state(false);
  let page = $state(1);
  let review = $state<{ row: PendingPluginVersionRow; action: PluginReviewAction } | null>(null);
  let listing = $state<{ row: AdminPluginRow; relist: boolean } | null>(null);

  async function refreshQueue(): Promise<void> {
    try {
      const data = await apiGet<{ rows: PendingPluginVersionRow[] }>('/admin/api/plugins/pending');
      queue = data.rows;
      queueFailed = false;
    } catch (err) {
      if (!auth.handleAuthFailure(err)) queueFailed = true;
    }
  }

  async function refreshPlugins(): Promise<void> {
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(LIMIT) });
      plugins = await apiGet<AdminPluginsData>(`/admin/api/plugins?${params}`);
      pluginsFailed = false;
    } catch (err) {
      if (!auth.handleAuthFailure(err)) pluginsFailed = true;
    }
  }

  function refreshAll(): void {
    void refreshQueue();
    void refreshPlugins();
  }

  function fail(err: unknown, fallbackKey: string): void {
    if (!auth.handleAuthFailure(err)) {
      window.alert(err instanceof Error ? localizeAdminError(err.message) : t(fallbackKey));
    }
  }

  async function confirmReview(values: { reason: string }): Promise<void> {
    const pending = review;
    if (!pending) return;
    const built = buildReviewRequest(pending.row.versionId, pending.action, values.reason);
    if ('errorKey' in built) {
      window.alert(t(built.errorKey));
      return;
    }
    try {
      await apiPost(built.request.endpoint, built.request.body);
      review = null;
      // An approval flips the plugin's status and live version, so both the
      // queue and the all-plugins table reload.
      refreshAll();
    } catch (err) {
      fail(err, 'alert.pluginReviewFailed');
    }
  }

  async function confirmListing(): Promise<void> {
    const pending = listing;
    if (!pending) return;
    const action = pending.relist ? 'relist' : 'delist';
    try {
      await apiPost(`/admin/api/plugins/${pending.row.id}/${action}`, {});
      listing = null;
      void refreshPlugins();
    } catch (err) {
      fail(err, 'alert.pluginListingFailed');
    }
  }

  onMount(() => {
    refreshAll();
  });
</script>

{#snippet author(accountId: number | null, handle: string | null)}
  {#if accountId !== null}
    <AccountLink {accountId} label={handle ?? `#${fmtNumber(accountId)}`} />
  {:else}
    {handle ?? t('common.unknown')}
  {/if}
{/snippet}

<Panel title={t('plugins.queue.title')} hint={t('plugins.queue.hint')}>
  <div class="queue-toolbar">
    <button type="button" onclick={() => refreshAll()}>{t('plugins.refresh')}</button>
  </div>
  {#if queueFailed}
    <div class="empty">{t('plugins.queue.loadFailed')}</div>
  {:else if queue && queue.length === 0}
    <div class="empty">{t('plugins.queue.empty')}</div>
  {:else if queue}
    <div class="review-queue">
      {#each queue as row (row.versionId)}
        {@const chips = flagsSummary(row.screen)}
        {@const categoryKey = pluginCategoryKey(row.category)}
        <article class="review-item">
          <header class="review-head">
            <h4>{row.name}</h4>
            <code>{row.slug}</code>
            <Badge variant="neutral" size="medium">
              {t('plugins.queue.version', { version: fmtNumber(row.version) })}
            </Badge>
            {#if row.isUpdate}
              <Badge variant="neutral" size="medium">{t('plugins.queue.update')}</Badge>
            {:else}
              <Badge size="medium">{t('plugins.queue.newListing')}</Badge>
            {/if}
            <Badge variant="neutral" size="medium">
              {categoryKey ? t(categoryKey) : row.category}
            </Badge>
          </header>
          <dl class="review-fields">
            <dt>{t('plugins.colAuthor')}</dt>
            <dd>{@render author(row.accountId, row.author)}</dd>
            <dt>{t('plugins.queue.submitted')}</dt>
            <dd>
              <time datetime={row.submittedAt}>{fmtDate(row.submittedAt)}</time>
              ({fmtRelative(row.submittedAt)})
            </dd>
            <dt>{t('plugins.queue.summary')}</dt>
            <dd>{row.summary || t('common.emptyValue')}</dd>
            <dt>{t('plugins.queue.description')}</dt>
            <dd class="review-prose">{row.description || t('common.emptyValue')}</dd>
            <dt>{t('plugins.queue.notes')}</dt>
            <dd class="review-prose">{row.notes || t('plugins.queue.noNotes')}</dd>
          </dl>
          <div class="review-flags" aria-label={t('plugins.queue.flags')}>
            {#if chips.length === 0}
              <Badge variant="success" size="medium">{t('plugins.queue.noFlags')}</Badge>
            {:else}
              {#each chips as chip (chip.code)}
                <Badge variant="warn" size="medium">
                  {t('plugins.queue.flagChip', {
                    label: chip.labelKey ? t(chip.labelKey) : chip.code,
                    line: fmtNumber(chip.line),
                  })}
                </Badge>
              {/each}
            {/if}
          </div>
          <div class="review-source">
            <div class="review-source-label">{t('plugins.queue.source')}</div>
            <pre>{row.source}</pre>
          </div>
          {#if review && review.row.versionId === row.versionId}
            <ModerationActionPrompt
              title={review.action === 'approve'
                ? t('plugins.queue.confirmApprove')
                : t('plugins.queue.confirmReject')}
              rows={[
                { label: t('plugins.colName'), value: `${row.name} (${row.slug})` },
                {
                  label: t('plugins.colVersion'),
                  value: t('plugins.queue.version', { version: fmtNumber(row.version) }),
                },
              ]}
              reasonRequired={review.action === 'reject'}
              reasonPlaceholder={review.action === 'reject'
                ? t('plugins.queue.rejectNotePlaceholder')
                : t('plugins.queue.approveNotePlaceholder')}
              danger={review.action === 'reject'}
              onConfirm={confirmReview}
              onCancel={() => (review = null)}
            />
          {:else}
            <div class="review-actions">
              <button type="button" onclick={() => (review = { row, action: 'approve' })}>
                {t('plugins.queue.approve')}
              </button>
              <button
                type="button"
                class="danger"
                onclick={() => (review = { row, action: 'reject' })}
              >
                {t('plugins.queue.reject')}
              </button>
            </div>
          {/if}
        </article>
      {/each}
    </div>
  {/if}
</Panel>

<Panel title={t('plugins.table.title')} hint={t('plugins.table.hint')}>
  {#if pluginsFailed}
    <div class="empty">{t('plugins.table.loadFailed')}</div>
  {:else if plugins && plugins.rows.length === 0}
    <div class="empty">{t('plugins.table.empty')}</div>
  {:else if plugins}
    <div class="table-scroll">
      <table>
        <thead>
          <tr>
            <th>{t('plugins.colName')}</th>
            <th>{t('plugins.colSlug')}</th>
            <th>{t('plugins.colStatus')}</th>
            <th>{t('plugins.colCategory')}</th>
            <th>{t('plugins.colAuthor')}</th>
            <th class="num">{t('plugins.colInstalls')}</th>
            <th class="num">{t('plugins.colVersion')}</th>
            <th>{t('plugins.colUpdated')}</th>
            <th>{t('detail.colActions')}</th>
          </tr>
        </thead>
        <tbody>
          {#each plugins.rows as row (row.id)}
            {@const categoryKey = pluginCategoryKey(row.category)}
            <tr>
              <td>{row.name}</td>
              <td><code>{row.slug}</code></td>
              <td>
                <Badge variant={pluginStatusVariant(row.status)} size="medium">
                  {t(pluginStatusKey(row.status))}
                </Badge>
              </td>
              <td>{categoryKey ? t(categoryKey) : row.category}</td>
              <td>{@render author(row.accountId, row.author)}</td>
              <td class="num">{fmtNumber(row.installs)}</td>
              <td class="num">
                {row.liveVersion === null ? t('common.emptyValue') : fmtNumber(row.liveVersion)}
              </td>
              <td>{fmtRelative(row.updatedAt)}</td>
              <td>
                {#if row.status === 'listed'}
                  <button
                    type="button"
                    class="danger"
                    onclick={() => (listing = { row, relist: false })}
                  >
                    {t('plugins.table.delist')}
                  </button>
                {:else if row.status === 'delisted'}
                  <button type="button" onclick={() => (listing = { row, relist: true })}>
                    {t('plugins.table.relist')}
                  </button>
                {:else}
                  {t('common.emptyValue')}
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    {#if listing}
      {@const warningRows = listing.relist
        ? []
        : [{ label: t('dialog.warning'), value: t('plugins.table.delistWarning') }]}
      <ConfirmDialog
        title={listing.relist ? t('plugins.table.confirmRelist') : t('plugins.table.confirmDelist')}
        rows={[
          { label: t('plugins.colName'), value: listing.row.name },
          { label: t('plugins.colSlug'), value: listing.row.slug },
          ...warningRows,
        ]}
        danger={!listing.relist}
        onConfirm={() => void confirmListing()}
        onCancel={() => (listing = null)}
      />
    {/if}
    <Pager
      total={plugins.total}
      page={plugins.page}
      limit={plugins.limit}
      layout="footer"
      onPage={(nextPage) => {
        page = nextPage;
        void refreshPlugins();
      }}
    />
  {/if}
</Panel>

<style>
  .queue-toolbar {
    display: flex;
    justify-content: flex-end;
    margin-bottom: 10px;
  }

  .review-queue {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .review-item {
    border: 1px solid var(--border-subtle);
    border-radius: 6px;
    padding: 12px;
    background: var(--surface-inset);
  }

  .review-head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
  }

  .review-head h4 {
    font-family: var(--title-font);
    color: var(--gold-dim);
    font-size: var(--font-size-section);
  }

  .review-head code,
  td code {
    background: var(--surface-sunken);
    padding: 2px 6px;
    border-radius: 3px;
  }

  .review-fields {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 4px 14px;
    margin-bottom: 10px;
  }

  .review-fields dt {
    color: var(--text-dim);
    font-size: var(--font-size-small);
    text-transform: uppercase;
    letter-spacing: 0.6px;
    padding-top: 1px;
  }

  .review-fields dd {
    overflow-wrap: anywhere;
  }

  .review-prose {
    white-space: pre-wrap;
    max-width: 720px;
  }

  .review-flags {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-bottom: 10px;
  }

  .review-source-label {
    color: var(--text-dim);
    font-size: var(--font-size-small);
    text-transform: uppercase;
    letter-spacing: 0.6px;
    margin-bottom: 4px;
  }

  .review-source pre {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: var(--font-size-small);
    background: var(--surface-sunken);
    border: 1px solid var(--border-subtle);
    border-radius: 4px;
    padding: 10px;
    max-height: 320px;
    overflow: auto;
    white-space: pre;
  }

  .review-actions {
    display: flex;
    gap: 8px;
    margin-top: 10px;
  }

  .review-actions .danger,
  td .danger {
    border-color: var(--color-danger-border);
    color: var(--color-danger);
  }

  .review-actions .danger:hover,
  td .danger:hover {
    border-color: var(--color-danger);
  }

  @media (max-width: 640px) {
    .review-fields {
      grid-template-columns: 1fr;
      gap: 2px;
    }

    .review-fields dd {
      margin-bottom: 6px;
    }
  }
</style>
