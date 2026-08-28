// @vitest-environment happy-dom
//
// The extracted input modal (src/ui/input_dialog.ts, the Masterwrought
// phase 14 hud.ts ratchet payback). The move kept Hud.inputDialog's behavior
// (the shared #confirm-dialog slot, the trap lifecycle through the deps bag,
// Enter-submits, the copy affordance) and fixed three recorded gaps IN the
// new module: the field's accessible name, the maxLength cap, and the busy
// handle. The Hud-side delegator behavior (the pending no-choice cancel
// firing when the input modal takes the slot) stays pinned in
// tests/hud_confirm_gates.test.ts, which now exercises the delegator.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/game/audio', () => ({
  audio: { click: vi.fn() },
}));

import { audio } from '../src/game/audio';
import { type InputDialogDeps, showInputDialog } from '../src/ui/input_dialog';

function makeDeps(): InputDialogDeps & {
  calls: string[];
} {
  const calls: string[] = [];
  return {
    calls,
    replaceStandingDialog: () => calls.push('replace'),
    trapOpen: (el) => calls.push(`trapOpen:${el.id}`),
    trapClose: () => calls.push('trapClose'),
    bindKeys: (el) => calls.push(`bindKeys:${el.id}`),
    showError: (text) => calls.push(`error:${text}`),
  };
}

const el = (): HTMLElement => document.getElementById('confirm-dialog') as HTMLElement;

beforeEach(() => {
  document.body.innerHTML = '';
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('the move keeps the old dialog behavior', () => {
  it('mounts the #confirm-dialog chrome, traps, binds keys, and submits the value', () => {
    const deps = makeDeps();
    const onOk = vi.fn();
    showInputDialog(deps, { title: 'Rename', value: 'Old', okText: 'Save', onOk });
    expect(deps.calls).toEqual(['replace', 'trapOpen:confirm-dialog', 'bindKeys:confirm-dialog']);
    expect(el().classList.contains('window')).toBe(true);
    expect(el().getAttribute('role')).toBe('dialog');
    expect(el().getAttribute('aria-labelledby')).toBe('confirm-dialog-title');
    const input = el().querySelector('.cd-input') as HTMLInputElement;
    expect(input.value).toBe('Old');
    input.value = 'New name';
    (el().querySelector('[data-ok]') as HTMLButtonElement).click();
    expect(onOk).toHaveBeenCalledWith('New name');
    expect(deps.calls).toContain('trapClose');
    expect(document.getElementById('confirm-dialog')).toBeNull();
  });

  it('a replaced standing dialog is removed before the new one mounts', () => {
    const stale = document.createElement('div');
    stale.id = 'confirm-dialog';
    document.body.appendChild(stale);
    showInputDialog(makeDeps(), { title: 'T' });
    const dialogs = document.querySelectorAll('#confirm-dialog');
    expect(dialogs.length).toBe(1);
    expect(dialogs[0]).not.toBe(stale);
  });

  it('cancel plays the click cue and closes without firing onOk', () => {
    const deps = makeDeps();
    const onOk = vi.fn();
    showInputDialog(deps, { title: 'T', onOk });
    (el().querySelector('.cd-actions [data-cancel]') as HTMLButtonElement).click();
    expect((audio.click as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
    expect(onOk).not.toHaveBeenCalled();
    expect(document.getElementById('confirm-dialog')).toBeNull();
  });

  it('Enter submits the single-line field; a multiline field gets a textarea', () => {
    const deps = makeDeps();
    const onOk = vi.fn();
    showInputDialog(deps, { title: 'T', onOk });
    const input = el().querySelector('.cd-input') as HTMLInputElement;
    input.value = 'entered';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(onOk).toHaveBeenCalledWith('entered');
    showInputDialog(deps, { title: 'T', multiline: true, onOk });
    expect(el().querySelector('textarea.cd-input')).not.toBeNull();
  });
});

describe('the recorded gap fixes', () => {
  it('the field is never anonymous: the dialog title names it by default', () => {
    showInputDialog(makeDeps(), { title: 'Name it' });
    const input = el().querySelector('.cd-input') as HTMLInputElement;
    expect(input.getAttribute('aria-labelledby')).toBe('confirm-dialog-title');
  });

  it('an explicit inputAria wins over the title association', () => {
    showInputDialog(makeDeps(), { title: 'T', inputAria: 'Build name' });
    const input = el().querySelector('.cd-input') as HTMLInputElement;
    expect(input.getAttribute('aria-label')).toBe('Build name');
    expect(input.getAttribute('aria-labelledby')).toBeNull();
  });

  it('maxLength caps both field shapes', () => {
    showInputDialog(makeDeps(), { title: 'T', maxLength: 32 });
    expect((el().querySelector('.cd-input') as HTMLInputElement).maxLength).toBe(32);
    showInputDialog(makeDeps(), { title: 'T', maxLength: 12, multiline: true });
    expect((el().querySelector('.cd-input') as HTMLTextAreaElement).maxLength).toBe(12);
  });

  it('the busy handle holds the OK control and refuses a busy submit', () => {
    const onOk = vi.fn();
    const handle = showInputDialog(makeDeps(), { title: 'T', onOk });
    const ok = el().querySelector('[data-ok]') as HTMLButtonElement;
    handle.setBusy(true);
    expect(ok.disabled).toBe(true);
    expect(el().getAttribute('aria-busy')).toBe('true');
    // A busy submit is refused even if driven directly (Enter on the field).
    const input = el().querySelector('.cd-input') as HTMLInputElement;
    input.value = 'x';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(onOk).not.toHaveBeenCalled();
    expect(document.getElementById('confirm-dialog')).not.toBeNull();
    handle.setBusy(false);
    expect(ok.disabled).toBe(false);
    expect(el().getAttribute('aria-busy')).toBeNull();
    ok.click();
    expect(onOk).toHaveBeenCalledWith('x');
  });
});
