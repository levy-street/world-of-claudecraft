import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CameraModePrompt, cameraModePromptSeen } from '../src/ui/camera_mode_prompt';
import {
  CAMERA_MODE_OPTIONS,
  cameraModeById,
  DEFAULT_CAMERA_MODE,
  nextCameraModeForKey,
  shouldShowCameraModePrompt,
} from '../src/ui/camera_mode_prompt_view';
import { FocusManager } from '../src/ui/focus_manager';

// The first-run camera-mode prompt. The pure decision core is unit-tested directly.
// The thin painter's persist/apply wiring is driven with a minimal window/document
// stub (the repo runs the default Node env, not jsdom); the modal a11y contract that
// needs real innerHTML parsing is pinned by source guards, the bank_window.ts pattern.

describe('camera_mode_prompt_view (pure core)', () => {
  it('preselects and recommends Mouse Camera (the mouseCamera=true option)', () => {
    expect(DEFAULT_CAMERA_MODE).toBe('mouse');
    const mouse = cameraModeById('mouse');
    expect(mouse.recommended).toBe(true);
    expect(mouse.mouseCamera).toBe(true);
  });

  it('offers Classic as the non-recommended mouseCamera=false option', () => {
    const classic = cameraModeById('classic');
    expect(classic.recommended).toBe(false);
    expect(classic.mouseCamera).toBe(false);
    // Exactly one recommended option, and it is the preselected default.
    const recommended = CAMERA_MODE_OPTIONS.filter((o) => o.recommended);
    expect(recommended.map((o) => o.id)).toEqual([DEFAULT_CAMERA_MODE]);
  });

  it('shows only on a fresh, non-phone browser (skips when seen or on a phone)', () => {
    expect(shouldShowCameraModePrompt({ seen: false, isPhone: false })).toBe(true);
    expect(shouldShowCameraModePrompt({ seen: true, isPhone: false })).toBe(false);
    expect(shouldShowCameraModePrompt({ seen: false, isPhone: true })).toBe(false);
    expect(shouldShowCameraModePrompt({ seen: true, isPhone: true })).toBe(false);
  });

  it('moves the radiogroup selection with the arrow-key model (wrap + Home/End)', () => {
    // Two options in display order: classic (0), mouse (1).
    expect(nextCameraModeForKey('classic', 'ArrowDown')).toBe('mouse');
    expect(nextCameraModeForKey('classic', 'ArrowRight')).toBe('mouse');
    // Wrap forward off the end and backward off the start.
    expect(nextCameraModeForKey('mouse', 'ArrowDown')).toBe('classic');
    expect(nextCameraModeForKey('classic', 'ArrowUp')).toBe('mouse');
    expect(nextCameraModeForKey('mouse', 'ArrowLeft')).toBe('classic');
    // Home/End jump to the ends regardless of current.
    expect(nextCameraModeForKey('mouse', 'Home')).toBe('classic');
    expect(nextCameraModeForKey('classic', 'End')).toBe('mouse');
    // Keys that do not navigate return null (the handler leaves the event alone).
    for (const key of ['Enter', ' ', 'Tab', 'Escape', 'a']) {
      expect(nextCameraModeForKey('mouse', key)).toBeNull();
    }
  });
});

describe('CameraModePrompt (persist + apply wiring)', () => {
  let store: Map<string, string>;
  let applyMouseCamera: ReturnType<typeof vi.fn<(enabled: boolean) => void>>;
  let prompt: CameraModePrompt;
  const originalWindow = (globalThis as { window?: unknown }).window;
  const originalDocument = (globalThis as { document?: unknown }).document;

  beforeEach(() => {
    store = new Map();
    (globalThis as { window?: unknown }).window = {
      localStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
      },
    };
    // confirm()/dismiss() route through close(), which only reads getElementById.
    (globalThis as { document?: unknown }).document = { getElementById: () => null };
    applyMouseCamera = vi.fn<(enabled: boolean) => void>();
    prompt = new CameraModePrompt({ focusManager: new FocusManager(), applyMouseCamera });
  });

  afterEach(() => {
    (globalThis as { window?: unknown }).window = originalWindow;
    (globalThis as { document?: unknown }).document = originalDocument;
  });

  it('starts unseen, then confirm applies the preselected Mouse Camera (true) and sets the flag', () => {
    expect(cameraModePromptSeen()).toBe(false);
    prompt.confirm();
    expect(applyMouseCamera).toHaveBeenCalledTimes(1);
    expect(applyMouseCamera).toHaveBeenCalledWith(true);
    expect(cameraModePromptSeen()).toBe(true);
    expect(store.get('woc.cameraModePrompt.seen')).toBe('1');
  });

  it('dismiss sets the seen flag without applying any change', () => {
    prompt.dismiss();
    expect(applyMouseCamera).not.toHaveBeenCalled();
    expect(cameraModePromptSeen()).toBe(true);
    expect(store.get('woc.cameraModePrompt.seen')).toBe('1');
  });
});

describe('CameraModePrompt (modal a11y + wiring source guards)', () => {
  const painter = readFileSync(new URL('../src/ui/camera_mode_prompt.ts', import.meta.url), 'utf8');
  const hud = readFileSync(new URL('../src/ui/hud.ts', import.meta.url), 'utf8');
  const mainSrc = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');

  it('builds a labelled, modal role=dialog via markDialogRoot', () => {
    expect(painter).toContain("markDialogRoot(el, { labelledBy: 'cmp-title', modal: true })");
  });

  it('renders the options as an aria radiogroup with a checked state and roving tabindex', () => {
    expect(painter).toContain('role="radiogroup"');
    expect(painter).toContain('aria-checked=');
    // Roving tabindex + arrow-key handler make it a proper single-tab-stop radiogroup.
    expect(painter).toContain('tabindex=');
    expect(painter).toContain("addEventListener('keydown'");
    expect(painter).toContain('nextCameraModeForKey(this.selected');
  });

  it('is registered as an active modal and dismissed on the unified Escape path', () => {
    // isModalOpen() gates gameplay keybinds behind the prompt; closeAll() (the one
    // Escape path) dismisses it instead of falling through to the options menu.
    expect(hud).toContain('this.cameraModePrompt?.isOpen() ?? false');
    expect(hud).toContain('this.cameraModePrompt.dismiss()');
  });

  it('persists under the woc.* one-time flag key', () => {
    expect(painter).toContain("'woc.cameraModePrompt.seen'");
  });

  it('the Hud fires the prompt once via maybeShowCameraModePrompt and skips phones + repeats', () => {
    expect(hud).toContain('maybeShowCameraModePrompt()');
    expect(hud).toContain('isPhoneTouchDevice()');
    expect(hud).toContain('cameraModePromptSeen()');
    // Routed through the same effect as the Key Bindings toggle: onSettingChange
    // -> applySetting does settings.set + input.setMouseCameraEnabled (no
    // redundant set at the call site).
    expect(hud).toContain("hooks.onSettingChange('mouseCamera', enabled)");
  });

  it('defers the prompt past the spawn cinematic (gated world entry + finishIntro)', () => {
    // Two call sites, exactly one of which fires for any given entry: the world
    // entry call only opens it when no cinematic is running, and finishIntro
    // re-offers it once the intro ends (the intro captures input, so the modal
    // must not open during it). Both go through the same seen/phone-guarded method.
    const calls = mainSrc.match(/hud\.maybeShowCameraModePrompt\(\)/g) ?? [];
    expect(calls.length).toBe(2);
    expect(mainSrc).toContain('if (intro === null) hud.maybeShowCameraModePrompt()');
  });
});
