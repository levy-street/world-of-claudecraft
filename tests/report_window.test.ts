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
import {
  closeReportWindow,
  openReportWindow,
  type ReportWindowDeps,
} from '../src/ui/report_window';

let el: HTMLElement;
let closeOtherWindows: ReturnType<typeof vi.fn<(keep: string) => void>>;
let log: ReturnType<typeof vi.fn<(text: string, color?: string) => void>>;
let captureFocus: ReturnType<typeof vi.fn<() => HTMLElement | null>>;
let restoreFocus: ReturnType<typeof vi.fn<(target: HTMLElement | null) => void>>;
let opener: HTMLElement;

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
  captureFocus,
  restoreFocus,
});

const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

beforeEach(() => {
  document.body.innerHTML =
    '<button id="opener">open</button><div id="report-window" style="display: none"></div>';
  el = document.getElementById('report-window') as HTMLElement;
  opener = document.getElementById('opener') as HTMLElement;
  closeOtherWindows = vi.fn<(keep: string) => void>();
  log = vi.fn<(text: string, color?: string) => void>();
  // The real bridge (window_focus.ts makeWindowFocus) arms the shared
  // FocusManager trap and hands the opener back; the fake records the pair the
  // window is contractually required to move through, which is what these arms
  // pin. FocusManager's own behavior is covered by tests/focus_manager.test.ts.
  captureFocus = vi.fn<() => HTMLElement | null>(() => opener);
  restoreFocus = vi.fn<(target: HTMLElement | null) => void>();
  // The panel persists across opens, so the module's per-open state must not
  // leak between cases either.
  closeReportWindow();
  captureFocus.mockClear();
  restoreFocus.mockClear();
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
    // Success closes and logs the submitted line in the theme gold token
    // (never a raw hex in a painter, src/styles/CLAUDE.md).
    expect(el.style.display).toBe('none');
    expect(log).toHaveBeenCalledWith('Report submitted for Rega.', 'var(--gold)');
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

// The carve-out this window carried until Phase 19B: it was the one
// .window.panel on closeManagedWindow's `default:` arm with no focus trap at
// all, recorded in tests/managed_window_close_registry.test.ts as "needs no
// teardown" (qr-19-report-window-focus-trap-carveout closed it). Every close
// path must now arm and release the shared bridge, so a keyboard player is
// returned to their opener (WCAG 2.2 AA) whichever way the window goes away.
describe('report window: the focus trap (qr-19-report-window-focus-trap-carveout)', () => {
  const open = (hooks: Hooks): void => {
    openReportWindow(
      makeDeps(() => hooks),
      { pid: 7, name: 'Rega' },
    );
  };

  it('arms the trap on open and records the opener', () => {
    open({ submit: vi.fn().mockResolvedValue(undefined) });
    expect(captureFocus).toHaveBeenCalledTimes(1);
    expect(restoreFocus).not.toHaveBeenCalled();
  });

  it('does NOT arm the trap when the hooks gate refuses the open', () => {
    openReportWindow(
      makeDeps(() => null),
      { pid: 7, name: 'Rega' },
    );
    expect(captureFocus).not.toHaveBeenCalled();
    expect(restoreFocus).not.toHaveBeenCalled();
  });

  it('releases the trap and returns focus on the X, on Cancel, and on submit success', async () => {
    // The X is [data-close] index 0, Cancel is index 1; both routed through the
    // same handler body, so each is driven separately rather than assumed.
    for (const index of [0, 1]) {
      open({ submit: vi.fn().mockResolvedValue(undefined) });
      el.querySelectorAll<HTMLElement>('[data-close]')[index]?.click();
      expect(el.style.display, `close control ${index}`).toBe('none');
      expect(restoreFocus, `close control ${index}`).toHaveBeenCalledWith(opener);
      restoreFocus.mockClear();
    }
    open({ submit: vi.fn().mockResolvedValue(undefined) });
    el.querySelector<HTMLElement>('#report-submit')?.click();
    await flush();
    expect(el.style.display).toBe('none');
    expect(restoreFocus).toHaveBeenCalledWith(opener);
  });

  it('leaves the trap armed while a submit is still in flight and after it fails', async () => {
    open({ submit: vi.fn().mockRejectedValue(new Error('invalid report target')) });
    el.querySelector<HTMLElement>('#report-submit')?.click();
    await flush();
    // A failed submit keeps the window open for a retry, so releasing here
    // would strand the trap released over a still-open window.
    expect(el.style.display).toBe('block');
    expect(restoreFocus).not.toHaveBeenCalled();
  });

  it('the exported close() is the one Hud.closeManagedWindow calls, and is idempotent', () => {
    open({ submit: vi.fn().mockResolvedValue(undefined) });
    closeReportWindow();
    expect(el.style.display).toBe('none');
    expect(restoreFocus).toHaveBeenCalledTimes(1);
    expect(restoreFocus).toHaveBeenCalledWith(opener);
    // A second close (Esc after the X, a replacing modal) must not re-fire the
    // focus return into whatever holds focus by then.
    closeReportWindow();
    expect(restoreFocus).toHaveBeenCalledTimes(1);
  });
});

// The parenthetical residue the old registry row recorded and left standing:
// the panel is persistent markup, not a minted node, so the in-flight submit's
// closure outlives the window it started against. Both async arms are guarded
// by a per-open epoch. The REJECT arm is the sharper of the two and the one the
// old row never named: it re-queries #report-error live, so unguarded it paints
// the previous report's failure into the window a player has since reopened.
describe('report window: a stale submit never touches a reopened window', () => {
  it('a resolve landing after a reopen logs the success but leaves the new window open', async () => {
    let settle: (() => void) | undefined;
    const hooks: Hooks = {
      submit: vi.fn().mockReturnValue(
        new Promise<void>((res) => {
          settle = res;
        }),
      ),
    };
    openReportWindow(
      makeDeps(() => hooks),
      { pid: 7, name: 'Rega' },
    );
    el.querySelector<HTMLElement>('#report-submit')?.click();
    closeReportWindow();
    restoreFocus.mockClear();
    openReportWindow(
      makeDeps(() => ({ submit: vi.fn().mockResolvedValue(undefined) })),
      { pid: 9, name: 'Bram' },
    );
    settle?.();
    await flush();
    // The submit really did succeed, so the log line is honest and still fires.
    expect(log).toHaveBeenCalledWith('Report submitted for Rega.', 'var(--gold)');
    // But the reopened window is untouched: still open, its trap still armed.
    expect(el.style.display).toBe('block');
    expect(restoreFocus).not.toHaveBeenCalled();
  });

  it('a reject landing after a reopen does not paint the old error into the new window', async () => {
    let fail: ((err: Error) => void) | undefined;
    const hooks: Hooks = {
      submit: vi.fn().mockReturnValue(
        new Promise<void>((_res, rej) => {
          fail = rej;
        }),
      ),
    };
    openReportWindow(
      makeDeps(() => hooks),
      { pid: 7, name: 'Rega' },
    );
    el.querySelector<HTMLElement>('#report-submit')?.click();
    closeReportWindow();
    openReportWindow(
      makeDeps(() => ({ submit: vi.fn().mockResolvedValue(undefined) })),
      { pid: 9, name: 'Bram' },
    );
    fail?.(new Error('invalid report target'));
    await flush();
    expect(el.querySelector('.panel-title span')?.textContent).toBe('Report Bram');
    expect(el.querySelector('#report-error')?.textContent).toBe('');
  });
});
