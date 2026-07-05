<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    title,
    count = 0,
    open = $bindable(false),
    children,
  }: {
    title: string;
    count?: number;
    open?: boolean;
    children: Snippet;
  } = $props();
</script>

<details class="panel collapsible-panel" bind:open>
  <summary class="panel-title collapsible-title">
    <svg
      class="collapsible-caret"
      class:collapsible-caret-open={open}
      viewBox="0 0 16 16"
      aria-hidden="true"
    >
      <path d="M6 3.5 10.5 8 6 12.5" />
    </svg>
    <span>
      {title}{#if count > 0}{' '}<span class="collapsible-count">({count})</span>{/if}
    </span>
  </summary>
  {@render children()}
</details>

<style>
  .collapsible-title {
    align-items: center;
    cursor: pointer;
    justify-content: flex-start;
    gap: 6px;
    list-style: none;
    user-select: none;
  }

  .collapsible-title::-webkit-details-marker {
    display: none;
  }

  .collapsible-title:hover {
    color: var(--text-bright);
  }

  .collapsible-title:focus-visible {
    outline: 2px solid var(--gold);
    outline-offset: 4px;
    border-radius: 2px;
  }

  .collapsible-count {
    color: var(--text-soft);
    font-family: var(--ui-font);
    font-size: var(--font-size-small);
  }

  .collapsible-caret {
    width: 14px;
    height: 14px;
    flex: none;
    color: var(--text-soft);
    fill: none;
    stroke: currentColor;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 1.75;
    transition: transform 120ms ease;
  }

  .collapsible-caret-open {
    transform: rotate(90deg);
  }

  .collapsible-panel:not([open]) .collapsible-title {
    margin-bottom: 0;
    padding-bottom: 0;
    border-bottom: 0;
  }
</style>
