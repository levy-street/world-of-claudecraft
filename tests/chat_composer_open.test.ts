// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MOBILE_CHAT_OPEN_CLASS,
  openChatComposerWithText,
  seatComposerInMobilePanel,
} from '../src/ui/hud/chat/chat_composer_open';

// The touch Whisper row (player menu, chat name menu, Social window) only wrote the
// composer's value and focused it. On touch the composer lives inside the chat panel,
// which renders only under body.mobile-chat-open (the compact tier hides the whole
// wrap without it), so the prefill went nowhere and the HUD looked unchanged.

function mount(touch: boolean, extraBodyClass?: string) {
  document.body.innerHTML = '<div id="chatlog-wrap"><div id="chatlog-tabs"></div></div>';
  document.body.className = '';
  if (touch) document.body.classList.add('mobile-touch');
  if (extraBodyClass) document.body.classList.add(extraBodyClass);
  const input = document.createElement('textarea');
  input.id = 'chat-input';
  input.style.display = 'none';
  document.body.appendChild(input);
  const wrap = document.getElementById('chatlog-wrap') as HTMLElement;
  const applyPresentation = vi.fn();
  const inputEvents = vi.fn();
  input.addEventListener('input', inputEvents);
  const deps = { body: document.body, wrap, input, applyPresentation };
  return { input, wrap, applyPresentation, inputEvents, deps };
}

afterEach(() => {
  document.body.innerHTML = '';
  document.body.className = '';
});

describe('openChatComposerWithText', () => {
  it('on touch opens the chat panel, seats the composer in it and focuses the prefill', () => {
    const { input, wrap, applyPresentation, inputEvents, deps } = mount(true);

    openChatComposerWithText('/w Someone ', deps);

    expect(document.body.classList.contains(MOBILE_CHAT_OPEN_CLASS)).toBe(true);
    expect(wrap.firstElementChild).toBe(input);
    expect(input.value).toBe('/w Someone ');
    expect(input.style.display).toBe('block');
    expect(document.activeElement).toBe(input);
    expect(input.selectionStart).toBe(input.value.length);
    expect(applyPresentation).toHaveBeenCalledTimes(1);
    expect(inputEvents).toHaveBeenCalledTimes(1);
  });

  it('on the compact touch tier also replaces a log peek with the open panel', () => {
    const { deps } = mount(true, 'mobile-chatlog-peek');
    document.body.classList.add('hud-mobile-compact');

    openChatComposerWithText('/w Someone ', deps);

    expect(document.body.classList.contains(MOBILE_CHAT_OPEN_CLASS)).toBe(true);
    expect(document.body.classList.contains('mobile-chatlog-peek')).toBe(false);
  });

  it('on desktop only prefills and focuses the body-level bar (no touch classes, no move)', () => {
    const { input, wrap, applyPresentation, inputEvents, deps } = mount(false);

    openChatComposerWithText('/w Someone ', deps);

    expect(document.body.classList.contains(MOBILE_CHAT_OPEN_CLASS)).toBe(false);
    expect(input.parentElement).toBe(document.body);
    expect(wrap.contains(input)).toBe(false);
    expect(input.value).toBe('/w Someone ');
    expect(input.style.display).toBe('block');
    expect(document.activeElement).toBe(input);
    expect(applyPresentation).not.toHaveBeenCalled();
    expect(inputEvents).toHaveBeenCalledTimes(1);
  });
});

describe('seatComposerInMobilePanel', () => {
  it('moves the composer into the panel once on touch and is idempotent', () => {
    const { input, wrap } = mount(true);
    seatComposerInMobilePanel(document.body, wrap, input);
    seatComposerInMobilePanel(document.body, wrap, input);
    expect(wrap.firstElementChild).toBe(input);
    expect(wrap.children.length).toBe(2);
  });

  it('is a no-op on desktop', () => {
    const { input, wrap } = mount(false);
    seatComposerInMobilePanel(document.body, wrap, input);
    expect(input.parentElement).toBe(document.body);
  });
});
