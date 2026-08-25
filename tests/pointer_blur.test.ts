// pointer_blur.ts: pointer-only blur for HUD chrome buttons plus the shared
// Enter/Space chrome-button key guard. Plain-Node suite over hand-rolled fakes
// modeling only the contract under test (the tests/CLAUDE.md DOM rule): the
// discriminator is UIEvent.detail (pointer clicks carry detail > 0, keyboard
// and programmatic activations carry detail === 0), the delegated form must
// bind in the CAPTURE phase (the blur must land before the clicked button's
// own handler records it as a focus-restore opener), and the key guard must
// stop propagation WITHOUT preventing the default, or it would kill the very
// keyboard activation it exists to protect.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  bindChromeButtonKeyGuard,
  bindPointerBlur,
  blurIfPointerClick,
  dropPointerFocus,
  POINTER_FOCUS_PARK_SELECTOR,
} from '../src/ui/pointer_blur';

// The park selector as a LITERAL (never the imported constant: a fake that matched
// the constant against itself would stay green if its value drifted).
const DIALOG_ROOT_SELECTOR = '[role="dialog"]';

/** A dialog root in the markDialogRoot shape: role=dialog, and tabindex="-1" unless
 *  the test models a root that never got the stamp (then it is not focusable). */
class FakeRoot {
  focused = 0;
  lastFocusOptions: { preventScroll?: boolean } | undefined;
  constructor(private readonly withTabindex = true) {}
  hasAttribute(name: string): boolean {
    return name === 'tabindex' && this.withTabindex;
  }
  focus(options?: { preventScroll?: boolean }): void {
    this.focused++;
    this.lastFocusOptions = options;
  }
}

class FakeButton {
  blurred = 0;
  tagName = 'BUTTON';
  constructor(
    private readonly selectorMatches: string[],
    private readonly dialogRoot: FakeRoot | null = null,
  ) {}
  closest(selector: string): FakeButton | FakeRoot | null {
    if (selector === DIALOG_ROOT_SELECTOR) return this.dialogRoot;
    return this.selectorMatches.includes(selector) ? this : null;
  }
  blur(): void {
    this.blurred++;
  }
}

interface BoundListener {
  type: string;
  listener: (e: Event) => void;
  capture: boolean;
}

class FakeContainer {
  listeners: BoundListener[] = [];
  addEventListener(
    type: string,
    listener: (e: Event) => void,
    options?: boolean | { capture?: boolean },
  ): void {
    const capture = typeof options === 'boolean' ? options : (options?.capture ?? false);
    this.listeners.push({ type, listener, capture });
  }
  dispatch(type: string, e: unknown): void {
    for (const l of this.listeners) if (l.type === type) l.listener(e as Event);
  }
}

describe('blurIfPointerClick', () => {
  it('blurs on a pointer-driven click (detail > 0)', () => {
    const btn = new FakeButton([]);
    blurIfPointerClick({ detail: 1, target: btn }, btn);
    expect(btn.blurred).toBe(1);
  });

  it('leaves keyboard/programmatic activation focused (detail === 0)', () => {
    const btn = new FakeButton([]);
    blurIfPointerClick({ detail: 0, target: btn }, btn);
    expect(btn.blurred).toBe(0);
  });

  it('tolerates a missing element', () => {
    expect(() => blurIfPointerClick({ detail: 1, target: null }, null)).not.toThrow();
  });
});

describe('dropPointerFocus (where the focus goes)', () => {
  it('parks on the markDialogRoot shape only (role=dialog), pinned as a literal', () => {
    expect(POINTER_FOCUS_PARK_SELECTOR).toBe(DIALOG_ROOT_SELECTOR);
  });

  it('parks focus on the enclosing focusable dialog root instead of blurring to the body', () => {
    // The root keeps FocusManager's Tab trap armed (it cycles only while focus is
    // inside the root) and, being a DIV, can never be re-activated by Space.
    const root = new FakeRoot();
    const btn = new FakeButton([], root);
    dropPointerFocus(btn);
    expect(root.focused).toBe(1);
    expect(root.lastFocusOptions).toEqual({ preventScroll: true });
    expect(btn.blurred).toBe(0);
  });

  it('blurs to the body when the dialog root is not focusable (no tabindex stamp)', () => {
    // focus() on an unfocusable root would silently no-op and leave the button
    // holding focus: the one outcome worse than a body blur.
    const root = new FakeRoot(false);
    const btn = new FakeButton([], root);
    dropPointerFocus(btn);
    expect(root.focused).toBe(0);
    expect(btn.blurred).toBe(1);
  });

  it('blurs to the body outside every dialog root (rail, trackers, chat tabs)', () => {
    const btn = new FakeButton([]);
    dropPointerFocus(btn);
    expect(btn.blurred).toBe(1);
  });

  it('blurs when the element has no closest() at all (a minimal fake or a detached node)', () => {
    let blurred = 0;
    dropPointerFocus({
      blur: () => {
        blurred++;
      },
    });
    expect(blurred).toBe(1);
  });

  it('routes blurIfPointerClick through the same park-or-blur decision', () => {
    const root = new FakeRoot();
    const btn = new FakeButton([], root);
    blurIfPointerClick({ detail: 1, target: btn }, btn);
    expect(root.focused).toBe(1);
    expect(btn.blurred).toBe(0);
    blurIfPointerClick({ detail: 0, target: btn }, btn);
    expect(root.focused).toBe(1);
  });
});

describe('bindPointerBlur (delegated)', () => {
  it('parks a pointer click inside a dialog-rooted panel on the root (the trapped-window case)', () => {
    const container = new FakeContainer();
    bindPointerBlur(container, 'button');
    const root = new FakeRoot();
    const btn = new FakeButton(['button'], root);
    container.dispatch('click', { detail: 1, target: btn });
    expect(root.focused).toBe(1);
    expect(btn.blurred).toBe(0);
  });

  it('binds a capture-phase click listener, so the blur precedes the target handler', () => {
    const container = new FakeContainer();
    bindPointerBlur(container, 'button');
    expect(container.listeners).toHaveLength(1);
    expect(container.listeners[0].type).toBe('click');
    expect(container.listeners[0].capture).toBe(true);
  });

  it('blurs the selector match for a pointer click and skips keyboard clicks', () => {
    const container = new FakeContainer();
    bindPointerBlur(container, 'button');
    const btn = new FakeButton(['button']);
    container.dispatch('click', { detail: 1, target: btn });
    expect(btn.blurred).toBe(1);
    container.dispatch('click', { detail: 0, target: btn });
    expect(btn.blurred).toBe(1);
  });

  it("defaults the selector to 'button' (the guard-loop panels and the rail rely on it)", () => {
    const container = new FakeContainer();
    bindPointerBlur(container);
    const btn = new FakeButton(['button']);
    container.dispatch('click', { detail: 1, target: btn });
    expect(btn.blurred).toBe(1);
  });

  it('ignores clicks whose target matches nothing', () => {
    const container = new FakeContainer();
    bindPointerBlur(container, '.micro-btn');
    const notAButton = new FakeButton([]);
    expect(() => container.dispatch('click', { detail: 1, target: notAButton })).not.toThrow();
    expect(notAButton.blurred).toBe(0);
  });
});

describe('bindChromeButtonKeyGuard', () => {
  function keyEvent(over: Partial<Record<'key' | 'code', string>> & { tagName?: string }): {
    key: string;
    code: string;
    target: { tagName: string };
    stopped: number;
    prevented: number;
    stopPropagation(): void;
    preventDefault(): void;
  } {
    return {
      key: over.key ?? '',
      code: over.code ?? '',
      target: { tagName: over.tagName ?? 'BUTTON' },
      stopped: 0,
      prevented: 0,
      stopPropagation() {
        this.stopped++;
      },
      preventDefault() {
        this.prevented++;
      },
    };
  }

  it('stops propagation of Enter and Space on a focused button, keeping the default', () => {
    const container = new FakeContainer();
    bindChromeButtonKeyGuard(container);
    for (const over of [{ key: 'Enter' }, { key: ' ' }, { code: 'Space' }]) {
      const e = keyEvent(over);
      container.dispatch('keydown', e);
      expect(e.stopped, JSON.stringify(over)).toBe(1);
      // preventDefault would suppress the native activation this guard protects.
      expect(e.prevented, JSON.stringify(over)).toBe(0);
    }
  });

  it('lets every other key, and non-button targets, bubble to the game keybinds', () => {
    const container = new FakeContainer();
    bindChromeButtonKeyGuard(container);
    const escapeKey = keyEvent({ key: 'Escape' });
    container.dispatch('keydown', escapeKey);
    expect(escapeKey.stopped).toBe(0);
    const spaceOnDiv = keyEvent({ code: 'Space', tagName: 'DIV' });
    container.dispatch('keydown', spaceOnDiv);
    expect(spaceOnDiv.stopped).toBe(0);
  });
});

describe('hud.ts wiring pins (the surfaces the Space-reopens-last-menu fix covers)', () => {
  // Source pins in the bank/deeds guard-array style: the browser E2E
  // (tests/browser/stale_focus_space.browser.test.ts) drives the real helpers
  // over a FIXTURE rail, so without these pins hud.ts could silently drop the
  // real wiring while every behavioral suite stays green. Line comments are
  // stripped first so a commented-out call can never satisfy a pin.
  // A regex, not a lexer: assumes no `/*` inside a string or regex literal in hud.ts.
  const stripLineComments = (src: string): string =>
    src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const hud = stripLineComments(readFileSync(join(__dirname, '../src/ui/hud.ts'), 'utf8'));

  it('applies the chrome focus wiring (the rail, the panels, and the trackers) through its one entry point', () => {
    // The root list and the per-root binding are pinned in
    // tests/chrome_focus_wiring.test.ts; hud.ts must call the entry point.
    expect(hud).toContain('wireChromeFocus($)');
  });

  it('marks the two non-dialog modal surfaces as dialog roots for the blocked-Space guard', () => {
    // The emote editor and the (pinnable) emote wheel are isModalOpen()
    // surfaces built as bare divs; the input layer's blocked-state guard
    // (src/game/stale_chrome_focus.ts) spares only buttons inside a dialog
    // root, so dropping either mark would eat their keyboard Space activation.
    expect(hud).toContain("markDialogRoot(el, { label: t('hudChrome.emoteEditor.title') })");
    expect(hud).toContain("markDialogRoot(el, { label: t('hudChrome.emoteWheel.label') })");
  });

  it('re-marks the emote wheel on every show, not once at creation (its name follows a language switch)', () => {
    // The wheel element is created once (the `if (!el)` block) and shown many
    // times; a mark inside the create block would freeze the aria-label in the
    // language of the first show. Pin the call to the per-show region: after the
    // create block closes and before the show paints the wheel's contents.
    const start = hud.indexOf('private showEmoteWheel(');
    expect(start).toBeGreaterThan(0);
    const createBlock = hud.indexOf('if (!el) {', start);
    expect(createBlock).toBeGreaterThan(start);
    const createBlockEnd = hud.indexOf('\n    }\n', createBlock);
    expect(createBlockEnd).toBeGreaterThan(createBlock);
    const paint = hud.indexOf('el.innerHTML =', start);
    const mark = hud.indexOf(
      "markDialogRoot(el, { label: t('hudChrome.emoteWheel.label') })",
      start,
    );
    expect(mark).toBeGreaterThan(createBlockEnd);
    expect(mark).toBeLessThan(paint);
  });
});
