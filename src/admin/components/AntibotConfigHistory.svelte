<script lang="ts">
  import { antibotConfigHistoryRows } from '../antibot_config_history';
  import { fmtDate } from '../format';
  import { t } from '../i18n';
  import type { AntibotConfigField, AntibotConfigHistoryEntry } from '../types';
  import Panel from './Panel.svelte';

  let {
    entries,
    fields,
    failed = false,
    onloadversion,
  }: {
    entries: AntibotConfigHistoryEntry[];
    fields: AntibotConfigField[];
    failed?: boolean;
    onloadversion?: (entry: AntibotConfigHistoryEntry) => void;
  } = $props();
</script>

<div class="history-panel">
  <Panel title={t('antibot.historyTitle')} hint={t('antibot.historyHint')}>
    {#if failed}
      <div class="history-empty history-error">{t('antibot.historyLoadFailed')}</div>
    {:else if entries.length === 0}
      <div class="history-empty">{t('antibot.historyEmpty')}</div>
    {:else}
      <ol class="history-list">
        {#each entries as entry, index (entry.id)}
          {@const rows = antibotConfigHistoryRows(entry, fields, t)}
          <li>
            <details>
              <summary>
                <span>
                  {t('antibot.historyBy', {
                    name: entry.adminUsername ?? t('common.unknown'),
                  })}
                </span>
                <span class="history-count">
                  {t('antibot.historyFieldCount', { count: rows.length })}
                </span>
                {#if index === 0}
                  <span class="history-current">{t('antibot.historyCurrent')}</span>
                {/if}
                <time datetime={entry.createdAt}>{fmtDate(entry.createdAt)}</time>
              </summary>
              {#if entry.note}
                <p class="history-note">
                  <strong>{t('antibot.historyNoteLabel')}</strong>
                  {entry.note}
                </p>
              {/if}
              <dl>
                {#each rows as row (row.id)}
                  <div>
                    <dt>{row.label}</dt>
                    <dd>
                      <span>{row.before}</span>
                      <span class="history-arrow" aria-hidden="true">→</span>
                      <span class="visually-hidden">{t('antibot.historyTo')}</span>
                      <span>{row.after}</span>
                    </dd>
                  </div>
                {/each}
              </dl>
              {#if index > 0}
                <div class="history-actions">
                  <button
                    type="button"
                    class="btn-sm"
                    onclick={() => onloadversion?.(entry)}
                  >
                    {t('antibot.historyLoadVersion')}
                  </button>
                </div>
              {/if}
            </details>
          </li>
        {/each}
      </ol>
    {/if}
  </Panel>
</div>

<style>
  .history-panel {
    margin-top: 18px;
  }

  .history-empty {
    color: var(--text-dim);
  }

  .history-error {
    color: var(--color-danger);
  }

  .history-list {
    display: grid;
    gap: 8px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  li {
    padding: 10px;
    border: 1px solid var(--border-subtle);
    border-radius: 4px;
    background: var(--surface-sunken);
  }

  summary {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px 10px;
    color: var(--text-soft);
    cursor: pointer;
  }

  summary:focus-visible {
    outline: 2px solid var(--gold);
    outline-offset: 3px;
  }

  .history-count {
    color: var(--text-dim);
    font-size: var(--font-size-small);
  }

  .history-current {
    padding: 2px 6px;
    border: 1px solid var(--border-soft);
    border-radius: 999px;
    color: var(--gold-dim);
    font-size: var(--font-size-small);
  }

  time {
    margin-left: auto;
    color: var(--text-dim);
    font-size: var(--font-size-small);
  }

  .history-note {
    margin-top: 10px;
    color: var(--text);
    overflow-wrap: anywhere;
    white-space: pre-wrap;
  }

  .history-note strong {
    margin-right: 6px;
    color: var(--text-soft);
  }

  dl {
    display: grid;
    gap: 6px;
    margin-top: 10px;
  }

  dl div {
    display: grid;
    grid-template-columns: minmax(160px, 1fr) minmax(220px, 2fr);
    gap: 8px 16px;
  }

  dt {
    color: var(--gold-dim);
    font-weight: 600;
  }

  dd {
    display: flex;
    align-items: baseline;
    gap: 8px;
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .history-arrow {
    color: var(--text-dim);
  }

  .history-actions {
    display: flex;
    justify-content: flex-end;
    margin-top: 12px;
  }

  @media (max-width: 600px) {
    time {
      flex-basis: 100%;
      margin-left: 0;
    }

    dl div {
      grid-template-columns: 1fr;
      gap: 2px;
    }
  }
</style>
