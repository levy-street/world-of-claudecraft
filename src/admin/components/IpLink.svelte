<script lang="ts">
  import { getAdminNavigation, routeHref } from '../navigation';

  let { ip }: { ip: string } = $props();
  const navigation = getAdminNavigation();
</script>

<a
  class="ip-link"
  href={routeHref({ page: 'ip', ip })}
  onclick={(event) => navigation?.navigate(event, { page: 'ip', ip })}
>
  <code>{ip}</code>
</a>

<style>
  .ip-link {
    display: inline-flex;
    align-items: center;
    border-radius: 3px;
  }

  .ip-link:focus-visible {
    outline: 2px solid var(--gold);
    outline-offset: 2px;
  }

  @media (pointer: coarse) {
    .ip-link {
      min-width: 40px;
      min-height: 40px;
    }
  }
</style>
