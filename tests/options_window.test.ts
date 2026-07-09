import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Source-level guards for the options painter. The pure control descriptors +
// the per-kind dispatch coercion are unit-tested in options_view.test.ts; here we
// pin the no-magic-values contract, the tier boundary
// the changeLanguage hardening (PR #730), the WCAG 2.2 AA focus-return +
// roles/aria, the bug-report + keybind dispatch, and that the window stays cold
// (never wired into the per-frame Hud.update path).
const painter = readFileSync(new URL('../src/ui/options_window.ts', import.meta.url), 'utf8');
const hudTs = readFileSync(new URL('../src/ui/hud.ts', import.meta.url), 'utf8');

describe('options_window: no magic values', () => {
  it('carries no literal color in TS (colors live in the extracted stylesheet)', () => {
    const hex = painter.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
    expect(hex, `hex colors must move to tokens/CSS: ${hex.join(', ')}`).toEqual([]);
    // a color literal can also sneak in as rgb()/hsl(); the painter must carry none.
    expect(painter, 'rgb()/hsl() color literal must move to tokens/CSS').not.toMatch(
      /\b(?:rgba?|hsla?)\(/,
    );
  });

  it('names its numeric thresholds instead of bare literals', () => {
    expect(painter).toContain('RANGE_FILL_FULL_PCT');
    // the bare 2000 literal appears ONLY on the BUG_DESC_MAX_LEN definition line, so
    // a future stray 2000 elsewhere (or a dropped constant) trips the guard.
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
    // no governor read (a call/access); the word may appear in a boundary comment
    expect(painter).not.toMatch(/governor\s*[.(]/);
    expect(painter).not.toMatch(/\.state\(\)\.levels/);
  });
});

describe('options_window: WCAG 2.2 AA', () => {
  it('returns focus to the opener on every close path', () => {
    expect(painter).toContain('captureFocus');
    expect(painter).toContain('restoreFocus');
    // close() drops the panel AND restores focus to the captured opener
    const close = painter.slice(painter.indexOf('close(): void {'));
    expect(close).toContain('this.deps.restoreFocus(target)');
  });

  it('exposes programmatic roles/labels on its controls', () => {
    // sliders are native range inputs (role=slider) with an aria-label
    expect(painter).toContain("slider.type = 'range'");
    expect(painter).toContain("slider.setAttribute('aria-label', label)");
    // and announce the human-meaningful readout (50%, 90 degrees), not the raw value
    expect(painter).toContain("slider.setAttribute('aria-valuetext', text)");
    // toggles expose their pressed state
    expect(painter).toContain("toggle.setAttribute('aria-pressed'");
    // the async status + error nodes are live regions
    expect(painter).toContain("status.setAttribute('role', 'status')");
    expect(painter).toContain("error.setAttribute('role', 'alert')");
  });

  it('names the gamepad remap listboxes (the language picker already is named)', () => {
    // each pad-button dropdown gets the physical button label as its accessible
    // name, so it is not an unnamed role=listbox (WCAG 4.1.2).
    expect(painter).toContain('ariaLabel: buttonLabel');
    expect(painter).toContain("ariaLabel: t('hud.options.language')");
  });
});

// The exact control-dispatch wiring. The pure value coercion is unit-tested in
// options_view.test.ts (sliderDispatchValue / toggleNextValue / boolToggleNextValue);
// here we pin that the painter routes each descriptor kind to its builder and fires
// the SAME write the inline original did, so a dropped settings.set side effect or a
// swapped coercion reds the build. Driving the live DOM + events is the opt-in
// browser suite; this is the no-DOM-suite equivalent.
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
    // slider: the raw input value coerced via the pure dispatch fn
    expect(painter).toContain('hooks.onSettingChange(key, sliderDispatchValue(slider.value))');
    // numeric toggle: flip off the stored value, no pre-set
    expect(painter).toContain(
      'hooks.onSettingChange(key, toggleNextValue(hooks.settings.get(key)))',
    );
    // bool toggle: set-then-dispatch (settings.set returns the committed boolean)
    expect(painter).toContain(
      'hooks.settings.set(key, boolToggleNextValue(hooks.settings.get(key)))',
    );
    // enumerated choice: the chosen option value verbatim
    expect(painter).toContain('hooks.onSettingChange(key, option.value)');
  });
});

describe('options_window: changeLanguage hardening (PR #730)', () => {
  it('guards re-entry, reverts in place on failure, and never sticks busy', () => {
    const lang = painter.slice(
      painter.indexOf('private languageSelect'),
      painter.indexOf('private renderThemeControls'),
    );
    expect(lang).toContain('let busy = false');
    expect(lang).toContain(
      'if (busy || !isSupportedLanguage(selected) || selected === getLanguage())',
    );
    expect(lang).toContain('.changeLanguage(selected');
    // success re-renders the panel; failure reverts the dropdown in place
    expect(lang).toContain('this.renderInterface()');
    expect(lang).toContain('this.deps.setDropdownValue(dropdown, getLanguage())');
    // the trigger never gets stuck disabled on a throw
    expect(lang).toContain('.catch(');
    expect(lang).toContain('.finally(');
  });
});

describe('options_window: bug-report dispatch + async states (cluster 2)', () => {
  it('preserves the submit action and the no-text / in-flight / failure states', () => {
    const bug = painter.slice(
      painter.indexOf('private renderBugReport'),
      painter.indexOf('private localizeBugReportError'),
    );
    // no-text guard short-circuits with the describe-first message
    expect(bug).toContain("error.textContent = t('hudChrome.bugReport.describeFirst')");
    // in-flight: the button is disabled while the submit promise is pending
    expect(bug).toContain('submit.disabled = true');
    // the submit action and its honest dropped-screenshot reporting are intact
    expect(bug).toContain('hooks\n        .submit({ description');
    expect(bug).toContain('hudChrome.bugReport.submittedNoShot');
    // failure: re-enable + localized error
    expect(bug).toContain('submit.disabled = false');
    expect(bug).toContain('this.localizeBugReportError(err)');
  });
});

describe('options_window: keybind rebind dispatch (cluster 5)', () => {
  it('captures a key and binds it to the same action/index', () => {
    expect(painter).toContain('private beginCapture(actionId: string, index: number');
    expect(painter).toContain('hooks.captureKey((code)');
    expect(painter).toContain('this.deps.keybinds().bind(actionId, index, code)');
    expect(painter).toContain('this.deps.refreshKeybindLabels()');
  });
});

describe('options_window: viewport resync on open (PR #1118)', () => {
  it('calls syncAppViewport() before the panel flips to display: block', () => {
    expect(painter).toContain("import { syncAppViewport } from '../game/app_viewport'");
    const toggle = painter.slice(painter.indexOf('toggle(): void {'));
    const toggleEnd = toggle.indexOf('\n  }\n');
    const body = toggle.slice(0, toggleEnd);
    const syncIdx = body.indexOf('syncAppViewport()');
    const displayIdx = body.indexOf("root().style.display = 'block'");
    expect(syncIdx).toBeGreaterThan(-1);
    expect(displayIdx).toBeGreaterThan(-1);
    expect(syncIdx).toBeLessThan(displayIdx);
  });
});

describe('options_window: stays a cold window', () => {
  it('exposes no per-frame refresh and is never wired into Hud.update', () => {
    // the painter is open-on-demand only: no refreshIfChanged/update method
    expect(painter).not.toContain('refreshIfChanged');
    // Hud.update() must not touch the options window. Anchor on the actual method
    // definition (not the first 'update(' literal anywhere, which can be a comment
    // mentioning hud.update() and gives a bogus slice); the per-frame body runs from
    // there to its 2-space-indented closing brace (nested blocks indent deeper).
    const update = hudTs.slice(hudTs.indexOf('\n  update(): void {'));
    const nextMethodEnd = update.indexOf('\n  }\n');
    expect(update.slice(0, nextMethodEnd)).not.toContain('optionsWindow');
  });
});

// The title-bar back control: every sub-view offers a one-tap return to the Game
// Menu root (before this, mobile players had to close the window and re-open it
// via More then Menu to get back). panelTitle() prepends it on every non-main
// view, render() wires it centrally, and the self-rendering Performance panel
// carries its own copy wired locally.
describe('options_window: title-bar back control', () => {
  const perfPanel = readFileSync(
    new URL('../src/ui/perf_overlay_settings.ts', import.meta.url),
    'utf8',
  );
  const layoutCss = readFileSync(new URL('../src/styles/layout.css', import.meta.url), 'utf8');

  it('renders [data-back] on every panelTitle sub-view but not on the main menu', () => {
    const title = painter.slice(painter.indexOf('private panelTitle(title: string): string {'));
    const body = title.slice(0, title.indexOf('\n  }\n'));
    // the control exists only when the open view is not the root menu
    expect(body).toContain("this.view === 'main'");
    expect(body).toContain('data-back');
    // square x-btn chrome, kept in flow at the inline start via .back-btn
    expect(body).toContain('class="x-btn back-btn"');
    // accessible name from the existing footer-Back key (no new i18n key)
    expect(body).toContain("t('hud.options.back')");
  });

  it('wires [data-back] centrally in render() and routes every back path to goBack()', () => {
    expect(painter).toContain(
      "el.querySelector('[data-back]')?.addEventListener('click', () => this.goBack());",
    );
    // the four footer Back buttons (settings shell, interface, bug report,
    // keybinds) reuse the same path (no inline copies left)
    expect(
      painter.match(/back\.addEventListener\('click', \(\) => this\.goBack\(\)\);/g),
    ).toHaveLength(4);
    // the click-then-flip-to-main sequence lives ONLY in goBack itself; a stray
    // inline copy in some handler would push this count past 1
    expect(painter.match(/audio\.click\(\);\s*this\.view = 'main';/g) ?? []).toHaveLength(1);
  });

  it('goBack returns to the root without closing, drops key capture, and moves focus', () => {
    const goBack = painter.slice(painter.indexOf('private goBack(): void {'));
    const body = goBack.slice(0, goBack.indexOf('\n  }\n'));
    expect(body).toContain('audio.click();');
    expect(body).toContain("this.view = 'main';");
    expect(body).toContain('this.capturingKey = null;');
    expect(body).toContain("this.keybindNote = '';");
    expect(body).toContain('this.render();');
    // WCAG: the tapped control is destroyed by the re-render, so focus must land
    // in the re-rendered menu rather than falling to <body>.
    expect(body).toContain('this.deps.focusFirstInteractive(this.deps.root());');
    expect(body).not.toContain('this.close()');
  });

  it('the Performance panel carries the same control, wired locally (it rerenders itself)', () => {
    // host plumbing: icon in, navigation out (routed to the shared goBack)
    expect(painter).toContain("backIconHtml: svgIcon('prev'),");
    expect(painter).toContain('onBack: () => this.goBack(),');
    const title = perfPanel.slice(perfPanel.indexOf('private buildTitle(): HTMLElement {'));
    const body = title.slice(0, title.indexOf('\n  }\n'));
    expect(body).toContain("back.className = 'x-btn back-btn';");
    expect(body).toContain("back.addEventListener('click', () => this.host.onBack());");
    // NO data-back attribute: the central sweep would double-wire the first render
    expect(body).not.toContain("setAttribute('data-back'");
    // back sits before the title text, close after it
    expect(body).toContain('title.append(back, label, close);');
  });

  it('keeps the back control in flow at the inline start (not the x-btn absolute pin)', () => {
    const rule =
      layoutCss.match(/\.window > \.panel-title > \.x-btn\.back-btn \{([^}]*)\}/)?.[1] ?? '';
    expect(rule).toContain('position: static;');
    expect(rule).toContain('transform: none;');
  });
});

describe('options_window: uiScale slider commits on release (#1558)', () => {
  it('the shared commit closure applies the setting from the raw slider value', () => {
    const commit = painter.slice(painter.indexOf('const commit = () => {'));
    const body = commit.slice(0, commit.indexOf('};'));
    expect(body).toContain('hooks.onSettingChange(key, sliderDispatchValue(slider.value))');
    expect(body).toContain('syncReadout();');
  });

  it('a commit-on-change slider commits only on change, previewing readout on input', () => {
    // Isolate the settingSlider commit-on-change branch.
    const fn = painter.slice(painter.indexOf('if (c.commitOnChange) {'));
    const branch = fn.slice(0, fn.indexOf('} else {'));
    // input previews only (readout + fill), and must NOT commit the setting.
    const inputHandler = branch.slice(
      branch.indexOf("addEventListener('input'"),
      branch.indexOf("addEventListener('change'"),
    );
    expect(inputHandler).toContain('readoutFromSlider();');
    expect(inputHandler).not.toContain('onSettingChange');
    expect(inputHandler).not.toContain('commit');
    // change (release / keyboard step) commits, via the shared closure.
    const changeHandler = branch.slice(branch.indexOf("addEventListener('change'"));
    expect(changeHandler).toContain("addEventListener('change', commit)");
  });

  it('a normal slider still commits live on input, via the shared closure', () => {
    const elseArm = painter.slice(
      painter.indexOf('} else {', painter.indexOf('if (c.commitOnChange) {')),
    );
    expect(elseArm.slice(0, elseArm.indexOf('\n    }'))).toContain(
      "addEventListener('input', commit)",
    );
  });
});

describe('options_window: settings shows the running version (#1541)', () => {
  it('renders the version + build id from the shared app_version source', () => {
    // Reuse the single build source, not a re-declared __APP_* global.
    expect(painter).toContain("import { appVersionInfo } from './app_version'");
    expect(painter).toContain('appVersionInfo()');
  });

  it('paints the version as a t() label in the main menu (renderMain)', () => {
    const renderMain = painter.slice(painter.indexOf('private renderMain(): void {'));
    const body = renderMain.slice(0, renderMain.indexOf('\n  }\n'));
    // The label is an i18n key with version+build passed as values (no concat).
    expect(body).toContain("t('hudChrome.options.version', { version, build })");
    // Rendered as the .opt-version secondary line appended after the button list.
    expect(body).toContain("'opt-version'");
    expect(body.indexOf("'opt-version'")).toBeGreaterThan(body.indexOf('el.appendChild(list)'));
  });
});
