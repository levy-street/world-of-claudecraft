<script lang="ts">
  import { onMount } from 'svelte';
  import type { CharacterRow, Paginated } from '../types';
  import { apiGet } from '../api';
  import { auth } from '../state/auth.svelte';
  import { SEARCH_DEBOUNCE_MS } from '../state/poll';
  import { t } from '../i18n';
  import Panel from '../components/Panel.svelte';
  import Pager from '../components/Pager.svelte';
  import CharactersTable from '../components/CharactersTable.svelte';

  let characters = $state<Paginated<CharacterRow> | null>(null);
  let failed = $state(false);
  let search = $state('');
  let sort = $state('level');
  let dir = $state<'asc' | 'desc'>('desc');
  let page = $state(1);
  let searchTimer: ReturnType<typeof setTimeout> | null = null;

  async function refresh(): Promise<void> {
    try {
      const params = new URLSearchParams({ page: String(page), search, sort, dir });
      characters = await apiGet<Paginated<CharacterRow>>(`/admin/api/characters?${params}`);
      failed = false;
    } catch (err) {
      if (!auth.handleAuthFailure(err)) failed = true;
    }
  }

  function onSearchInput(event: Event): void {
    search = (event.currentTarget as HTMLInputElement).value.trim();
    page = 1;
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(() => void refresh(), SEARCH_DEBOUNCE_MS);
  }

  function onSort(column: string): void {
    dir = sort === column && dir === 'desc' ? 'asc' : 'desc';
    sort = column;
    page = 1;
    void refresh();
  }

  onMount(() => {
    void refresh();
    return () => {
      if (searchTimer) clearTimeout(searchTimer);
    };
  });
</script>

<Panel>
  <div class="controls">
    <input
      id="character-search"
      placeholder={t('characters.searchPlaceholder')}
      value={search}
      oninput={onSearchInput}
    />
    <span class="text-dim">{t('characters.sortHint')}</span>
    {#if characters}
      <div class="pager">
        <Pager
          total={characters.total}
          page={characters.page}
          limit={characters.limit}
          onPage={(nextPage) => {
            page = nextPage;
            void refresh();
          }}
        />
      </div>
    {/if}
  </div>
  {#if failed}
    <div class="empty">{t('characters.loadFailed')}</div>
  {:else if characters}
    <CharactersTable rows={characters.rows} {sort} {dir} {onSort} />
  {/if}
</Panel>
