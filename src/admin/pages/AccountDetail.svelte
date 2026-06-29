<script lang="ts">
  import type { AccountDetail } from '../types';
  import { classLabel, localizeAdminError, t } from '../i18n';
  import { fmtCopper, fmtDate, fmtDuration, fmtRelative } from '../format';
  import { apiPost } from '../api';
  import { auth } from '../state/auth.svelte';
  import {
    type Built,
    forceRename,
    type PendingAction,
  } from '../moderation_actions';
  import AccountModerationActions from '../components/AccountModerationActions.svelte';
  import AccountNote from '../components/AccountNote.svelte';
  import ChatModerationControls from '../components/ChatModerationControls.svelte';
  import ModerationActionPrompt from '../components/ModerationActionPrompt.svelte';
  import ModerationHistory from '../components/ModerationHistory.svelte';

  // Reusable account body: moderation actions, chat state, characters, and recent
  // sessions. Identity and account status belong to the parent context (table row,
  // moderation queue, or modal header). After a successful action, onChanged asks the
  // parent to refresh; the server re-authorizes every action regardless.
  let {
    detail,
    includeAdminControls = false,
    onChanged,
  }: {
    detail: AccountDetail;
    includeAdminControls?: boolean;
    onChanged: () => void;
  } = $props();

  let selectedCharacter = $state<AccountDetail['characters'][number] | null>(null);

  let canModerate = $derived(includeAdminControls && !detail.isAdmin);

  async function submit(built: Built): Promise<boolean> {
    if ('errorKey' in built) {
      window.alert(t(built.errorKey));
      return false;
    }
    return submitPending(built.pending);
  }

  async function submitPending(pending: PendingAction): Promise<boolean> {
    try {
      await apiPost(pending.endpoint, pending.body);
      onChanged();
      return true;
    } catch (err) {
      if (!auth.handleAuthFailure(err)) {
        window.alert(err instanceof Error ? localizeAdminError(err.message) : t('alert.actionFailed'));
      }
      return false;
    }
  }

  // Resetting strikes is reversible and skips confirmation. Lifting a mute goes through
  // the audited chat action prompt because it changes an active moderation state.
  async function direct(endpoint: string): Promise<void> {
    try {
      await apiPost(endpoint, {});
      onChanged();
    } catch (err) {
      if (!auth.handleAuthFailure(err)) {
        window.alert(err instanceof Error ? localizeAdminError(err.message) : t('alert.actionFailed'));
      }
    }
  }

  async function confirmForceRename(values: { reason: string; expiry: string }): Promise<void> {
    const character = selectedCharacter;
    if (!character) return;
    if (await submit(forceRename(character.id, character.name, values.reason))) {
      selectedCharacter = null;
    }
  }
</script>

<div class="account-detail">
  {#if includeAdminControls}
    <AccountModerationActions target={detail} onSubmit={submitPending} />
    <ChatModerationControls
      target={detail}
      onSubmit={submitPending}
      onReset={() => direct(`/admin/api/moderation/accounts/${detail.id}/reset-strikes`)}
    />
  {/if}

  <div class="detail-grid">
    <div>
      <h4>{t('detail.charactersHeader')}</h4>
      {#if detail.characters.length === 0}
        <div class="empty">{t('detail.noCharacters')}</div>
      {:else}
        <table>
          <thead>
            <tr>
              <th>{t('detail.colName')}</th>
              <th>{t('characters.colClass')}</th>
              <th class="num">{t('characters.colLevel')}</th>
              <th class="num">{t('detail.colXp')}</th>
              <th class="num">{t('detail.colMoney')}</th>
              <th class="num">{t('online.colPos')}</th>
              <th>{t('characters.colLastPlayed')}</th>
              {#if canModerate}<th>{t('detail.colActions')}</th>{/if}
            </tr>
          </thead>
          <tbody>
            {#each detail.characters as c}
              <tr>
                <td>{c.name}</td>
                <td>{classLabel(c.class)}</td>
                <td class="num">{c.level}</td>
                <td class="num">{c.xp}</td>
                <td class="num">{fmtCopper(c.copper)}</td>
                <td class="num">{c.pos ? `${Math.round(c.pos.x)}, ${Math.round(c.pos.z)}` : t('common.emptyValue')}</td>
                <td>{fmtRelative(c.updatedAt)}</td>
                {#if canModerate}<td><button class="btn-sm" onclick={() => (selectedCharacter = c)}>{t('detail.forceNameChange')}</button></td>{/if}
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
      {#if selectedCharacter}
        {@const character = selectedCharacter}
        {#key character.id}
          <ModerationActionPrompt
            title={t('dialog.confirmForceName')}
            rows={[
              { label: t('dialog.character'), value: character.name },
              { label: t('dialog.action'), value: t('detail.forceNameChange') },
            ]}
            onConfirm={confirmForceRename}
            onCancel={() => (selectedCharacter = null)}
          />
        {/key}
      {/if}
    </div>
    <div>
      <h4>{t('detail.sessionsHeader', { value: fmtDuration(detail.playtimeSeconds) })}</h4>
      {#if detail.recentSessions.length === 0}
        <div class="empty">{t('detail.noSessions')}</div>
      {:else}
        <table>
          <thead>
            <tr><th>{t('online.colCharacter')}</th><th>{t('detail.started')}</th><th class="num">{t('dialog.length')}</th></tr>
          </thead>
          <tbody>
            {#each detail.recentSessions as s}
              <tr>
                <td>{s.characterName}</td>
                <td>{fmtDate(s.startedAt)}</td>
                <td class="num">{s.endedAt ? fmtDuration(s.seconds) : t('detail.onlineNow')}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
    </div>
  </div>

  {#if includeAdminControls}
    <AccountNote accountId={detail.id} onSubmit={submitPending} />
  {/if}
  <ModerationHistory entries={detail.moderationHistory} />
</div>
