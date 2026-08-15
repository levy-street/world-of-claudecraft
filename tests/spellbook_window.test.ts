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

  it('keeps passive spellbook rows informational, without add or drag affordances', () => {
    expect(code).toContain('known && isAbilityActionBarEligible(def)');
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

describe('spellbook_window: the pinned Attack row', () => {
  it('renders the Attack row first, from the pure view attackOnBar state', () => {
    expect(code).toContain('this.appendAttackRow(list, view.attackOnBar)');
    expect(code.indexOf('this.appendAttackRow(list')).toBeLessThan(
      code.indexOf('for (const row of view.rows) this.appendRow(list, row)'),
    );
    // The Attack state reaches the view through the latch takeControlChange() fills at
    // the top of render(), not a second deps.attackOnBar() read (#2519).
    expect(code).toContain('attackOnBar: this.lastAttackOnBar');
    expect(code).toContain('const attackOnBar = this.deps.attackOnBar()');
  });

  it('reuses the existing Attack name/tooltip keys (no new player strings)', () => {
    expect(code).toContain("t('abilityUi.actionBar.attackName')");
    expect(code).toContain("t('abilityUi.actionBar.attackTooltip')");
    expect(code).toContain("iconDataUrl('ability', 'attack')");
  });

  it('routes the toggle through setAttackOnBar with aria-pressed state', () => {
    expect(code).toContain('this.deps.setAttackOnBar(!this.deps.attackOnBar())');
    expect(code).toContain("toggle.dataset.attackToggle = '1'");
  });

  it('keeps the per-frame refresh syncing the Attack toggle (options can flip it)', () => {
    // The ref is COLLECTED as appendAttackRow builds the button, not re-found by its
    // marker on every frame (#2519). The behavior is driven in
    // tests/spellbook_tick_repaint.test.ts.
    //
    // The `data-attack-toggle` marker stays, and its remaining readers are worth naming
    // because none of them is in src/: the styling keys off the `.spell-hotbar-toggle`
    // CLASS, and the drag path carries HOTBAR_ATTACK_MIME on the row, so after this
    // change the marker is read only by scripts/spellbook_attack_shot.mjs (the Attack-row
    // screenshot probe) and by the tests/spellbook_tick_repaint.test.ts harness. Both
    // break silently if the dataset write is removed as dead.
    expect(code).toContain('this.attackToggle = toggle');
    expect(code).toContain('const attackBtn = this.attackToggle');
    expect(code).toContain("attackBtn.setAttribute('aria-pressed'");
  });
});

describe('spellbook_window: the Attack row is draggable onto the action bar', () => {
  it('marks the Attack row draggable, like an ability row', () => {
    // The row previously offered only the +/- toggle, so a player dragging Attack
    // (the natural gesture other spells support) got nothing. It now drags too.
    const attackStart = code.indexOf('private appendAttackRow(');
    const attackRow = code.slice(attackStart, code.indexOf('private appendRow(', attackStart));
    expect(attackRow).toContain('el.draggable = true');
  });

  it('writes the dedicated Attack marker MIME on dragstart (not an encoded action)', () => {
    // Attack has no ability/item id, so it cannot ride the HotbarAction path; the
    // dragstart carries the marker MIME the action bar recognizes.
    const attackStart = code.indexOf('private appendAttackRow(');
    const attackRow = code.slice(attackStart, code.indexOf('private appendRow(', attackStart));
    expect(attackRow).toContain('HOTBAR_ATTACK_MIME');
    expect(attackRow).toMatch(/dragstart/);
  });
});

describe('spellbook_window: mobile action-ring page label (Phase 4, touch-only)', () => {
  it('feeds the per-slot ability ids through to the pure view core', () => {
    // Derived from the bar's live slot array at render time rather than taken as its own
    // allocating dep, since the per-frame change check walks the same array (#2519).
    expect(code).toContain('abilityIdByBarSlot: this.lastSlotIds');
    expect(code).toContain('this.lastSlotIds.push(slotAbilityId(action))');
    expect(code).toMatch(/slotAbilityId\(action: HotbarAction\): string \| null/);
  });

  it('takes the bar as Hud LIVE slot array, with no copy in between', () => {
    // The per-frame change check walks whatever this dep returns, so a defensive copy on
    // the Hud side would put a fresh 33-element array back on every frame the window is
    // open, which is the allocation #2519 removed. Nothing behavioral can see that (a copy
    // compares equal), so the wiring is pinned here.
    //
    // Scoped to the spellbook's own deps bag rather than the whole of hud.ts: the negative
    // half would otherwise fire on any UNRELATED window that happens to take a dep by one
    // of these names.
    const bagStart = hud.indexOf('new SpellbookWindow({');
    expect(bagStart, 'the spellbook deps bag moved or was renamed').toBeGreaterThan(-1);
    const bag = hud.slice(bagStart, hud.indexOf('  });', bagStart));
    expect(bag).toContain('barActions: () => this.hotbarActions');
    expect(bag, 'the two allocating derived bar deps should be gone').not.toContain(
      'barAbilityIds',
    );
    expect(bag).not.toContain('abilityIdByBarSlot');
  });

  it('gates the page label on both a non-null mobilePage AND touch mode', () => {
    expect(code).toContain('row.mobilePage !== null');
    expect(code).toContain("document.body.classList.contains('mobile-touch')");
  });

  it('renders the label through t() with the localized page-label key', () => {
    expect(code).toContain("t('hudChrome.mobile.spellbookPageLabel'");
  });

  it('converts the zero-indexed view page to a one-indexed user-facing label', () => {
    expect(code).toContain('page: this.formatAbilityNumber(row.mobilePage + 1)');
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
    // on a resolved-numbers change, else falls back to the gated toggle refresh.
    expect(hud).toContain('if (this.spellbookWindow.isOpen) this.spellbookWindow.tickOpen();');
  });

  it('gates the per-frame fall-through behind its own change check (#2519)', () => {
    // The fall-through used to repaint unconditionally. Both entry points survive and
    // are different contracts: tickOpen takes the gated one, and Hud keeps the forced
    // one for the bar changes it makes itself (the login layout restore, reset-form-bar).
    // What either one DOES is driven in tests/spellbook_tick_repaint.test.ts; these two
    // pins only keep the per-frame call site pointed at the gated variant.
    expect(code).toContain('this.refreshHotbarControlsIfChanged()');
    expect(code).toContain('if (!this.takeControlChange()) return');
    expect(hud).toContain('this.spellbookWindow.refreshHotbarControls();');
    // The change check walks the slot array IN PLACE. A derived list here would allocate on
    // every frame the window is open, and no behavioral test can see it (the derived list
    // compares the same), so the shape is pinned: an index loop over `actions`, no map /
    // filter / spread.
    expect(code).toContain('for (let i = 0; i < actions.length; i++)');
    const movedStart = code.indexOf('private controlsMoved(');
    const movedBody = code.slice(
      movedStart,
      code.indexOf('private paintHotbarControls(', movedStart),
    );
    expect(movedStart, 'controlsMoved went missing').toBeGreaterThan(-1);
    for (const alloc of ['.map(', '.filter(', '.flatMap(', '.concat(', 'new Set(', '...']) {
      expect(movedBody, `controlsMoved allocates via ${alloc}`).not.toContain(alloc);
    }
  });

  it('keeps the in-place refresh updating the aria-pressed + disabled state per toggle', () => {
    // The call-site guard above proves the refresh fires; this pins what it WRITES.
    // paintHotbarControls keys off `btn` (vs appendRow's `toggle`), so the row
    // guard does not cover this path: without these, the open spellbook's toggles
    // would stop tracking the bar (the whole reason this path is not-cold).
    expect(code).toContain("btn.setAttribute('aria-pressed'");
    expect(code).toContain('const disabled = !onBar && !hasFree');
    expect(code).toContain('if (btn.disabled !== disabled) btn.disabled = disabled');
  });

  it('elides the toggle writes to on-bar flips only, per row', () => {
    // A repaint fires when any of the three bar inputs moves, so the +/- text, the
    // remove class, the aria-pressed, and the i18n-backed aria-label are gated on an
    // actual on-bar membership flip (read from aria-pressed, which appendRow seeds),
    // not rewritten for every row. A revert to unconditional writes drops this guard.
    expect(code).toContain("(btn.getAttribute('aria-pressed') === 'true') !== onBar");
  });
});

describe('spellbook_window: tooltip/summary reflect talent changes (tooltip parity)', () => {
  it('re-renders the open window only when a resolved ability number changed', () => {
    // tickOpen compares the CONTENT of world.known (id/rank/cost/cast/cooldown), not
    // its array identity: the online mirror rebuilds that array every snapshot, so
    // reference equality would rebuild the DOM every frame. A real change (e.g. a
    // talent dropping Wicked Slash cost 45 -> 40) rebuilds the row summaries; an
    // unchanged frame falls through to the gated toggle refresh.
    expect(code).toContain('tickOpen()');
    expect(code).toContain('if (this.knownChanged(this.deps.world().known)) {');
    expect(code).toContain('this.captureKnown(world.known)');
    // The comparison carries every number a row summary paints, so a cost/cooldown
    // change flips it (a bare id/rank check would miss a same-rank talent cost cut).
    // Field-by-field on purpose (#2519): the joined signature string this replaced
    // was rebuilt on every frame the window was open.
    for (const field of ['k.rank', 'k.cost', 'k.castTime', 'k.cooldown']) {
      expect(code, `knownChanged stopped comparing ${field}`).toContain(`${field} !== this.known`);
    }
    expect(code).toContain('k.def.id !== this.knownIds[i]');
    expect(code).toContain('this.knownNums.push(k.rank, k.cost, k.castTime, k.cooldown)');
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
