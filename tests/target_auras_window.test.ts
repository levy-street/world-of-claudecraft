// @vitest-environment happy-dom

import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import type { AurasState } from '../src/ui/auras_view';
import { makeWriterFacet } from '../src/ui/painter_host';
import { TargetAurasWindow } from '../src/ui/target_auras_window';

const MARKUP = `
  <div id="ui">
    <div id="target-auras-window" class="panel mt-panel ta-panel">
      <div class="panel-title"><span class="ta-title"></span></div>
      <div class="ta-target"></div>
      <div class="ta-filters">
        <button type="button" data-aura-filter="all">All</button>
        <button type="button" data-aura-filter="debuffs">Debuffs</button>
        <button type="button" data-aura-filter="buffs">Buffs</button>
      </div>
      <div class="ta-sections">
        <section class="ta-section ta-debuff-section">
          <div class="ta-section-title"><span class="ta-debuff-label"></span><span class="ta-debuff-count"></span></div>
          <div class="ta-rows ta-debuff-rows"></div>
        </section>
        <section class="ta-section ta-buff-section">
          <div class="ta-section-title"><span class="ta-buff-label"></span><span class="ta-buff-count"></span></div>
          <div class="ta-rows ta-buff-rows"></div>
        </section>
      </div>
    </div>
  </div>`;

const MOBILE_CSS = readFileSync('src/styles/hud.mobile.css', 'utf8');
const HUD_CSS = readFileSync('src/styles/hud.css', 'utf8');

function auraState(): AurasState {
  return {
    count: 2,
    slots: [
      {
        key: 'corruption',
        iconKey: 'corruption',
        isDebuff: true,
        school: 'shadow',
        durationText: '6s',
        stacksText: '',
        name: 'Corruption',
        remaining: 6,
        duration: 12,
        sourceId: 7,
        cancelable: false,
        effectHtml: 'shadow damage',
        own: true,
        expiring: false,
        toggle: false,
        alwaysRender: false,
      },
      {
        key: 'fortitude',
        iconKey: 'fortitude',
        isDebuff: false,
        school: '',
        durationText: '5m',
        stacksText: '2',
        name: 'Fortitude',
        remaining: 300,
        duration: 600,
        sourceId: 9,
        cancelable: false,
        effectHtml: 'stamina',
        own: false,
        expiring: false,
        toggle: false,
        alwaysRender: false,
      },
    ],
  };
}

function layoutRect(left: number, width: number): DOMRect {
  return {
    x: left,
    y: 0,
    left,
    right: left + width,
    top: 0,
    bottom: 40,
    width,
    height: 40,
    toJSON: () => ({}),
  };
}

interface Labels {
  unlock: string;
  lock: string;
  configureRows: string;
  fewerRows: string;
  moreRows: string;
  visibleRows(count: number): string;
  showSources: string;
  hideSources: string;
  ownAura: string;
  opacity(percent: string): string;
}

function setup(
  labels: Labels = {
    unlock: 'Move aura window',
    lock: 'Lock aura window',
    configureRows: 'Configure target auras',
    fewerRows: 'Prefer fewer aura rows',
    moreRows: 'Prefer more aura rows',
    visibleRows: (count) => `Preferred aura rows: ${count}`,
    showSources: 'Show aura sources',
    hideSources: 'Hide aura sources',
    ownAura: 'Your aura',
    opacity: (percent) => `Aura opacity: ${percent}`,
  },
  isMobileLayout: () => boolean = () => false,
  uiScale: () => number = () => 1,
) {
  document.body.innerHTML = MARKUP;
  let writes = 0;
  let iconResolves = 0;
  const writers = makeWriterFacet(
    new Map(),
    new Map(),
    new Map(),
    new Map(),
    () => writes++,
    () => {},
  );
  const tooltips: Array<() => string> = [];
  const panel = new TargetAurasWindow({
    root: document.getElementById('target-auras-window') as HTMLElement,
    writers,
    document,
    window,
    storage: window.localStorage,
    isMobileLayout,
    uiScale,
    resolveIconUrl: (key) => {
      iconResolves++;
      return `url(${key})`;
    },
    attachTooltip: (_el, html) => tooltips.push(html),
    renderTooltip: (name, remaining, effectHtml) => `${name}|${remaining}|${effectHtml}`,
    formatCount: String,
    formatPercent: (value) => `${Math.round(value * 100)}%`,
    unlockLabel: () => labels.unlock,
    lockLabel: () => labels.lock,
    configureRowsLabel: () => labels.configureRows,
    fewerRowsLabel: () => labels.fewerRows,
    moreRowsLabel: () => labels.moreRows,
    visibleRowsLabel: (count) => labels.visibleRows(count),
    showSourcesLabel: () => labels.showSources,
    hideSourcesLabel: () => labels.hideSources,
    ownAuraLabel: () => labels.ownAura,
    opacityLabel: (percent) => labels.opacity(percent),
  });
  return {
    panel,
    root: document.getElementById('target-auras-window') as HTMLElement,
    tooltips,
    metrics: {
      writes: () => writes,
      iconResolves: () => iconResolves,
      reset: () => {
        writes = 0;
        iconResolves = 0;
      },
    },
  };
}

describe('TargetAurasWindow', () => {
  beforeEach(() => window.localStorage.clear());

  it('starts disabled and hidden until the player enables it', () => {
    const { panel, root } = setup();

    expect(panel.isVisible).toBe(false);
    expect(root.style.display).toBe('none');
    expect(root.querySelector('.ta-debuff-count')?.textContent).toBe('0');
    expect(root.querySelector('.ta-buff-count')?.textContent).toBe('0');
    expect(root.style.getPropertyValue('--ta-visible-rows-height')).toBe(
      'clamp(240px, calc(50.4cqw + 36px), 276px)',
    );
    expect(root.style.getPropertyValue('--ta-preferred-height')).toBe('306px');
    expect(root.querySelector('.ta-visible-rows-value')?.textContent).toBe('12');
    expect(root.classList.contains('ta-show-sources')).toBe(false);
    expect(root.style.getPropertyValue('--ta-row-opacity')).toBe('1');
  });

  it('gates a persisted desktop enablement on touch and restores it on desktop', () => {
    window.localStorage.setItem('woc_target_auras_visible', '1');
    let mobile = true;

    const { panel, root } = setup(undefined, () => mobile);

    expect(panel.isVisible).toBe(false);
    expect(root.style.display).toBe('none');
    expect(window.localStorage.getItem('woc_target_auras_visible')).toBe('1');
    expect(MOBILE_CSS).toMatch(
      /body\.mobile-touch #target-auras-window \{\s*display: none !important;/,
    );

    mobile = false;
    expect(panel.isVisible).toBe(true);
    panel.paint('Training Dummy', auraState(), () => 'Caster');
    expect(root.style.display).toBe('flex');
  });

  it('does not allow the target aura window to be enabled on mobile-touch', () => {
    const { panel, root } = setup(undefined, () => true);

    expect(panel.toggle()).toBe(false);
    expect(panel.isVisible).toBe(false);
    expect(root.style.display).toBe('none');
    expect(window.localStorage.getItem('woc_target_auras_visible')).toBeNull();
  });

  it('stops logical and visual updates across a live desktop-to-touch transition', () => {
    let mobile = false;
    const { panel, root } = setup(undefined, () => mobile);
    panel.toggle();
    panel.paint('Training Dummy', auraState(), () => 'Caster');
    expect(panel.isVisible).toBe(true);
    expect(root.style.display).toBe('flex');

    mobile = true;
    expect(panel.isVisible).toBe(false);
    panel.paint('Training Dummy', auraState(), () => 'Caster');
    expect(root.style.display).toBe('none');
    expect(window.localStorage.getItem('woc_target_auras_visible')).toBe('1');
    expect(panel.toggle()).toBe(false);
    expect(panel.isVisible).toBe(false);
    expect(window.localStorage.getItem('woc_target_auras_visible')).toBe('1');

    mobile = false;
    expect(panel.isVisible).toBe(true);
    panel.paint('Training Dummy', auraState(), () => 'Caster');
    expect(root.style.display).toBe('flex');
  });

  it('keeps row opacity above zero and persists slider changes without repainting rows', () => {
    const { root } = setup();
    const slider = root.querySelector<HTMLInputElement>('.ta-opacity-slider');
    const value = root.querySelector<HTMLElement>('.ta-opacity-value');

    expect(slider?.min).toBe('30');
    expect(slider?.max).toBe('100');
    expect(slider?.value).toBe('100');
    expect(slider?.getAttribute('aria-valuetext')).toBe('Aura opacity: 100%');
    expect(value?.textContent).toBe('100%');

    if (slider) {
      slider.value = '70';
      slider.dispatchEvent(new Event('input', { bubbles: true }));
    }
    expect(root.style.getPropertyValue('--ta-row-opacity')).toBe('0.7');
    expect(value?.textContent).toBe('70%');
    expect(window.localStorage.getItem('woc_target_auras_opacity')).toBe('70');

    const restored = setup();
    expect(restored.root.style.getPropertyValue('--ta-row-opacity')).toBe('0.7');
    expect(restored.root.querySelector<HTMLInputElement>('.ta-opacity-slider')?.value).toBe('70');

    window.localStorage.setItem('woc_target_auras_opacity', '0');
    const clamped = setup();
    expect(clamped.root.style.getPropertyValue('--ta-row-opacity')).toBe('0.3');
    expect(clamped.root.querySelector<HTMLInputElement>('.ta-opacity-slider')?.value).toBe('30');
  });

  it('defaults to compact rows, marks own auras, and persists source visibility', () => {
    const { panel, root } = setup();
    panel.toggle();
    panel.paint('Training Dummy', auraState(), (sourceId) => (sourceId === 7 ? 'Hero' : 'Priest'));

    const ownRow = root.querySelector<HTMLElement>('.ta-debuff-rows .ta-row');
    const foreignRow = root.querySelector<HTMLElement>('.ta-buff-rows .ta-row');
    const sourceToggle = root.querySelector<HTMLButtonElement>('.ta-source-toggle');
    expect(ownRow?.classList.contains('own')).toBe(true);
    expect(ownRow?.querySelector('.ta-own-marker')?.textContent).toBe('Your aura');
    expect(foreignRow?.classList.contains('own')).toBe(false);
    expect(sourceToggle?.getAttribute('aria-label')).toBe('Show aura sources');
    expect(HUD_CSS).toMatch(/\.ta-row\.own \.ta-name \{\s*padding-left: 12px;/);

    sourceToggle?.click();
    expect(root.classList.contains('ta-show-sources')).toBe(true);
    expect(sourceToggle?.getAttribute('aria-pressed')).toBe('true');
    expect(sourceToggle?.getAttribute('aria-label')).toBe('Hide aura sources');
    expect(window.localStorage.getItem('woc_target_auras_show_sources')).toBe('1');
    expect(root.style.getPropertyValue('--ta-visible-rows-height')).toBe(
      'clamp(468px, calc(102cqw + 36px), 588px)',
    );
    expect(root.style.height).toBe('534px');

    const restored = setup();
    expect(restored.root.classList.contains('ta-show-sources')).toBe(true);
    expect(restored.root.querySelector('.ta-source-toggle')?.getAttribute('aria-pressed')).toBe(
      'true',
    );
  });

  it('opens a compact row-count control and persists increments beyond twelve', () => {
    const { panel, root } = setup();
    panel.toggle();
    const config = root.querySelector<HTMLButtonElement>('.ta-rows-config-btn');
    const increase = root.querySelector<HTMLButtonElement>('.ta-visible-rows-more');

    expect(config?.getAttribute('aria-expanded')).toBe('false');
    config?.click();
    expect(config?.getAttribute('aria-expanded')).toBe('true');
    expect(root.querySelector<HTMLElement>('.ta-visible-rows-control')?.style.display).toBe('flex');
    const filters = root.querySelectorAll('.ta-filters');
    expect(filters).toHaveLength(1);
    expect(filters[0].parentElement).toBe(
      root.querySelector<HTMLElement>('.ta-visible-rows-control'),
    );
    expect(document.activeElement).toBe(root.querySelector('[data-aura-filter="all"]'));

    root
      .querySelector<HTMLInputElement>('.ta-opacity-slider')
      ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(config?.getAttribute('aria-expanded')).toBe('true');

    root
      .querySelector<HTMLElement>('.ta-visible-rows-control')
      ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(config?.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(config);
    config?.click();

    increase?.click();
    expect(root.querySelector('.ta-visible-rows-value')?.textContent).toBe('13');
    expect(root.style.getPropertyValue('--ta-visible-rows-height')).toBe(
      'clamp(260px, calc(54.6cqw + 39px), 299px)',
    );
    expect(root.style.height).toBe('326px');
    expect(window.localStorage.getItem('woc_target_auras_visible_rows')).toBe('13');

    const restored = setup();
    expect(restored.root.querySelector('.ta-visible-rows-value')?.textContent).toBe('13');
  });

  it('opens the configurator from its icon and keeps it inside the viewport', () => {
    const originalInnerWidth = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 240 });
    const { root } = setup();
    const config = root.querySelector<HTMLButtonElement>('.ta-rows-config-btn');
    const control = root.querySelector<HTMLElement>('.ta-visible-rows-control');
    root.getBoundingClientRect = () => layoutRect(20, 180);
    if (config) config.getBoundingClientRect = () => layoutRect(115, 24);
    if (control) control.getBoundingClientRect = () => layoutRect(0, 150);

    config?.click();
    expect(control?.style.left).toBe('62px');

    config?.click();
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 500 });
    config?.click();
    expect(control?.style.left).toBe('95px');

    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 240 });
    window.dispatchEvent(new Event('resize'));
    expect(control?.style.left).toBe('62px');

    config?.click();
    if (config) config.getBoundingClientRect = () => layoutRect(0, 24);
    config?.click();
    expect(control?.style.left).toBe('-12px');

    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      value: originalInnerWidth,
    });
  });

  it('uses the touch-safe popup width and margin when mobile layout is active', () => {
    const originalInnerWidth = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 240 });
    const { root } = setup(undefined, () => true);
    const config = root.querySelector<HTMLButtonElement>('.ta-rows-config-btn');
    const control = root.querySelector<HTMLElement>('.ta-visible-rows-control');
    root.getBoundingClientRect = () => layoutRect(10, 220);
    if (config) config.getBoundingClientRect = () => layoutRect(100, 40);

    config?.click();
    expect(control?.style.left).toBe('-6px');

    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      value: originalInnerWidth,
    });
  });

  it('converts visual viewport coordinates through the active UI scale', () => {
    const originalInnerWidth = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 500 });
    const { root } = setup(
      undefined,
      () => false,
      () => 0.8,
    );
    const config = root.querySelector<HTMLButtonElement>('.ta-rows-config-btn');
    const control = root.querySelector<HTMLElement>('.ta-visible-rows-control');
    root.getBoundingClientRect = () => layoutRect(20, 176);
    if (config) config.getBoundingClientRect = () => layoutRect(100, 19.2);
    if (control) control.getBoundingClientRect = () => layoutRect(0, 120);

    config?.click();
    expect(control?.style.left).toBe('100px');

    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      value: originalInnerWidth,
    });
  });

  it('reclamps an open configurator when a filter changes the frame width', () => {
    const originalInnerWidth = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 300 });
    const { root } = setup();
    const config = root.querySelector<HTMLButtonElement>('.ta-rows-config-btn');
    const control = root.querySelector<HTMLElement>('.ta-visible-rows-control');
    root.getBoundingClientRect = () =>
      layoutRect(root.style.width === '140px' ? 150 : 80, root.style.width === '140px' ? 140 : 220);
    if (config) {
      config.getBoundingClientRect = () => layoutRect(root.style.width === '140px' ? 260 : 200, 24);
    }
    if (control) control.getBoundingClientRect = () => layoutRect(0, 150);

    config?.click();
    expect(control?.style.left).toBe('62px');
    root.querySelector<HTMLButtonElement>('[data-aura-filter="debuffs"]')?.click();
    expect(control?.style.left).toBe('-8px');

    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      value: originalInnerWidth,
    });
  });

  it('updates and persists the height of an already framed window', () => {
    window.localStorage.setItem(
      'woc_target_auras_frame',
      JSON.stringify({ left: 40, top: 40, width: 220, height: 240 }),
    );
    const { root } = setup();

    root.querySelector<HTMLButtonElement>('.ta-visible-rows-more')?.click();

    expect(root.style.height).toBe('326px');
    expect(JSON.parse(window.localStorage.getItem('woc_target_auras_frame') ?? '{}')).toMatchObject(
      {
        left: 40,
        top: 40,
        width: 220,
        height: 326,
      },
    );
  });

  it('accounts for fluid row height when growing a wide framed window', () => {
    window.localStorage.setItem(
      'woc_target_auras_frame',
      JSON.stringify({ left: 8, top: 8, width: 500, height: 240 }),
    );
    const { root } = setup();

    root.querySelector<HTMLButtonElement>('.ta-visible-rows-more')?.click();

    expect(root.style.height).toBe('365px');
  });

  it('recomputes preferred height from the compact width after a frame reset', () => {
    window.localStorage.setItem(
      'woc_target_auras_frame',
      JSON.stringify({ left: 8, top: 8, width: 500, height: 240 }),
    );
    const { panel, root } = setup();
    root.querySelector<HTMLButtonElement>('.ta-visible-rows-more')?.click();
    expect(root.style.getPropertyValue('--ta-preferred-height')).toBe('365px');

    panel.resetFrame();

    expect(root.style.width).toBe('220px');
    expect(root.style.height).toBe('');
    expect(root.style.getPropertyValue('--ta-preferred-height')).toBe('326px');
    expect(window.localStorage.getItem('woc_target_auras_frame')).toBeNull();
  });

  it('clamps saved and interactive row counts to the touch-friendly range', () => {
    window.localStorage.setItem('woc_target_auras_visible_rows', '999');
    const { root } = setup();
    const more = root.querySelector<HTMLButtonElement>('.ta-visible-rows-more');
    const less = root.querySelector<HTMLButtonElement>('.ta-visible-rows-less');

    expect(root.querySelector('.ta-visible-rows-value')?.textContent).toBe('24');
    expect(more?.getAttribute('aria-disabled')).toBe('true');
    more?.click();
    expect(root.querySelector('.ta-visible-rows-value')?.textContent).toBe('24');
    for (let i = 0; i < 30; i++) less?.click();
    expect(root.querySelector('.ta-visible-rows-value')?.textContent).toBe('3');
    expect(less?.getAttribute('aria-disabled')).toBe('true');
    less?.click();
    expect(root.querySelector('.ta-visible-rows-value')?.textContent).toBe('3');
    expect(window.localStorage.getItem('woc_target_auras_visible_rows')).toBe('3');

    window.localStorage.clear();
    window.localStorage.setItem('woc_target_auras_visible_rows', '-999');
    const belowMinimum = setup();
    expect(belowMinimum.root.querySelector('.ta-visible-rows-value')?.textContent).toBe('3');
  });

  it('keeps every row-count control at the mobile touch target floor', () => {
    expect(MOBILE_CSS).toMatch(
      /body\.mobile-touch #target-auras-window \{[\s\S]*?overflow: visible;/,
    );
    expect(MOBILE_CSS).toMatch(
      /#target-auras-window \.ta-rows-config-btn,[\s\S]*?#target-auras-window \.ta-visible-rows-step,[\s\S]*?#target-auras-window \.ta-visible-rows-value \{\s*width: 40px;\s*height: 40px;/,
    );
    expect(MOBILE_CSS).toMatch(
      /#target-auras-window \.ta-visible-rows-control \{\s*top: 44px;\s*right: auto;\s*gap: 16px;\s*padding: 6px 8px;\s*width: min\(232px, calc\(100vw - 8px\)\);/,
    );
    expect(MOBILE_CSS).toMatch(/#target-auras-window \.ta-opacity-slider \{\s*min-height: 40px;/);
  });

  it('toggles visibility and restores the saved enabled state', () => {
    const first = setup();

    expect(first.panel.toggle()).toBe(true);
    expect(first.panel.isVisible).toBe(true);
    expect(first.root.style.display).toBe('flex');
    expect(window.localStorage.getItem('woc_target_auras_visible')).toBe('1');

    const restored = setup();
    expect(restored.root.style.display).toBe('flex');
    expect(restored.panel.isVisible).toBe(true);

    expect(restored.panel.toggle()).toBe(false);
    expect(restored.panel.isVisible).toBe(false);
    expect(restored.root.style.display).toBe('none');
    expect(window.localStorage.getItem('woc_target_auras_visible')).toBe('0');

    const disabled = setup();
    expect(disabled.root.style.display).toBe('none');
  });

  it('clears retained rows before re-enabling after a hidden target change', () => {
    const { panel, root } = setup();
    panel.toggle();
    panel.paint('Old Target', auraState(), () => 'Hero');
    panel.toggle();

    const next = auraState();
    next.slots[0].name = 'New Debuff';
    panel.paint('New Target', next, () => 'Mage');
    panel.toggle();

    expect(root.style.display).toBe('flex');
    expect(root.querySelector('.ta-target')?.textContent).toBe('');
    expect(root.querySelector<HTMLElement>('.ta-debuff-rows .ta-row')?.style.display).toBe('none');

    panel.paint('New Target', next, () => 'Mage');
    expect(root.querySelector('.ta-target')?.textContent).toBe('New Target');
    expect(root.querySelector('.ta-debuff-rows .ta-name')?.textContent).toBe('New Debuff');
  });

  it('relocalizes the move handle even while the empty frame is latched', () => {
    const labels: Labels = {
      unlock: 'Move aura window',
      lock: 'Lock aura window',
      configureRows: 'Configure target auras',
      fewerRows: 'Prefer fewer aura rows',
      moreRows: 'Prefer more aura rows',
      visibleRows: (count) => `Preferred aura rows: ${count}`,
      showSources: 'Show aura sources',
      hideSources: 'Hide aura sources',
      ownAura: 'Your aura',
      opacity: (percent) => `Aura opacity: ${percent}`,
    };
    const { panel, root } = setup(labels);
    panel.toggle();
    const button = root.querySelector<HTMLButtonElement>('.ta-move-btn');

    labels.unlock = 'Sposta finestra aure';
    labels.configureRows = 'Configura righe preferite';
    labels.fewerRows = 'Preferisci meno righe';
    labels.moreRows = 'Preferisci più righe';
    labels.visibleRows = (count) => `Righe preferite: ${count}`;
    panel.relocalize();

    expect(button?.getAttribute('aria-label')).toBe('Sposta finestra aure');
    expect(button?.getAttribute('title')).toBe('Sposta finestra aure');
    expect(root.querySelector('.ta-rows-config-btn')?.getAttribute('aria-label')).toBe(
      'Configura righe preferite',
    );
    expect(root.querySelector('.ta-rows-config-btn')?.getAttribute('title')).toBe(
      'Configura righe preferite',
    );
    expect(root.querySelector('.ta-visible-rows-less')?.getAttribute('aria-label')).toBe(
      'Preferisci meno righe',
    );
    expect(root.querySelector('.ta-visible-rows-more')?.getAttribute('aria-label')).toBe(
      'Preferisci più righe',
    );
    expect(root.querySelector('.ta-visible-rows-control')?.getAttribute('aria-label')).toBe(
      'Configura righe preferite',
    );
    expect(root.querySelector('.ta-visible-rows-value')?.getAttribute('aria-label')).toBe(
      'Righe preferite: 12',
    );
  });

  it('exposes a minimal arrow-to-lock movement handle', () => {
    const { root } = setup();
    const button = root.querySelector<HTMLButtonElement>('.ta-move-btn');

    expect(button?.getAttribute('aria-pressed')).toBe('false');
    expect(button?.getAttribute('aria-label')).toBe('Move aura window');
    expect(root.classList.contains('ta-unlocked')).toBe(false);

    button?.click();

    expect(button?.getAttribute('aria-pressed')).toBe('true');
    expect(button?.getAttribute('aria-label')).toBe('Lock aura window');
    expect(root.classList.contains('ta-unlocked')).toBe(true);
  });

  it('shows debuffs and buffs together as two side-by-side sections', () => {
    const { panel, root } = setup();
    panel.toggle();
    panel.paint('Training Dummy', auraState(), (id) => (id === 7 ? 'Hero' : 'Priest'));

    expect(root.style.display).toBe('flex');
    expect(root.querySelector('.ta-target')?.textContent).toBe('Training Dummy');
    expect(root.querySelector('.ta-debuff-count')?.textContent).toBe('1');
    expect(root.querySelector('.ta-buff-count')?.textContent).toBe('1');
    expect(root.querySelector('.ta-debuff-rows .ta-name')?.textContent).toBe('Corruption');
    expect(root.querySelector('.ta-debuff-rows .ta-source')?.textContent).toBe('Hero');
    expect(root.querySelector('.ta-buff-rows .ta-name')?.textContent).toBe('Fortitude');
    expect(root.querySelector('.ta-buff-rows .ta-stacks')?.textContent).toBe('2');
    expect(root.querySelector('.ta-buff-rows .ta-stacks')?.classList.contains('empty')).toBe(false);
    expect(root.querySelector('.ta-sections')?.classList.contains('only-one')).toBe(false);
  });

  it('switches between all, debuff-only, and buff-only layouts', () => {
    const { panel, root } = setup();
    panel.toggle();
    panel.paint('Training Dummy', auraState(), () => 'Caster');
    const all = root.querySelector<HTMLButtonElement>('[data-aura-filter="all"]');
    const debuffs = root.querySelector<HTMLButtonElement>('[data-aura-filter="debuffs"]');
    const buffs = root.querySelector<HTMLButtonElement>('[data-aura-filter="buffs"]');

    expect(root.classList.contains('ta-filter-all')).toBe(true);
    expect(root.querySelector('[data-aura-filter="all"]')?.getAttribute('aria-pressed')).toBe(
      'true',
    );

    debuffs?.click();
    panel.paint('Training Dummy', auraState(), () => 'Caster');
    expect(root.classList.contains('ta-filter-debuffs')).toBe(true);
    expect(root.querySelector('.ta-sections')?.classList.contains('only-one')).toBe(true);
    expect(root.querySelector('.ta-buff-section')?.classList.contains('empty-section')).toBe(true);
    expect(root.querySelector<HTMLElement>('.ta-buff-rows .ta-row')?.style.display).toBe('none');
    expect(root.style.width).toBe('140px');

    buffs?.click();
    panel.paint('Training Dummy', auraState(), () => 'Caster');
    expect(root.classList.contains('ta-filter-buffs')).toBe(true);
    expect(root.querySelector('.ta-debuff-section')?.classList.contains('empty-section')).toBe(
      true,
    );
    expect(root.style.width).toBe('140px');

    all?.click();
    panel.paint('Training Dummy', auraState(), () => 'Caster');
    expect(root.style.width).toBe('220px');
  });

  it('restores a persisted single-section filter at compact width', () => {
    window.localStorage.setItem('woc_target_auras_filter', 'debuffs');

    const { root } = setup();

    expect(root.classList.contains('ta-filter-debuffs')).toBe(true);
    expect(root.style.width).toBe('140px');
  });

  it('keeps every raid-sized aura available in the scrolling section', () => {
    const { panel, root } = setup();
    panel.toggle();
    const input = auraState();
    const template = input.slots[0];
    input.slots = Array.from({ length: 14 }, (_, index) => ({
      ...template,
      key: `debuff_${index}`,
      name: `Debuff ${index}`,
      own: index === 13,
    }));
    input.count = input.slots.length;

    panel.paint('Raid Boss', input, () => 'Caster');

    expect(root.querySelector('.ta-debuff-count')?.textContent).toBe('14');
    expect(root.querySelectorAll<HTMLElement>('.ta-debuff-rows .ta-row')).toHaveLength(14);
    expect(root.querySelector('.ta-debuff-rows .ta-name')?.textContent).toBe('Debuff 13');
  });

  it('gives the full content width to the only non-empty section', () => {
    const { panel, root } = setup();
    panel.toggle();
    const onlyDebuffs = auraState();
    onlyDebuffs.count = 1;

    panel.paint('Training Dummy', onlyDebuffs, () => 'Hero');

    expect(root.querySelector('.ta-sections')?.classList.contains('only-one')).toBe(true);
    expect(root.querySelector('.ta-debuff-section')?.classList.contains('empty-section')).toBe(
      false,
    );
    expect(root.querySelector('.ta-buff-section')?.classList.contains('empty-section')).toBe(true);
  });

  it('clamps a saved desktop frame to the compact readable minimum', () => {
    window.localStorage.setItem(
      'woc_target_auras_frame',
      JSON.stringify({ left: 40, top: 40, width: 90, height: 90 }),
    );

    const { root } = setup();

    expect(root.style.width).toBe('135px');
    expect(root.style.height).toBe('120px');
  });

  it('reuses pooled rows and updates the live tooltip record', () => {
    const { panel, root, tooltips } = setup();
    panel.toggle();
    const first = auraState();
    panel.paint('Training Dummy', first, () => 'Hero');
    const row = root.querySelector('.ta-debuff-rows .ta-row');
    expect(tooltips[0]()).toBe('Corruption|6|shadow damage');

    first.slots[0].name = 'Agony';
    first.slots[0].remaining = 3;
    first.slots[0].effectHtml = 'new effect';
    panel.paint('Training Dummy', first, () => 'Hero');

    expect(root.querySelector('.ta-debuff-rows .ta-row')).toBe(row);
    expect(tooltips[0]()).toBe('Agony|3|new effect');
  });

  it('elides identical steady-state DOM writes and repeated icon resolution', () => {
    const { panel, root, metrics } = setup();
    panel.toggle();
    const input = auraState();
    panel.paint('Training Dummy', input, () => 'Hero');
    expect(metrics.iconResolves()).toBe(2);

    metrics.reset();
    panel.paint('Training Dummy', input, () => 'Hero');

    expect(metrics.writes()).toBe(0);
    expect(metrics.iconResolves()).toBe(0);

    input.slots[0].iconKey = 'new_corruption_icon';
    panel.paint('Training Dummy', input, () => 'Hero');

    expect(metrics.iconResolves()).toBe(1);
    expect(root.querySelector<HTMLElement>('.ta-debuff-rows .ta-icon')?.style.backgroundImage).toBe(
      'url("new_corruption_icon")',
    );
  });

  it('stays visible after the target loses its auras and hides only recycled rows', () => {
    const { panel, root } = setup();
    panel.toggle();
    panel.paint('Training Dummy', auraState(), () => 'Hero');
    expect(root.style.display).toBe('flex');

    panel.paint('Training Dummy', { slots: [], count: 0 }, () => '');
    expect(root.style.display).toBe('flex');
    expect(root.querySelector('.ta-target')?.textContent).toBe('Training Dummy');
    expect(root.querySelector('.ta-debuff-count')?.textContent).toBe('0');
    expect(root.querySelector('.ta-buff-count')?.textContent).toBe('0');
    expect(root.querySelector<HTMLElement>('.ta-debuff-rows .ta-row')?.style.display).toBe('none');

    panel.paint('Training Dummy', auraState(), () => 'Hero');
    expect(root.style.display).toBe('flex');
  });

  it('clears the target while preserving an enabled frame', () => {
    const { panel, root } = setup();
    panel.toggle();
    panel.paint('Training Dummy', auraState(), () => 'Hero');

    panel.clear();

    expect(root.style.display).toBe('flex');
    expect(root.querySelector('.ta-target')?.textContent).toBe('');
    expect(root.querySelector('.ta-debuff-count')?.textContent).toBe('0');
    expect(root.querySelector('.ta-buff-count')?.textContent).toBe('0');
  });

  it('hides recycled rows and clears optional row state', () => {
    const { panel, root } = setup();
    panel.toggle();
    const first = auraState();
    first.slots[0].expiring = true;
    first.slots.push({ ...first.slots[0], key: 'agony', name: 'Agony', stacksText: '3' });
    first.count = 3;
    panel.paint('Training Dummy', first, () => 'Hero');

    const recycled = root.querySelectorAll<HTMLElement>('.ta-debuff-rows .ta-row')[1];
    const firstActive = root.querySelector<HTMLElement>('.ta-debuff-rows .ta-row');
    expect(firstActive?.classList.contains('expiring')).toBe(true);
    expect(recycled.style.display).toBe('grid');
    expect(recycled.querySelector('.ta-stacks')?.classList.contains('empty')).toBe(false);

    const next = auraState();
    next.slots[0].own = false;
    next.slots[0].expiring = false;
    next.slots[0].stacksText = '';
    panel.paint('Training Dummy', next, () => 'Mage');

    const active = root.querySelector<HTMLElement>('.ta-debuff-rows .ta-row');
    expect(active?.classList.contains('own')).toBe(false);
    expect(active?.classList.contains('expiring')).toBe(false);
    expect(active?.querySelector('.ta-source')?.textContent).toBe('Mage');
    expect(active?.querySelector('.ta-stacks')?.classList.contains('empty')).toBe(true);
    expect(recycled.style.display).toBe('none');
  });
});
