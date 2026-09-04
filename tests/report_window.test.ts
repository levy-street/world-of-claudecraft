// @vitest-environment happy-dom
//
// Behavioral guard for the extracted report window (src/ui/report_window.ts,
// the Phase 9b hud.ts headroom extraction). The move shipped with zero direct
// tests, so extraction parity rested on review alone; these arms pin the
// contract the hud.ts body carried: hooks-gated open, the live hooks read at
// SUBMIT time (the online glue reassigns them on reconnect), the pid-vs-name
// routing, the failure re-enable with the localized error line, and the close
// paths. Copy pins are LITERAL English (never t() compared to t()).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FocusManager } from '../src/ui/focus_manager';
import {
  closeReportWindow,
  openReportWindow,
  type ReportWindowDeps,
} from '../src/ui/report_window';
import { makeWindowFocus } from '../src/ui/window_focus';

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
    expect(el.querySelector('.ui-dd-btn')?.getAttribute('aria-describedby')).toBe('report-error');
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

// The carve-out this window carried until Phase 19B: it sat on
// closeManagedWindow's `default:` arm with no focus trap, recorded in
// tests/managed_window_close_registry.test.ts as "needs no teardown"
// (qr-19-report-window-focus-trap-carveout closed it). It was the one such
// panel that TAKES INPUT AND SUBMITS, which is what made the missing
// return-to-opener bite; #map-window is still on that arm and still trapless,
// deliberately, as its surviving registry row says. Every close path must now
// arm and release the shared bridge, so a keyboard player is returned to their
// opener (WCAG 2.2 AA) whichever way the window goes away.
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
    // The POSITIVE half: not-released is only meaningful if the arm is still
    // live, so prove the state survived by closing and watching it fire with
    // the opener this open recorded.
    closeReportWindow();
    expect(restoreFocus).toHaveBeenCalledTimes(1);
    expect(restoreFocus).toHaveBeenCalledWith(opener);
  });

  it('hud.ts arms the bridge on THIS window root, and once for the Hud lifetime', () => {
    // The behavioural arms above all drive a FAKE bridge, so a typo in the
    // root selector would leave every one of them green while the shipped trap
    // armed on nothing. Source-pinned in the shape the sibling windows use
    // (tests/deeds_window.test.ts, tests/reliquary_window.test.ts).
    // process.cwd() is the worktree root under vitest; import.meta.url is not
    // a file URL in the happy-dom env this suite runs in. Comments are STRIPPED
    // first (the tooltip_line_core codeOnly convention): without it a comment
    // quoting the declaration would satisfy the positive half.
    const hud = readFileSync(join(process.cwd(), 'src/ui/hud.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
    expect(hud).toContain(
      "private readonly reportWindowFocus = this.windowFocus('#report-window');",
    );
    // ONCE is half the title, so it is asserted rather than implied: exactly one
    // bridge is minted for this root anywhere in the coordinator.
    expect(hud.split("this.windowFocus('#report-window')").length - 1).toBe(1);
    expect(hud).toContain('...this.reportWindowFocus,');
    // A per-open bridge defeats makeWindowFocus's own defensive release, so
    // the field form is the contract, not a style choice.
    // Both spellings: a later edit reaching for double quotes must not slip
    // past a pin written only for the single-quoted form.
    expect(hud).not.toContain("...this.windowFocus('#report-window')");
    expect(hud).not.toContain('...this.windowFocus("#report-window")');
  });

  it('marks the root a dialog named by its own title (the trap contract other half)', () => {
    open({ submit: vi.fn().mockResolvedValue(undefined) });
    expect(el.getAttribute('role')).toBe('dialog');
    expect(el.getAttribute('aria-labelledby')).toBe('report-title');
    expect(el.querySelector('#report-title')?.textContent).toBe('Report Rega');
    // Exactly ONE accessible name: aria-labelledby shadows aria-label, so a
    // root must never carry both (src/ui/dialog_root.ts).
    expect(el.hasAttribute('aria-label')).toBe(false);
    // Not inert: this root traps Tab but leaves the page available.
    expect(el.getAttribute('aria-modal')).toBe('false');
  });

  it('captures AFTER the display flip and AFTER closeOtherWindows, not before', () => {
    // Ordering is the whole reason the recorded opener is meaningful: capturing
    // earlier would record whatever the window we are closing hands focus back
    // to, and capturing before the flip would read a hidden root.
    let displayAtCapture = '';
    captureFocus.mockImplementation(() => {
      displayAtCapture = el.style.display;
      return opener;
    });
    open({ submit: vi.fn().mockResolvedValue(undefined) });
    expect(displayAtCapture).toBe('block');
    expect(closeOtherWindows.mock.invocationCallOrder[0]).toBeLessThan(
      captureFocus.mock.invocationCallOrder[0],
    );
  });

  it('a RE-OPEN over an open window re-captures WITHOUT returning focus', () => {
    // The one transition every other arm skips, and the one the per-open focus
    // bridge got wrong: Hud.closeOtherWindows does not close siblings, so
    // reporting a second player while the window stands re-enters open().
    //
    // The window is NOT closing, so no focus return is owed, and returning one
    // would be actively wrong: FocusManager.restore defers by a tick, so the
    // return would land after this open and park focus outside the window now
    // on screen. Releasing the previous trap is the shared bridge's job
    // (captureFocus opens with handle.release(false), a release with no return),
    // which a fake bridge cannot show; the source pin below covers the wiring
    // and tests/focus_manager.test.ts covers the manager.
    open({ submit: vi.fn().mockResolvedValue(undefined) });
    expect(captureFocus).toHaveBeenCalledTimes(1);
    const second = document.createElement('button');
    document.body.appendChild(second);
    captureFocus.mockReturnValue(second);
    openReportWindow(
      makeDeps(() => ({ submit: vi.fn().mockResolvedValue(undefined) })),
      { pid: 9, name: 'Bram' },
    );
    expect(restoreFocus).not.toHaveBeenCalled();
    expect(captureFocus).toHaveBeenCalledTimes(2);
    expect(el.style.display).toBe('block');
    expect(el.querySelector('.panel-title span')?.textContent).toBe('Report Bram');
    // The SECOND open's opener is what the eventual close returns to, so the
    // re-capture really did replace the recorded opener rather than keep the
    // first one alive.
    closeReportWindow();
    expect(restoreFocus).toHaveBeenCalledTimes(1);
    expect(restoreFocus).toHaveBeenCalledWith(second);
  });

  it('never records its own subtree as the opener (the role=dialog park hazard)', () => {
    // markDialogRoot stamps role=dialog, which is the pointer-focus park
    // selector, so a click inside can park focus on this root. Recorded as the
    // opener, the close would take restoreFocus's in-window-refocus branch and
    // return without releasing, stranding the trap over a hidden window.
    // Queried LIVE at capture time: the open rebuilds innerHTML, so a node
    // grabbed beforehand is already detached and el.contains() would be false
    // for the wrong reason.
    captureFocus.mockImplementation(() => el.querySelector<HTMLElement>('#report-submit'));
    open({ submit: vi.fn().mockResolvedValue(undefined) });
    expect(captureFocus).toHaveBeenCalledTimes(1);
    closeReportWindow();
    expect(restoreFocus).toHaveBeenCalledWith(null);
  });

  // The Hud link itself is source-pinned in tests/managed_window_close_registry
  // (the parsed `case 'report-window':` body); this arm owns the idempotence.
  it('close() is idempotent, so a second close does not re-fire the focus return', () => {
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
// Every arm above drives a FAKE bridge, which pins the module's CALL PATTERN
// and by construction cannot see where focus actually lands: a vi.fn() restore
// observes no deferred focus move. That blind spot shipped a real regression
// once. A close-before-reopen was added here to release the previous trap, and
// because FocusManager.restore defers by a tick, its return landed AFTER the
// re-open and parked focus on the PREVIOUS opener, outside the window then on
// screen, leaving the fresh trap armed but inert. Every fake-bridge arm stayed
// green through it. So this block drives the REAL makeWindowFocus over a REAL
// FocusManager and asserts on document.activeElement, the crafting-window
// precedent (tests/crafting_window_focus.test.ts).
describe('report window: the REAL focus bridge across a re-open', () => {
  const realDeps = (bridge: ReturnType<typeof makeWindowFocus>): ReportWindowDeps => ({
    ...makeDeps(() => ({ submit: vi.fn().mockResolvedValue(undefined) })),
    ...bridge,
  });

  it('a re-open never parks focus on the opener the FIRST window recorded', async () => {
    const first = document.createElement('button');
    document.body.appendChild(first);
    first.focus();
    expect(document.activeElement).toBe(first);

    const bridge = makeWindowFocus(new FocusManager(), () => el);
    openReportWindow(realDeps(bridge), { pid: 7, name: 'Rega' });

    // The second context-menu open: focus has moved on by the time it fires.
    const second = document.createElement('button');
    document.body.appendChild(second);
    second.focus();
    openReportWindow(realDeps(bridge), { pid: 9, name: 'Bram' });

    // Flush anything FocusManager.restore may have scheduled. If the re-open
    // routed through close(), this is where focus would snap back to `first`.
    await new Promise((resolve) => setTimeout(resolve, 0));
    // A re-open moves focus into the fresh dialog, never back to the first
    // opener or onto the second context-menu control outside it.
    expect(document.activeElement).toBe(el.querySelector('#report-reason'));
    expect(el.querySelector('.panel-title span')?.textContent).toBe('Report Bram');
  });

  it('a real CLOSE MOVES focus back to the opener, so the arm above is not vacuous', async () => {
    const opener1 = document.createElement('button');
    document.body.appendChild(opener1);
    opener1.focus();
    const bridge = makeWindowFocus(new FocusManager(), () => el);
    openReportWindow(realDeps(bridge), { pid: 7, name: 'Rega' });
    const inside = el.querySelector<HTMLElement>('#report-reason');
    expect(document.activeElement).toBe(inside);
    closeReportWindow();
    await vi.waitFor(() => expect(document.activeElement).toBe(opener1));
  });
});

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

  it('a resolve landing after a plain CLOSE, with no reopen, leaves the window shut', async () => {
    // The player submits, closes, and never comes back: the log still fires,
    // the window stays shut, and the focus return does NOT fire a second time.
    //
    // What this does NOT pin, stated rather than implied: the `openEpoch++`
    // inside closeReportWindow is DEFENSIVE and has no observable consequence
    // today. Removing it leaves this arm green, because the stale resolve then
    // simply re-enters close() on an already-closed window, which is a no-op
    // (openState is null, so no second restore) and the stale reject paints a
    // hidden panel the next open rebuilds anyway. Proven by mutation, not
    // assumed. It is kept so "one epoch identifies one open session" is total
    // rather than incidental; if that ever stops being free, delete it rather
    // than inventing an arm for it.
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
    expect(restoreFocus).toHaveBeenCalledTimes(1);
    settle?.();
    await flush();
    expect(log).toHaveBeenCalledWith('Report submitted for Rega.', 'var(--gold)');
    expect(el.style.display).toBe('none');
    expect(restoreFocus).toHaveBeenCalledTimes(1);
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
