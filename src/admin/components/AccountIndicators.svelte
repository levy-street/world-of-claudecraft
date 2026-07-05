<script lang="ts">
  import type { AccountStatus } from '../account_status';
  import { fmtDate } from '../format';
  import { t } from '../i18n';
  import Badge from './Badge.svelte';

  let {
    isAdmin = false,
    online = false,
    status,
    suspendedUntil = null,
    size = 'compact',
  }: {
    isAdmin?: boolean;
    online?: boolean;
    status?: AccountStatus;
    suspendedUntil?: string | null;
    size?: 'compact' | 'medium';
  } = $props();
</script>

<span class="account-indicators">
  {#if isAdmin}<Badge variant="admin" {size}>{t('accounts.badgeAdmin')}</Badge>{/if}
  {#if online}<Badge variant="success" {size}>{t('moderation.badgeOnline')}</Badge>{/if}
  {#if status === 'banned'}
    <Badge variant="bad" {size}>{t('accounts.badgeBanned')}</Badge>
  {:else if status === 'suspended'}
    <Badge variant="warn" {size}>{t('detail.suspendedUntil', { value: fmtDate(suspendedUntil) })}</Badge>
  {:else if status === 'active'}
    <Badge variant="neutral" {size}>{t('detail.statusActive')}</Badge>
  {/if}
</span>

<style>
  .account-indicators {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }
</style>
