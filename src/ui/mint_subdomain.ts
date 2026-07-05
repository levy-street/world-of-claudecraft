// Inline "burn $WOC to mint a .sol subdomain" editor for the character-select
// screen, sibling of paid_rename.ts. The character list appends it under a
// row; the actual mint (wallet link, quote, burn + SNS create, confirm) is
// injected by main.ts, so this module owns only the editor DOM + its states.
// Pre-game shell UI: plain DOM, t() strings, esc() interpolation, no per-frame
// paths. Reuses the paid-rename editor CSS (same layout, same slot under the
// row); the shared class also means only one inline editor opens per row.
import { esc } from './esc';
import { t } from './i18n';

export interface MintSubdomainDeps {
  /** Human-readable $WOC price of a subdomain mint, or null while unknown. */
  priceWoc: number | null;
  formatWoc(n: number): string;
  /**
   * Run the paid mint (quote -> burn + create -> confirm). `onStatus` receives
   * already-localized progress text. Resolves once the character is bound.
   */
  mint(
    characterId: number,
    name: string,
    onStatus: (message: string) => void,
  ): Promise<{ fullDomain: string }>;
  /** Refresh the character list after a successful mint. */
  onMinted(): void | Promise<void>;
  /** Localize an API/wallet error for display. */
  errorText(err: unknown): string;
}

/**
 * Open the mint-subdomain editor under `row` (no-op when an inline editor is
 * already open there). Returns the editor element for tests.
 */
export function openMintSubdomainEditor(
  row: HTMLElement,
  character: { id: number; name: string },
  deps: MintSubdomainDeps,
): HTMLElement | null {
  if (row.querySelector('.paid-rename-editor')) return null; // an editor is already open on this row
  const priceLabel = deps.priceWoc !== null ? deps.formatWoc(deps.priceWoc) : '?';
  const editor = document.createElement('div');
  editor.className = 'paid-rename-editor mint-subdomain-editor';
  editor.innerHTML = `
    <input class="paid-rename-input mint-subdomain-input" maxlength="16" autocomplete="off"
      value="${esc(character.name)}"
      placeholder="${esc(t('character.newNamePlaceholder'))}"
      aria-label="${esc(t('character.newNamePlaceholder'))}" />
    <div class="paid-rename-hint">${esc(t('character.mintSolHint', { amount: priceLabel }))}</div>
    <div class="paid-rename-actions">
      <button class="btn paid-rename-cancel" type="button">${esc(t('character.renameCancel'))}</button>
      <button class="btn btn-primary mint-subdomain-confirm" type="button">${esc(
        t('character.mintSolButton', { amount: priceLabel }),
      )}</button>
    </div>
    <div class="paid-rename-status" role="status" aria-live="polite"></div>`;
  row.appendChild(editor);
  const input = editor.querySelector('.mint-subdomain-input') as HTMLInputElement;
  const status = editor.querySelector('.paid-rename-status') as HTMLElement;
  const confirmBtn = editor.querySelector('.mint-subdomain-confirm') as HTMLButtonElement;
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
        const bound = await deps.mint(character.id, name, (m) => {
          status.textContent = m;
        });
        status.textContent = t('woc.mintSuccess', { domain: bound.fullDomain });
        await deps.onMinted();
      } catch (err) {
        status.textContent = deps.errorText(err);
        confirmBtn.disabled = false;
        input.disabled = false;
      }
    })();
  });
  return editor;
}
