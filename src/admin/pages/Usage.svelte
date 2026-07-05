<script lang="ts">
  import { onMount } from 'svelte';
  import type { Overview } from '../types';
  import { apiGet } from '../api';
  import { auth } from '../state/auth.svelte';
  import { LIVE_REFRESH_MS, poll } from '../state/poll';
  import { t } from '../i18n';
  import Panel from '../components/Panel.svelte';
  import ProviderUsage from '../components/ProviderUsage.svelte';

  // Usage tab: provider request counts + cache stats, refreshed every 5s. The usage
  // snapshot ships inside the overview payload (same as the old refreshLive).
  let usage = $state<Overview['usage'] | null>(null);

  async function refresh(): Promise<void> {
    try {
      const ov = await apiGet<Overview>('/admin/api/overview');
      usage = ov.usage;
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
