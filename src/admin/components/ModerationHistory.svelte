<script lang="ts">
  import type { ModerationHistoryEntry } from '../types';
  import { fmtDate } from '../format';
  import { t } from '../i18n';
  import { moderationActionLabel, moderationActionVariant } from '../labels';
  import Badge from './Badge.svelte';
  import Panel from './Panel.svelte';

  // The action label/variant table is shared with ModerationHistoryPage (src/admin/labels.ts):
  // a new server action kind must never render as an unlabelled "Other action" in one
  // history view and correctly in the other.
  let { entries }: { entries: ModerationHistoryEntry[] } = $props();
</script>

<div class="history-panel">
  <Panel
    title={t('moderationHistory.title')}
    hint={t('moderationHistory.latestHint')}
  >
    {#if entries.length === 0}
      <div class="empty">{t('moderationHistory.empty')}</div>
    {:else}
      <ol class="moderation-history">
        {#each entries as entry (entry.id)}
          <li>
            <div class="history-meta">
              <Badge variant={moderationActionVariant(entry.action)} size="medium">
                {moderationActionLabel(entry.action)}
              </Badge>
              <span>
                {t('moderationHistory.by', {
                  name: entry.adminUsername ?? t('common.unknown'),
                })}
              </span>
              <time datetime={entry.createdAt}>{fmtDate(entry.createdAt)}</time>
            </div>
            <div class="history-reason">
              {entry.reason || t('moderationHistory.noReason')}
            </div>
            {#if entry.expiresAt}
              <div class="history-expiry">
                {t('moderationHistory.expires', {
                  value: fmtDate(entry.expiresAt),
                })}
              </div>
            {/if}
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

  .moderation-history {
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

  .history-meta {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px 10px;
    color: var(--text-dim);
    font-size: var(--font-size-small);
  }

  time {
    margin-left: auto;
  }

  .history-reason {
    margin-top: 7px;
    color: var(--text);
    overflow-wrap: anywhere;
    white-space: pre-wrap;
  }

  .history-expiry {
    margin-top: 5px;
    color: var(--text-dim);
    font-size: var(--font-size-small);
  }

  @media (max-width: 600px) {
    time {
      flex-basis: 100%;
      margin-left: 0;
    }
  }
</style>
