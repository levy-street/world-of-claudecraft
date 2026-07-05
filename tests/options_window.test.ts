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
