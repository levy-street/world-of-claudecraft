<script lang="ts">
  import { t } from '../i18n';

  // In-place confirmation panel for a destructive/sensitive moderation action, ported
  // from the old .mod-confirm markup. The parent renders it with {#if} when an action
  // is pending and supplies the summary rows; onConfirm/onCancel resolve it. The
  // server re-authorizes the action regardless; this is operator confirmation only.
  let {
    title,
    rows = [],
    danger = false,
    confirmLabel,
    cancelLabel,
    onConfirm,
    onCancel,
  }: {
    title: string;
    rows?: { label: string; value: string }[];
    danger?: boolean;
    confirmLabel?: string;
    cancelLabel?: string;
    onConfirm: () => void;
    onCancel: () => void;
  } = $props();
</script>

<div class="mod-confirm show">
  <h4>{title}</h4>
  {#if rows.length}
    <dl>
      {#each rows as r}
        <dt>{r.label}</dt>
        <dd>{r.value}</dd>
      {/each}
    </dl>
  {/if}
  <div class="confirm-actions">
    <button data-confirm-moderation class:danger={danger} onclick={onConfirm}>{confirmLabel ?? t('dialog.confirm')}</button>
    <button data-cancel-moderation onclick={onCancel}>{cancelLabel ?? t('dialog.cancel')}</button>
  </div>
</div>
