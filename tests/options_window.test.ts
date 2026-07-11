import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Source-level guards for the redesigned options painter (the Warden's Codex
// desktop chrome, P2). The pure control descriptors + the per-kind dispatch
// coercion are unit-tested in options_view.test.ts; here we pin the no-magic
// contract, the tier boundary, the WCAG roles/focus-return, the frame adoption,
// the two-pane structure, and (the load-bearing one) that every setting row
// still fires the SAME dispatch write it did before the redesign.
const painter = readFileSync(new URL('../src/ui/options_window.ts', import.meta.url), 'utf8');
const hudTs = readFileSync(new URL('../src/ui/hud.ts', import.meta.url), 'utf8');

describe('options_window: no magic values', () => {
  it('carries no literal color in TS (colors live in the extracted stylesheet)', () => {
    const hex = painter.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
    expect(hex, `hex colors must move to tokens/CSS: ${hex.join(', ')}`).toEqual([]);
    expect(painter, 'rgb()/hsl() color literal must move to tokens/CSS').not.toMatch(
      /\b(?:rgba?|hsla?)\(/,
    );
  });

  it('names its numeric thresholds instead of bare literals', () => {
    expect(painter).toContain('RANGE_FILL_FULL_PCT');
    expect(painter).toContain('const BUG_DESC_MAX_LEN = 2000;');
    expect(painter.match(/\b2000\b/g) ?? []).toHaveLength(1);
  });

  it('uses no em or en dashes (ASCII separators only)', () => {
    expect(painter.includes('—'), 'em dash found').toBe(false);
    expect(painter.includes('–'), 'en dash found').toBe(false);
  });
});

describe('options_window: tier boundary', () => {
  it('reads the graphics preset as a plain setting value, never the governor/cutoff', () => {
    expect(painter).not.toContain('ui_effects_profile');
    expect(painter).not.toContain('EFFECTS_QUALITY_LOW_CUTOFF');
    expect(painter).not.toMatch(/governor\s*[.(]/);
    expect(painter).not.toMatch(/\.state\(\)\.levels/);
  });
});

describe('options_window: window-frame adoption + XL two-pane shell', () => {
  it('renders #options-menu through the shared window-frame builder', () => {
    expect(painter).toContain(
      "import { renderWindowFrame, type WindowFrameParts } from './window_frame'",
    );
    expect(painter).toContain("id: 'options-menu'");
    expect(painter).toContain(
      'renderWindowFrame(mount, OPTIONS_FRAME, { onClose: () => this.close() })',
    );
    // The frame's footer carries the transactional footer row.
    expect(painter).toContain('footer: true');
  });

  it('builds the recessed rail (role=tablist) + detail two-pane and the shell search strip', () => {
    expect(painter).toContain("el('div', 'opt-rail')");
    expect(painter).toContain("rail.setAttribute('role', 'tablist')");
    expect(painter).toContain("rail.setAttribute('aria-orientation', 'vertical')");
    expect(painter).toContain("el('div', 'opt-detail')");
    expect(painter).toContain("el('div', 'opt-search')");
    expect(painter).toContain("t('hudChrome.options.searchPlaceholder')");
    // scope chips
    expect(painter).toContain("'hudChrome.options.searchScopeAll'");
    expect(painter).toContain("'hudChrome.options.searchScopeThis'");
  });
});

describe('options_window: always opens on Overview (never last-visited)', () => {
  it('the toggle path resets to the Overview landing with the All scope', () => {
    const toggle = painter.slice(painter.indexOf('toggle(): void {'));
    const body = toggle.slice(0, toggle.indexOf('\n  }\n'));
    expect(body).toContain("this.activeCategory = 'overview'");
    expect(body).toContain("this.searchScope = 'all'");
    expect(body).toContain("this.subView = 'none'");
  });

  it('the default field value is the Overview landing', () => {
    expect(painter).toContain("private activeCategory: CategoryId = 'overview';");
  });

  it('opens with focus ON the Overview rail tab (spec section 5; seeds controller routing)', () => {
    const toggle = painter.slice(painter.indexOf('toggle(): void {'));
    const body = toggle.slice(0, toggle.indexOf('\n  }\n'));
    // Desktop / wide rail: the active Overview tab. Narrow back-stack shell (F3):
    // no rail tab exists (and the frame X is display:none), so the FIRST CATEGORY
    // TILE seeds focus. The search input must NOT appear in the seed selector at
    // all: auto-focusing it popped the soft keyboard on every touch open, and a
    // comma list cannot rank it second (querySelectorAll resolves selector lists
    // in DOM order and the input sits above the grid).
    expect(body).toContain("? '.opt-mshell-cat' : '.opt-tab.is-active'");
    expect(body).not.toContain('.opt-mshell-search .search-input, .opt-mshell-cat');
    expect(body).toContain(": '.opt-tab.is-active'");
    expect(body).toContain('this.deps.focusFirstInteractive(this.deps.root(), preferred)');
  });
});

describe('options_window: WCAG 2.2 AA', () => {
  it('returns focus to the opener on every close path', () => {
    expect(painter).toContain('captureFocus');
    expect(painter).toContain('restoreFocus');
    const close = painter.slice(painter.indexOf('close(): void {'));
    expect(close.slice(0, close.indexOf('\n  }\n'))).toContain('this.deps.restoreFocus(target)');
  });

  it('exposes programmatic roles/labels on its controls', () => {
    // sliders are native range inputs with an aria-label + human readout
    expect(painter).toContain("slider.type = 'range'");
    expect(painter).toContain("slider.setAttribute('aria-label', label)");
    expect(painter).toContain("slider.setAttribute('aria-valuetext', text)");
    // the switch replaces the ON/OFF button: role=switch + aria-checked
    expect(painter).toContain("toggle.setAttribute('role', 'switch')");
    expect(painter).toContain("toggle.setAttribute('aria-checked'");
    // segmented choice is a radiogroup of radios
    expect(painter).toContain("seg.setAttribute('role', 'radiogroup')");
    expect(painter).toContain("btn.setAttribute('role', 'radio')");
    // async status + error live regions in the bug report / language flows
    expect(painter).toContain("status.setAttribute('role', 'status')");
    expect(painter).toContain("error.setAttribute('role', 'alert')");
  });
});

// The load-bearing guard: the DOM grammar changed but every setting write is
// byte-identical to the pre-redesign painter (the dispatch-parity contract).
describe('options_window: control-primitive dispatch wiring', () => {
  it('routes each descriptor kind to its matching builder', () => {
    expect(painter).toContain('this.settingSlider(parent, c, hooks)');
    expect(painter).toContain('this.settingToggle(parent, c, hooks)');
    expect(painter).toContain('this.settingBoolToggle(parent, c, hooks)');
    expect(painter).toContain(
      'this.settingChoice(parent, c, hooks, c.rerender ? rerender : undefined)',
    );
  });

  it('fires the exact same setting write per control kind as the inline original', () => {
    expect(painter).toContain('hooks.onSettingChange(key, sliderDispatchValue(slider.value))');
    expect(painter).toContain(
      'hooks.onSettingChange(key, toggleNextValue(hooks.settings.get(key)))',
    );
    expect(painter).toContain(
      'hooks.settings.set(key, boolToggleNextValue(hooks.settings.get(key)))',
    );
    expect(painter).toContain('hooks.onSettingChange(key, option.value)');
  });

  it('binds each row through the shared env-gated options_view builder (no forked logic)', () => {
    // The ONE cap/env gating path (S1): detail pane, Overview pins, and global
    // search all bind through buildEnvGatedControl, never the raw builder (which
    // would bypass the native-shell preset cap and the env-hidden rows).
    expect(painter).toContain('buildEnvGatedControl(source, row, this.renderEnv())');
    expect(painter).toContain('buildEnvGatedControl(source, homeRow, this.renderEnv())');
    expect(painter).toContain('buildEnvGatedControl(source, row, env)');
    expect(painter).not.toContain('buildControlFromRow(');
  });
});

describe('options_window: changeLanguage hardening (PR #730 preserved)', () => {
  it('guards re-entry, reverts in place on failure, and never sticks busy', () => {
    const lang = painter.slice(
      painter.indexOf('private languageRow'),
      painter.indexOf('private themeRow'),
    );
    expect(lang).toContain('let busy = false');
    expect(lang).toContain(
      'if (busy || !isSupportedLanguage(selected) || selected === getLanguage())',
    );
    expect(lang).toContain('.changeLanguage(selected');
    expect(lang).toContain('this.deps.setDropdownValue(dropdown, getLanguage())');
    expect(lang).toContain('.catch(');
    expect(lang).toContain('.finally(');
  });

  // L2: a successful language switch re-renders the WHOLE window (rail, footer,
  // search strip, shell chrome all carry t() text), not just an interface detail
  // pane, and it does so whenever the window is open (a switch from an Overview
  // pin or a search result previously re-rendered nothing). Focus returns to the
  // language dropdown so the relocalized picker stays keyboard-navigable.
  it('re-renders the full window and refocuses the picker on a successful switch', () => {
    const lang = painter.slice(
      painter.indexOf('private languageRow'),
      painter.indexOf('private themeRow'),
    );
    expect(lang).toContain('if (this.isOpen) {');
    expect(lang).toContain('this.render();');
    expect(lang).not.toContain("this.activeCategory === 'interface'");
    expect(lang).toContain("'.set-lang-select .ui-dd-btn'");
  });
});

describe('options_window: theme custom-color grid preserved under Interface', () => {
  it('renders the preset segments + the per-knob custom colour grid', () => {
    const theme = painter.slice(painter.indexOf('private themeRow'));
    const body = theme.slice(0, theme.indexOf('\n  private '));
    expect(body).toContain('theme.setPreset(id)');
    expect(body).toContain("input.type = 'color'");
    expect(body).toContain('theme.setCustom(knob, input.value)');
    expect(body).toContain('theme.resetCustom()');
  });

  it('keeps the full custom-color block on the category + search paths (default opts)', () => {
    // Mirror-only rendering is the PIN path's mode; the Interface page and the
    // search results must keep the whole block via the no-opts calls.
    expect(painter).toContain('this.themeRow(secEl);');
    expect(painter).toContain('this.themeRow(group)');
  });
});

describe('options_window: Overview pins are one wrapper cell each', () => {
  // The mobile shell's 2-column section grid treats every non-.opt-row child as
  // a full-width break, so a pin appended as loose row + crumb siblings strands
  // the whole Overview in the left column (the crumb after each row forces a
  // new grid row and column 2 never fills). Each pin must render into ONE
  // .opt-pin cell carrying its row(s) + home crumb, and the theme pin must be a
  // MIRROR of the preset control only (the Custom Colors block is the Interface
  // page's, per the options_ia OverviewPin contract).
  it('wraps each pin (row + home crumb) in an .opt-pin cell, theme pin mirror-only', () => {
    const pins = painter.slice(
      painter.indexOf('private appendOverviewPins'),
      painter.indexOf('private appendOverviewStatus'),
    );
    expect(pins).toContain("el('div', 'opt-pin')");
    expect(pins).toContain('this.themeRow(pinCell, { withCustomColors: false })');
    expect(pins).toContain('pinCell.appendChild(crumb)');
    expect(pins).toContain('pinsSection.appendChild(pinCell)');
  });

  it('the mobile 2-col escape rule exempts .opt-pin so pins fill both columns', () => {
    const mobile = readFileSync(new URL('../src/styles/hud.mobile.css', import.meta.url), 'utf8');
    expect(mobile).toContain('> :not(.opt-row, .opt-pin)');
  });
});

describe('options_window: controller Button Layout joins the section grammar', () => {
  // The remap rows used to append straight to the detail pane: the touch
  // shell's 2-column layout is display:grid on .opt-section ITSELF, so rows
  // outside a section could never become grid cells and the whole Button
  // Layout stacked single-column (live maintainer feedback).
  it('wraps the head, remap rows, and reset inside one .opt-section', () => {
    const ctrl = painter.slice(painter.indexOf('private renderControllerButtons'));
    const body = ctrl.slice(0, ctrl.indexOf('\n  private '));
    expect(body).toContain("const section = el('div', 'opt-section');");
    expect(body).toContain('section.appendChild(head)');
    expect(body).toContain('section.appendChild(row)');
    expect(body).toContain('section.appendChild(reset)');
    expect(body).not.toContain('parent.appendChild(row)');
  });
});

describe('options_window: renderDetail is back-stack shell safe', () => {
  // Shared row handlers (theme preset, Custom Colors reset, controller remap
  // rows, every rerender:true choice) call renderDetail() from shell pages,
  // where the desktop '.opt-detail-inner' pane does not exist: the unguarded
  // detailEl() deref threw on the first theme-preset tap of a touch session.
  // The dispatcher must route the shell to the full render() FIRST.
  it('guards the desktop pane deref behind backStackActive()', () => {
    const detail = painter.slice(painter.indexOf('private renderDetail'));
    const body = detail.slice(0, detail.indexOf('\n  private '));
    const guard = body.indexOf('if (this.backStackActive())');
    const deref = body.indexOf('this.detailEl()');
    expect(guard).toBeGreaterThan(-1);
    expect(deref).toBeGreaterThan(guard);
  });
});

describe('options_window: bug-report dispatch + async states (preserved)', () => {
  it('preserves the submit action and the no-text / in-flight / failure states', () => {
    const bug = painter.slice(
      painter.indexOf('private renderBugReport'),
      painter.indexOf('private localizeBugReportError'),
    );
    expect(bug).toContain("error.textContent = t('hudChrome.bugReport.describeFirst')");
    expect(bug).toContain('submit.disabled = true');
    expect(bug).toContain('hooks\n        .submit({ description');
    expect(bug).toContain('hudChrome.bugReport.submittedNoShot');
    expect(bug).toContain('submit.disabled = false');
    expect(bug).toContain('this.localizeBugReportError(err)');
  });
});

describe('options_window: keybind rebind dispatch (unchanged until P4)', () => {
  it('captures a key and binds it to the same action/index', () => {
    expect(painter).toContain('private beginCapture(actionId: string, index: number');
    expect(painter).toContain('hooks.captureKey((code)');
    expect(painter).toContain('this.deps.keybinds().bind(actionId, index, code)');
    expect(painter).toContain('this.deps.refreshKeybindLabels()');
  });

  // Restored coverage (P2 review item 1): each controller per-button remap listbox
  // carries its physical button glyph as its accessible name.
  it('names each gamepad-remap listbox with its button glyph', () => {
    const controller = painter.slice(painter.indexOf('private renderControllerButtons'));
    const body = controller.slice(0, controller.indexOf('\n  private '));
    expect(body).toContain('ariaLabel: buttonLabel');
  });
});

describe('options_window: rebind UX (P4)', () => {
  const components = readFileSync(new URL('../src/styles/components.css', import.meta.url), 'utf8');

  it('captures through a canceller and has THREE independent exits', () => {
    // The capture returns a canceller stored for the non-Escape exits.
    expect(painter).toContain('this.captureCancel = hooks.captureKey((code)');
    // Exit 1: physical Escape -> the capture callback receives null (input.ts fires it),
    // handled here as the cancelled path.
    const begin = painter.slice(painter.indexOf('private beginCapture'));
    const body = begin.slice(0, begin.indexOf('\n  // ----'));
    expect(body).toContain('if (code === null) {');
    expect(body).toContain("t('hud.options.keybindCancelled')");
    // Exit 2: on-screen Cancel affordance on the capturing row.
    expect(painter).toContain("el('button', 'btn kb-cancel')");
    expect(painter).toContain("cancel.addEventListener('click', () => this.cancelCapture())");
    // Exit 3: focus-loss / blur while capturing.
    expect(painter).toContain("key.addEventListener('blur', () => this.cancelCapture())");
    // The canceller fires the callback once (a no-op afterwards).
    expect(painter).toContain('private cancelCapture(): void {');
    expect(painter).toContain('this.captureCancel?.();');
  });

  it('announces rebind start / cancel / reserved / bound assertively', () => {
    const begin = painter.slice(painter.indexOf('private beginCapture'));
    const body = begin.slice(0, begin.indexOf('\n  // ----'));
    expect(body).toContain(
      "this.announce(t('hudChrome.options.keybindRebinding', { action: name }))",
    );
    expect(body).toContain("this.announce(t('hud.options.keybindCancelled'))");
    expect(body).toContain('isReservedCode(code)');
    expect(body).toContain("this.announce(t('hud.options.keybindReserved'");
  });

  it('surfaces an eviction with the exact wording + a transient row badge', () => {
    const begin = painter.slice(painter.indexOf('private beginCapture'));
    const body = begin.slice(0, begin.indexOf('\n  // ----'));
    // Names the exact evicted action(s) off the BEFORE snapshot via the pure helper.
    expect(body).toContain('const before = this.keyboardConflictRows();');
    expect(body).toContain('evictedActions(before, actionId, stored)');
    expect(body).toContain("t('hudChrome.options.keybindEvicted', {");
    expect(body).toContain('this.evictedRows = evicted;');
    // Transient .ui-badge.badge-warning chip painted on the displaced row same-render.
    expect(painter).toContain("el('span', 'ui-badge badge-warning kb-evicted')");
    expect(painter).toContain("t('hudChrome.options.keybindTaken')");
  });

  it('lists fully-unbound actions in a persistent error banner', () => {
    const table = painter.slice(painter.indexOf('private renderKeybindTable'));
    const body = table.slice(0, table.indexOf('\n  /** Cancel'));
    expect(body).toContain('const conflicts = this.computeConflicts();');
    expect(body).toContain('if (conflicts.unbound.length > 0) {');
    expect(body).toContain("el('div', 'error-banner')");
    expect(body).toContain("t('hudChrome.options.keybindUnbound', {");
  });

  it('unbinds a focused cap on Delete/Backspace (not while capturing)', () => {
    const detail = painter.slice(painter.indexOf('private onDetailKeydown'));
    const body = detail.slice(0, detail.indexOf('\n  /** The authoritative'));
    expect(body).toContain("kind === 'keybind'");
    expect(body).toContain('!this.capturingKey');
    expect(body).toContain("e.key === 'Delete' || e.key === 'Backspace'");
    expect(body).toContain('this.clearFocusedKeybind();');
  });

  it('breathes the capturing cap at fx medium+ with a steady low-fx / reduced-motion fallback', () => {
    const cap = components.slice(components.indexOf('.kb-key.capturing {'));
    const block = cap.slice(0, cap.indexOf('}'));
    expect(block).toContain('animation: kb-capture-breathe');
    // Steady border (no animation) at low fx and under reduced motion.
    expect(components).toContain(':root[data-fx-level="low"] .kb-key.capturing {');
    const reduced = components.slice(components.indexOf('@keyframes kb-capture-breathe'));
    expect(reduced).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{\s*\.kb-key\.capturing \{\s*animation: none;/,
    );
  });
});

describe('options_window: conflict surfacing (P4)', () => {
  const components = readFileSync(new URL('../src/styles/components.css', import.meta.url), 'utf8');

  it('reads ONE keybind_conflicts aggregate for the whole surface', () => {
    // The pure core adapts the two live tables (Attack Move omitted while off).
    expect(painter).toContain('private keyboardConflictRows(): KeyboardBindRow[]');
    expect(painter).toContain("a.id !== 'attackMove' || attackMoveOn");
    expect(painter).toContain('private controllerConflictRows(): ControllerBindRow[]');
    expect(painter).toContain('return computeKeybindConflicts(');
  });

  it('shows a per-category rail dot fed by the aggregate, outside the collapsing label', () => {
    const rail = painter.slice(painter.indexOf('private renderRail(): void {'));
    const body = rail.slice(0, rail.indexOf('\n  private railTab'));
    expect(body).toContain('const conflicts = this.computeConflicts();');
    expect(body).toContain("(id === 'keybinds' && conflicts.keyboardWarning)");
    expect(body).toContain("(id === 'controller' && conflicts.controllerWarning)");
    // The dot is a direct tab child (not inside .opt-tab-label), with an a11y name.
    expect(painter).toContain("el('span', 'opt-tab-dot')");
    expect(painter).toContain("t('hudChrome.options.conflictDot')");
    // The dot is NOT in the 900px icon-collapse hidden set, so it survives collapse.
    // The collapse is a CONTAINER query (reacts to the resized/dragged window width).
    const collapse = components.slice(
      components.indexOf('@container opt-shell (max-width: 900px)'),
    );
    const block = collapse.slice(0, collapse.indexOf('\n  }\n  /*'));
    expect(block).not.toContain('opt-tab-dot');
    // A forced-colours fill keeps the dot visible when the palette drops color.
    const forced = components.slice(components.indexOf('@media (forced-colors: active)'));
    expect(forced).toContain('.opt-tab-dot {');
  });

  it('links an Overview alert to Keybinds on a keyboard conflict (desktop only)', () => {
    const overview = painter.slice(painter.indexOf('private renderOverview'));
    const body = overview.slice(0, overview.indexOf('\n  private quickActionAvailable'));
    expect(body).toContain('this.computeConflicts().keyboardWarning && !this.env().touch');
    expect(body).toContain("t('hudChrome.options.overviewConflictAlert')");
    expect(body).toContain("this.setActiveCategory('keybinds')");
  });

  it('chips a controller row that shares its action, naming the sibling buttons', () => {
    const controller = painter.slice(painter.indexOf('private renderControllerButtons'));
    const body = controller.slice(0, controller.indexOf('\n  // ----'));
    expect(body).toContain('this.computeConflicts().controllerDuplicates');
    expect(body).toContain('dup.labels.filter((_, i) => dup.buttons[i] !== button)');
    expect(body).toContain("el('span', 'ui-badge badge-warning opt-dup-chip')");
    expect(body).toContain("t('hudChrome.controller.duplicate', { buttons:");
    // A duplicate created by THIS remap surfaces its chip live (re-render + refocus).
    expect(body).toContain('hooks.gamepad.bind(button, v);');
    expect(body).toContain('.opt-row[data-button="${button}"] .ui-dd-btn');
    // Reset + pad connect/disconnect still re-render the pane (preserved).
    expect(body).toContain('hooks.gamepad.reset();');
    const refresh = painter.slice(painter.indexOf('refreshControllerLabels(): void'));
    expect(refresh.slice(0, refresh.indexOf('\n  //'))).toContain('this.renderDetail()');
  });

  it('refreshes the rail dot (not just the detail) on every conflict-changing mutation', () => {
    // A stale rail dot that contradicts the pane banner is the bug this guards: each
    // in-pane keybind/controller mutation must re-render the RAIL as well.
    // Rebind/evict callback:
    const begin = painter.slice(painter.indexOf('private beginCapture'));
    expect(begin.slice(0, begin.indexOf('\n  // ----'))).toContain('this.renderRail();');
    // Delete/Backspace + controller X clear:
    const clear = painter.slice(painter.indexOf('private clearFocusedKeybind'));
    expect(clear.slice(0, clear.indexOf('\n  /** RT/LT'))).toContain('this.renderRail();');
    // Keybind reset, controller reset + remap, and pad connect/disconnect:
    expect(painter).toContain(
      'this.renderRail(); // reset restores the warning-free default layout (clears any dot)',
    );
    expect(painter).toContain('this.renderRail(); // reset clears duplicates');
    const refresh = painter.slice(painter.indexOf('refreshControllerLabels(): void'));
    expect(refresh.slice(0, refresh.indexOf('const footer'))).toContain('this.renderRail();');
  });

  it('routes the pad connect refresh through the shell painter on the back-stack', () => {
    // gamepadconnected/disconnected -> hud -> refreshControllerLabels() also fires
    // with the options open on the NARROW mobile shell, where no .opt-rail exists:
    // the desktop rail/detail/footer trio would deref the null rail and THROW on
    // the very event this refresh exists for. The refresh must branch to render()
    // (the shell painter, idempotent for the current stack page) BEFORE any rail
    // work.
    const refresh = painter.slice(painter.indexOf('refreshControllerLabels(): void'));
    const beforeRail = refresh.slice(0, refresh.indexOf('this.renderRail();'));
    expect(beforeRail).toContain("if (this.renderMode() === 'backstack')");
    expect(beforeRail).toContain('this.render();');
  });
});

describe('options_window: search go-to + synonyms + typeahead (P4)', () => {
  const hud = readFileSync(new URL('../src/ui/hud.ts', import.meta.url), 'utf8');

  it('lands a steady .is-active-row highlight on the target row via the focus path', () => {
    const search = painter.slice(painter.indexOf('private renderSearchResults'));
    const body = search.slice(0, search.indexOf('\n  /** True when a category'));
    // Go to section jumps to the home category then highlights the first matched row.
    expect(body).toContain('this.setActiveCategory(cat.id);');
    expect(body).toContain('this.highlightRow(landKey);');
    // highlightRow focuses the row control, which fires the SAME steady focusin cursor
    // the keyboard/controller use (no flash animation), then scrolls it into view.
    expect(painter).toContain('private highlightRow(key: string): void {');
    expect(painter).toContain('.opt-row[data-key="${key}"]');
    expect(painter).toContain('.querySelector<HTMLElement>(FOCUSABLE_SELECTOR) ?? row).focus()');
    expect(painter).toContain("row.scrollIntoView?.({ block: 'nearest' })");
  });

  it('surfaces the bespoke Keybinds category via the category synonym overlay', () => {
    expect(painter).toContain('categoriesForSearch');
    const search = painter.slice(painter.indexOf('private renderSearchResults'));
    const body = search.slice(0, search.indexOf('\n  /** True when a category'));
    expect(body).toContain('for (const catId of categoriesForSearch(query)) {');
    expect(body).toContain('if (shownCats.has(catId)) continue;');
    expect(body).toContain('this.categoryVisible(cat)');
  });

  it('surfaces the keyless language + theme rows in global search, editable (M3)', () => {
    const search = painter.slice(painter.indexOf('private renderSearchResults'));
    const body = search.slice(0, search.indexOf('\n  /** True when a category'));
    // The non-settings rows are folded into their home category group, matched by
    // label/synonym, and rendered through the SAME bespoke painters as the detail.
    expect(body).toContain('NON_SETTING_SEARCH_ROWS.filter(');
    expect(body).toContain('nonSettingRowMatches(r, t(r.labelKey), query)');
    expect(body).toContain('this.languageRow(group)');
    expect(body).toContain('this.themeRow(group)');
  });

  it('applies the Advanced-graphics preset gate to the search visibleKeys (M4)', () => {
    const search = painter.slice(painter.indexOf('private renderSearchResults'));
    const body = search.slice(0, search.indexOf('\n  /** True when a category'));
    // The four Advanced sub-pickers must not surface (or be editable) via search
    // until the Advanced preset (5), mirroring the renderCategoryDetail gate.
    expect(body).toContain(
      "cat.id === 'graphics' && Math.round(hooks.settings.get('graphicsPreset')) !== 5",
    );
    expect(body).toContain('for (const k of ADVANCED_GFX_KEYS) visibleKeys.delete(k);');
  });

  it('gives long listboxes first-letter typeahead (language picker)', () => {
    // The shared dropdown builder wires the pure typeahead for 7+ options.
    expect(hud).toContain('items.length >= TYPEAHEAD_MIN_OPTIONS');
    expect(hud).toContain('const target = typeaheadTarget(');
    expect(hud).toContain('items[target].focus();');
  });
});

describe('options_window: keyboard navigation (P3)', () => {
  const components = readFileSync(new URL('../src/styles/components.css', import.meta.url), 'utf8');

  it('makes the rail a VERTICAL roving tablist: Up/Down/Home/End move + auto-activate', () => {
    const rail = painter.slice(painter.indexOf('private onRailKeydown'));
    const body = rail.slice(0, rail.indexOf('\n  private onBodyKeydown'));
    // roving via the shared core in the 'vertical' orientation (leaves Left/Right free).
    expect(body).toContain("rovingTarget(e.key, current, tabs.length, 'vertical')");
    // aria-selected-follows-focus: activate the roved category, preserving the rail node.
    expect(body).toContain('this.setActiveCategory(id, { preserveRailFocus: true })');
    expect(body).toContain('tab.focus()');
  });

  it('auto-activation re-renders the DETAIL only (the rail tab element survives)', () => {
    const set = painter.slice(painter.indexOf('private setActiveCategory'));
    const body = set.slice(0, set.indexOf('\n  /** The rail'));
    // The preserve path updates the rail in place + repaints the detail, never render().
    expect(body).toContain('if (opts.preserveRailFocus) {');
    expect(body).toContain('this.syncRailActive();');
    expect(body).toContain('this.renderDetail();');
    // syncRailActive toggles the tab state without rebuilding the rail (no replaceChildren).
    const sync = painter.slice(painter.indexOf('private syncRailActive'));
    const syncBody = sync.slice(0, sync.indexOf('\n  /**'));
    expect(syncBody).toContain("tab.classList.toggle('is-active', active)");
    expect(syncBody).not.toContain('replaceChildren');
    // Roving stop via railTabStop (F2: during a sub-view the home category keeps
    // the rail's single Tab stop instead of the rail dropping to zero stops).
    expect(syncBody).toContain('this.railTabStop(id, active) ? 0 : -1');
    expect(painter).toContain('private railTabStop(id: CategoryId, active: boolean): boolean');
  });

  it('cycles categories with Ctrl+Tab / Ctrl+Shift+Tab from the body', () => {
    const body = painter.slice(painter.indexOf('private onBodyKeydown'));
    const fn = body.slice(0, body.indexOf('\n  /** In-row value keys'));
    expect(fn).toContain("if (e.key !== 'Tab' || !e.ctrlKey) return;");
    expect(fn).toContain('wrapIndex(visible.length, current, e.shiftKey ? -1 : 1)');
    expect(fn).toContain('preserveRailFocus: true');
  });

  it('routes in-row value keys through the pure model per control kind', () => {
    const detail = painter.slice(painter.indexOf('private onDetailKeydown'));
    const fn = detail.slice(0, detail.indexOf('\n  /** The authoritative'));
    expect(fn).toContain('const kind = this.controlKindOf(target);');
    expect(fn).toContain('const intent = rowKeyIntent(kind, e.key);');
    expect(fn).toContain('this.applyAdjustToControl(target, intent);');
  });

  it('applies the adjust to the focused control reusing its existing dispatch', () => {
    const apply = painter.slice(painter.indexOf('private applyAdjustToControl'));
    const fn = apply.slice(0, apply.indexOf('\n  // ----'));
    // slider: pure step math + a synthetic input/change so the commit is byte-identical.
    expect(fn).toContain('sliderStepValue(');
    expect(fn).toContain("slider.dispatchEvent(new Event('input', { bubbles: true }))");
    expect(fn).toContain("slider.dispatchEvent(new Event('change', { bubbles: true }))");
    // switch: Left = off, Right = on, driven through the switch's own click dispatch.
    expect(fn).toContain("const want = intent === 'adjustInc';");
    expect(fn).toContain('if (on !== want) el.click();');
    // segmented: pure index math + selection-follows-focus.
    expect(fn).toContain('segIndexForIntent(radios.length');
  });

  it('sets .is-active-row on focusin (authoritative, not :focus-visible-derived)', () => {
    // The painter drives the cursor imperatively on focusin (covers programmatic /
    // controller focus that :focus-visible does not reliably light).
    expect(painter).toContain("detailScroll.addEventListener('focusin', (e) => this.markActiveRow");
    const mark = painter.slice(painter.indexOf('private markActiveRow'));
    const fn = mark.slice(0, mark.indexOf('\n  /**'));
    expect(fn).toContain("closest<HTMLElement>('.opt-row')");
    expect(fn).toContain("row.classList.add('is-active-row')");
    // The CSS cue is a token inset (zero layout shift), never a :focus-visible rule.
    const cue = components.slice(components.indexOf('.opt-row.is-active-row {'));
    const block = cue.slice(0, cue.indexOf('}'));
    expect(block).toContain('box-shadow: inset 2px 0 0 var(--focus-ring-color)');
    expect(components).not.toContain('.opt-row:focus-visible');
  });

  it('gives the segmented radiogroup a single roving Tab stop', () => {
    // The selected radio is tabIndex 0, the rest -1, so the group is one Tab stop.
    expect(painter).toContain('btn.tabIndex = selected ? 0 : -1;');
  });
});

describe('options_window: controller navigation + legend (P3)', () => {
  const mainSrc = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');

  it('exposes handleMenuIntent as the testable seam and dispatches every verb', () => {
    // Public seam: the gamepad reaches this through hud, never navigator.getGamepads.
    expect(painter).toContain('handleMenuIntent(intent: MenuIntentKind): void');
    expect(painter).toContain('this.applyFocusIntent(intent);');
    const apply = painter.slice(painter.indexOf('private applyFocusIntent'));
    const fn = apply.slice(0, apply.indexOf('\n  /** The focused control'));
    // category / row / adjust / activate / back / reset / clear / page all routed.
    expect(fn).toContain("this.cycleCategory(fi === 'categoryNext' ? 1 : -1)");
    expect(fn).toContain("this.stepRowFocus(fi === 'rowNext' ? 1 : -1)");
    expect(fn).toContain('this.applyAdjustToControl(el, fi)');
    expect(fn).toContain('this.activateFocused()');
    expect(fn).toContain('this.backOrClose()');
    expect(fn).toContain('this.resetFocusedRow()');
    expect(fn).toContain('this.clearFocusedKeybind()');
    expect(fn).toContain("this.pageScrollDetail(fi === 'pageDown' ? 1 : -1)");
  });

  it('controller row focus goes through .focus() (so the focusin cursor fires for it too)', () => {
    const step = painter.slice(painter.indexOf('private stepRowFocus'));
    expect(step.slice(0, step.indexOf('\n  private'))).toContain('rows[next].focus()');
    const first = painter.slice(painter.indexOf('private focusFirstRow'));
    expect(first.slice(0, first.indexOf('\n  /**'))).toContain(
      'this.detailFocusables()[0]?.focus()',
    );
  });

  it('Y resets the focused row via the scoped-reset path; X clears + announces a keybind cap', () => {
    const reset = painter.slice(painter.indexOf('private resetFocusedRow'));
    const resetBody = reset.slice(0, reset.indexOf('\n  /**'));
    expect(resetBody).toContain('this.resetKeys([key])');
    // After the full re-render, focus returns to the same row's control so the
    // controller cursor does not vanish on Y.
    expect(resetBody).toContain('row?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)?.focus()');
    const clear = painter.slice(painter.indexOf('private clearFocusedKeybind'));
    const body = clear.slice(0, clear.indexOf('\n  /** RT/LT'));
    // Clears ONLY a keybind cap (no-op elsewhere) and announces.
    expect(body).toContain("cap.classList.contains('kb-key')");
    expect(body).toContain('this.deps.keybinds().clear(action, Number(index))');
    expect(body).toContain('this.announce(');
    expect(body).toContain("t('hudChrome.options.keybindCleared', {");
    // After the repaint, focus re-homes to the rebuilt cap so the controller
    // cursor survives an X-clear.
    expect(body).toContain('.kb-key[data-action="${action}"][data-index="${index}"]');
    // The caps carry the data the clear reads.
    expect(painter).toContain('key.dataset.action = action.id;');
    expect(painter).toContain('key.dataset.index = String(index);');
  });

  it('renders the footer legend ONLY while a pad is connected, with localized meanings', () => {
    const legend = painter.slice(painter.indexOf('private buildLegend'));
    const body = legend.slice(0, legend.indexOf('\n  private '));
    expect(body).toContain('if (!hooks || !hooks.gamepad.connected()) return null;');
    // Live brand glyphs + t() meaning keys (not raw English).
    expect(body).toContain('gamepadButtonLabel(b, kind)');
    expect(body).toContain("'hudChrome.options.legend.category'");
    expect(body).toContain("'hudChrome.options.legend.page'");
    // Re-render the footer on connect/disconnect so the strip appears/vanishes live.
    const refresh = painter.slice(painter.indexOf('refreshControllerLabels(): void'));
    expect(refresh.slice(0, refresh.indexOf('\n  //'))).toContain('this.renderFooter(footer)');
  });

  it('wires the pad menu mode through hud + main behind the trap predicate', () => {
    // hud: the trap predicate + the intent router into the options seam.
    expect(hudTs).toContain('isFocusTrapped(): boolean');
    expect(hudTs).toContain('return this.focusManager.hasActiveTrap();');
    expect(hudTs).toContain('handleMenuGamepadIntent(intent: MenuIntentKind): void');
    expect(hudTs).toContain('this.optionsWindow.handleMenuIntent(intent);');
    // The router self-heals lost focus (body/null) while the menu is open, so the
    // controller path never dead-ends after a repaint detaches the focused node;
    // focus inside a DIFFERENT trapped element keeps the generic fallback.
    expect(hudTs).toContain(
      'const focusLost = !(active instanceof HTMLElement) || active === document.body;',
    );
    expect(hudTs).toContain(
      'if (this.optionsWindow.isOpen && (optionsRoot.contains(active) || focusLost)) {',
    );
    // main: the gamepad callbacks gate menu mode on the trap + surface pad connection.
    expect(mainSrc).toContain('isMenuMode: () => hud.isFocusTrapped()');
    expect(mainSrc).toContain('onMenuIntent: (intent) => hud.handleMenuGamepadIntent(intent)');
    expect(mainSrc).toContain('connected: () => gamepad.isConnected()');
  });
});

describe('options_window: forced-colors selection cue (P2 review item 5)', () => {
  const components = readFileSync(new URL('../src/styles/components.css', import.meta.url), 'utf8');
  it('gives the selected segment a system-colour outline under forced-colors', () => {
    const forced = components.slice(components.indexOf('@media (forced-colors: active)'));
    const block = forced.slice(0, forced.indexOf('\n  }\n}'));
    expect(block).toMatch(/\.opt-seg-btn\.is-selected \{\s*outline: 2px solid Highlight;/);
  });

  it('gives the role=switch a non-colour on/off cue under forced-colors (WCAG 1.4.1)', () => {
    const forced = components.slice(components.indexOf('@media (forced-colors: active)'));
    const block = forced.slice(0, forced.indexOf('\n  }\n}'));
    // The thumb gets a solid system-colour fill so it is visible in BOTH states
    // (its left=off / right=on position is then the non-colour cue), and the
    // checked track a Highlight border to reinforce the on state.
    expect(block).toMatch(/\.opt-switch::before \{\s*background: CanvasText;/);
    expect(block).toMatch(/\.opt-switch\[aria-checked="true"\] \{\s*border-color: Highlight;/);
    expect(block).toMatch(
      /\.opt-switch\[aria-checked="true"\]::before \{\s*background: Highlight;/,
    );
  });
});

describe('options_window: performance overlay delegation preserved under System', () => {
  it('delegates to the PerfOverlaySettingsPanel and gates drag-placement to System', () => {
    expect(painter).toContain('new PerfOverlaySettingsPanel(');
    expect(painter).toContain('this.perfSettings.render(perfHost)');
    expect(painter).toContain("perfOverlay.setPlacement(id === 'system')");
    // the master toggle still rides on the showFps setting
    expect(painter).toContain("getShowFps: () => hooks.settings.get('showFps')");
  });
});

describe('options_window: footer + reset-all', () => {
  it('confirm-gates Reset all through the shared confirm dialog then re-applies every key', () => {
    const reset = painter.slice(painter.indexOf('private confirmResetAll'));
    const body = reset.slice(0, reset.indexOf('\n  }\n'));
    expect(body).toContain('this.deps.confirmDialog(');
    expect(body).toContain("t('hudChrome.options.resetAllTitle')");
    expect(body).toContain('settings.reset()');
    expect(body).toContain('this.deps.options()?.onSettingChange(k, all[k])');
  });

  it('gates Report a Bug online but keeps Log out reachable in both modes', () => {
    const footer = painter.slice(painter.indexOf('private renderFooter'));
    const body = footer.slice(0, footer.indexOf('\n  private '));
    expect(body).toContain('this.deps.bugReport() !== null');
    // logout is rendered unconditionally (offline it reloads to the title screen)
    expect(body).toContain('this.deps.options()?.logout()');
  });
});

describe('options_window: scoped category reset', () => {
  it('resets exactly the category key set to defaults and re-applies each', () => {
    const reset = painter.slice(painter.indexOf('private resetKeys'));
    const body = reset.slice(0, reset.indexOf('\n  }\n'));
    // numeric + bool keys both go set-then-onSettingChange to their def
    expect(body).toContain('hooks.settings.set(key as BoolSettingKey, bool.def)');
    expect(body).toContain('hooks.onSettingChange(key as keyof GameSettings, bool.def)');
    expect(body).toContain('hooks.settings.set(key as NumericSettingKey, r.def)');
    expect(painter).toContain('categoryResetKeys(id)');
  });
});

describe('options_window: viewport resync on open (PR #1118 preserved)', () => {
  it('calls syncAppViewport() before the panel becomes visible', () => {
    expect(painter).toContain("import { syncAppViewport } from '../game/app_viewport'");
    const toggle = painter.slice(painter.indexOf('toggle(): void {'));
    const body = toggle.slice(0, toggle.indexOf('\n  }\n'));
    const syncIdx = body.indexOf('syncAppViewport()');
    const displayIdx = body.indexOf("root().style.display = 'flex'");
    expect(syncIdx).toBeGreaterThan(-1);
    expect(displayIdx).toBeGreaterThan(-1);
    expect(syncIdx).toBeLessThan(displayIdx);
  });
});

describe('options_window: close semantics preserved', () => {
  it('drops perf placement, hides the tooltip, resumes music, returns focus', () => {
    const close = painter.slice(painter.indexOf('close(): void {'));
    const body = close.slice(0, close.indexOf('\n  }\n'));
    expect(body).toContain("this.deps.root().style.display = 'none'");
    expect(body).toContain('this.deps.options()?.perfOverlay.setPlacement(false)');
    expect(body).toContain('this.deps.hideTooltip()');
    expect(body).toContain('music.resumeFromMenu()');
    expect(body).toContain('this.deps.restoreFocus(target)');
  });
});

describe('options_window: uiScale slider commits on release (#1558 preserved)', () => {
  it('a commit-on-change slider commits only on change, previewing readout on input', () => {
    const fn = painter.slice(painter.indexOf('if (c.commitOnChange) {'));
    const branch = fn.slice(0, fn.indexOf('} else {'));
    const inputHandler = branch.slice(
      branch.indexOf("addEventListener('input'"),
      branch.indexOf("addEventListener('change'"),
    );
    expect(inputHandler).toContain('readoutFromSlider();');
    expect(inputHandler).not.toContain('onSettingChange');
    const changeHandler = branch.slice(branch.indexOf("addEventListener('change'"));
    expect(changeHandler).toContain("addEventListener('change', commit)");
  });

  it('a normal slider commits live on input, via the shared closure', () => {
    const elseArm = painter.slice(
      painter.indexOf('} else {', painter.indexOf('if (c.commitOnChange) {')),
    );
    expect(elseArm.slice(0, elseArm.indexOf('\n    }'))).toContain(
      "addEventListener('input', commit)",
    );
  });
});

describe('options_window: settings shows the running version (#1541 preserved)', () => {
  it('renders the version + build id from the shared app_version source', () => {
    expect(painter).toContain("import { appVersionInfo } from './app_version'");
    expect(painter).toContain('appVersionInfo()');
    expect(painter).toContain("t('hudChrome.options.version', { version, build })");
  });
});

describe('options_window: reviewed-findings regression pins (F2/C2/S2/S3/N3/N4/N5/X2/K1)', () => {
  it('a choice row keeps one Tab stop when the stored value matches no option (F2)', () => {
    // clickToMoveButton stored 1 with options {0,2}, or graphicsPreset stored 4/5
    // under the native-shell cap: zero selected radios must not mean zero Tab stops.
    const choice = painter.slice(painter.indexOf('private settingChoice'));
    const body = choice.slice(0, choice.indexOf('\n  private noteRow'));
    expect(body).toContain('if (!anySelected && radios.length > 0) {');
    expect(body).toContain('nearest.tabIndex = 0;');
  });

  it('controller verbs resolve the shell content pane too (C2)', () => {
    const helper = painter.slice(painter.indexOf('private detailScrollEl'));
    const helperBody = helper.slice(0, helper.indexOf('\n  private buildSearchStrip'));
    expect(helperBody).toContain(".querySelector<HTMLElement>('.opt-detail')");
    expect(helperBody).toContain(".querySelector<HTMLElement>('.opt-mshell-content')");
    // D-pad row focus, LT/RT paging, and the focusin row cursor all resolve
    // through the helper, so the legend-advertised verbs work on the back-stack.
    const focusables = painter.slice(painter.indexOf('private detailFocusables'));
    expect(focusables.slice(0, focusables.indexOf('\n  /** LB/RB'))).toContain(
      'this.detailScrollEl()',
    );
    const page = painter.slice(painter.indexOf('private pageScrollDetail'));
    expect(page.slice(0, page.indexOf('\n  private announce'))).toContain('this.detailScrollEl()');
    const mark = painter.slice(painter.indexOf('private markActiveRow'));
    expect(mark.slice(0, mark.indexOf('\n  /**'))).toContain('this.detailScrollEl()');
  });

  it('renders the chat-timestamp rows from the deps chat accessors (S2)', () => {
    expect(painter).toContain('private chatTimestampsRow(');
    expect(painter).toContain('private chatClockRow(');
    // The write path is the already-plumbed hud state, not a settings key.
    expect(painter).toContain('this.deps.setChatTimestamps(!this.deps.getChatTimestamps())');
    expect(painter).toContain('this.deps.setChatClock(clock)');
    expect(painter).toContain("t('hudChrome.chatTimestamps.show')");
    expect(painter).toContain("t('hudChrome.chatTimestamps.format')");
    // Dispatched from the shared detail path like the language / theme rows.
    expect(painter).toContain("if (row.control === 'chatTimestamps') {");
    expect(painter).toContain("if (row.control === 'chatClock') {");
  });

  it('syncs the rail badges / head reset / Overview summary in place after each commit (S3)', () => {
    expect(painter).toContain('private syncChangedBadges(): void {');
    // Called from all four commit handlers (slider, toggle, boolToggle, choice).
    const calls = painter.match(/this\.syncChangedBadges\(\);/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(4);
    expect(painter).toContain('private syncTabCount(');
    expect(painter).toContain('private syncCategoryHead(): void {');
    // The Overview summary carries a class the sync can find in place.
    expect(painter).toContain("changed.className = 'opt-status-changed'");
  });

  it('arms reloadPending on every reset path that changes a reload key (N3)', () => {
    const reset = painter.slice(painter.indexOf('private resetKeys'));
    const body = reset.slice(0, reset.indexOf('\n  // ----'));
    expect(body).toContain('RELOAD_KEYS.has(key)');
    expect(body).toContain('this.reloadPending = true;');
    const all = painter.slice(painter.indexOf('private confirmResetAll'));
    const allBody = all.slice(0, all.indexOf('\n  // ----'));
    expect(allBody).toContain('for (const key of RELOAD_KEYS)');
    expect(allBody).toContain('this.reloadPending = true;');
  });

  it('the footer bug button routes through openBugReport (N4, no duplicated inline flow)', () => {
    const footer = painter.slice(painter.indexOf('private renderFooter'));
    const body = footer.slice(0, footer.indexOf('\n  /** The controller'));
    expect(body).toContain('this.openBugReport();');
    expect(body).not.toContain("this.subView = 'bugreport'");
  });

  it('joins the unbound banner with Intl.ListFormat and a registry-label fallback (N5)', () => {
    expect(painter).toContain('new Intl.ListFormat(languageTag(getLanguage())');
    expect(painter).toContain('private actionLabelOf(actionId: string): string');
    const table = painter.slice(painter.indexOf('private renderKeybindTable'));
    const body = table.slice(0, table.indexOf('\n  /** Cancel'));
    expect(body).toContain('this.formatList(');
    expect(body).toContain('this.actionLabelOf(id)');
    expect(body).not.toContain(".join('; ')");
  });

  it('re-renders on a live body.mobile-touch flip while open (X2)', () => {
    expect(painter).toContain('private observeInterfaceModeFlips(): void {');
    expect(painter).toContain("attributeFilter: ['class']");
    // Attach on open, disconnect on close; render only on an actual mode change.
    const toggle = painter.slice(painter.indexOf('toggle(): void {'));
    expect(toggle.slice(0, toggle.indexOf('\n  }\n'))).toContain(
      'this.observeInterfaceModeFlips();',
    );
    const close = painter.slice(painter.indexOf('close(): void {'));
    expect(close.slice(0, close.indexOf('\n  }\n'))).toContain(
      'this.unobserveInterfaceModeFlips();',
    );
    const observe = painter.slice(painter.indexOf('private observeInterfaceModeFlips'));
    expect(observe.slice(0, observe.indexOf('\n  /** Stop'))).toContain(
      'if (this.renderMode() === this.lastRenderMode) return;',
    );
  });

  it('sources intentionalUnbound from the DEFAULT layout for the conflict aggregate (K1)', () => {
    const rows = painter.slice(painter.indexOf('private keyboardConflictRows'));
    expect(rows.slice(0, rows.indexOf('\n  /** The controller bind rows'))).toContain(
      'intentionalUnbound: a.defaults.length === 0',
    );
  });
});

describe('options_window: stays a cold window', () => {
  it('exposes no per-frame refresh and is never wired into Hud.update', () => {
    expect(painter).not.toContain('refreshIfChanged');
    const update = hudTs.slice(hudTs.indexOf('\n  update(): void {'));
    const nextMethodEnd = update.indexOf('\n  }\n');
    expect(update.slice(0, nextMethodEnd)).not.toContain('optionsWindow');
  });
});
