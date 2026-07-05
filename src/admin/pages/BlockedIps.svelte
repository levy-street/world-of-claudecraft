<script lang="ts">
  import { onMount } from 'svelte';
  import type { BlockedIpsData } from '../types';
  import { apiGet, apiPost } from '../api';
  import { auth } from '../state/auth.svelte';
  import { localizeAdminError, t } from '../i18n';
  import { fmtDate } from '../format';
  import { blockExpiryIso } from '../block_expiry';
  import Panel from '../components/Panel.svelte';
  import Badge from '../components/Badge.svelte';
  import IpLink from '../components/IpLink.svelte';

  // Blocked IPs tab: add an IP block (with a shared-IP confirm) and list/unblock the
  // current blocks. Ported from renderBlockedIps + wireBlockedIpsEvents.
  let data = $state<BlockedIpsData | null>(null);
  let failed = $state(false);
  let ip = $state('');
  let reason = $state('');
  let duration = $state('');

  const now = () => Date.now();

  async function refresh(): Promise<void> {
    try {
      data = await apiGet<BlockedIpsData>('/admin/api/blocked-ips');
      failed = false;
    } catch (err) {
      if (!auth.handleAuthFailure(err)) failed = true;
    }
  }

  function fail(err: unknown, fallbackKey: string): void {
    if (!auth.handleAuthFailure(err)) window.alert(err instanceof Error ? localizeAdminError(err.message) : t(fallbackKey));
  }

  function addBlock(e: SubmitEvent): void {
    e.preventDefault();
    const addr = ip.trim();
    if (!addr) return;
    if (!window.confirm(`${t('blockedIps.confirmBlock', { ip: addr })}\n\n${t('blockedIps.sharedIpWarning')} ${t('blockedIps.expiryHint')}`)) return;
    apiPost('/admin/api/blocked-ips', { ip: addr, reason: reason.trim(), expiresAt: blockExpiryIso(duration) })
      .then(() => { ip = ''; reason = ''; duration = ''; return refresh(); })
      .catch((err: unknown) => fail(err, 'blockedIps.addFailed'));
  }

  function unblock(addr: string): void {
    apiPost('/admin/api/blocked-ips/delete', { ip: addr })
      .then(() => refresh())
      .catch((err: unknown) => fail(err, 'blockedIps.removeFailed'));
  }

  onMount(() => { void refresh(); });
</script>

<Panel title={t('blockedIps.addTitle')}>
  <form class="ip-add" onsubmit={addBlock}>
    <input class="ip-add-ip" placeholder={t('blockedIps.ipPlaceholder')} maxlength="128" bind:value={ip} />
    <input class="ip-add-reason" placeholder={t('blockedIps.reasonPlaceholder')} maxlength="500" bind:value={reason} />
    <label class="ip-add-expiry">{t('blockedIps.expiresLabel')}
      <select class="ip-add-expiry-select" bind:value={duration}>
        <option value="">{t('blockedIps.expiresForever')}</option>
        <option value="1d">{t('blockedIps.expires1d')}</option>
        <option value="7d">{t('blockedIps.expires1w')}</option>
        <option value="30d">{t('blockedIps.expires1m')}</option>
      </select>
    </label>
    <button>{t('blockedIps.add')}</button>
  </form>
</Panel>

<section id="blocked-ips">
  <Panel title={t('blockedIps.listTitle')}>
    {#if failed}
      <div class="empty">{t('blockedIps.loadFailed')}</div>
    {:else if data && data.rows.length === 0}
      <div class="empty">{t('blockedIps.empty')}</div>
    {:else if data}
      <table>
        <thead>
          <tr>
            <th>{t('blockedIps.colIp')}</th>
            <th>{t('blockedIps.colReason')}</th>
            <th>{t('blockedIps.colExpires')}</th>
            <th>{t('blockedIps.colCreatedBy')}</th>
            <th>{t('blockedIps.colCreatedAt')}</th>
            <th>{t('detail.colActions')}</th>
          </tr>
        </thead>
        <tbody>
          {#each data.rows as r (r.id)}
            <tr>
              <td><IpLink ip={r.ip} /></td>
              <td>{r.reason || t('common.emptyValue')}</td>
              <td>
                {#if r.expiresAt === null}
                  <Badge>{t('blockedIps.permanent')}</Badge>
                {:else}
                  <Badge variant={new Date(r.expiresAt).getTime() <= now() ? 'bad' : 'warn'}>{fmtDate(r.expiresAt)}</Badge>
                {/if}
              </td>
              <td>{r.createdByUsername ?? t('common.unknown')}</td>
              <td>{fmtDate(r.createdAt)}</td>
              <td><button onclick={() => unblock(r.ip)}>{t('blockedIps.remove')}</button></td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </Panel>
</section>
