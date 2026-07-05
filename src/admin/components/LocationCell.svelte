<script lang="ts">
  import type { LivePlayerLocation } from '../types';
  import { locationDisplay } from '../location';

  let {
    location = null,
    x,
    z,
    zone = null,
  }: {
    location?: LivePlayerLocation | null;
    x: number;
    z: number;
    zone?: string | null;
  } = $props();

  let display = $derived(locationDisplay({ location, x, z, zone }));
  let accessible = $derived(display.details.join('. '));
</script>

<span class="location-cell" aria-label={accessible}>
  <span class="location-coords">{display.secondary}</span>
  <span class="location-tooltip">
    {#each display.details as detail}
      <span>{detail}</span>
    {/each}
  </span>
</span>

<style>
  .location-cell {
    position: relative;
    display: inline-flex;
    flex-direction: column;
    align-items: flex-end;
    min-width: 78px;
    cursor: help;
  }

  .location-coords {
    color: var(--text);
    font-variant-numeric: tabular-nums;
  }

  .location-tooltip {
    position: absolute;
    right: 0;
    top: calc(100% + 7px);
    z-index: 4;
    display: none;
    flex-direction: column;
    gap: 3px;
    min-width: 210px;
    max-width: 280px;
    padding: 8px 10px;
    text-align: left;
    white-space: normal;
    color: var(--text);
    background: var(--surface-sunken);
    border: 1px solid var(--border-soft);
    border-radius: 4px;
    box-shadow: 0 8px 18px #000c;
  }

  .location-tooltip::before {
    content: "";
    position: absolute;
    top: -5px;
    right: 14px;
    width: 8px;
    height: 8px;
    background: var(--surface-sunken);
    border-left: 1px solid var(--border-soft);
    border-top: 1px solid var(--border-soft);
    transform: rotate(45deg);
  }

  .location-cell:hover .location-tooltip,
  .location-tooltip:hover {
    display: flex;
  }

  @media (max-width: 760px) {
    .location-cell {
      min-width: 70px;
    }
  }
</style>
