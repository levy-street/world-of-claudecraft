<script lang="ts">
  import { onMount } from 'svelte';
  import type { ProviderUsageResponse, ProviderUsageSnapshot } from '../types';
  import { apiGet } from '../api';
  import { auth } from '../state/auth.svelte';
  import { LIVE_REFRESH_MS, poll } from '../state/poll';
  import { t } from '../i18n';
  import Panel from '../components/Panel.svelte';
  import ProviderUsage from '../components/ProviderUsage.svelte';

  // Usage tab: provider request counts + cache stats, refreshed every 5s. Served
  // on its own ops_usage.read-gated route (admin/superadmin only), not overview.
  let usage = $state<ProviderUsageSnapshot | null>(null);
  let failed = $state(false);

  async function refresh(): Promise<void> {
    try {
      const res = await apiGet<ProviderUsageResponse>('/admin/api/provider-usage');
      usage = res.usage;
      failed = false;
    } catch (err) {
      if (!auth.handleAuthFailure(err)) failed = true;
    }
  }

  onMount(() => poll(refresh, LIVE_REFRESH_MS));
</script>

<Panel title={t('usage.title')} hint={t('usage.refreshHint')}>
  {#if failed}
    <div class="empty">{t('usage.loadFailed')}</div>
  {:else if usage}
    <ProviderUsage {usage} />
  {/if}
</Panel>
