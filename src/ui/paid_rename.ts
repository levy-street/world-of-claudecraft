// Inline "pay $WOC to rename" editor for the character-select screen. The
// character list appends it under a row; the actual payment (wallet link,
// quote, burn, confirm) is injected by main.ts, so this module owns only the
// editor DOM + its states. Pre-game shell UI: plain DOM, t() strings, esc()
// interpolation, no per-frame paths.
import { esc } from './esc';
import { t } from './i18n';

export interface PaidRenameDeps {
  /** Human-readable $WOC price of a character rename, or null while unknown. */
  priceWoc: number | null;
  formatWoc(n: number): string;
  /**
   * Run the paid rename (quote -> burn -> confirm). `onStatus` receives
   * already-localized progress text. Resolves once the rename applied.
   */
  pay(
    characterId: number,
    name: string,
    onStatus: (message: string) => void,
  ): Promise<{ name: string }>;
  /** Refresh the character list after a successful rename. */
  onRenamed(): void | Promise<void>;
  /** Localize an API/wallet error for display. */
  errorText(err: unknown): string;
}

/**
 * Open the paid-rename editor under `row` (no-op when already open). Returns
 * the editor element for tests.
 */
export function openPaidRenameEditor(
  row: HTMLElement,
  character: { id: number; name: string },
  deps: PaidRenameDeps,
): HTMLElement | null {
  if (row.querySelector('.paid-rename-editor')) return null; // already open on this row
  const priceLabel = deps.priceWoc !== null ? deps.formatWoc(deps.priceWoc) : '?';
  const editor = document.createElement('div');
  editor.className = 'paid-rename-editor';
  editor.innerHTML = `
    <input class="paid-rename-input" maxlength="16" autocomplete="off"
      placeholder="${esc(t('character.newNamePlaceholder'))}"
      aria-label="${esc(t('character.newNamePlaceholder'))}" />
    <div class="paid-rename-hint">${esc(t('character.renamePriceHint', { amount: priceLabel }))}</div>
    <div class="paid-rename-actions">
      <button class="btn paid-rename-cancel" type="button">${esc(t('character.renameCancel'))}</button>
      <button class="btn btn-primary paid-rename-confirm" type="button">${esc(
        t('character.renamePaidButton', { amount: priceLabel }),
      )}</button>
    </div>
    <div class="paid-rename-status" role="status" aria-live="polite"></div>`;
  row.appendChild(editor);
  const input = editor.querySelector('.paid-rename-input') as HTMLInputElement;
  const status = editor.querySelector('.paid-rename-status') as HTMLElement;
  const confirmBtn = editor.querySelector('.paid-rename-confirm') as HTMLButtonElement;
  input.focus();
  editor.querySelector('.paid-rename-cancel')?.addEventListener('click', (e) => {
    e.stopPropagation();
    editor.remove();
  });
  confirmBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const name = input.value.trim();
    if (!name) {
      input.focus();
      return;
    }
    confirmBtn.disabled = true;
    input.disabled = true;
    void (async () => {
      try {
        const applied = await deps.pay(character.id, name, (m) => {
          status.textContent = m;
        });
        status.textContent = t('woc.renameSuccess', { name: applied.name });
        await deps.onRenamed();
      } catch (err) {
        status.textContent = deps.errorText(err);
        confirmBtn.disabled = false;
        input.disabled = false;
      }
    })();
  });
  return editor;
}
