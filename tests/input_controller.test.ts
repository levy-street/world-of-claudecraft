// @vitest-environment happy-dom
//
// The extracted input modal (src/ui/input_controller.ts, the Masterwrought
// phase 14 hud.ts ratchet payback; renamed from input_dialog.ts at the Phase
// 18 sweep so the painter gate's *_controller filename sweep covers it). The
// move kept Hud.inputDialog's behavior: the shared #confirm-dialog slot,
// trap lifecycle through the deps bag, Enter submission and copy affordance.
// The extracted field is now named by the visible dialog title. The Hud-side
// delegator behavior (the pending no-choice cancel
// firing when the input modal takes the slot) stays pinned in
// tests/hud_confirm_gates.test.ts, which now exercises the delegator.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/game/audio', () => ({
  audio: { click: vi.fn() },
}));

import { audio } from '../src/game/audio';
import { type InputDialogDeps, showInputDialog } from '../src/ui/input_controller';

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

describe('the accessible field name', () => {
  it('uses the dialog title so the field is never anonymous', () => {
    showInputDialog(makeDeps(), { title: 'Name it' });
    const input = el().querySelector('.cd-input') as HTMLInputElement;
    expect(input.getAttribute('aria-labelledby')).toBe('confirm-dialog-title');
  });
});

describe('the previously unpinned arms (the phase 14 QA)', () => {
  it('the copy affordance selects the value and confirms through showError', () => {
    const deps = makeDeps();
    const select = vi.spyOn(HTMLInputElement.prototype, 'select');
    showInputDialog(deps, { title: 'Export', value: 'BUILD:abc', copy: true });
    const copy = el().querySelector('[data-copy]') as HTMLButtonElement;
    expect(copy).not.toBeNull();
    copy.click();
    // The manual-select fallback runs whether or not a clipboard exists
    // (happy-dom has none; the `?.` guard is the contract), and the player
    // hears the confirmation either way.
    expect(select).toHaveBeenCalled();
    expect(deps.calls.some((entry) => entry.startsWith('error:'))).toBe(true);
    // No copy option: no button.
    showInputDialog(makeDeps(), { title: 'T' });
    expect(el().querySelector('[data-copy]')).toBeNull();
  });

  it('readOnly and selectText both pre-select the field for the take-this-value flow', () => {
    const select = vi.spyOn(HTMLInputElement.prototype, 'select');
    showInputDialog(makeDeps(), { title: 'T', value: 'v', readOnly: true });
    expect((el().querySelector('.cd-input') as HTMLInputElement).readOnly).toBe(true);
    expect(select).toHaveBeenCalledTimes(1);
    showInputDialog(makeDeps(), { title: 'T', value: 'v', selectText: true });
    expect(select).toHaveBeenCalledTimes(2);
    // Neither flag: focused but not selected.
    showInputDialog(makeDeps(), { title: 'T', value: 'v' });
    expect(select).toHaveBeenCalledTimes(2);
  });

  it('every interpolated string passes esc: a hostile value cannot break out of the markup', () => {
    // The export/import callers round-trip PASTED build strings through the
    // value field, so this arm carries real weight (the repo invariant:
    // every interpolation through esc()).
    // The placeholder and value sit inside QUOTED attributes, so their
    // payloads break the quote first; the title and label are element
    // content, so bare tags suffice. Each arm reds when its esc() is dropped.
    showInputDialog(makeDeps(), {
      title: '<i>T</i>',
      label: '<u>L</u>',
      placeholder: '"><b>P</b>',
      value: '"><img src=x>',
    });
    expect(el().querySelector('img')).toBeNull();
    expect(el().querySelector('i')).toBeNull();
    expect(el().querySelector('u')).toBeNull();
    expect(el().querySelector('b')).toBeNull();
    expect(document.getElementById('confirm-dialog-title')?.textContent).toBe('<i>T</i>');
    const input = el().querySelector('.cd-input') as HTMLInputElement;
    expect(input.value).toBe('"><img src=x>');
    expect(input.placeholder).toBe('"><b>P</b>');
  });
});

describe('the visible field label association', () => {
  it('associates the visible label with both single-line and multiline fields', () => {
    for (const multiline of [false, true]) {
      showInputDialog(makeDeps(), { title: 'Import', label: 'Build code', multiline });
      const field = el().querySelector('.cd-input') as HTMLInputElement | HTMLTextAreaElement;
      const label = el().querySelector('label.cd-body') as HTMLLabelElement;
      expect(field.id).toBe('confirm-dialog-input');
      expect(label.htmlFor).toBe(field.id);
      expect(label.id).toBe('confirm-dialog-field-label');
      expect(label.textContent).toBe('Build code');
      expect(field.getAttribute('aria-labelledby')?.split(/\s+/)).toEqual([
        'confirm-dialog-title',
        label.id,
      ]);
    }
  });
});
