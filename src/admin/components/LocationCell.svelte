<script lang="ts">
  import type { LivePlayerLocation } from '../types';
  import { locationDisplay } from '../location';
  import { tooltipPlacement, type TooltipPlacement } from '../tooltip_placement';

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

  // The tooltip is FIXED, not absolute: the table lives in a horizontal scroll
  // container, and a scroller clips both axes, so an absolutely positioned tooltip
  // hanging under the last row would be cut off (and add a stray vertical scrollbar).
  let cell: HTMLElement;
  let placement = $state<TooltipPlacement | null>(null);

  function open(): void {
    const anchor = cell.getBoundingClientRect();
    placement = tooltipPlacement(anchor, {
      width: window.innerWidth,
      height: window.innerHeight,
    });
  }

  function close(): void {
    placement = null;
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') close();
  }

  // Placed once, against the viewport: a scroll that does not also fire pointerleave
  // (the page scrolling under a stationary pointer, or the table's own scroller) would
  // leave the tooltip floating away from its anchor, so scrolling dismisses it instead.
  // Capture phase, because a scroll inside a nested scroller never bubbles to window.
  $effect(() => {
    if (!placement) return;
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  });
</script>

<span
  class="location-cell"
  role="button"
  tabindex="0"
  bind:this={cell}
  aria-label={accessible}
  onpointerenter={open}
  onpointerleave={close}
  onfocusin={open}
  onfocusout={close}
  onkeydown={onKeydown}
>
  <span class="location-coords">{display.secondary}</span>
  {#if placement}
    <span
      class="location-tooltip"
      class:above={placement.side === 'above'}
      style="right: {placement.right}px; --arrow-right: {placement.arrowRight}px; {placement.side ===
      'above'
        ? `bottom: ${placement.offset}px`
        : `top: ${placement.offset}px`}"
    >
      {#each display.details as detail}
        <span>{detail}</span>
      {/each}
    </span>
  {/if}
</span>

<style>
  .location-cell {
    display: inline-flex;
    flex-direction: column;
    align-items: flex-end;
    min-width: 78px;
    cursor: help;
  }

  .location-cell:focus-visible {
    outline: 2px solid var(--gold);
    outline-offset: 2px;
  }

  .location-coords {
    color: var(--text);
    font-variant-numeric: tabular-nums;
  }

  .location-tooltip {
    position: fixed;
    z-index: 4;
    display: flex;
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
    right: var(--arrow-right, 14px);
    width: 8px;
    height: 8px;
    background: var(--surface-sunken);
    border-left: 1px solid var(--border-soft);
    border-top: 1px solid var(--border-soft);
    transform: rotate(45deg);
  }

  .location-tooltip.above::before {
    top: auto;
    bottom: -5px;
    border-left: 0;
    border-top: 0;
    border-right: 1px solid var(--border-soft);
    border-bottom: 1px solid var(--border-soft);
  }

  @media (max-width: 760px) {
    .location-cell {
      min-width: 70px;
    }
  }
</style>
