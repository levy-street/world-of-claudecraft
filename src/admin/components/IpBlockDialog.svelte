<script lang="ts">
  import { t } from '../i18n';
  import ModalDialog from './ModalDialog.svelte';

  let {
    ip,
    submitting = false,
    onConfirm,
    onCancel,
  }: {
    ip: string;
    submitting?: boolean;
    onConfirm: (reason: string, duration: string) => void;
    onCancel: () => void;
  } = $props();

  let reason = $state('');
  let duration = $state('');

  function submit(event: SubmitEvent): void {
    event.preventDefault();
    if (!submitting) onConfirm(reason.trim(), duration);
  }
</script>

<ModalDialog
  labelledBy="ip-block-dialog-title"
  closeLabel={t('dialog.cancel')}
  onClose={onCancel}
  width="520px"
>
  <form class="ip-block-dialog" onsubmit={submit}>
    <header>
      <h2 id="ip-block-dialog-title">{t('blockedIps.confirmBanTitle')}</h2>
      <code>{ip}</code>
    </header>

    <div class="dialog-body">
      <div class="warning" role="note">
        {t('blockedIps.sharedIpWarning')} {t('blockedIps.expiryHint')}
      </div>

      <label>
        <span>{t('dialog.reason')}</span>
        <textarea
          data-modal-focus
          rows="3"
          maxlength="500"
          placeholder={t('blockedIps.reasonPlaceholder')}
          bind:value={reason}
        ></textarea>
      </label>

      <label>
        <span>{t('blockedIps.expiresLabel')}</span>
        <select bind:value={duration}>
          <option value="">{t('blockedIps.expiresForever')}</option>
          <option value="1d">{t('blockedIps.expires1d')}</option>
          <option value="7d">{t('blockedIps.expires1w')}</option>
          <option value="30d">{t('blockedIps.expires1m')}</option>
        </select>
      </label>
    </div>

    <footer>
      <button type="button" disabled={submitting} onclick={onCancel}>
        {t('dialog.cancel')}
      </button>
      <button class="danger" type="submit" disabled={submitting}>
        {t('blockedIps.add')}
      </button>
    </footer>
  </form>
</ModalDialog>

<style>
  .ip-block-dialog {
    display: flex;
    max-height: calc(100vh - 48px);
    flex-direction: column;
  }

  header {
    padding: 16px 18px;
    border-bottom: 1px solid var(--border);
  }

  h2 {
    color: var(--gold);
    font-family: var(--title-font);
    font-size: 20px;
  }

  header code {
    display: block;
    margin-top: 4px;
    color: var(--text-dim);
  }

  .dialog-body {
    display: grid;
    gap: 14px;
    overflow: auto;
    padding: 18px;
  }

  .warning {
    padding: 9px 11px;
    color: var(--text-dim);
    background: #14131a;
    border-left: 2px solid var(--gold-dim);
    border-radius: 3px;
    font-size: 12px;
    line-height: 1.45;
  }

  label {
    display: grid;
    gap: 6px;
    color: var(--gold-dim);
    font-size: 12px;
  }

  textarea {
    resize: vertical;
  }

  footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 12px 18px 16px;
    border-top: 1px solid var(--border);
  }

  .danger {
    border-color: var(--color-danger-border);
    color: var(--color-danger);
  }

  .danger:hover {
    border-color: var(--color-danger);
    color: var(--text);
  }

  @media (max-width: 800px) {
    .ip-block-dialog {
      height: 100%;
      max-height: none;
    }

    .dialog-body {
      flex: 1;
    }

    footer button {
      min-height: 40px;
      flex: 1;
    }
  }
</style>
