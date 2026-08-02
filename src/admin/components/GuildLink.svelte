<script lang="ts">
  import { getAdminNavigation, routeHref } from '../navigation';

  let {
    guildId,
    label,
  }: {
    guildId: number;
    label: string;
  } = $props();

  const navigation = getAdminNavigation();

  function open(event: MouseEvent): void {
    event.stopPropagation();
    navigation?.navigate(event, { page: 'guilds', guildId });
  }
</script>

<a
  class="btn-link"
  href={routeHref({ page: 'guilds', guildId })}
  onclick={open}
>{label}</a>
