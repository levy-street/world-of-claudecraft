<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    title,
    badge,
    actions,
  }: {
    title: string;
    badge?: Snippet;
    actions?: Snippet;
  } = $props();
</script>

<header class="page-header">
  <div class="page-title">
    <h1>{title}</h1>
    {#if badge}{@render badge()}{/if}
  </div>
  {#if actions}
    <div class="page-actions">{@render actions()}</div>
  {/if}
</header>

<style>
  .page-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px 20px;
    margin-bottom: 18px;
  }

  .page-title,
  .page-actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .page-title {
    min-width: 0;
    flex-wrap: wrap;
  }

  h1 {
    color: var(--gold);
    font-family: var(--title-font);
    font-size: 24px;
    font-weight: 600;
    line-height: 1.2;
    text-shadow: 1px 1px 2px #000;
  }

  .page-actions {
    flex: none;
  }

  @media (max-width: 600px) {
    .page-header {
      align-items: flex-start;
      flex-direction: column;
    }

    .page-actions {
      width: 100%;
    }
  }
</style>
