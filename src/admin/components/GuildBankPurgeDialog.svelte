<script lang="ts">
  // Confirmation for the one admin action that destroys player property: the
  // guild bank dormant-slot purge. Modeled on GuildRenameDialog (form -> pure
  // builder -> errorKey -> onConfirm), with two deliberate differences.
  //
  // 1. The SLOT and ITEM ID are read-only facts, never operator input. The
  //    itemId is the server's stale-listing guard (a purge splices, so every
  //    higher index shifts down), which only means something if it comes from
  //    the same read the index came from. Showing them is the "here is what you
  //    are about to destroy" summary; typing them would defeat the guard.
  // 2. A SERVER refusal renders inside the dialog rather than in an alert, so
  //    the operator sees which slot it belongs to and can act on it (a
  //    not-stuck refusal means their listing was stale; the panel refetches).
  import { t } from '../i18n';
  import { fmtNumber } from '../format';
  import { buildGuildBankPurge, GUILD_BANK_REASON_MAX } from '../guild_bank_purge';
  import type { GuildBankPurgeBody } from '../guild_bank_purge';
  import type { GuildBankSlot } from '../types';
  import ModalDialog from './ModalDialog.svelte';

  let {
    slot,
    submitting = false,
    serverError = null,
    onConfirm,
    onClose,
  }: {
    slot: GuildBankSlot;
    submitting?: boolean;
    /** An already-localized refusal from the last attempt, or null. */
    serverError?: string | null;
    onConfirm: (body: GuildBankPurgeBody) => void | Promise<void>;
    onClose: () => void;
  } = $props();

  const titleId = 'guild-bank-purge-title';
  let reason = $state('');
  let confirmed = $state(false);
  let errorKey = $state<string | null>(null);

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (submitting) return;
    const built = buildGuildBankPurge(slot.index, slot.itemId, reason);
    if ('errorKey' in built) {
      errorKey = built.errorKey;
      return;
    }
    errorKey = null;
    await onConfirm(built.body);
  }
</script>

<ModalDialog
  labelledBy={titleId}
  closeLabel={t('guilds.bankPurgeClose')}
  onClose={onClose}
  width="620px"
>
  <form class="guild-bank-purge-dialog" onsubmit={submit}>
    <div class="dialog-header">
      <h2 id={titleId}>{t('guilds.bankPurgeTitle')}</h2>
      <button
        type="button"
        class="dialog-close"
        aria-label={t('guilds.bankPurgeClose')}
        onclick={onClose}
      >
        <span aria-hidden="true">&times;</span>
      </button>
    </div>

    <div class="dialog-body">
      <dl>
        <dt>{t('guilds.bankColSlot')}</dt>
        <dd>{fmtNumber(slot.index)}</dd>
        <dt>{t('guilds.bankColItem')}</dt>
        <dd>{slot.itemId}</dd>
        <dt>{t('guilds.bankColCount')}</dt>
        <dd>{fmtNumber(slot.count)}</dd>
      </dl>

      <p class="warning" role="note">{t('guilds.bankPurgeWarning')}</p>
      <!-- The carrier consequence: a book persists only inside a live member's
           fenced escrow transaction, and a REFUSED save rolls that session back
           and disconnects it. Rare, but it is a real effect on a bystander, so
           the operator is told before they confirm rather than after. -->
      <p class="carrier-note">{t('guilds.bankPurgeCarrierWarning')}</p>

      <label>
        <span>{t('dialog.reason')}</span>
        <textarea
          data-modal-focus
          bind:value={reason}
          placeholder={t('guilds.bankPurgeReasonPlaceholder')}
          maxlength={GUILD_BANK_REASON_MAX}
          rows="4"
          required
        ></textarea>
      </label>

      <label class="confirm-check">
        <input type="checkbox" bind:checked={confirmed} required />
        <span>{t('guilds.bankPurgeConfirmation')}</span>
      </label>

      {#if errorKey}
        <p class="form-error" role="alert">{t(errorKey)}</p>
      {:else if serverError}
        <p class="form-error" role="alert">{serverError}</p>
      {/if}
    </div>

    <div class="dialog-actions">
      <button type="button" disabled={submitting} onclick={onClose}>{t('dialog.cancel')}</button>
      <button class="danger" type="submit" disabled={submitting || !confirmed}>
        {submitting ? t('guilds.bankPurging') : t('guilds.bankPurgeConfirm')}
      </button>
    </div>
  </form>
</ModalDialog>

<style>
  .guild-bank-purge-dialog {
    display: grid;
    max-height: calc(100vh - 48px);
  }

  .dialog-header,
  .dialog-actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 16px 20px;
  }

  .dialog-header {
    border-bottom: 1px solid var(--border);
  }

  h2 {
    margin: 0;
    color: var(--gold);
    font-family: var(--title-font);
    font-size: 20px;
  }

  .dialog-close {
    width: 40px;
    height: 40px;
    padding: 0;
    font-size: 23px;
    line-height: 1;
  }

  .dialog-body {
    display: grid;
    gap: 16px;
    overflow-y: auto;
    padding: 20px;
  }

  dl {
    display: grid;
    grid-template-columns: max-content minmax(0, 1fr);
    gap: 7px 16px;
    margin: 0;
    padding: 12px;
    background: var(--control-bg);
    border: 1px solid var(--border-subtle);
    border-radius: 4px;
  }

  dt {
    color: var(--text-dim);
  }

  dd {
    min-width: 0;
    margin: 0;
    overflow-wrap: anywhere;
    color: var(--text-bright);
  }

  .warning {
    margin: 0;
    padding: 10px;
    border: 1px solid var(--callout-border);
    border-radius: 4px;
    background: var(--callout-bg);
    color: var(--text-soft);
  }

  .carrier-note {
    margin: -8px 0 0;
    color: var(--text-dim);
    font-size: 12px;
  }

  label:not(.confirm-check) {
    display: grid;
    gap: 6px;
    color: var(--text-soft);
  }

  textarea {
    resize: vertical;
  }

  .confirm-check {
    display: flex;
    align-items: flex-start;
    gap: 9px;
    color: var(--text-soft);
  }

  .confirm-check input {
    margin-top: 2px;
  }

  .form-error {
    margin: 0;
    color: var(--color-danger);
  }

  .dialog-actions {
    justify-content: flex-end;
    border-top: 1px solid var(--border);
  }

  .danger {
    border-color: var(--color-danger-border);
    color: var(--color-danger);
  }

  @media (max-width: 800px) {
    .guild-bank-purge-dialog {
      height: 100%;
      max-height: none;
      grid-template-rows: auto minmax(0, 1fr) auto;
    }
  }
</style>
