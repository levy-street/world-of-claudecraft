// @vitest-environment happy-dom
//
// Behavioral guard for the extracted report window (src/ui/report_window.ts,
// the Phase 9b hud.ts headroom extraction). The move shipped with zero direct
// tests, so extraction parity rested on review alone; these arms pin the
// contract the hud.ts body carried: hooks-gated open, the live hooks read at
// SUBMIT time (the online glue reassigns them on reconnect), the pid-vs-name
// routing, the failure re-enable with the localized error line, and the close
// paths. Copy pins are LITERAL English (never t() compared to t()).

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openReportWindow, type ReportWindowDeps } from '../src/ui/report_window';

let el: HTMLElement;
let closeOtherWindows: ReturnType<typeof vi.fn<(keep: string) => void>>;
let log: ReturnType<typeof vi.fn<(text: string, color?: string) => void>>;

type Hooks = NonNullable<ReturnType<ReportWindowDeps['reportHooks']>>;

const fakeDropdown: ReportWindowDeps['buildDropdown'] = (options, current) => {
  const dd = document.createElement('div');
  dd.dataset.value = current;
  const btn = document.createElement('button');
  btn.className = 'ui-dd-btn';
  btn.textContent = options.find((o) => o.value === current)?.label ?? '';
  dd.appendChild(btn);
  return dd;
};

const makeDeps = (hooks: () => Hooks | null): ReportWindowDeps => ({
  reportHooks: hooks,
  closeOtherWindows,
  buildDropdown: fakeDropdown,
  log,
  localizeReportError: (err) => (err instanceof Error ? `localized:${err.message}` : 'localized:?'),
});

const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

beforeEach(() => {
  document.body.innerHTML = '<div id="report-window" style="display: none"></div>';
  el = document.getElementById('report-window') as HTMLElement;
  closeOtherWindows = vi.fn<(keep: string) => void>();
  log = vi.fn<(text: string, color?: string) => void>();
});

describe('report window: open', () => {
  it('does nothing without report hooks (the offline / logged-out state)', () => {
    openReportWindow(
      makeDeps(() => null),
      { pid: 7, name: 'Rega' },
    );
    expect(el.style.display).toBe('none');
    expect(el.innerHTML).toBe('');
    expect(closeOtherWindows).not.toHaveBeenCalled();
  });

  it('paints the titled form with the reason picker, details box, and actions', () => {
    const hooks: Hooks = { submit: vi.fn().mockResolvedValue(undefined) };
    openReportWindow(
      makeDeps(() => hooks),
      { pid: 7, name: 'Rega' },
    );
    expect(el.style.display).toBe('block');
    expect(closeOtherWindows).toHaveBeenCalledWith('#report-window');
    expect(el.querySelector('.panel-title span')?.textContent).toBe('Report Rega');
    // The dropdown trigger inherits the id the <label for="report-reason"> targets.
    expect(el.querySelector('.ui-dd-btn')?.id).toBe('report-reason');
    expect(el.querySelector('#report-details')).not.toBeNull();
    expect(el.querySelector('#report-submit')?.textContent).toBe('Submit Report');
    expect(el.querySelectorAll('[data-close]')).toHaveLength(2);
  });

  it('both close controls hide the window', () => {
    const hooks: Hooks = { submit: vi.fn().mockResolvedValue(undefined) };
    for (const index of [0, 1]) {
      openReportWindow(
        makeDeps(() => hooks),
        { pid: 7, name: 'Rega' },
      );
      expect(el.style.display).toBe('block');
      el.querySelectorAll<HTMLElement>('[data-close]')[index]?.click();
      expect(el.style.display).toBe('none');
    }
  });
});

describe('report window: submit routing', () => {
  it('routes a pid target through hooks.submit with the picked reason and details', async () => {
    const submit = vi.fn().mockResolvedValue(undefined);
    const hooks: Hooks = { submit, submitByName: vi.fn() };
    openReportWindow(
      makeDeps(() => hooks),
      { pid: 7, name: 'Rega' },
    );
    (el.querySelector('#report-details') as HTMLTextAreaElement).value = 'kited the boss';
    el.querySelector<HTMLElement>('#report-submit')?.click();
    await flush();
    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledWith(7, 'harassment', 'kited the boss');
    expect(hooks.submitByName).not.toHaveBeenCalled();
    // Success closes and logs the submitted line.
    expect(el.style.display).toBe('none');
    expect(log).toHaveBeenCalledWith('Report submitted for Rega.', '#ffd100');
  });

  it('routes a name-only target through submitByName', async () => {
    const submitByName = vi.fn().mockResolvedValue(undefined);
    const hooks: Hooks = { submit: vi.fn(), submitByName };
    openReportWindow(
      makeDeps(() => hooks),
      { name: 'Rega' },
    );
    el.querySelector<HTMLElement>('#report-submit')?.click();
    await flush();
    expect(submitByName).toHaveBeenCalledWith('Rega', 'harassment', '');
    expect(hooks.submit).not.toHaveBeenCalled();
  });

  it('reads the hooks LIVE at submit time (the reconnect reassignment contract)', async () => {
    const first: Hooks = { submit: vi.fn().mockResolvedValue(undefined) };
    const second: Hooks = { submit: vi.fn().mockResolvedValue(undefined) };
    let current: Hooks = first;
    openReportWindow(
      makeDeps(() => current),
      { pid: 7, name: 'Rega' },
    );
    current = second;
    el.querySelector<HTMLElement>('#report-submit')?.click();
    await flush();
    expect(first.submit).not.toHaveBeenCalled();
    expect(second.submit).toHaveBeenCalledTimes(1);
  });

  it('degrades honestly when the hooks are gone at submit time', () => {
    let hooks: Hooks | null = { submit: vi.fn().mockResolvedValue(undefined) };
    openReportWindow(
      makeDeps(() => hooks),
      { pid: 7, name: 'Rega' },
    );
    hooks = null;
    const submit = el.querySelector('#report-submit') as HTMLButtonElement;
    submit.click();
    expect(submit.disabled).toBe(false);
    expect(el.querySelector('#report-error')?.textContent).toBe('Could not submit report.');
    expect(el.style.display).toBe('block');
  });

  it('a rejected submit re-enables the button and localizes the error line', async () => {
    const hooks: Hooks = { submit: vi.fn().mockRejectedValue(new Error('invalid report target')) };
    openReportWindow(
      makeDeps(() => hooks),
      { pid: 7, name: 'Rega' },
    );
    const submit = el.querySelector('#report-submit') as HTMLButtonElement;
    submit.click();
    expect(submit.disabled).toBe(true);
    await flush();
    expect(submit.disabled).toBe(false);
    expect(el.querySelector('#report-error')?.textContent).toBe('localized:invalid report target');
    expect(el.style.display).toBe('block');
    expect(log).not.toHaveBeenCalled();
  });
});
