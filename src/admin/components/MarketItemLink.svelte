<script lang="ts">
  import { getAdminNavigation, routeHref } from '../navigation';

  // Item-name link into the market item detail route (the IpLink idiom).
  let { itemId, name }: { itemId: string; name: string } = $props();
  const navigation = getAdminNavigation();
</script>

<a
  class="item-link"
  href={routeHref({ page: 'market-item', item: itemId })}
  onclick={(event) => navigation?.navigate(event, { page: 'market-item', item: itemId })}
>
  {name}
</a>

<style>
  .item-link {
    display: inline-flex;
    align-items: center;
    border-radius: 3px;
  }

  .item-link:focus-visible {
    outline: 2px solid var(--gold);
    outline-offset: 2px;
  }

  @media (pointer: coarse) {
    .item-link {
      min-height: 40px;
    }
  }
</style>
