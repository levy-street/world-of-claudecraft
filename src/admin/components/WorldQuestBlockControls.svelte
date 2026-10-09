<script lang="ts">
  import type { AccountDetail } from '../types';
  import { blockWorldQuests, unblockWorldQuests } from '../world_quest_block_form';
  import { fmtDate } from '../format';
  import { t } from '../i18n';
  import type { PendingAction } from '../moderation_actions';
  import ModerationActionPrompt from './ModerationActionPrompt.svelte';

  // The world quest block panel: stop every character on an account from
  // starting, progressing, or earning anything from world quests (the sanction
  // for world quest botting, short of a ban), or lift it. The server refuses
  // admin targets and re-authorizes every action; hiding the panel for admins
  // mirrors CheaterMarkControls.
  let {
    target,
    onSubmit,
  }: {
    target: Pick<AccountDetail, 'id' | 'isAdmin' | 'worldQuestBlock'>;
    onSubmit: (pending: PendingAction) => boolean | Promise<boolean>;
  } = $props();

  type BlockAction = 'block' | 'unblock';

  let selected = $state<BlockAction | null>(null);

  $effect(() => {
    target.id;
    selected = null;
  });

  async function confirm(values: { reason: string }): Promise<void> {
    const built =
      selected === 'unblock'
        ? unblockWorldQuests(target.id, values.reason)
        : blockWorldQuests(target.id, values.reason);
    if ('errorKey' in built) {
      window.alert(t(built.errorKey));
      return;
    }
    if (await onSubmit(built.pending)) selected = null;
  }
</script>

{#if !target.isAdmin}
  <section
    class="account-admin-controls world-quest-block-controls"
    aria-label={t('detail.worldQuestBlockActions')}
  >
    <h4>{t('detail.worldQuestBlockModeration')}</h4>
    {#if target.worldQuestBlock}
      <div class="moderation-reason block-state">
        {t('detail.worldQuestBlockReason', { value: target.worldQuestBlock.reason })}
        <span>
          {t('detail.worldQuestBlockedAt', { value: fmtDate(target.worldQuestBlock.blockedAt) })}
        </span>
      </div>
      <button onclick={() => (selected = 'unblock')}>{t('detail.worldQuestBlockLift')}</button>
    {:else}
      <small class="block-hint">{t('detail.worldQuestBlockHint')}</small>
      <button class="danger" onclick={() => (selected = 'block')}>
        {t('detail.worldQuestBlockApply')}
      </button>
    {/if}
  </section>

  {#if selected}
    {@const action = selected}
    {#key `${target.id}:${action}`}
      <ModerationActionPrompt
        title={action === 'unblock'
          ? t('dialog.confirmWorldQuestUnblock')
          : t('dialog.confirmWorldQuestBlock')}
        rows={[
          { label: t('dialog.account'), value: `#${target.id}` },
          {
            label: t('dialog.action'),
            value:
              action === 'unblock'
                ? t('dialog.actionWorldQuestUnblock')
                : t('dialog.actionWorldQuestBlock'),
          },
        ]}
        danger={action === 'block'}
        onConfirm={confirm}
        onCancel={() => (selected = null)}
      />
    {/key}
  {/if}
{/if}

<style>
  .world-quest-block-controls {
    min-width: 0;
    margin: 8px 0;
    padding: 8px;
    border: 1px solid var(--border-subtle);
    border-radius: 4px;
  }

  h4 {
    margin: 0 0 7px;
  }

  .block-state {
    margin: 5px 0 8px;
  }

  .block-state span {
    display: block;
    margin-top: 4px;
  }

  .block-hint {
    display: block;
    margin: 0 0 8px;
    color: var(--text-dim);
    font-size: 12px;
  }
</style>
