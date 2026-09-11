// @vitest-environment happy-dom
// The Interface panel's bespoke rows, driven straight through their seams: they
// are actions, not GameSettings keys, so nothing else pins that a press reaches
// the seam and that the row repaints from the seam's answer.

import { beforeEach, describe, expect, it } from 'vitest';
import {
  buildChatTimestampRows,
  buildChatWindowResetRow,
  buildInterfaceUnlockRow,
} from '../src/ui/options_interface_rows';

function body(): HTMLElement {
  document.body.innerHTML = '<div id="body"></div>';
  return document.getElementById('body') as HTMLElement;
}

function chatSeam() {
  const state = { timestamps: true, clock: '12h' as '12h' | '24h', resets: 0 };
  return {
    state,
    deps: {
      getChatTimestamps: () => state.timestamps,
      setChatTimestamps: (on: boolean) => {
        state.timestamps = on;
      },
      getChatClock: () => state.clock,
      setChatClock: (clock: '12h' | '24h') => {
        state.clock = clock;
      },
      resetChatWindow: () => {
        state.resets += 1;
      },
    },
  };
}

describe('buildChatTimestampRows', () => {
  let host: HTMLElement;
  beforeEach(() => {
    host = body();
  });

  it('toggles the seam and disables the clock pair while timestamps are off', () => {
    const { state, deps } = chatSeam();
    buildChatTimestampRows(host, deps);
    const toggle = host.querySelector<HTMLButtonElement>('.set-toggle');
    const [btn12, btn24] = [...host.querySelectorAll<HTMLButtonElement>('.set-seg-btn')];
    expect(toggle?.getAttribute('aria-pressed')).toBe('true');
    expect(btn12?.classList.contains('is-on')).toBe(true);
    expect(btn12?.disabled).toBe(false);

    toggle?.click();
    expect(state.timestamps, 'the press reached the seam').toBe(false);
    expect(toggle?.getAttribute('aria-pressed'), 'and the row repainted').toBe('false');
    expect(btn12?.disabled && btn24?.disabled, 'the clock pair goes inert').toBe(true);

    btn24?.click();
    expect(state.clock, 'a disabled clock press changes nothing').toBe('12h');
    toggle?.click();
    btn24?.click();
    expect(state.clock).toBe('24h');
    expect(btn24?.classList.contains('is-on')).toBe(true);
    expect(btn12?.classList.contains('is-on')).toBe(false);
  });
});

describe('buildChatWindowResetRow', () => {
  it('sends exactly one reset per press', () => {
    const host = body();
    const { state, deps } = chatSeam();
    buildChatWindowResetRow(host, deps);
    const btn = host.querySelector<HTMLButtonElement>('.set-toggle');
    btn?.click();
    btn?.click();
    expect(state.resets).toBe(2);
  });
});

describe('buildInterfaceUnlockRow', () => {
  it('relabels itself from the seam answer, never from an assumed flip', () => {
    const host = body();
    let unlocked = false;
    // A refusing seam (the mobile backstop) answers false: the row must follow
    // the answer, so it never claims the interface is loose when it is not.
    const refusing = {
      isInterfaceUnlocked: () => unlocked,
      toggleInterfaceUnlock: () => unlocked,
    };
    buildInterfaceUnlockRow(host, refusing);
    const btn = host.querySelector<HTMLButtonElement>('.set-toggle');
    const locked = btn?.textContent ?? '';
    btn?.click();
    expect(btn?.getAttribute('aria-pressed')).toBe('false');
    expect(btn?.textContent).toBe(locked);

    unlocked = true;
    btn?.click();
    expect(btn?.getAttribute('aria-pressed')).toBe('true');
    expect(btn?.classList.contains('is-on')).toBe(true);
    expect(btn?.textContent).not.toBe(locked);
    expect(host.querySelector('.set-note')?.textContent ?? '').not.toBe('');
  });
});
