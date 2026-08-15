// @vitest-environment happy-dom

// DOM-consumer coverage for the desktop auto-update card
// (src/ui/desktop_update_toast.ts): the pure state machine is covered in
// tests/desktop_update_view.test.ts; this file drives the real DOM through the
// bridge events and asserts what the player actually sees per mode.
//
// Each test calls init() against a fresh document.body; the module offers no
// teardown, so earlier tests' woc:languagechange listeners survive holding
// their detached roots. That is harmless by construction (a detached root
// renders into nothing) and accepted here rather than adding a teardown API
// the real client would never call.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DesktopBridge, DesktopUpdateEvent } from '../src/runtime';
import { initDesktopUpdateToast, UPTODATE_HIDE_MS } from '../src/ui/desktop_update_toast';
import { ensureLocaleLoaded, formatNumber, setLanguage, t } from '../src/ui/i18n';

type Fire = (event: DesktopUpdateEvent) => void;

function init(): { fire: Fire; installUpdate: ReturnType<typeof vi.fn> } {
  let callback: Fire = () => {};
  const installUpdate = vi.fn(() => Promise.resolve(null));
  const bridge = {
    openBrowserLogin: () => Promise.resolve(),
    takeLoginCode: () => Promise.resolve(null),
    onLoginCode: () => () => {},
    onUpdateEvent: (cb: Fire) => {
      callback = cb;
      return () => {};
    },
    installUpdate,
  } as unknown as DesktopBridge;
  initDesktopUpdateToast(bridge);
  return { fire: (event) => callback(event), installUpdate };
}

const root = () => document.getElementById('desktop-update-toast') as HTMLElement | null;
const q = (sel: string) => root()?.querySelector(sel) as HTMLElement | null;

describe('desktop update card DOM', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('mints the live region hidden at init, before any event arrives', () => {
    // The role=status region must already exist and be idle when the first
    // event populates it, or screen readers drop the announcement.
    init();
    expect(root()).not.toBeNull();
    expect(root()?.hidden).toBe(true);
    expect(root()?.getAttribute('role')).toBe('status');
    expect(root()?.getAttribute('aria-live')).toBe('polite');
    // The stacked-slot CSS keys its taller reservation on this stamp.
    expect(document.body.classList.contains('desktop-update-card')).toBe(true);
  });

  it('a bridge without the update capability mints nothing and stamps nothing', () => {
    document.body.classList.remove('desktop-update-card');
    const bridge = {
      openBrowserLogin: () => Promise.resolve(),
      takeLoginCode: () => Promise.resolve(null),
      onLoginCode: () => () => {},
    } as unknown as DesktopBridge;
    initDesktopUpdateToast(bridge);
    expect(root()).toBeNull();
    expect(document.body.classList.contains('desktop-update-card')).toBe(false);
  });

  it('a second init leaves the existing card alone (no duplicate ids)', () => {
    init();
    init();
    expect(document.querySelectorAll('#desktop-update-toast').length).toBe(1);
    expect(document.querySelectorAll('#desktop-update-title').length).toBe(1);
  });

  it('renders the checking card: spinner, title, body, dismiss; no progress or actions', () => {
    const { fire } = init();
    fire({ type: 'checking' });
    expect(root()?.hidden).toBe(false);
    expect(root()?.dataset.mode).toBe('checking');
    expect(q('.desktop-update-title')?.textContent).toBe(t('desktop.update.checkingTitle'));
    expect(q('.desktop-update-body')?.textContent).toBe(t('desktop.update.checkingBody'));
    expect(q('.desktop-update-spinner')).not.toBeNull();
    expect(q('.desktop-update-progress')?.hidden).toBe(true);
    expect(q('.desktop-update-actions')?.hidden).toBe(true);
    const close = q('.desktop-update-close');
    expect(close?.hidden).toBe(false);
    expect(close?.getAttribute('aria-label')).toBe(t('desktop.update.dismiss'));
  });

  it('shows a live progress bar while downloading, with the full aria wiring', () => {
    const { fire } = init();
    fire({ type: 'checking' });
    fire({ type: 'available', version: '0.30.0' });
    expect(root()?.dataset.mode).toBe('downloading');
    expect(q('.desktop-update-title')?.textContent).toBe(
      t('desktop.update.downloadingTitle', { version: '0.30.0' }),
    );
    expect(q('.desktop-update-title')?.textContent).toContain('0.30.0');
    const progress = q('.desktop-update-progress');
    expect(progress?.hidden).toBe(false);
    expect(progress?.getAttribute('role')).toBe('progressbar');
    expect(progress?.getAttribute('aria-valuemin')).toBe('0');
    expect(progress?.getAttribute('aria-valuemax')).toBe('100');
    expect(progress?.getAttribute('aria-valuenow')).toBe('0');
    // The name reference must resolve, and the bar must sit outside the
    // enclosing polite region so percent ticks are not re-announced.
    expect(progress?.getAttribute('aria-labelledby')).toBe('desktop-update-title');
    expect(document.getElementById('desktop-update-title')).not.toBeNull();
    expect(progress?.getAttribute('aria-live')).toBe('off');
    fire({ type: 'progress', percent: 40 });
    expect(progress?.getAttribute('aria-valuenow')).toBe('40');
    expect(q('.desktop-update-progress-fill')?.style.width).toBe('40%');
    expect(q('.desktop-update-progress-pct')?.textContent).toBe('40%');
  });

  it('renders the percent through the locale-aware formatter, not a hand-built string', async () => {
    await ensureLocaleLoaded('ru_RU');
    setLanguage('ru_RU');
    try {
      const { fire } = init();
      fire({ type: 'available', version: '0.30.0' });
      fire({ type: 'progress', percent: 40 });
      const expected = formatNumber(0.4, { style: 'percent', maximumFractionDigits: 0 });
      // ru_RU separates the number from the sign, so a `${percent}%` template
      // could not produce this; the assertion pins the formatter route.
      expect(expected).not.toBe('40%');
      expect(q('.desktop-update-progress-pct')?.textContent).toBe(expected);
    } finally {
      setLanguage('en');
    }
  });

  it('swaps the icon per mode and never rebuilds it for a same-mode render', () => {
    const { fire } = init();
    fire({ type: 'checking' });
    const spinner = q('.desktop-update-spinner');
    expect(spinner).not.toBeNull();
    // A locale re-render must not re-parse the icon (it would restart the
    // spinner); same node identity proves the iconMode elision.
    document.dispatchEvent(new Event('woc:languagechange'));
    expect(q('.desktop-update-title')?.textContent).toBe(t('desktop.update.checkingTitle'));
    expect(q('.desktop-update-spinner')).toBe(spinner);

    fire({ type: 'available', version: '0.30.0' });
    expect(q('.desktop-update-spinner')).toBeNull();
    const downloadIcon = q('.desktop-update-icon')?.innerHTML ?? '';
    expect(downloadIcon).toContain('<svg');
    fire({ type: 'downloaded', version: '0.30.0' });
    const readyIcon = q('.desktop-update-icon')?.innerHTML ?? '';
    expect(readyIcon).toContain('<svg');
    expect(readyIcon).not.toBe(downloadIcon);
  });

  it('renders the ready card with working Restart now / Later actions', () => {
    const { fire, installUpdate } = init();
    fire({ type: 'available', version: '0.30.0' });
    fire({ type: 'downloaded', version: '0.30.0' });
    expect(root()?.dataset.mode).toBe('ready');
    expect(q('.desktop-update-title')?.textContent).toBe(
      t('desktop.update.readyTitle', { version: '0.30.0' }),
    );
    expect(q('.desktop-update-body')?.textContent).toBe(t('desktop.update.readyBody'));
    expect(q('.desktop-update-actions')?.hidden).toBe(false);
    // The ready card offers the explicit Later choice instead of the corner X.
    expect(q('.desktop-update-close')?.hidden).toBe(true);
    expect(q('.desktop-update-restart')?.textContent).toBe(t('desktop.update.restart'));
    q('.desktop-update-restart')?.click();
    expect(installUpdate).toHaveBeenCalledTimes(1);
    q('.desktop-update-later')?.click();
    expect(root()?.hidden).toBe(true);
  });

  it('dismissing the checking card hides it without suppressing the download notice', () => {
    const { fire } = init();
    fire({ type: 'checking' });
    q('.desktop-update-close')?.click();
    expect(root()?.hidden).toBe(true);
    fire({ type: 'available', version: '0.30.0' });
    expect(root()?.hidden).toBe(false);
    expect(root()?.dataset.mode).toBe('downloading');
  });

  it('dismissing the downloading card suppresses chatter, but ready re-surfaces', () => {
    const { fire } = init();
    fire({ type: 'available', version: '0.30.0' });
    q('.desktop-update-close')?.click();
    expect(root()?.hidden).toBe(true);
    fire({ type: 'available', version: '0.30.0' });
    expect(root()?.hidden).toBe(true);
    fire({ type: 'downloaded', version: '0.30.0' });
    expect(root()?.hidden).toBe(false);
    expect(root()?.dataset.mode).toBe('ready');
  });

  it('the up-to-date confirmation auto-hides after its linger window', () => {
    vi.useFakeTimers();
    const { fire } = init();
    fire({ type: 'checking' });
    fire({ type: 'not-available' });
    expect(root()?.hidden).toBe(false);
    expect(root()?.dataset.mode).toBe('uptodate');
    expect(q('.desktop-update-title')?.textContent).toBe(t('desktop.update.uptodateTitle'));
    // The one mode with no body line hides the body slot entirely.
    expect(q('.desktop-update-body')?.hidden).toBe(true);
    vi.advanceTimersByTime(UPTODATE_HIDE_MS - 1);
    expect(root()?.hidden).toBe(false);
    vi.advanceTimersByTime(1);
    expect(root()?.hidden).toBe(true);
  });

  it('never auto-hides while keyboard focus is inside the card', () => {
    vi.useFakeTimers();
    const { fire } = init();
    fire({ type: 'checking' });
    fire({ type: 'not-available' });
    const close = q('.desktop-update-close');
    close?.focus();
    expect(root()?.contains(document.activeElement)).toBe(true);
    // The timer fires, sees focus inside, and re-arms instead of hiding.
    vi.advanceTimersByTime(UPTODATE_HIDE_MS);
    expect(root()?.hidden).toBe(false);
    close?.blur();
    vi.advanceTimersByTime(UPTODATE_HIDE_MS);
    expect(root()?.hidden).toBe(true);
  });

  it('a manual dismiss of the up-to-date card cancels the linger timer cleanly', () => {
    vi.useFakeTimers();
    const { fire } = init();
    fire({ type: 'checking' });
    fire({ type: 'not-available' });
    q('.desktop-update-close')?.click();
    expect(root()?.hidden).toBe(true);
    // The cleared timer must not fire into the hidden card, and the dismissal
    // must not have suppressed a later download notice.
    vi.advanceTimersByTime(UPTODATE_HIDE_MS * 2);
    expect(root()?.hidden).toBe(true);
    fire({ type: 'available', version: '0.30.0' });
    expect(root()?.hidden).toBe(false);
    expect(root()?.dataset.mode).toBe('downloading');
  });

  it('an error clears a stuck downloading card without any text', () => {
    const { fire } = init();
    fire({ type: 'available', version: '0.30.0' });
    expect(root()?.hidden).toBe(false);
    fire({ type: 'error' });
    expect(root()?.hidden).toBe(true);
  });
});
