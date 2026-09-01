// The player-report window: reason dropdown, details box, submit wiring.
// Moved whole out of src/ui/hud.ts under the monolith ratchet (Phase 9b's
// headroom extraction); the Hud keeps a thin wrapper passing this deps bag.
// The hooks shape mirrors hud.ts's ReportHooks structurally so this module
// never imports the coordinator.
import { markDialogRoot } from './dialog_root';
import { esc } from './esc';
import { t } from './i18n';
import { svgIcon } from './ui_icons';

export interface ReportWindowDeps {
  /** Read LIVE at open and at submit time, never captured: the online glue
   *  reassigns the hooks on reconnect, and a submit must post through the
   *  current object (or degrade honestly when they are gone). */
  reportHooks(): {
    submit(targetPid: number, reason: string, details: string): Promise<void>;
    submitByName?(targetName: string, reason: string, details: string): Promise<void>;
  } | null;
  closeOtherWindows(keep: string): void;
  buildDropdown(
    options: { value: string; label: string }[],
    current: string,
    onChange?: (value: string) => void,
    placeholder?: string,
    a11y?: { ariaLabel?: string; labelledBy?: string },
  ): HTMLElement;
  log(text: string, color?: string): void;
  localizeReportError(err: unknown): string;
  /** The shared window-focus bridge (window_focus.ts makeWindowFocus), typed
   *  structurally so this module still imports no coordinator: captureFocus
   *  records the opener and arms the Tab trap on the root, restoreFocus
   *  releases it and hands focus back. */
  captureFocus(): HTMLElement | null;
  restoreFocus(target: HTMLElement | null): void;
}

const $ = <T extends HTMLElement = HTMLElement>(sel: string): T => document.querySelector(sel) as T;

/** What close() needs from the open that armed the trap. Module-level because
 *  this module is a pair of free functions rather than a class (the Phase 9b
 *  extraction's shape) and the panel it drives is a single persistent node. */
let openState: { deps: ReportWindowDeps; opener: HTMLElement | null } | null = null;

/** Bumped on EVERY open and EVERY close, so an in-flight submit can tell
 *  whether the window it started against is still the one on screen. The
 *  panel persists across opens (it is markup, not minted), so before this the
 *  submit closure's late arms wrote into whatever window was open when they
 *  landed: a stale resolve hid a REOPENED window, and a stale reject painted
 *  its error line, because that arm re-queries #report-error live. */
let openEpoch = 0;

/**
 * The one CLOSING path: the two [data-close] buttons, the submit success, and
 * Hud.closeManagedWindow (Esc, the gamepad, a replacing modal) all route here,
 * so the trap is released and focus returns to the opener on every one of them
 * (WCAG 2.2 AA). Safe to call when the window is already closed: the hide is
 * idempotent and the focus return is skipped when no open armed it.
 *
 * A RE-OPEN is the one way the armed state goes away WITHOUT coming through
 * here, and that is correct rather than an omission: the window is not closing,
 * so no focus return is owed, and the bridge's own defensive release drops the
 * previous trap. See the note at the top of openReportWindow.
 */
export function closeReportWindow(): void {
  const state = openState;
  openState = null;
  openEpoch++;
  $('#report-window').style.display = 'none';
  state?.deps.restoreFocus(state.opener);
}

export function openReportWindow(
  deps: ReportWindowDeps,
  target: { pid?: number; name: string },
): void {
  if (!deps.reportHooks()) return;
  // A RE-OPEN OVER AN OPEN WINDOW does NOT route through close(), deliberately.
  // It is reachable (Hud.closeOtherWindows no longer closes siblings, and both
  // open sites are context-menu actions, so reporting a second player while the
  // window stands re-enters here), and the previous trap IS released: the shared
  // bridge's captureFocus opens with `handle?.release(false)`, a release WITHOUT
  // a focus return, written for exactly this case. Closing first instead would
  // be wrong, not merely redundant: FocusManager.restore defers the focus by a
  // tick, so the return would land AFTER this open and park focus on the
  // previous opener, outside the window now on screen, leaving the fresh trap
  // armed but inert (its Tab cycle only engages once focus is already inside).
  deps.closeOtherWindows('#report-window');
  const { pid, name } = target;
  const el = $('#report-window');
  el.innerHTML = `
    <div class="panel-title"><span id="report-title">${esc(t('hud.report.title', { name }))}</span><button type="button" class="x-btn" data-close aria-label="${esc(t('hud.report.cancel'))}" title="${esc(t('hud.report.cancel'))}">${svgIcon('close')}</button></div>
    <label class="report-label" for="report-reason">${esc(t('hud.report.reason'))}</label>
    <div id="report-reason-slot" aria-describedby="report-error"></div>
    <label class="report-label" for="report-details">${esc(t('hud.report.details'))}</label>
    <textarea id="report-details" maxlength="1000" placeholder="${esc(t('hud.report.detailsPlaceholder'))}" aria-describedby="report-error"></textarea>
    <div class="report-error" id="report-error" role="alert" aria-live="polite"></div>
    <div class="report-actions">
      <button class="btn" type="button" id="report-submit">${esc(t('hud.report.submit'))}</button>
      <button class="btn" type="button" data-close>${esc(t('hud.report.cancel'))}</button>
    </div>`;
  el.style.display = 'block'; // centred by the shared .window rule
  // The trap's other half (src/ui/CLAUDE.md pairs them): a window that holds
  // Tab must also carry role=dialog and exactly ONE accessible name, or a
  // screen reader cycles its user inside an unnamed generic container. The
  // title span the markup above just minted is that name.
  // modal is left at its default false, like the sibling windows: this root
  // traps Tab but does not inert the page, and aria-modal=true would tell a
  // screen reader the rest of the page is unavailable when it is not.
  markDialogRoot(el, { labelledBy: 'report-title' });
  // AFTER the display flip and after closeOtherWindows, matching the family:
  // an earlier capture would record whatever the window we just closed handed
  // focus back to rather than this window's own opener.
  openEpoch++;
  // NEVER record this window's own subtree as the opener. markDialogRoot stamps
  // role=dialog, which is the pointer-focus park selector, so a click inside can
  // park focus on this very root; recorded as the opener, the eventual close
  // would take restoreFocus's in-window-refocus branch and return WITHOUT
  // releasing the trap, stranding it armed over a hidden window. Null means
  // "nothing outside to hand back to", which is the honest answer there.
  const captured = deps.captureFocus();
  openState = { deps, opener: captured && el.contains(captured) ? null : captured };
  const epoch = openEpoch;
  const reasonDD = deps.buildDropdown(
    [
      { value: 'harassment', label: t('hud.report.reasons.harassment') },
      { value: 'spam', label: t('hud.report.reasons.spam') },
      { value: 'cheating', label: t('hud.report.reasons.cheating') },
      {
        value: 'offensive_name_or_chat',
        label: t('hud.report.reasons.offensiveNameOrChat'),
      },
      { value: 'other', label: t('hud.report.reasons.other') },
    ],
    'harassment',
    undefined,
    undefined,
    { ariaLabel: t('hud.report.reason') },
  );
  // Give the trigger the id the <label for="report-reason"> points at, so the
  // label (which lost its original target when the slot div was replaced)
  // associates with a real focusable control again.
  reasonDD.querySelector('.ui-dd-btn')?.setAttribute('id', 'report-reason');
  el.querySelector('#report-reason-slot')?.replaceWith(reasonDD);
  el.querySelectorAll('[data-close]').forEach((btn) => {
    btn.addEventListener('click', () => {
      closeReportWindow();
    });
  });
  const submit = $('#report-submit') as HTMLButtonElement;
  submit.addEventListener('click', () => {
    const reason = reasonDD.dataset.value ?? 'other';
    const details = ($('#report-details') as HTMLTextAreaElement).value;
    submit.disabled = true;
    const hooks = deps.reportHooks();
    const request =
      pid !== undefined
        ? hooks?.submit(pid, reason, details)
        : hooks?.submitByName?.(name, reason, details);
    if (!request) {
      submit.disabled = false;
      $('#report-error').textContent = t('hud.report.failed');
      return;
    }
    request
      .then(() => {
        // The log line is the honest outcome of a submit that really did
        // succeed, so it fires whatever is on screen now; only the DOM touch
        // below is epoch-guarded.
        // The gold token, not a hex: painters never hard-code a color in TS
        // (src/styles/CLAUDE.md); the log sink writes style.color, so the
        // var() resolves against the live theme like the talents signature.
        deps.log(t('hud.report.submitted', { name }), 'var(--gold)');
        if (epoch !== openEpoch) return;
        closeReportWindow();
      })
      .catch((err: unknown) => {
        // The error belongs to THIS submit. #report-error is re-queried live,
        // so without the epoch a reject landing after a close and reopen would
        // paint the previous report's failure into the new window.
        if (epoch !== openEpoch) return;
        submit.disabled = false;
        $('#report-error').textContent = deps.localizeReportError(err);
      });
  });
}
