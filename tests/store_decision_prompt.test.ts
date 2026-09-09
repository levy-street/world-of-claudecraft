// @vitest-environment happy-dom

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearOpenStoreResult,
  STORE_RESULT_EXPIRY_MS,
  StoreDecisionPrompts,
} from '../src/ui/store_decision_prompt';

/** Construction registers with the module Escape registry, so every panel a
 *  test mints is unregistered again in afterEach (the real teardown handle,
 *  not a drain workaround): each test starts with an empty registry. */
const created: StoreDecisionPrompts[] = [];
function makePrompts(
  root: () => HTMLElement,
  timers?: ConstructorParameters<typeof StoreDecisionPrompts>[1],
): StoreDecisionPrompts {
  const prompts = new StoreDecisionPrompts(root, timers);
  created.push(prompts);
  return prompts;
}

/** Deterministic injected clock for the result-expiry contract (the
 *  StorageRungEchoTimers seam the prompts take), so no fake-timer global
 *  stubbing has to reach through happy-dom's window. */
function manualTimers() {
  let now = 0;
  let seq = 0;
  const scheduled = new Map<number, { at: number; cb: () => void }>();
  return {
    timers: {
      schedule: (cb: () => void, delayMs: number) => {
        scheduled.set(++seq, { at: now + delayMs, cb });
        return seq;
      },
      cancel: (handle: number) => {
        scheduled.delete(handle);
      },
    },
    advance(ms: number) {
      now += ms;
      for (const [handle, timer] of [...scheduled]) {
        if (timer.at <= now) {
          scheduled.delete(handle);
          timer.cb();
        }
      }
    },
    pending: () => scheduled.size,
  };
}

describe('StoreDecisionPrompts', () => {
  beforeEach(() => {
    document.body.innerHTML =
      '<div id="prompt-stack"></div>' +
      '<section id="store"><button id="buy" type="button">Buy</button></section>';
  });

  afterEach(() => {
    for (const prompts of created.splice(0)) prompts.unregister();
  });

  it('owns an accessible modal in the prompt stack and restores the exact opener on Escape', () => {
    const root = document.getElementById('store') as HTMLElement;
    const opener = document.getElementById('buy') as HTMLButtonElement;
    const cancelled = vi.fn();
    opener.focus();

    const prompts = makePrompts(() => root);
    prompts.open({
      title: 'Confirm purchase',
      body: 'Buy the charter?',
      confirmText: 'Purchase',
      cancelText: 'Cancel',
      closeText: 'Close',
      onConfirm: vi.fn(),
      onCancel: cancelled,
    });

    const prompt = document.querySelector('#prompt-stack #confirm-dialog') as HTMLElement;
    expect(prompt.getAttribute('role')).toBe('dialog');
    expect(prompt.getAttribute('aria-modal')).toBe('true');
    expect(prompt.getAttribute('aria-labelledby')).toBeTruthy();
    expect(prompt.getAttribute('aria-describedby')).toBeTruthy();
    expect(root.inert).toBe(true);

    prompt.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(cancelled).toHaveBeenCalledOnce();
    expect(document.getElementById('confirm-dialog')).toBeNull();
    expect(root.inert).toBe(false);
    expect(document.activeElement).toBe(opener);
  });

  it('settles a decision once even when its confirm control is activated twice', () => {
    const root = document.getElementById('store') as HTMLElement;
    const opener = document.getElementById('buy') as HTMLButtonElement;
    const confirmed = vi.fn();
    const prompts = makePrompts(() => root);
    opener.focus();
    prompts.open({
      title: 'Confirm purchase',
      body: 'Buy the charter?',
      confirmText: 'Purchase',
      cancelText: 'Cancel',
      closeText: 'Close',
      onConfirm: confirmed,
    });

    const confirm = document.querySelector<HTMLButtonElement>('[data-store-prompt-confirm]');
    expect(confirm).not.toBeNull();
    confirm?.click();
    confirm?.click();

    expect(confirmed).toHaveBeenCalledOnce();
    expect(document.getElementById('confirm-dialog')).toBeNull();
    expect(root.inert).toBe(false);
    expect(document.activeElement).toBe(opener);
  });

  it('returns focus and clears the inert background when the visible Cancel action is used', () => {
    const root = document.getElementById('store') as HTMLElement;
    const opener = document.getElementById('buy') as HTMLButtonElement;
    const cancelled = vi.fn();
    const prompts = makePrompts(() => root);
    opener.focus();
    prompts.open({
      title: 'Confirm purchase',
      body: 'Buy the charter?',
      confirmText: 'Purchase',
      cancelText: 'Cancel',
      closeText: 'Close',
      onConfirm: vi.fn(),
      onCancel: cancelled,
    });

    expect(root.inert).toBe(true);
    document.querySelector<HTMLButtonElement>('[data-store-prompt-cancel]')?.click();

    expect(cancelled).toHaveBeenCalledOnce();
    expect(document.getElementById('confirm-dialog')).toBeNull();
    expect(root.inert).toBe(false);
    expect(document.activeElement).toBe(opener);
  });

  it('restores an inspector to its pre-existing inert state', () => {
    const root = document.getElementById('store') as HTMLElement;
    const inspector = document.createElement('div');
    inspector.className = 'armory-inspect-overlay';
    inspector.inert = true;
    document.body.appendChild(inspector);
    const prompts = makePrompts(() => root);

    prompts.open({
      title: 'Confirm purchase',
      body: 'Buy the charter?',
      confirmText: 'Purchase',
      cancelText: 'Cancel',
      closeText: 'Close',
      onConfirm: vi.fn(),
    });
    prompts.dismiss(false);

    expect(inspector.inert).toBe(true);
  });

  it('cancels a replaced decision once and exposes stale async results nonmodally', async () => {
    const root = document.getElementById('store') as HTMLElement;
    const firstCancel = vi.fn();
    const prompts = makePrompts(() => root);
    const common = {
      body: 'Body',
      confirmText: 'Confirm',
      cancelText: 'Cancel',
      closeText: 'Close',
      onConfirm: vi.fn(),
    };
    prompts.open({ ...common, title: 'First', onCancel: firstCancel });
    prompts.open({ ...common, title: 'Second' });

    expect(firstCancel).toHaveBeenCalledOnce();
    expect(document.querySelector('.prompt-text')?.textContent).toBe('Second');

    prompts.dismiss(false);
    prompts.showResult({ text: 'Purchase complete', tone: 'success', closeText: 'Close' });
    const result = document.querySelector('.woc-store-global-result') as HTMLElement;
    expect(result.getAttribute('role')).toBe('status');
    expect(result.getAttribute('aria-live')).toBe('polite');
    expect(result.querySelector('[data-store-result-text]')?.textContent).toBe('');
    await Promise.resolve();
    expect(result.textContent).toContain('Purchase complete');
    expect(root.inert).toBe(false);
  });

  it('is cleared by the closeAll dispatcher rung, which reports whether it acted', () => {
    const root = document.getElementById('store') as HTMLElement;
    const prompts = makePrompts(() => root, manualTimers().timers);
    // afterEach unregistered every earlier panel, so the registry holds only
    // this one, with nothing showing yet: the rung answers false.
    expect(clearOpenStoreResult()).toBe(false);

    prompts.showResult({ text: 'Purchase complete', tone: 'success', closeText: 'Close' });
    expect(document.querySelector('.woc-store-global-result')).not.toBeNull();
    expect(clearOpenStoreResult()).toBe(true);
    expect(document.querySelector('.woc-store-global-result')).toBeNull();
    expect(document.getElementById('prompt-stack')?.classList.contains('store-result-active')).toBe(
      false,
    );
    expect(clearOpenStoreResult()).toBe(false);
  });

  it('the closeAll rung clears the MOST RECENTLY REGISTERED open result only', () => {
    const root = document.getElementById('store') as HTMLElement;
    const clock = manualTimers();
    const bottom = makePrompts(() => root, clock.timers);
    const top = makePrompts(() => root, clock.timers);
    bottom.showResult({ text: 'Bottom', tone: 'success', closeText: 'Close' });
    top.showResult({ text: 'Top', tone: 'failure', closeText: 'Close' });
    expect(document.querySelectorAll('.woc-store-global-result')).toHaveLength(2);

    // One Escape, one result: the TOP panel's went, the bottom panel's stands.
    expect(clearOpenStoreResult()).toBe(true);
    expect(document.querySelectorAll('.woc-store-global-result')).toHaveLength(1);
    expect(top.clearResult()).toBe(false);
    expect(bottom.clearResult()).toBe(true);

    // A registrant with nothing showing is walked PAST, not stopped at: with
    // only the bottom panel showing again, the rung still reaches it under the
    // empty top panel.
    bottom.showResult({ text: 'Bottom again', tone: 'success', closeText: 'Close' });
    expect(clearOpenStoreResult()).toBe(true);
    expect(clearOpenStoreResult()).toBe(false);
  });

  it('an unregistered panel is unreachable from the closeAll rung', () => {
    const root = document.getElementById('store') as HTMLElement;
    const clock = manualTimers();
    const prompts = makePrompts(() => root, clock.timers);
    prompts.showResult({ text: 'Orphan', tone: 'failure', closeText: 'Close' });
    prompts.unregister();

    // The rung no longer walks the panel (a torn-down owner stays dead to
    // Escape)...
    expect(clearOpenStoreResult()).toBe(false);
    expect(document.querySelector('.woc-store-global-result')).not.toBeNull();
    // ...while the owner's own direct handle still works.
    expect(prompts.clearResult()).toBe(true);
  });

  it('expires the unattended result at exactly the bounded lifetime, never one ms early', () => {
    const root = document.getElementById('store') as HTMLElement;
    const clock = manualTimers();
    const prompts = makePrompts(() => root, clock.timers);
    prompts.showResult({ text: 'Purchase complete', tone: 'success', closeText: 'Close' });

    clock.advance(STORE_RESULT_EXPIRY_MS - 1);
    expect(document.querySelector('.woc-store-global-result')).not.toBeNull();
    clock.advance(1);
    expect(document.querySelector('.woc-store-global-result')).toBeNull();
    expect(document.getElementById('prompt-stack')?.classList.contains('store-result-active')).toBe(
      false,
    );
    expect(clock.pending()).toBe(0);
  });

  it('manual close cancels the expiry timer instead of leaving it armed', () => {
    const root = document.getElementById('store') as HTMLElement;
    const clock = manualTimers();
    const prompts = makePrompts(() => root, clock.timers);
    prompts.showResult({ text: 'Purchase complete', tone: 'success', closeText: 'Close' });

    document.querySelector<HTMLButtonElement>('.woc-store-global-result button')?.click();
    expect(document.querySelector('.woc-store-global-result')).toBeNull();
    expect(clock.pending()).toBe(0);
    // Nothing left to fire: advancing past the deadline is a no-op.
    clock.advance(STORE_RESULT_EXPIRY_MS);
  });

  it('a result shown twice restarts the full expiry window for the replacement', () => {
    const root = document.getElementById('store') as HTMLElement;
    const clock = manualTimers();
    const prompts = makePrompts(() => root, clock.timers);
    prompts.showResult({ text: 'First', tone: 'failure', closeText: 'Close' });

    clock.advance(STORE_RESULT_EXPIRY_MS - 1);
    prompts.showResult({ text: 'Second', tone: 'success', closeText: 'Close' });
    expect(clock.pending()).toBe(1);
    // The replacement holds through the FIRST result's would-be deadline...
    clock.advance(STORE_RESULT_EXPIRY_MS - 1);
    expect(document.querySelector('.woc-store-global-result')).not.toBeNull();
    // ...and expires only at its own.
    clock.advance(1);
    expect(document.querySelector('.woc-store-global-result')).toBeNull();
  });

  it('keeps the nonmodal result dismissible through the mobile prompt-stack hit shield', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/styles/components.css'), 'utf8');
    expect(css).toMatch(
      /body\.mobile-touch #prompt-stack \.woc-store-global-result\s*\{[^}]*pointer-events:\s*auto;/s,
    );
  });
});
