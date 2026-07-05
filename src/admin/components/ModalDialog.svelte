<script lang="ts">
  import { onMount, tick, type Snippet } from 'svelte';

  let {
    labelledBy,
    closeLabel,
    onClose,
    width = '1100px',
    children,
  }: {
    labelledBy: string;
    closeLabel: string;
    onClose: () => void;
    width?: string;
    children: Snippet;
  } = $props();

  let dialog: HTMLElement;

  function focusableElements(): HTMLElement[] {
    return Array.from(
      dialog.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    );
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== 'Tab') return;

    const focusable = focusableElements();
    if (focusable.length === 0) {
      event.preventDefault();
      dialog.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  onMount(() => {
    const previousFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    void tick().then(() => {
      const preferred = dialog.querySelector<HTMLElement>('[data-modal-focus]');
      (preferred ?? focusableElements()[0] ?? dialog).focus();
    });
    return () => {
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) void tick().then(() => previousFocus.focus());
    };
  });
</script>

<svelte:window onkeydown={onKeydown} />

<div class="modal-layer">
  <button
    class="modal-backdrop"
    type="button"
    aria-label={closeLabel}
    onclick={onClose}
  ></button>
  <div
    bind:this={dialog}
    class="modal-dialog"
    role="dialog"
    aria-modal="true"
    aria-labelledby={labelledBy}
    tabindex="-1"
    style:--modal-width={width}
  >
    {@render children()}
  </div>
</div>

<style>
  .modal-layer {
    position: fixed;
    z-index: 70;
    inset: 0;
    display: grid;
    place-items: center;
    padding: 24px;
  }

  .modal-backdrop {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    background: #000c;
    border: 0;
    border-radius: 0;
    cursor: default;
  }

  .modal-dialog {
    position: relative;
    width: min(var(--modal-width), 100%);
    max-height: calc(100vh - 48px);
    overflow: hidden;
    background: var(--panel-bg);
    border: 1px solid var(--border);
    border-radius: 8px;
    box-shadow: 0 18px 60px #000e, inset 0 1px 0 #ffffff12;
  }

  .modal-dialog:focus-visible {
    outline: 2px solid var(--gold);
    outline-offset: 2px;
  }

  @media (max-width: 800px) {
    .modal-layer {
      padding: 0;
    }

    .modal-dialog {
      width: 100%;
      height: 100%;
      max-height: none;
      border: 0;
      border-radius: 0;
    }
  }
</style>
