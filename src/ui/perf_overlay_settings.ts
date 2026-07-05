// The Options > Performance settings panel (the wide, categorized card layout).
//
// Lifted out of hud.ts as the pure-presentation consumer of the overlay's config
// store: it builds the panel DOM, groups the metric toggles by category, and wires
// every control to the injected PerfOverlayHooks. hud.ts owns only a thin delegate
// (renderPerformance -> panel.render). The panel is self-contained — its own
// controls re-render it via the host callbacks — and exposes syncPosition() so a
// drag-to-move on the live overlay can push the dropped X/Y back into the sliders
// without a full re-render.

import { formatNumber, t } from './i18n';
import type { PerfOverlayConfig, PerfOverlayPatch } from './perf_overlay_config';
import { FONT_SCALE_MAX, FONT_SCALE_MIN } from './perf_overlay_config';
import {
  metricsPreset, perfMetricGroups, PERF_COLOR_THEMES, type PerfMetricKey,
} from './perf_overlay_model';
import {
  colorControl, settingsCard, settingRow, sliderControl, subhead, toggleControl,
} from './settings_controls';

/** Drives the customizable performance overlay from the Options > Performance
 *  sub-view. The overlay's master on/off rides on GameSettings (`showFps`); this
 *  covers its richer appearance/layout/metrics config (own localStorage key) plus
 *  the drag-to-reposition placement mode. main.ts wires the implementation. */
export interface PerfOverlayHooks {
  get(): PerfOverlayConfig;
  patch(p: PerfOverlayPatch): void;
  setMetric(key: PerfMetricKey, on: boolean): void;
  reset(): void;
  resetPosition(): void;
  setPlacement(on: boolean): void;
}

/** Glue the HUD wires so the panel can read/flip the master toggle, play the UI
 *  click, and navigate, without importing GameSettings/audio/icons directly. */
export interface PerfSettingsHost {
  perf: PerfOverlayHooks;
  getShowFps(): boolean;
  setShowFps(on: boolean): void;
  /** UI click sound, fired on button/preset/theme activations. */
  click(): void;
  /** Title "X": return to the game. */
  onClose(): void;
  /** Footer "Back": return to the main options list. */
  onBack(): void;
  /** svgIcon('close') markup for the title button (trusted, not user text). */
  closeIconHtml: string;
}

const PERCENT = (v: number): string => formatNumber(v, { style: 'percent', maximumFractionDigits: 0 });

export class PerfOverlaySettingsPanel {
  private container: HTMLElement | null = null;
  private posX: { setValue: (v: number) => void } | null = null;
  private posY: { setValue: (v: number) => void } | null = null;

  constructor(private readonly host: PerfSettingsHost) {}

  /** (Re)build the whole panel into the options-menu container. */
  render(container: HTMLElement): void {
    this.container = container;
    const perf = this.host.perf;
    // The overlay is draggable only while this view is on screen.
    perf.setPlacement(true);

    container.classList.add('perf-wide');
    container.replaceChildren();
    this.posX = null;
    this.posY = null;

    container.appendChild(this.buildTitle());

    const panel = div('perf-panel');
    container.appendChild(panel);

    this.buildMaster(panel);

    const cols = div('perf-cols');
    panel.appendChild(cols);
    const left = div('perf-col');
    const right = div('perf-col');
    cols.append(left, right);

    this.buildStatsCard(left);
    this.buildAppearanceCard(right);
    this.buildPositionCard(right);

    container.appendChild(this.buildFooter());
  }

  /** Push a dropped drag position back into the X/Y sliders (no full re-render). */
  syncPosition(x: number, y: number): void {
    this.posX?.setValue(x);
    this.posY?.setValue(y);
  }

  private rerender(): void {
    if (this.container) this.render(this.container);
  }

  private cfg(): PerfOverlayConfig {
    return this.host.perf.get();
  }

  // ---- sections ----------------------------------------------------------

  private buildTitle(): HTMLElement {
    const title = div('panel-title');
    const label = document.createElement('span');
    label.textContent = t('hudChrome.perf.title');
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'x-btn';
    close.setAttribute('aria-label', t('hud.options.returnToGame'));
    close.innerHTML = this.host.closeIconHtml; // trusted svg markup
    close.addEventListener('click', () => this.host.onClose());
    title.append(label, close);
    return title;
  }

  private buildMaster(parent: HTMLElement): void {
    const wrap = div('perf-master');
    toggleControl({
      parent: wrap,
      label: t('hudChrome.perf.enable'),
      get: () => this.host.getShowFps(),
      set: (v) => { this.host.setShowFps(v); this.rerender(); },
      onLabel: t('hud.options.on'),
      offLabel: t('hud.options.off'),
      onActivate: () => this.host.click(),
    });
    const desc = div('set-note');
    desc.textContent = t('hudChrome.perf.description');
    wrap.appendChild(desc);
    parent.appendChild(wrap);
  }

  private buildStatsCard(parent: HTMLElement): void {
    const perf = this.host.perf;
    const card = settingsCard(parent, t('hudChrome.perf.sectionStats'));

    // Quick presets that bulk-set the per-metric visibility map: an equal 3-up row
    // under its own subhead, prominent and easy to tap.
    const presets: { kind: 'minimal' | 'standard' | 'everything'; label: string }[] = [
      { kind: 'minimal', label: t('hudChrome.perf.presetMinimal') },
      { kind: 'standard', label: t('hudChrome.perf.presetStandard') },
      { kind: 'everything', label: t('hudChrome.perf.presetEverything') },
    ];
    const presetsLabel = t('hudChrome.perf.presetsLabel');
    subhead(card, presetsLabel);
    const presetWrap = div('perf-presets');
    // Tie the preset cluster to its label for assistive tech.
    presetWrap.setAttribute('role', 'group');
    presetWrap.setAttribute('aria-label', presetsLabel);
    for (const p of presets) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn perf-preset-btn';
      btn.textContent = p.label;
      btn.setAttribute('aria-label', p.label);
      btn.addEventListener('click', () => {
        this.host.click();
        perf.patch({ metrics: metricsPreset(p.kind) });
        this.rerender();
      });
      presetWrap.appendChild(btn);
    }
    card.appendChild(presetWrap);

    // Metric toggle chips, grouped under category subheads.
    for (const { group, chips } of perfMetricGroups()) {
      const groupLabel = t(group.labelKey);
      subhead(card, groupLabel);
      const wrap = div('perf-chips');
      // Tie the chip cluster to its category name for assistive tech.
      wrap.setAttribute('role', 'group');
      wrap.setAttribute('aria-label', groupLabel);
      for (const chip of chips) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn set-choice-btn';
        const label = t(chip.labelKey);
        btn.textContent = label;
        const isOn = (): boolean => perf.get().metrics[chip.key];
        const sync = (): void => {
          const on = isOn();
          btn.classList.toggle('sel', on);
          btn.setAttribute('aria-pressed', String(on));
          btn.setAttribute('aria-label', label);
        };
        sync();
        btn.addEventListener('click', () => { this.host.click(); perf.setMetric(chip.key, !isOn()); sync(); });
        wrap.appendChild(btn);
      }
      card.appendChild(wrap);
    }
  }

  private buildAppearanceCard(parent: HTMLElement): void {
    const perf = this.host.perf;
    const card = settingsCard(parent, t('hudChrome.perf.sectionAppearance'));

    // On-brand color-theme swatches (set text + background colors at once).
    const { row } = settingRow(t('hudChrome.perf.colorTheme'));
    const swatches = div('perf-swatches');
    const cur = perf.get();
    for (const theme of PERF_COLOR_THEMES) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'perf-swatch';
      btn.style.background = theme.bg;
      btn.style.color = theme.fg;
      btn.textContent = 'A';
      const label = t(theme.labelKey);
      btn.title = label;
      btn.setAttribute('aria-label', label);
      const selected = cur.textColor === theme.fg && cur.bgColor === theme.bg;
      btn.classList.toggle('sel', selected);
      btn.setAttribute('aria-pressed', String(selected));
      btn.addEventListener('click', () => { this.host.click(); perf.patch({ textColor: theme.fg, bgColor: theme.bg }); this.rerender(); });
      swatches.appendChild(btn);
    }
    row.appendChild(swatches);
    card.appendChild(row);

    colorControl({ parent: card, label: t('hudChrome.perf.textColor'), get: () => this.cfg().textColor, set: (v) => perf.patch({ textColor: v }) });
    colorControl({ parent: card, label: t('hudChrome.perf.bgColor'), get: () => this.cfg().bgColor, set: (v) => perf.patch({ bgColor: v }) });
    sliderControl({ parent: card, label: t('hudChrome.perf.opacity'), get: () => this.cfg().opacity, set: (v) => perf.patch({ opacity: v }), min: 0, max: 1, step: 0.05, format: PERCENT });
    this.toggle(card, t('hudChrome.perf.solidBg'), () => this.cfg().solidBg, (v) => perf.patch({ solidBg: v }));
    sliderControl({ parent: card, label: t('hudChrome.perf.fontScale'), get: () => this.cfg().fontScale, set: (v) => perf.patch({ fontScale: v }), min: FONT_SCALE_MIN, max: FONT_SCALE_MAX, step: 0.05, format: PERCENT });
    this.toggle(card, t('hudChrome.perf.graph'), () => this.cfg().graph, (v) => perf.patch({ graph: v }));
    this.toggle(card, t('hudChrome.perf.thresholds'), () => this.cfg().thresholds, (v) => perf.patch({ thresholds: v }));
  }

  private buildPositionCard(parent: HTMLElement): void {
    const perf = this.host.perf;
    const card = settingsCard(parent, t('hudChrome.perf.sectionPosition'));

    const hint = div('set-note');
    hint.textContent = t('hudChrome.perf.dragHint');
    card.appendChild(hint);

    this.posX = sliderControl({ parent: card, label: t('hudChrome.perf.positionX'), get: () => this.cfg().posX, set: (v) => perf.patch({ posX: v }), min: 0, max: 1, step: 0.01, format: PERCENT });
    this.posY = sliderControl({ parent: card, label: t('hudChrome.perf.positionY'), get: () => this.cfg().posY, set: (v) => perf.patch({ posY: v }), min: 0, max: 1, step: 0.01, format: PERCENT });

    const resetPos = document.createElement('button');
    resetPos.type = 'button';
    resetPos.className = 'btn';
    resetPos.textContent = t('hudChrome.perf.resetPosition');
    resetPos.addEventListener('click', () => { this.host.click(); perf.resetPosition(); this.rerender(); });
    card.appendChild(resetPos);
  }

  private buildFooter(): HTMLElement {
    const footer = div('perf-footer');
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'btn';
    reset.textContent = t('hud.options.resetToDefaults');
    reset.addEventListener('click', () => { this.host.click(); this.host.perf.reset(); this.rerender(); });
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'btn';
    back.textContent = t('hud.options.back');
    back.addEventListener('click', () => { this.host.click(); this.host.onBack(); });
    footer.append(reset, back);
    return footer;
  }

  // ---- small helpers -----------------------------------------------------

  private toggle(parent: HTMLElement, label: string, get: () => boolean, set: (v: boolean) => void): void {
    toggleControl({
      parent, label, get, set,
      onLabel: t('hud.options.on'),
      offLabel: t('hud.options.off'),
      onActivate: () => this.host.click(),
    });
  }
}

function div(className: string): HTMLDivElement {
  const el = document.createElement('div');
  el.className = className;
  return el;
}
