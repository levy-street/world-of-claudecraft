<script lang="ts">
  import { fmtNumber } from '../format';
  import { t } from '../i18n';

  // The inline layout fits search/filter toolbars. The footer layout gives standalone
  // result lists a stable previous/summary/next structure across wide and mobile screens.
  let {
    total,
    page,
    limit,
    layout = 'inline',
    onPage,
  }: {
    total: number;
    page: number;
    limit: number;
    layout?: 'inline' | 'footer';
    onPage: (page: number) => void;
  } = $props();

  let pages = $derived(Math.max(1, Math.ceil(total / limit)));
</script>

<nav
  class="pagination"
  class:footer={layout === 'footer'}
  class:inline={layout === 'inline'}
  aria-label={t('accounts.paginationLabel')}
>
  <button class="previous" disabled={page <= 1} onclick={() => onPage(page - 1)}>
    {t('accounts.prev')}
  </button>
  <span class="summary" aria-live="polite">
    {t('accounts.pager', {
      page: fmtNumber(page),
      pages: fmtNumber(pages),
      total: fmtNumber(total),
    })}
  </span>
  <button class="next" disabled={page >= pages} onclick={() => onPage(page + 1)}>
    {t('accounts.next')}
  </button>
</nav>

<style>
  .pagination {
    color: var(--text-dim);
    font-size: 12px;
  }

  .inline {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .footer {
    display: grid;
    grid-template-columns: minmax(100px, 1fr) auto minmax(100px, 1fr);
    align-items: center;
    gap: 16px;
    width: 100%;
    margin-top: 14px;
    padding-top: 14px;
    border-top: 1px solid var(--border);
  }

  .footer .previous {
    justify-self: start;
  }

  .footer .summary {
    text-align: center;
  }

  .footer .next {
    justify-self: end;
  }

  button {
    min-width: 76px;
    padding: 5px 10px;
  }

  @media (max-width: 520px) {
    .footer {
      grid-template-columns: 1fr 1fr;
      gap: 10px;
    }

    .footer .summary {
      grid-column: 1 / -1;
      grid-row: 1;
    }

    .footer .previous,
    .footer .next {
      grid-row: 2;
      width: 100%;
    }
  }
</style>
