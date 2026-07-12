// Source-level guards for the bank painter (the bags_window.test.ts shape). The pure
// slot/action decisions are unit-tested in bank_view.test.ts; here we pin the
// no-magic-values contract (no raw hex; the unranked-quality fallback is a token), the
// load-bearing behaviors (reuse the pure core, preserve the grid scroll offset), the
// modal-prompt a11y contract, and the hud.ts wiring that opens/closes/refreshes the
// window plus the docking body class.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const painter = readFileSync(new URL('../src/ui/bank_window.ts', import.meta.url), 'utf8');
const tokens = readFileSync(new URL('../src/styles/tokens.css', import.meta.url), 'utf8');
const components = readFileSync(new URL('../src/styles/components.css', import.meta.url), 'utf8');
const mobileCss = readFileSync(new URL('../src/styles/hud.mobile.css', import.meta.url), 'utf8');
const hud = readFileSync(new URL('../src/ui/hud.ts', import.meta.url), 'utf8');
const mainSrc = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const indexHtml = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const playHtml = readFileSync(new URL('../play.html', import.meta.url), 'utf8');

describe('bank_window: no magic values', () => {
  it('carries no literal hex color in TS (the item-cell grammar resolves rarity in CSS)', () => {
    const hex = painter.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
    expect(hex, `hex colors must move to tokens: ${hex.join(', ')}`).toEqual([]);
  });

  it('drives the slot rarity from data-quality (the item-cell grammar), no colour in TS', () => {
    // The AAA .item-cell grammar resolves the rarity border from the quality tokens
    // via data-quality (the view core already resolved slot.qualityKey), so the
    // painter no longer sets a colour custom property; QUALITY_COLOR / the bank slot
    // quality prop leave the painter entirely.
    expect(painter).toContain("cell.setAttribute('data-quality', slot.qualityKey)");
    expect(painter).not.toContain('--bank-slot-quality');
    expect(painter).not.toContain('QUALITY_COLOR');
  });

  it('defines --color-quality-default in the design-token sheet (the item-cell default)', () => {
    expect(tokens).toContain('--color-quality-default:');
  });

  it('uses no em or en dashes (ASCII separators only)', () => {
    // escape sequences, not literal dashes: the pre-push copy scan flags the raw characters
    expect(painter.includes('\u2014'), 'em dash found').toBe(false);
    expect(painter.includes('\u2013'), 'en dash found').toBe(false);
  });

  it('gives both keyboard-focusable bank controls a tokenized :focus-visible ring', () => {
    expect(components).toMatch(
      /\.bank-item:focus-visible,\s*\.bank-buy-btn:focus-visible \{\s*outline: 2px solid var\(--color-border-focus\);/,
    );
  });
});

describe('bank_window: load-bearing behaviors preserved', () => {
  it('reuses the pure core (buildBankView + bankSlotAction), not a re-derived bag filter', () => {
    expect(painter).toContain('buildBankView(');
    expect(painter).toContain('bankSlotAction(');
    // the bank window is not a bags clone: it must not re-run the bag filter
    expect(painter).not.toContain('applyBagFilter(');
  });

  it('captures and reapplies the .bank-scroll scroll offset across a rebuild', () => {
    expect(painter).toContain(".bank-scroll')?.scrollTop");
    expect(painter).toContain('scroll.scrollTop = prevScrollTop');
  });

  it('closes itself after a grace window once bankInfo goes null (walked away)', () => {
    // Pin the literal (a silent change to 100ms would insta-close on any mirror
    // hiccup) and the whole null-gate arm INCLUDING the close() action: replacing
    // the action with a re-render must red this, not just renaming the constant.
    expect(painter).toContain('BANK_INFO_GRACE_MS = 3_000');
    expect(painter).toMatch(
      /if \(!info\) \{\s*if \(performance\.now\(\) - this\.openedAt > BANK_INFO_GRACE_MS\) this\.close\(\);/,
    );
  });

  it('open() is idempotent while already open (a re-interact must not re-capture focus)', () => {
    expect(painter).toMatch(/open\(\): void \{\s*if \(this\.opened\) return;/);
  });

  it('a rebuild under an open prompt tears the prompt down and re-lands focus', () => {
    // render() rebuilds innerHTML: an open prompt would go stale (old language, a
    // captured slot index the fresh data may have shifted) and the focused node is
    // destroyed. The rebuild must dismiss prompts, clear the inert they set, and
    // re-focus the fresh close button when focus was inside the window/prompt.
    const renderBody = painter.slice(
      painter.indexOf('render(): void {'),
      painter.indexOf('refreshIfChanged(): void {'),
    );
    expect(renderBody).toContain('dismissBankPrompts()');
    expect(renderBody).toContain('inert = false');
    expect(renderBody).toContain('hadFocus');
  });

  it('is a dialog via the shared window frame (role + aria-labelledby on the inner mount)', () => {
    // The frame builder (window_frame.ts) stamps role="dialog" + aria-labelledby on
    // the mounted .window-frame from the BANK_FRAME descriptor, so the window no
    // longer sets a separate markDialogRoot on the #bank-window root (which would
    // nest a second dialog); the frame IS the dialog.
    expect(painter).toContain('renderWindowFrame(mount, BANK_FRAME');
    expect(painter).toContain("id: 'bank-window',");
    expect(painter).not.toContain('markDialogRoot(');
  });
});

describe('bank_window: modal prompt a11y contract', () => {
  it('the prompt is a labelled modal dialog', () => {
    expect(painter).toContain("setAttribute('role', 'dialog')");
    expect(painter).toContain("setAttribute('aria-modal', 'true')");
  });

  it('traps Tab inside the prompt via the one canonical focusable set', () => {
    expect(painter).toContain("import { FOCUSABLE_SELECTOR } from './focus_manager'");
    expect(painter).toContain('FOCUSABLE_SELECTOR');
  });

  it('sets and clears the parent-window inert on every teardown path', () => {
    expect(painter).toContain('.inert = true');
    // Each arm is pinned in its own body slice so deleting either one reds this:
    // dismiss() (the shared prompt teardown) clears the inert it set...
    const dismissBody = painter.slice(painter.indexOf('const dismiss = ('));
    expect(dismissBody).toContain('inert = false');
    // ...and the force-close backstop in close() BOTH tears open prompts down and
    // clears inert (Esc/keybind can close the window out from under a prompt).
    const closeBody = painter.slice(
      painter.indexOf('close(): void {'),
      painter.indexOf('render(): void {'),
    );
    expect(closeBody).toContain('dismissBankPrompts()');
    expect(closeBody).toContain('.inert = false');
  });

  it('Escape dismisses the prompt and returns focus without reaching the global escape', () => {
    expect(painter).toMatch(/'Escape'[\s\S]{0,160}dismissAndReturn\(\)/);
    // stopPropagation keeps the keypress from bubbling to the input layer's window
    // keydown, whose escape action would ALSO run closeAll and close the whole bank
    // window in the same keypress (prompt buttons are not tag-exempt like inputs).
    expect(painter).toMatch(/ke\.preventDefault\(\);\s*ke\.stopPropagation\(\);/);
  });

  it('confirm lands focus on the always-present close button; cancel returns to the opener', () => {
    // Three landings: buy confirm, quantity submit, and the render() re-land. The
    // rebuild detaches the opener node, so falling to <body> is the WCAG 2.4.3 bug.
    // The frame close carries data-window-close (window_frame.ts), the landing hook.
    const landings =
      painter.match(
        /querySelector\('\[data-window-close\]'\) as HTMLElement \| null\)\?\.focus\(\)/g,
      ) ?? [];
    expect(landings.length).toBeGreaterThanOrEqual(3);
    expect(painter).toMatch(
      /const dismissAndReturn = \(\): void => \{\s*dismiss\(\);\s*opener\?\.focus\(\);/,
    );
  });

  it('re-validates the live slot at quantity-prompt submit (stale-index guard)', () => {
    // The prompt captures slotIndex at open; the bank can repaint under it. Sending
    // the captured index blind would withdraw whatever now sits there, so submit
    // re-resolves the live slot, refuses on an itemId mismatch, and clamps the
    // count to the live stack.
    expect(painter).toMatch(/if \(!live \|\| !slot \|\| live\.itemId !== slot\.itemId\)/);
    expect(painter).toMatch(/Math\.min\(maxCount, live\.count,/);
  });

  it('mounts the prompt into #prompt-stack (outside the window)', () => {
    expect(painter).toContain("getElementById('prompt-stack')");
  });

  it('buy-slots confirm calls bankBuySlots and withdraw-partial calls bankWithdraw with a count', () => {
    expect(painter).toContain('bankBuySlots()');
    expect(painter).toMatch(/bankWithdraw\(slotIndex, count\)/);
  });
});

describe('bank_window: hud.ts wiring', () => {
  it('opens the bank on the bank SimEvent', () => {
    expect(hud).toContain("case 'bank':");
    expect(hud).toContain('this.openBank();');
  });

  it('routes the managed-window close through the painter (focus return)', () => {
    expect(hud).toContain("case 'bank-window':");
    expect(hud).toContain('this.closeBank();');
  });

  it('toggles the bank-open docking body class on open and close', () => {
    expect(hud).toContain("classList.add('bank-open')");
    expect(hud).toContain("classList.remove('bank-open')");
  });

  it('re-renders the open bank on a language switch and refreshes it on the slow band', () => {
    expect(hud).toContain('if (this.bankWindow.isOpen) this.bankWindow.render();');
    expect(hud).toContain(
      'if (slowHud && this.bankWindow.isOpen) this.bankWindow.refreshIfChanged();',
    );
  });

  it('wires the painter deps: the onClosed teardown and the NON-trapping focus pair', () => {
    // Gutting onClosed leaves body.bank-open stuck and the bags companion docked
    // forever; windowFocus would install the Tab trap the non-modal cluster forbids.
    expect(hud).toContain('onClosed: () => this.onBankClosed(),');
    expect(hud).toContain('captureFocus: () => this.focusManager.activeFocusable(),');
    expect(hud).not.toMatch(/this\.windowFocus\('#bank-window'\)/);
  });

  it('the bags companion is exclusive: bank and vendor close each other on open', () => {
    // Every hub has a vendor within simultaneous interact range of its banker
    // (quartermaster_bree is 8.6yd from Bursar Crane), and both companions dock
    // on the same side of #bags: without the mutual close, mobile cluster-close
    // precedence (vendor first) strands the bank at half-width with its x-btn
    // hidden and no touch close affordance.
    expect(hud).toMatch(
      /openBank\(\): void \{[\s\S]{0,600}?if \(this\.vendorOpen\) this\.closeVendor\(\);[\s\S]{0,600}?classList\.add\('bank-open'\)/,
    );
    expect(hud).toMatch(
      /openVendor\(npcId: number\): void \{[\s\S]{0,600}?if \(this\.bankWindowOpen\) this\.closeBank\(\);/,
    );
  });

  it('a banker interact routes to the sim from every input path (gossip never renders for bankers)', () => {
    // interactKey (keyboard, gamepad, the mobile button) and the mouse click-pick
    // all funnel NPCs into openQuestDialog; the banker arm must divert to the sim
    // interact (whose banker intercept emits the bank event both hosts open on)
    // BEFORE any gossip renders, or the bank is unreachable in normal play. Found
    // by a cross-platform audit: every earlier smoke drove
    // __game.sim.interact() directly, which masked the missing client trigger.
    expect(hud).toMatch(
      /openQuestDialog\(npcId: number\): void \{[\s\S]{0,700}?if \(NPCS\[npc\.templateId\]\?\.banker\) \{[\s\S]{0,160}?this\.sim\.targetEntity\(npc\.id\);[\s\S]{0,80}?this\.sim\.interact\(\);[\s\S]{0,40}?return;/,
    );
  });

  it('the heroic marks shop, the second tenant of #vendor-window, honors the same exclusivity', () => {
    // Quartermaster Vex stands ~4.5yd from Bursar Aldous Crane at Highwatch, so the
    // marks shop and the bank cluster are simultaneously reachable. openBank's
    // vendorOpen guard reads only openVendorNpcId (the heroic arm nulls it), so both
    // arms need their own wiring or the two windows overlap and the mobile
    // cluster-close precedence strands the bank at half-width with its x-btn hidden.
    expect(hud).toMatch(
      /openHeroicVendor\(npcId: number\): void \{[\s\S]{0,600}?if \(this\.bankWindowOpen\) this\.closeBank\(\);/,
    );
    expect(hud).toMatch(
      /openBank\(\): void \{[\s\S]{0,600}?if \(this\.openHeroicVendorNpcId !== null\) this\.closeHeroicVendor\(\);[\s\S]{0,600}?classList\.add\('bank-open'\)/,
    );
  });

  it('both mobile cluster-close paths dismiss orphaned bag prompts before hiding #bags', () => {
    // The mobile branches hide #bags without running BagsWindow.close(), so a live
    // discard/sell/deposit prompt would survive as a visible orphaned aria-modal in
    // #prompt-stack that promptModalOpen() keeps gating game keys on. Both sites
    // (closeVendor and onBankClosed) must remove the prompt node, not just clear inert.
    const sites = hud.match(/dismissBagPrompts\(\);\s*const bags = \$\('#bags'\);/g) ?? [];
    expect(sites.length).toBe(2);
  });
});

describe('bank_window: static window element is wired in both game entries', () => {
  it('index.html declares #bank-window', () => {
    expect(indexHtml).toContain('id="bank-window"');
  });

  it('play.html declares #bank-window', () => {
    expect(playHtml).toContain('id="bank-window"');
  });
});

describe('bank_window: search / sort / deposit-all', () => {
  it('mounts the toolbar between the capacity counter and the grid, always in bank state', () => {
    // The frame's scrollable body holds the capacity, toolbar, status, and grid in
    // order (appended to `body`, the .window-body of the inner frame mount).
    const capIdx = painter.indexOf("capacity.setAttribute('aria-label'");
    const barIdx = painter.indexOf('body.appendChild(this.buildFilterBar(model.empty));');
    const gridIdx = painter.indexOf("grid.className = 'bank-grid';");
    expect(capIdx).toBeGreaterThan(0);
    expect(barIdx).toBeGreaterThan(capIdx);
    expect(gridIdx).toBeGreaterThan(barIdx);
  });

  it('keeps the deposit-all button visible over an empty bank (filter controls gated)', () => {
    // buildFilterBar drops chips/search/sort when the bank is empty but always appends
    // the deposit-all button, so a fresh character can dump materials into an empty bank.
    // The indentation proves the nesting: the search append sits at 6 spaces INSIDE the
    // `if (!bankEmpty)` block, the deposit append at 4 spaces OUTSIDE it (unconditional).
    expect(painter).toMatch(/private buildFilterBar\(bankEmpty: boolean\)/);
    expect(painter).toContain('if (!bankEmpty) {');
    expect(painter).toContain('\n      tools.appendChild(searchField);'); // 6 spaces: gated
    expect(painter).toContain('\n    tools.appendChild(deposit);'); // 4 spaces: unconditional
    expect(painter).toContain('bank-deposit-all');
  });

  it('persists the filter under the bank-specific key via the tolerant parse/serialize', () => {
    expect(painter).toContain("const BANK_FILTER_KEY = 'woc_bank_filter'");
    expect(painter).toContain('parseBagFilter(localStorage.getItem(BANK_FILTER_KEY))');
    expect(painter).toContain('serializeBagFilter(this.filter)');
  });

  it('runs the pure bank filter core, never a re-derived bag filter', () => {
    expect(painter).toContain('filterBankSlots(');
    expect(painter).toContain('bagFilterIsDefault(');
    expect(painter).not.toContain('applyBagFilter(');
  });

  it('shows the no-match line under a narrowing filter and suppresses the empty pad', () => {
    expect(painter).toContain("t('hudChrome.bags.noMatch')");
    expect(painter).toContain('this.appendEmptyCells(grid, isDefault ? emptyCells : 0)');
  });

  it('refreshes ONLY the grid on a search keystroke, preserving input focus/caret + scroll', () => {
    expect(painter).toMatch(/addEventListener\('input',[\s\S]{0,140}this\.refreshGrid\(\)/);
    const refreshBody = painter.slice(
      painter.indexOf('private refreshGrid(): void {'),
      painter.indexOf('private buildFilterBar(bankEmpty: boolean): HTMLElement {'),
    );
    // Guard the slice itself: a renamed anchor would silently widen the body to EOF.
    expect(refreshBody.length).toBeGreaterThan(0);
    expect(refreshBody).toContain('private refreshGrid');
    expect(refreshBody).not.toContain('private buildBuyRow');
    expect(refreshBody).toContain(".bank-grid')");
    // The offset lives on the wrapper: emptying the grid collapses the wrapper's
    // scroll height (clamping scrollTop to 0), so it must capture + reapply.
    expect(refreshBody).toContain(".bank-scroll')");
    expect(refreshBody).toContain('if (scroll) scroll.scrollTop = prevScrollTop');
  });

  it('carries the ORIGINAL slotIndex through the filtered grid to the click handler', () => {
    expect(painter).toContain('this.onSlotClick(slot.slotIndex, ev.shiftKey)');
  });

  it('gates the deposit-all button on hasDepositableMaterials and plans + sends on click', () => {
    expect(painter).toContain("t('hudChrome.bank.depositAll')");
    expect(painter).toContain('hasDepositableMaterials(this.deps.world().inventory');
    expect(painter).toMatch(
      /for \(const send of plan\.sends\) world\.bankDeposit\(send\.slot, send\.count\)/,
    );
  });

  it('snapshots the plan against the click-time state (no mid-run re-read under mirror lag)', () => {
    const body = painter.slice(
      painter.indexOf('private onDepositAll(): void {'),
      painter.indexOf('private setDepositStatus('),
    );
    expect(body).toContain('planDepositAllMaterials(');
    expect(body).toContain('for (const send of plan.sends)');
  });

  it('renders the summary as a transient polite aria-live status line (no hud.ts toast dep)', () => {
    expect(painter).toContain("status.setAttribute('role', 'status')");
    expect(painter).toContain("status.setAttribute('aria-live', 'polite')");
    // The arm CHOICE (none fit / partial / all fit) lives in the pure core's
    // depositAllSummaryKey, pinned per-arm in bank_view.test.ts; here pin that the
    // painter delegates to it and renders the None arm count-less.
    expect(painter).toContain('depositAllSummaryKey(plan)');
    expect(painter).toContain(
      'plan.stacks === 0 ? t(key) : t(key, { count: this.fmt(plan.stacks) })',
    );
    // Pin the literal like BANK_INFO_GRACE_MS above: it drives BOTH the status-line
    // lifetime and the deposit-all pending-guard fallback timer.
    expect(painter).toContain('DEPOSIT_STATUS_MS = 4_000');
  });

  it('carries search focus and caret across a FULL render (slow-band repaint mid-typing)', () => {
    // refreshIfChanged can land a data repaint moments after the player focused the
    // search box; render() must re-focus the fresh input and restore the caret (its
    // value is restored from this.filter.search), only falling back to [data-close]
    // when the rebuild dropped the search box entirely.
    const body = painter.slice(
      painter.indexOf('render(): void {'),
      painter.indexOf('refreshIfChanged(): void {'),
    );
    expect(body).toContain('active === searchEl');
    expect(body).toContain('searchEl.selectionStart');
    expect(body).toContain('fresh.setSelectionRange(searchFocus.start, searchFocus.end)');
    expect(body).toContain('if (hadFocus && !searchFocus)');
  });

  it('holds deposit-all disabled from send until the mirror echoes (double-click guard)', () => {
    // A rapid second click online would re-plan from the STALE mirror and re-send slot
    // indices the server already spliced, banking whatever shifted into them. The guard:
    // the send path arms depositAllPending, the button's disabled expression reads it,
    // a data-signature change in refreshIfChanged clears it (the echo arrived), and a
    // fallback timer plus the close() teardown ensure it can never wedge shut.
    expect(painter).toContain('this.depositAllPending = true;');
    expect(painter).toMatch(
      /deposit\.disabled =\s*\n\s*this\.depositAllPending \|\|\s*\n\s*!hasDepositableMaterials\(/,
    );
    const refresh = painter.slice(
      painter.indexOf('refreshIfChanged(): void {'),
      painter.indexOf('private fmt('),
    );
    expect(refresh).toContain('if (sig === this.lastSig) return;');
    expect(refresh).toContain('this.clearDepositAllPending();');
    const closeBody = painter.slice(
      painter.indexOf('close(): void {'),
      painter.indexOf('private clearDepositStatus('),
    );
    expect(closeBody).toContain('this.clearDepositAllPending();');
    // The fallback timer only backstops a lost echo; it must not clear an already-cleared
    // guard into a spurious render.
    expect(painter).toContain('if (!this.depositAllPending) return;');
  });

  it('gives the deposit-all button a tokenized :focus-visible ring and pins the toolbar flex', () => {
    expect(components).toMatch(
      /\.bank-deposit-all:focus-visible \{\s*outline: 2px solid var\(--color-border-focus\);/,
    );
    expect(components).toContain('#bank-window .bag-filter-bar {');
  });
});

describe('bank_window: the bags companion repaints when a bank op moves items or coin', () => {
  // Bank ops emit no client repaint event and the bags grid has no per-frame refresh
  // (bags_window.ts pins the same constraint on its deposit side), so every
  // bank-window-initiated op that changes inventory or money must nudge the hud
  // coordinator: offline the sim applied the op synchronously and nothing else
  // repaints the bags (the reported bug: a withdraw left the bags stale until
  // close/reopen); online the nudge paints the still-stale mirror harmlessly and the
  // snapshot echo repaints again authoritatively (main.ts consumeInventoryChanged).
  it('whole-stack withdraw nudges onInventoryChanged', () => {
    // The {0,400} window keeps the pin decisive (the nearest FOREIGN nudge sits
    // thousands of chars away) while tolerating a few inserted comment lines.
    expect(painter).toMatch(
      /bankWithdraw\(action\.slotIndex\);[\s\S]{0,400}?this\.deps\.onInventoryChanged\(\);/,
    );
  });

  it('the quantity-prompt partial withdraw nudges onInventoryChanged', () => {
    expect(painter).toMatch(
      /bankWithdraw\(slotIndex, count\);[\s\S]{0,400}?this\.deps\.onInventoryChanged\(\);/,
    );
  });

  it('deposit-all nudges onInventoryChanged only when stacks were actually sent', () => {
    const startIdx = painter.indexOf('private onDepositAll(): void {');
    const endIdx = painter.indexOf('private setDepositStatus');
    // Guard BOTH slice anchors: a renamed START collapses the slice (caught by the
    // length check); a renamed END (-1) would silently widen the body to EOF, where
    // the unbounded inside-guard regex could false-pass on a FOREIGN nudge in a
    // sibling method, so pin the end anchor's existence and ordering too.
    expect(startIdx).toBeGreaterThan(-1);
    expect(endIdx).toBeGreaterThan(startIdx);
    const body = painter.slice(startIdx, endIdx);
    expect(body).toContain('private onDepositAll');
    // ...and prove the slice did not swallow a sibling op site.
    expect(body).not.toContain('bankWithdraw(');
    // The nudge sits INSIDE the sends-guard block: a no-op click (nothing fit, the
    // bank-full arm) moved nothing and must not repaint the bags.
    expect(body).toMatch(
      /if \(plan\.sends\.length > 0\) \{[\s\S]*?this\.deps\.onInventoryChanged\(\);[\s\S]*?\n {4}\}/,
    );
  });

  it('buy-slots nudges onInventoryChanged (the bags money row shows the spent coin)', () => {
    expect(painter).toMatch(/bankBuySlots\(\);[\s\S]{0,400}?this\.deps\.onInventoryChanged\(\);/);
  });

  it('hud wires the nudge to its onInventoryChanged coordinator', () => {
    // The same coordinator the online inventory-delta path calls
    // (net.consumeInventoryChanged in main.ts), so both hosts repaint the bags,
    // vendor, and character window through one seam.
    expect(hud).toContain('onInventoryChanged: () => this.onInventoryChanged(),');
  });
});

describe('bank_window: touch peek suppression', () => {
  it('consults the shared peek guard FIRST in the cell click, before onSlotClick', () => {
    // A long-press peek shows the tooltip and marks the guard; the release click must
    // consume that peek and inspect the slot instead of withdrawing. The guard check
    // must sit BEFORE onSlotClick, so deleting it (or moving onSlotClick above it)
    // reds this. A plain tap / desktop click returns false and falls through.
    expect(painter).toContain('consumePeek(): boolean;');
    expect(painter).toMatch(
      /cell\.addEventListener\('click', \(ev\) => \{[\s\S]{0,260}?if \(this\.deps\.consumePeek\(\)\) \{\s*this\.deps\.hideTooltip\(\);\s*return;\s*\}\s*this\.onSlotClick\(slot\.slotIndex, ev\.shiftKey\);/,
    );
  });

  it('hud wires consumePeek to the shared TouchPeekGuard at the BANK construction site', () => {
    // Slice to the bank construction block (its own `});` terminator, robust to a
    // constructor reorder) so this pins the BANK wiring specifically, not the
    // identically-worded bags one.
    const start = hud.indexOf('new BankWindow({');
    const bankSite = hud.slice(start, hud.indexOf('});', start));
    expect(start).toBeGreaterThan(0);
    expect(bankSite).toContain('consumePeek: () => this.peekGuard.consume(),');
  });
});

describe('bank_window: mobile pairing (hud.mobile.css)', () => {
  it('pairs the bank cluster 50/50 at a SCALE-AWARE split point, mirroring the vendor', () => {
    // #ui's zoom multiplies author lengths, so a raw 50vw split only tiles at
    // uiScale 1 (halves gap above 1, overlap below 1; the 2026-07-07 QA finding).
    // The split must divide the shared --app-vw box by the live scale.
    const split = 'calc(var(--app-vw) / var(--ui-scale, 1) / 2)';
    expect(mobileCss).toContain(
      `body.mobile-touch.bank-open #bank-window {\n    left: max(10px, env(safe-area-inset-left));\n    right: ${split};`,
    );
    expect(mobileCss).toContain(
      `body.mobile-touch.bank-open #bags {\n    left: ${split};\n    right: max(10px, env(safe-area-inset-right));`,
    );
  });

  it('standalone mobile block neutralizes the desktop dock (transform:none, max-height:none, safe-area)', () => {
    const start = mobileCss.indexOf('body.mobile-touch #bank-window {');
    const block = mobileCss.slice(start, mobileCss.indexOf('}', start));
    expect(start).toBeGreaterThan(0);
    expect(block).toContain('transform: none');
    expect(block).toContain('max-height: none');
    // Full-screen is inset-driven: the base .window max-width clamp divides by
    // --window-scale, not --ui-scale, and under-fills below uiScale 1 without this.
    expect(block).toContain('max-width: none');
    expect(block).toContain('top: max(10px, env(safe-area-inset-top))');
    // Full-height standalone (the issue-1577 bags rationale, adopted for the bank
    // by a deliberate QA adjudication); the 50/50 pairing keeps its 72px reservation.
    expect(block).toContain('bottom: max(10px, env(safe-area-inset-bottom))');
  });

  it('hides the bank close under the pairing (the bags close closes the whole cluster)', () => {
    // The frame close is .window-close (window_frame.ts); the live hide lives in
    // components.css (the AAA banner section), re-providing the legacy
    // .panel-title .x-btn hud.mobile.css rule for the grammar close, which no longer
    // matches now that the frame replaced the .panel-title chrome.
    expect(components).toMatch(
      /body\.mobile-touch\.bank-open #bank-window \.window-close \{\s*display: none;/,
    );
  });

  it('keeps every bank tap target at the 40px floor and never weakens it on mobile', () => {
    // The 40px floors live in components.css (WCAG 2.5.8: 40x40 preferred, never
    // deliberately weakened to the 24px minimum). Pin the load-bearing floors...
    expect(components).toMatch(/\.bank-item \{[^}]*min-height: 40px/);
    expect(components).toMatch(/\.bank-buy-btn \{[^}]*min-height: 40px/);
    expect(components).toMatch(/body\.mobile-touch \.bank-deposit-all \{\s*min-height: 40px;/);
    // ...and prove no mobile bank rule introduces a sub-40 min tap dimension.
    // .bank-scroll is exempt: it is the grid's scroll CONTAINER, not a tap target,
    // and its min-height is the short-viewport layout budget (the grid-floor yield
    // that keeps the buy row visible, pinned below); its cells keep the .bank-item
    // floor pinned above.
    const bankMobileRules = [
      ...mobileCss.matchAll(/(?:#bank-window|\.bank-[\w-]*)[^{}]*\{[^}]*\}/g),
    ]
      .map((m) => m[0])
      .filter((rule) => !rule.slice(0, rule.indexOf('{')).includes('.bank-scroll'))
      .join('\n');
    for (const m of bankMobileRules.matchAll(/min-(?:height|width):\s*(\d+)px/g)) {
      expect(Number(m[1])).toBeGreaterThanOrEqual(40);
    }
  });

  it('yields the grid floor on short landscape phones so the buy row stays visible', () => {
    // At phone heights the pairing box (viewport minus the 10px top inset and the
    // 72px tray reservation) cannot hold the full-toolbar chrome, the two-row
    // .bank-scroll floor (components.css), AND the buy row; without this media
    // block the transactional buy row clips below the window edge whenever the
    // vault has items (the toolbar only mounts on a non-empty vault, so an
    // empty-vault walkthrough never sees it). The scroll region yields to one
    // cell row, and to a sliver while the transient deposit-all status line
    // shows. Behavioral oracle: scripts/bank_mobile_buyrow_check.mjs (live
    // geometry at 740x360 / 844x390 / 915x412, needs npm run dev).
    const start = mobileCss.indexOf('@media (max-height: 480px)');
    expect(start).toBeGreaterThan(0);
    expect(mobileCss).toMatch(
      /@media \(max-height: 480px\) \{\s*body\.mobile-touch #bank-window \.bank-scroll \{\s*min-height: 44px;/,
    );
    expect(mobileCss).toMatch(
      /body\.mobile-touch #bank-window:has\(\.bank-status\) \.bank-scroll \{\s*min-height: 13px;/,
    );
    expect(mobileCss).toMatch(
      /body\.mobile-touch #bank-window \.bank-buy-row \{\s*margin-top: 4px;/,
    );
  });

  it('exempts the bank cluster from the window-cascade position bake (mirrors the vendor guard)', () => {
    // placeNewWindow bakes an inline cascade-offset inset; on mobile that inline inset
    // beats the docking CSS and breaks the 50/50 pairing. The bank cluster must be
    // exempted exactly as the vendor cluster is, or the mobile pairing silently regresses.
    expect(hud).toMatch(
      /classList\.contains\('bank-open'\)\s*&&\s*\(el\.id === 'bank-window' \|\| el\.id === 'bags'\)\s*\)\s*return;/,
    );
  });

  it('never cascade-pins the bags companion on vendor open (vendor-then-bank dock intact)', () => {
    // openVendor auto-opens #bags; the vendor itself floats and cascades like the
    // Market, but if placeNewWindow also cascades the COMPANION it bakes an inline
    // left/top onto #bags that survives closeVendor (nothing on the bank path
    // clears it) and beats the bank's body.bank-open dock rule (inline wins over
    // any layered rule), so the common hub flow vendor-then-bank leaves #bags
    // detached from the bank pairing. The bags half must stay exempt while
    // vendor-open, exactly as the bank cluster arm below it.
    expect(hud).toMatch(
      /classList\.contains\('vendor-open'\)\s*&&\s*el\.id === 'bags'\)\s*return;/,
    );
  });

  it('keeps the bank-cluster chips one scrollable row (no two-row wrap eating the grid)', () => {
    // At 360px-tall landscape phones a wrapped chip row squeezes the paired grid to a
    // sub-row sliver; the cluster-scoped rule keeps ONE horizontally scrollable row
    // (bank chips docked AND undocked, bags chips only inside the bank cluster; the
    // vendor cluster and standalone bags keep the family two-row wrap). Reverting
    // flex-wrap to wrap, or dropping the scoped rule, reds this.
    expect(mobileCss).toMatch(
      /body\.mobile-touch #bank-window \.bag-chips,\s*body\.mobile-touch\.bank-open #bags \.bag-chips \{[^}]*flex-wrap: nowrap;[^}]*overflow-x: auto;/,
    );
    expect(mobileCss).toMatch(
      /body\.mobile-touch #bank-window \.bag-chip,\s*body\.mobile-touch\.bank-open #bags \.bag-chip \{\s*flex: 0 0 auto;/,
    );
  });
});

describe('bank_window: keyboard a11y (non-modal activation + prompt Enter)', () => {
  it('bank and bags are in the non-modal Enter/Space activation guard (WCAG 2.1.1)', () => {
    // The bank cluster is non-modal, so canUseGameKeys() stays true while a bank
    // button has focus: without the guard, Enter opens chat and Space jumps instead
    // of activating the focused control. The guard stopPropagation's Enter/Space on
    // a focused BUTTON so native activation survives (the delve/lockpick/map family
    // precedent). Slice to the guard array so a removal reds this.
    const start = hud.indexOf("'#delve-board',");
    const guardArray = hud.slice(start, hud.indexOf(']', start));
    expect(start).toBeGreaterThan(0);
    expect(guardArray).toContain("'#bank-window'");
    expect(guardArray).toContain("'#bags'");
  });

  it('an open aria-modal prompt suppresses game keybinds (WCAG 2.4.3 focus return)', () => {
    // Enter that confirms a bank prompt synchronously re-focuses a button; the same
    // keydown then bubbles to the window handler, and without this gate the chat
    // bind fires and steals the focus return. promptModalOpen() matches ONLY the
    // installPromptDialog family (party/trade/duel prompts carry no aria-modal and
    // must stay non-blocking), and every canUseGameKeys predicate consults it.
    expect(hud).toContain('promptModalOpen(): boolean {');
    expect(hud).toContain(
      `$('#prompt-stack').querySelector('.prompt[aria-modal="true"]') !== null`,
    );
    const gateSites = mainSrc.match(/!hud\.promptModalOpen\(\)/g) ?? [];
    expect(gateSites.length).toBeGreaterThanOrEqual(3);
    expect(mainSrc).toMatch(
      /canUseGameKeys: \(\) =>\s*!hud\.isModalOpen\(\) && !hud\.promptModalOpen\(\) && chatInput\.style\.display !== 'block'/,
    );
  });

  it('the prompt itself stops Enter/Space propagation (the submit-dismiss race)', () => {
    // The window-level gate alone is NOT enough: submit() removes the prompt node
    // synchronously during the Enter keydown, so by the time the event reaches the
    // window handler promptModalOpen() is already false and the chat bind fires.
    // The prompt's own keydown listener must stop the bubble, and once the prompt
    // was detached mid-dispatch it must ALSO cancel the default (or the browser
    // runs the activation against the re-landed focus, Enter ghost-clicking
    // [data-close]). The older Escape-only handling must red this.
    expect(painter).toMatch(
      /if \(ke\.key === 'Enter' \|\| ke\.key === ' ' \|\| ke\.code === 'Space'\) \{\s*ke\.stopPropagation\(\);\s*if \(!prompt\.isConnected\) ke\.preventDefault\(\);\s*return;\s*\}/,
    );
  });
});

describe('bank_window: bonus-slot breakdown footer', () => {
  it('rides the bonus section as the tail of the shared .bank-scroll region', () => {
    // Order pin: grid into the scroll wrapper, bonus after it (the tail), the wrapper
    // into the window, and the transactional buy row pinned AFTER the wrapper so it
    // stays visible while the region scrolls (the 360px-phone budget: a fixed footer
    // below the buy row crushed the grid or clipped itself, found live in QA).
    const renderBody = painter.slice(
      painter.indexOf('render(): void {'),
      painter.indexOf('refreshIfChanged(): void {'),
    );
    const gridIdx = renderBody.indexOf('scroll.appendChild(grid);');
    const bonusIdx = renderBody.indexOf('this.buildBonusSection(model.bonus)');
    const bonusAppendIdx = renderBody.indexOf('scroll.appendChild(bonus);');
    // The scroll region goes into the frame body; the buy row into the sticky footer.
    const scrollIdx = renderBody.indexOf('body.appendChild(scroll);');
    const buyIdx = renderBody.indexOf('footer.appendChild(this.buildBuyRow(model.buy));');
    expect(gridIdx).toBeGreaterThan(0);
    expect(bonusIdx).toBeGreaterThan(gridIdx);
    expect(bonusAppendIdx).toBeGreaterThan(bonusIdx);
    expect(scrollIdx).toBeGreaterThan(bonusAppendIdx);
    expect(buyIdx).toBeGreaterThan(scrollIdx);
  });

  it('builds a labelled group section and SKIPS an unknown source id (forward compat)', () => {
    expect(painter).toContain('private buildBonusSection(');
    expect(painter).toContain("setAttribute('role', 'group')");
    // The unknown-id skip arm: a source id absent from the known-source map is dropped
    // rather than rendering a raw key or an English fallback (a future X/Twitch row).
    expect(painter).toContain('const meta = BANK_BONUS_SOURCE_KEYS[row.id];');
    expect(painter).toMatch(/if \(!meta\) continue;/);
  });

  it('references every bonus t() key (title, total, labels, adverts, progress, aria)', () => {
    for (const key of [
      'hudChrome.bank.bonusTitle',
      'hudChrome.bank.bonusEarned',
      'hudChrome.bank.bonusStatusEarned',
      'hudChrome.bank.bonusSourceEmail',
      'hudChrome.bank.bonusSourceDiscord',
      'hudChrome.bank.bonusSourceWallet',
      'hudChrome.bank.bonusSourceReferral',
      'hudChrome.bank.bonusAdvertEmail',
      'hudChrome.bank.bonusAdvertDiscord',
      'hudChrome.bank.bonusAdvertWallet',
      'hudChrome.bank.bonusReferralProgress',
      'hudChrome.bank.bonusReferralExplainer',
      'hudChrome.bank.bonusSectionAria',
    ]) {
      expect(painter, `missing t() key ${key}`).toContain(key);
    }
  });

  it('shows referral progress from count/cap, earned link sources as +N, unearned as the advert', () => {
    expect(painter).toContain(
      'const hasProgress = row.count !== undefined && row.cap !== undefined;',
    );
    expect(painter).toContain("t('hudChrome.bank.bonusReferralProgress', {");
    expect(painter).toContain(
      "t('hudChrome.bank.bonusStatusEarned', { count: this.fmt(row.slots) })",
    );
    expect(painter).toContain('t(meta.advert)');
  });

  it('drives every bonus string through t(), never a bare English literal', () => {
    const body = painter.slice(
      painter.indexOf('private buildBonusSection('),
      painter.indexOf('private showBuySlotsPrompt('),
    );
    expect(body.length).toBeGreaterThan(0);
    expect(body).not.toContain('private showBuySlotsPrompt'); // slice guard
    // No bare-string textContent or aria-label assignment: every visible string is a
    // t() key (role='group' is a fixed ARIA value, not player-facing copy).
    expect(body).not.toMatch(/textContent = '/);
    expect(body).not.toMatch(/setAttribute\('aria-label', '/);
  });

  it('the .bank-bonus CSS block carries no literal hex (tokens / color-mix only)', () => {
    const start = components.indexOf('.bank-bonus {');
    const end = components.indexOf('/* Desktop side-by-side docking', start);
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const bonusCss = components.slice(start, end);
    const hex = bonusCss.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
    expect(hex, `bonus CSS must use tokens: ${hex.join(', ')}`).toEqual([]);
  });

  it('the .bank-scroll wrapper owns the scroll (two-row floor); the grid does not', () => {
    // Found live in QA at 740x360: a rigid flex:none footer below the buy row
    // crushed the grid to a 4px sliver and clipped its own rows past the window
    // bottom. The contract: ONE scroll region (grid + bonus tail) with a two-row
    // floor, so cells and bonus copy are both reachable on every viewport.
    const scroll = components.slice(
      components.indexOf('.bank-scroll {'),
      components.indexOf('.bank-grid {'),
    );
    expect(scroll).toContain('flex: 1 1 auto;');
    expect(scroll).toContain('min-height: 92px;');
    expect(scroll).toContain('overflow-y: auto;');
    expect(scroll).toContain('touch-action: pan-y;');
    const grid = components.slice(
      components.indexOf('.bank-grid {'),
      components.indexOf('.bank-item {'),
    );
    expect(grid).not.toContain('overflow-y');
    expect(grid).not.toContain('min-height');
  });
});
