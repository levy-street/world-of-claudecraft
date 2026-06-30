<script lang="ts">
  import { onMount } from 'svelte';
  import { apiGet } from '../api';
  import AccountLink from '../components/AccountLink.svelte';
  import IpLink from '../components/IpLink.svelte';
  import Panel from '../components/Panel.svelte';
  import { adminLanguageTag, t } from '../i18n';
  import { auth } from '../state/auth.svelte';
  import { LIVE_REFRESH_MS } from '../state/poll';
  import type { SuspiciousPlayersData } from '../types';

  type SortColumn = 'score' | 'evidence';
  type SortDirection = 'asc' | 'desc';

  const AUTO_REFRESH_STORAGE_KEY = 'claudecraft_admin_suspicious_auto_refresh';

  let data = $state<SuspiciousPlayersData | null>(null);
  let failed = $state(false);
  let sort = $state<SortColumn>('score');
  let direction = $state<SortDirection>('desc');
  let autoRefresh = $state(true);
  let mounted = $state(false);
  let requestId = 0;

  const sortedPlayers = $derived.by(() => {
    if (!data) return [];
    const multiplier = direction === 'asc' ? 1 : -1;
    return [...data.players].sort((a, b) => {
      const left = sort === 'score' ? a.score : a.evidence.length;
      const right = sort === 'score' ? b.score : b.evidence.length;
      return (left - right) * multiplier || b.score - a.score || a.ref.accountId - b.ref.accountId;
    });
  });

  function formatScore(value: number): string {
    return new Intl.NumberFormat(adminLanguageTag(), {
      maximumFractionDigits: 2,
    }).format(value);
  }

  async function refresh(): Promise<void> {
    const currentRequest = ++requestId;
    try {
      const result = await apiGet<SuspiciousPlayersData>('/admin/api/suspicious-players');
      if (currentRequest !== requestId) return;
      data = result;
      failed = false;
    } catch (err) {
      if (currentRequest !== requestId) return;
      if (!auth.handleAuthFailure(err)) failed = true;
    }
  }

  function changeSort(column: SortColumn): void {
    if (sort === column) direction = direction === 'desc' ? 'asc' : 'desc';
    else {
      sort = column;
      direction = 'desc';
    }
  }

  function ariaSort(column: SortColumn): 'ascending' | 'descending' | 'none' {
    if (sort !== column) return 'none';
    return direction === 'asc' ? 'ascending' : 'descending';
  }

  function sortArrow(column: SortColumn): string {
    if (sort !== column) return '';
    return direction === 'asc' ? ' ▲' : ' ▼';
  }

  function changeAutoRefresh(event: Event): void {
    autoRefresh = (event.currentTarget as HTMLInputElement).checked;
    localStorage.setItem(AUTO_REFRESH_STORAGE_KEY, autoRefresh ? '1' : '0');
    if (autoRefresh) void refresh();
  }

  $effect(() => {
    if (!mounted || !autoRefresh) return;
    const id = setInterval(() => void refresh(), LIVE_REFRESH_MS);
    return () => clearInterval(id);
  });

  onMount(() => {
    autoRefresh = localStorage.getItem(AUTO_REFRESH_STORAGE_KEY) !== '0';
    mounted = true;
    void refresh();
    return () => {
      requestId += 1;
    };
  });
</script>

<div class="suspicious-page">
  <Panel>
    <div class="page-controls">
      <p class="description">{t('suspiciousPlayers.description')}</p>
      <label class="auto-refresh">
        <input type="checkbox" checked={autoRefresh} onchange={changeAutoRefresh} />
        <span class="switch-track" aria-hidden="true"><span></span></span>
        <span>
          {t('suspiciousPlayers.autoRefresh', { seconds: LIVE_REFRESH_MS / 1000 })}
        </span>
      </label>
    </div>

    {#if failed}
      <div class="empty">{t('suspiciousPlayers.loadFailed')}</div>
    {:else if data === null}
      <div class="empty">{t('suspiciousPlayers.loading')}</div>
    {:else if sortedPlayers.length === 0}
      <div class="empty">{t('suspiciousPlayers.empty')}</div>
    {:else}
      <div class="table-scroll">
        <table>
          <colgroup>
            <col />
            <col class="evidence-column" />
            <col class="score-column" />
          </colgroup>
          <thead>
            <tr>
              <th>
                <span class="visually-hidden">{t('suspiciousPlayers.colName')}</span>
              </th>
              <th class="num sortable" aria-sort={ariaSort('evidence')}>
                <button type="button" onclick={() => changeSort('evidence')}>
                  {t('suspiciousPlayers.colEvidence')}{sortArrow('evidence')}
                </button>
              </th>
              <th class="num sortable" aria-sort={ariaSort('score')}>
                <button type="button" onclick={() => changeSort('score')}>
                  {t('suspiciousPlayers.colScore')}{sortArrow('score')}
                </button>
              </th>
            </tr>
          </thead>
          {#each sortedPlayers as player (player.ref.characterId)}
            <tbody class="player-group">
              <tr class="player-row">
                <td>
                  <div class="identity">
                    <AccountLink accountId={player.ref.accountId} label={player.ref.name} />
                    <span class="identity-separator" aria-hidden="true">/</span>
                    <IpLink ip={player.ref.ip} />
                  </div>
                </td>
                <td class="num">{player.evidence.length}</td>
                <td class="num score">{formatScore(player.score)}</td>
              </tr>
              <tr class="evidence-row">
                <td colspan="3">
                  <div class="evidence-heading">
                    {t('suspiciousPlayers.evidenceList', { name: player.ref.name })}
                  </div>
                  <ul>
                    {#each player.evidence as evidence}
                      <li>
                        <code>{evidence.kind}</code>
                        <div class="evidence-detail">{evidence.detail}</div>
                        <span class="evidence-weight">
                          {t('suspiciousPlayers.evidenceWeight', {
                            value: formatScore(evidence.weight),
                          })}
                        </span>
                      </li>
                    {/each}
                  </ul>
                </td>
              </tr>
            </tbody>
          {/each}
        </table>
      </div>
    {/if}
  </Panel>
</div>

<style>
  .suspicious-page {
    width: 100%;
  }

  .description {
    color: var(--text);
    line-height: 1.5;
  }

  .page-controls {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px 24px;
    margin-bottom: 14px;
  }

  .auto-refresh {
    position: relative;
    display: inline-flex;
    min-height: 40px;
    flex: none;
    align-items: center;
    gap: 8px;
    color: var(--text);
    cursor: pointer;
    font-size: 12px;
  }

  .auto-refresh input {
    position: absolute;
    width: 1px;
    height: 1px;
    opacity: 0;
  }

  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    clip-path: inset(50%);
    white-space: nowrap;
  }

  .switch-track {
    display: inline-flex;
    width: 34px;
    height: 19px;
    align-items: center;
    padding: 2px;
    background: var(--control-bg);
    border: 1px solid var(--control-border);
    border-radius: 999px;
  }

  .switch-track span {
    width: 13px;
    height: 13px;
    background: var(--text-dim);
    border-radius: 50%;
    transition: transform 120ms ease, background 120ms ease;
  }

  .auto-refresh input:checked + .switch-track {
    background: #17301f;
    border-color: #348b56;
  }

  .auto-refresh input:checked + .switch-track span {
    background: #7bea9f;
    transform: translateX(15px);
  }

  .auto-refresh input:focus-visible + .switch-track {
    outline: 2px solid var(--gold);
    outline-offset: 2px;
  }

  table {
    border-collapse: separate;
    border-spacing: 0;
    min-width: 720px;
  }

  .evidence-column {
    width: 100px;
  }

  .score-column {
    width: 80px;
  }

  th.sortable {
    padding: 0;
  }

  th.sortable button {
    width: 100%;
    padding: 7px 10px;
    color: inherit;
    background: none;
    border: 0;
    cursor: pointer;
    font: inherit;
    letter-spacing: inherit;
    text-align: right;
    text-transform: inherit;
  }

  th.sortable button:focus-visible {
    outline: 2px solid var(--gold);
    outline-offset: -2px;
  }

  .player-row td {
    background: var(--surface-sunken);
    background-clip: padding-box;
    border-top: 12px solid transparent;
    border-bottom: 0;
    box-shadow: inset 0 1px var(--border-soft);
  }

  .player-row td:first-child {
    box-shadow:
      inset 1px 0 var(--border-soft),
      inset 0 1px var(--border-soft);
  }

  .player-row td:last-child {
    box-shadow:
      inset -1px 0 var(--border-soft),
      inset 0 1px var(--border-soft);
  }

  .identity {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 10px;
  }

  .identity-separator {
    color: var(--text-dim);
  }

  .score {
    color: var(--gold);
    font-weight: 600;
  }

  .evidence-row:hover {
    background: transparent;
  }

  .evidence-row td {
    padding: 0 10px 12px 28px;
    background: var(--surface-sunken);
    border: solid var(--border-soft);
    border-width: 0 1px 1px;
    white-space: normal;
  }

  .evidence-heading {
    margin-bottom: 5px;
    color: var(--text-dim);
    font-size: var(--font-size-small);
  }

  ul {
    display: grid;
    gap: 5px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  li {
    display: grid;
    grid-template-columns: minmax(140px, 200px) minmax(0, 1fr) auto;
    align-items: baseline;
    gap: 12px;
    padding: 7px 9px;
    background: var(--surface-inset);
    border-left: 2px solid var(--gold-dim);
    border-radius: 2px;
  }

  li code {
    color: var(--gold-dim);
    overflow-wrap: anywhere;
  }

  .evidence-weight {
    color: var(--text-dim);
    font-size: var(--font-size-small);
    white-space: nowrap;
  }

  .evidence-detail {
    color: var(--text);
    line-height: 1.4;
    overflow-wrap: anywhere;
  }

  @media (max-width: 900px) {
    li {
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 3px 12px;
    }

    .evidence-detail {
      grid-column: 1 / -1;
      grid-row: 2;
    }
  }

  @media (max-width: 700px) {
    .page-controls {
      align-items: flex-start;
      flex-direction: column;
      gap: 4px;
    }
  }
</style>
