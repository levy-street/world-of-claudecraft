// Inline "pay $WOC to respec / unlock a loadout slot" editor for the
// character-select screen (#472). The character list appends it under a row; the
// actual payment (wallet link, quote, burn, confirm) is injected by main.ts, so
// this module owns only the editor DOM + its states. Pre-game shell UI: plain
// DOM, t() strings, esc() interpolation, no per-frame paths. Sibling to
// paid_rename.ts and built to the same recipe, so paid respec grows its own HUD
// module rather than another banner section.
import { esc } from './esc';
import { t } from './i18n';

// The two paid actions this editor offers. Kept as a small closed union so the
// injected `pay` callback and the button map stay exhaustive.
export type RespecAction = 'respec' | 'unlock_loadout_slot';

export interface PaidRespecDeps {
  /** Human-readable $WOC price of a talent respec, or null while unknown. */
  respecPriceWoc: number | null;
  /** Human-readable $WOC price of one extra loadout slot, or null while unknown. */
  loadoutSlotPriceWoc: number | null;
  formatWoc(n: number): string;
  /**
   * Run a paid respec action (quote -> burn -> confirm). `onStatus` receives
   * already-localized progress text. Resolves once the action applied.
   */
  pay(
    action: RespecAction,
    characterId: number,
    onStatus: (message: string) => void,
  ): Promise<unknown>;
  /** Refresh the character list after a successful action. */
  onApplied(): void | Promise<void>;
  /** Localize an API/wallet error for display. */
  errorText(err: unknown): string;
}

/**
 * Open the paid-respec editor under `row` (no-op when already open). Returns the
 * editor element for tests.
 */
export function openPaidRespecEditor(
  row: HTMLElement,
  character: { id: number; name: string },
  deps: PaidRespecDeps,
): HTMLElement | null {
  if (row.querySelector('.paid-respec-editor')) return null; // already open on this row
  const respecLabel = deps.respecPriceWoc !== null ? deps.formatWoc(deps.respecPriceWoc) : '?';
  const slotLabel =
    deps.loadoutSlotPriceWoc !== null ? deps.formatWoc(deps.loadoutSlotPriceWoc) : '?';
  const editor = document.createElement('div');
  editor.className = 'paid-respec-editor';
  editor.innerHTML = `
    <div class="paid-respec-hint">${esc(t('character.respecHint'))}</div>
    <div class="paid-respec-actions">
      <button class="btn paid-respec-cancel" type="button">${esc(t('character.respecCancel'))}</button>
      <button class="btn btn-primary paid-respec-do-respec" type="button">${esc(
        t('character.respecPaidButton', { amount: respecLabel }),
      )}</button>
      <button class="btn btn-primary paid-respec-do-slot" type="button">${esc(
        t('character.loadoutSlotPaidButton', { amount: slotLabel }),
      )}</button>
    </div>
    <div class="paid-respec-status" role="status" aria-live="polite"></div>`;
  row.appendChild(editor);
  const status = editor.querySelector('.paid-respec-status') as HTMLElement;
  const respecBtn = editor.querySelector('.paid-respec-do-respec') as HTMLButtonElement;
  const slotBtn = editor.querySelector('.paid-respec-do-slot') as HTMLButtonElement;
  respecBtn.focus();

  editor.querySelector('.paid-respec-cancel')?.addEventListener('click', (e) => {
    e.stopPropagation();
    editor.remove();
  });

  const run = (
    action: RespecAction,
    successKey: 'character.respecSuccess' | 'character.loadoutSlotSuccess',
  ) => {
    respecBtn.disabled = true;
    slotBtn.disabled = true;
    void (async () => {
      try {
        await deps.pay(action, character.id, (m) => {
          status.textContent = m;
        });
        status.textContent = t(successKey);
        await deps.onApplied();
      } catch (err) {
        status.textContent = deps.errorText(err);
        respecBtn.disabled = false;
        slotBtn.disabled = false;
      }
    })();
  };

  respecBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    run('respec', 'character.respecSuccess');
  });
  slotBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    run('unlock_loadout_slot', 'character.loadoutSlotSuccess');
  });
  return editor;
}
