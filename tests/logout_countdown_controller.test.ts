// @vitest-environment happy-dom
// The Log Out countdown prompt (src/ui/logout_countdown_controller.ts): mounts
// in #prompt-stack on `started`, follows the once-a-second beats the server
// sends, and comes down on `cancelled` or `completed`.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { t } from '../src/ui/i18n';
import { LogoutCountdownController } from '../src/ui/logout_countdown_controller';

function mount() {
  document.body.innerHTML = '<div id="prompt-stack"></div>';
  const cancel = vi.fn();
  const showError = vi.fn();
  const log = vi.fn();
  const controller = new LogoutCountdownController(cancel, showError, log);
  const prompt = (): HTMLElement | null => document.querySelector('#prompt-stack .prompt');
  const text = (): string => prompt()?.querySelector('.prompt-text')?.textContent ?? '';
  return { controller, cancel, showError, log, prompt, text };
}

describe('the Log Out countdown prompt', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('shows the seconds the server sent and a Cancel button', () => {
    const h = mount();
    h.controller.apply({ type: 'logout', phase: 'started', seconds: 30 });
    expect(h.text()).toBe('Logging out in 30 seconds');
    expect(h.prompt()?.querySelector('button')?.textContent).toBe(t('hudChrome.logout.cancel'));
    // Named by its own line, and not a dialog: the player keeps playing under it.
    expect(h.prompt()?.getAttribute('aria-labelledby')).toBe(
      h.prompt()?.querySelector('.prompt-text')?.id,
    );
    expect(h.prompt()?.getAttribute('aria-modal')).toBeNull();
  });

  it('the opening beat also goes to the chat log; the later beats do not', () => {
    const h = mount();
    h.controller.apply({ type: 'logout', phase: 'started', seconds: 10 });
    h.controller.apply({ type: 'logout', phase: 'countdown', seconds: 9 });
    h.controller.apply({ type: 'logout', phase: 'countdown', seconds: 8 });
    expect(h.log.mock.calls).toEqual([['Logging out in 10 seconds']]);
  });

  it('follows the server beats in place, down to a correctly singular last second', () => {
    const h = mount();
    h.controller.apply({ type: 'logout', phase: 'started', seconds: 10 });
    const first = h.prompt();
    h.controller.apply({ type: 'logout', phase: 'countdown', seconds: 2 });
    expect(h.text()).toBe('Logging out in 2 seconds');
    h.controller.apply({ type: 'logout', phase: 'countdown', seconds: 1 });
    expect(h.text()).toBe('Logging out in 1 second');
    // The same prompt throughout: one node, never a stack of them.
    expect(h.prompt()).toBe(first);
    expect(document.querySelectorAll('#prompt-stack .prompt')).toHaveLength(1);
  });

  it('a longer wait announced mid countdown updates the same prompt and is announced', () => {
    const h = mount();
    h.controller.apply({ type: 'logout', phase: 'started', seconds: 15 });
    h.controller.apply({ type: 'logout', phase: 'started', seconds: 25 });
    expect(document.querySelectorAll('#prompt-stack .prompt')).toHaveLength(1);
    expect(h.text()).toBe('Logging out in 25 seconds');
    expect(h.log).toHaveBeenCalledTimes(2);
  });

  it('the Cancel button asks the server; the prompt stays until the server confirms', () => {
    const h = mount();
    h.controller.apply({ type: 'logout', phase: 'started', seconds: 15 });
    h.prompt()?.querySelector('button')?.click();
    expect(h.cancel).toHaveBeenCalledOnce();
    expect(h.prompt()).not.toBeNull();
    h.controller.apply({ type: 'logout', phase: 'cancelled', reason: 'cancelled' });
    expect(h.prompt()).toBeNull();
    expect(h.showError).not.toHaveBeenCalled();
  });

  it('an interruption by damage takes it down and tells the player why', () => {
    const h = mount();
    h.controller.apply({ type: 'logout', phase: 'started', seconds: 15 });
    h.controller.apply({ type: 'logout', phase: 'cancelled', reason: 'damaged' });
    expect(h.prompt()).toBeNull();
    expect(h.showError).toHaveBeenCalledWith(t('hudChrome.logout.interrupted'));
  });

  it('completed takes it down, and a later countdown starts a fresh prompt', () => {
    const h = mount();
    h.controller.apply({ type: 'logout', phase: 'started', seconds: 15 });
    h.controller.apply({ type: 'logout', phase: 'completed' });
    expect(h.prompt()).toBeNull();
    h.controller.apply({ type: 'logout', phase: 'started', seconds: 10 });
    expect(h.text()).toBe('Logging out in 10 seconds');
  });

  it('a cancelled event with no prompt up is harmless', () => {
    const h = mount();
    h.controller.apply({ type: 'logout', phase: 'cancelled', reason: 'disconnected' });
    expect(h.prompt()).toBeNull();
    expect(h.showError).not.toHaveBeenCalled();
  });
});
