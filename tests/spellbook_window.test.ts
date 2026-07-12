// WCAG-chrome + no-magic source guard for the spellbook window DOM painter.
//
// The painter's DOM methods need a document, so they are not exercised in this Node
// suite; the pure decisions it renders are covered by tests/spellbook_view.test.ts.
// This guard pins the a11y-bearing markup (real close button + listitem rows +
// toggle aria-pressed + focus-return) and the no-magic-values contract (no literal
// colors in TS), plus the hud.update() refresh call site.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const src = readFileSync(new URL('../src/ui/spellbook_window.ts', import.meta.url), 'utf8');
const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const hud = readFileSync(new URL('../src/ui/hud.ts', import.meta.url), 'utf8');
const mobileCss = readFileSync(new URL('../src/styles/hud.mobile.css', import.meta.url), 'utf8');
const componentsCss = readFileSync(
  new URL('../src/styles/components.css', import.meta.url),
  'utf8',
);
const hudChromeCatalog = readFileSync(
  new URL('../src/ui/i18n.catalog/hud_chrome.ts', import.meta.url),
  'utf8',
);

describe('spellbook_window: WCAG chrome (rows + toggles + focus-return)', () => {
  it('drives the panel from the pure view core', () => {
    expect(code).toContain('buildSpellbookView(');
  });

  it('gives the close control a real button with an aria-label', () => {
    expect(code).toContain('class="x-btn" data-close aria-label=');
    expect(code).toContain("t('abilityUi.spellbook.close')");
  });

  it('renders the dialog role + the spell list role', () => {
    // the dialog identity is set via the shared markDialogRoot helper (its own writes
    // are unit-tested in dialog_root.test.ts); the spell list/listitem roles stay inline.
    expect(code).toContain("markDialogRoot(el, { label: t('abilityUi.spellbook.title') })");
    expect(code).toContain("list.setAttribute('role', 'list')");
    expect(code).toContain("setAttribute('role', 'listitem')");
  });

  it('renders the hotbar toggle as a button with aria-pressed state', () => {
    expect(code).toMatch(/toggle\.className = [`']spell-hotbar-toggle/);
    expect(code).toContain("toggle.setAttribute('aria-pressed'");
    expect(code).toContain('this.deps.removeFromBar(id)');
    expect(code).toContain('this.deps.addToBar(id)');
  });

  it('keeps the reset-bar button gated on the form-bars flag', () => {
    expect(code).toContain('const resetBtnHtml = view.hasFormBars');
    expect(code).toContain('data-reset-bar');
    expect(code).toContain("t('abilityUi.spellbook.resetBar')");
  });

  it('captures + restores the opener focus on open/close (WCAG 2.2 AA focus-return)', () => {
    expect(code).toContain('this.openerFocus = this.deps.captureFocus()');
    expect(code).toContain('this.deps.restoreFocus(this.openerFocus)');
  });

  it('captures the opener BEFORE closing other windows (order is load-bearing)', () => {
    // A sibling window's own focus-return on close must not clobber the opener we
    // restore to, so the capture has to happen before closeOthers(). Both calls
    // appear exactly once (in toggle()), so the order check is unambiguous.
    expect(code.indexOf('this.openerFocus = this.deps.captureFocus()')).toBeLessThan(
      code.indexOf('this.deps.closeOthers()'),
    );
  });
});

describe('spellbook_window: inline mobile slot picker', () => {
  it('feeds abilityIdByBarSlot through to the pure view core', () => {
    expect(code).toContain('abilityIdByBarSlot: this.deps.abilityIdByBarSlot()');
  });

  it('renders exact equipped chips and a separate Remove control only for touch', () => {
    expect(code).toContain('this.isTouch()');
    expect(code).toContain('spell-assignment-chip');
    expect(code).toContain('spell-hotbar-remove');
    expect(code).toContain('row.assignment.kind');
    expect(hudChromeCatalog).toContain("mobileChip: '{page} - A{position}'");
  });

  it('renders four ARIA tabs and five destination buttons from the pure picker model', () => {
    expect(code).toContain('buildMobileSpellbookPicker({');
    expect(code).toContain("setAttribute('role', 'tablist')");
    expect(code).toContain("setAttribute('role', 'tab')");
    expect(code).toContain("setAttribute('aria-selected'");
    expect(code).toContain("setAttribute('role', 'group')");
    expect(code).toContain('spell-slot-destination');
    expect(code).toContain("setAttribute('aria-current', 'true')");
  });

  it('renders the picker close action as an icon with an accessible name', () => {
    expect(code).toContain(
      "close.setAttribute('aria-label', t('hudChrome.spellbook.closePicker'))",
    );
    expect(code).toContain("close.innerHTML = svgIcon('close')");
    expect(code).not.toContain("close.textContent = t('hudChrome.spellbook.closePicker')");
  });

  it('owns picker keyboard navigation, assignment announcement, and focus return', () => {
    expect(code).toContain('nextMobileSpellbookPickerPage(');
    expect(code).toContain("key === 'Enter' || key === ' '");
    expect(code).toContain("status.setAttribute('aria-live', 'polite')");
    expect(code).toContain('focusDestinationIndex');
    expect(code).toContain('this.focusPickerOpener()');
    expect(code).toContain("status.className = 'spell-assignment-status'");
    expect(code).toContain('this.rerenderPreservingView();');
    expect(code).toContain("querySelector<HTMLElement>('.spell-assignment-status')");
  });

  it('preserves semantic touch-control focus across hotbar refreshes', () => {
    expect(code).toContain("active.classList.contains('spell-assignment-chip')");
    expect(code).toContain("active.classList.contains('spell-hotbar-remove')");
    expect(code).toContain("active.classList.contains('spell-hotbar-add')");
    expect(code).toContain("active.classList.contains('spell-slot-destination')");
    expect(code).toContain("active.getAttribute('role') === 'tab'");
    expect(code).toContain("refocus ??= '[data-close]'");
  });

  it('exposes a picker-first close seam without closing the Spellbook', () => {
    expect(code).toContain('closePicker(): boolean');
    expect(code).toContain('if (!this.pickerAbilityId) return false');
    expect(code).toContain('return true');
  });

  it('suppresses ability descriptions while the mobile slot picker is open', () => {
    expect(code).toContain('this.deps.hideTooltip();');
    expect(code).toContain('() => this.pickerAbilityId === null');
    expect(hud).toContain('if (enabled && !enabled())');
    expect(hud).toContain(
      'attachTooltip: (el, html, enabled, directFocusOnly) =>\n      this.attachTooltip(el, html, enabled, directFocusOnly)',
    );
  });

  it('does not show the row description when focus returns to Add, Remove, or its chip', () => {
    expect(code).toContain('() => !this.suppressDescriptionOnRefocus,\n        true,');
    expect(code).toContain(
      '() => this.pickerAbilityId === null && !this.suppressDescriptionOnRefocus,\n          true,',
    );
    expect(hud).toContain('if (directFocusOnly && event.target !== el) return;');
  });

  it('keeps the whole touch controls strip a description dead zone', () => {
    // Both the pointerdown AND the bubbling synthesized click stop at the strip,
    // so a tap on or around the Add/assignment/Remove buttons can never reach
    // the row's touch-tap description trigger (the real-device regression).
    expect(code).toContain("controls.addEventListener('pointerdown', dismissDescription)");
    expect(code).toContain("controls.addEventListener('click', dismissDescription)");
    expect(code).not.toContain("controls.addEventListener('click', dismissDescription, true)");
    expect(code).toContain('event.stopPropagation();');
    expect(code).toContain('this.deps.hideTooltip()');
  });

  it('attaches a guarded ability-description tooltip to touch Spellbook rows', () => {
    expect(code).toContain('this.deps.attachTooltip(');
    expect(code).toContain('() => this.deps.abilityTooltip(known)');
    expect(code).toContain('() => this.pickerAbilityId === null');
  });

  it('shows a description when the picker is closed and the touch row itself is tapped', () => {
    expect(code).toContain('const showDescription = this.deps.attachTooltip(');
    expect(code).toContain('bindTouchTap(el, () => {');
    expect(code).toContain('if (this.pickerAbilityId !== null) return');
    expect(code).toContain(
      'showDescription(controls ? controls.getBoundingClientRect().left : undefined)',
    );
  });

  it('clamps a boundary-passed description left of the touch controls column', () => {
    // The spellbook passes the strip's left edge; the shared hud show clamps
    // the tooltip's right edge to it (pulling left only, floored at 8px).
    expect(code).toContain("el.querySelector<HTMLElement>('.spell-touch-controls')");
    expect(hud).toContain('const showNearElement = (maxRightX?: number) => {');
    expect(hud).toContain('const clamped = Math.max(8, bound / z - ttW - 6);');
  });

  it('does not add a persistent selected/focused state to touch spell rows', () => {
    expect(code).not.toContain('touch-selected');
    expect(code).not.toContain('showAbilityDescription');
    expect(mobileCss).toMatch(
      /body\.mobile-touch #spellbook \.spell-row:hover\s*\{[^}]*background:\s*transparent/s,
    );
  });

  it('cancels the shared touch-tooltip hold when the finger starts scrolling', () => {
    expect(hud).toContain("el.addEventListener('pointermove', (e) => {");
    expect(hud).toContain('Math.hypot(e.clientX - touchStartX, e.clientY - touchStartY)');
    expect(hud).toContain('if (touchMoved) clearTouchTimer()');
  });

  it('marks the Spellbook while the slot picker is open so inline descriptions stay hidden', () => {
    expect(code).toContain("classList.add('spell-slot-picker-open')");
    expect(code).toContain("classList.remove('spell-slot-picker-open')");
    expect(mobileCss).toMatch(
      /#spellbook\.spell-slot-picker-open \.spell-sub\s*\{[^}]*display:\s*none/,
    );
  });

  it('keeps title and picker fixed while only the mobile spell list scrolls', () => {
    expect(code).toContain('root.scrollTop = 0;');
    expect(mobileCss).toMatch(
      /#spellbook\.spell-slot-picker-open\s*\{[^}]*overflow-y:\s*hidden[^}]*display:\s*flex\s*!important/s,
    );
    expect(mobileCss).toMatch(
      /#spellbook\.spell-slot-picker-open \.spell-list\s*\{[^}]*overflow-y:\s*auto/s,
    );
    expect(mobileCss).toMatch(
      /#spellbook\.spell-slot-picker-open > \.panel-title\s*\{[^}]*position:\s*relative[^}]*top:\s*0/s,
    );
    expect(mobileCss).toMatch(
      /#spellbook\.spell-slot-picker-open > \.panel-title\s*\{[^}]*margin-bottom:\s*0/s,
    );
    expect(mobileCss).toMatch(/#spellbook \.spell-slot-picker\s*\{[^}]*padding:\s*0 8px 8px/s);
  });

  it('shrinks picker controls to the touch floor then scrolls them in one row', () => {
    expect(mobileCss).toContain('container-type: inline-size;');
    expect(mobileCss).toContain(
      '--spell-picker-control-size: clamp(40px, calc((100cqw - 60px) / 10), 48px);',
    );
    expect(mobileCss).toMatch(
      /#spellbook \.spell-slot-picker\s*\{[^}]*display:\s*flex[^}]*overflow-x:\s*auto[^}]*touch-action:\s*pan-x/s,
    );
    expect(code).toContain("button.classList.toggle('has-occupant', !!destination.occupant)");
    expect(code).toContain('class="spell-slot-label"');
    expect(mobileCss).toMatch(
      /#spellbook \.spell-slot-destination\.has-occupant \.spell-slot-label\s*\{[^}]*display:\s*none/s,
    );
  });

  it('keeps the mobile Spellbook close control below the window top edge', () => {
    expect(mobileCss).not.toMatch(
      /#spellbook > \.panel-title > \.panel-title-actions\s*\{[^}]*top:/s,
    );
  });

  it('uses compact symbols and no redundant equipped check in touch controls', () => {
    expect(code).toContain("add.textContent = '+'");
    expect(code).toContain("remove.innerHTML = svgIcon('close')");
    expect(code).toContain('chip.textContent = label');
    expect(code).not.toContain('spell-equipped-check');
    expect(mobileCss).toMatch(
      /#spellbook \.spell-hotbar-remove\s*\{[^}]*width:\s*40px[^}]*height:\s*40px[^}]*padding:\s*0/s,
    );
  });

  it('uses shared mobile chrome for Add, Remove, and assignment chips', () => {
    expect(mobileCss).toMatch(
      /#spellbook \.spell-hotbar-toggle,\s*body\.mobile-touch #spellbook \.spell-hotbar-remove,\s*body\.mobile-touch #spellbook \.spell-assignment-chip\s*\{[^}]*border:\s*2px[^}]*border-radius:\s*7px[^}]*background:\s*radial-gradient[^}]*font:\s*700 14px \/ 1 var\(--ui-font\)/s,
    );
  });

  it('drives the compact spellbook edges through the shared window pad', () => {
    expect(mobileCss).toMatch(
      /body\.mobile-touch #spellbook\s*\{[^}]*--spellbook-edge-padding:\s*8px;[^}]*--window-pad:\s*var\(--spellbook-edge-padding\)/s,
    );
    // No direct padding override: the top edge follows --window-pad (which the
    // sticky header's negative margins mirror, so the title plate stays inside
    // the frame), and the bottom edge keeps the generic mobile .window
    // scroll-end reservation (18px plus safe area) as the visible gap.
    const block = mobileCss.match(/body\.mobile-touch #spellbook\s*\{[^}]*\}/s)?.[0] ?? '';
    expect(block).not.toBe('');
    expect(block).not.toContain('padding-top:');
    expect(block).not.toContain('padding-bottom:');
    expect(mobileCss).toMatch(
      /body\.mobile-touch #spellbook > \.panel-title\s*\{[^}]*margin-top:\s*0/s,
    );
  });

  it('keeps the header a floating plate inside the frame, X aligned with rows', () => {
    // No negative inline margins: the plate must not paint over the beveled
    // inner hairline on either side. With the plate at --window-pad, a 4px
    // actions inset matches the rows' 4px inner right padding.
    expect(mobileCss).toMatch(
      /body\.mobile-touch #spellbook > \.panel-title\s*\{[^}]*margin-top:\s*0;[^}]*margin-inline:\s*0/s,
    );
    expect(mobileCss).toMatch(
      /body\.mobile-touch #spellbook > \.panel-title > \.panel-title-actions\s*\{[^}]*inset-inline-end:\s*4px/s,
    );
  });

  it('never freezes or resizes inset-pinned windows on the touch layout', () => {
    // The drag/resize seed writes inline left/top with bottom:auto, which
    // unpins a top+bottom sheet and leaves it content-tall (offscreen and
    // unscrollable). Both entry points bail on body.mobile-touch.
    expect(hud).toContain('// draggable on touch, the same hazard placeNewWindow already guards.');
    expect(hud).toContain("if (document.body.classList.contains('mobile-touch')) return;");
    const windowResize = readFileSync(
      new URL('../src/ui/window_resize.ts', import.meta.url),
      'utf8',
    );
    expect(windowResize).toContain('if (deps.isTouchLayout?.()) return null;');
  });

  it('keeps a focus-driven reshow clamped to the last passed boundary', () => {
    expect(hud).toContain('let lastMaxRight: number | undefined;');
    expect(hud).toContain('if (maxRightX !== undefined) lastMaxRight = maxRightX;');
    expect(hud).toContain('const clamped = Math.max(8, bound / z - ttW - 6);');
  });

  it('keeps the touch-selected row seat readable on the panel gradient', () => {
    // The gradient bottoms out at the same color as the seat fill, so the
    // gold-dim inset ring is what makes the selection visible.
    expect(componentsCss).toMatch(
      /\.spell-row\.is-selected\s*\{[^}]*background:\s*var\(--color-bg-dark\);[^}]*box-shadow:\s*inset 0 0 0 1px var\(--gold-dim\)/s,
    );
  });

  it('lets the mobile Spellbook cover the player-frame reservation', () => {
    expect(mobileCss).toMatch(
      /body\.mobile-touch #spellbook\s*\{[^}]*top:\s*max\(4px, env\(safe-area-inset-top\)\)[^}]*bottom:\s*max\(4px, env\(safe-area-inset-bottom\)\)[^}]*height:\s*auto;[^}]*max-height:\s*none/s,
    );
    expect(mobileCss).toMatch(/#spellbook\.spell-slot-picker-open\s*\{[^}]*height:\s*auto;/s);
    expect(mobileCss).not.toMatch(
      /#spellbook(?:\.spell-slot-picker-open)?\s*\{[^}]*height:[^;}]*!important/s,
    );
  });
});

describe('spellbook_window: no magic values (DOM painter)', () => {
  it('carries no literal hex or rgb color in TS (colors live in the stylesheet)', () => {
    const hex = code.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
    const rgb = code.match(/\brgba?\s*\(/g) ?? [];
    expect(hex, `hex colors: ${hex.join(', ')}`).toEqual([]);
    expect(rgb, `rgb colors: ${rgb.join(', ')}`).toEqual([]);
  });

  it('carries no literal em dash in source', () => {
    expect(src.includes('—'), 'em dash found').toBe(false);
  });
});

describe('spellbook_window: hud.update() refresh call site', () => {
  it('drives the open spellbook from hud.update() through tickOpen while displayed', () => {
    // Pin the hud.ts call site so a refactor cannot silently stop the open
    // spellbook from tracking action-bar AND talent changes. tickOpen re-renders
    // on a resolved-numbers change, else falls back to the cheap toggle refresh.
    expect(hud).toContain('if (this.spellbookWindow.isOpen) this.spellbookWindow.tickOpen();');
  });

  it('keeps the in-place refresh updating the aria-pressed + disabled state per toggle', () => {
    // The call-site guard above proves the refresh fires; this pins what it WRITES.
    // refreshHotbarControls keys off `btn` (vs appendRow's `toggle`), so the row
    // guard does not cover this path: without these, the open spellbook's toggles
    // would stop tracking the bar (the whole reason this path is not-cold).
    expect(code).toContain("btn.setAttribute('aria-pressed'");
    expect(code).toContain('btn.disabled = !this.isTouch() && !onBar && !hasFree');
  });

  it('elides the per-frame toggle writes to on-bar flips only (this runs every frame)', () => {
    // refreshHotbarControls fires on EVERY animation frame while the window is open, so
    // the +/- text, the remove class, the aria-pressed, and the i18n-backed aria-label
    // are gated on an actual on-bar membership flip (read from aria-pressed, which
    // appendRow seeds), not rewritten unconditionally. Only `disabled` stays per-frame
    // (it depends on hasFree). A revert to unconditional writes drops this guard.
    expect(code).toContain("(btn.getAttribute('aria-pressed') === 'true') !== onBar");
  });
});

describe('spellbook_window: tooltip/summary reflect talent changes (tooltip parity)', () => {
  it('re-renders the open window only when a resolved ability number changed', () => {
    // tickOpen compares a content signature (id/rank/cost/cast/cooldown) of
    // world.known, not its array identity: the online mirror rebuilds that array
    // every snapshot, so reference equality would rebuild the DOM every frame. A
    // real change (e.g. a talent dropping Wicked Slash cost 45 -> 40) rebuilds the
    // row summaries; an unchanged frame falls back to the cheap toggle refresh.
    expect(code).toContain('tickOpen()');
    expect(code).toContain(
      'SpellbookWindow.knownSig(this.deps.world().known) !== this.lastKnownSig',
    );
    expect(code).toContain('this.lastKnownSig = SpellbookWindow.knownSig(world.known)');
    // the signature carries the numbers a row summary paints, so a cost/cooldown
    // change flips it (a bare id:rank would miss a same-rank talent cost cut).
    expect(code).toMatch(/knownSig[\s\S]*k\.def\.id.*k\.rank.*k\.cost.*k\.castTime.*k\.cooldown/);
  });

  it('preserves scroll position and keyboard focus across the talent-driven rebuild', () => {
    // render() rebuilds the list via innerHTML and the window root is the scroll
    // container, so the rebuild must restore scrollTop and refocus the row/toggle
    // the user was on (by ability id), or a talent change would jump the list to
    // the top and drop focus (a WCAG focus-loss regression).
    expect(code).toContain('rerenderPreservingView()');
    expect(code).toContain('const scrollTop = root.scrollTop');
    expect(code).toContain('root.scrollTop = scrollTop');
    expect(code).toContain('el.dataset.abilityId = row.abilityId');
    expect(code).toContain('(root.querySelector(refocus) as HTMLElement | null)?.focus()');
  });

  it('resolves each row tooltip LIVE at hover, not the render-time capture', () => {
    // A talent allocated while the spellbook is open reassigns world.known with a
    // new cost/damage; the hover tooltip must reflect it even before the next
    // tickOpen rebuild lands, so it resolves the ability fresh by id.
    expect(code).toContain(
      'this.deps.world().known.find((k) => k.def.id === known.def.id) ?? known',
    );
  });
});
