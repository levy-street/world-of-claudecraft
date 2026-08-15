<script lang="ts">
  import { onMount } from 'svelte';
  import type { BugReportRow, Paginated } from '../types';
  import { apiGet, apiPost } from '../api';
  import { auth } from '../state/auth.svelte';
  import { localizeAdminError, t } from '../i18n';
  import { fmtNumber, fmtRelative } from '../format';
  import Panel from '../components/Panel.svelte';
  import Badge from '../components/Badge.svelte';
  import Pager from '../components/Pager.svelte';
  import ScreenshotOverlay from '../components/ScreenshotOverlay.svelte';
  import ModerationActionPrompt from '../components/ModerationActionPrompt.svelte';

  // Bug reports tab: paginated table (newest first), an on-demand screenshot
  // overlay (the list omits the screenshot bytes), and a resolve/dismiss action
  // for an open report, mirroring player_reports' review lifecycle (ignore).
  // Ported from renderBugReportsTable + showBugScreenshot.
  let data = $state<Paginated<BugReportRow> | null>(null);
  let failed = $state(false);
  let page = $state(1);
  let shotSrc = $state<string | null>(null);
  let selectedAction = $state<{ kind: 'resolve' | 'dismiss'; report: BugReportRow } | null>(null);

  async function refresh(): Promise<void> {
    try {
      const params = new URLSearchParams({ page: String(page) });
      data = await apiGet<Paginated<BugReportRow>>(`/admin/api/bug-reports?${params}`);
      failed = false;
    } catch (err) {
      if (!auth.handleAuthFailure(err)) failed = true;
    }
  }

  async function showScreenshot(id: number): Promise<void> {
    try {
      const r = await apiGet<{ screenshot: string | null }>(`/admin/api/bug-reports/${id}/screenshot`);
      if (r.screenshot) shotSrc = r.screenshot;
    } catch (err) {
      auth.handleAuthFailure(err);
    }
  }

  async function confirmAction(values: { reason: string }): Promise<void> {
    const selected = selectedAction;
    if (!selected) return;
    try {
      await apiPost(`/admin/api/bug-reports/${selected.report.id}/${selected.kind}`, {
        note: values.reason,
      });
      selectedAction = null;
      await refresh();
    } catch (err) {
      if (!auth.handleAuthFailure(err)) {
        window.alert(err instanceof Error ? localizeAdminError(err.message) : t('alert.actionFailed'));
      }
    }
  }

  const coords = (r: BugReportRow) => `${fmtNumber(r.pos_x)}, ${fmtNumber(r.pos_y)}, ${fmtNumber(r.pos_z)}`;
  const meta = (r: BugReportRow) => JSON.stringify(r.meta ?? {}, null, 2);
  const statusVariant = (status: string): 'warn' | 'success' | 'neutral' =>
    status === 'open' ? 'warn' : status === 'resolved' ? 'success' : 'neutral';

  onMount(() => { void refresh(); });
</script>

<Panel title={t('bugReports.listTitle')} hint={t('bugReports.hint')}>
  {#if failed}
    <div class="empty">{t('bugReports.loadFailed')}</div>
  {:else if data && data.rows.length === 0}
    <div class="empty">{t('bugReports.empty')}</div>
  {:else if data}
    <div class="table-scroll">
      <table>
        <thead>
          <tr>
            <th>{t('bugReports.colWhen')}</th>
            <th>{t('bugReports.colRealm')}</th>
            <th>{t('bugReports.colCharacter')}</th>
            <th>{t('bugReports.colPosition')}</th>
            <th>{t('bugReports.colDescription')}</th>
            <th>{t('bugReports.colStatus')}</th>
            <th>{t('bugReports.colMeta')}</th>
            <th>{t('bugReports.colScreenshot')}</th>
            {#if auth.can('moderation.act')}
              <th>{t('bugReports.colActions')}</th>
            {/if}
          </tr>
        </thead>
        <tbody>
          {#each data.rows as r (r.id)}
            <tr>
              <td>{fmtRelative(r.created_at)}</td>
              <td>{r.realm || '-'}</td>
              <td>{r.character_name || '-'}</td>
              <td>{coords(r)}</td>
              <td class="bug-desc-cell">{r.description}</td>
              <td><Badge variant={statusVariant(r.status)}>{r.status}</Badge></td>
              <td><details><summary>{t('bugReports.colMeta')}</summary><pre class="bug-meta">{meta(r)}</pre></details></td>
              <td>
                {#if r.has_screenshot}
                  <button class="btn-link" onclick={() => showScreenshot(r.id)}>{t('bugReports.viewScreenshot')}</button>
                {:else}
                  <span class="text-dim">{t('bugReports.noScreenshot')}</span>
                {/if}
              </td>
              {#if auth.can('moderation.act')}
                <td>
                  {#if r.status === 'open'}
                    <div class="bug-report-actions">
                      <button
                        class="btn-link"
                        onclick={() => (selectedAction = { kind: 'resolve', report: r })}
                      >
                        {t('bugReports.resolve')}
                      </button>
                      <button
                        class="btn-link"
                        onclick={() => (selectedAction = { kind: 'dismiss', report: r })}
                      >
                        {t('bugReports.dismiss')}
                      </button>
                    </div>
                  {:else}
                    <span class="text-dim">{t('bugReports.reviewed')}</span>
                  {/if}
                </td>
              {/if}
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    <Pager
      total={data.total}
      page={data.page}
      limit={data.limit}
      layout="footer"
      onPage={(p) => {
        page = p;
        void refresh();
      }}
    />
    {#if selectedAction}
      {@const action = selectedAction}
      {#key `${action.report.id}:${action.kind}`}
        <ModerationActionPrompt
          title={action.kind === 'resolve' ? t('bugReports.confirmResolve') : t('bugReports.confirmDismiss')}
          rows={[
            { label: t('dialog.report'), value: `#${action.report.id}` },
            { label: t('bugReports.colDescription'), value: action.report.description },
          ]}
          reasonRequired={false}
          onConfirm={confirmAction}
          onCancel={() => (selectedAction = null)}
        />
      {/key}
    {/if}
  {/if}
</Panel>

{#if shotSrc}
  <ScreenshotOverlay src={shotSrc} alt={t('bugReports.screenshotAlt')} onClose={() => (shotSrc = null)} />
{/if}
