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

  async function refresh(): Promise<void> {
    try {
      const res = await apiGet<ProviderUsageResponse>('/admin/api/provider-usage');
      usage = res.usage;
    } catch (err) {
      if (!auth.handleAuthFailure(err)) console.error('usage refresh failed:', err);
    }
  }

  onMount(() => poll(refresh, LIVE_REFRESH_MS));
</script>

<Panel title={t('usage.title')} hint={t('usage.refreshHint')}>
  {#if usage}
    <ProviderUsage {usage} />
  {/if}
</Panel>
