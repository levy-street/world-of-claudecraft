// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  accountSettingsNoticeOpen,
  showAccountSettingsNotice,
} from '../src/ui/account_settings_notice_controller';
import * as i18n from '../src/ui/i18n';
import { t } from '../src/ui/i18n';

function controls() {
  const dialog = document.getElementById('account-settings-notice') as HTMLElement;
  return {
    dialog,
    checkbox: dialog.querySelector('input') as HTMLInputElement,
    button: dialog.querySelector('button') as HTMLButtonElement,
  };
}

function check(checkbox: HTMLInputElement, checked = true) {
  checkbox.checked = checked;
  checkbox.dispatchEvent(new Event('change', { bubbles: true }));
}

async function complete() {
  const { checkbox, button } = controls();
  check(checkbox);
  button.click();
  await Promise.resolve();
  await vi.runAllTimersAsync();
}

describe('account settings migration acknowledgement', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Happy DOM has no layout; keep the real FocusManager visibility contract
    // exercised with rendered rects for connected elements in this DOM fixture.
    vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(function (
      this: HTMLElement,
    ) {
      return (this.isConnected ? [new DOMRect(0, 0, 40, 40)] : []) as unknown as DOMRectList;
    });
    document.body.innerHTML = '<main id="background"><button id="opener">Login</button></main>';
  });

  afterEach(async () => {
    if (accountSettingsNoticeOpen()) await complete();
    vi.restoreAllMocks();
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('requires checking the box and refuses Escape and backdrop dismissal', async () => {
    const acknowledge = vi.fn(async () => {});
    const resolved = vi.fn();
    const pending = showAccountSettingsNotice(acknowledge).then(resolved);
    const { checkbox, button, dialog } = controls();
    expect(dialog.textContent).toContain(
      "Settings are now saved account wide. When you log in to your first character that character's settings will be applied across your account.",
    );
    expect(checkbox.checked).toBe(false);
    expect(button.disabled).toBe(true);
    expect(dialog.querySelector('[data-close]')).toBeNull();
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const escapeKey = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    });
    checkbox.dispatchEvent(escapeKey);
    dialog.parentElement?.click();
    await Promise.resolve();
    expect(escapeKey.defaultPrevented).toBe(true);
    expect(acknowledge).not.toHaveBeenCalled();
    expect(resolved).not.toHaveBeenCalled();
    expect(accountSettingsNoticeOpen()).toBe(true);
    check(checkbox);
    expect(button.disabled).toBe(false);
    check(checkbox, false);
    expect(button.disabled).toBe(true);
    await complete();
    await pending;
  });

  it('stays open while acknowledgement persists and resolves only on success', async () => {
    let save!: () => void;
    const acknowledge = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          save = resolve;
        }),
    );
    const resolved = vi.fn();
    const pending = showAccountSettingsNotice(acknowledge).then(resolved);
    const { checkbox, button, dialog } = controls();
    check(checkbox);
    button.click();
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(acknowledge).toHaveBeenCalledTimes(1);
    expect(button.disabled).toBe(true);
    expect(checkbox.disabled).toBe(true);
    expect(dialog.getAttribute('aria-busy')).toBe('true');
    checkbox.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(dialog.isConnected).toBe(true);
    expect(resolved).not.toHaveBeenCalled();
    save();
    await pending;
    expect(resolved).toHaveBeenCalledOnce();
    expect(dialog.isConnected).toBe(false);
    expect(accountSettingsNoticeOpen()).toBe(false);
    expect(document.getElementById('background')?.inert).toBe(false);
  });

  it('keeps a failed acknowledgement visible and lets the player retry', async () => {
    const acknowledge = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(undefined);
    const pending = showAccountSettingsNotice(acknowledge);
    const { checkbox, button, dialog } = controls();
    check(checkbox);
    button.click();
    await Promise.resolve();
    expect(dialog.isConnected).toBe(true);
    expect(dialog.querySelector('[role="status"]')?.textContent).toBe(
      t('hudChrome.accountSettingsNotice.failed'),
    );
    expect(dialog.hasAttribute('aria-busy')).toBe(false);
    expect(checkbox.checked).toBe(true);
    expect(checkbox.disabled).toBe(false);
    expect(button.disabled).toBe(false);
    expect(document.activeElement).toBe(button);
    expect(document.getElementById('background')?.inert).toBe(true);
    button.click();
    await pending;
    expect(acknowledge).toHaveBeenCalledTimes(2);
  });

  it('names the dialog, traps keyboard focus, restores focus and prior inert states', async () => {
    const opener = document.getElementById('opener') as HTMLButtonElement;
    opener.focus();
    const previouslyInert = document.createElement('aside');
    previouslyInert.inert = true;
    document.body.append(previouslyInert);
    const pending = showAccountSettingsNotice(async () => {});
    const { checkbox, button, dialog } = controls();
    await vi.runAllTimersAsync();
    expect(document.activeElement).toBe(checkbox);
    expect(dialog.getAttribute('role')).toBe('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-labelledby')).toBe('account-settings-notice-title');
    expect(dialog.getAttribute('aria-describedby')).toBe('account-settings-notice-message');
    const tab = (shiftKey = false) =>
      document.activeElement?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true, cancelable: true }),
      );
    tab();
    expect(document.activeElement).toBe(checkbox);
    check(checkbox);
    tab();
    expect(document.activeElement).toBe(button);
    tab();
    expect(document.activeElement).toBe(checkbox);
    tab(true);
    expect(document.activeElement).toBe(button);
    await complete();
    await pending;
    expect(document.activeElement).toBe(opener);
    expect(previouslyInert.inert).toBe(true);
  });

  it('shares one pending modal across duplicate requests', async () => {
    const acknowledge = vi.fn(async () => {});
    const first = showAccountSettingsNotice(acknowledge);
    const second = showAccountSettingsNotice(acknowledge);
    expect(first).toBe(second);
    expect(document.querySelectorAll('#account-settings-notice')).toHaveLength(1);
    await complete();
    await first;
    expect(acknowledge).toHaveBeenCalledOnce();
  });

  it('rejects a construction failure and permits a fresh login acknowledgement attempt', async () => {
    vi.spyOn(i18n, 't').mockImplementationOnce(() => {
      throw new Error('catalog unavailable');
    });
    await expect(showAccountSettingsNotice(async () => {})).rejects.toThrow('catalog unavailable');
    expect(accountSettingsNoticeOpen()).toBe(false);
    expect(document.getElementById('account-settings-notice')).toBeNull();
    expect(document.getElementById('background')?.inert).toBe(false);
    const pending = showAccountSettingsNotice(async () => {});
    expect(accountSettingsNoticeOpen()).toBe(true);
    await complete();
    await pending;
  });
});
