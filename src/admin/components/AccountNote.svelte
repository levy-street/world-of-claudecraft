<script lang="ts">
  import { t } from '../i18n';
  import { addNote, type PendingAction } from '../moderation_actions';
  import Panel from './Panel.svelte';

  // Free-form moderator note. A note is not a sanction: it only appends to the
  // account's audit log (rendered just below in ModerationHistory), so it lives next
  // to the history rather than among the suspend/ban controls.
  let {
    accountId,
    onSubmit,
  }: {
    accountId: number;
    onSubmit: (pending: PendingAction) => boolean | Promise<boolean>;
  } = $props();

  // Mirrors the server cap (server/moderation_db.ts NOTE_MAX): the server truncates
  // past this, so cap the input too rather than silently dropping characters.
  const NOTE_MAX = 2000;

  let note = $state('');

  $effect(() => {
    accountId;
    note = '';
  });

  async function submitNote(): Promise<void> {
    const built = addNote(accountId, note.trim());
    if ('errorKey' in built) {
      window.alert(t(built.errorKey));
      return;
    }
    if (await onSubmit(built.pending)) note = '';
  }
</script>

<div class="note-panel">
  <Panel title={t('detail.addNoteLabel')}>
    <div class="mod-account-note">
      <textarea
        class="note-input"
        rows="2"
        maxlength={NOTE_MAX}
        bind:value={note}
        aria-label={t('detail.addNoteLabel')}
        placeholder={t('detail.addNotePlaceholder')}
      ></textarea>
      <button class="note-submit" disabled={!note.trim()} onclick={submitNote}>
        {t('detail.addNote')}
      </button>
    </div>
  </Panel>
</div>

<style>
  .note-panel {
    margin-top: 18px;
  }

  .mod-account-note {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .note-input {
    width: 100%;
    box-sizing: border-box;
    resize: vertical;
  }

  .note-submit {
    align-self: flex-start;
  }
</style>
