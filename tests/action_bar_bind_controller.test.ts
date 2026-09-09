// @vitest-environment happy-dom
// The on-bar action-bar key-binding mode's controller
// (src/ui/hud/action_bar/action_bar_bind_controller.ts) driven through its
// injected deps over a real Keybinds: the conflict-only prompt (a key another
// action holds asks first; cancel changes nothing; accept steals it), a free
// key binding silently even on an occupied slot, a reserved key refused, the
// stale-capture drop, the pending-capture cancel on Done / Reset, and the wedge
// guard (Done under the prompt must not resurrect the mode).
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/game/audio', () => ({ audio: { click: () => {} } }));

import { Keybinds } from '../src/game/keybinds';
import { ActionBarBindController } from '../src/ui/hud/action_bar/action_bar_bind_controller';
import { t } from '../src/ui/i18n';

type Capture = (code: string | null) => void;

function rig() {
  localStorage.clear();
  document.body.replaceChildren();
  const keybinds = new Keybinds();
  // Every callback ever armed, in order (null entries are clears), so a test
  // can fire an EARLIER one after a later selection replaced it.
  const armed: (Capture | null)[] = [];
  const dialogs: { body: string; onOk: () => void }[] = [];
  const parent = document.createElement('div');
  document.body.appendChild(parent);
  const sync: [number | null, boolean][] = [];
  const counts = { closeOptions: 0, refreshes: 0 };
  const ctl = new ActionBarBindController({
    keybinds: () => keybinds,
    captureKey: (cb) => {
      armed.push(cb);
    },
    confirmDialog: (_title, body, _ok, _cancel, onOk) => {
      dialogs.push({ body, onOk });
    },
    refreshKeybindLabels: () => {
      counts.refreshes++;
    },
    actionName: (id) => `name:${id}`,
    closeOptions: () => {
      counts.closeOptions++;
    },
    bannerParent: () => parent,
    syncSlotClasses: (selected, active) => {
      sync.push([selected, active]);
    },
  });
  const banner = () => parent.querySelector('#actionbar-bind-banner');
  const status = () => banner()?.querySelector('.actionbar-bind-status')?.textContent ?? null;
  const latest = (): Capture => {
    const cb = armed.at(-1);
    if (!cb) throw new Error('no capture armed');
    return cb;
  };
  return { keybinds, ctl, banner, status, latest, armed, dialogs, sync, counts };
}

describe('ActionBarBindController', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('begin mounts one banner, closes the options window once, and is a no-op while active', () => {
    const r = rig();
    expect(r.ctl.active).toBe(false);
    r.ctl.begin();
    r.ctl.begin();
    expect(r.ctl.active).toBe(true);
    expect(r.banner()).not.toBeNull();
    expect(document.querySelectorAll('#actionbar-bind-banner')).toHaveLength(1);
    expect(r.counts.closeOptions).toBe(1);
    expect(r.sync.at(-1)).toEqual([null, true]);
    expect(r.status()).toBe('');
  });

  it('a key another action holds asks first; cancel changes nothing, accept steals it', () => {
    const r = rig();
    r.ctl.begin();
    r.ctl.selectSlot(3);
    expect(r.armed.at(-1)).not.toBeNull();
    expect(r.sync.at(-1)).toEqual([3, true]);
    expect(r.status()).toBe(t('hudChrome.actionBar.bannerCapturing'));
    // W is Move Forward by default.
    expect(r.keybinds.actionForCode('KeyW')).toBe('forward');
    r.latest()('KeyW');
    expect(r.dialogs).toHaveLength(1);
    expect(r.dialogs[0].body).toContain('W');
    expect(r.dialogs[0].body).toContain('name:forward');
    expect(r.dialogs[0].body).toContain('name:slot3');
    // Nothing moved yet, and the banner dropped to idle while the prompt is up.
    expect(r.keybinds.actionForCode('KeyW')).toBe('forward');
    expect(r.status()).toBe('');
    expect(r.sync.at(-1)).toEqual([null, true]);
    r.dialogs[0].onOk();
    expect(r.keybinds.actionForCode('KeyW')).toBe('slot3');
    expect(r.keybinds.codeAt('forward', 0)).toBeNull();
    expect(r.status()).toBe(t('hudChrome.actionBar.boundToKey', { key: 'W' }));
    expect(r.counts.refreshes).toBe(1);
  });

  it('a free key binds silently, even when the slot already had one', () => {
    const r = rig();
    r.ctl.begin();
    expect(r.keybinds.codeAt('slot4', 0)).not.toBeNull(); // occupied by its default
    r.ctl.selectSlot(4);
    r.latest()('F9');
    expect(r.dialogs).toHaveLength(0);
    expect(r.keybinds.codeAt('slot4', 0)).toBe('F9');
    expect(r.status()).toBe(t('hudChrome.actionBar.boundToKey', { key: 'F9' }));
  });

  it('a reserved key is refused with no prompt and no label', () => {
    const r = rig();
    r.ctl.begin();
    const before = r.keybinds.codeAt('slot5', 0);
    r.ctl.selectSlot(5);
    r.latest()('Escape');
    expect(r.dialogs).toHaveLength(0);
    expect(r.keybinds.codeAt('slot5', 0)).toBe(before);
    expect(r.status()).toBe('');
  });

  it('a capture armed for an earlier slot is dropped once another slot is selected', () => {
    const r = rig();
    r.ctl.begin();
    r.ctl.selectSlot(2);
    const first = r.latest();
    const before2 = r.keybinds.codeAt('slot2', 0);
    r.ctl.selectSlot(6);
    first('F10');
    expect(r.keybinds.codeAt('slot2', 0)).toBe(before2);
    expect(r.keybinds.codeAt('slot6', 0)).not.toBe('F10');
    r.latest()('F10');
    expect(r.keybinds.codeAt('slot6', 0)).toBe('F10');
  });

  it('Done clears a pending capture only when a slot was selected, and removes the banner', () => {
    const r = rig();
    r.ctl.begin();
    r.ctl.end();
    expect(r.armed).toEqual([]); // nothing was armed, nothing to clear
    expect(r.banner()).toBeNull();
    expect(r.sync.at(-1)).toEqual([null, false]);
    r.ctl.begin();
    r.ctl.selectSlot(7);
    r.ctl.end();
    expect(r.armed.map((cb) => cb !== null)).toEqual([true, false]);
    expect(r.ctl.active).toBe(false);
  });

  it('Done under the conflict prompt ends the mode for good: accepting afterwards changes nothing', () => {
    const r = rig();
    r.ctl.begin();
    r.ctl.selectSlot(3);
    r.latest()('KeyW');
    expect(r.dialogs).toHaveLength(1);
    r.ctl.end();
    r.dialogs[0].onOk();
    expect(r.ctl.active).toBe(false);
    expect(r.banner()).toBeNull();
    expect(r.keybinds.actionForCode('KeyW')).toBe('forward');
    expect(r.counts.refreshes).toBe(0);
  });

  it('Reset cancels a pending capture before asking, and restores the first bar on accept', () => {
    const r = rig();
    r.ctl.begin();
    r.ctl.selectSlot(1);
    r.latest()('F9');
    expect(r.keybinds.codeAt('slot1', 0)).toBe('F9');
    r.ctl.selectSlot(2);
    const resetButton = r
      .banner()
      ?.querySelector<HTMLButtonElement>('.actionbar-bind-actions button');
    expect(resetButton?.textContent).toBe(t('hudChrome.actionBar.reset'));
    resetButton?.click();
    expect(r.armed.at(-1)).toBeNull();
    expect(r.dialogs).toHaveLength(1);
    r.dialogs[0].onOk();
    expect(r.keybinds.codeAt('slot1', 0)).toBe('Digit2');
    expect(r.status()).toBe('');
    expect(r.ctl.active).toBe(true);
    // Done under the reset prompt: accepting afterwards must not resurrect the mode.
    resetButton?.click();
    r.ctl.end();
    r.dialogs[1].onOk();
    expect(r.ctl.active).toBe(false);
  });
});
