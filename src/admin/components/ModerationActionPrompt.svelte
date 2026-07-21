<script lang="ts">
  import { onMount } from 'svelte';
  import { t } from '../i18n';

  let {
    title,
    rows = [],
    reasonRequired = true,
    reasonPlaceholder = t('detail.notePlaceholder'),
    showExpiry = false,
    showPassword = false,
    danger = false,
    onConfirm,
    onCancel,
  }: {
    title: string;
    rows?: { label: string; value: string }[];
    reasonRequired?: boolean;
    reasonPlaceholder?: string;
    showExpiry?: boolean;
    showPassword?: boolean;
    danger?: boolean;
    onConfirm: (values: {
      reason: string;
      expiry: string;
      password: string;
    }) => void | Promise<void>;
    onCancel: () => void;
  } = $props();

  let reason = $state('');
  let expiry = $state('');
  let password = $state('');
  let submitting = $state(false);
  let reasonInput: HTMLInputElement;

  onMount(() => reasonInput.focus());

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (submitting) return;
    submitting = true;
    try {
      await onConfirm({ reason: reason.trim(), expiry, password });
    } finally {
      submitting = false;
    }
  }
</script>

<form class="mod-confirm moderation-action-prompt show" onsubmit={submit}>
  <h4>{title}</h4>
  {#if rows.length}
    <dl>
      {#each rows as row}
        <dt>{row.label}</dt>
        <dd>{row.value}</dd>
      {/each}
    </dl>
  {/if}
  <div class="moderation-prompt-fields">
    <label>
      <span>{t('dialog.reason')}</span>
      <input
        bind:this={reasonInput}
        bind:value={reason}
        placeholder={reasonPlaceholder}
        maxlength="500"
        required={reasonRequired}
      />
    </label>
    {#if showExpiry}
      <label>
        <span>{t('dialog.until')}</span>
        <input type="datetime-local" bind:value={expiry} required />
      </label>
    {/if}
    {#if showPassword}
      <label>
        <span>{t('dialog.newPassword')}</span>
        <input
          type="password"
          bind:value={password}
          autocomplete="new-password"
          minlength="6"
          maxlength="128"
          required
        />
      </label>
    {/if}
  </div>
  <div class="confirm-actions">
    <button type="submit" data-confirm-moderation class:danger disabled={submitting}>
      {t('dialog.confirm')}
    </button>
    <button type="button" data-cancel-moderation disabled={submitting} onclick={onCancel}>
      {t('dialog.cancel')}
    </button>
  </div>
</form>
