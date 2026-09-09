// @vitest-environment happy-dom
// The keyboard overview painter (src/ui/keyboard_map.ts) driven over a real
// Keybinds through its injected deps: the detail line, the rebind flow from a
// bound key (arm, conflict prompt, Esc, Cancel, stale drop), the assign flow
// from an empty key (slot choice, held actions stored bare), caps that can take
// no binding, the size and layer switches with the hidden-bindings line,
// dispose() dropping an armed capture, and the QWERTY / layout legend choice
// once the browser reports a non-QWERTY layout.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/game/audio', () => ({ audio: { click: () => {} } }));

import { Keybinds } from '../src/game/keybinds';
import { t } from '../src/ui/i18n';
import type { KeyboardMapPaintDeps } from '../src/ui/keyboard_map';
import type { KeyboardLayer } from '../src/ui/keyboard_map_core';

type Capture = (code: string | null) => void;

async function rig(opts: { layer?: KeyboardLayer; rebind?: boolean; popOut?: boolean } = {}) {
  const { paintKeyboardMap } = await import('../src/ui/keyboard_map');
  document.body.replaceChildren();
  const keybinds = new Keybinds();
  const root = document.createElement('div');
  document.body.appendChild(root);
  const armed: (Capture | null)[] = [];
  const dialogs: { body: string; onOk: () => void }[] = [];
  const changed: string[] = [];
  const layers: KeyboardLayer[] = [];
  const dropdown: {
    options: { value: string; label: string }[];
    onChange?: (v: string) => void;
    placeholder?: string;
  } = { options: [] };
  let popOuts = 0;
  const deps: KeyboardMapPaintDeps = {
    bindings: () => keybinds.snapshot(),
    actionName: (id) => `name:${id}`,
    actionCategory: () => 'Movement',
    categories: () => [{ id: 'Movement', label: 'Movement' }],
    layer: opts.layer ?? '',
    onLayerChange: (layer) => {
      layers.push(layer);
    },
    rebind:
      opts.rebind === false
        ? undefined
        : {
            keybinds: () => keybinds,
            captureKey: (cb) => {
              armed.push(cb);
            },
            confirmDialog: (_title, body, _ok, _cancel, onOk) => {
              dialogs.push({ body, onOk });
            },
            onChanged: (status) => {
              changed.push(status);
            },
            assignable: () => [
              { id: 'interact', label: 'Interact' },
              { id: 'jump', label: 'Jump' },
              { id: 'strafeLeft', label: 'Strafe Left' },
            ],
            buildDropdown: (options, _current, onChange, placeholder) => {
              dropdown.options = options;
              dropdown.onChange = onChange;
              dropdown.placeholder = placeholder;
              const el = document.createElement('div');
              el.className = 'ui-dd';
              return el;
            },
          },
    onPopOut: opts.popOut
      ? () => {
          popOuts++;
        }
      : undefined,
  };
  const handle = paintKeyboardMap(root, deps);
  const cap = (code: string) => {
    const el = root.querySelector<HTMLButtonElement>(`[data-code="${code}"]`);
    if (!el) throw new Error(`no cap ${code}`);
    return el;
  };
  const detail = () => root.querySelector('.kbm-detail')?.textContent ?? '';
  const actionButtons = () =>
    [...root.querySelectorAll<HTMLButtonElement>('.kbm-actions button')].map((b) => b.textContent);
  const optionRow = (label: string) =>
    [...root.querySelectorAll('.kbm-opt-row')].find(
      (r) => r.querySelector('.kbm-opt-label')?.textContent === label,
    );
  const pressOption = (label: string, text: string) => {
    const b = [...(optionRow(label)?.querySelectorAll('button') ?? [])].find(
      (x) => x.textContent === text,
    );
    if (!b) throw new Error(`no option ${label} / ${text}`);
    b.click();
  };
  const latest = (): Capture => {
    const cb = armed.at(-1);
    if (!cb) throw new Error('no capture armed');
    return cb;
  };
  return {
    keybinds,
    root,
    handle,
    cap,
    detail,
    actionButtons,
    optionRow,
    pressOption,
    latest,
    armed,
    dialogs,
    changed,
    layers,
    dropdown,
    popOuts: () => popOuts,
  };
}

describe('keyboard overview painter', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it('draws the header with the title and (only when offered) a Pop Out button, options under the board', async () => {
    const r = await rig({ popOut: true });
    const head = r.root.querySelector('.kbm-head');
    expect([...(head?.children ?? [])].map((c) => c.className)).toEqual([
      'kbm-title',
      'btn kbm-popout',
    ]);
    r.root.querySelector<HTMLButtonElement>('.kbm-popout')?.click();
    expect(r.popOuts()).toBe(1);
    // Options rows follow the board and the legend; no layout map means no
    // legend-source row.
    const order = [...(r.root.querySelector('.kbm')?.children ?? [])].map((c) => c.className);
    expect(order.indexOf('kbm-board')).toBeLessThan(order.indexOf('kbm-opts'));
    expect(order.indexOf('kbm-legend-row')).toBeLessThan(order.indexOf('kbm-opts'));
    expect([...r.root.querySelectorAll('.kbm-opt-label')].map((l) => l.textContent)).toEqual([
      t('hudChrome.keyboardMap.layerGroup'),
      t('hudChrome.keyboardMap.formGroup'),
    ]);
    const plain = await rig();
    expect(plain.root.querySelector('.kbm-popout')).toBeNull();
    expect(plain.detail()).toBe(t('hudChrome.keyboardMap.hintInteractive'));
  });

  it('describes a key once for a bare binding and per combo for modified ones', async () => {
    const r = await rig();
    // W: Move Forward (bare). 3: slot2 bare plus Ctrl+3 for the pet taunt.
    const w = r.cap('KeyW');
    expect(w.getAttribute('aria-label')).toBe('W: name:forward');
    w.dispatchEvent(new Event('mouseenter'));
    expect(r.detail()).toBe('W: name:forward');
    expect(r.keybinds.codeAt('petTaunt', 0)).toBe('Ctrl+Digit3');
    expect(r.cap('Digit3').title).toBe('3: name:slot2, Ctrl+3: name:petTaunt');
    expect(r.cap('F11').title).toBe(`F11: ${t('hud.options.unbound')}`);
    expect(r.cap('KeyW').classList.contains('in-use')).toBe(true);
    expect(r.cap('Digit3').querySelector('.kbm-dot')).not.toBeNull();
  });

  it('a bound key arms capture; a free key rebinds silently and reports the outcome', async () => {
    const r = await rig();
    r.cap('KeyW').click();
    expect(r.armed.at(-1)).not.toBeNull();
    expect(r.cap('KeyW').classList.contains('capturing')).toBe(true);
    expect(r.actionButtons()).toEqual([t('hudChrome.actionBar.cancel')]);
    expect(r.detail()).toBe(t('hudChrome.keyboardMap.pressKey', { action: 'name:forward' }));
    r.latest()('F9');
    expect(r.dialogs).toHaveLength(0);
    expect(r.keybinds.codeAt('forward', 0)).toBe('F9');
    const status = t('hudChrome.keyboardMap.boundTo', { action: 'name:forward', key: 'F9' });
    expect(r.changed).toEqual([status]);
    expect(r.detail()).toBe(status);
    expect(r.cap('F9').classList.contains('in-use')).toBe(true);
    expect(r.root.querySelector('.kbm-key.capturing')).toBeNull();
  });

  it('a key another action holds asks first through the shared prompt; cancel keeps everything', async () => {
    const r = await rig();
    const back = r.keybinds.codeAt('back', 0) ?? '';
    r.cap(back).click();
    r.latest()('KeyW');
    expect(r.dialogs).toHaveLength(1);
    expect(r.dialogs[0].body).toContain('W');
    expect(r.dialogs[0].body).toContain('name:forward');
    expect(r.dialogs[0].body).toContain('name:back');
    expect(r.keybinds.codeAt('back', 0)).toBe(back);
    expect(r.changed).toEqual([]);
    // The board is idle under the prompt: no ring, no Cancel, the prompt's
    // title as the status, nothing armed (cancelling the prompt leaves it so).
    expect(r.root.querySelector('.kbm-key.capturing')).toBeNull();
    expect(r.actionButtons()).toEqual([]);
    expect(r.detail()).toBe(t('hudChrome.actionBar.conflictTitle'));
    r.dialogs[0].onOk();
    expect(r.keybinds.actionForCode('KeyW')).toBe('back');
    expect(r.changed).toHaveLength(1);
  });

  it('Esc (a null capture) and the Cancel button both leave the binding alone', async () => {
    const r = await rig();
    r.cap('KeyW').click();
    r.latest()(null);
    expect(r.detail()).toBe(t('hud.options.keybindCancelled'));
    expect(r.keybinds.codeAt('forward', 0)).toBe('KeyW');
    r.cap('KeyW').click();
    const before = r.armed.length;
    [...r.root.querySelectorAll<HTMLButtonElement>('.kbm-actions button')]
      .find((b) => b.textContent === t('hudChrome.actionBar.cancel'))
      ?.click();
    expect(r.armed.length).toBe(before + 1);
    expect(r.armed.at(-1)).toBeNull(); // the capture was disarmed, not left dangling
    expect(r.detail()).toBe(t('hudChrome.keyboardMap.hintInteractive'));
  });

  it('a capture armed for an earlier key is dropped once another key is clicked', async () => {
    const r = await rig();
    r.cap('KeyW').click();
    const first = r.latest();
    r.cap('KeyS').click();
    first('F10');
    expect(r.keybinds.codeAt('forward', 0)).toBe('KeyW');
    expect(r.keybinds.actionForCode('F10')).toBeNull();
  });

  it('an empty key opens the picker; the action lands on its free primary, else its alternate', async () => {
    const r = await rig();
    r.keybinds.clear('interact', 0);
    r.cap('F11').click();
    expect(r.dropdown.options.map((o) => o.value)).toEqual(['interact', 'jump', 'strafeLeft']);
    expect(r.dropdown.placeholder).toContain('F11');
    expect(r.detail()).toBe(t('hudChrome.keyboardMap.assignHint', { key: 'F11' }));
    r.dropdown.onChange?.('interact');
    expect(r.keybinds.codeAt('interact', 0)).toBe('F11');
    r.cap('F12').click();
    r.dropdown.onChange?.('jump'); // Space stays primary, F12 becomes the alternate
    expect(r.keybinds.codeAt('jump', 0)).toBe('Space');
    expect(r.keybinds.codeAt('jump', 1)).toBe('F12');
    expect(r.changed.at(-1)).toBe(
      t('hudChrome.keyboardMap.boundTo', { action: 'name:jump', key: 'F12' }),
    );
  });

  it('assigning a held action in a modifier layer stores and reports the bare key', async () => {
    const r = await rig({ layer: 'Shift+' });
    r.cap('F11').click();
    expect(r.dropdown.placeholder).toContain('Shift+F11');
    r.dropdown.onChange?.('strafeLeft');
    // Q stays its primary; the alternate takes the bare key.
    expect(r.keybinds.codeAt('strafeLeft', 1)).toBe('F11');
    expect(r.changed.at(-1)).toBe(
      t('hudChrome.keyboardMap.boundTo', { action: 'name:strafeLeft', key: 'F11' }),
    );
  });

  it('Escape and the modifier caps take no binding and are not controls', async () => {
    const r = await rig();
    // (Left Ctrl is Swim Down by default, so it is a bound cap, not a fixed one.)
    for (const code of ['Escape', 'ShiftLeft', 'AltRight', 'MetaLeft']) {
      expect(r.cap(code).classList.contains('kbm-fixed'), code).toBe(true);
      expect(r.cap(code).disabled, code).toBe(true);
      r.cap(code).click();
    }
    expect(r.armed).toEqual([]);
    expect(r.dropdown.onChange).toBeUndefined();
  });

  it('keeps focus on the rebound cap across the rebuild, and one Tab stop per block with arrows inside', async () => {
    const r = await rig();
    const w = r.cap('KeyW');
    w.focus();
    expect(document.activeElement).toBe(w);
    w.click();
    r.latest()('F9');
    // The board was rebuilt; focus stayed on the W cap rather than dropping to body.
    expect(document.activeElement).toBe(r.cap('KeyW'));
    // Roving tabindex: the focused cap is the block's stop, the rest are -1.
    const main = r.cap('KeyW').closest('.kbm-block');
    const stops = [...(main?.querySelectorAll('button.kbm-key:not(:disabled)') ?? [])].filter(
      (b) => (b as HTMLButtonElement).tabIndex === 0,
    );
    expect(stops).toEqual([r.cap('KeyW')]);
    r.cap('KeyW').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(document.activeElement).toBe(r.cap('KeyE'));
    r.cap('KeyE').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect((document.activeElement as HTMLElement).dataset.code).toBe('KeyD');
    // The numpad is its own block with its own single stop.
    const numpad = r.cap('Numpad7').closest('.kbm-block');
    expect(
      [...(numpad?.querySelectorAll('button.kbm-key') ?? [])].filter(
        (b) => (b as HTMLButtonElement).tabIndex === 0,
      ),
    ).toHaveLength(1);
  });

  it('dispose() and an outside repaint disarm a capture in progress', async () => {
    const r = await rig();
    r.cap('KeyW').click();
    r.handle.repaint();
    expect(r.armed.at(-1)).toBeNull();
    expect(r.root.querySelector<HTMLElement>('.kbm-actions')?.hidden).toBe(true);
    r.cap('KeyW').click();
    r.handle.dispose();
    expect(r.armed.at(-1)).toBeNull();
    // A quiet repaint keeps the last status line.
    const q = await rig();
    q.cap('KeyW').click();
    q.latest()('F9');
    const status = q.detail();
    q.handle.repaint();
    expect(q.detail()).toBe(status);
  });

  it('the size switch persists, drops the blocks that board lacks, and lists the hidden bindings', async () => {
    const r = await rig();
    expect(r.root.querySelectorAll('.kbm-block')).toHaveLength(4);
    r.pressOption(t('hudChrome.keyboardMap.formGroup'), t('hudChrome.keyboardMap.formTkl'));
    expect(localStorage.getItem('woc_keyboard_layout')).toBe('tkl');
    expect(r.root.querySelectorAll('.kbm-block')).toHaveLength(3);
    const hidden = r.root.querySelector<HTMLElement>('.kbm-hidden');
    expect(hidden?.hidden).toBe(false);
    expect(hidden?.textContent).toContain('name:slot12'); // Numpad1 by default
    r.pressOption(t('hudChrome.keyboardMap.formGroup'), t('hudChrome.keyboardMap.form60'));
    expect(r.root.querySelector('[data-code="F1"]')).toBeNull();
    expect(hidden?.textContent).toContain('name:forward'); // the arrow alternate
  });

  it('the layer switch repaints the caps for that layer and reports the change', async () => {
    const r = await rig();
    expect(r.keybinds.codeAt('deeds', 0)).toBe('Shift+KeyZ');
    expect(r.cap('KeyZ').querySelector('.kbm-action')?.textContent).toBe('name:sheathe');
    r.pressOption(t('hudChrome.keyboardMap.layerGroup'), t('hudChrome.keyboardMap.layerShift'));
    expect(r.layers).toEqual(['Shift+']);
    expect(r.cap('KeyZ').querySelector('.kbm-action')?.textContent).toBe('name:deeds');
    const pressed = [...r.root.querySelectorAll('.kbm-opt-row button[aria-pressed="true"]')].map(
      (b) => b.textContent,
    );
    expect(pressed).toContain(t('hudChrome.keyboardMap.layerShift'));
  });

  it('offers the legend choice only for a non-QWERTY layout map, and both labellings name one key', async () => {
    // A US layout map: no Key labels row.
    vi.stubGlobal('navigator', {
      keyboard: {
        getLayoutMap: () =>
          Promise.resolve(
            new Map([
              ['KeyE', 'e'],
              ['Digit1', '1'],
            ]),
          ),
      },
    });
    const us = await rig();
    await Promise.resolve();
    await Promise.resolve();
    expect(us.optionRow(t('hudChrome.keyboardMap.legendGroup'))).toBeUndefined();
    expect(us.cap('KeyE').querySelector('.kbm-legend')?.textContent).toBe('E');

    // Colemak: the key QWERTY calls E prints F.
    vi.resetModules();
    vi.stubGlobal('navigator', {
      keyboard: {
        getLayoutMap: () =>
          Promise.resolve(
            new Map([
              ['KeyE', 'f'],
              ['KeyS', 'r'],
            ]),
          ),
      },
    });
    const colemak = await rig();
    await Promise.resolve();
    await Promise.resolve();
    expect(colemak.optionRow(t('hudChrome.keyboardMap.legendGroup'))).toBeDefined();
    expect(colemak.cap('KeyE').querySelector('.kbm-legend')?.textContent).toBe('F');
    expect(colemak.cap('KeyE').title).toBe('F: name:strafeRight');
    colemak.pressOption(
      t('hudChrome.keyboardMap.legendGroup'),
      t('hudChrome.keyboardMap.legendQwerty'),
    );
    expect(localStorage.getItem('woc_keyboard_legends')).toBe('qwerty');
    expect(colemak.cap('KeyE').querySelector('.kbm-legend')?.textContent).toBe('E');
    expect(colemak.cap('KeyE').title).toBe('E: name:strafeRight');
  });
});
