// @vitest-environment happy-dom

// The first-login graphics prompt (src/ui/graphics_choice_prompt.ts): it opens on a first world
// entry, persists the confirmed preset BEFORE world entry resumes, never opens again once
// answered, and Escape keeps the device default. The GPU probe and the native-shell flag are
// stubbed so the test pins the prompt wiring, not device detection.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const gfxState = vi.hoisted(() => ({
  detected: 3,
  forced: null as string | null,
  webdriver: false,
  touch: false,
}));

vi.mock('../src/render/gfx', () => ({
  forcedTierFromSearch: () => gfxState.forced,
  detectedDefaultGraphicsPreset: () => gfxState.detected,
}));
vi.mock('../src/game/mobile_controls', () => ({
  isNativeAppShell: () => false,
  isPhoneTouchDevice: () => gfxState.touch,
}));

import { Settings } from '../src/game/settings';
import { promptGraphicsChoiceOnFirstLogin } from '../src/ui/graphics_choice_prompt';

function dialog(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.graphics-prompt-dialog');
}

function radio(value: string): HTMLInputElement {
  const el = document.querySelector<HTMLInputElement>(`.graphics-prompt-radio[value="${value}"]`);
  if (!el) throw new Error(`no radio ${value}`);
  return el;
}

function confirmButton(): HTMLButtonElement {
  const el = document.querySelector<HTMLButtonElement>('.graphics-prompt-confirm');
  if (!el) throw new Error('no confirm button');
  return el;
}

// happy-dom reports navigator.webdriver true; a real first-time player's browser reports false.
Object.defineProperty(navigator, 'webdriver', {
  configurable: true,
  get: () => gfxState.webdriver,
});

beforeEach(() => {
  localStorage.clear();
  document.body.replaceChildren();
  gfxState.detected = 3;
  gfxState.forced = null;
  gfxState.webdriver = false;
  gfxState.touch = false;
});

describe('promptGraphicsChoiceOnFirstLogin', () => {
  it('opens a modal on a first entry with Auto pre-selected and the detected preset named', async () => {
    let resolved = false;
    const done = promptGraphicsChoiceOnFirstLogin().then(() => {
      resolved = true;
    });
    const root = dialog();
    expect(root?.getAttribute('role')).toBe('dialog');
    expect(root?.getAttribute('aria-modal')).toBe('true');
    expect(radio('auto').checked).toBe(true);
    expect(document.querySelectorAll('.graphics-prompt-radio')).toHaveLength(5);
    expect(root?.textContent).toContain('Detected: High.');
    // World entry is held until the player answers.
    await Promise.resolve();
    expect(resolved).toBe(false);
    confirmButton().click();
    await done;
    expect(resolved).toBe(true);
  });

  it('persists an explicit preset, pinned against detection, then removes the modal', async () => {
    const done = promptGraphicsChoiceOnFirstLogin();
    radio('1').checked = true;
    confirmButton().click();
    await done;
    const s = new Settings();
    expect(s.get('graphicsPreset')).toBe(1);
    expect(s.get('graphicsDefaultApplied')).toBe(true);
    expect(s.get('graphicsPromptAnswered')).toBe(true);
    expect(dialog()).toBeNull();
  });

  it('confirming Auto answers the prompt but leaves the device to detection', async () => {
    const done = promptGraphicsChoiceOnFirstLogin();
    confirmButton().click();
    await done;
    const s = new Settings();
    expect(s.get('graphicsPromptAnswered')).toBe(true);
    expect(s.get('graphicsDefaultApplied')).toBe(false);
  });

  it('Escape keeps the device default (Auto) and still counts as an answer', async () => {
    const done = promptGraphicsChoiceOnFirstLogin();
    radio('4').checked = true;
    dialog()?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await done;
    const s = new Settings();
    expect(s.get('graphicsPromptAnswered')).toBe(true);
    expect(s.get('graphicsDefaultApplied')).toBe(false);
    expect(dialog()).toBeNull();
  });

  it('keeps keys inside the modal from reaching the page behind it', async () => {
    const done = promptGraphicsChoiceOnFirstLogin();
    const pageKeys: string[] = [];
    const onKey = (e: KeyboardEvent) => pageKeys.push(e.key);
    document.addEventListener('keydown', onKey);
    dialog()?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    document.removeEventListener('keydown', onKey);
    expect(pageKeys).toEqual([]);
    confirmButton().click();
    await done;
  });

  it('never opens again once answered', async () => {
    new Settings().set('graphicsPromptAnswered', true);
    await promptGraphicsChoiceOnFirstLogin();
    expect(dialog()).toBeNull();
  });

  it('never opens for a returning player whose store predates the prompt', async () => {
    localStorage.setItem('woc_settings', JSON.stringify({ graphicsPreset: 2 }));
    await promptGraphicsChoiceOnFirstLogin();
    expect(dialog()).toBeNull();
  });

  it('skips when the URL forces a render tier', async () => {
    gfxState.forced = 'low';
    await promptGraphicsChoiceOnFirstLogin();
    expect(dialog()).toBeNull();
  });

  it('offers a touch device only Auto, Low, and Medium', async () => {
    gfxState.touch = true;
    const done = promptGraphicsChoiceOnFirstLogin();
    const values = [...document.querySelectorAll<HTMLInputElement>('.graphics-prompt-radio')].map(
      (r) => r.value,
    );
    expect(values).toEqual(['auto', '1', '2']);
    confirmButton().click();
    await done;
  });

  it('focuses the pre-selected Auto radio on open and names each radio by its title', async () => {
    const done = promptGraphicsChoiceOnFirstLogin();
    await new Promise((r) => setTimeout(r, 0));
    expect(document.activeElement).toBe(radio('auto'));
    const descId = radio('2').getAttribute('aria-describedby');
    expect(descId && document.getElementById(descId)?.textContent).toContain('balance');
    confirmButton().click();
    await done;
  });

  it('confirms through the form, so Enter on a selected radio submits', async () => {
    const done = promptGraphicsChoiceOnFirstLogin();
    radio('2').checked = true;
    expect(confirmButton().type).toBe('submit');
    dialog()?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await done;
    expect(new Settings().get('graphicsPreset')).toBe(2);
  });

  it('skips an automated WebDriver session (the E2E and screenshot scripts)', async () => {
    gfxState.webdriver = true;
    await promptGraphicsChoiceOnFirstLogin();
    expect(dialog()).toBeNull();
  });

  it('shares one open prompt between concurrent world-entry calls', async () => {
    const a = promptGraphicsChoiceOnFirstLogin();
    const b = promptGraphicsChoiceOnFirstLogin();
    expect(a).toBe(b);
    expect(document.querySelectorAll('.graphics-prompt-dialog')).toHaveLength(1);
    confirmButton().click();
    await Promise.all([a, b]);
  });
});
