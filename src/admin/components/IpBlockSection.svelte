<script lang="ts">
  import type { ModerationAccountDetail } from '../types';
  import { t } from '../i18n';
  import { knownAccountIps } from '../ip_block';
  import { banIp, type PendingAction } from '../moderation_actions';
  import Panel from './Panel.svelte';
  import Badge from './Badge.svelte';
  import IpLink from './IpLink.svelte';
  import ModerationActionPrompt from './ModerationActionPrompt.svelte';

  // An account's recent IPs and their block status, so a moderator sees at a glance why
  // a player cannot connect. Blocking asks for its own optional reason; unblocking is
  // reversible and applies directly. Admins cannot be locked out, so their unblocked
  // IPs offer no block button.
  let {
    detail,
    onBan,
    onUnblock,
  }: {
    detail: ModerationAccountDetail;
    onBan: (pending: PendingAction) => boolean | Promise<boolean>;
    onUnblock: (ip: string) => void;
  } = $props();

  let selected = $state<{ ip: string; duration: string; label: string } | null>(null);
  let ips = $derived(knownAccountIps(detail));

  $effect(() => {
    detail.account.id;
    selected = null;
  });
  const banButtons = [
    { duration: '1d', label: () => t('blockedIps.ban24h') },
    { duration: '30d', label: () => t('blockedIps.ban30d') },
    { duration: '', label: () => t('blockedIps.banForever') },
  ];

  async function confirm(values: { reason: string; expiry: string }): Promise<void> {
    const action = selected;
    if (!action) return;
    if (await onBan(banIp(action.ip, action.label, action.duration, values.reason))) {
      selected = null;
    }
  }
</script>

<Panel title={t('blockedIps.accountSectionTitle')}>
  {#if ips.length === 0}
    <div class="empty">{t('blockedIps.noKnownIps')}</div>
  {:else}
    <div class="ip-block">
      {#each ips as entry (entry.ip)}
        <div class="ip-row">
          <IpLink ip={entry.ip} />
          {#if entry.isLast}<span class="hint">{t('blockedIps.lastIp')}</span>{/if}
          {#if entry.blocked}<Badge variant="bad">{t('blockedIps.blockedBadge')}</Badge>{/if}
          {#if entry.blocked}
            <button onclick={() => onUnblock(entry.ip)}>{t('blockedIps.unblock')}</button>
          {:else if detail.account.isAdmin}
            <span class="hint">{t('blockedIps.adminProtected')}</span>
          {:else}
            {#each banButtons as b}
              <button
                class="danger"
                onclick={() =>
                  (selected = {
                    ip: entry.ip,
                    duration: b.duration,
                    label: b.label(),
                  })}
              >
                {b.label()}
              </button>
            {/each}
          {/if}
        </div>
      {/each}
    </div>
    {#if selected}
      {@const action = selected}
      {#key `${action.ip}:${action.duration}`}
        <ModerationActionPrompt
          title={t('blockedIps.confirmBanTitle')}
          rows={[
            { label: t('blockedIps.colIp'), value: action.ip },
            { label: t('dialog.action'), value: action.label },
            { label: t('dialog.warning'), value: t('blockedIps.sharedIpWarning') },
          ]}
          reasonRequired={false}
          reasonPlaceholder={t('blockedIps.reasonPlaceholder')}
          danger
          onConfirm={confirm}
          onCancel={() => (selected = null)}
        />
      {/key}
    {/if}
  {/if}
</Panel>
