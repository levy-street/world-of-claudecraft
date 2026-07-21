<script lang="ts">
  import type { CharacterRow } from '../types';
  import { classLabel, t } from '../i18n';
  import { fmtCopper, fmtDate, fmtRelative } from '../format';
  import AccountLink from './AccountLink.svelte';

  // Characters table with clickable sort headers. Ported from renderCharactersTable.
  // The parent owns sort/dir/page state and refetches; onSort toggles a column.
  let {
    rows,
    sort,
    dir,
    onSort,
  }: {
    rows: CharacterRow[];
    sort: string;
    dir: 'asc' | 'desc';
    onSort: (col: string) => void;
  } = $props();

  const arrow = (col: string) => (sort === col ? (dir === 'asc' ? ' ▲' : ' ▼') : '');
</script>

{#if rows.length === 0}
  <div class="empty">{t('characters.empty')}</div>
{:else}
  <table>
    <thead>
      <tr>
        <th class="sortable num" onclick={() => onSort('id')}>{t('characters.colId')}{arrow('id')}</th>
        <th class="sortable" onclick={() => onSort('name')}>{t('characters.colName')}{arrow('name')}</th>
        <th class="sortable" onclick={() => onSort('class')}>{t('characters.colClass')}{arrow('class')}</th>
        <th class="sortable num" onclick={() => onSort('level')}>{t('characters.colLevel')}{arrow('level')}</th>
        <th class="num">{t('characters.colXp')}</th>
        <th class="num">{t('characters.colMoney')}</th>
        <th>{t('characters.colAccount')}</th>
        <th class="sortable" onclick={() => onSort('created_at')}>{t('characters.colCreated')}{arrow('created_at')}</th>
        <th class="sortable" onclick={() => onSort('updated_at')}>{t('characters.colLastPlayed')}{arrow('updated_at')}</th>
      </tr>
    </thead>
    <tbody>
      {#each rows as c}
        <tr>
          <td class="num">{c.id}</td>
          <td>{c.name}</td>
          <td>{classLabel(c.class)}</td>
          <td class="num">{c.level}</td>
          <td class="num">{c.xp}</td>
          <td class="num">{fmtCopper(c.copper)}</td>
          <td><AccountLink accountId={c.accountId} label={c.username} /></td>
          <td>{fmtDate(c.createdAt)}</td>
          <td>{fmtRelative(c.updatedAt)}</td>
        </tr>
      {/each}
    </tbody>
  </table>
{/if}
