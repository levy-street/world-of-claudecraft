// @vitest-environment jsdom
// Bank Storage phase 18: the short-phone chrome contract.
//
// THREE INSTRUMENTS, and which holds which claim is the point of this file.
//
//  - The DECISIONS (what may scroll, what may never, at what height, and which
//    element carries the pane's scroll offset) are pure, and are driven here
//    directly out of src/ui/bank_chrome_layout_core.ts.
//  - The WIRING (that the window really consults that plan and really writes
//    BOTH candidate scrollers, after its last band rather than before it) is
//    driven here too, against the REAL BankWindow, through a rig.
//
//    THE RIG'S REASON WAS WRONG ON FIRST WRITE and a review round caught it, so
//    the corrected one is recorded rather than quietly swapped. It said a
//    layout-free DOM stores no scroll offset, so `el.scrollTop = 40` reads back
//    0. Probed: jsdom DOES store it (reads back 40). What jsdom cannot give is
//    an observation of the WRITE, and two claims here need exactly that. An
//    element that survives a rebuild keeps its stored offset, so an arm that
//    only reads a value back is vacuous against a DELETED write; and the
//    ordering claim needs to know what the DOM looked like at the instant of the
//    write. So the rig exists for its `onWrite` hook, not for storage.
//  - The GEOMETRY (that the footer is actually inside the window on a real
//    device) belongs to neither: jsdom and happy-dom implement neither layout
//    nor scrolling, so nothing here can see a pixel. That claim is held by
//    scripts/bank_mobile_buyrow_check.mjs, which drives a real browser at both
//    profiles, and by the committed before/after captures.
//
// This file owns global prototype state for the duration of its wiring block,
// which is why it is its own file rather than an addition to bank_window.test.ts.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  BANK_CHROME_COMPACT_MAX_HEIGHT,
  BANK_PINNED_BAND_SELECTORS,
  BANK_SCROLLING_BAND_SELECTORS,
  isSameBankPane,
  planBankScrollRestore,
} from '../src/ui/bank_chrome_layout_core';
import { BankWindow, type BankWindowDeps } from '../src/ui/bank_window';
import type { BankInfo, IWorld, VaultInfo } from '../src/world_api';

// Resolved off the runner's root rather than import.meta.url: this file runs in
// jsdom, where import.meta.url is not a file: URL. Every slice taken out of
// these two is length-guarded below, which is what stops a wrong path turning
// the negative assertions vacuous.
const mobileCss = readFileSync(resolve(process.cwd(), 'src/styles/hud.mobile.css'), 'utf8');
const layoutCss = readFileSync(resolve(process.cwd(), 'src/styles/layout.css'), 'utf8');

// ---------------------------------------------------------------------------
// (a) The pure plan.
// ---------------------------------------------------------------------------

const PERSONAL = { tab: 'personal', guildView: 'contents' };
const VAULT = { tab: 'vault', guildView: 'contents' };
const GUILD_LOG = { tab: 'guild', guildView: 'log' };
const GUILD_CONTENTS = { tab: 'guild', guildView: 'contents' };

describe('planBankScrollRestore: which offset survives a rebuild', () => {
  it('carries BOTH candidate offsets when the pane did not change', () => {
    // Both, not one: which element is the scroller depends on the viewport, and
    // the window deliberately does not ask. Dropping either term strands a
    // player mid-list on exactly one of the two regimes.
    expect(planBankScrollRestore({ inner: 41, outer: 137 }, PERSONAL, PERSONAL)).toEqual({
      inner: 41,
      outer: 137,
    });
  });

  it('zeroes BOTH on a tab switch (a new pane starts at the top, never mid-list)', () => {
    expect(planBankScrollRestore({ inner: 41, outer: 137 }, PERSONAL, VAULT)).toEqual({
      inner: 0,
      outer: 0,
    });
  });

  it('zeroes BOTH on a guild SUB-VIEW switch inside the same tab', () => {
    // The contents grid and the log list both mount a .bank-scroll, so the tab
    // alone is not a fine enough key: without the sub-view term the grid's
    // offset lands on the log.
    expect(planBankScrollRestore({ inner: 41, outer: 137 }, GUILD_CONTENTS, GUILD_LOG)).toEqual({
      inner: 0,
      outer: 0,
    });
  });

  it('clamps a NEGATIVE inner offset without touching the outer one', () => {
    // Mobile Safari's elastic overscroll reports a negative scrollTop mid
    // rubber-band, and it is a first-class target. One arm per term, so a fix
    // applied to only one of the two cannot pass.
    expect(planBankScrollRestore({ inner: -22, outer: 137 }, PERSONAL, PERSONAL)).toEqual({
      inner: 0,
      outer: 137,
    });
  });

  it('clamps a NEGATIVE outer offset without touching the inner one', () => {
    expect(planBankScrollRestore({ inner: 41, outer: -22 }, PERSONAL, PERSONAL)).toEqual({
      inner: 41,
      outer: 0,
    });
  });

  it('clamps a non-finite offset to zero rather than writing NaN back', () => {
    expect(planBankScrollRestore({ inner: Number.NaN, outer: 137 }, PERSONAL, PERSONAL)).toEqual({
      inner: 0,
      outer: 137,
    });
  });

  it('isSameBankPane is false when EITHER term differs, true only when both match', () => {
    expect(isSameBankPane(PERSONAL, PERSONAL)).toBe(true);
    expect(isSameBankPane(PERSONAL, VAULT)).toBe(false);
    expect(isSameBankPane(GUILD_CONTENTS, GUILD_LOG)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// (b) The window really consults it, and writes BOTH, after its last band.
// ---------------------------------------------------------------------------

const nativeScrollTop = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop');

/** Observe every `scrollTop` write, and keep storing them.
 *
 *  jsdom already stores the value (probed), so this is NOT what makes the
 *  read-back arms work. `onWrite` is: it fires on every set, so an arm can see
 *  that a write really happened (an element that survives a rebuild keeps its
 *  old value, so a read-back alone cannot tell a restore from a deletion) and
 *  what the DOM looked like at that instant (the ordering claim). Backed per
 *  element, restored in afterEach. */
function installScrollTop(onWrite?: (el: Element, value: number) => void): ScrollRig {
  const store = new WeakMap<Element, number>();
  Object.defineProperty(Element.prototype, 'scrollTop', {
    configurable: true,
    get(this: Element) {
      return store.get(this) ?? 0;
    },
    set(this: Element, value: number) {
      store.set(this, value);
      onWrite?.(this, value);
    },
  });
  return { clamp: (el) => store.set(el, 0) };
}

interface ScrollRig {
  /** Zero an element's stored offset, the way a browser does when the content
   *  under it collapses. */
  clamp: (el: Element) => void;
}

/** Model the CLAMP a real browser performs when the grid is emptied.
 *
 *  This is the fact the refreshGrid arm is about and the one jsdom does not
 *  have: emptying the grid collapses the scroll height and the browser resets
 *  every affected scroller's offset to 0, permanently, so refilling does not
 *  bring it back. Without the model both elements keep their stored values
 *  across the refill and a `scroll.scrollTop = scroll.scrollTop` self-assign
 *  passes an arm that only checks the written VALUE.
 *
 *  Hooked on the grid instance's own `innerHTML` setter because the collapse is
 *  synchronous and a MutationObserver would fire a microtask too late. */
function modelGridWipeClamp(root: HTMLElement, rig: ScrollRig, clamped: Element[]): void {
  const grid = root.querySelector('.bank-grid') as HTMLElement;
  if (!grid) throw new Error('no .bank-grid to model the clamp on');
  // WALK the chain: innerHTML lives on Element.prototype in some DOM
  // implementations and on HTMLElement.prototype in others, and reading the
  // wrong one throws a message that names the grid rather than the descriptor.
  let proto: object | null = Object.getPrototypeOf(grid);
  let desc: PropertyDescriptor | undefined;
  while (proto && !desc) {
    desc = Object.getOwnPropertyDescriptor(proto, 'innerHTML');
    proto = Object.getPrototypeOf(proto);
  }
  if (!desc?.set || !desc.get) throw new Error('no innerHTML accessor to model the clamp on');
  Object.defineProperty(grid, 'innerHTML', {
    configurable: true,
    get(this: HTMLElement) {
      return desc.get?.call(this);
    },
    set(this: HTMLElement, value: string) {
      desc.set?.call(this, value);
      if (value === '') for (const el of clamped) rig.clamp(el);
    },
  });
}

function restoreScrollTop(): void {
  if (nativeScrollTop) Object.defineProperty(Element.prototype, 'scrollTop', nativeScrollTop);
  else delete (Element.prototype as unknown as Record<string, unknown>).scrollTop;
}

afterEach(restoreScrollTop);

/** The STOCKED, near-full shape the phase is about, matching the browser suite's
 *  fixture: past BANK_NEAR_FULL_FRACTION so the footer carries the gilded
 *  treatment, non-empty so the full toolbar mounts, one socketed satchel so both
 *  meter pools exist. A leaner bank paints fewer rigid bands than production
 *  does and would make every arm below measure a pane nobody sees. */
function bankInfo(over: Partial<BankInfo> = {}): BankInfo {
  return {
    slots: Array.from({ length: 23 }, () => ({ itemId: 'iron_ore', count: 1 })),
    capacity: 32,
    purchasedSlots: 0,
    bonusSlots: 0,
    nextExpansionCost: 500,
    bonusSources: [],
    socketsUnlocked: 1,
    socketBags: ['burlap_reagent_pouch', null, null, null],
    nextSocketCost: 1_000_000,
    generalCapacity: 24,
    materialsCapacity: 8,
    generalUsed: 21,
    materialsUsed: 2,
    ...over,
  };
}

function harness(): { window: BankWindow; root: HTMLElement } {
  document.body.innerHTML = '<div id="prompt-stack"></div>';
  const root = document.createElement('div');
  root.id = 'bank-window';
  document.body.appendChild(root);
  const noop = (): void => {};
  const world = {
    bankInfo: bankInfo(),
    guildBankInfo: null,
    // NON-NULL: the tab strip mounts only when a vault or guild pane exists, and
    // vaultInfo rides the SAME nearBanker gate as bankInfo, so a bank open at a
    // bursar always has one. It is also what makes a real pane SWITCH drivable
    // below, which is the wiring the pure plan is useless without.
    vaultInfo: {
      stock: {},
      special: [],
      upgrades: 1,
      perMaterialCap: 40,
      nextUpgradeCost: 2_000,
    } satisfies VaultInfo,
    inventory: [],
    bags: [null, null, null, null],
    copper: 100_000_000,
    bankDeposit: noop,
    bankWithdraw: noop,
    bankBuySlots: noop,
    bankUnlockSocket: noop,
    bankSocketBag: noop,
    bankUnsocketBag: noop,
  };
  const deps: BankWindowDeps = {
    itemIcon: () => '<span class="item-icon"></span>',
    moneyHtml: (c: number) => `<span class="money-inline">${c}</span>`,
    itemTooltip: () => '',
    attachTooltip: noop,
    root: () => root,
    world: () => world as unknown as IWorld,
    closeOthers: noop,
    hideTooltip: noop,
    consumePeek: () => false,
    captureFocus: () => null,
    restoreFocus: noop,
    onClosed: noop,
    onInventoryChanged: noop,
  };
  return { window: new BankWindow(deps), root };
}

describe('the bank window carries the pane scroll offset across a rebuild', () => {
  it('restores BOTH the window and the .bank-scroll region on a same-pane repaint', () => {
    // The two halves need DIFFERENT evidence, and that asymmetry is the trap.
    // The region is rebuilt, so reading 41 off the FRESH one can only come from
    // a real write. The window is the SAME element across the rebuild, so it
    // keeps its stored value and a read-back alone would pass with the write
    // deleted. The write log is what makes the outer half decisive.
    const writes: { el: Element; value: number }[] = [];
    installScrollTop((el, value) => writes.push({ el, value }));
    const { window: win, root } = harness();
    win.open();
    const region = root.querySelector('.bank-scroll') as HTMLElement;
    expect(region, 'the personal pane must mount a .bank-scroll').not.toBeNull();
    region.scrollTop = 41;
    root.scrollTop = 137;
    writes.length = 0;
    win.render();
    expect((root.querySelector('.bank-scroll') as HTMLElement).scrollTop).toBe(41);
    expect(root.scrollTop).toBe(137);
    expect(
      writes.filter((w) => w.el === root && w.value === 137).length,
      'the WINDOW offset must actually be written, not merely survive',
    ).toBeGreaterThan(0);
    expect(
      writes.filter((w) => w.el !== root && w.value === 41).length,
      'the region offset must actually be written',
    ).toBeGreaterThan(0);
  });

  it('writes the window offset only AFTER the footer band exists', () => {
    // The regression this holds: restoring before the last band means the write
    // clamps to a shorter content height on a real device and stays there. A
    // layout-free DOM cannot see the clamp, but it CAN see the ordering that
    // causes it. render() wipes the root before it builds, so a stale footer
    // cannot satisfy the probe.
    let root!: HTMLElement;
    const sawFooter: boolean[] = [];
    installScrollTop((el) => {
      if (root && el === root) sawFooter.push(el.querySelector('.bank-footer') !== null);
    });
    const h = harness();
    root = h.root;
    h.window.open();
    root.scrollTop = 137;
    sawFooter.length = 0;
    h.window.render();
    expect(sawFooter.length, 'the window offset must be written on a repaint').toBeGreaterThan(0);
    expect(sawFooter.every(Boolean), 'the window offset was written before the footer').toBe(true);
  });

  it('does not strand the offset on a search keystroke (the refreshGrid path)', () => {
    // TWO things have to be true and each needs its own evidence. The write must
    // HAPPEN (an element that survives the refill keeps its old value, so a
    // read-back alone cannot tell a restore from a deletion), and the value must
    // come from the CAPTURE rather than from the element itself (a self-assign
    // logs the right number and restores nothing). The rig models the browser's
    // clamp for the second, so a value that was not captured before the wipe can
    // only ever be 0.
    const writes: { el: Element; value: number }[] = [];
    const rig = installScrollTop((el, value) => writes.push({ el, value }));
    const { window: win, root } = harness();
    win.open();
    const search = root.querySelector('.bag-search') as HTMLInputElement;
    expect(search, 'a stocked bank mounts the search box').not.toBeNull();
    const region = root.querySelector('.bank-scroll') as HTMLElement;
    modelGridWipeClamp(root, rig, [root, region]);
    region.scrollTop = 41;
    root.scrollTop = 137;
    writes.length = 0;
    search.value = 'iron';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    expect(
      writes.filter((w) => w.el === region && w.value === 41).length,
      'refreshGrid must reapply the REGION offset it captured',
    ).toBeGreaterThan(0);
    expect(
      writes.filter((w) => w.el === root && w.value === 137).length,
      'refreshGrid must reapply the WINDOW offset it captured',
    ).toBeGreaterThan(0);
    // ...and the model really fired, or both assertions above are back to being
    // statements about an element that simply kept its value.
    expect(region.scrollTop, 'the clamp model must have run').toBe(41);
  });

  it('zeroes BOTH offsets on a real pane switch, which is the wiring the plan needs', () => {
    // Every other wiring arm here is same-pane, so the window could pass the
    // SAME key twice into planBankScrollRestore and leave all of them green
    // while a tab switch pasted the personal grid's offset onto the vault pane.
    // This is the arm that reads the caller's keys rather than the callee's math.
    const writes: { el: Element; value: number }[] = [];
    installScrollTop((el, value) => writes.push({ el, value }));
    const { window: win, root } = harness();
    win.open();
    const region = root.querySelector('.bank-scroll') as HTMLElement;
    region.scrollTop = 41;
    root.scrollTop = 137;
    const vaultTab = root.querySelector<HTMLElement>('.bank-tab[data-tab="vault"]');
    expect(vaultTab, 'the vault tab must mount for a switch to be drivable').not.toBeNull();
    writes.length = 0;
    vaultTab?.click();
    expect(root.scrollTop, 'a new pane starts at the top').toBe(0);
    expect(
      writes.filter((w) => w.el === root && w.value === 0).length,
      'the window offset must be zeroed by a real write on a pane switch',
    ).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// (c) The stylesheet is held to the module's contract.
// ---------------------------------------------------------------------------

/** Strip CSS block comments, then brace-match from `from`. Comments come out
 *  FIRST: a brace inside prose would otherwise end the block early and every
 *  assertion below would be made against a truncated slice. */
function blockAt(css: string, from: number): string {
  const open = css.indexOf('{', from);
  if (open < 0) return '';
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}') {
      depth--;
      if (depth === 0) return css.slice(from, i + 1);
    }
  }
  return '';
}

const bare = mobileCss.replace(/\/\*[\s\S]*?\*\//g, '');

/** The phase 18 compact block: the one `@media (max-height: N)` block that
 *  carries the personal pane's `:has(.bank-footer)` scoping. Found by content
 *  rather than by ordinal, so inserting another short-phone block above it does
 *  not silently re-point every assertion at the wrong slice. */
const compactBlock = (() => {
  const marker = `@media (max-height: ${BANK_CHROME_COMPACT_MAX_HEIGHT}px)`;
  for (let at = bare.indexOf(marker); at >= 0; at = bare.indexOf(marker, at + 1)) {
    const block = blockAt(bare, at);
    if (block.includes(':has(.bank-footer)')) return block;
  }
  return '';
})();

/** One rule's declaration body, by exact selector text inside the compact block. */
function ruleBody(selector: string): string {
  const at = compactBlock.indexOf(selector);
  if (at < 0) return '';
  const open = compactBlock.indexOf('{', at);
  const close = compactBlock.indexOf('}', open);
  if (open < 0 || close < 0) return '';
  return compactBlock.slice(open + 1, close);
}

describe('the short-phone bank chrome block obeys bank_chrome_layout_core', () => {
  it('states the compact breakpoint as the SAME number the module exports', () => {
    // Two statements of one number drift silently; this is the only thing that
    // can notice. Guard the slice too, or a renamed marker would make every
    // assertion below trivially pass over an empty string.
    expect(compactBlock.length).toBeGreaterThan(0);
    expect(
      compactBlock.startsWith(`@media (max-height: ${BANK_CHROME_COMPACT_MAX_HEIGHT}px)`),
    ).toBe(true);
  });

  it('makes the window the scroller in BOTH the paired and the undocked state', () => {
    // The undocked state is real, not theoretical: Hud.onBagsClosed drops
    // body.bank-open on touch while the bank stays open. Both selectors must
    // carry the declaration, and a bare toContain over the whole block cannot
    // say so: the paired selector appears THREE times in here (the window rule,
    // the region rule, the search rule), so deleting it from the one that
    // matters would leave a substring check green. Assert through each rule's
    // own body instead.
    const undocked = ruleBody('body.mobile-touch #bank-window:has(.bank-footer),');
    expect(undocked.length, 'the undocked window rule must be found').toBeGreaterThan(0);
    expect(undocked).toContain('overflow-y: auto');
    const paired = ruleBody('body.mobile-touch.bank-open #bank-window:has(.bank-footer) {');
    expect(paired.length, 'the paired window rule must be found').toBeGreaterThan(0);
    expect(paired).toContain('overflow-y: auto');
  });

  it('declares NO touch-action on the window (the chip row pans horizontally inside it)', () => {
    // touch-action binds descendants. A pan-y here, copied from .bank-scroll,
    // would put every category chip out of reach on touch, which is the exact
    // failure this block exists to end.
    const rule = ruleBody('body.mobile-touch #bank-window:has(.bank-footer),');
    expect(rule.length).toBeGreaterThan(0);
    expect(rule).not.toContain('touch-action');
  });

  it('leaves exactly ONE vertical scroller by handing .bank-scroll back to the flow', () => {
    const region = ruleBody('body.mobile-touch #bank-window:has(.bank-footer) .bank-scroll,');
    expect(region).toContain('overflow: visible');
    expect(region).toContain('touch-action: auto');
  });

  it('pins the footer, and pins it against the INSET-aware bottom padding', () => {
    // A flat --window-pad would rest the footer under a landscape phone's home
    // indicator; the generic mobile window rule uses the same max() and this
    // mirrors it rather than guessing.
    const footer = ruleBody('body.mobile-touch #bank-window .bank-footer {');
    expect(footer).toContain('position: sticky');
    // A BOUNDARY, not toContain: `bottom: calc(...)` is a substring of
    // `margin-bottom: calc(...)` one line below, so the plain form passed with
    // the sticky inset flattened to 0. A mutation battery caught it; nothing
    // about the assertion looked wrong.
    expect(footer).toMatch(/(?:^|[;{\s])bottom:\s*calc\(-1 \* var\(--bank-footer-inset\)\)/);
    expect(footer).toContain('background: var(--panel-base)');
    expect(compactBlock).toContain(
      '--bank-footer-inset: max(var(--window-pad), calc(18px + env(safe-area-inset-bottom)))',
    );
    // The stacking context is load-bearing and nothing about position or
    // geometry would notice its loss: without it the grid scrolls OVER the
    // pinned band and the footer is present, correctly placed, and unreadable.
    expect(footer).toContain('z-index:');
    // ...and the scroll reserve, which is what stops a scrolled-to control
    // landing underneath it (tests/browser/bank_mobile_chrome measures it).
    const win = ruleBody('body.mobile-touch #bank-window:has(.bank-footer),');
    expect(win).toContain('scroll-padding-bottom');
    expect(win).toContain('scroll-padding-top');
  });

  it('keeps the footer LONGHANDS so the compression rule still owns its top edge', () => {
    // A margin/padding shorthand here would silently take the 3px top values the
    // block above sets, and nothing else would say so.
    const footer = ruleBody('body.mobile-touch #bank-window .bank-footer {');
    expect(footer).not.toMatch(/(^|;)\s*margin:/);
    expect(footer).not.toMatch(/(^|;)\s*padding:/);
    expect(footer).toContain('margin-bottom: calc(-1 * var(--bank-footer-inset))');
    expect(footer).toContain('padding-bottom: var(--bank-footer-inset)');
    // The HORIZONTAL pair is what makes the band span the full inner width, and
    // it was pinned by nothing: the negative margins pull the footer out over
    // the window's own --window-pad and the paddings put the content back, so
    // dropping either side leaves the opaque band inset with the grid visible
    // scrolling through the gutters beside the capacity meter. Both sides are
    // asserted because they are not interchangeable.
    expect(footer).toContain('margin-right: calc(-1 * var(--window-pad))');
    expect(footer).toContain('margin-left: calc(-1 * var(--window-pad))');
    expect(footer).toContain('padding-right: var(--window-pad)');
    expect(footer).toContain('padding-left: var(--window-pad)');
  });

  it('hides NOTHING it merely allowed to scroll', () => {
    // The rule the whole phase turns on: a band that may scroll must stay
    // reachable. Shedding a control is the failure, not a cheaper way to fit.
    //
    // ASSERTED OVER THE BLOCK, not per selector, and the reason is a vacuity a
    // review round caught. Four of the five scrolling bands carry NO rule of
    // their own in here, so ruleBody() answered the empty string and an empty
    // string satisfies .not.toMatch forever: the arm was a no-op for all but
    // .bank-scroll. What is actually true, and what is worth holding, is that
    // this block hides nothing AT ALL.
    const HIDING = /display:\s*none|visibility:\s*hidden/;
    expect(compactBlock.length, 'the compact block must be found').toBeGreaterThan(0);
    expect(compactBlock).not.toMatch(HIDING);
    // POSITIVE CONTROL: a negative assertion is only worth its matcher. If this
    // stops matching, the arm above is passing because the regex is broken, not
    // because the sheet is clean.
    expect(`${compactBlock}\n.x { display: none; }`).toMatch(HIDING);
    expect(`${compactBlock}\n.x { visibility: hidden; }`).toMatch(HIDING);
    // WHERE THE REST OF THIS CLAIM LIVES, said plainly rather than faked here.
    // Most of the scrolling bands carry no rule in this sheet at all, so nothing
    // textual can show they are REACHABLE; that is a geometry question and
    // tests/browser/bank_mobile_chrome.browser.test.ts answers it, walking every
    // control in a real browser and asserting a real box at the touch floor.
    // This arm's job is narrower and worth keeping separate: the compact block
    // sheds nothing.
  });

  it('keeps every PINNED band pinned, including the one layout.css already owned', () => {
    expect(BANK_PINNED_BAND_SELECTORS).toContain('.bank-footer');
    expect(BANK_PINNED_BAND_SELECTORS).toContain('.panel-title');
    // The two lists are a partition: a band cannot be both pinned and free to
    // scroll away, and the day one moves between them it must LEAVE the other.
    for (const selector of BANK_SCROLLING_BAND_SELECTORS) {
      expect(
        BANK_PINNED_BAND_SELECTORS as readonly string[],
        `${selector} cannot be both pinned and scrollable`,
      ).not.toContain(selector);
    }
    // .panel-title carries its sticky rule in the window shell and had no
    // scrollport to stick to until this block gave it one. If that rule ever
    // leaves, the title stops being pinned here and nothing else would notice.
    // Comment-stripped and brace-matched, like every other slice here: the span
    // form was tight only by accident of today's rule length.
    const bareLayout = layoutCss.replace(/\/\*[\s\S]*?\*\//g, '');
    const titleRule = blockAt(bareLayout, bareLayout.indexOf('.window > .panel-title'));
    expect(titleRule.length, 'the sticky title rule must be found').toBeGreaterThan(0);
    expect(titleRule).toContain('position: sticky');
  });

  it('drops the two grid-floor carve-outs the pinned footer replaced', () => {
    // Both were personal-pane only, and that pane no longer scrolls inside
    // .bank-scroll, so leaving them would be dead prose a later reader would
    // trust. NOT because those class names are unique (src/ui/vault_window.ts
    // builds a `bank-status vault-status` of its own, which a review round
    // caught this comment claiming otherwise): because the deleted selectors
    // were #bank-window-scoped AND the personal pane appends its status below
    // both the vault and guild early returns, so they could only ever fire on
    // the pane that no longer uses the inner scroller.
    expect(bare).not.toContain(':has(.bank-status) .bank-scroll');
    expect(bare).not.toContain(':has(.bank-rung-notice) .bank-scroll');
    // The GUILD pane still uses the inner scroller, so its floor stays.
    expect(bare).toMatch(/body\.mobile-touch #bank-window \.bank-scroll \{\s*min-height: 44px;/);
  });
});
