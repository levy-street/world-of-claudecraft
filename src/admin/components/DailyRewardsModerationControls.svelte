<script lang="ts">
  import type { AccountDetail } from '../types';
  import { fmtDate, fmtDuration } from '../format';
  import { t } from '../i18n';
  import {
    banDailyRewards,
    moderateDailyRewardsIp,
    type PendingAction,
    unbanDailyRewards,
  } from '../moderation_actions';
  import { recentAccountIps } from '../account_ips';
  import ModerationActionPrompt from './ModerationActionPrompt.svelte';

  let {
    target,
    onSubmit,
  }: {
    target: Pick<AccountDetail, 'id' | 'dailyRewardsBan' | 'dailyRewardsIpBans' | 'lastLogin' | 'lastLoginIp' | 'recentSessions'>;
    onSubmit: (pending: PendingAction) => boolean | Promise<boolean>;
  } = $props();

  let selected = $state<{ action: 'ban' | 'unban' | 'ip-ban' | 'ip-unban'; ip?: string } | null>(null);
  let durationHours = $state<number | undefined>(undefined);
  let ips = $derived(recentAccountIps(target));

  $effect(() => {
    target.id;
    selected = null;
    durationHours = undefined;
  });

  async function confirm(values: { reason: string }): Promise<void> {
    if (selected?.action === 'ip-ban' || selected?.action === 'ip-unban') {
      const built = moderateDailyRewardsIp(
        target.id,
        selected.ip ?? '',
        selected.action === 'ip-ban',
        values.reason,
      );
      if ('errorKey' in built) window.alert(t(built.errorKey));
      else if (await onSubmit(built.pending)) selected = null;
      return;
    }
    const built = selected?.action === 'unban'
      ? unbanDailyRewards(target.id, values.reason)
      : banDailyRewards(target.id, values.reason, durationHours);
    if ('errorKey' in built) {
      window.alert(t(built.errorKey));
      return;
    }
    if (await onSubmit(built.pending)) selected = null;
  }
</script>

<section class="account-admin-controls daily-rewards-controls" aria-label={t('detail.dailyRewardsActions')}>
  <div class="daily-rewards-column">
    <h4>{t('detail.dailyRewardsModeration')}</h4>
    {#if target.dailyRewardsBan}
      <div class="moderation-reason participation-reason">
        {t('detail.dailyRewardsBanReason', { value: target.dailyRewardsBan.reason })}
        {#if target.dailyRewardsBan.expiresAt}
          <span>
            {t('detail.dailyRewardsBanUntil', {
              value: fmtDate(target.dailyRewardsBan.expiresAt),
            })}
          </span>
          <span>
            {t('detail.dailyRewardsBanRemaining', {
              value: fmtDuration(
                Math.max(
                  0,
                  Math.ceil((Date.parse(target.dailyRewardsBan.expiresAt) - Date.now()) / 1000),
                ),
              ),
            })}
          </span>
        {:else}
          <span>{t('detail.dailyRewardsPermanent')}</span>
        {/if}
      </div>
      <button onclick={() => (selected = { action: 'unban' })}>{t('detail.dailyRewardsUnban')}</button>
    {:else}
      <label class="ban-duration">
        <span>{t('detail.dailyRewardsBanDuration')}</span>
        <input
          type="number"
          min="1"
          max="8760"
          step="1"
          bind:value={durationHours}
          placeholder={t('detail.dailyRewardsBanDurationPlaceholder')}
        />
        <small>{t('detail.dailyRewardsBanDurationHint')}</small>
      </label>
      <button class="danger" onclick={() => (selected = { action: 'ban' })}>{t('detail.dailyRewardsBan')}</button>
    {/if}
  </div>

  <div class="daily-rewards-column">
    <h4>{t('detail.dailyRewardsIpModeration')}</h4>
    {#if ips.length === 0}
      <div class="empty-ips">{t('detail.dailyRewardsNoIps')}</div>
    {:else}
      <div class="ip-restrictions">
        {#each ips as entry (entry.ip)}
          {@const ipBan = target.dailyRewardsIpBans?.find((ban) => ban.ip === entry.ip)}
          <div class="ip-restriction">
            <div class="ip-details">
              <code>{entry.ip}</code>
              {#if ipBan}
                <span>{t('detail.dailyRewardsIpBanReason', { value: ipBan.reason })}</span>
              {/if}
            </div>
            {#if ipBan}
              <button onclick={() => (selected = { action: 'ip-unban', ip: entry.ip })}>{t('detail.dailyRewardsIpUnban')}</button>
            {:else}
              <button class="danger" onclick={() => (selected = { action: 'ip-ban', ip: entry.ip })}>{t('detail.dailyRewardsIpBan')}</button>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  </div>
</section>

{#if selected}
  {@const action = selected.action}
  {#key `${target.id}:${action}`}
    <ModerationActionPrompt
      title={action === 'ban'
        ? t('dialog.confirmDailyRewardsBan')
        : action === 'unban'
          ? t('dialog.confirmDailyRewardsUnban')
          : action === 'ip-ban'
            ? t('dialog.confirmDailyRewardsIpBan')
            : t('dialog.confirmDailyRewardsIpUnban')}
      rows={[
        { label: t('dialog.account'), value: `#${target.id}` },
        ...(selected.ip ? [{ label: t('blockedIps.colIp'), value: selected.ip }] : []),
        {
          label: t('dialog.action'),
          value: action === 'ban'
            ? t('dialog.actionDailyRewardsBan')
            : action === 'unban'
              ? t('dialog.actionDailyRewardsUnban')
              : action === 'ip-ban'
                ? t('dialog.actionDailyRewardsIpBan')
                : t('dialog.actionDailyRewardsIpUnban'),
        },
        ...(action === 'ban'
          ? [{
              label: t('dialog.length'),
              value: durationHours === undefined
                ? t('detail.dailyRewardsPermanent')
                : t('detail.lengthHours', { count: durationHours }),
            }]
          : []),
      ]}
      danger={action === 'ban' || action === 'ip-ban'}
      onConfirm={confirm}
      onCancel={() => (selected = null)}
    />
  {/key}
{/if}

<style>
  .daily-rewards-controls {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 12px;
    margin: 8px 0;
  }

  .daily-rewards-column {
    min-width: 0;
    padding: 8px;
    border: 1px solid var(--border-subtle);
    border-radius: 4px;
  }

  h4 {
    margin: 0 0 7px;
  }

  .participation-reason,
  .empty-ips {
    margin: 5px 0 8px;
  }

  .participation-reason span {
    display: block;
    margin-top: 4px;
  }

  .ban-duration {
    display: grid;
    gap: 4px;
    margin: 5px 0 8px;
    color: var(--text-dim);
    font-size: 12px;
  }

  .ban-duration input {
    width: min(100%, 180px);
  }

  .ban-duration small {
    color: var(--text-dim);
  }

  .ip-restrictions {
    display: grid;
    gap: 6px;
  }

  .ip-restriction {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 5px 0;
    border-top: 1px solid var(--border-subtle);
  }

  .ip-restriction:first-child {
    padding-top: 0;
    border-top: 0;
  }

  .ip-details {
    display: grid;
    gap: 3px;
    min-width: 0;
    color: var(--text-dim);
    font-size: 12px;
  }

  .ip-details code {
    overflow-wrap: anywhere;
  }

  button {
    flex: none;
  }

  @media (max-width: 760px) {
    .daily-rewards-controls {
      grid-template-columns: 1fr;
    }
  }
</style>
