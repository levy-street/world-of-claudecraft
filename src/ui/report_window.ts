// The player-report window: reason dropdown, details box, submit wiring.
// Moved whole out of src/ui/hud.ts under the monolith ratchet (Phase 9b's
// headroom extraction); the Hud keeps a thin wrapper passing this deps bag.
// The hooks shape mirrors hud.ts's ReportHooks structurally so this module
// never imports the coordinator.
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
}

const $ = <T extends HTMLElement = HTMLElement>(sel: string): T => document.querySelector(sel) as T;

export function openReportWindow(
  deps: ReportWindowDeps,
  target: { pid?: number; name: string },
): void {
  if (!deps.reportHooks()) return;
  deps.closeOtherWindows('#report-window');
  const { pid, name } = target;
  const el = $('#report-window');
  el.innerHTML = `
    <div class="panel-title"><span>${esc(t('hud.report.title', { name }))}</span><button type="button" class="x-btn" data-close aria-label="${esc(t('hud.report.cancel'))}" title="${esc(t('hud.report.cancel'))}">${svgIcon('close')}</button></div>
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
      el.style.display = 'none';
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
        el.style.display = 'none';
        // The gold token, not a hex: painters never hard-code a color in TS
        // (src/styles/CLAUDE.md); the log sink writes style.color, so the
        // var() resolves against the live theme like the talents signature.
        deps.log(t('hud.report.submitted', { name }), 'var(--gold)');
      })
      .catch((err: unknown) => {
        submit.disabled = false;
        $('#report-error').textContent = deps.localizeReportError(err);
      });
  });
}
