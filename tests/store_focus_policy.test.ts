// @vitest-environment happy-dom
//
// A real DOM for the same reason tests/focus_restore.test.ts and the store
// behaviour suite use one: the half under test here focuses real elements and
// reads a real disabled property. The other half, planStoreFocus, is pure and is
// driven directly, which is the point of splitting it out: the store behaviour
// suite can only reach these decisions through a whole repaint, where an elided
// innerHTML write can make an arm pass for the wrong reason.
import { afterEach, describe, expect, it } from 'vitest';
import {
  planStoreFocus,
  restoreStoreErrorFocus,
  restoreStoreFocus,
} from '../src/ui/store_focus_policy';

const STASH = 'charter-strongbox_charter_1';

describe('planStoreFocus', () => {
  it('a foreground paint spends the stash only when focus went nowhere', () => {
    expect(
      planStoreFocus({
        background: false,
        focusInBody: null,
        focusWentNowhere: true,
        stashed: STASH,
      }),
    ).toEqual({ focusKey: STASH, degrade: true });
    // Something else has taken focus in the meantime, so this repaint steals
    // nothing. The NEGATIVE half of the same rule: without it a repaint would
    // pull focus out of another window entirely.
    expect(
      planStoreFocus({
        background: false,
        focusInBody: null,
        focusWentNowhere: false,
        stashed: STASH,
      }),
    ).toEqual({ focusKey: null, degrade: true });
  });

  it('a BACKGROUND paint never reads the stash, whatever focus is doing', () => {
    // Both focus states, because the exemption must not depend on which one the
    // player happens to be in: an arm that only drove focusWentNowhere would pass
    // with the exemption written as `!inputs.focusWentNowhere ? null : stashed`.
    for (const focusWentNowhere of [true, false]) {
      expect(
        planStoreFocus({ background: true, focusInBody: null, focusWentNowhere, stashed: STASH }),
      ).toEqual({ focusKey: null, degrade: false });
    }
  });

  it('focus genuinely inside the body is carried across the wipe on either kind of paint', () => {
    // The wipe would otherwise drop that player to <body> itself, which is worse
    // than the repaint they did not ask for.
    for (const background of [true, false]) {
      expect(
        planStoreFocus({
          background,
          focusInBody: 'armory-cinderbrand_sword',
          focusWentNowhere: false,
          stashed: STASH,
        }).focusKey,
      ).toBe('armory-cinderbrand_sword');
    }
  });

  it('degrade tracks who asked for the paint, and nothing else', () => {
    expect(
      planStoreFocus({
        background: false,
        focusInBody: 'k',
        focusWentNowhere: false,
        stashed: null,
      }).degrade,
    ).toBe(true);
    expect(
      planStoreFocus({ background: true, focusInBody: 'k', focusWentNowhere: false, stashed: null })
        .degrade,
    ).toBe(false);
  });
});

function grid(): {
  body: HTMLElement;
  first: HTMLElement;
  last: HTMLElement;
  sibling: HTMLElement;
  topUp: HTMLElement;
} {
  const body = document.createElement('div');
  // THE TOP-UP IS FIRST, because production paints it first: it lives in the hero
  // block at the head of the store body, above the armory and the charter grid.
  // The fixture used to paint it LAST, and that ordering made the anti-promotion
  // arm below unable to fail: with the top-up at the end, the filtered and the
  // unfiltered candidate lists both begin with the same grid control. Three fresh
  // review lanes found it independently, and the mutation that had scored a kill
  // was killed by a SOURCE pin in another file rather than by this arm.
  body.innerHTML =
    '<button data-buy-claudium data-focus-key="topup">top up</button>' +
    '<button data-focus-key="armory-first">first</button>' +
    '<button data-focus-key="charter-strongbox_charter_1">charter one</button>' +
    '<button data-focus-key="charter-strongbox_charter_2">charter two</button>';
  document.body.appendChild(body);
  return {
    body,
    first: body.querySelector('[data-focus-key="armory-first"]') as HTMLElement,
    last: body.querySelector('[data-focus-key="charter-strongbox_charter_1"]') as HTMLElement,
    sibling: body.querySelector('[data-focus-key="charter-strongbox_charter_2"]') as HTMLElement,
    topUp: body.querySelector('[data-buy-claudium]') as HTMLElement,
  };
}

describe('restoreStoreFocus', () => {
  // Every arm mounts a grid on document.body and planStoreFocus reads focus over
  // the WHOLE document, so a control left focused by an earlier arm would change
  // a later plan. Clearing here makes that structural rather than a discipline.
  afterEach(() => {
    (document.activeElement as HTMLElement | null)?.blur();
    document.body.innerHTML = '';
  });

  it('focuses nothing when the plan has no key', () => {
    const g = grid();
    (document.activeElement as HTMLElement | null)?.blur();
    restoreStoreFocus(g.body, { focusKey: null, degrade: true }, g.topUp);
    expect(document.activeElement).not.toBe(g.first);
    expect(document.activeElement).not.toBe(g.topUp);
  });

  it('restores the same control when it survived, on either kind of paint', () => {
    for (const degrade of [true, false]) {
      const g = grid();
      restoreStoreFocus(g.body, { focusKey: 'charter-strongbox_charter_1', degrade }, g.topUp);
      expect(document.activeElement).toBe(g.last);
      g.body.remove();
    }
  });

  it('a foreground paint degrades to the TOP, a background paint stays in its family', () => {
    // The card a buyer just used can legitimately vanish when the ladder fills,
    // and landing them anywhere sane is right for a paint they asked for. On a
    // repaint nobody asked for, the full ladder is a focus move plus a scroll
    // jump to the TOP of a long scroller (focus() scrolls its target into view
    // and the charter grid is the LAST section), while focusing nothing drops a
    // keyboard user to <body> and makes them Tab from the top of the DOCUMENT.
    // So a background paint degrades within the SAME key family instead.
    const gone = 'charter-strongbox_charter_complete';
    const fg = grid();
    (document.activeElement as HTMLElement | null)?.blur();
    restoreStoreFocus(fg.body, { focusKey: gone, degrade: true }, fg.topUp);
    expect(document.activeElement).toBe(fg.first);
    fg.body.remove();

    const bg = grid();
    (document.activeElement as HTMLElement | null)?.blur();
    restoreStoreFocus(bg.body, { focusKey: gone, degrade: false }, bg.topUp);
    // A charter sibling, never the armory card above it and never the top-up.
    expect(document.activeElement).toBe(bg.last);
    expect(document.activeElement).not.toBe(bg.first);
    expect(document.activeElement).not.toBe(bg.topUp);
  });

  it('a background paint focuses NOTHING when its whole family is gone', () => {
    // The honest answer once there is no nearby place to stand: crossing into
    // another section is the scroll jump the rule exists to avoid.
    const g = grid();
    for (const el of [...g.body.querySelectorAll('[data-focus-key^="charter-"]')]) el.remove();
    (document.activeElement as HTMLElement | null)?.blur();
    const before = document.activeElement;
    restoreStoreFocus(g.body, { focusKey: 'charter-gone', degrade: false }, g.topUp);
    expect(document.activeElement).toBe(before);
    expect(document.activeElement).not.toBe(g.first);
    expect(document.activeElement).not.toBe(g.topUp);
  });

  it('a background paint skips a family sibling that came back DISABLED', () => {
    // The in-flight guard's own shape: the buy button is disabled while a spend
    // is awaiting, and restoreFirstEnabled must walk past it rather than focus a
    // control the player cannot use.
    const g = grid();
    (g.last as HTMLButtonElement).disabled = true;
    (document.activeElement as HTMLElement | null)?.blur();
    restoreStoreFocus(g.body, { focusKey: 'charter-gone', degrade: false }, g.topUp);
    expect(document.activeElement).toBe(g.sibling);
  });

  it('a foreground degrade skips a disabled control and reaches the top-up button', () => {
    // Proves the ladder really runs through the shared helper's disabled skip
    // rather than stopping at candidates[0], and that the last rung is reachable.
    const g = grid();
    for (const el of [g.first, g.last, g.sibling]) (el as HTMLButtonElement).disabled = true;
    (document.activeElement as HTMLElement | null)?.blur();
    restoreStoreFocus(g.body, { focusKey: 'charter-nope', degrade: true }, g.topUp);
    expect(document.activeElement).toBe(g.topUp);
  });

  it('the top-up button is KEYED, so a player standing on it is restored to it', () => {
    // It is a focusable control inside the wiped body like any other, and it was
    // the only one with no key: captureFocusKey therefore read null while focus
    // was on a real element, the plan answered "focus nothing", and a keyboard
    // player standing on Buy Claudium when any repaint landed was dropped to
    // <body>. That is the exact harm this whole contract exists to prevent, on
    // the one control the degrade ladder itself hands people to.
    for (const degrade of [true, false]) {
      const g = grid();
      (document.activeElement as HTMLElement | null)?.blur();
      restoreStoreFocus(g.body, { focusKey: 'topup', degrade }, g.topUp);
      expect(document.activeElement, `degrade=${degrade}`).toBe(g.topUp);
      g.body.remove();
    }
  });

  it('and keying it did NOT promote it: the grid still degrades before the top-up', () => {
    // The ladder's documented order is "the same control, then any other keyed
    // control in the grid, then the top-up button". The key makes that button a
    // member of the keyed set, and it is painted FIRST in the store body, so
    // without excluding it from the middle rung it would silently become the
    // first fallback and pull focus (and the scroller) to the top of the pane.
    const g = grid();
    (document.activeElement as HTMLElement | null)?.blur();
    restoreStoreFocus(g.body, { focusKey: 'charter-nope', degrade: true }, g.topUp);
    expect(document.activeElement, 'a surviving grid control outranks the top-up').toBe(g.first);
  });
});

describe('restoreStoreErrorFocus (Bank Storage phase 17)', () => {
  // The error body is one role="alert" div with no control in it, so the ladder
  // above has nothing to walk: without a second entry point the player who was
  // standing on a buy button lands on <body> and Tabs from the top of the
  // DOCUMENT. The surviving places to stand are in the window SHELL.
  function shell(opts: { tab?: boolean; close?: boolean } = {}): HTMLElement {
    const root = document.createElement('div');
    root.innerHTML =
      (opts.tab === false ? '' : '<button data-woc-store-tab="store">Store</button>') +
      (opts.close === false ? '' : '<button data-close>X</button>') +
      '<div class="dr-body"><div class="dr-empty dr-error" role="alert">down</div></div>';
    document.body.appendChild(root);
    return root;
  }

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('the shell chrome really is OUTSIDE the wiped body, which is what outsideBody rests on', () => {
    // The premise, asserted rather than assumed. Both candidates are excluded when
    // they sit inside .dr-body, so if the tab strip or the close button were ever
    // painted INSIDE the body this would focus nothing at all. That direction fails
    // closed (the player keeps the focus they had), but it is a silent loss of the
    // fix, so the layout it depends on is pinned here.
    const root = shell();
    for (const sel of ['[data-woc-store-tab="store"]', '[data-close]']) {
      const el = root.querySelector(sel) as HTMLElement;
      expect(el, sel).not.toBeNull();
      expect(el.closest('.dr-body'), `${sel} is inside the wiped subtree`).toBeNull();
    }
  });

  it('focuses NOTHING when the wipe took focus from nobody', () => {
    // A null focusKey means focus was not in the body and nothing was stashed.
    const root = shell();
    const before = document.activeElement;
    restoreStoreErrorFocus({ focusKey: null, degrade: true }, root);
    expect(document.activeElement).toBe(before);
  });

  it('lands on the Store TAB, not on the close button, when focus was ours to move', () => {
    // The tab keeps the player inside the surface they were using; [data-close]
    // is one Enter away from dismissing a window they did not ask to leave.
    const root = shell();
    restoreStoreErrorFocus({ focusKey: 'charter-strongbox_charter_1', degrade: true }, root);
    expect((document.activeElement as HTMLElement).dataset.wocStoreTab).toBe('store');
  });

  it('falls back to the close button when the tab strip is gone', () => {
    const root = shell({ tab: false });
    restoreStoreErrorFocus({ focusKey: 'charter-x', degrade: true }, root);
    expect((document.activeElement as HTMLElement).hasAttribute('data-close')).toBe(true);
  });

  it('ignores a close affordance painted INSIDE the wiped body', () => {
    // "Survives the wipe" is the whole claim, and both selectors are shell-wide:
    // an error or empty body that painted its own Close or Retry control (an
    // idiom this tree uses elsewhere) would be matched by [data-close], and focus
    // would land on a node the NEXT wipe destroys, putting the player back on
    // <body> with nothing red anywhere.
    // No shell tab and no shell close, so the ONLY match in the whole root is the
    // one inside the subtree about to be wiped: an unscoped query takes it.
    const root = shell({ tab: false, close: false });
    const body = root.querySelector('.dr-body') as HTMLElement;
    const inside = document.createElement('button');
    inside.setAttribute('data-close', '');
    body.appendChild(inside);
    expect(root.querySelector('[data-close]')).toBe(inside);
    const before = document.activeElement;
    restoreStoreErrorFocus({ focusKey: 'charter-x', degrade: true }, root);
    expect(document.activeElement, 'focus landed inside the subtree being wiped').toBe(before);
  });

  it('focuses nothing rather than throwing when neither survived', () => {
    const root = shell({ tab: false, close: false });
    const before = document.activeElement;
    expect(() =>
      restoreStoreErrorFocus({ focusKey: 'charter-x', degrade: true }, root),
    ).not.toThrow();
    expect(document.activeElement).toBe(before);
  });

  it('a BACKGROUND error paint still moves focus, because the wipe already took it', () => {
    // `degrade` says how FAR a restore may walk and there is exactly one place to
    // walk to, so it is deliberately not read here. The arm exists because the
    // opposite reading (a background paint moves nothing) is the intuitive one
    // and would leave a keyboard player on <body>.
    const root = shell();
    restoreStoreErrorFocus({ focusKey: 'armory-cinderbrand', degrade: false }, root);
    expect((document.activeElement as HTMLElement).dataset.wocStoreTab).toBe('store');
  });

  it('skips a DISABLED tab the way every other restore in this namespace does', () => {
    const root = shell();
    root.querySelector<HTMLButtonElement>('[data-woc-store-tab]')?.setAttribute('disabled', '');
    restoreStoreErrorFocus({ focusKey: 'charter-x', degrade: true }, root);
    expect((document.activeElement as HTMLElement).hasAttribute('data-close')).toBe(true);
  });
});
