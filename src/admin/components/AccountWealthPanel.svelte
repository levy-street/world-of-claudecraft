<script lang="ts">
  import { onMount } from 'svelte';
  import { apiGet } from '../api';
  import { fmtCopper, fmtDate, fmtNumber, fmtRelative } from '../format';
  import { t } from '../i18n';
  import { auth } from '../state/auth.svelte';
  import type { AccountWealthData } from '../types';
  import GuildLink from './GuildLink.svelte';

  // The account detail's gold panel: where the account's wealth sits (per
  // character purse, mail and market escrow, guild treasury context) plus the
  // recent large bank-ledger movements. Guild treasuries are shown as context,
  // never summed into the total: the guild bank keeps no depositor identity.
  let { accountId }: { accountId: number } = $props();

  let wealth = $state<AccountWealthData | null>(null);
  let failed = $state(false);
  let requestId = 0;

  async function refresh(): Promise<void> {
    const currentRequest = ++requestId;
    try {
      const result = await apiGet<AccountWealthData>(`/admin/api/accounts/${accountId}/wealth`);
      if (currentRequest !== requestId) return;
      wealth = result;
      failed = false;
    } catch (err) {
      if (currentRequest !== requestId) return;
      if (!auth.handleAuthFailure(err)) failed = true;
    }
  }

  onMount(() => {
    void refresh();
    return () => {
      requestId += 1;
    };
  });
</script>

<div class="wealth-panel">
  <h4>{t('wealth.header')}</h4>
  {#if failed}
    <div class="empty">{t('wealth.loadFailed')}</div>
  {:else if wealth === null}
    <div class="empty">{t('wealth.loading')}</div>
  {:else}
    <div class="totals">
      <span class="stat">
        <span class="text-dim">{t('wealth.total')}</span>
        {fmtCopper(wealth.totalCopper)}
      </span>
      <span class="stat">
        <span class="text-dim">{t('wealth.purse')}</span>
        {fmtCopper(wealth.purseCopper)}
      </span>
      <span class="stat">
        <span class="text-dim">{t('wealth.mailEscrow')}</span>
        {fmtCopper(wealth.mailCopper)}
      </span>
      <span class="stat">
        <span class="text-dim">{t('wealth.marketEscrow')}</span>
        {fmtCopper(wealth.marketCopper)}
      </span>
      {#if wealth.updatedAt}
        <span class="text-dim">{t('wealth.updatedAt', { when: fmtRelative(wealth.updatedAt) })}</span>
      {/if}
    </div>
    {#if wealth.characters.some((c) => c.guildId !== null)}
      <div class="guild-context">
        <span class="text-dim">{t('wealth.guildContext')}</span>
        <ul>
          {#each wealth.characters.filter((c) => c.guildId !== null) as c (c.characterId)}
            <li>
              {c.name}:
              {#if c.guildId !== null && c.guildName !== null}
                <GuildLink guildId={c.guildId} label={c.guildName} />
              {/if}
              {t('wealth.guildTreasury', {
                amount: fmtCopper(c.guildTreasuryCopper ?? 0),
                members: fmtNumber(c.guildMemberCount ?? 0),
              })}
            </li>
          {/each}
        </ul>
      </div>
    {/if}
    <h4>{t('wealth.largeMovementsHeader')}</h4>
    {#if wealth.largeMovementsUnavailable}
      <div class="empty">{t('wealth.largeMovementsUnavailable')}</div>
    {:else if wealth.largeMovements.length === 0}
      <div class="empty">{t('wealth.noLargeMovements')}</div>
    {:else}
      <div class="table-scroll">
        <table>
          <thead>
            <tr>
              <th>{t('wealth.colWhen')}</th>
              <th>{t('detail.colName')}</th>
              <th>{t('wealth.colOp')}</th>
              <th class="num">{t('wealth.colDelta')}</th>
            </tr>
          </thead>
          <tbody>
            {#each wealth.largeMovements as movement (movement.id)}
              <tr>
                <td>{fmtDate(movement.createdAt)}</td>
                <td>{movement.characterName ?? fmtNumber(movement.characterId)}</td>
                <td>
                  <code>{movement.op}</code>
                  {#if movement.container === 'guild'}
                    <span class="text-dim">{t('wealth.guildContainer')}</span>
                  {/if}
                </td>
                <td class="num">
                  {movement.copperDelta >= 0 ? '+' : '-'}{fmtCopper(Math.abs(movement.copperDelta))}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      <p class="hint">{t('wealth.movementsHint')}</p>
    {/if}
  {/if}
</div>

<style>
  .wealth-panel {
    display: grid;
    gap: 10px;
  }

  .totals {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 8px 18px;
  }

  .stat {
    display: inline-flex;
    align-items: baseline;
    gap: 6px;
  }

  .guild-context ul {
    display: grid;
    gap: 4px;
    margin: 4px 0 0;
    padding: 0;
    list-style: none;
  }
</style>
