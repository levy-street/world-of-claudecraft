// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultAuraOverlayConfig } from '../src/ui/aura_overlay_config';
import { AuraOverlaySettingsPanel } from '../src/ui/aura_overlay_settings';
import type { AuraOverlayProcDef } from '../src/ui/aura_overlay_view';
import type { AuraWatchOption } from '../src/ui/aura_watchlist_core';
import { FocusManager } from '../src/ui/focus_manager';

const revenge: AuraOverlayProcDef = {
  id: 'revenge_free',
  auraKind: 'revenge_free',
  iconAbilityId: 'revenge',
  theme: 'rage',
  labelKey: 'hudChrome.auraOverlay.procs.revenge',
};
const raisedGuard: AuraOverlayProcDef = {
  id: 'raised_guard',
  auraKind: 'buff_dr_phys',
  auraId: 'raised_guard_dr',
  iconAbilityId: 'raised_guard',
  theme: 'battle',
  labelKey: null,
};
const openFocusTrap = (root: () => HTMLElement, returnFocusTo: HTMLElement) =>
  new FocusManager().open({ root, returnFocusTo });

beforeEach(() => {
  document.body.replaceChildren();
});

describe('AuraOverlaySettingsPanel position controls', () => {
  it('offers one global setup action and resets through the card action', () => {
    let config = defaultAuraOverlayConfig('revenge_free');
    const nudge = vi.fn();
    const panel = new AuraOverlaySettingsPanel({
      click: vi.fn(),
      openFocusTrap,
      auras: {
        playerClass: () => 'warrior',
        defs: () => [revenge, raisedGuard],
        get: () => config,
        getLayout: () => ({ crescentBlockScale: 1, groundRingBlockScale: 1 }),
        patchLayout: vi.fn(),
        patch: (_id, patch) => {
          config = { ...config, ...patch };
        },
        reset: (id) => {
          config = { ...config, ...defaultAuraOverlayConfig(id) };
        },
        nudge,
        watchOptions: () => [],
        setWatched: vi.fn(),
        previewCue: vi.fn(),
        setAll: vi.fn(),
        beginPlacement: vi.fn(),
        endPlacement: vi.fn(),
        setPlacement: vi.fn(),
        onPositionChange: () => vi.fn(),
        onPlacementChange: () => vi.fn(),
      },
    });
    const root = document.createElement('div');
    document.body.appendChild(root);
    panel.render(root);
    expect(root.querySelectorAll('input[type="range"]')).toHaveLength(4);
    expect(root.querySelectorAll('.aura-setup-btn')).toHaveLength(1);
    expect(root.querySelectorAll('.aura-reposition-btn')).toHaveLength(0);
    expect(root.querySelector<HTMLButtonElement>('.aura-setup-btn')?.textContent).toBe(
      'Setup Positions',
    );
    expect(root.querySelector('.aura-settings-intro span')?.textContent).toContain(
      'Use Setup Positions',
    );
    const firstOrder = root.querySelector('.aura-order-position');
    const firstUp = root.querySelector<HTMLButtonElement>('.aura-order-up');
    const firstDown = root.querySelector<HTMLButtonElement>('.aura-order-down');
    const cards = root.querySelectorAll('.aura-settings-card');
    const lastUp = cards[1]?.querySelector<HTMLButtonElement>('.aura-order-up');
    const lastDown = cards[1]?.querySelector<HTMLButtonElement>('.aura-order-down');
    expect(firstOrder?.textContent).toBe('Spell order 1 / 2');
    expect(firstUp?.tagName).toBe('BUTTON');
    expect(firstUp?.type).toBe('button');
    expect(firstUp?.title).toBe('Spell Order');
    expect(firstUp?.getAttribute('aria-label')).toBe('Move spell inward');
    expect(firstUp?.disabled).toBe(true);
    expect(firstDown?.tagName).toBe('BUTTON');
    expect(firstDown?.type).toBe('button');
    expect(firstDown?.title).toBe('Spell Order');
    expect(firstDown?.getAttribute('aria-label')).toBe('Move spell outward');
    expect(firstDown?.disabled).toBe(false);
    expect(lastUp?.disabled).toBe(false);
    expect(lastDown?.disabled).toBe(true);
    firstDown?.click();
    expect(nudge).toHaveBeenCalledWith('revenge_free', 'ground', 1, 0);

    config = {
      ...config,
      iconPosX: 0.18,
      iconPosY: 0.73,
      arcsPosX: 0.24,
      arcsPosY: 0.64,
    };

    root.querySelector<HTMLButtonElement>('.aura-reset-btn')?.click();
    expect(config).toMatchObject({
      iconPosX: 0.44,
      iconPosY: 0.7,
      arcsPosX: 0.5,
      arcsPosY: 0.56,
    });
  });

  it('keeps only per-spell opacity and icon size on aura cards', () => {
    let config = defaultAuraOverlayConfig('revenge_free');
    const panel = new AuraOverlaySettingsPanel({
      click: vi.fn(),
      openFocusTrap,
      auras: {
        playerClass: () => 'warrior',
        defs: () => [revenge],
        get: () => config,
        getLayout: () => ({ crescentBlockScale: 1, groundRingBlockScale: 1 }),
        patchLayout: vi.fn(),
        patch: (_id, patch) => {
          config = { ...config, ...patch };
        },
        reset: vi.fn(),
        nudge: vi.fn(),
        watchOptions: () => [],
        setWatched: vi.fn(),
        previewCue: vi.fn(),
        setAll: vi.fn(),
        beginPlacement: vi.fn(),
        endPlacement: vi.fn(),
        setPlacement: vi.fn(),
        onPositionChange: () => vi.fn(),
        onPlacementChange: () => vi.fn(),
      },
    });
    const root = document.createElement('div');
    document.body.appendChild(root);
    panel.render(root);
    const sliders = root.querySelectorAll<HTMLInputElement>('input[type="range"]');

    expect(sliders).toHaveLength(2);
    sliders[1].value = '1.4';
    sliders[1].dispatchEvent(new Event('input', { bubbles: true }));
    expect(config).toMatchObject({ scale: 1.4, arcsScale: 0.8, groundScale: 1 });
  });

  it('offers global enable controls and a per-aura color picker', () => {
    let config = defaultAuraOverlayConfig('revenge_free');
    const setAll = vi.fn();
    const panel = new AuraOverlaySettingsPanel({
      click: vi.fn(),
      openFocusTrap,
      auras: {
        playerClass: () => 'warrior',
        defs: () => [revenge],
        get: () => config,
        getLayout: () => ({ crescentBlockScale: 1, groundRingBlockScale: 1 }),
        patchLayout: vi.fn(),
        patch: (_id, patch) => {
          config = { ...config, ...patch };
        },
        reset: vi.fn(),
        nudge: vi.fn(),
        watchOptions: () => [],
        setWatched: vi.fn(),
        previewCue: vi.fn(),
        setAll,
        beginPlacement: vi.fn(),
        endPlacement: vi.fn(),
        setPlacement: vi.fn(),
        onPositionChange: () => vi.fn(),
        onPlacementChange: () => vi.fn(),
      },
    });
    const root = document.createElement('div');
    document.body.appendChild(root);
    panel.render(root);

    root.querySelector<HTMLButtonElement>('.aura-all-on')?.click();
    root.querySelector<HTMLButtonElement>('.aura-all-off')?.click();
    expect(setAll.mock.calls).toEqual([[true], [false]]);

    const color = root.querySelector<HTMLInputElement>('input[type="color"]');
    expect(color?.value).toBe('#ffe14d');
    if (color) {
      color.value = '#33ccff';
      color.dispatchEvent(new Event('input', { bubbles: true }));
    }
    expect(config.color).toBe('#33ccff');
  });

  it('reorders spell cards with their persisted ground-ring position', () => {
    const configs = new Map([
      ['revenge_free', { ...defaultAuraOverlayConfig('revenge_free'), groundOrder: 0 }],
      ['raised_guard', { ...defaultAuraOverlayConfig('raised_guard'), groundOrder: 1 }],
    ]);
    const panel = new AuraOverlaySettingsPanel({
      click: vi.fn(),
      openFocusTrap,
      auras: {
        playerClass: () => 'warrior',
        defs: () => [revenge, raisedGuard],
        get: (id) => configs.get(id) ?? defaultAuraOverlayConfig(id),
        getLayout: () => ({ crescentBlockScale: 1, groundRingBlockScale: 1 }),
        patchLayout: vi.fn(),
        patch: (id, patch) => {
          configs.set(id, { ...(configs.get(id) ?? defaultAuraOverlayConfig(id)), ...patch });
        },
        reset: (id) => {
          configs.set(id, {
            ...(configs.get(id) ?? defaultAuraOverlayConfig(id)),
            groundOrder: defaultAuraOverlayConfig(id).groundOrder,
          });
          configs.set('raised_guard', {
            ...(configs.get('raised_guard') ?? defaultAuraOverlayConfig('raised_guard')),
            groundOrder: 1,
          });
        },
        nudge: (id, part, deltaX) => {
          if (id !== 'revenge_free' || part !== 'ground' || deltaX !== 1) return;
          configs.set('revenge_free', {
            ...(configs.get('revenge_free') ?? defaultAuraOverlayConfig('revenge_free')),
            groundOrder: 1,
          });
          configs.set('raised_guard', {
            ...(configs.get('raised_guard') ?? defaultAuraOverlayConfig('raised_guard')),
            groundOrder: 0,
          });
        },
        watchOptions: () => [],
        setWatched: vi.fn(),
        previewCue: vi.fn(),
        setAll: vi.fn(),
        beginPlacement: vi.fn(),
        endPlacement: vi.fn(),
        setPlacement: vi.fn(),
        onPositionChange: () => vi.fn(),
        onPlacementChange: () => vi.fn(),
      },
    });
    const root = document.createElement('div');
    document.body.appendChild(root);
    panel.render(root);

    expect(
      Array.from(root.querySelectorAll('.aura-settings-card')).map((card) =>
        card.getAttribute('aria-label'),
      ),
    ).toEqual(['Revenge!', 'Raised Guard']);
    root.querySelector<HTMLButtonElement>('.aura-order-down')?.click();
    expect(
      Array.from(root.querySelectorAll('.aura-settings-card')).map((card) =>
        card.getAttribute('aria-label'),
      ),
    ).toEqual(['Raised Guard', 'Revenge!']);
    expect(document.activeElement?.getAttribute('data-focus-key')).toBe(
      'aura-order:revenge_free:up',
    );
    const revengeCard = Array.from(root.querySelectorAll('.aura-settings-card')).find(
      (card) => card.getAttribute('aria-label') === 'Revenge!',
    );
    revengeCard?.querySelector<HTMLButtonElement>('.aura-reset-btn')?.click();
    expect(
      Array.from(root.querySelectorAll('.aura-settings-card')).map((card) =>
        card.getAttribute('aria-label'),
      ),
    ).toEqual(['Revenge!', 'Raised Guard']);
    expect(root.querySelector('.aura-order-position')?.textContent).toBe('Spell order 1 / 2');

    const setup = root.querySelector<HTMLButtonElement>('.aura-setup-btn');
    Object.defineProperty(setup, 'getClientRects', {
      value: () => [{ width: 100, height: 40 }],
    });
    setup?.click();
    document.querySelector<HTMLButtonElement>('.aura-placement-ground')?.click();
    document.querySelector<HTMLButtonElement>('.aura-placement-right')?.click();
    document.querySelector<HTMLButtonElement>('.aura-placement-done')?.click();
    expect(
      Array.from(root.querySelectorAll('.aura-settings-card')).map((card) =>
        card.getAttribute('aria-label'),
      ),
    ).toEqual(['Raised Guard', 'Revenge!']);
    expect(root.querySelector('.aura-order-position')?.textContent).toBe('Spell order 1 / 2');
  });

  it('moves icons but uses shared block sizing and spell order for crescents and rings', async () => {
    let config = defaultAuraOverlayConfig('revenge_free');
    let layout = { crescentBlockScale: 1, groundRingBlockScale: 1 };
    const beginPlacement = vi.fn();
    const endPlacement = vi.fn();
    const nudge = vi.fn();
    const patches: Array<[string, Record<string, unknown>]> = [];
    const placementListener: {
      current:
        | ((id: 'revenge_free' | 'raised_guard', part: 'icon' | 'arcs' | 'ground') => void)
        | null;
    } = { current: null };
    const reset = vi.fn((id: 'revenge_free') => {
      config = { ...config, ...defaultAuraOverlayConfig(id) };
    });
    const panel = new AuraOverlaySettingsPanel({
      click: vi.fn(),
      openFocusTrap,
      auras: {
        playerClass: () => 'warrior',
        defs: () => [revenge, raisedGuard],
        get: () => config,
        patch: (_id, patch) => {
          patches.push([_id, patch]);
          config = { ...config, ...patch };
        },
        getLayout: () => layout,
        patchLayout: (patch) => {
          layout = { ...layout, ...patch };
        },
        reset,
        nudge,
        watchOptions: () => [],
        setWatched: vi.fn(),
        previewCue: vi.fn(),
        setAll: vi.fn(),
        beginPlacement,
        endPlacement,
        setPlacement: vi.fn(),
        onPositionChange: () => vi.fn(),
        onPlacementChange: (listener) => {
          placementListener.current = listener;
          return vi.fn();
        },
      },
    });
    const menu = document.createElement('div');
    menu.id = 'options-menu';
    const root = document.createElement('div');
    menu.appendChild(root);
    document.body.appendChild(menu);
    panel.render(root);

    const setup = root.querySelector<HTMLButtonElement>('.aura-setup-btn');
    Object.defineProperty(setup, 'getClientRects', {
      value: () => [{ width: 100, height: 40 }],
    });
    setup?.click();
    expect(menu.classList.contains('aura-placement-hidden')).toBe(true);
    expect(document.querySelector('.aura-placement-toolbar')).not.toBeNull();
    expect(document.querySelector('.aura-placement-toolbar')?.getAttribute('aria-modal')).toBe(
      'true',
    );
    expect(beginPlacement).toHaveBeenLastCalledWith('revenge_free', 'icon');
    const auraSelect = document.querySelector<HTMLSelectElement>('.aura-placement-select');
    expect(auraSelect?.classList.contains('hud-select')).toBe(true);
    expect(Array.from(auraSelect?.options ?? []).map((option) => option.value)).toEqual([
      'revenge_free',
      'raised_guard',
    ]);
    expect(auraSelect?.value).toBe('revenge_free');
    const iconPart = document.querySelector<HTMLButtonElement>('.aura-placement-icon');
    const arcsPart = document.querySelector<HTMLButtonElement>('.aura-placement-arcs');
    const groundPart = document.querySelector<HTMLButtonElement>('.aura-placement-ground');
    const selectionBlock = document.querySelector('.aura-placement-selection');
    expect(selectionBlock?.querySelector('strong')).not.toBeNull();
    expect(selectionBlock?.querySelector('.aura-placement-selector')).not.toBeNull();
    const partControls = selectionBlock?.querySelector('.aura-placement-parts');
    expect(partControls?.querySelector('.aura-placement-icon')).toBe(iconPart);
    expect(partControls?.querySelector('.aura-placement-arcs')).toBe(arcsPart);
    expect(partControls?.querySelector('.aura-placement-ground')).toBe(groundPart);
    expect(groundPart?.tagName).toBe('BUTTON');
    expect(groundPart?.type).toBe('button');
    expect(groundPart?.textContent).toBe('Ground Ring');
    expect(groundPart?.title).toBe('Ground Ring: Spell Order');
    expect(arcsPart?.title).toBe('Side Crescents: Spell Order');
    expect(iconPart?.classList.contains('active')).toBe(true);
    expect(iconPart?.getAttribute('aria-pressed')).toBe('true');
    expect(arcsPart?.classList.contains('active')).toBe(false);
    expect(arcsPart?.getAttribute('aria-pressed')).toBe('false');
    expect(groundPart?.classList.contains('active')).toBe(false);
    expect(groundPart?.getAttribute('aria-pressed')).toBe('false');
    const size = document.querySelector<HTMLInputElement>('.aura-placement-size input');
    const opacity = document.querySelector<HTMLInputElement>('.aura-placement-opacity input');
    const sliderBlock = document.querySelector('.aura-placement-sliders');
    expect(sliderBlock?.querySelector('.aura-placement-size')).not.toBeNull();
    expect(sliderBlock?.querySelector('.aura-placement-opacity')).not.toBeNull();
    expect(size?.value).toBe('0.8');
    expect(opacity?.value).toBe('0.7');
    if (size) {
      size.value = '0.75';
      size.dispatchEvent(new Event('input', { bubbles: true }));
    }
    expect(patches).toContainEqual(['revenge_free', { scale: 0.75 }]);
    const nudgeButtons = [
      ['.aura-placement-left', 'Move Left'],
      ['.aura-placement-up', 'Move Up'],
      ['.aura-placement-down', 'Move Down'],
      ['.aura-placement-right', 'Move Right'],
    ] as const;
    for (const [selector, label] of nudgeButtons) {
      const button = document.querySelector<HTMLElement>(selector);
      expect(button?.tagName).toBe('BUTTON');
      expect(button?.getAttribute('aria-label')).toBe(label);
      expect(button?.closest('.aura-placement-actions')).not.toBeNull();
    }
    expect(
      document.querySelector('.aura-placement-action-hint')?.closest('.aura-placement-actions'),
    ).not.toBeNull();
    const footer = document.querySelector('.aura-placement-footer');
    expect(footer?.querySelector('.aura-placement-actions')).not.toBeNull();
    expect(footer?.querySelector('.aura-placement-footer-actions')).not.toBeNull();
    expect(
      footer?.querySelector('.aura-placement-footer-actions .aura-placement-reset'),
    ).not.toBeNull();
    expect(
      footer?.querySelector('.aura-placement-footer-actions .aura-placement-done'),
    ).not.toBeNull();

    await new Promise((resolve) => window.setTimeout(resolve, 0));
    expect(document.activeElement).toBe(iconPart);

    document.querySelector<HTMLButtonElement>('.aura-placement-left')?.click();
    document.querySelector<HTMLButtonElement>('.aura-placement-up')?.click();
    if (auraSelect) {
      auraSelect.value = 'raised_guard';
      auraSelect.dispatchEvent(new Event('change', { bubbles: true }));
    }
    expect(beginPlacement).toHaveBeenLastCalledWith('raised_guard', 'icon');
    placementListener.current?.('raised_guard', 'arcs');
    expect(iconPart?.getAttribute('aria-pressed')).toBe('false');
    expect(arcsPart?.getAttribute('aria-pressed')).toBe('true');
    expect(auraSelect?.value).toBe('raised_guard');
    expect(size?.value).toBe('1');
    expect(document.querySelector('.aura-placement-action-hint')?.textContent).toBe('Spell Order');
    expect(document.querySelector('.aura-placement-size .set-name')?.textContent).toBe(
      'Crescent Block Size',
    );
    if (size) {
      size.value = '1.35';
      size.dispatchEvent(new Event('input', { bubbles: true }));
    }
    if (opacity) {
      opacity.value = '0.55';
      opacity.dispatchEvent(new Event('input', { bubbles: true }));
    }
    expect(config).toMatchObject({ scale: 0.75, opacity: 0.55 });
    expect(layout.crescentBlockScale).toBe(1.35);
    expect(patches).toContainEqual(['raised_guard', { opacity: 0.55 }]);
    groundPart?.click();
    expect(beginPlacement).toHaveBeenLastCalledWith('raised_guard', 'ground');
    expect(groundPart?.classList.contains('active')).toBe(true);
    expect(groundPart?.getAttribute('aria-pressed')).toBe('true');
    expect(iconPart?.classList.contains('active')).toBe(false);
    expect(iconPart?.getAttribute('aria-pressed')).toBe('false');
    expect(arcsPart?.classList.contains('active')).toBe(false);
    expect(arcsPart?.getAttribute('aria-pressed')).toBe('false');
    expect(size?.value).toBe('1');
    expect(document.querySelector<HTMLButtonElement>('.aura-placement-left')?.disabled).toBe(false);
    expect(document.querySelector<HTMLButtonElement>('.aura-placement-right')?.disabled).toBe(
      false,
    );
    expect(document.querySelector<HTMLButtonElement>('.aura-placement-up')?.disabled).toBe(true);
    expect(document.querySelector<HTMLButtonElement>('.aura-placement-down')?.disabled).toBe(true);
    expect(document.querySelector<HTMLButtonElement>('.aura-placement-reset')?.disabled).toBe(
      false,
    );
    expect(
      document.querySelector<HTMLButtonElement>('.aura-placement-left')?.getAttribute('aria-label'),
    ).toBe('Move spell inward');
    expect(
      document
        .querySelector<HTMLButtonElement>('.aura-placement-right')
        ?.getAttribute('aria-label'),
    ).toBe('Move spell outward');
    if (size) {
      size.value = '1.25';
      size.dispatchEvent(new Event('input', { bubbles: true }));
    }
    expect(layout.groundRingBlockScale).toBe(1.25);
    document.querySelector<HTMLButtonElement>('.aura-placement-left')?.click();
    expect(nudge).toHaveBeenLastCalledWith('raised_guard', 'ground', -1, 0);
    arcsPart?.click();
    expect(beginPlacement).toHaveBeenLastCalledWith('raised_guard', 'arcs');
    expect(document.querySelector<HTMLButtonElement>('.aura-placement-left')?.disabled).toBe(false);
    expect(document.querySelector<HTMLButtonElement>('.aura-placement-right')?.disabled).toBe(
      false,
    );
    expect(document.querySelector<HTMLButtonElement>('.aura-placement-up')?.disabled).toBe(true);
    expect(document.querySelector<HTMLButtonElement>('.aura-placement-down')?.disabled).toBe(true);
    expect(document.querySelector<HTMLButtonElement>('.aura-placement-reset')?.disabled).toBe(
      false,
    );
    document.querySelector<HTMLButtonElement>('.aura-placement-right')?.click();
    expect(nudge.mock.calls).toEqual([
      ['revenge_free', 'icon', -1, 0],
      ['revenge_free', 'icon', 0, -1],
      ['raised_guard', 'ground', -1, 0],
      ['raised_guard', 'arcs', 1, 0],
    ]);

    document.querySelector<HTMLButtonElement>('.aura-placement-reset')?.click();
    expect(reset).not.toHaveBeenCalledWith('raised_guard');
    expect(layout.crescentBlockScale).toBe(1);

    document.querySelector<HTMLButtonElement>('.aura-placement-done')?.click();
    expect(endPlacement).toHaveBeenCalledOnce();
    expect(menu.classList.contains('aura-placement-hidden')).toBe(false);
    expect(document.querySelector('.aura-placement-toolbar')).toBeNull();
    const refreshedSetup = root.querySelector<HTMLButtonElement>('.aura-setup-btn');
    expect(refreshedSetup).not.toBe(setup);
    expect(
      Array.from(root.querySelectorAll<HTMLInputElement>('input[type="range"]')).map(
        (input) => input.value,
      ),
    ).toContain('0.75');
    expect(document.activeElement).toBe(refreshedSetup);
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    expect(document.activeElement).toBe(refreshedSetup);
  });
});

describe('AuraOverlaySettingsPanel watchlist picker', () => {
  const option = (abilityId: string, watched: boolean): AuraWatchOption => ({
    procId: `watch:${abilityId}`,
    abilityId,
    auraKind: 'buff_reckless',
    auraId: abilityId,
    watched,
  });
  const renderPanel = (
    watchOptions: () => AuraWatchOption[],
    defs: AuraOverlayProcDef[] = [revenge],
    setWatched = vi.fn(),
  ): { root: HTMLElement; setWatched: ReturnType<typeof vi.fn> } => {
    const panel = new AuraOverlaySettingsPanel({
      click: vi.fn(),
      openFocusTrap,
      auras: {
        playerClass: () => 'warrior',
        defs: () => defs,
        get: () => defaultAuraOverlayConfig('revenge_free'),
        getLayout: () => ({ crescentBlockScale: 1, groundRingBlockScale: 1 }),
        patchLayout: vi.fn(),
        patch: vi.fn(),
        reset: vi.fn(),
        nudge: vi.fn(),
        watchOptions,
        setWatched,
        previewCue: vi.fn(),
        setAll: vi.fn(),
        beginPlacement: vi.fn(),
        endPlacement: vi.fn(),
        setPlacement: vi.fn(),
        onPositionChange: () => vi.fn(),
        onPlacementChange: () => vi.fn(),
      },
    });
    const root = document.createElement('div');
    document.body.appendChild(root);
    panel.render(root);
    return { root, setWatched };
  };

  it('renders a labelled chip per offered spell with its picked state pressed', () => {
    const { root } = renderPanel(() => [option('recklessness', false), option('avatar', true)]);
    const chips = Array.from(root.querySelectorAll<HTMLButtonElement>('.aura-watch-chip'));
    expect(chips.map((chip) => chip.dataset.focusKey)).toEqual(
      ['watch:recklessness', 'watch:avatar'].map((id) => `aura-watch:${id}`),
    );
    expect(chips.map((chip) => chip.getAttribute('aria-pressed'))).toEqual(['false', 'true']);
    expect(chips[0].querySelector('span')?.textContent).toBe('Recklessness');
    expect(chips[0].getAttribute('aria-label')).toBe('Watch Recklessness');
    expect(chips[1].getAttribute('aria-label')).toBe('Stop watching Avatar');
    expect(root.querySelector('.aura-watch-count')?.textContent).toBe('1 watched');
    expect(root.querySelector('.aura-watch-section strong')?.textContent).toBe('Watched Spells');
  });

  it('toggles the picked state through the hook, repaints it, and keeps focus on the chip', () => {
    // A LIVE list, so the assertions below prove the picker re-reads the hook on
    // its rebuild rather than re-rendering the state it started with.
    let options = [option('recklessness', false)];
    const setWatched = vi.fn((id: string, on: boolean) => {
      options = [option(id.slice('watch:'.length), on)];
    });
    const { root } = renderPanel(() => options, [revenge], setWatched);
    root.querySelector<HTMLButtonElement>('.aura-watch-chip')?.click();

    expect(setWatched.mock.calls).toEqual([['watch:recklessness', true]]);
    const chip = root.querySelector<HTMLButtonElement>('.aura-watch-chip');
    expect(chip?.getAttribute('aria-pressed')).toBe('true');
    expect(chip?.getAttribute('aria-label')).toBe('Stop watching Recklessness');
    expect(root.querySelector('.aura-watch-count')?.textContent).toBe('1 watched');
    // The rebuild replaces the chip node, so focus has to be carried across it.
    expect(document.activeElement).toBe(chip);

    chip?.click();
    expect(setWatched.mock.calls[1]).toEqual(['watch:recklessness', false]);
    expect(root.querySelector('.aura-watch-chip')?.getAttribute('aria-pressed')).toBe('false');
  });

  it('says so instead of rendering an empty list when nothing else is offerable', () => {
    const { root } = renderPanel(() => []);
    expect(root.querySelectorAll('.aura-watch-chip')).toHaveLength(0);
    expect(root.querySelector('.aura-watch-empty')?.textContent).toBe(
      'No other spell in your spellbook puts a buff on you.',
    );
  });

  it('keeps the picker reachable for a character with no authored proc at all', () => {
    const { root } = renderPanel(() => [option('recklessness', false)], []);
    // The old dead end returned before any picker existed, locking such a
    // character out of the whole feature.
    expect(root.querySelectorAll('.aura-watch-chip')).toHaveLength(1);
    expect(root.querySelector('.set-note:not(.aura-watch-hint)')?.textContent).toBe(
      'No supported proc is available for this character.',
    );
    expect(root.querySelectorAll('.aura-settings-card')).toHaveLength(0);
  });
});

describe('AuraOverlaySettingsPanel alert sound controls', () => {
  const renderCard = (config: Partial<ReturnType<typeof defaultAuraOverlayConfig>> = {}) => {
    let current = { ...defaultAuraOverlayConfig('revenge_free'), ...config };
    const previewCue = vi.fn();
    const patch = vi.fn((_id: string, p: Record<string, unknown>) => {
      current = { ...current, ...p };
    });
    const panel = new AuraOverlaySettingsPanel({
      click: vi.fn(),
      openFocusTrap,
      auras: {
        playerClass: () => 'warrior',
        defs: () => [revenge],
        get: () => current,
        getLayout: () => ({ crescentBlockScale: 1, groundRingBlockScale: 1 }),
        patchLayout: vi.fn(),
        patch,
        reset: vi.fn(),
        nudge: vi.fn(),
        watchOptions: () => [],
        setWatched: vi.fn(),
        previewCue,
        setAll: vi.fn(),
        beginPlacement: vi.fn(),
        endPlacement: vi.fn(),
        setPlacement: vi.fn(),
        onPositionChange: () => vi.fn(),
        onPlacementChange: () => vi.fn(),
      },
    });
    const root = document.createElement('div');
    document.body.appendChild(root);
    panel.render(root);
    return {
      root,
      previewCue,
      patch,
      get current() {
        return current;
      },
    };
  };

  it('offers silence plus all twenty cues, defaulting to silence', () => {
    const { root } = renderCard();
    const select = root.querySelector<HTMLSelectElement>('.aura-sound-select');
    expect(select?.options).toHaveLength(21);
    expect(select?.options[0].value).toBe('none');
    expect(select?.options[0].textContent).toBe('No sound');
    expect(select?.value).toBe('none');
    expect(
      Array.from(select?.options ?? [])
        .slice(1)
        .map((o) => o.textContent),
    ).toContain('Cat Meow');
  });

  it('hides the volume slider and preview until a cue is chosen', () => {
    // A silent proc shows ONE control, not three dead ones.
    const silent = renderCard();
    expect(silent.root.querySelector('.aura-sound-volume')).toBeNull();
    expect(silent.root.querySelector('.aura-sound-preview')).toBeNull();
    expect(silent.root.querySelector('.aura-sound-hint')).toBeNull();

    const loud = renderCard({ soundId: 'ui_aura_car_klaxon' });
    expect(loud.root.querySelector('.aura-sound-volume')).not.toBeNull();
    expect(loud.root.querySelector('.aura-sound-preview')).not.toBeNull();
    // The hint is what tells a player the sound can REPLACE the overlay.
    expect(loud.root.querySelector('.aura-sound-hint')?.textContent).toContain('sound alone');
  });

  it('stores the pick and auditions it, so the player chooses by ear', () => {
    const card = renderCard();
    const select = card.root.querySelector<HTMLSelectElement>('.aura-sound-select');
    if (!select) throw new Error('no cue select');
    select.value = 'ui_aura_wolf_howl';
    select.dispatchEvent(new Event('change'));

    expect(card.patch).toHaveBeenCalledWith('revenge_free', { soundId: 'ui_aura_wolf_howl' });
    expect(card.previewCue).toHaveBeenCalledWith('ui_aura_wolf_howl', 0.7);
  });

  it('does not audition a switch back to silence', () => {
    const card = renderCard({ soundId: 'ui_aura_wolf_howl' });
    const select = card.root.querySelector<HTMLSelectElement>('.aura-sound-select');
    if (!select) throw new Error('no cue select');
    select.value = 'none';
    select.dispatchEvent(new Event('change'));

    expect(card.patch).toHaveBeenCalledWith('revenge_free', { soundId: 'none' });
    expect(card.previewCue).not.toHaveBeenCalled();
  });

  it('previews at the proc own volume and names the cue for a screen reader', () => {
    const card = renderCard({ soundId: 'ui_aura_glass_ping', soundVolume: 0.35 });
    const preview = card.root.querySelector<HTMLButtonElement>('.aura-sound-preview');
    expect(preview?.getAttribute('aria-label')).toBe('Preview the Glass Ping alert sound');
    preview?.click();
    expect(card.previewCue).toHaveBeenCalledWith('ui_aura_glass_ping', 0.35);
  });
});
