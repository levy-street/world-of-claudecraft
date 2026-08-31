// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { InvSlot } from '../src/sim/types';
import { BagsWindow, type BagsWindowDeps } from '../src/ui/bags_window';
import { ItemDragState } from '../src/ui/item_drag_state';
import type { IWorld } from '../src/world_api';

// Source-level guards for the bags painter. The pure click/tooltip/grid decisions are
// unit-tested in bags_view.test.ts; here we pin the no-magic-values
// contract (no raw hex; the unranked-quality fallback is a token) plus the two
// load-bearing behaviors: reusing bag_filter via buildBagGrid (not re-deriving the
// filter) and preserving the .bag-grid scroll offset across a rebuild.
//
// The DOM environment is for the one arm a source pin cannot decide (the socket
// aria-label's materials variant, below). Under a DOM env import.meta.url is an
// http URL that readFileSync rejects, so every source read resolves from
// __dirname instead (the vendor_window_painter.test.ts idiom).
const source = (relPath: string): string => readFileSync(join(__dirname, '..', relPath), 'utf8');

// Blank out comments while preserving line structure, so a comment quoting a call
// shape can neither satisfy a positive pin nor trip a negative one. Block comments
// go FIRST (a JSDoc block quoting a call is otherwise left whole by a line-comment
// pass), then line comments INCLUDING trailing ones; the [^:] guard keeps a '://'
// in a URL from being read as a line comment. The stripComments precedent lives in
// tests/pool_wiring_pins.test.ts and tests/architecture.test.ts.
const stripComments = (src: string): string =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

// The REAL BagsWindow driven against a DOM container (the
// tests/bags_window_use_routing.test.ts fixture idiom), for the arms that have to
// read what the painter actually rendered rather than what its source says.
// The harness form also records every attachTooltip call (the phase 08 counter
// arms read the lazily built html off the recorded builder) and takes the
// carried inventory + summed capacity for the bag-bar counter fixtures.
function renderBagsHarness(
  bags: (string | null)[],
  inventory: InvSlot[] = [],
  bagCapacity = 16,
): {
  root: HTMLElement;
  tooltips: { el: HTMLElement; html: () => string }[];
  window: BagsWindow;
} {
  document.body.innerHTML = '';
  const world = { inventory, bags, bagCapacity, copper: 0 } as unknown as IWorld;
  const root = document.createElement('div');
  document.body.appendChild(root);
  const noop = (): void => {};
  const tooltips: { el: HTMLElement; html: () => string }[] = [];
  const deps: BagsWindowDeps = {
    itemIcon: () => '<span class="item-icon"></span>',
    moneyHtml: () => '',
    itemTooltip: () => '',
    attachTooltip: (el, html) => tooltips.push({ el, html }),
    root: () => root,
    world: () => world,
    wocBalanceHtml: () => '',
    claudiumLauncherHtml: () => '',
    openClaudium: noop,
    openWallet: noop,
    hideTooltip: noop,
    consumePeek: () => false,
    cancelPetFeed: noop,
    captureFocus: () => null,
    restoreFocus: noop,
    renderCharIfOpen: noop,
    vendorOpen: () => false,
    tradeOpen: () => false,
    isMarketSell: () => false,
    isMailAttach: () => false,
    isBankOpen: () => false,
    isPersonalBankTab: () => false,
    isGuildBankTab: () => false,
    isVaultBankTab: () => false,
    confirmVendorSell: () => true,
    pendingPetFeed: () => false,
    closeVendor: noop,
    closeBank: noop,
    onClosed: noop,
    addItemToTrade: noop,
    stageMarketSell: noop,
    stageMailParcel: noop,
    insertItemChatLink: noop,
    showError: noop,
    setPendingPetFeed: noop,
    resetPetBarSig: noop,
    isHotbarItemId: () => false,
    useGatherTool: () => false,
    setDragAction: noop,
    clearActionDropTargets: noop,
    dragState: new ItemDragState(),
    isTouchHud: () => false,
    markEquipDropTargets: noop,
    dropOnEquipSlot: noop,
    dropOnActionSlot: noop,
    dropOnActionRingSlot: noop,
    openItemActionMenu: noop,
  };
  const win = new BagsWindow(deps);
  win.render();
  return { root, tooltips, window: win };
}

function renderBags(bags: (string | null)[]): HTMLElement {
  return renderBagsHarness(bags).root;
}

const painter = source('src/ui/bags_window.ts');
const view = source('src/ui/bags_view.ts');
const promptDialog = source('src/ui/prompt_dialog.ts');
const tokens = source('src/styles/tokens.css');
const hud = source('src/ui/hud.ts');
const components = source('src/styles/components.css');

describe('bags_window: no magic values', () => {
  it('carries no literal hex color in TS (quality color comes from QUALITY_COLOR + a token)', () => {
    // Issue references in comments (#2343) match the hex shape, so the scan
    // runs on comment-stripped source: a hex COLOR only matters in live code.
    const code = stripComments(painter);
    const hex = code.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
    expect(hex, `hex colors must move to tokens: ${hex.join(', ')}`).toEqual([]);
  });

  it('uses the --color-quality-default token for the unranked-quality fallback', () => {
    expect(painter).toContain('var(--color-quality-default)');
  });

  it('defines --color-quality-default in the design-token sheet', () => {
    expect(tokens).toContain('--color-quality-default:');
  });

  it('uses no em or en dashes (ASCII separators only)', () => {
    expect(painter.includes('—'), 'em dash found').toBe(false);
    expect(painter.includes('–'), 'en dash found').toBe(false);
  });
});

describe('bags_window: accessibility contract', () => {
  // Bags rides alongside vendor / trade / market (a non-modal companion window,
  // per close()'s own comment), so it must NOT gain a focus trap here: it only
  // needs the same role=dialog + accessible name every other window family
  // member gets via markDialogRoot (mirrors bank_window.ts, which already calls
  // this with its own title key).
  it('marks the window as a dialog root with the bags title as its accessible name', () => {
    expect(painter).toContain("markDialogRoot(el, { label: t('itemUi.bags.title') });");
  });

  it('does not install a focus trap (no modal:true) on the non-modal bags root', () => {
    expect(painter).not.toMatch(/markDialogRoot\([^)]*modal:\s*true/);
  });
});

describe('bags_window: load-bearing behaviors preserved', () => {
  it('uses the branded Claudium icon and matching balance color', () => {
    expect(hud).toContain('src="/claudium/icons/claudium_coin_64.webp"');
    expect(components).toMatch(/\.claudium-launcher\s*\{[^}]*color:\s*#9eeeff;/s);
  });

  it('reuses bag_filter via buildBagGrid (does not re-derive the filter)', () => {
    expect(painter).toContain('buildBagGrid(');
    // the filter/sort stays in bag_filter.ts; the painter must not call it directly
    expect(painter).not.toContain('applyBagFilter(');
  });

  it('wires Phase 3 findability chrome from pure cores (count, empty copy, list rows)', () => {
    // Count badge, empty Quest copy, and soft section rows come from pure
    // helpers; the painter only maps results to DOM. Do not re-derive kind
    // counts or section rules inline.
    expect(painter).toContain('bagQuestItemCount(');
    expect(painter).toContain('bagNoMatchKind(');
    expect(painter).toContain('buildBagListRows(');
    expect(painter).toContain('hudChrome.bags.noQuestItems');
    expect(painter).toContain('hudChrome.bags.filterQuestCountAria');
    expect(painter).toContain('bag-chip-count');
    expect(painter).toContain('bag-section-header');
    // Badge only when N > 0 (state.md metric lock): presence of bag-chip-count
    // alone still passes if zero is painted; pin the gate next to the badge.
    expect(painter).toMatch(/questCount\s*>\s*0/);
    // Warm empty copy association: inverting the ternary keeps bare toContain
    // green; pin both arms as literals so quest maps to noQuestItems only.
    expect(painter).toMatch(
      /bagNoMatchKind\([^)]*\)\s*===\s*'quest'\s*\?\s*'hudChrome\.bags\.noQuestItems'\s*:\s*'hudChrome\.bags\.noMatch'/,
    );
  });

  it('never inserts section headers into the manual cells drop-target stream', () => {
    // Locked decision 7: the model.cells loop must not call buildBagListRows
    // or buildSectionHeader. Section headers live only on the derived list path
    // after the cells early-return.
    const fillStart = painter.indexOf('private fillGrid(');
    const fillEnd = painter.indexOf('private buildStackCell(');
    const fill = painter.slice(fillStart, fillEnd);
    const cellsBranch = fill.slice(
      fill.indexOf('if (model.cells.length > 0)'),
      fill.indexOf('// Derived list:'),
    );
    expect(cellsBranch).toContain('buildStackCell');
    expect(cellsBranch).not.toContain('buildBagListRows');
    expect(cellsBranch).not.toContain('buildSectionHeader');
    expect(cellsBranch).not.toContain('bag-section-header');
  });

  it('wires bag hover and keyboard focus to tracker highlight via pure id + thin controller', () => {
    // Pure id + controller are unit-tested elsewhere; this pin keeps the
    // bags painter from dropping the call site while those suites stay green.
    expect(painter).toContain("from './bag_quest_tracker_highlight'");
    expect(painter).toContain("from './bag_quest_tracker_highlight_view'");
    expect(painter).toContain('BagQuestTrackerHighlight');
    expect(painter).toContain('bagQuestTrackerHighlightId');
    expect(painter).toContain('trackerHighlight.set');
    expect(painter).toContain('trackerHighlight.clear');
    expect(painter).toContain("addEventListener('mouseenter'");
    expect(painter).toContain("addEventListener('mouseleave'");
    // Keyboard parity: bag tooltips show on focusin, so the tracker highlight
    // must too (and clear on focusout).
    expect(painter).toContain("addEventListener('focusin'");
    expect(painter).toContain("addEventListener('focusout'");
    expect(painter).toContain('clearTrackerHighlight');
    // Clear on rebuild (render + refreshGrid) and close; hideTooltip path uses
    // hideTooltipClearingTracker so drag/peek does not leave a sticky glow.
    expect(painter).toContain('hideTooltipClearingTracker');
    const clearCalls = painter.match(/this\.clearTrackerHighlight\(\)/g) ?? [];
    // At least: close, render, refreshGrid, hideTooltipClearingTracker (+ leave/focusout).
    expect(clearCalls.length).toBeGreaterThanOrEqual(4);
    // Hover CSS: always-on token, no --fx gate.
    const hudCss = source('src/styles/hud.css');
    expect(hudCss).toContain('.qt-title.qt-bag-hover');
    expect(hudCss).toContain('var(--color-quest-tracker-bag-hover)');
    expect(tokens).toContain('--color-quest-tracker-bag-hover:');
    const hoverStart = hudCss.indexOf('.qt-title.qt-bag-hover');
    expect(hoverStart).toBeGreaterThan(-1);
    const hoverBlock = hudCss.slice(hoverStart, hudCss.indexOf('}', hoverStart));
    expect(hoverBlock).not.toContain('--fx-');
  });

  it('the socket aria-label derives its slots line from the ITEM via the shared leaf', () => {
    // The regression this catches is a hardcoded key, not a mistyped argument:
    // passing the socket model instead of the item is a tsc error (BagSocketModel
    // has no `kind`, so it does not satisfy the leaf's parameter), but writing the
    // plain `t('itemUi.tooltip.bagSlots', {` back at the call site compiles, reads
    // fine, and silently drops the materials-satchel variant from every equipped
    // bag's aria-label while this suite and bags_view's stay green. So pin the
    // leaf call itself; the variant choice is table-tested in tests/bags_view.test.ts.
    // Scoped to the socket loop and comment-stripped: an unscoped whole-file
    // toContain over comment-intact source is satisfied by a comment quoting the
    // call, or by the same expression surviving in some other method after the
    // socket label itself regressed.
    const socketLoopStart = painter.indexOf('for (const socket of model.sockets) {');
    const afterBagBarStart = painter.indexOf('private persistFilter(): void {');
    expect(
      socketLoopStart,
      'socket-loop anchor not found in bags_window.ts',
    ).toBeGreaterThanOrEqual(0);
    expect(afterBagBarStart).toBeGreaterThan(socketLoopStart);
    const socketLoop = stripComments(painter.slice(socketLoopStart, afterBagBarStart));
    expect(socketLoop).toContain("t(bagSlotsLineKey(item) ?? 'itemUi.tooltip.bagSlots', {");
  });

  it('a socketed materials satchel SAYS so in its rendered socket aria-label', () => {
    // The source pin above is region-scoped, so it still passes on a painter
    // that hardcodes the plain key AT the aria call while some other line in
    // the same span (the tooltip, a later socket branch) keeps a leaf call
    // alive. Only rendering decides it: this drives the real painter with a
    // materials satchel in socket 0 and reads the label a screen reader gets.
    // Forager's Haversack is a real materialsOnly ITEMS def (12 slots), so the
    // variant choice rides the shipped content, not a fixture's opinion.
    const root = renderBags(['foragers_haversack', null, null, null]);
    const sockets = [...root.querySelectorAll('.bag-socket:not(.backpack):not(.empty)')];
    expect(sockets, 'the socketed bag must render its own socket button').toHaveLength(1);
    // The resolved ENGLISH, pinned whole (the vault_window.test.ts render-sink
    // idiom): the regression this catches renders the plain-variant
    // "Forager's Haversack: 12 Slot Bag", which is not merely a different
    // wording but a dropped claim about what the bag will hold.
    expect(sockets[0].getAttribute('aria-label')).toBe(
      "Forager's Haversack: 12 Slot Materials Bag",
    );
  });

  it('a socketed UNRESTRICTED bag keeps the plain slots wording (the counter-example)', () => {
    // Without this arm the pin above passes on a painter that hardcodes the
    // MATERIALS key at the aria call, which would promise every general bag
    // holds materials only.
    const root = renderBags(['wayfarers_backpack', null, null, null]);
    const socket = root.querySelector('.bag-socket:not(.backpack):not(.empty)');
    expect(socket?.getAttribute('aria-label')).toBe("Wayfarer's Backpack: 16 Slot Bag");
  });

  it("asks for the backpack icon by the id the art is wired under ('backpack')", () => {
    // The bar's first socket is the implicit backpack, whose painted art is wired in
    // icons.ts under exactly this id (UI_ITEM_IMAGE_IDS, guarded by item_icons.test.ts).
    // Rename the id here and the socket silently falls back to the procedural sack while
    // every icon guard stays green, so the call site is pinned too.
    expect(painter).toContain("iconDataUrl('item', 'backpack')");
  });

  it('captures and reapplies the .bag-grid scroll offset across a rebuild', () => {
    expect(painter).toContain(".bag-grid')?.scrollTop");
    expect(painter).toContain('grid.scrollTop = prevScrollTop');
  });

  it('prompt Escape stops propagation so the global escape does not also close the window', () => {
    // Without stopPropagation the keypress bubbles to the input layer's window
    // keydown, whose escape action runs closeAll: one Escape on a prompt BUTTON
    // (not tag-exempt like inputs) would dismiss the prompt AND close the bags.
    // The recipe lives in the shared module (prompt_dialog.ts) since the
    // rule-of-three extraction; the window must still delegate to it with its
    // own root, or the recipe protects nothing here.
    expect(promptDialog).toMatch(/ke\.preventDefault\(\);\s*ke\.stopPropagation\(\);/);
    expect(painter).toMatch(
      /installModalPromptDialog\(prompt, opener, close, \{\s*inertRoot: this\.deps\.root\(\),/,
    );
  });
});

describe('bags_window: bank-deposit mode wiring', () => {
  it('reads the bank-open mode fresh each click through the injected dep', () => {
    // The mode flag is HUD state; the painter must read it via the dep each click,
    // never cache it, mirroring vendorOpen / isMailAttach.
    expect(painter).toContain('isPersonalBankTab(): boolean;');
    expect(painter).toContain('isGuildBankTab(): boolean;');
    expect(painter).toContain('isVaultBankTab(): boolean;');
    // At most ONE of the three bank modes, and possibly NONE: each is armed
    // only while its own grid is on screen to drop into, so the guild pane's
    // log view and the LOCKED vault pane (reading/purchase surfaces) arm
    // nothing. `isBankOpen && !guildTab` is NOT the personal predicate: it
    // armed the personal deposit behind the log.
    expect(painter).toContain('bankDeposit: this.deps.isPersonalBankTab(),');
    expect(painter).toContain('guildBankDeposit: this.deps.isGuildBankTab(),');
    expect(painter).toContain('vaultDeposit: this.deps.isVaultBankTab(),');
    // ...and the SUPERSET flag that says the bank cluster owns the slot at all.
    // Without it, both deposits off is bit-identical to "no window is open",
    // which demoted the click to the use/equip default and re-armed the destroy
    // prompt and the item action menu over the guild pane's reading surface.
    expect(painter).toContain('bankOpen: this.deps.isBankOpen(),');
    // The consumers that must read the superset, not the deposit pair.
    expect(painter).toContain('!mode.bankOpen &&');
    expect(view).toContain("if (mode.bankOpen) return 'bankDepositBlockedNoTarget';");
    expect(view).toContain("if (mode.bankOpen) return 'hudChrome.bank.cannotDepositNow';");
  });

  it('hud wires isBankOpen to the live bank-window open state', () => {
    expect(hud).toContain('isBankOpen: () => this.bankWindow.isOpen,');
    expect(hud).toContain('isPersonalBankTab: () => this.bankWindow.personalTabActive,');
    expect(hud).toContain('isGuildBankTab: () => this.bankWindow.guildTabActive,');
    // The vault dep must aim at ITS OWN getter: rewiring it to guildTabActive
    // (or deleting the line) breaks nothing else in the suite because the
    // routing tests inject the dep directly.
    expect(hud).toContain('isVaultBankTab: () => this.bankWindow.vaultTabActive,');
  });

  it('resolves the deposit target by reference index, not itemId (the index command)', () => {
    // The clicked stack maps to its inventory INDEX via the pure resolver, and the
    // whole-stack deposit passes that index (omitted count = whole stack). A stale
    // click (index < 0) is a no-op.
    expect(painter).toContain('const index = bagStackIndex(this.deps.world().inventory, s);');
    expect(painter).toContain('if (index < 0) break;');
    expect(painter).toContain('this.deps.world().bankDeposit(index);');
  });

  it('shift-clicks a splittable stack into the partial prompt, else deposits whole', () => {
    expect(painter).toContain('if (ev.shiftKey && bankDepositOpensPrompt(s)) {');
    expect(painter).toContain(
      'this.showDepositQuantityPrompt(index, s, Math.max(1, Math.floor(s.count)));',
    );
  });

  it('blocks a quest item with the sim deny wording and dispatches nothing', () => {
    // Pin the case body: it shows the established sim deny key through the shared
    // showError pipe and RETURNS, so no bankDeposit command is sent for a quest item.
    expect(painter).toMatch(
      /case 'bankDepositBlockedQuest':[\s\S]*?showError\(tSim\('error\.bankQuestItem'\)\);\s*return;/,
    );
  });

  it('the deposit prompt re-resolves the live slot at submit and refuses on a mismatch', () => {
    // The bags can repaint under the open prompt; the shared builder's submit
    // (bank_quantity_prompt.ts) calls resolveCount, whose bags closure re-reads
    // inventory[index] and refuses (null) rather than deposit the wrong item,
    // clamping otherwise. The null arm's dismiss lives in the builder.
    expect(painter).toContain('const live = this.deps.world().inventory[index];');
    expect(painter).toContain('return resolveDepositSubmit(live, captured, requested, maxCount);');
    expect(painter).toContain('this.deps.world().bankDeposit(index, count);');
    const builder = source('src/ui/bank_quantity_prompt.ts');
    expect(builder).toMatch(/if \(count === null\) \{\s*dismiss\(\);/);
  });

  it('registers the deposit prompt class so close() tears it down (no orphaned modal)', () => {
    expect(painter).toContain('.bank-deposit-prompt');
    expect(painter).toContain(
      "'.discard-item-prompt, .sell-quantity-prompt, .sell-confirm-prompt, .bank-deposit-prompt'",
    );
  });

  it('advertises the shift-click partial deposit on splittable stacks (withdraw twin)', () => {
    // The tooltip shows depositPartialHint ONLY on the deposit-hint arm (never on a
    // blocked quest item) and only for a splittable stack; without this line the
    // catalog key would be dead and the affordance undiscoverable.
    // All THREE deposit-hint arms advertise the split (the vault joined the
    // pair in Bank Storage Phase 03). ONE regex over COMMENT-STRIPPED source
    // spans the whole expression, so three matching fragments scattered
    // across the file (or quoted in a comment) can never satisfy it apart.
    const code = stripComments(painter);
    expect(code).toMatch(
      /\(key === 'hudChrome\.bank\.depositHint' \|\|\s*key === 'hudChrome\.bank\.guildDepositHint' \|\|\s*key === 'hudChrome\.bank\.vaultDepositHint'\) &&\s*bankDepositOpensPrompt\(s\)/,
    );
    expect(code).toContain("t('hudChrome.bank.depositPartialHint')");
    expect(code).toContain('+ extra + partial + equipDrag + destroy + link');
  });
});

describe('bags_window: touch peek + bank-cluster close', () => {
  it('consults the shared peek guard FIRST in the bag cell click', () => {
    // On touch, a long-press peek shows the tooltip; the release click must consume
    // the peek and inspect the stack instead of running its action (use/sell/deposit/
    // feed). The guard check sits at the TOP of the handler, before the shift-link and
    // the bagItemAction switch, so a peek release can never fall through to an action.
    expect(painter).toContain('consumePeek(): boolean;');
    // The peek check stays FIRST; the only thing that may sit between it and the
    // shift-link arm is the touch-drag click suppression (the synthetic click that
    // trails a completed drag), which is likewise a "swallow this click" gate.
    // Peek dismiss uses hideTooltipClearingTracker so bag hover cannot leave a
    // sticky tracker glow after a long-press inspect (Phase 5).
    expect(painter).toMatch(
      /row\.addEventListener\('click', \(ev\) => \{[\s\S]{0,320}?if \(this\.deps\.consumePeek\(\)\) \{\s*this\.hideTooltipClearingTracker\(\);\s*return;\s*\}[\s\S]{0,400}?if \(ev\.shiftKey && bagShiftLinks/,
    );
    // The drag's trailing click must never ALSO run the stack's action.
    expect(painter).toMatch(
      /if \(this\.suppressNextClick\) \{\s*this\.suppressNextClick = false;\s*return;\s*\}/,
    );
    // Slice to the BAGS construction block (its own `});` terminator) so this pins
    // the bags-side guard wiring specifically; an unsliced scan would stay green off
    // the identically-worded bank site alone.
    const start = hud.indexOf('new BagsWindow({');
    const bagsSite = hud.slice(start, hud.indexOf('});', start));
    expect(start).toBeGreaterThan(0);
    expect(bagsSite).toContain('consumePeek: () => this.peekGuard.consume(),');
  });

  it('a touch-sourced contextmenu inspects and never reaches the sell/destroy arms', () => {
    // Chromium fires contextmenu at ~500ms on a touch hold, BEFORE the 950ms
    // tooltip peek timer, so without this gate a long-press meant to inspect a
    // destroyable item opened the destroy prompt out from under the peek (the
    // release/v0.23.0 destroy affordance meeting the touch peek model). The
    // gate sits at the TOP of the handler, preventDefaults (the row is not in
    // the document-level native-menu suppress set), and fails safe to inspect
    // when a mobile-touch browser reports no pointerType (Firefox Android).
    expect(painter).toMatch(
      /row\.addEventListener\('contextmenu', \(ev\) => \{[\s\S]{0,700}?pointerType === 'touch'[\s\S]{0,200}?ev\.preventDefault\(\);\s*return;\s*\}\s*if \(this\.deps\.vendorOpen\(\)\)/,
    );
    expect(painter).toContain(
      "(document.body.classList.contains('mobile-touch') && pointerType !== 'mouse')",
    );
  });

  it('the bags x-btn closes the whole bank cluster on touch (mirrors the vendor close)', () => {
    // On mobile the bank hides its own x-btn under the pairing, so the bags x-btn is
    // the cluster's single close control: it must close the bank companion too, never
    // leaving a half-screen orphan (the family behavior, cloned from closeVendor).
    expect(painter).toContain('closeBank(): void;');
    expect(painter).toMatch(
      /if \(this\.deps\.isBankOpen\(\)\) \{\s*this\.deps\.closeBank\(\);\s*return;\s*\}/,
    );
    // Guarded behind the mobile-touch gate (desktop keeps the bank's own x-btn).
    expect(painter).toMatch(
      /if \(document\.body\.classList\.contains\('mobile-touch'\)\) \{[\s\S]{0,200}?this\.deps\.closeBank\(\)/,
    );
    expect(hud).toContain('closeBank: () => this.closeBank(),');
  });

  it('the managed (Esc) close of bags closes the bank cluster on touch too', () => {
    // Mirrors the vendor arm one line above it in closeManagedWindow: on touch the
    // cluster is one unit and the bank's own x-btn is hidden, so peeling bags off
    // with Esc must not leave a half-width orphan bank.
    expect(hud).toMatch(
      /case 'bags':[\s\S]{0,700}?else if \(this\.bankWindow\.isOpen && document\.body\.classList\.contains\('mobile-touch'\)\)\s*this\.closeBank\(\);/,
    );
  });

  it('a bags close that leaves the bank open undocks the pairing on touch (standalone full-screen)', () => {
    // The tray/minimap bags toggle hides bags WITHOUT closing the bank; dropping
    // body.bank-open lets the mobile standalone full-screen rule take over (and the
    // bank x-btn reappear). close() must fire the hook on every teardown, the hud
    // must gate the undock on mobile + bank-open, and toggleBags must re-dock on
    // re-open, or the pairing never comes back.
    expect(painter).toContain('onClosed(): void;');
    expect(painter).toMatch(
      /this\.deps\.restoreFocus\(this\.openerFocus\);\s*this\.openerFocus = null;\s*this\.deps\.onClosed\(\);/,
    );
    expect(hud).toContain('onClosed: () => this.onBagsClosed(),');
    expect(hud).toMatch(
      /private onBagsClosed\(\): void \{\s*if \(document\.body\.classList\.contains\('mobile-touch'\) && this\.bankWindow\.isOpen\) \{\s*document\.body\.classList\.remove\('bank-open'\);/,
    );
    expect(hud).toMatch(
      /this\.bagsWindow\.noteOpener\(\);[\s\S]{0,400}?if \(this\.bankWindow\.isOpen\) document\.body\.classList\.add\('bank-open'\);/,
    );
  });

  it('the prompt stops Enter/Space propagation (the submit-dismiss race, bank family fix)', () => {
    // submit() removes the prompt node synchronously during the Enter keydown, so a
    // window-level gate keyed on the prompt's presence runs too late and the chat
    // bind steals the WCAG 2.4.3 focus return. The prompt's own keydown listener
    // stops the bubble, and once the prompt was detached mid-dispatch it must ALSO
    // cancel the default (or the activation ghost-clicks the re-landed focus).
    // The older Escape-only handling reds this. The handler lives in the
    // shared recipe (prompt_dialog.ts); the delegation pin rides the Escape
    // test above.
    expect(promptDialog).toMatch(
      /if \(ke\.key === 'Enter' \|\| ke\.key === ' ' \|\| ke\.code === 'Space'\) \{\s*ke\.stopPropagation\(\);\s*if \(!prompt\.isConnected\) ke\.preventDefault\(\);\s*return;\s*\}/,
    );
  });

  it('the shared dispatch reaches the transactional modes too, not just equip/use (issue 1852 review)', () => {
    // runBagAction runs the FULL mode switch for both left-click and right-click, so
    // trade / mail / market-sell / bank-deposit / pet-feed also fire on right-click
    // (previously inert there, since bagDestroyAction returned 'none' for them).
    // bagItemAction's per-mode dispatch is exhaustively pinned in bags_view.test.ts;
    // this pins that runBagAction's switch actually wires each of those actions
    // to its staging call, so the two pins together prove reachability from
    // right-click without a live DOM harness.
    const start = painter.indexOf('private runBagAction(');
    const body = painter.slice(start, painter.indexOf('\n  }\n', start));
    expect(body).toMatch(/case 'trade':\s*this\.deps\.addItemToTrade\(s\.itemId\);/);
    expect(body).toMatch(
      /case 'mailAttach':\s*this\.deps\.stageMailParcel\(s\.itemId, s\.instance\);/,
    );
    expect(body).toMatch(
      /case 'marketSell':\s*this\.deps\.stageMarketSell\(s\.itemId, s\.instance\);/,
    );
    expect(body).toMatch(/case 'bankDeposit': \{/);
    // feedPet and useItem now also forward WHICH bag copy was clicked, so the
    // call no longer ends at `s.itemId`. These pins are about REACHABILITY from
    // the shared dispatch, so they match the call opening and leave the argument
    // list to tests/item_copy_addressing_guard.
    expect(body).toMatch(/case 'petFeed':\s*this\.deps\.world\(\)\.feedPet\(s\.itemId/);
    // The 'use' case tries the gathering-tool routing first (#2343) and only
    // falls back to the plain useItem command when the hook declines.
    expect(body).toMatch(
      /case 'use': \{[\s\S]{0,400}?if \(!item \|\| !this\.deps\.useGatherTool\(item\)\) \{[\s\S]{0,200}?this\.deps\.world\(\)\.useItem\(s\.itemId/,
    );
  });
});

describe('bags_window: right-click uses, dragging destroys/equips', () => {
  it('right-click runs the SAME action as left-click and never opens the destroy prompt', () => {
    // The classic binding: right-click uses/equips. Destroying moved to the drag-out
    // gesture, so the contextmenu handler must reach runBagAction and must NOT call
    // the discard prompt (the release/v0.25.0 behavior this replaces).
    const ctx = painter.slice(
      painter.indexOf("row.addEventListener('contextmenu'"),
      painter.indexOf('row.draggable ='),
    );
    expect(ctx).toContain('this.runBagAction(item, s, ev)');
    expect(ctx).not.toContain('showDiscardItemPrompt');
    expect(ctx).not.toContain('bagDestroyAction');
    // The vendor's Ctrl/Meta split-stack sell survives untouched.
    expect(ctx).toContain('this.sellBagItem(item, s, ev)');
  });

  it('every stack is draggable outside the transactional modes (not just hotbar items)', () => {
    // Previously only food/drink/potion/fishing items were draggable (to the action
    // bar). Now any stack can be dragged to a paperdoll socket or out to destroy, and
    // only the hotbar-eligible ones additionally write the hotbar DataTransfer payload.
    expect(painter).toContain('row.draggable = !this.deps.tradeOpen() && !this.deps.vendorOpen();');
    expect(painter).toMatch(
      /dragstart[\s\S]{0,400}?this\.deps\.dragState\.begin\(drag\);[\s\S]{0,200}?if \(this\.deps\.isHotbarItemId\(s\.itemId\)\) \{/,
    );
  });

  it('the world drop opens the destroy prompt and honors the noDiscard refusal', () => {
    expect(painter).toContain('promptDestroy(itemId: string, count: number): void');
    expect(painter).toContain('destroyAction(itemId: string): BagDestroyAction');
    expect(painter).toContain("t('hudChrome.bags.cannotDestroy')");
    // The HUD installs the canvas as the world drop target with exactly those seams.
    expect(hud).toContain('installWorldDropTarget({');
    expect(hud).toContain("root: () => $('#game-canvas'),");
    expect(hud).toContain('destroyAction: (itemId) => this.bagsWindow.destroyAction(itemId),');
  });

  it('the tooltip advertises the two drag gestures, not the dead right-click destroy', () => {
    expect(painter).toContain("t('hudChrome.bags.dragEquipHint')");
    expect(painter).toContain("t('hudChrome.bags.dragDestroyHint')");
    expect(painter).not.toContain('rightClickDestroy');
  });
});

describe('bags_window: a vendor click confirms before selling anything but true junk', () => {
  // The reported bug: selling gray junk one item at a time (a plain click while
  // the vendor is open) had no per-item confirmation, so a single stray click
  // could vendor an adjacent, unrelated, enchanted item with no recourse beyond
  // the bounded buyback list. vendorSellIsInstant (bags_view.ts) is the pure
  // gate; the real dispatch (which command each modifier sends, the stale-copy
  // refusal, the focus landing) is behaviorally pinned in
  // tests/bags_vendor_sell_confirm.test.ts against the real BagsWindow; these
  // source pins are the no-magic-values-file's own idiom for anchoring the
  // wiring text they exercise.
  it('imports vendorSellIsInstant from bags_view and gates the plain-click arm on it', () => {
    expect(painter).toContain('vendorSellIsInstant');
    const body = painter.slice(
      painter.indexOf('private sellBagItem('),
      painter.indexOf('private showSellConfirmPrompt('),
    );
    // The confirmVendorSell setting (a player opt-out) folds into the same
    // instant gate: off treats every item as instant, restoring the classic
    // one-click sale.
    expect(body).toContain('!this.deps.confirmVendorSell()');
    expect(body).toContain('vendorSellIsInstant(item, slot.instance, slot.craftedRecipeId);');
    expect(body).toContain('!instant');
    expect(body).toContain('this.showSellConfirmPrompt(item, slot)');
    // Ctrl/meta and shift both still confirm a non-instant sale (the review-round
    // fix): only the id-scoped bulk quantity prompt or the per-slot confirm
    // prompt, never an unconfirmed instant sellItem call, for anything but junk.
    expect(body).toMatch(/if \(instant\)[\s\S]{0,40}sellItem\(slot\.itemId, count\)/);
    expect(body).toContain('this.showSellQuantityPrompt(slot.itemId, heldTotal);');
    // The full-stack fix: a plain click on a non-instant STACK (count > 1) also
    // routes through the bulk quantity prompt instead of confirming exactly one
    // unit at a time (the "can't sell full stacks" regression).
    expect(body).toContain('!instant && count > 1');
  });

  it('the confirm prompt re-resolves the live slot at submit and refuses on a mismatch', () => {
    const body = painter.slice(
      painter.indexOf('private showSellConfirmPrompt('),
      painter.indexOf('private showSellConfirmPrompt(') + 2200,
    );
    // Re-resolved by reference identity at SUBMIT time, not the index captured
    // when the dialog opened: the whole point of this fix is that a stale
    // selection must REFUSE rather than fall back to an itemId-only sellItem
    // guess that could vendor a different (e.g. the enchanted) copy of the id.
    expect(body).toContain('const index = bagStackIndex(this.deps.world().inventory, slot);');
    expect(body).toContain('if (index < 0) {');
    expect(body).toContain("this.deps.showError(tSim('error.noItem'));");
    expect(body).toContain('sellItem(slot.itemId, 1, { slotIndex: index })');
    // Lands on the always-present close button, not the (about-to-detach) opener.
    expect(body).toContain("this.deps.root().querySelector('[data-close]')");
    expect(body).not.toContain('opener?.focus()');
    // Reuses the existing sell-quantity wording (every locale already has it)
    // rather than minting new i18n keys for a second sell-confirm dialog.
    expect(body).toContain("t('itemUi.vendor.sellQuantityTitle', { item: itemName })");
    expect(body).toContain("t('itemUi.vendor.sellQuantityConfirm')");
    expect(body).toContain("t('itemUi.vendor.sellQuantityCancel')");
  });

  it('the pure gate itself: only poor quality with no instance or crafted marker is instant', () => {
    expect(view).toContain('export function vendorSellIsInstant(');
    expect(view).toContain(
      "return item.quality === 'poor' && instance === undefined && craftedRecipeId === undefined;",
    );
  });
});

describe('bags_window: styles for the drag affordances', () => {
  it('the touch ghost never eats the hit test that resolves the drop target under it', () => {
    const ghost = components.slice(
      components.indexOf('.touch-drag-ghost {'),
      components.indexOf('.touch-drag-ghost .item-icon'),
    );
    expect(ghost).toContain('pointer-events: none;');
  });

  it('an accepting paperdoll socket lights up as a drop target', () => {
    expect(components).toContain('.equip-slot.drop-target {');
  });
});

describe('bags_window: per-copy instance tooltip forwarding (Professions 2.0)', () => {
  it("forwards the slot's instance payload into the widened itemTooltip dep", () => {
    // The bank arm has a model-level pin (bank_view.test.ts BankSlotModel
    // .instance passthrough); the bags arm is a direct painter call, so the
    // call site itself is the load-bearing surface: dropping `s.instance`
    // reverts every bag tooltip to def-only while all pure-core suites stay
    // green (the exact regression class the widened dep was added for).
    expect(painter).toContain('this.deps.itemTooltip(item, s.instance)');
  });
});

describe('bags_window: unknown-id stacks stay visible (stale-client guard, R34)', () => {
  // The keep/exclude decision lives in bag_filter.ts (pinned in
  // bag_filter.test.ts); these pins hold the painter to rendering what the
  // core keeps. Comment-stripped so prose naming an arm cannot satisfy a pin.
  const code = stripComments(painter);

  it('paints an unknown-id stack through buildUnknownStackCell in BOTH grid views', () => {
    // The pristine view used to paint it as an EMPTY square; the list view
    // used to drop the row entirely (`if (!item) continue`).
    expect(code).toContain('this.buildUnknownStackCell(stack, cell)');
    expect(code).toContain('this.buildUnknownStackCell(s, null)');
    expect(code).not.toContain('if (!item) continue');
    // BOTH branches resolve through the own-property predicate: a bare
    // ITEMS read sends a prototype key down the known arm (the merge
    // settlement caught the pristine branch keeping one).
    expect(code).toContain('knownItemDef(ITEMS, stack.itemId)');
    expect(code).toContain('knownItemDef(ITEMS, s.itemId)');
    expect(code).not.toContain('stack ? ITEMS[stack.itemId] : undefined');
  });

  it('renders the fallback icon, the raw id, and an UNKNOWN accessible name', () => {
    const start = code.indexOf('private buildUnknownStackCell(');
    const end = code.indexOf('private bindBagCellDrop(');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const body = code.slice(start, end);
    expect(body).toContain('unknownItemIconHtml(s.itemId)');
    // The cell keeps the shared bag-cell styling at the default rung and its
    // count badge, so an unknown stack reads like a stack, not a hole.
    expect(body).toContain("row.className = 'bag-item q-common'");
    expect(body).toContain('bi-count');
    // The aria channel carries the UNKNOWN signal (the tooltip is hover-only),
    // plus the raw id; the tooltip title is the raw id with the unknown
    // sub-line.
    expect(body).toContain("t('itemUi.bags.unknownItemAria', {");
    expect(body).toContain('id: s.itemId');
    expect(body).toContain("t('itemUi.bags.unknownItem')");
    // Exactly ONE click action, the def-free bank deposit, and only while
    // the bank is open (bankDeposit is index-based like the move, so the
    // withdraw the guard kept live is not a one-way trip); outside the bank
    // the cell stays a focusable no-op and aria-disabled stays honest. The
    // def-requiring action ladder (runBagAction) is still never wired. The
    // DRAG source stays live, because a move works on indices alone; both
    // drag arms and the touch drop's bag-cell move are pinned so the
    // capability cannot silently vanish.
    // The ladder decision itself moved into the pure core (bags_view.ts
    // bagUnknownAction, unit-tested against bagItemAction's mode fixtures in
    // tests/bags_window_unknown_cell.test.ts); the cell must read THAT one
    // definition, never re-inline its own copy of the conjunction.
    expect(body).toContain("bagUnknownAction(this.bagMode()) === 'bankDeposit'");
    expect(body).toContain("if (!canDeposit) row.setAttribute('aria-disabled', 'true')");
    expect(body).toContain('if (canDeposit) {');
    expect(body).toContain('this.deps.world().bankDeposit(index)');
    expect(body).toContain('this.showDepositQuantityPrompt(index, s,');
    // The one listener sits INSIDE the canDeposit arm: no second click path.
    const clickArms = body.split("addEventListener('click'").length - 1;
    expect(clickArms).toBe(1);
    // The touch drop SUPPRESSES the trailing synthetic click (the
    // touch_item_drag contract): without this a reorganize drag with the
    // bank open would also deposit on release. Pinned inside the unknown
    // cell's own onDrop, before the target resolve.
    const onDropAt = body.indexOf('onDrop: (x, y) => {');
    expect(onDropAt).toBeGreaterThan(-1);
    const suppressAt = body.indexOf('this.suppressNextClick = true', onDropAt);
    expect(suppressAt).toBeGreaterThan(onDropAt);
    expect(suppressAt).toBeLessThan(body.indexOf('resolveDropTargetAt', onDropAt));
    expect(body.indexOf("addEventListener('click'")).toBeGreaterThan(
      body.indexOf('if (canDeposit) {'),
    );
    expect(body).not.toContain('runBagAction');
    expect(body).not.toContain('onclick');
    // The def-free corner glyph and its aria flag survive the missing def: a
    // bound or enchanted copy keeps its marker in both channels.
    expect(body).toContain('bagInstanceGlyphKind(s.instance)');
    expect(body).toContain('t(UNKNOWN_INSTANCE_GLYPH_ARIA_KEYS[glyphKind], {');
    // Never the known cell's keys: those drop the UNKNOWN signal. The known
    // map's name is a SUBSTRING of the unknown one, so the lookbehind keeps
    // the legitimate UNKNOWN_INSTANCE_GLYPH_ARIA_KEYS use from matching.
    expect(body).not.toMatch(/(?<!UNKNOWN_)INSTANCE_GLYPH_ARIA_KEYS/);
    expect(body).toContain('row.draggable = !this.deps.tradeOpen() && !this.deps.vendorOpen()');
    expect(body).toContain("row.addEventListener('dragstart'");
    expect(body).toContain("row.addEventListener('dragend'");
    expect(body).toContain('bindTouchItemDrag(row, {');
    expect(body).toContain('this.dropOnBagCell(index >= 0 ? index : null, target.index)');
    // Still a drop target in the pristine view, so re-parking other stacks
    // around the unknown one keeps working.
    expect(body).toContain('this.bindBagCellDrop(row, cell)');
  });

  it('styles the unknown cell without the click affordance (both CSS arms)', () => {
    // The hover lift is suppressed outright; the cursor rule covers the
    // non-draggable state only, because the later [draggable="true"] grab
    // rule deliberately wins while the drag is available. Pinning both rules
    // keeps that interplay from being "cleaned up" into a dead declaration.
    expect(components).toContain('.bag-item[aria-disabled="true"]:hover');
    expect(components).toMatch(
      /\.bag-item\[aria-disabled="true"\]\s*\{\s*cursor:\s*var\(--cursor-arrow\);/,
    );
    expect(components).toMatch(
      /\.bag-item\[draggable="true"\]\s*\{\s*cursor:\s*var\(--cursor-grab\);/,
    );
  });

  it('never skips a slot in the grid fill (no continue of any wording)', () => {
    // The shipped defect was `if (!item) continue`; a re-worded equivalent
    // (`item == null`, a braced body) would evade a literal pin, so the whole
    // fillGrid slice is held to zero continue statements.
    const start = code.indexOf('private fillGrid(');
    const end = code.indexOf('private buildStackCell(');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(code.slice(start, end)).not.toContain('continue');
  });
});

describe('bags_window: the bag-bar counter pools readout (phase 08)', () => {
  // The pure split (carriedPools) is table-tested in tests/bags_view.test.ts;
  // these arms read what the painter actually renders: the counter keeps its
  // exact text and over-class behavior, gains the split aria only when the
  // materials pool has something to say, and ALWAYS carries the lazy per-pool
  // tooltip. The counter stays a non-actionable span: no click, no peek guard.
  it('splits the counter aria and tooltip when a materials satchel is equipped', () => {
    const { root, tooltips } = renderBagsHarness(
      ['foragers_haversack', null, null, null],
      [
        { itemId: 'iron_ore', count: 1 },
        { itemId: 'worn_sword', count: 1 },
      ],
      28,
    );
    const counter = root.querySelector('.bag-capacity');
    expect(counter?.textContent).toBe('2/28');
    expect(counter?.getAttribute('aria-label')).toBe(
      'Bag slots used: 2 of 28. General items: 1 of 16. Materials: 1 of 12.',
    );
    const tip = tooltips.find((entry) => entry.el === counter);
    expect(tip).toBeDefined();
    const html = tip?.html() ?? '';
    expect(html).toContain('General: 1 of 16');
    expect(html).toContain('Materials: 1 of 12');
  });

  it('keeps the exact text and simple aria without materials; the tooltip still attaches', () => {
    const { root, tooltips } = renderBagsHarness(
      ['wayfarers_backpack', null, null, null],
      [{ itemId: 'worn_sword', count: 1 }],
      32,
    );
    const counter = root.querySelector('.bag-capacity');
    expect(counter?.textContent).toBe('1/32');
    expect(counter?.getAttribute('aria-label')).toBe('Bag slots used: 1 of 32');
    const tip = tooltips.find((entry) => entry.el === counter);
    expect(tip).toBeDefined();
    const html = tip?.html() ?? '';
    expect(html).toContain('General: 1 of 32');
    expect(html).not.toContain('Materials');
  });

  it('the over class still composes and the counter stays a span (no affordance change)', () => {
    const seventeen: InvSlot[] = Array.from({ length: 17 }, () => ({
      itemId: 'worn_sword',
      count: 1,
    }));
    const { root } = renderBagsHarness([null, null, null, null], seventeen, 16);
    const counter = root.querySelector('.bag-capacity');
    expect(counter?.tagName).toBe('SPAN');
    expect(counter?.classList.contains('over')).toBe(true);
    expect(counter?.textContent).toBe('17/16');
  });

  it('the counter is focusable (keyboard users reach the per-pool tooltip)', () => {
    // The split lives only in the tooltip, whose host serves hover,
    // long-press, AND focusin; the tab stop is what makes the third path
    // reachable (the bank meter's twin, QA 08).
    const { root } = renderBagsHarness(
      ['foragers_haversack', null, null, null],
      [{ itemId: 'iron_ore', count: 1 }],
      28,
    );
    expect(root.querySelector('.bag-capacity')?.getAttribute('tabindex')).toBe('0');
  });

  it('keyboard focus parked on the counter survives a whole-window rebuild', () => {
    // The restore ladder resolves by data-focus-key (dataset equality):
    // without the counter's key, a reader parked on the pool tooltip dropped
    // to <body> on the next inventory repaint (the focus_restore.ts #2528
    // class the ladder exists to prevent).
    const { root, window: win } = renderBagsHarness(
      ['foragers_haversack', null, null, null],
      [{ itemId: 'iron_ore', count: 1 }],
      28,
    );
    const counter = root.querySelector('.bag-capacity') as HTMLElement;
    counter.focus();
    expect(document.activeElement).toBe(counter);
    win.render();
    const rebuilt = root.querySelector('.bag-capacity') as HTMLElement;
    expect(rebuilt).not.toBe(counter);
    expect(document.activeElement).toBe(rebuilt);
  });
});
