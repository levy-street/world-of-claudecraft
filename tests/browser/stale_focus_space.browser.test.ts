// Real-browser regression suite for stale HUD focus hijacking Space or Enter.
// Runs in Browser Mode because the bug is native focus and activation semantics:
// only trusted pointer and key events reproduce the complete browser path.
//
// It drives the REAL modules end to end: the real Input (window-level keydown,
// the blocked-state stale-focus guard, the jump latch), the real pointer_blur
// wiring helpers hud.ts binds over the side rail and panels, the real
// stale_chrome_focus dialog carve-out, and the real installPromptDialog trap.

import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { Input } from '../../src/game/input';
import { Keybinds } from '../../src/game/keybinds';
import { wireChromeFocus } from '../../src/ui/chrome_focus_wiring';
import { markDialogRoot } from '../../src/ui/dialog_root';
import { FocusManager } from '../../src/ui/focus_manager';
import { bindChromeButtonKeyGuard, bindPointerBlur } from '../../src/ui/pointer_blur';
import { installPromptDialog } from '../../src/ui/prompt_dialog';

// One shared Input for the whole file: its window-level listeners cannot be
// removed, so a per-test instance would stack handlers. `blocked` stands in for
// main.ts's gameplayInputBlocked() (modal / prompt / camera prompt / rebuild).
let input: Input;
let blocked = false;
let chatOpens = 0;
// The last keydown as the window saw it AFTER Input's own listener ran (this
// listener is registered after Input's, both bubble phase), so a test can assert
// whether Input prevented the default: blur alone would already cancel the keyup
// click in Chromium, so without this the preventDefault would be undecidable.
let lastKeydown: { code: string; prevented: boolean } | null = null;

beforeAll(() => {
  const canvas = document.createElement('canvas');
  document.body.appendChild(canvas);
  input = new Input(
    canvas,
    {
      onTab: () => undefined,
      onTabPrev: () => undefined,
      onTargetFriendly: () => undefined,
      onCycleFriendly: () => undefined,
      onPet: () => undefined,
      onTargetPet: () => undefined,
      onAbility: () => undefined,
      onAbilityDown: () => undefined,
      onAbilityUp: () => undefined,
      onUiKey: (key) => {
        if (key === 'chat') chatOpens++;
      },
      onEmoteWheel: () => undefined,
      onClickPick: () => undefined,
      canUseGameKeys: () => !blocked,
    },
    new Keybinds(),
  );
  canvas.remove();
  window.addEventListener('keydown', (e) => {
    lastKeydown = { code: e.code, prevented: e.defaultPrevented };
  });
});

afterEach(async () => {
  // Belt and braces: release keys if a failed assertion left one held, then
  // clear the fixtures and the blocked flag.
  await userEvent.keyboard('[/Space]').catch(() => undefined);
  await userEvent.keyboard('[/Enter]').catch(() => undefined);
  blocked = false;
  chatOpens = 0;
  lastKeydown = null;
  document.body.innerHTML = '';
});

/** A micromenu-rail fixture wired exactly the way hud.ts wires #side-buttons:
 *  the chrome key guard (Enter/Space stopPropagation, native default kept) plus
 *  the delegated capture-phase pointer-only blur. */
function makeRail(): {
  rail: HTMLElement;
  btn: HTMLButtonElement;
  toggles: () => number;
  /** Whether the button still held focus when its OWN click handler ran (the
   *  capture-phase drop must land before it on the pointer path). */
  focusedAtClick: () => boolean | null;
} {
  const rail = document.createElement('div');
  rail.id = 'side-buttons';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.id = 'mm-char';
  btn.textContent = 'Character';
  let count = 0;
  let focusedAtClick: boolean | null = null;
  btn.addEventListener('click', () => {
    count++;
    focusedAtClick = document.activeElement === btn;
  });
  rail.appendChild(btn);
  document.body.appendChild(rail);
  bindChromeButtonKeyGuard(rail);
  bindPointerBlur(rail);
  return { rail, btn, toggles: () => count, focusedAtClick: () => focusedAtClick };
}

/** The minimap mail fixture wired through the same one-call seam as Hud. Its
 *  own handlers match Hud.initMailIndicator(), including stopPropagation(). */
function makeMailIndicator(): {
  mail: HTMLButtonElement;
  opens: () => number;
  focusedAtOpen: () => boolean | null;
} {
  const disc = document.createElement('div');
  disc.id = 'minimap-disc';
  const mail = document.createElement('button');
  mail.type = 'button';
  mail.id = 'mail-indicator';
  mail.textContent = 'Mail';
  let opens = 0;
  let focusedAtOpen: boolean | null = null;
  mail.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    opens++;
    focusedAtOpen = document.activeElement === mail;
  });
  mail.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    event.stopPropagation();
    opens++;
    focusedAtOpen = document.activeElement === mail;
  });
  disc.appendChild(mail);
  document.body.appendChild(disc);
  wireChromeFocus(
    (selector) => document.querySelector<HTMLElement>(selector) ?? document.createElement('div'),
  );
  return { mail, opens: () => opens, focusedAtOpen: () => focusedAtOpen };
}

async function pressSpace(): Promise<void> {
  await userEvent.keyboard('[Space>]');
  await userEvent.keyboard('[/Space]');
}

describe('stale focus vs gameplay keys (the reported bugs and their fixes)', () => {
  it('mouse-click mail, then trusted Enter: opens chat without reopening mail', async () => {
    const { mail, opens, focusedAtOpen } = makeMailIndicator();
    await userEvent.click(mail);
    expect(opens()).toBe(1);
    expect(focusedAtOpen()).toBe(false);
    expect(document.activeElement).not.toBe(mail);

    await userEvent.keyboard('[Enter]');
    expect(opens()).toBe(1);
    expect(chatOpens).toBe(1);
  });

  it('keyboard-focused mail keeps Enter activation and an accessible return-focus opener', async () => {
    const { mail, opens, focusedAtOpen } = makeMailIndicator();
    mail.focus();

    await userEvent.keyboard('[Enter]');
    expect(opens()).toBe(1);
    expect(focusedAtOpen()).toBe(true);
    expect(document.activeElement).toBe(mail);
    expect(chatOpens).toBe(0);
  });

  it('(a) mouse-click a micromenu button, then Space: no re-toggle, jump requested', async () => {
    const { btn, toggles, focusedAtClick } = makeRail();
    await userEvent.click(btn);
    expect(toggles()).toBe(1);
    // Layer 1: the pointer click must not leave the button focused, and the drop
    // landed in the capture phase, BEFORE the button's own handler ran (so an
    // opener captured by that handler would not be the button).
    expect(document.activeElement).not.toBe(btn);
    expect(focusedAtClick()).toBe(false);
    // Space is the jump key again, not a menu key. Read the raw key-held state,
    // not readMoveInput(), whose 150ms tap latch is shared across this file's
    // single Input (a reorder would make the latch read order-dependent).
    await userEvent.keyboard('[Space>]');
    expect(input.debugState().movementHeld.jump).toBe(true);
    await userEvent.keyboard('[/Space]');
    expect(toggles()).toBe(1);
  });

  it('(b) mouse-click, open a modal, then Space: the stale button does not activate (layers 1 and 2 composed; the click already dropped the focus)', async () => {
    const { btn, toggles } = makeRail();
    await userEvent.click(btn);
    expect(toggles()).toBe(1);
    blocked = true; // a modal window is now up (isModalOpen -> canUseGameKeys false)
    await pressSpace();
    expect(toggles()).toBe(1);
  });

  it('(b2) layer 2 alone: a stale mouse-focused chrome button outside the rail guards is suppressed while blocked, and a second Space stays suppressed', async () => {
    // A chrome button OUTSIDE every key-guarded container and dialog root, e.g.
    // a window button the audit missed. Stop click bubbling so Input's global
    // mouse-focus shed cannot clean it up: the input-layer guard is its only net.
    // Focused by a real mouse click (no delegated pointer drop bound here), the stale shape.
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'chrome';
    let count = 0;
    btn.addEventListener('click', (e) => {
      count++;
      e.stopPropagation();
    });
    document.body.appendChild(btn);
    await userEvent.click(btn);
    expect(count).toBe(1);
    expect(document.activeElement).toBe(btn);
    blocked = true;
    await pressSpace();
    expect(count).toBe(1);
    // Prevented, pinned explicitly through the post-Input listener.
    expect(lastKeydown).toEqual({ code: 'Space', prevented: true });
    // Focus is left alone (the guard suppresses, it never drops), and the next
    // Space lands in the same guard: still no activation. Reset the record first
    // so the second assertion cannot pass on the first press.
    expect(document.activeElement).toBe(btn);
    lastKeydown = null;
    await pressSpace();
    expect(count).toBe(1);
    expect(lastKeydown).toEqual({ code: 'Space', prevented: true });
  });

  it('(b4) keyboard-placed focus (Tab) is suppressed and KEPT while blocked', async () => {
    // The place a keyboard user Tabbed to must survive a Space the guard eats. Tab
    // is pressed with input already blocked: unblocked, Input preventDefaults Tab
    // for target-nearest, so the browser's focus navigation only runs while blocked.
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'chrome';
    let count = 0;
    btn.addEventListener('click', () => {
      count++;
    });
    document.body.appendChild(btn);
    blocked = true;
    await userEvent.tab();
    expect(document.activeElement).toBe(btn);
    await pressSpace();
    expect(count).toBe(0);
    expect(lastKeydown).toEqual({ code: 'Space', prevented: true });
    expect(document.activeElement).toBe(btn);
  });

  it('(b3) the blocked-state guard is Space-only: another key leaves a focused chrome button alone', async () => {
    // Delete the `e.code === 'Space'` narrowing in Input.onKeyDown and this reds:
    // every key would then be prevented and blur the focused control while blocked.
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'chrome';
    document.body.appendChild(btn);
    btn.focus();
    blocked = true;
    await userEvent.keyboard('[KeyA]');
    expect(lastKeydown).toEqual({ code: 'KeyA', prevented: false });
    expect(document.activeElement).toBe(btn);
  });

  it('(c) keyboard focus on a micromenu button: Space DOES activate it, and does not jump', async () => {
    const { btn, toggles, focusedAtClick } = makeRail();
    btn.focus(); // where Tab would land
    await userEvent.keyboard('[Space>]');
    // The rail guard stopped the keydown before the game layer: no jump. Read
    // the raw key-held state rather than readMoveInput(), whose 150ms tap latch
    // could still be warm from an earlier test's Space press.
    expect(input.debugState().movementHeld.jump).toBe(false);
    await userEvent.keyboard('[/Space]');
    // Native activation on keyup: the menu opens for keyboard users.
    expect(toggles()).toBe(1);
    // And keyboard users keep their focus position (no pointer blur): the button
    // was still focused when its own handler ran, and still is.
    expect(focusedAtClick()).toBe(true);
    expect(document.activeElement).toBe(btn);
  });

  it('(d) the prompt-dialog recipe: a prompt button keeps Space activation while blocked', async () => {
    // The real prompt recipe: window behind goes inert, prompt owns its keys. The
    // prompt stops the Space keydown itself (prompt_dialog.ts), before it can reach
    // Input, so this is the integration test of that recipe under the blocked state;
    // the dialog-root carve-out in the guard itself is (d2), whose keydown DOES reach
    // Input.
    const windowBehind = document.createElement('div');
    document.body.appendChild(windowBehind);
    const prompt = document.createElement('div');
    prompt.className = 'prompt';
    const text = document.createElement('div');
    text.className = 'prompt-text';
    text.textContent = 'Confirm?';
    const confirm = document.createElement('button');
    confirm.type = 'button';
    confirm.textContent = 'OK';
    let confirmed = 0;
    confirm.addEventListener('click', () => {
      confirmed++;
    });
    prompt.append(text, confirm);
    document.body.appendChild(prompt);
    const handle = installPromptDialog(prompt, null, () => prompt.remove(), {
      inertRoot: windowBehind,
      idPrefix: 'stale-space-test',
    });
    blocked = true; // promptModalOpen() blocks gameplay keys
    confirm.focus();
    await pressSpace();
    expect(confirmed).toBe(1);
    // The prompt's own control keeps its focus.
    expect(document.activeElement).toBe(confirm);
    handle.dismiss();
  });

  it('(d2) a button inside a markDialogRoot root (options window shape) keeps Space activation while blocked', async () => {
    // Unlike the prompt (which stops propagation itself), an options-window
    // button's keydown DOES reach the window handler; the stale_chrome_focus
    // dialog carve-out is what keeps its native activation alive. Built with the
    // real markDialogRoot, the shape every window root in the tree carries.
    const dialog = document.createElement('div');
    markDialogRoot(dialog, { label: 'options' });
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'setting';
    let count = 0;
    btn.addEventListener('click', () => {
      count++;
    });
    dialog.appendChild(btn);
    document.body.appendChild(dialog);
    blocked = true;
    btn.focus();
    await pressSpace();
    expect(count).toBe(1);
    // Reached Input and was left alone: neither prevented nor blurred.
    expect(lastKeydown).toEqual({ code: 'Space', prevented: false });
    expect(document.activeElement).toBe(btn);
  });

  it('(e) a pointer click inside a dialog-rooted window parks focus on the root: the Tab trap stays armed and Space still jumps', async () => {
    // The real markDialogRoot shape (role=dialog + tabindex=-1) under a real
    // FocusManager trap, which cycles Tab only while focus is INSIDE the root: a
    // blur to the body would silently disarm it on the mouse path.
    const dialog = document.createElement('div');
    markDialogRoot(dialog, { label: 'window' });
    const first = document.createElement('button');
    first.type = 'button';
    first.textContent = 'first';
    const second = document.createElement('button');
    second.type = 'button';
    second.textContent = 'second';
    let count = 0;
    second.addEventListener('click', () => {
      count++;
    });
    dialog.append(first, second);
    document.body.appendChild(dialog);
    bindChromeButtonKeyGuard(dialog);
    bindPointerBlur(dialog);
    const fm = new FocusManager();
    const trap = fm.open({ root: () => dialog });
    try {
      await userEvent.click(second);
      expect(count).toBe(1);
      // Parked on the root: not the clicked button, not the body. A window opened
      // by that click would record the root as its opener, never the stale button.
      expect(document.activeElement).toBe(dialog);
      expect(fm.activeFocusable()).toBe(dialog);
      // Space on the root (a DIV) is the jump key again; nothing re-activates.
      await userEvent.keyboard('[Space>]');
      expect(input.debugState().movementHeld.jump).toBe(true);
      await userEvent.keyboard('[/Space]');
      expect(count).toBe(1);
      // Tab: the trap is still armed (focus is inside the root), so it enters the
      // window's cycle at the first control instead of walking out of it.
      await userEvent.tab();
      expect(document.activeElement).toBe(first);
    } finally {
      trap.release(false);
    }
  });
});
