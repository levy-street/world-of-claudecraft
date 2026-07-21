<script lang="ts">
  import { onMount } from 'svelte';
  import type { ChatFilterData, ChatModeratedAccount } from '../types';
  import { apiGet, apiPost } from '../api';
  import { auth } from '../state/auth.svelte';
  import { localizeAdminError, t } from '../i18n';
  import { fmtDate, fmtDuration } from '../format';
  import Panel from '../components/Panel.svelte';
  import Badge from '../components/Badge.svelte';
  import WordList from '../components/WordList.svelte';
  import ModerationActionPrompt from '../components/ModerationActionPrompt.svelte';
  import { liftChatMute } from '../moderation_actions';

  // Chat filter tab: escalation config, the soft/hard word tiers, and the list of
  // chat-moderated accounts. Ported from renderChatFilter + wireChatFilterEvents.
  let data = $state<ChatFilterData | null>(null);
  let failed = $state(false);
  let warnings = $state(0);
  let ladder = $state('');
  let selectedLift = $state<ChatModeratedAccount | null>(null);

  let ladderHuman = $derived((data?.config.muteLadderSeconds ?? []).map((s) => fmtDuration(s)).join(' → '));

  async function refresh(): Promise<void> {
    try {
      data = await apiGet<ChatFilterData>('/admin/api/chat-filter');
      warnings = data.config.warningsBeforeMute;
      ladder = data.config.muteLadderSeconds.join(', ');
      failed = false;
    } catch (err) {
      if (!auth.handleAuthFailure(err)) failed = true;
    }
  }

  function fail(err: unknown, fallbackKey: string): void {
    if (!auth.handleAuthFailure(err)) window.alert(err instanceof Error ? localizeAdminError(err.message) : t(fallbackKey));
  }

  function addWord(word: string, tier: 'soft' | 'hard'): void {
    apiPost('/admin/api/chat-filter/words', { word, tier }).then(() => refresh()).catch((err: unknown) => fail(err, 'alert.addWordFailed'));
  }

  function deleteWord(id: number): void {
    apiPost(`/admin/api/chat-filter/words/${id}/delete`, {}).then(() => refresh()).catch((err: unknown) => fail(err, 'alert.removeWordFailed'));
  }

  function saveConfig(): void {
    const warningsBeforeMute = Number(warnings);
    const muteLadderSeconds = ladder.split(',').map((s) => Number(s.trim())).filter((n) => Number.isFinite(n) && n > 0);
    apiPost('/admin/api/chat-filter/config', { warningsBeforeMute, muteLadderSeconds }).then(() => refresh()).catch((err: unknown) => fail(err, 'alert.saveConfigFailed'));
  }

  function resetStrikes(accountId: number): void {
    apiPost(`/admin/api/moderation/accounts/${accountId}/reset-strikes`, {}).then(() => refresh()).catch((err: unknown) => fail(err, 'alert.actionFailed'));
  }

  async function confirmLift(values: { reason: string; expiry: string }): Promise<void> {
    const account = selectedLift;
    if (!account) return;
    const built = liftChatMute(account.id, values.reason);
    if ('errorKey' in built) {
      window.alert(t(built.errorKey));
      return;
    }
    try {
      await apiPost(built.pending.endpoint, built.pending.body);
      selectedLift = null;
      await refresh();
    } catch (err) {
      fail(err, 'alert.actionFailed');
    }
  }

  const muted = (until: string | null) => until !== null && new Date(until).getTime() > Date.now();

  // Presentation only; the server gates the word/config writes on
  // chatfilter.manage and the per-account actions on moderation.act.
  let canManageFilter = $derived(auth.can('chatfilter.manage'));
  let canModerate = $derived(auth.can('moderation.act'));

  onMount(() => { void refresh(); });
</script>

{#if failed}
  <Panel title={t('nav.chatFilter')}><div class="empty">{t('chatFilter.loadFailed')}</div></Panel>
{:else if data}
  <Panel title={t('chatFilter.escalationTitle')}>
    <p class="hint">{t('chatFilter.escalationHint')}</p>
    {#if canManageFilter}
      <div class="cf-config">
        <label>{t('chatFilter.warningsLabel')}
          <input id="cf-warnings" type="number" min="0" max="50" bind:value={warnings} />
        </label>
        <label>{t('chatFilter.ladderLabel')}
          <input id="cf-ladder" type="text" bind:value={ladder} />
        </label>
        <div class="hint">{t('chatFilter.currentLadder')} {ladderHuman || t('common.emptyValue')}</div>
        <button onclick={saveConfig}>{t('chatFilter.saveConfig')}</button>
      </div>
    {:else}
      <div class="hint">{t('chatFilter.currentLadder')} {ladderHuman || t('common.emptyValue')}</div>
    {/if}
  </Panel>

  <WordList
    title={t('chatFilter.softTitle')}
    hint={t('chatFilter.softHint')}
    placeholder={t('chatFilter.softPlaceholder')}
    words={data.soft}
    onAdd={(w) => addWord(w, 'soft')}
    onDelete={deleteWord}
    canEdit={canManageFilter}
  />
  <WordList
    title={t('chatFilter.hardTitle')}
    hint={t('chatFilter.hardHint')}
    placeholder={t('chatFilter.hardPlaceholder')}
    words={data.hard}
    onAdd={(w) => addWord(w, 'hard')}
    onDelete={deleteWord}
    canEdit={canManageFilter}
  />

  <Panel title={t('chatFilter.accountsTitle')} hint={t('chatFilter.accountsHint')}>
    {#if data.accounts.length === 0}
      <div class="empty">{t('chatFilter.noModeratedAccounts')}</div>
    {:else}
      <table>
        <thead>
          <tr><th>{t('moderation.colAccount')}</th><th class="num">{t('chatMod.colStrikes')}</th><th>{t('chatMod.colMute')}</th><th>{t('detail.colActions')}</th></tr>
        </thead>
        <tbody>
          {#each data.accounts as a (a.id)}
            <tr>
              <td>{a.username}{#if a.isAdmin} <Badge>{t('accounts.badgeAdmin')}</Badge>{/if}</td>
              <td class="num">{a.chatStrikes}</td>
              <td>
                {#if muted(a.chatMutedUntil)}<Badge variant="warn">{t('chatMod.mutedUntil', { value: fmtDate(a.chatMutedUntil) })}</Badge>{:else}<Badge>{t('chatMod.notMuted')}</Badge>{/if}
              </td>
              <td>
                {#if canModerate}
                  {#if muted(a.chatMutedUntil)}<button onclick={() => (selectedLift = a)}>{t('chatMod.liftMute')}</button>{/if}
                  {#if a.chatStrikes > 0}<button onclick={() => resetStrikes(a.id)}>{t('chatMod.resetStrikes')}</button>{/if}
                {/if}
              </td>
            </tr>
            {#if selectedLift?.id === a.id}
              <tr>
                <td colspan="4">
                  {#key a.id}
                    <ModerationActionPrompt
                      title={t('dialog.confirmChatUnmute')}
                      rows={[
                        { label: t('dialog.account'), value: a.username },
                        { label: t('dialog.action'), value: t('chatMod.liftChatMute') },
                      ]}
                      onConfirm={confirmLift}
                      onCancel={() => (selectedLift = null)}
                    />
                  {/key}
                </td>
              </tr>
            {/if}
          {/each}
        </tbody>
      </table>
    {/if}
  </Panel>
{/if}
