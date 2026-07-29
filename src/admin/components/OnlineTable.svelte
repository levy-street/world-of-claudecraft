<script lang="ts">
  import type { OnlineSortColumn, OnlineSortDirection } from '../online_players_view';
  import type { LivePlayer } from '../types';
  import { classLabel, zoneLabel, t } from '../i18n';
  import { fmtDuration, fmtNumber } from '../format';
  import AccountLink from './AccountLink.svelte';
  import LocationCell from './LocationCell.svelte';

  // Live players table. The parent owns sort/dir and re-derives the rows; passing
  // onSort turns the supported columns into sort buttons, and leaving it out renders
  // the plain table.
  let {
    players,
    sort,
    dir = 'asc',
    onSort,
  }: {
    players: LivePlayer[];
    sort?: OnlineSortColumn;
    dir?: OnlineSortDirection;
    onSort?: (column: OnlineSortColumn) => void;
  } = $props();

  const ariaSort = (column: OnlineSortColumn): 'ascending' | 'descending' | 'none' =>
    sort !== column ? 'none' : dir === 'asc' ? 'ascending' : 'descending';
  const arrow = (column: OnlineSortColumn) => (sort !== column ? '' : dir === 'asc' ? '▲' : '▼');
</script>

{#snippet header(column: OnlineSortColumn, labelKey: string, numeric: boolean)}
  {#if onSort}
    <th class="sortable" class:num={numeric} aria-sort={ariaSort(column)}>
      <button type="button" onclick={() => onSort?.(column)}>
        {t(labelKey)}<span class="sort-arrow" aria-hidden="true">{arrow(column)}</span>
      </button>
    </th>
  {:else}
    <th class:num={numeric}>{t(labelKey)}</th>
  {/if}
{/snippet}

{#if players.length === 0}
  <div class="empty">{t('online.empty')}</div>
{:else}
  <table>
    <thead>
      <tr>
        {@render header('name', 'online.colCharacter', false)}
        {@render header('class', 'online.colClass', false)}
        {@render header('level', 'online.colLevel', true)}
        {@render header('zone', 'online.colZone', false)}
        <th class="num">{t('online.colPos')}</th>
        {@render header('hp', 'online.colHp', true)}
        {@render header('session', 'online.colSession', true)}
        {@render header('lastSave', 'online.colLastSave', true)}
        {@render header('account', 'online.colAcct', true)}
      </tr>
    </thead>
    <tbody>
      {#each players as p}
        <tr>
          <td>{p.name}</td>
          <td>{classLabel(p.class)}</td>
          <td class="num">{p.level}</td>
          <td>{zoneLabel(p.zone)}</td>
          <td class="num"><LocationCell location={p.location} x={p.x} z={p.z} zone={p.zone} /></td>
          <td class="num">{p.hp}/{p.maxHp}</td>
          <td class="num">{fmtDuration(p.sessionSeconds)}</td>
          <td class="num">{t('common.ago', { value: fmtDuration(p.lastSaveSecondsAgo) })}</td>
          <td class="num"><AccountLink accountId={p.accountId} label={fmtNumber(p.accountId)} /></td>
        </tr>
      {/each}
    </tbody>
  </table>
{/if}

<style>
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
    text-align: inherit;
    text-transform: inherit;
  }

  th.sortable.num button {
    text-align: right;
  }

  th.sortable button:focus-visible {
    outline: 2px solid var(--gold);
    outline-offset: -2px;
  }

  .sort-arrow {
    margin-left: 4px;
  }
</style>
