import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Source-level guards for the bags painter. The pure click/tooltip/grid decisions are
// unit-tested in bags_view.test.ts; here we pin the no-magic-values
// contract (no raw hex; the unranked-quality fallback is a token) plus the two
// load-bearing behaviors: reusing bag_filter via buildBagGrid (not re-deriving the
// filter) and preserving the .bag-grid scroll offset across a rebuild.
const painter = readFileSync(new URL('../src/ui/bags_window.ts', import.meta.url), 'utf8');
const view = readFileSync(new URL('../src/ui/bags_view.ts', import.meta.url), 'utf8');
const promptDialog = readFileSync(new URL('../src/ui/prompt_dialog.ts', import.meta.url), 'utf8');
const tokens = readFileSync(new URL('../src/styles/tokens.css', import.meta.url), 'utf8');
const hud = readFileSync(new URL('../src/ui/hud.ts', import.meta.url), 'utf8');
const components = readFileSync(new URL('../src/styles/components.css', import.meta.url), 'utf8');

describe('bags_window: no magic values', () => {
  it('carries no literal hex color in TS (quality color comes from QUALITY_COLOR + a token)', () => {
    // Issue references in comments (#2343) match the hex shape, so the scan
    // runs on comment-stripped source: a hex COLOR only matters in live code.
    const code = painter.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
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
    const hudCss = readFileSync(new URL('../src/styles/hud.css', import.meta.url), 'utf8');
    expect(hudCss).toContain('.qt-title.qt-bag-hover');
    expect(hudCss).toContain('var(--color-quest-tracker-bag-hover)');
    expect(tokens).toContain('--color-quest-tracker-bag-hover:');
    const hoverStart = hudCss.indexOf('.qt-title.qt-bag-hover');
    expect(hoverStart).toBeGreaterThan(-1);
    const hoverBlock = hudCss.slice(hoverStart, hudCss.indexOf('}', hoverStart));
    expect(hoverBlock).not.toContain('--fx-');
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
    // At most ONE of the two bank modes, and possibly NEITHER: each is armed
    // only while its own grid is on screen to drop into, so the guild pane's
    // log view (a reading surface) arms neither. `isBankOpen && !guildTab` is
    // NOT the personal predicate: it armed the personal deposit behind the log.
    expect(painter).toContain('bankDeposit: this.deps.isPersonalBankTab(),');
    expect(painter).toContain('guildBankDeposit: this.deps.isGuildBankTab(),');
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
    const builder = readFileSync(
      new URL('../src/ui/bank_quantity_prompt.ts', import.meta.url),
      'utf8',
    );
    expect(builder).toMatch(/if \(count === null\) \{\s*dismiss\(\);/);
  });

  it('registers the deposit prompt class so close() tears it down (no orphaned modal)', () => {
    expect(painter).toContain('.bank-deposit-prompt');
    expect(painter).toContain(
      "'.discard-item-prompt, .sell-quantity-prompt, .bank-deposit-prompt'",
    );
  });

  it('advertises the shift-click partial deposit on splittable stacks (withdraw twin)', () => {
    // The tooltip shows depositPartialHint ONLY on the deposit-hint arm (never on a
    // blocked quest item) and only for a splittable stack; without this line the
    // catalog key would be dead and the affordance undiscoverable.
    expect(painter).toContain(
      "(key === 'hudChrome.bank.depositHint' || key === 'hudChrome.bank.guildDepositHint') &&",
    );
    expect(painter).toContain('bankDepositOpensPrompt(s)');
    expect(painter).toContain("t('hudChrome.bank.depositPartialHint')");
    expect(painter).toContain('+ extra + partial + equipDrag + destroy + link');
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
      /row\.addEventListener\('contextmenu', \(ev\) => \{[\s\S]{0,700}?pointerType === 'touch'[\s\S]{0,200}?ev\.preventDefault\(\);\s*return;\s*\}\s*\/\/ At a vendor/,
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
    expect(body).toMatch(/case 'petFeed':\s*this\.deps\.world\(\)\.feedPet\(s\.itemId\);/);
    // The 'use' case tries the gathering-tool routing first (#2343) and only
    // falls back to the plain useItem command when the hook declines.
    expect(body).toMatch(
      /case 'use': \{[\s\S]{0,400}?if \(!item \|\| !this\.deps\.useGatherTool\(item\)\) this\.deps\.world\(\)\.useItem\(s\.itemId\);/,
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
    expect(ctx).toContain('this.sellBagItem(s, ev)');
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
  const code = painter.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

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
