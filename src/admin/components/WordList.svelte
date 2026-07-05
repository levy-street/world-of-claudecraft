<script lang="ts">
  import type { FilterWord } from '../types';
  import { t } from '../i18n';
  import Panel from './Panel.svelte';

  // One chat-filter tier (soft or hard): an add form plus deletable word chips. Ported
  // from renderChatFilter's per-tier panel + renderWordChips.
  let {
    title,
    hint,
    placeholder,
    words,
    onAdd,
    onDelete,
  }: {
    title: string;
    hint: string;
    placeholder: string;
    words: FilterWord[];
    onAdd: (word: string) => void;
    onDelete: (id: number) => void;
  } = $props();

  let draft = $state('');

  function submit(e: SubmitEvent): void {
    e.preventDefault();
    const word = draft.trim();
    if (!word) return;
    onAdd(word);
    draft = '';
  }
</script>

<Panel title={title} hint={hint}>
  <form class="word-add" onsubmit={submit}>
    <input placeholder={placeholder} maxlength="64" bind:value={draft} />
    <button>{t('chatFilter.add')}</button>
  </form>
  {#if words.length === 0}
    <div class="empty">{t('chatFilter.noWords')}</div>
  {:else}
    <div class="word-chips">
      {#each words as w (w.id)}
        <span class="word-chip">{w.word}<button class="word-del" title={t('chatFilter.removeWord')} onclick={() => onDelete(w.id)}>&times;</button></span>
      {/each}
    </div>
  {/if}
</Panel>
