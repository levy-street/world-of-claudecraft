<script lang="ts">
  import GuildDetail from '../components/GuildDetail.svelte';
  import GuildDirectory from '../components/GuildDirectory.svelte';

  let { guildId }: { guildId?: number } = $props();
</script>

{#if guildId === undefined}
  <GuildDirectory />
{:else}
  <GuildDetail {guildId} />
{/if}
