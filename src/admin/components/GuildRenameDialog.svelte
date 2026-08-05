<script lang="ts">
  import { t } from '../i18n';
  import { buildGuildRename, type GuildRenameBody } from '../guild_rename';
  import ModalDialog from './ModalDialog.svelte';

  let {
    currentName,
    submitting = false,
    onConfirm,
    onClose,
  }: {
    currentName: string;
    submitting?: boolean;
    onConfirm: (body: GuildRenameBody) => void | Promise<void>;
    onClose: () => void;
  } = $props();

  const titleId = 'guild-rename-title';
  let name = $state('');
  let reason = $state('');
  let confirmed = $state(false);
  let errorKey = $state<string | null>(null);

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (submitting) return;
    const built = buildGuildRename(name, reason);
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
  closeLabel={t('guilds.renameClose')}
  onClose={onClose}
  width="620px"
>
  <form class="guild-rename-dialog" onsubmit={submit}>
    <div class="dialog-header">
      <h2 id={titleId}>{t('guilds.renameTitle')}</h2>
      <button type="button" class="dialog-close" aria-label={t('guilds.renameClose')} onclick={onClose}>
        <span aria-hidden="true">×</span>
      </button>
    </div>

    <div class="dialog-body">
      <dl>
        <dt>{t('guilds.renameOldName')}</dt>
        <dd>{currentName}</dd>
        <dt>{t('guilds.renameNewName')}</dt>
        <dd>{name.trim() || t('common.emptyValue')}</dd>
      </dl>

      <label>
        <span>{t('guilds.renameNameLabel')}</span>
        <input
          data-modal-focus
          bind:value={name}
          placeholder={t('guilds.renameNamePlaceholder')}
          required
        />
      </label>

      <label>
        <span>{t('dialog.reason')}</span>
        <textarea
          bind:value={reason}
          placeholder={t('guilds.renameReasonPlaceholder')}
          rows="4"
          required
        ></textarea>
      </label>

      <label class="confirm-check">
        <input type="checkbox" bind:checked={confirmed} required />
        <span>{t('guilds.renameConfirmation')}</span>
      </label>

      {#if errorKey}
        <p class="form-error" role="alert">{t(errorKey)}</p>
      {/if}
    </div>

    <div class="dialog-actions">
      <button type="button" disabled={submitting} onclick={onClose}>{t('dialog.cancel')}</button>
      <button class="danger" type="submit" disabled={submitting || !confirmed}>
        {submitting ? t('guilds.renaming') : t('guilds.renameConfirm')}
      </button>
    </div>
  </form>
</ModalDialog>

<style>
  .guild-rename-dialog {
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
    .guild-rename-dialog {
      height: 100%;
      max-height: none;
      grid-template-rows: auto minmax(0, 1fr) auto;
    }
  }
</style>
