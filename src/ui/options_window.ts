// Options window painter: owns the #options-menu DOM, the window-local view-state
// (which sub-panel is open, the key-capture buffer, the keybind note, the lazily
// built performance panel), and the open/close lifecycle. It renders the nine
// sub-panels off the declarative model in options_view.ts and dispatches every
// control through the injected deps; the pure control descriptors + the per-kind
// value coercion live in the core. This is the thin DOM consumer per the
// social_window / talents_window template.
//
// The window renders NO item rows (it is all sliders/toggles/choices/dropdowns),
// so it composes no PainterHostPresentation bag (the social
// precedent); it reads only the live world's bug-report slice and routes the
// shared HUD chrome (focus return, dropdown builder, keybind store) through these
// closures. The module never reaches into Hud directly.
//
// No raw hex / magic values: every color lives in the extracted
// stylesheet (the options window CSS moved to components.css); the one log
// tint stays Hud-side (deps.log), and the two numeric thresholds here are named
// constants. The graphics sub-panel reads the STATIC graphics preset as a plain
// setting value only: it never reads the FPS governor and never defines the
// effects-quality cutoff (that resolver and per-element tiering live elsewhere).

import { syncAppViewport } from '../game/app_viewport';
import { audio } from '../game/audio';
import { GAMEPAD_NONE, gamepadButtonLabel } from '../game/gamepad_map';
import {
  BIND_ACTIONS,
  BIND_CATEGORIES,
  isReservedCode,
  type Keybinds,
  keyLabel,
} from '../game/keybinds';
import { isNativeAppShell, useTouchInterface } from '../game/mobile_controls';
import { music } from '../game/music';
import {
  type BoolSettingKey,
  type GameSettings,
  type NumericSettingKey,
  normalizeClickMoveButton,
  SETTING_RANGES,
} from '../game/settings';
import type { IWorld } from '../world_api';
import type { ChatClock } from './chat_timestamp';
import { markDialogRoot } from './dialog_root';
import { esc } from './esc';
import type { BugReportHooks, OptionsHooks } from './hud';
import {
  formatNumber,
  getLanguage,
  isSupportedLanguage,
  type SupportedLanguage,
  supportedLanguages,
  t,
} from './i18n';
import type { TranslationKey } from './i18n.catalog';
import {
  type BoolToggleControl,
  boolToggleNextValue,
  buildAudioControls,
  buildBugReportInfo,
  buildControllerControls,
  buildGraphicsControls,
  buildInterfaceControls,
  buildOptionsMenu,
  type ChoiceControl,
  type OptionsControl,
  type OptionsPanelId,
  type OptionsSettingsSource,
  type SliderControl,
  type SliderFmt,
  sliderDispatchValue,
  type ToggleControl,
  toggleIsOn,
  toggleNextValue,
} from './options_view';
import { PerfOverlaySettingsPanel, type PerfSettingsHost } from './perf_overlay_settings';
import {
  PRESET_ORDER,
  type PresetId,
  resolveTheme,
  THEME_KNOB_LABEL_KEY,
  THEME_KNOB_ORDER,
} from './theme';
import { svgIcon } from './ui_icons';

// The current sub-panel (the main menu plus the eight sub-views).
type OptionsView = 'main' | OptionsPanelId;

// Maximum characters for the bug-report description (a named
// threshold, not a bare literal). Matches the inline textarea maxLength.
const BUG_DESC_MAX_LEN = 2000;
// Full-scale percent for the slider gold-fill gradient (the --range-fill custom
// property is 0%..100%). Named so the fill math carries no bare literal.
const RANGE_FILL_FULL_PCT = 100;

// Endonyms for the in-game language picker; never localized (they render
// identically in every locale, matching the homepage footer picker), keyed by
// SupportedLanguage so a new locale appears once its label is added here.
const LANGUAGE_ENDONYMS: Record<SupportedLanguage, string> = {
  en: 'English (US)',
  es: 'Español (LatAm)',
  es_ES: 'Español (España)',
  fr_FR: 'Français (France)',
  fr_CA: 'Français (Canada)',
  en_CA: 'English (Canada)',
  it_IT: 'Italiano',
  de_DE: 'Deutsch',
  zh_CN: '简体中文',
  zh_TW: '繁體中文',
  ko_KR: '한국어',
  ja_JP: '日本語',
  pt_BR: 'Português (Brasil)',
  ru_RU: 'Русский',
  nl_NL: 'Nederlands',
  pl_PL: 'Polski',
  id_ID: 'Bahasa Indonesia',
  tr_TR: 'Türkçe',
  sv_SE: 'Svenska',
  vi_VN: 'Tiếng Việt',
  da_DK: 'Dansk',
};

// Localized labels for the keybind category headers + action rows.
const BIND_CATEGORY_LABEL_KEYS: Partial<Record<string, TranslationKey>> = {
  Movement: 'hud.keybinds.categories.movement',
  Targeting: 'hud.keybinds.categories.targeting',
  Interface: 'hud.keybinds.categories.interface',
  'Action Bar': 'hud.keybinds.categories.actionBar',
};
const BIND_ACTION_LABEL_KEYS: Partial<Record<string, TranslationKey>> = {
  forward: 'hud.keybinds.actions.forward',
  back: 'hud.keybinds.actions.back',
  turnLeft: 'hud.keybinds.actions.turnLeft',
  turnRight: 'hud.keybinds.actions.turnRight',
  strafeLeft: 'hud.keybinds.actions.strafeLeft',
  strafeRight: 'hud.keybinds.actions.strafeRight',
  jump: 'hud.keybinds.actions.jump',
  autorun: 'hud.keybinds.actions.autorun',
  target: 'hud.keybinds.actions.target',
  attackMove: 'hud.keybinds.actions.attackMove',
  interact: 'hud.keybinds.actions.interact',
  char: 'hud.keybinds.actions.char',
  spellbook: 'hud.keybinds.actions.spellbook',
  questlog: 'hud.keybinds.actions.questlog',
  map: 'hud.keybinds.actions.map',
  bags: 'hud.keybinds.actions.bags',
  nameplates: 'hud.keybinds.actions.nameplates',
  meters: 'hud.keybinds.actions.meters',
  social: 'hud.keybinds.actions.social',
  arena: 'hud.keybinds.actions.arena',
  chat: 'hud.keybinds.actions.chat',
  // Combat/social target + emote-wheel actions. English-only chrome keys (the
  // `hud` catalog domain is tsc-locked to inline per-locale blocks).
  emoteWheel: 'hudChrome.keybinds.emoteWheel',
  targetFriendly: 'hudChrome.keybinds.targetFriendly',
  targetFriendlyNext: 'hudChrome.keybinds.targetFriendlyNext',
  discord: 'hudChrome.keybinds.discord',
  // Reuse the existing window/feature names so these labels localize everywhere
  // without duplicating strings (these two ids were previously absent from the
  // map and fell back to the raw English BIND_ACTIONS labels).
  talents: 'game.talents.title',
  leaderboard: 'game.leaderboard.title',
  calendar: 'hudChrome.calendar.keybindLabel',
  crafting: 'hudChrome.crafting.title',
};

/**
 * Hud-supplied glue. Standalone (the window composes no PainterHostPresentation:
 * it renders no item rows). It reads the live world's bug-report slice and routes
 * the options seam (settings, locale switch, theme, gamepad), the bug-report
 * seam, the keybind store, the shared dropdown builder, focus management, and the
 * chat-timestamp/window state through these closures.
 */
export interface OptionsWindowDeps {
  /** The #options-menu root (Hud owns the id; the painter stays instance-parameterized). */
  root(): HTMLElement;
  /** The live world (offline Sim or online ClientWorld mirror); read only for the bug-report info. */
  world(): IWorld;
  /** The options seam main.ts wires after Input exists (null until attached). */
  options(): OptionsHooks | null;
  /** The bug-report seam (online only; its presence gates the Report a Bug row). */
  bugReport(): BugReportHooks | null;
  /** The keybind store (read labels, rebind, reset). */
  keybinds(): Keybinds;
  /** Display name for an action-bar slot's bound ability or item, or null when empty. */
  slotActionName(slot: number): string | null;
  /** Re-sync the action-bar keycaps after a rebind/reset. */
  refreshKeybindLabels(): void;
  /** The shared gold-themed dropdown (carries the listbox ARIA + keyboard nav). */
  buildDropdown(
    options: { value: string; label: string }[],
    current: string,
    onChange?: (value: string) => void,
    placeholder?: string,
    a11y?: { ariaLabel?: string; labelledBy?: string },
  ): HTMLElement;
  /** Revert a dropdown's visible value in place without firing onChange (failed locale switch). */
  setDropdownValue(root: HTMLElement, value: string): void;
  /** Focus the first interactive element (or a preferred selector) inside a root. */
  focusFirstInteractive(root: HTMLElement, preferredSelector?: string): void;
  /** Clear transient overlays when the menu opens (closeOtherWindows). */
  closeOthers(): void;
  hideTooltip(): void;
  // Focus management (WCAG 2.2 AA): capture the opener on open, restore it on close.
  captureFocus(): HTMLElement | null;
  restoreFocus(target: HTMLElement | null): void;
  /** Combat-log a localized message (the gold tint stays Hud-side). */
  log(message: string): void;
  /** Reset the movable chat window to its default placement. */
  resetChatWindow(): void;
  /** Reset the movable player + target unit frames to their stock spots. */
  resetUnitFrames(): void;
  /** Chat-timestamp state (Hud owns it; the chat renderer reads the same fields). */
  getChatTimestamps(): boolean;
  setChatTimestamps(on: boolean): void;
  getChatClock(): ChatClock;
  setChatClock(clock: ChatClock): void;
}

export class OptionsWindow {
  private view: OptionsView = 'main';
  private capturingKey: { action: string; index: number } | null = null; // binding awaiting a key
  private keybindNote = '';
  // The Options > Performance panel, lazily built and reused (it caches the live
  // position-slider handles so a drag-to-move can update them in place).
  private perfSettings: PerfOverlaySettingsPanel | null = null;
  // The element to refocus when the window closes (WCAG 2.2 AA focus return).
  private returnFocus: HTMLElement | null = null;

  constructor(private readonly deps: OptionsWindowDeps) {}

  get isOpen(): boolean {
    return this.deps.root().style.display === 'block';
  }

  toggle(): void {
    if (this.isOpen) {
      this.close();
      return;
    }
    // Re-sync --app-vh/--app-vw right before opening: #ui is a fixed,
    // overflow:hidden box sized from those custom properties, and this window
    // is one of its children, so a stale value from just before a fullscreen
    // toggle or resize settles would hard-clip the panel with no visible
    // scrollbar (the panel's own overflow-y:auto never gets a chance to run).
    syncAppViewport();
    this.returnFocus = this.deps.captureFocus();
    this.deps.closeOthers();
    this.view = 'main';
    this.capturingKey = null;
    this.keybindNote = '';
    this.render();
    this.deps.root().style.display = 'block';
    music.pauseForMenu();
    audio.click();
  }

  // Close path (Esc/X close + the window-manager's closeManagedWindow case): hide
  // the panel, drop the key-capture + tooltip + perf overlay placement, resume
  // music, and return focus to the opener (WCAG 2.2 AA).
  close(): void {
    this.deps.root().style.display = 'none';
    this.capturingKey = null;
    this.deps.options()?.perfOverlay.setPlacement(false);
    this.deps.hideTooltip();
    music.resumeFromMenu();
    const target = this.returnFocus;
    this.returnFocus = null;
    this.deps.restoreFocus(target);
  }

  /** Called by main.ts when a drag settles on the live overlay: push the dropped
   *  normalized position into the open panel's sliders so they do not lag the drag. */
  onPerfOverlayMoved(x: number, y: number): void {
    this.perfSettings?.syncPosition(x, y);
  }

  /** Called by main.ts when a pad connects/disconnects: re-render the Controller
   *  sub-view in place if it is open, so the button glyphs switch to the newly
   *  detected brand without the player reopening the panel. A no-op otherwise. */
  refreshControllerLabels(): void {
    if (this.isOpen && this.view === 'controller') this.renderController();
  }

  // -------------------------------------------------------------------------
  // View dispatcher
  // -------------------------------------------------------------------------

  private render(): void {
    const el = this.deps.root();
    // WCAG 2.2 AA: the Esc/options menu is a focus-trapped window, so name the
    // root and give it a dialog role.
    // Name the dialog per sub-view. Every sub-view paints a <span id="options-title">
    // via panelTitle()/settingsViewShell() EXCEPT Performance, whose title comes from
    // the self-contained perf_overlay_settings panel (buildTitle has no such id). That
    // one view names itself with aria-label from the same key its title renders
    // (hudChrome.perf.title, no new key); markDialogRoot clears the opposite name so
    // aria-labelledby never dangles on a nameless dialog. Keeping the choice here avoids
    // leaking the options-title DOM-id contract into the perf module.
    markDialogRoot(
      el,
      this.view === 'performance'
        ? { label: t('hudChrome.perf.title') }
        : { labelledBy: 'options-title' },
    );
    // The wide multi-column layouts belong to their own sub-views; clear each when
    // leaving it so the other sub-views (and the main menu) keep their default width.
    if (this.view !== 'keybinds') el.classList.remove('kb-wide');
    if (this.view !== 'performance') el.classList.remove('perf-wide');
    // The overlay is draggable only while the Performance sub-view is open.
    this.deps.options()?.perfOverlay.setPlacement(this.view === 'performance');
    switch (this.view) {
      case 'keybinds':
        this.renderKeybinds();
        return;
      case 'graphics':
        this.renderGraphics();
        return;
      case 'audio':
        this.renderAudio();
        return;
      case 'interface':
        this.renderInterface();
        return;
      case 'controller':
        this.renderController();
        return;
      case 'performance':
        this.renderPerformance();
        return;
      case 'bugreport':
        this.renderBugReport();
        return;
      default:
        this.renderMain();
    }
  }

  private panelTitle(title: string): string {
    return `<div class="panel-title"><span id="options-title">${esc(title)}</span><button type="button" class="x-btn" data-close aria-label="${esc(t('hud.options.returnToGame'))}">${svgIcon('close')}</button></div>`;
  }

  private renderMain(): void {
    const el = this.deps.root();
    el.innerHTML = this.panelTitle(t('hud.options.gameMenu'));
    const list = document.createElement('div');
    list.className = 'opt-list';
    for (const entry of buildOptionsMenu({ bugReportAvailable: this.deps.bugReport() !== null })) {
      const b = document.createElement('button');
      b.className = 'btn opt-btn';
      b.textContent = t(entry.labelKey);
      b.addEventListener('click', () => {
        audio.click();
        const a = entry.action;
        if (a.kind === 'goto') {
          this.view = a.view;
          this.keybindNote = '';
          this.render();
        } else if (a.kind === 'logout') {
          this.deps.options()?.logout();
        } else {
          this.close();
        }
      });
      list.appendChild(b);
    }
    el.appendChild(list);
    el.querySelector('[data-close]')?.addEventListener('click', () => this.close());
  }

  // -------------------------------------------------------------------------
  // Control primitives (driven by the options_view descriptors)
  // -------------------------------------------------------------------------

  private settingsSource(hooks: OptionsHooks): OptionsSettingsSource {
    return {
      num: (key) => hooks.settings.get(key as NumericSettingKey),
      bool: (key) => hooks.settings.get(key as BoolSettingKey),
      range: (key) => SETTING_RANGES[key as NumericSettingKey],
    };
  }

  private sliderFormatter(fmt: SliderFmt): (v: number) => string {
    if (fmt === 'degrees')
      return (v) => `${formatNumber(Math.round(v), { maximumFractionDigits: 0 })}°`;
    if (fmt === 'oneDecimal') return (v) => formatNumber(v, { maximumFractionDigits: 1 });
    return (v) => formatNumber(v, { style: 'percent', maximumFractionDigits: 0 });
  }

  private applyControls(
    parent: HTMLElement,
    controls: OptionsControl[],
    hooks: OptionsHooks,
    rerender: () => void,
  ): void {
    for (const c of controls) {
      switch (c.control) {
        case 'slider':
          this.settingSlider(parent, c, hooks);
          break;
        case 'toggle':
          this.settingToggle(parent, c, hooks);
          break;
        case 'boolToggle':
          this.settingBoolToggle(parent, c, hooks);
          break;
        case 'choice':
          this.settingChoice(parent, c, hooks, c.rerender ? rerender : undefined);
          break;
        case 'note':
          this.noteRow(parent, c.textKey);
          break;
        case 'musicToggle':
          this.musicToggle(parent, c.labelKey);
          break;
      }
    }
  }

  // A labelled slider bound to a numeric setting; live-applies via the hook.
  private settingSlider(parent: HTMLElement, c: SliderControl, hooks: OptionsHooks): void {
    const key = c.key as NumericSettingKey;
    const label = t(c.labelKey);
    const row = document.createElement('div');
    row.className = 'set-row';
    const name = document.createElement('span');
    name.className = 'set-name';
    name.textContent = label;
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.className = 'set-slider';
    slider.min = String(c.min);
    slider.max = String(c.max);
    slider.step = String(c.step);
    slider.value = String(hooks.settings.get(key));
    slider.setAttribute('aria-label', label);
    const val = document.createElement('span');
    val.className = 'set-val';
    const fmt = this.sliderFormatter(c.fmt);
    // Mirror the formatted readout into the visible value AND aria-valuetext, so a
    // screen reader announces the human-meaningful value (50%, 90 degrees) instead
    // of the raw stored number. The native range already exposes role=slider plus
    // aria-valuenow/min/max from value/min/max, so only valuetext needs setting.
    const syncReadout = () => {
      const text = fmt(hooks.settings.get(key));
      val.textContent = text;
      slider.setAttribute('aria-valuetext', text);
    };
    syncReadout();
    // Paint a gold fill up to the current value on every engine (CSS alone can't
    // read the value; --range-fill drives the webkit track gradient and Firefox's
    // native progress is recolored to match). Set initially + on every input.
    const paintFill = () => {
      const min = Number(slider.min),
        max = Number(slider.max),
        v = Number(slider.value);
      const pct = max > min ? ((v - min) / (max - min)) * RANGE_FILL_FULL_PCT : 0;
      slider.style.setProperty(
        '--range-fill',
        `${Math.max(0, Math.min(RANGE_FILL_FULL_PCT, pct))}%`,
      );
    };
    paintFill();
    slider.addEventListener('input', () => {
      hooks.onSettingChange(key, sliderDispatchValue(slider.value));
      syncReadout();
      paintFill();
    });
    row.append(name, slider, val);
    parent.appendChild(row);
  }

  // A numeric 0/1 toggle (on when stored >= 0.5).
  private settingToggle(parent: HTMLElement, c: ToggleControl, hooks: OptionsHooks): void {
    const key = c.key as NumericSettingKey;
    const label = t(c.labelKey);
    const row = document.createElement('div');
    row.className = 'set-row';
    const name = document.createElement('span');
    name.className = 'set-name';
    name.textContent = label;
    const toggle = document.createElement('button');
    toggle.className = 'btn set-toggle';
    const sync = () => {
      const on = toggleIsOn(hooks.settings.get(key));
      toggle.textContent = on ? t('hud.options.on') : t('hud.options.off');
      toggle.classList.toggle('off', !on);
      toggle.setAttribute('aria-pressed', String(on));
      toggle.setAttribute('aria-label', label);
    };
    sync();
    toggle.addEventListener('click', () => {
      audio.click();
      hooks.onSettingChange(key, toggleNextValue(hooks.settings.get(key)));
      sync();
    });
    row.append(name, toggle);
    parent.appendChild(row);
  }

  // A true/false BOOL_SETTINGS toggle.
  private settingBoolToggle(parent: HTMLElement, c: BoolToggleControl, hooks: OptionsHooks): void {
    const key = c.key as BoolSettingKey;
    const label = t(c.labelKey);
    const row = document.createElement('div');
    row.className = 'set-row';
    const name = document.createElement('span');
    name.className = 'set-name';
    name.textContent = label;
    const toggle = document.createElement('button');
    toggle.className = 'btn set-toggle';
    const sync = () => {
      const on = hooks.settings.get(key);
      toggle.textContent = on ? t('hud.options.on') : t('hud.options.off');
      toggle.classList.toggle('off', !on);
      toggle.setAttribute('aria-pressed', String(on));
      toggle.setAttribute('aria-label', label);
    };
    sync();
    toggle.addEventListener('click', () => {
      audio.click();
      hooks.onSettingChange(
        key,
        hooks.settings.set(key, boolToggleNextValue(hooks.settings.get(key))),
      );
      sync();
    });
    row.append(name, toggle);
    parent.appendChild(row);
  }

  // An enumerated segmented choice; selecting fires onSettingChange with the
  // chosen value and optionally re-renders the panel (preset + interfaceMode).
  private settingChoice(
    parent: HTMLElement,
    c: ChoiceControl,
    hooks: OptionsHooks,
    onChange?: () => void,
  ): void {
    const key = c.key as NumericSettingKey;
    const label = t(c.labelKey);
    const row = document.createElement('div');
    row.className = 'set-row';
    const name = document.createElement('span');
    name.className = 'set-name';
    name.textContent = label;
    const wrap = document.createElement('div');
    wrap.className = 'set-choice';
    const sync = () => {
      const current = Math.round(hooks.settings.get(key));
      for (const btn of [...wrap.querySelectorAll<HTMLButtonElement>('button[data-value]')]) {
        const selected = Number(btn.dataset.value) === current;
        btn.classList.toggle('sel', selected);
        btn.setAttribute('aria-pressed', String(selected));
      }
    };
    for (const option of c.options) {
      const optionLabel = t(option.labelKey);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn set-choice-btn';
      btn.dataset.value = String(option.value);
      btn.textContent = optionLabel;
      btn.setAttribute('aria-label', optionLabel);
      btn.addEventListener('click', () => {
        audio.click();
        hooks.onSettingChange(key, option.value);
        sync();
        onChange?.();
      });
      wrap.appendChild(btn);
    }
    row.append(name, wrap);
    parent.appendChild(row);
    sync();
  }

  private noteRow(parent: HTMLElement, textKey: TranslationKey): void {
    const note = document.createElement('div');
    note.className = 'set-note';
    note.textContent = t(textKey);
    parent.appendChild(note);
  }

  // The bespoke music on/off toggle (reads the live MusicDirector, not a setting).
  private musicToggle(parent: HTMLElement, labelKey: TranslationKey): void {
    const label = t(labelKey);
    const row = document.createElement('div');
    row.className = 'set-row';
    const name = document.createElement('span');
    name.className = 'set-name';
    name.textContent = label;
    const toggle = document.createElement('button');
    toggle.className = 'btn set-toggle';
    const sync = () => {
      toggle.textContent = music.enabled ? t('hud.options.on') : t('hud.options.off');
      toggle.classList.toggle('off', !music.enabled);
      toggle.setAttribute('aria-pressed', String(music.enabled));
      toggle.setAttribute('aria-label', label);
    };
    sync();
    toggle.addEventListener('click', () => {
      audio.click();
      music.setEnabled(!music.enabled);
      sync();
    });
    row.append(name, toggle);
    parent.appendChild(row);
  }

  private settingsViewShell(title: string): HTMLElement {
    const el = this.deps.root();
    el.innerHTML = this.panelTitle(title);
    const body = document.createElement('div');
    body.className = 'set-rows';
    el.appendChild(body);
    return body;
  }

  private settingsViewFooter(): void {
    const el = this.deps.root();
    const reset = document.createElement('button');
    reset.className = 'btn';
    reset.textContent = t('hud.options.resetToDefaults');
    reset.addEventListener('click', () => {
      audio.click();
      this.deps.options()?.settings.reset();
      // re-apply every setting to its subsystem, then redraw the view
      const all = this.deps.options()?.settings.all();
      if (all)
        for (const k of Object.keys(all) as (keyof GameSettings)[])
          this.deps.options()?.onSettingChange(k, all[k]);
      this.render();
    });
    const back = document.createElement('button');
    back.className = 'btn';
    back.textContent = t('hud.options.back');
    back.addEventListener('click', () => {
      audio.click();
      this.view = 'main';
      this.render();
    });
    el.append(reset, back);
    el.querySelector('[data-close]')?.addEventListener('click', () => this.close());
  }

  // -------------------------------------------------------------------------
  // Graphics (cluster 3): static WebGL preset as a plain setting value; no
  // governor read, no effects-quality cutoff.
  // -------------------------------------------------------------------------

  private renderGraphics(): void {
    const hooks = this.deps.options();
    const body = this.settingsViewShell(t('hud.options.graphics'));
    if (hooks) {
      const controls = buildGraphicsControls(this.settingsSource(hooks), {
        touch: useTouchInterface(),
        nativeShell: isNativeAppShell(),
      });
      this.applyControls(body, controls, hooks, () => this.renderGraphics());
    }
    const el = this.deps.root();
    const note = document.createElement('div');
    note.className = 'set-note';
    note.textContent = t('hud.options.graphicsNote');
    el.appendChild(note);
    const reloadNote = document.createElement('div');
    reloadNote.className = 'set-note';
    reloadNote.textContent = t('hud.options.graphicsReloadNote');
    const reload = document.createElement('button');
    reload.type = 'button';
    reload.className = 'btn';
    reload.textContent = t('hud.options.reloadNow');
    reload.addEventListener('click', () => {
      audio.click();
      location.reload();
    });
    el.append(reloadNote, reload);
    this.settingsViewFooter();
  }

  // -------------------------------------------------------------------------
  // Audio (cluster 4)
  // -------------------------------------------------------------------------

  private renderAudio(): void {
    const hooks = this.deps.options();
    const body = this.settingsViewShell(t('hud.options.audio'));
    if (hooks)
      this.applyControls(body, buildAudioControls(this.settingsSource(hooks)), hooks, () =>
        this.renderAudio(),
      );
    this.settingsViewFooter();
  }

  // -------------------------------------------------------------------------
  // Interface & Comfort (cluster 5): language picker + theme + comfort sliders
  // + chat-timestamp options.
  // -------------------------------------------------------------------------

  // In-game language picker (mirrors the homepage footer picker). Switching is
  // delegated to OptionsHooks.changeLanguage (main.ts owns the locale load + page
  // relocalization); the HUD relocalizes its dynamic UI off woc:languagechange.
  private languageSelect(parent: HTMLElement): void {
    const hooks = this.deps.options();
    if (!hooks) return;
    const row = document.createElement('div');
    row.className = 'set-row';
    const name = document.createElement('span');
    name.className = 'set-name';
    name.textContent = t('hud.options.language');
    // Custom gold-themed dropdown (.ui-dd) rather than a native <select>, so the
    // open option list matches the MMO theme; buildDropdown carries the listbox
    // ARIA + keyboard semantics a native <select> would have.
    const options = supportedLanguages.map((lang) => ({
      value: lang,
      label: LANGUAGE_ENDONYMS[lang],
    }));
    // aria-live status for the async locale load (loading / load-failed).
    const status = document.createElement('span');
    status.className = 'visually-hidden';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    let busy = false;
    const dropdown = this.deps.buildDropdown(
      options,
      getLanguage(),
      (selected) => {
        if (busy || !isSupportedLanguage(selected) || selected === getLanguage()) return;
        audio.click();
        busy = true;
        void hooks
          .changeLanguage(selected, (msg) => {
            status.textContent = msg;
          })
          .then((ok) => {
            if (ok) {
              // Success: rebuild the panel in the new language (re-creates this picker
              // at the now-active locale).
              if (this.isOpen && this.view === 'interface') {
                this.renderInterface();
                // Return keyboard focus to the fresh picker trigger so it isn't lost to <body>.
                this.deps.focusFirstInteractive(this.deps.root(), '.set-lang-select .ui-dd-btn');
              }
            } else {
              // Graceful failure (the locale chunk failed to load): the active locale
              // is unchanged. Revert the trigger IN PLACE, don't renderInterface(),
              // which would rebuild and wipe the aria-live `status` node that
              // changeLanguage just wrote the failure message into.
              this.deps.setDropdownValue(dropdown, getLanguage());
            }
          })
          .catch(() => {
            // Defensive: changeLanguage swallows load errors and resolves false, so
            // this is unreachable today, but if it ever throws, keep the same
            // in-place revert + intact live region rather than rebuilding.
            status.textContent = t('settings.languageLoadFailed');
            this.deps.setDropdownValue(dropdown, getLanguage());
          })
          .finally(() => {
            busy = false;
          });
      },
      undefined,
      { ariaLabel: t('hud.options.language') },
    );
    dropdown.classList.add('set-lang-select');
    row.append(name, dropdown);
    parent.append(row, status);
  }

  // UI theme picker: a preset selector plus a full-palette custom-colour block.
  // Preset/custom changes route through OptionsHooks.theme; main.ts persists and
  // live-applies the resulting CSS variables, so no reload is needed.
  private renderThemeControls(body: HTMLElement): void {
    const hooks = this.deps.options();
    if (!hooks) return;
    const theme = hooks.theme;

    const presetRow = document.createElement('div');
    presetRow.className = 'set-row';
    const presetName = document.createElement('span');
    presetName.className = 'set-name';
    presetName.textContent = t('hudChrome.theme.preset');
    const seg = document.createElement('div');
    seg.className = 'set-seg theme-presets';
    const presetLabel = (id: PresetId): string =>
      t(`hudChrome.theme.presets.${id}` as TranslationKey);
    for (const id of PRESET_ORDER) {
      const btn = document.createElement('button');
      btn.className = 'btn set-seg-btn';
      btn.textContent = presetLabel(id);
      btn.classList.toggle('active', theme.get().preset === id);
      btn.addEventListener('click', () => {
        audio.click();
        theme.setPreset(id);
        this.renderInterface(); // refresh active state + custom pickers
      });
      seg.appendChild(btn);
    }
    presetRow.append(presetName, seg);
    body.appendChild(presetRow);

    // Custom palette: one colour input per knob, seeded with the effective value.
    const effective = resolveTheme(theme.get());
    const customCount = Object.keys(theme.get().custom).length;
    const customRow = document.createElement('div');
    customRow.className = 'set-row theme-custom-head';
    const customName = document.createElement('span');
    customName.className = 'set-name';
    customName.textContent = t('hudChrome.theme.customColors');
    const reset = document.createElement('button');
    reset.className = 'btn set-toggle';
    reset.textContent = t('hudChrome.theme.reset');
    reset.disabled = customCount === 0;
    reset.addEventListener('click', () => {
      audio.click();
      theme.resetCustom();
      this.renderInterface();
    });
    customRow.append(customName, reset);
    body.appendChild(customRow);

    const grid = document.createElement('div');
    grid.className = 'theme-color-grid';
    for (const knob of THEME_KNOB_ORDER) {
      const row = document.createElement('label');
      row.className = 'theme-color-row';
      const swatchLabel = document.createElement('span');
      swatchLabel.textContent = t(
        `hudChrome.theme.knob.${THEME_KNOB_LABEL_KEY[knob]}` as TranslationKey,
      );
      const input = document.createElement('input');
      input.type = 'color';
      input.value = effective[knob];
      input.setAttribute('aria-label', swatchLabel.textContent);
      // 'input' fires continuously while dragging the picker -> live preview.
      input.addEventListener('input', () => theme.setCustom(knob, input.value));
      input.addEventListener('change', () => {
        theme.setCustom(knob, input.value);
        reset.disabled = false;
      });
      row.append(input, swatchLabel);
      grid.appendChild(row);
    }
    body.appendChild(grid);
  }

  private renderInterface(): void {
    const body = this.settingsViewShell(t('hud.options.interface'));
    this.languageSelect(body);
    this.renderThemeControls(body);
    const hooks = this.deps.options();
    if (hooks)
      this.applyControls(body, buildInterfaceControls(this.settingsSource(hooks)), hooks, () =>
        this.renderInterface(),
      );

    // On/off toggle for chat timestamps.
    const tsRow = document.createElement('div');
    tsRow.className = 'set-row';
    const tsName = document.createElement('span');
    tsName.className = 'set-name';
    tsName.textContent = t('hudChrome.chatTimestamps.show');
    const tsToggle = document.createElement('button');
    tsToggle.className = 'btn set-toggle';

    // 12/24-hour format selector: two segmented buttons, dimmed when off.
    const fmtRow = document.createElement('div');
    fmtRow.className = 'set-row';
    const fmtName = document.createElement('span');
    fmtName.className = 'set-name';
    fmtName.textContent = t('hudChrome.chatTimestamps.format');
    const seg = document.createElement('div');
    seg.className = 'set-seg';
    const btn12 = document.createElement('button');
    btn12.className = 'btn set-seg-btn';
    btn12.textContent = t('hudChrome.chatTimestamps.clock12h');
    const btn24 = document.createElement('button');
    btn24.className = 'btn set-seg-btn';
    btn24.textContent = t('hudChrome.chatTimestamps.clock24h');
    seg.append(btn12, btn24);
    fmtRow.append(fmtName, seg);

    const sync = () => {
      const on = this.deps.getChatTimestamps();
      tsToggle.textContent = on ? t('hud.options.on') : t('hud.options.off');
      tsToggle.classList.toggle('off', !on);
      tsToggle.setAttribute('aria-pressed', String(on));
      btn12.classList.toggle('active', this.deps.getChatClock() === '12h');
      btn24.classList.toggle('active', this.deps.getChatClock() === '24h');
      fmtRow.classList.toggle('disabled', !on);
      btn12.disabled = !on;
      btn24.disabled = !on;
    };
    sync();

    tsToggle.addEventListener('click', () => {
      audio.click();
      this.deps.setChatTimestamps(!this.deps.getChatTimestamps());
      sync();
    });
    const setClock = (clock: ChatClock) => {
      if (!this.deps.getChatTimestamps()) return;
      audio.click();
      this.deps.setChatClock(clock);
      sync();
    };
    btn12.addEventListener('click', () => setClock('12h'));
    btn24.addEventListener('click', () => setClock('24h'));

    tsRow.append(tsName, tsToggle);
    body.append(tsRow, fmtRow);

    // Reset the movable/resizable chat window back to its default placement.
    const resetRow = document.createElement('div');
    resetRow.className = 'set-row';
    const resetName = document.createElement('span');
    resetName.className = 'set-name';
    resetName.textContent = t('hudChrome.chatWindow.reset');
    const resetBtn = document.createElement('button');
    resetBtn.className = 'btn set-toggle';
    resetBtn.textContent = t('hudChrome.chatWindow.resetAction');
    resetBtn.addEventListener('click', () => {
      audio.click();
      this.deps.resetChatWindow();
    });
    resetRow.append(resetName, resetBtn);
    body.append(resetRow);

    // Reset the movable player + target unit frames back to their stock spots
    // (forgets the saved drag positions and re-docks the player frame).
    const framesRow = document.createElement('div');
    framesRow.className = 'set-row';
    const framesName = document.createElement('span');
    framesName.className = 'set-name';
    framesName.textContent = t('hudChrome.frameReset.label');
    const framesBtn = document.createElement('button');
    framesBtn.className = 'btn set-toggle';
    framesBtn.textContent = t('hudChrome.chatWindow.resetAction');
    framesBtn.addEventListener('click', () => {
      audio.click();
      this.deps.resetUnitFrames();
    });
    framesRow.append(framesName, framesBtn);
    body.append(framesRow);

    const el = this.deps.root();
    const note = document.createElement('div');
    note.className = 'set-note';
    note.textContent = t('hudChrome.chatTimestamps.note');
    el.appendChild(note);

    const chatWinNote = document.createElement('div');
    chatWinNote.className = 'set-note';
    chatWinNote.textContent = t('hudChrome.chatWindow.note');
    el.appendChild(chatWinNote);

    const back = document.createElement('button');
    back.className = 'btn';
    back.textContent = t('hud.options.back');
    back.addEventListener('click', () => {
      audio.click();
      this.view = 'main';
      this.render();
    });
    el.appendChild(back);
    el.querySelector('[data-close]')?.addEventListener('click', () => this.close());
  }

  // -------------------------------------------------------------------------
  // Performance overlay panel (thin delegate to perf_overlay_settings.ts)
  // -------------------------------------------------------------------------

  private renderPerformance(): void {
    const hooks = this.deps.options();
    if (!hooks) return;
    this.perfSettings ??= new PerfOverlaySettingsPanel(this.perfSettingsHost(hooks));
    this.perfSettings.render(this.deps.root());
  }

  private perfSettingsHost(hooks: OptionsHooks): PerfSettingsHost {
    return {
      perf: hooks.perfOverlay,
      getShowFps: () => hooks.settings.get('showFps'),
      setShowFps: (on) => hooks.onSettingChange('showFps', on),
      click: () => audio.click(),
      onClose: () => this.close(),
      onBack: () => {
        this.view = 'main';
        this.render();
      },
      closeIconHtml: svgIcon('close'),
    };
  }

  // -------------------------------------------------------------------------
  // Bug report (cluster 2)
  // -------------------------------------------------------------------------

  private renderBugReport(): void {
    const hooks = this.deps.bugReport();
    if (!hooks) {
      this.view = 'main';
      this.render();
      return;
    }
    const body = this.settingsViewShell(t('hudChrome.bugReport.menuButton'));
    const info = buildBugReportInfo(this.deps.world().realm, this.deps.world().player);
    const realm = info.realmKnown ? info.realm : t('hudChrome.bugReport.unknown');
    const coords =
      `${formatNumber(info.pos.x, { maximumFractionDigits: 0, useGrouping: false })}, ` +
      `${formatNumber(info.pos.y, { maximumFractionDigits: 0, useGrouping: false })}, ` +
      `${formatNumber(info.pos.z, { maximumFractionDigits: 0, useGrouping: false })}`;

    const infoEl = document.createElement('div');
    infoEl.className = 'bug-info';
    const infoRow = (label: string, value: string): string =>
      `<div class="bug-info-row"><span class="bug-info-label">${esc(label)}</span><span class="bug-info-val">${esc(value)}</span></div>`;
    infoEl.innerHTML =
      infoRow(t('hudChrome.bugReport.realm'), realm) +
      infoRow(t('hudChrome.bugReport.character'), info.characterName) +
      infoRow(t('hudChrome.bugReport.position'), coords);
    body.appendChild(infoEl);

    // Capture once when the form opens so the screenshot reflects what the player
    // saw, not a later frame. null when capture is unavailable/failed.
    const shot = hooks.capture();

    const descLabel = document.createElement('label');
    descLabel.className = 'bug-label';
    descLabel.setAttribute('for', 'bug-desc');
    descLabel.textContent = t('hudChrome.bugReport.description');
    const desc = document.createElement('textarea');
    desc.id = 'bug-desc';
    desc.className = 'bug-desc';
    desc.maxLength = BUG_DESC_MAX_LEN;
    desc.setAttribute('placeholder', t('hudChrome.bugReport.descriptionPlaceholder'));
    desc.setAttribute('aria-describedby', 'bug-error');
    body.append(descLabel, desc);

    let includeShot = shot !== null;
    if (shot) {
      const shotWrap = document.createElement('div');
      shotWrap.className = 'bug-shot';
      const img = document.createElement('img');
      img.className = 'bug-shot-img';
      img.src = shot;
      img.alt = t('hudChrome.bugReport.screenshotAlt');
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'btn set-toggle';
      const syncToggle = () => {
        toggle.textContent = includeShot ? t('hud.options.on') : t('hud.options.off');
        toggle.classList.toggle('off', !includeShot);
        toggle.setAttribute('aria-pressed', String(includeShot));
        toggle.setAttribute('aria-label', t('hudChrome.bugReport.includeScreenshot'));
        img.style.display = includeShot ? '' : 'none';
      };
      toggle.addEventListener('click', () => {
        audio.click();
        includeShot = !includeShot;
        syncToggle();
      });
      syncToggle();
      const toggleRow = document.createElement('div');
      toggleRow.className = 'set-row';
      const name = document.createElement('span');
      name.className = 'set-name';
      name.textContent = t('hudChrome.bugReport.includeScreenshot');
      toggleRow.append(name, toggle);
      shotWrap.append(toggleRow, img);
      body.appendChild(shotWrap);
    }

    const error = document.createElement('div');
    error.className = 'report-error';
    error.id = 'bug-error';
    // role="alert" already implies an assertive live region; a second aria-live
    // would conflict, so it is the only announcement hook on this node.
    error.setAttribute('role', 'alert');
    body.appendChild(error);

    const actions = document.createElement('div');
    actions.className = 'report-actions';
    const submit = document.createElement('button');
    submit.className = 'btn';
    submit.type = 'button';
    submit.textContent = t('hudChrome.bugReport.submit');
    const back = document.createElement('button');
    back.className = 'btn';
    back.type = 'button';
    back.textContent = t('hud.options.back');
    back.addEventListener('click', () => {
      audio.click();
      this.view = 'main';
      this.render();
    });
    actions.append(submit, back);
    body.appendChild(actions);

    submit.addEventListener('click', () => {
      const description = desc.value.trim();
      if (!description) {
        error.textContent = t('hudChrome.bugReport.describeFirst');
        return;
      }
      submit.disabled = true;
      error.textContent = '';
      const sentShot = includeShot && shot !== null;
      hooks
        .submit({ description, screenshot: includeShot ? shot : null, meta: hooks.collectMeta() })
        .then(({ screenshotStored }) => {
          // Be honest when the server dropped a screenshot the player asked to send.
          const droppedShot = sentShot && !screenshotStored;
          this.deps.log(
            t(
              droppedShot ? 'hudChrome.bugReport.submittedNoShot' : 'hudChrome.bugReport.submitted',
            ),
          );
          this.view = 'main';
          this.render();
        })
        .catch((err: unknown) => {
          submit.disabled = false;
          error.textContent = this.localizeBugReportError(err);
        });
    });

    this.deps
      .root()
      .querySelector('[data-close]')
      ?.addEventListener('click', () => this.close());
    // Focus the description so a keyboard/screen-reader user lands in the field.
    window.setTimeout(() => desc.focus(), 0);
  }

  private localizeBugReportError(err: unknown): string {
    const text = err instanceof Error ? err.message : '';
    const keyByMessage: Record<string, TranslationKey> = {
      'describe the bug': 'hudChrome.bugReport.describeFirst',
      'bug report too large': 'hudChrome.bugReport.tooLarge',
      'too many bug reports, try again later': 'hudChrome.bugReport.rateLimited',
    };
    const key = keyByMessage[text.toLowerCase()];
    return key ? t(key) : t('hudChrome.bugReport.failed');
  }

  // -------------------------------------------------------------------------
  // Controller (cluster 5): enable/invert toggles + sliders + per-button remap.
  // -------------------------------------------------------------------------

  // Display name for an action row. Action-bar slots show the shortcut that
  // currently occupies them (slot 0 is always Attack); everything else uses its
  // registry label.
  private actionDisplayName(actionId: string, fallback: string): string {
    if (!actionId.startsWith('slot'))
      return BIND_ACTION_LABEL_KEYS[actionId] ? t(BIND_ACTION_LABEL_KEYS[actionId]) : fallback;
    const slot = Number(actionId.slice(4));
    if (slot === 0) return t('hud.keybinds.actions.attack');
    return (
      this.deps.slotActionName(slot) ?? t('hud.keybinds.actions.actionBarSlot', { slot: slot + 1 })
    );
  }

  // Action ids a gamepad button may be bound to: explicit unbind, the game menu,
  // plus every one-shot (edge) keybind action and Jump. Movement-axis actions
  // (forward/strafe/turn) are excluded, they live on the analog stick.
  private gamepadActionOptions(): { value: string; label: string }[] {
    const opts: { value: string; label: string }[] = [
      { value: GAMEPAD_NONE, label: t('hud.options.unbound') },
      { value: 'escape', label: t('hudChrome.controller.menuAction') },
    ];
    for (const a of BIND_ACTIONS) {
      if (a.id === 'attackMove') continue; // mode-gated; not a useful pad default
      if (a.kind !== 'edge' && a.id !== 'jump') continue;
      opts.push({ value: a.id, label: this.actionDisplayName(a.id, a.label) });
    }
    return opts;
  }

  private renderController(): void {
    const hooks = this.deps.options();
    const body = this.settingsViewShell(t('hudChrome.controller.title'));
    if (hooks)
      this.applyControls(body, buildControllerControls(this.settingsSource(hooks)), hooks, () =>
        this.renderController(),
      );

    const note = document.createElement('div');
    note.className = 'set-note';
    note.textContent = t('hudChrome.controller.help');
    body.appendChild(note);

    const head = document.createElement('div');
    head.className = 'kb-cat';
    head.textContent = t('hudChrome.controller.buttons');
    body.appendChild(head);

    if (hooks) {
      const opts = this.gamepadActionOptions();
      const kind = hooks.gamepad.kind();
      for (const { button, action } of hooks.gamepad.entries()) {
        const row = document.createElement('div');
        row.className = 'set-row';
        const name = document.createElement('span');
        name.className = 'set-name';
        const buttonLabel = gamepadButtonLabel(button, kind);
        name.textContent = buttonLabel;
        // Name the remap listbox after the physical button it rebinds (WCAG 4.1.2):
        // the visible set-name span is not programmatically linked, so the dropdown
        // would otherwise be an unnamed listbox. The button labels are physical
        // hardware names (gamepad_map.ts), intentionally non-localized, like the
        // language picker's ariaLabel above.
        const dd = this.deps.buildDropdown(
          opts,
          action,
          (v) => hooks.gamepad.bind(button, v),
          undefined,
          {
            ariaLabel: buttonLabel,
          },
        );
        row.append(name, dd);
        body.appendChild(row);
      }
      const reset = document.createElement('button');
      reset.type = 'button';
      reset.className = 'btn';
      reset.textContent = t('hudChrome.controller.resetButtons');
      reset.addEventListener('click', () => {
        audio.click();
        hooks.gamepad.reset();
        this.renderController();
      });
      body.appendChild(reset);
    }
    this.settingsViewFooter();
  }

  // -------------------------------------------------------------------------
  // Key Bindings (cluster 5)
  // -------------------------------------------------------------------------

  // Toggle row styled for the Key Bindings panel. Handles the bool Mouse Camera
  // setting and the numeric (0/1) Click to Move setting, which both live here
  // alongside the rebindable keys.
  private settingToggleKeybind(
    parent: HTMLElement,
    label: string,
    key: BoolSettingKey | 'clickToMove',
    help?: string,
  ): void {
    const hooks = this.deps.options();
    if (!hooks) return;
    const isOn = () =>
      key === 'clickToMove' ? hooks.settings.get(key) >= 0.5 : hooks.settings.get(key);
    const row = document.createElement('div');
    row.className = 'kb-row kb-toggle-row';
    const name = document.createElement('span');
    name.className = 'kb-name';
    name.textContent = label;
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'btn kb-key kb-toggle';
    const sync = () => {
      const on = isOn();
      toggle.textContent = on ? t('hud.options.on') : t('hud.options.off');
      toggle.classList.toggle('off', !on);
      toggle.setAttribute('aria-pressed', on ? 'true' : 'false');
      toggle.setAttribute('aria-label', label);
    };
    sync();
    toggle.addEventListener('click', () => {
      audio.click();
      const next = !isOn();
      if (key === 'clickToMove') hooks.onSettingChange(key, next ? 1 : 0);
      else hooks.onSettingChange(key, hooks.settings.set(key, next));
      sync();
      // Attack Move reveals/hides its rebindable key row, so redraw the panel.
      if (key === 'attackMove') this.renderKeybinds();
    });
    row.append(name, toggle);
    parent.appendChild(row);
    if (help) {
      const hint = document.createElement('div');
      hint.className = 'kb-note kb-toggle-help';
      hint.textContent = help;
      parent.appendChild(hint);
    }
  }

  private clickMoveMouseButtonRow(parent: HTMLElement): void {
    const hooks = this.deps.options();
    if (!hooks) return;
    const row = document.createElement('div');
    row.className = 'kb-row kb-toggle-row';
    const name = document.createElement('span');
    name.className = 'kb-name';
    name.textContent = t('hud.options.clickMoveButton');
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'btn kb-key kb-toggle kb-mouse-toggle';
    const sync = () => {
      toggle.textContent = t(
        normalizeClickMoveButton(hooks.settings.get('clickToMoveButton')) === 2
          ? 'hudChrome.options.clickMoveRight'
          : 'hudChrome.options.clickMoveLeft',
      );
      toggle.setAttribute(
        'aria-label',
        `${t('hud.options.clickMoveButton')}: ${toggle.textContent}`,
      );
    };
    sync();
    toggle.addEventListener('click', () => {
      audio.click();
      const next = normalizeClickMoveButton(hooks.settings.get('clickToMoveButton')) === 0 ? 2 : 0;
      hooks.onSettingChange('clickToMoveButton', next);
      sync();
    });
    row.append(name, toggle);
    parent.appendChild(row);
  }

  private renderKeybinds(): void {
    const el = this.deps.root();
    const hooks = this.deps.options();
    // Wide, multi-column layout for the key-binding view only; other options
    // sub-views (graphics/audio/interface) keep the default 420px width.
    el.classList.add('kb-wide');
    el.innerHTML = this.panelTitle(t('hud.options.keyBindings'));
    this.settingToggleKeybind(el, t('hud.options.mouseCamera'), 'mouseCamera');
    this.settingToggleKeybind(
      el,
      t('hudChrome.options.lockCursorOnRotate'),
      'lockCursorOnRotate',
      t('hudChrome.options.keybindHelpLockCursorOnRotate'),
    );
    this.settingToggleKeybind(el, t('hud.options.clickToMove'), 'clickToMove');
    this.clickMoveMouseButtonRow(el);
    this.settingToggleKeybind(el, t('hud.keybinds.actions.attackMove'), 'attackMove');
    this.settingToggleKeybind(el, t('hud.options.leftHandedTouch'), 'leftHandedTouch');
    this.settingToggleKeybind(el, t('hud.options.filterProfanity'), 'filterProfanity');
    const note = document.createElement('div');
    note.className = 'kb-note';
    note.textContent = this.keybindNote || t('hud.options.keybindHelpMouseCamera');
    el.appendChild(note);
    const cols = document.createElement('div');
    cols.className = 'kb-cols';
    // The Attack Move key is only meaningful (and only rebindable) while its mode
    // is on; otherwise hide its row so it can't shadow Turn Left's A in the list.
    const attackMoveOn = !!hooks?.settings.get('attackMove');
    for (const category of BIND_CATEGORIES) {
      const visible = BIND_ACTIONS.filter(
        (a) => a.category === category && (a.id !== 'attackMove' || attackMoveOn),
      );
      if (visible.length === 0) continue;
      // Each category is its own column block (header + its rows) so the wide
      // grid can flow categories side by side; on mobile they stack to one column.
      const col = document.createElement('div');
      col.className = 'kb-col';
      const header = document.createElement('div');
      header.className = 'kb-cat';
      header.textContent = BIND_CATEGORY_LABEL_KEYS[category]
        ? t(BIND_CATEGORY_LABEL_KEYS[category])
        : category;
      col.appendChild(header);
      const rows = document.createElement('div');
      rows.className = 'kb-rows';
      for (const action of visible) {
        const row = document.createElement('div');
        row.className = 'kb-row';
        const name = document.createElement('span');
        name.className = 'kb-name';
        const label = document.createElement('span');
        label.className = 'kb-label';
        label.textContent = this.actionDisplayName(action.id, action.label);
        const hint = document.createElement('span');
        hint.className = 'kb-inline-key';
        const primary = this.deps.keybinds().labelAt(action.id, 0);
        hint.textContent = primary ? `(${primary})` : '';
        name.append(label, hint);
        row.appendChild(name);
        for (let index = 0; index < 2; index++) {
          const capturing =
            this.capturingKey?.action === action.id && this.capturingKey?.index === index;
          const key = document.createElement('button');
          key.className = `btn kb-key${capturing ? ' capturing' : ''}`;
          key.textContent = capturing
            ? '...'
            : this.deps.keybinds().labelAt(action.id, index) || t('hud.options.unbound');
          key.title = index === 0 ? t('hud.options.primary') : t('hud.options.alternate');
          key.setAttribute(
            'aria-label',
            `${this.actionDisplayName(action.id, action.label)} ${key.title}`,
          );
          key.addEventListener('click', () => this.beginCapture(action.id, index, action.label));
          row.appendChild(key);
        }
        rows.appendChild(row);
      }
      col.appendChild(rows);
      cols.appendChild(col);
    }
    el.appendChild(cols);
    const reset = document.createElement('button');
    reset.className = 'btn';
    reset.textContent = t('hud.options.resetToDefaults');
    reset.addEventListener('click', () => {
      audio.click();
      this.deps.keybinds().reset();
      this.capturingKey = null;
      this.keybindNote = t('hud.options.keybindReset');
      this.deps.refreshKeybindLabels();
      this.renderKeybinds();
    });
    const back = document.createElement('button');
    back.className = 'btn';
    back.textContent = t('hud.options.back');
    back.addEventListener('click', () => {
      audio.click();
      this.view = 'main';
      this.capturingKey = null;
      this.render();
    });
    el.append(reset, back);
    el.querySelector('[data-close]')?.addEventListener('click', () => this.close());
  }

  private beginCapture(actionId: string, index: number, fallbackLabel: string): void {
    const hooks = this.deps.options();
    if (!hooks) return;
    const name = this.actionDisplayName(actionId, fallbackLabel);
    this.capturingKey = { action: actionId, index };
    this.keybindNote = t('hud.options.keybindCapture', { action: name });
    this.renderKeybinds();
    hooks.captureKey((code) => {
      this.capturingKey = null;
      if (code === null) {
        this.keybindNote = t('hud.options.keybindCancelled');
      } else if (this.deps.keybinds().bind(actionId, index, code)) {
        // Label what was actually stored: bind() strips modifiers from held
        // (movement) actions, so a captured "Shift+KeyW" is saved bare as "KeyW".
        // Reading it back keeps the confirmation in sync with the action-bar keycap.
        this.keybindNote = t('hud.options.keybindBound', {
          action: name,
          key: keyLabel(this.deps.keybinds().codeAt(actionId, index)),
        });
        this.deps.refreshKeybindLabels();
      } else if (isReservedCode(code)) {
        this.keybindNote = t('hud.options.keybindReserved', { key: keyLabel(code) });
      }
      // re-render only if the menu is still open (player may have closed it)
      if (this.isOpen) this.renderKeybinds();
    });
  }
}
