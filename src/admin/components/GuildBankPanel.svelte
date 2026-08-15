<script lang="ts">
  // The guild bank panel on the guild detail page: the operator's view of one
  // guild's live book (GET /admin/api/guilds/:id/bank) and the entry point to
  // the dormant-slot escape hatch.
  //
  // WHY IT EXISTS: a STUCK slot (an item a later content change flagged
  // soulbound / noMarketList / transfer-locked) is refused in both directions,
  // so the guild can neither withdraw it nor disband, and no player action
  // clears it. The purge is the only remedy, it names a slot INDEX plus the
  // itemId at it, and without this panel an operator had to dig both out of the
  // database by hand. Stuck slots therefore render visibly distinct and are the
  // ONLY rows that offer the action, matching the in-game Guild tab, which also
  // renders a dormant slot distinct and never hides it.
  //
  // The read is moderation.read (the parent gates it, like the audit panel
  // beside it); the ACTION is superadmin-only guildbank.purge, so the two are
  // gated independently and a moderator sees the diagnosis without the hatch.
  // Both are presentation only: the server re-authorizes every call.
  import { onMount } from 'svelte';
  import { apiGet, apiPost } from '../api';
  import { fmtCopper, fmtNumber } from '../format';
  import type { GuildBankPurgeBody } from '../guild_bank_purge';
  import { localizeAdminError, t } from '../i18n';
  import { auth } from '../state/auth.svelte';
  import type { GuildBankSlot, GuildBankStateData } from '../types';
  import Badge from './Badge.svelte';
  import GuildBankPurgeDialog from './GuildBankPurgeDialog.svelte';
  import Panel from './Panel.svelte';

  let { guildId }: { guildId: number } = $props();

  let bank = $state<GuildBankStateData | null>(null);
  let failed = $state(false);
  let purgeSlot = $state<GuildBankSlot | null>(null);
  let purging = $state(false);
  let purgeError = $state<string | null>(null);
  let unaudited = $state(false);
  let requestEpoch = 0;
  let canPurge = $derived(auth.can('guildbank.purge'));

  async function loadBank(): Promise<void> {
    const epoch = ++requestEpoch;
    try {
      const next = await apiGet<GuildBankStateData>(`/admin/api/guilds/${guildId}/bank`);
      if (epoch !== requestEpoch) return;
      bank = next;
      failed = false;
    } catch (err) {
      if (epoch === requestEpoch && !auth.handleAuthFailure(err)) failed = true;
    }
  }

  async function purge(body: GuildBankPurgeBody): Promise<void> {
    if (purging) return;
    purging = true;
    try {
      const result = await apiPost<{ audited: boolean }>(
        `/admin/api/guilds/${guildId}/bank/purge-slot`,
        body,
      );
      // The item is gone but its moderation-log row is not: say so rather than
      // report a clean success (the server answers 200 with audited:false).
      unaudited = result.audited === false;
      purgeSlot = null;
      purgeError = null;
      await loadBank();
    } catch (err) {
      if (!auth.handleAuthFailure(err)) {
        // Every refusal this endpoint can answer already has an operator string
        // (not stuck / stale listing, no carrier online, guild being deleted,
        // save rolled back, bank not loaded), so render the real one.
        purgeError =
          err instanceof Error ? localizeAdminError(err.message) : t('guilds.bankPurgeFailed');
        // A refusal usually means the listing moved under the operator (a purge
        // splices, a deposit lands), so refetch before they try again.
        await loadBank();
      }
    } finally {
      purging = false;
    }
  }

  function openPurge(slot: GuildBankSlot): void {
    purgeSlot = slot;
    purgeError = null;
    unaudited = false;
  }

  onMount(() => {
    void loadBank();
  });
</script>

<Panel title={t('guilds.bankTitle')}>
  {#if failed}
    <div class="empty">{t('guilds.bankLoadFailed')}</div>
  {:else if bank}
    <div class="bank-summary">
      <dl>
        <div>
          <dt>{t('guilds.bankTreasury')}</dt>
          <dd>{fmtCopper(bank.treasury)}</dd>
        </div>
        <div>
          <dt>{t('guilds.bankSlotsUsed')}</dt>
          <dd>
            {t('guilds.bankSlotsUsedValue', {
              used: fmtNumber(bank.usedSlots),
              capacity: fmtNumber(bank.capacity),
            })}
          </dd>
        </div>
        <div>
          <dt>{t('guilds.bankDormantCount')}</dt>
          <dd class:stuck={bank.dormantSlots > 0}>{fmtNumber(bank.dormantSlots)}</dd>
        </div>
      </dl>
      <button type="button" onclick={() => void loadBank()}>{t('guilds.bankRefresh')}</button>
    </div>

    {#if unaudited}
      <p class="notice" role="alert">{t('guilds.bankPurgeUnaudited')}</p>
    {/if}

    {#if bank.dormantSlots > 0}
      <p class="stuck-explainer">{t('guilds.bankStuckExplainer')}</p>
    {/if}

    {#if bank.purchasedSlots === 0}
      <div class="empty">{t('guilds.bankUnopened')}</div>
    {:else if bank.slots.length === 0}
      <div class="empty">{t('guilds.bankEmpty')}</div>
    {:else}
      <div class="table-scroll">
        <table>
          <thead>
            <tr>
              <th class="num">{t('guilds.bankColSlot')}</th>
              <th>{t('guilds.bankColItem')}</th>
              <th class="num">{t('guilds.bankColCount')}</th>
              <th>{t('guilds.bankColStatus')}</th>
              {#if canPurge}<th>{t('detail.colActions')}</th>{/if}
            </tr>
          </thead>
          <tbody>
            {#each bank.slots as slot (slot.index)}
              <tr class:dormant={slot.dormant}>
                <td class="num">{fmtNumber(slot.index)}</td>
                <td>{slot.itemId}</td>
                <td class="num">{fmtNumber(slot.count)}</td>
                <td>
                  <Badge variant={slot.dormant ? 'warn' : 'neutral'}>
                    {slot.dormant ? t('guilds.bankStatusStuck') : t('guilds.bankStatusNormal')}
                  </Badge>
                </td>
                {#if canPurge}
                  <td>
                    {#if slot.dormant}
                      <button class="danger" type="button" onclick={() => openPurge(slot)}>
                        {t('guilds.bankPurgeAction')}
                      </button>
                    {/if}
                  </td>
                {/if}
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  {/if}
</Panel>

{#if purgeSlot && canPurge}
  <GuildBankPurgeDialog
    slot={purgeSlot}
    submitting={purging}
    serverError={purgeError}
    onConfirm={purge}
    onClose={() => {
      if (!purging) purgeSlot = null;
    }}
  />
{/if}

<style>
  .bank-summary {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 20px;
    margin-bottom: 12px;
  }

  dl {
    display: flex;
    flex-wrap: wrap;
    gap: 18px 32px;
    margin: 0;
  }

  dl div {
    display: grid;
    gap: 3px;
  }

  dt {
    color: var(--text-dim);
    font-size: 12px;
  }

  dd {
    margin: 0;
    color: var(--text-bright);
  }

  dd.stuck {
    color: var(--badge-warn-text);
  }

  .stuck-explainer,
  .notice {
    margin: 0 0 12px;
    padding: 10px;
    border: 1px solid var(--callout-border);
    border-radius: 4px;
    background: var(--callout-bg);
    color: var(--text-soft);
    font-size: 12px;
  }

  .notice {
    border-color: var(--color-danger-border);
    color: var(--color-danger);
  }

  /* A stuck slot must read as abnormal at a glance and must never be hidden:
     it is what blocks the guild's disband. The DESTRUCTIVE colour is reserved
     for the button, so the row uses the warning callout vocabulary. */
  tr.dormant td {
    background: var(--callout-bg);
  }

  tr.dormant td:first-child {
    box-shadow: inset 2px 0 0 var(--callout-border);
  }

  button.danger {
    border-color: var(--color-danger-border);
    color: var(--color-danger);
  }

  @media (max-width: 640px) {
    .bank-summary {
      display: grid;
    }
  }
</style>
