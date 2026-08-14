<script lang="ts">
  import type { AccountDetail } from '../types';
  import {
    CHEATER_MARK_MAX_HOURS,
    applyCheaterMark,
    liftCheaterMark,
  } from '../cheater_mark_form';
  import { fmtDate, fmtDuration, fmtNumber } from '../format';
  import { t } from '../i18n';
  import type { PendingAction } from '../moderation_actions';
  import ModerationActionPrompt from './ModerationActionPrompt.svelte';

  // The Cheater mark panel: apply the public tag with a played-hours budget,
  // re-length a live one, or lift it early. The server refuses admin targets and
  // re-authorizes every action; hiding the panel for admins mirrors
  // AccountModerationActions.
  let {
    target,
    onSubmit,
  }: {
    target: Pick<AccountDetail, 'id' | 'isAdmin' | 'cheaterMark'>;
    onSubmit: (pending: PendingAction) => boolean | Promise<boolean>;
  } = $props();

  // 'relength' posts the SAME cheater-mark endpoint as 'apply' (the server replaces
  // a live mark's budget on reapply), so a fat-fingered length is one audited action
  // to correct instead of a lift plus a re-apply that visibly drops the public tag.
  type MarkAction = 'apply' | 'relength' | 'lift';

  let selected = $state<MarkAction | null>(null);
  let durationHours = $state<number | undefined>(undefined);

  $effect(() => {
    target.id;
    selected = null;
    durationHours = undefined;
  });

  // alert.cheaterMarkDurationInvalid carries the ceiling as {max}; alert.noteRequired
  // has no placeholder, so the extra param is inert for it (the CharacterProfessionsModal
  // restoreAlert pattern).
  function markAlert(errorKey: string): string {
    return t(errorKey, { max: fmtNumber(CHEATER_MARK_MAX_HOURS) });
  }

  function promptTitle(action: MarkAction): string {
    if (action === 'lift') return t('dialog.confirmCheaterMarkLift');
    if (action === 'relength') return t('dialog.confirmCheaterMarkRelength');
    return t('dialog.confirmCheaterMark');
  }

  function promptAction(action: MarkAction): string {
    if (action === 'lift') return t('dialog.actionCheaterMarkLift');
    if (action === 'relength') return t('dialog.actionCheaterMarkRelength');
    return t('dialog.actionCheaterMark');
  }

  async function confirm(values: { reason: string }): Promise<void> {
    const built =
      selected === 'lift'
        ? liftCheaterMark(target.id, values.reason)
        : applyCheaterMark(target.id, durationHours, values.reason);
    if ('errorKey' in built) {
      window.alert(markAlert(built.errorKey));
      return;
    }
    if (await onSubmit(built.pending)) selected = null;
  }
</script>

{#snippet durationField(hint: string)}
  <label class="mark-duration">
    <span>{t('detail.cheaterMarkDuration')}</span>
    <input
      type="number"
      min="1"
      max={CHEATER_MARK_MAX_HOURS}
      step="1"
      bind:value={durationHours}
      placeholder={t('detail.cheaterMarkDurationPlaceholder')}
    />
    <small>{hint}</small>
  </label>
{/snippet}

{#if !target.isAdmin}
  <section class="account-admin-controls cheater-mark-controls" aria-label={t('detail.cheaterMarkActions')}>
    <h4>{t('detail.cheaterMarkModeration')}</h4>
    {#if target.cheaterMark}
      <div class="moderation-reason mark-state">
        {t('detail.cheaterMarkReason', { value: target.cheaterMark.reason })}
        <span>
          {t('detail.cheaterMarkRemaining', {
            value: fmtDuration(target.cheaterMark.secondsRemaining),
          })}
        </span>
        {#if target.cheaterMark.setAt}
          <span>{t('detail.cheaterMarkSetAt', { value: fmtDate(target.cheaterMark.setAt) })}</span>
        {/if}
      </div>
      {@render durationField(t('detail.cheaterMarkRelengthHint'))}
      <div class="mark-actions">
        <button class="danger" onclick={() => (selected = 'relength')}>
          {t('detail.cheaterMarkRelength')}
        </button>
        <button onclick={() => (selected = 'lift')}>{t('detail.cheaterMarkLift')}</button>
      </div>
    {:else}
      {@render durationField(t('detail.cheaterMarkDurationHint'))}
      <button class="danger" onclick={() => (selected = 'apply')}>
        {t('detail.cheaterMarkApply')}
      </button>
    {/if}
  </section>

  {#if selected}
    {@const action = selected}
    {#key `${target.id}:${action}`}
      <ModerationActionPrompt
        title={promptTitle(action)}
        rows={[
          { label: t('dialog.account'), value: `#${target.id}` },
          { label: t('dialog.action'), value: promptAction(action) },
          ...(action !== 'lift' && typeof durationHours === 'number'
            ? [{ label: t('dialog.length'), value: t('detail.lengthHours', { count: durationHours }) }]
            : []),
        ]}
        danger={action !== 'lift'}
        onConfirm={confirm}
        onCancel={() => (selected = null)}
      />
    {/key}
  {/if}
{/if}

<style>
  .cheater-mark-controls {
    min-width: 0;
    margin: 8px 0;
    padding: 8px;
    border: 1px solid var(--border-subtle);
    border-radius: 4px;
  }

  h4 {
    margin: 0 0 7px;
  }

  .mark-state {
    margin: 5px 0 8px;
  }

  .mark-state span {
    display: block;
    margin-top: 4px;
  }

  .mark-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .mark-duration {
    display: grid;
    gap: 4px;
    margin: 5px 0 8px;
    color: var(--text-dim);
    font-size: 12px;
  }

  .mark-duration input {
    width: min(100%, 180px);
  }

  .mark-duration small {
    color: var(--text-dim);
  }
</style>
