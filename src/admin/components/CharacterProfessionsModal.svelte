<script lang="ts">
  import { onMount } from 'svelte';
  import type { CharacterProfessionsSheet } from '../types';
  import { apiGet, apiPost } from '../api';
  import { auth } from '../state/auth.svelte';
  import { fmtDate, fmtDecimal, fmtDuration, fmtNumber } from '../format';
  import { classLabel, localizeAdminError, t, zoneIdLabel } from '../i18n';
  import type { Built, PendingAction } from '../moderation_actions';
  import {
    RESTORE_ITEM_MAX_COUNT,
    restoreItem,
    restoreItemSummary,
    restoreSlot,
  } from '../professions_restore';
  import ModalDialog from './ModalDialog.svelte';
  import ModerationActionPrompt from './ModerationActionPrompt.svelte';

  // R35 professions inspector + GM restores for one character. The sheet is
  // server-shaped (server/character_professions.ts); ids in it (professions,
  // effects, nodes) render as data, the AntibotConfig rule, so a new content
  // id never needs a dashboard change.
  let {
    characterId,
    characterName,
    onClose,
  }: {
    characterId: number;
    characterName: string;
    onClose: () => void;
  } = $props();

  let sheet = $state<CharacterProfessionsSheet | null>(null);
  let failed = $state(false);
  let requestId = 0;

  // The pending restore the operator is filling in ('item' | 'slot' | null).
  let restoreKind = $state<'item' | 'slot' | null>(null);
  let itemId = $state('');
  let count = $state(1);
  let professionId = $state('');
  let effectId = $state('');

  let canRestore = $derived(auth.can('moderation.act'));
  // The confirm prompt owns the request while it is open: freezing the inputs
  // keeps the summary the operator is confirming equal to what gets sent.
  let promptOpen = $derived(restoreKind !== null);

  function resetRestoreForm(): void {
    restoreKind = null;
    itemId = '';
    count = 1;
    professionId = '';
    effectId = '';
  }

  async function refresh(): Promise<void> {
    const currentRequest = ++requestId;
    failed = false;
    try {
      const result = await apiGet<CharacterProfessionsSheet>(
        `/admin/api/characters/${characterId}/professions`,
      );
      if (currentRequest !== requestId) return;
      sheet = result;
    } catch (err) {
      if (currentRequest !== requestId) return;
      if (!auth.handleAuthFailure(err)) failed = true;
    }
  }

  async function submitPending(pending: PendingAction): Promise<boolean> {
    try {
      await apiPost(pending.endpoint, pending.body);
      // Clear the fields, not just the prompt: a second click on a still-filled
      // form would silently re-mint the restore the operator just granted.
      resetRestoreForm();
      await refresh();
      return true;
    } catch (err) {
      if (!auth.handleAuthFailure(err)) {
        window.alert(
          err instanceof Error ? localizeAdminError(err.message) : t('alert.actionFailed'),
        );
      }
      return false;
    }
  }

  // alert.restoreCountRange carries the clamp as {max}; the other restore alert
  // keys have no placeholder, so the extra param is inert for them.
  function restoreAlert(errorKey: string): string {
    return t(errorKey, { max: fmtNumber(RESTORE_ITEM_MAX_COUNT) });
  }

  async function submit(built: Built): Promise<void> {
    if ('errorKey' in built) {
      window.alert(restoreAlert(built.errorKey));
      return;
    }
    await submitPending(built.pending);
  }

  async function confirmRestore(values: { reason: string }): Promise<void> {
    if (restoreKind === 'item') {
      await submit(restoreItem(characterId, characterName, itemId, count, values.reason));
    } else if (restoreKind === 'slot') {
      await submit(restoreSlot(characterId, characterName, professionId, effectId, values.reason));
    }
  }

  // Validate BEFORE the prompt opens, so the confirm dialog never shows an
  // impossible request (an empty id, or "xnull" from a cleared number field)
  // that the builder would refuse only after the operator confirms.
  function openItemPrompt(): void {
    if (!itemId.trim()) return window.alert(restoreAlert('alert.itemIdRequired'));
    if (!Number.isInteger(count) || count < 1 || count > RESTORE_ITEM_MAX_COUNT) {
      return window.alert(restoreAlert('alert.restoreCountRange'));
    }
    restoreKind = 'item';
  }

  function openSlotPrompt(): void {
    if (!professionId || !effectId) return window.alert(restoreAlert('alert.restoreSlotSelection'));
    restoreKind = 'slot';
  }

  // The slot's fire mode is a sim enum, not operator copy; an id this build
  // does not know falls back to the raw value rather than throwing.
  function fireModeLabel(mode: string): string {
    if (mode === 'always') return t('profInspect.fireModeAlways');
    if (mode === 'prompt') return t('profInspect.fireModePrompt');
    return mode;
  }

  function archetypeLine(sheetData: CharacterProfessionsSheet): string {
    const a = sheetData.archetype;
    if (!a.activeArchetype) return t('profInspect.archetypeNone');
    // A legacy single-craft save can carry a null pairedMajor: no dangling
    // separator for exactly the blobs this inspector exists to read.
    const majors = a.pairedMajor
      ? t('profInspect.archetypePair', { first: a.activeArchetype, second: a.pairedMajor })
      : a.activeArchetype;
    return t('profInspect.archetypeLine', {
      majors,
      hobby: a.hobbyCraft ?? t('common.emptyValue'),
    });
  }

  onMount(() => {
    return () => {
      requestId += 1;
    };
  });

  // Re-read when the modal is pointed at another character while mounted, so a
  // stale sheet can never sit under a restore aimed at the new one.
  $effect(() => {
    characterId;
    resetRestoreForm();
    sheet = null;
    void refresh();
  });
</script>

<ModalDialog
  labelledBy="prof-inspect-title"
  closeLabel={t('profInspect.close')}
  width="1360px"
  {onClose}
>
  <header>
    <h3 id="prof-inspect-title">{t('profInspect.title', { name: characterName })}</h3>
    <button
      class="prof-inspect-close"
      type="button"
      data-modal-focus
      aria-label={t('profInspect.close')}
      onclick={onClose}
    >
      <span aria-hidden="true"></span>
    </button>
  </header>

  <div class="prof-inspect-body">
    {#if failed}
      <div class="empty">{t('profInspect.loadFailed')}</div>
    {:else if !sheet}
      <div class="empty">{t('profInspect.loading')}</div>
    {:else}
      <p class="text-dim">
        {t('profInspect.levelClass', { level: sheet.level, cls: classLabel(sheet.class) })}
        &middot;
        {#if sheet.live}
          <span>{t('profInspect.liveBadge')}</span>
        {:else}
          <span>{t('profInspect.savedBadge', { when: fmtDate(sheet.updatedAt) })}</span>
        {/if}
        &middot;
        {archetypeLine(sheet)}
        &middot;
        {t('profInspect.knownRecipes', { n: fmtNumber(sheet.knownRecipes) })}
      </p>
      {#if sheet.preMigration}
        <p class="text-dim">{t('profInspect.preMigrationNote')}</p>
      {/if}
      <div class="detail-grid">
        <div>
          <h4>{t('profInspect.gatheringHeader')}</h4>
          <table>
            <thead>
              <tr>
                <th>{t('profInspect.colProfession')}</th>
                <th class="num">{t('profInspect.colProficiency')}</th>
              </tr>
            </thead>
            <tbody>
              {#each sheet.gathering as row}
                <tr>
                  <td>{row.professionId}</td>
                  <td class="num">{fmtDecimal(row.proficiency)}</td>
                </tr>
              {/each}
            </tbody>
          </table>
          <h4>{t('profInspect.craftingHeader')}</h4>
          <table>
            <thead>
              <tr>
                <th>{t('profInspect.colCraft')}</th>
                <th class="num">{t('profInspect.colSkill')}</th>
                <th class="num">{t('profInspect.colTier')}</th>
              </tr>
            </thead>
            <tbody>
              {#each sheet.crafting as row}
                <tr>
                  <td>{row.craftId}</td>
                  <td class="num">{fmtDecimal(row.skill)}</td>
                  <td class="num">{fmtNumber(row.tier)}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
        <div>
          <h4>{t('profInspect.slotsHeader')}</h4>
          {#if sheet.slots.length === 0}
            <div class="empty">{t('profInspect.slotsEmpty')}</div>
          {:else}
            <table>
              <thead>
                <tr>
                  <th>{t('profInspect.colProfession')}</th>
                  <th>{t('profInspect.colEffect')}</th>
                  <th class="num">{t('profInspect.colCharges')}</th>
                  <th>{t('profInspect.colCraftedBy')}</th>
                  <th>{t('profInspect.colFireMode')}</th>
                </tr>
              </thead>
              <tbody>
                {#each sheet.slots as slot}
                  <tr>
                    <td>{slot.professionId}</td>
                    <td>{slot.effectId}</td>
                    <td class="num">
                      {t('profInspect.chargesPair', {
                        current: fmtNumber(slot.durability),
                        max: fmtNumber(slot.maxDurability),
                      })}
                    </td>
                    <td>{slot.craftedBy ?? t('common.emptyValue')}</td>
                    <td>{fireModeLabel(slot.confirmMode)}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          {/if}
          <h4>{t('profInspect.nodeTimersHeader')}</h4>
          {#if sheet.nodeTimers.length === 0}
            <div class="empty">{t('profInspect.nodeTimersEmpty')}</div>
          {:else}
            <table>
              <thead>
                <tr>
                  <th>{t('profInspect.colNode')}</th>
                  <th>{t('profInspect.colZone')}</th>
                  <th class="num">{t('profInspect.colRemaining')}</th>
                </tr>
              </thead>
              <tbody>
                {#each sheet.nodeTimers as timer}
                  <tr>
                    <td>{timer.nodeId}</td>
                    <td>{zoneIdLabel(timer.zoneId, timer.zoneId)}</td>
                    <td class="num">{fmtDuration(timer.remainingSeconds)}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          {/if}
          {#if canRestore}
            <h4>{t('profInspect.restoreHeader')}</h4>
            {#if !sheet.live}
              <p class="text-dim">{t('profInspect.offlineNote')}</p>
            {/if}
            <div class="controls">
              <label>
                <span>{t('profInspect.itemIdLabel')}</span>
                <input
                  bind:value={itemId}
                  disabled={promptOpen}
                  placeholder={t('profInspect.itemIdPlaceholder')}
                />
              </label>
              <label>
                <span>{t('profInspect.countLabel')}</span>
                <input
                  type="number"
                  min="1"
                  max={RESTORE_ITEM_MAX_COUNT}
                  disabled={promptOpen}
                  bind:value={count}
                />
              </label>
              <button class="btn-sm" disabled={promptOpen} onclick={openItemPrompt}>
                {t('profInspect.restoreItemButton')}
              </button>
            </div>
            <div class="controls">
              <label>
                <span>{t('profInspect.professionLabel')}</span>
                <select bind:value={professionId} disabled={promptOpen}>
                  <option value="">{t('profInspect.professionOptionNone')}</option>
                  {#each sheet.gathering as row}
                    <option value={row.professionId}>{row.professionId}</option>
                  {/each}
                </select>
              </label>
              <label>
                <span>{t('profInspect.effectLabel')}</span>
                <select bind:value={effectId} disabled={promptOpen}>
                  <option value="">{t('profInspect.effectOptionNone')}</option>
                  {#each sheet.toolEffectIds as id}
                    <option value={id}>{id}</option>
                  {/each}
                </select>
              </label>
              <button class="btn-sm" disabled={promptOpen} onclick={openSlotPrompt}>
                {t('profInspect.restoreSlotButton')}
              </button>
            </div>
            {#if restoreKind === 'item'}
              <ModerationActionPrompt
                title={t('dialog.confirmRestoreItem')}
                rows={[
                  { label: t('dialog.character'), value: characterName },
                  { label: t('dialog.item'), value: restoreItemSummary(itemId.trim(), count) },
                ]}
                onConfirm={confirmRestore}
                onCancel={() => (restoreKind = null)}
              />
            {:else if restoreKind === 'slot'}
              <ModerationActionPrompt
                title={t('dialog.confirmRestoreSlot')}
                rows={[
                  { label: t('dialog.character'), value: characterName },
                  {
                    label: t('dialog.slot'),
                    value: t('profInspect.slotPair', { profession: professionId, effect: effectId }),
                  },
                ]}
                onConfirm={confirmRestore}
                onCancel={() => (restoreKind = null)}
              />
            {/if}
          {/if}
        </div>
      </div>
    {/if}
  </div>
</ModalDialog>

<style>
  header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
    padding: 16px 18px;
    border-bottom: 1px solid var(--border-subtle);
  }

  h3 {
    color: var(--gold);
    font-family: var(--title-font);
    font-size: 19px;
    line-height: 1.2;
    text-shadow: 1px 1px 2px #000;
  }

  .prof-inspect-close {
    position: relative;
    width: 40px;
    min-width: 40px;
    height: 40px;
    padding: 0;
    background: var(--btn-flat-bg);
  }

  .prof-inspect-close span::before,
  .prof-inspect-close span::after {
    content: "";
    position: absolute;
    top: 18px;
    left: 9px;
    width: 20px;
    height: 2px;
    background: currentColor;
  }

  .prof-inspect-close span::before {
    transform: rotate(45deg);
  }

  .prof-inspect-close span::after {
    transform: rotate(-45deg);
  }

  /* The sheet is taller than the viewport on a laptop, and ModalDialog clips
     (overflow: hidden), so the body owns the scroll; the container-type also
     gives .detail-grid its single-column @container fallback. */
  .prof-inspect-body {
    max-height: calc(100vh - 145px);
    overflow: auto;
    padding: 18px;
    container-type: inline-size;
  }

  @media (max-width: 800px) {
    header {
      padding: 12px 14px;
    }

    .prof-inspect-body {
      max-height: calc(100vh - 120px);
      padding: 14px;
    }
  }
</style>
