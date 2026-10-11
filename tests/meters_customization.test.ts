// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SimEvent } from '../src/sim/types';
import { inferSpecFromAbility, MeterData, Meters, meterIconUrl } from '../src/ui/meters';
import { MetersOptionsDialog } from '../src/ui/meters_options_dialog';
import { formatChatReport } from '../src/ui/meters_report';
import {
  applySettingsClasses,
  DEFAULT_METERS_SETTINGS,
  exportProfileString,
  FONT_OPTIONS,
  getActiveProfileName,
  importProfileString,
  loadMetersSettings,
  type MetersSettings,
  PRESETS,
  saveMetersSettings,
} from '../src/ui/meters_settings';
import type { IWorld } from '../src/world_api';

const detachedMarkup = (id: string) => `
  <div id="${id}" class="panel mt-panel">
    <div class="panel-title">
      <span class="mt-title-label"></span>
      <button type="button" class="mt-mode-btn"></button>
      <button type="button" class="mt-new-window"></button>
      <button type="button" class="mt-reset"></button>
      <button type="button" class="mt-settings"></button>
      <button type="button" class="mt-prev"></button>
      <button type="button" class="mt-next"></button>
      <button type="button" class="mt-close"></button>
    </div>
    <div class="mt-view"></div>
    <div class="mt-sub"></div>
    <div class="mt-hint"></div>
    <div class="mt-rows"></div>
  </div>`;

const MARKUP = `
  ${detachedMarkup('heal-window')}
  <div id="meters-window" class="panel mt-panel">
    <div class="panel-title">
      <span class="mt-tabs">
        <button type="button" class="mt-tab on" data-tab="dmg">Dmg</button>
        <button type="button" class="mt-tab" data-tab="heal">Heal</button>
        <button type="button" class="mt-tab" data-tab="dmgTaken">Taken</button>
        <button type="button" class="mt-tab" data-tab="interrupts">Int</button>
        <button type="button" class="mt-tab" data-tab="deaths">Deaths</button>
        <button type="button" class="mt-tab" data-tab="threat">Threat</button>
      </span>
      <button type="button" class="mt-mode-btn"></button>
      <button type="button" class="mt-new-window"></button>
      <button type="button" class="mt-reset"></button>
      <button type="button" class="mt-settings"></button>
      <button type="button" class="mt-close"></button>
    </div>
    <div class="mt-view"></div>
    <div class="mt-sub"></div>
    <div class="mt-hint"></div>
    <div class="mt-rows"></div>
  </div>`;

function fakeWorld(): IWorld {
  const entities = new Map<number, any>();
  entities.set(1, {
    id: 1,
    kind: 'player',
    name: 'Warrior',
    templateId: 'warrior',
    hp: 1000,
    maxHp: 1000,
    dead: false,
  });
  entities.set(2, {
    id: 2,
    kind: 'player',
    name: 'Priest',
    templateId: 'priest',
    hp: 800,
    maxHp: 800,
    dead: false,
  });
  entities.set(50, {
    id: 50,
    kind: 'mob',
    name: 'Ignivar',
    maxHp: 50000,
    dead: false,
    aggroTargetId: 1,
  });
  return {
    entities,
    player: entities.get(1),
  } as unknown as IWorld;
}

describe('Meters Customization & Settings', () => {
  beforeEach(() => {
    for (const el of document.querySelectorAll('#meters-options-modal')) {
      el.remove();
    }
    document.body.innerHTML = MARKUP;
  });
  it('loads default settings when storage is empty or undefined', () => {
    expect(loadMetersSettings(undefined)).toEqual(DEFAULT_METERS_SETTINGS);

    const emptyStorage = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
    };
    expect(loadMetersSettings(emptyStorage)).toEqual(DEFAULT_METERS_SETTINGS);
  });

  it('persists and loads custom settings correctly', () => {
    const mem = new Map<string, string>();
    const storage = {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => {
        mem.set(k, v);
      },
    };

    saveMetersSettings(
      {
        density: 'compact',
        opacity: 'solid',
        numberFormat: 'detailed',
        showRaidTotals: false,
      },
      storage,
    );

    const loaded = loadMetersSettings(storage);
    expect(loaded.density).toBe('compact');
    expect(loaded.opacity).toBe('solid');
    expect(loaded.numberFormat).toBe('detailed');
    expect(loaded.showRaidTotals).toBe(false);
  });

  it('falls back safely when storage has corrupted JSON', () => {
    const corruptStorage = {
      getItem: vi.fn(() => '{"invalid json}'),
      setItem: vi.fn(),
    };
    expect(loadMetersSettings(corruptStorage)).toEqual(DEFAULT_METERS_SETTINGS);
  });

  it('applies CSS classes and font variables to DOM element', () => {
    const el = document.createElement('div');
    applySettingsClasses(el, {
      density: 'compact',
      opacity: 'minimal',
      fontFamily: 'cinzel',
      barHeight: 18,
      numberFormat: 'compact',
      showRaidTotals: true,
    });

    expect(el.classList.contains('mt-compact')).toBe(true);
    expect(el.classList.contains('mt-opacity-minimal')).toBe(true);
    expect(el.classList.contains('mt-opacity-glass')).toBe(false);
    expect(el.classList.contains('mt-opacity-solid')).toBe(false);
    expect(el.style.getPropertyValue('--mt-font-family')).toBe('var(--font-display)');
    expect(el.style.getPropertyValue('--mt-bar-h')).toBe('18px');

    applySettingsClasses(el, {
      density: 'standard',
      opacity: 'glass',
      fontFamily: 'monospace',
      numberFormat: 'compact',
      showRaidTotals: true,
    });

    expect(el.classList.contains('mt-compact')).toBe(false);
    expect(el.classList.contains('mt-opacity-glass')).toBe(true);
    expect(el.classList.contains('mt-opacity-minimal')).toBe(false);
    expect(el.style.getPropertyValue('--mt-font-family')).toContain('monospace');
  });

  it('synchronizes settings across all open meter windows in real time', () => {
    const w = fakeWorld();
    const mem = new Map<string, string>();
    const storage = {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => {
        mem.set(k, v);
      },
      removeItem: (k: string) => {
        mem.delete(k);
      },
    };

    const meters = new Meters(w, {
      attachTooltip: () => {},
      uiScale: () => 1,
      isMobileLayout: () => false,
      storage,
    });

    const mainEl = document.getElementById('meters-window') as HTMLElement;
    const healEl = document.getElementById('heal-window') as HTMLElement;
    expect(mainEl).toBeTruthy();
    expect(healEl).toBeTruthy();

    // Verify initial default
    expect(mainEl.classList.contains('mt-opacity-glass')).toBe(true);
    expect(healEl.classList.contains('mt-opacity-glass')).toBe(true);

    // Update settings via Meters (or options dialog on any window)
    meters.updateSettings({
      ...DEFAULT_METERS_SETTINGS,
      density: 'compact',
      opacity: 'solid',
      fontFamily: 'cinzel',
      barHeight: 14,
    });

    // Both windows MUST update immediately in real time
    expect(mainEl.classList.contains('mt-compact')).toBe(true);
    expect(mainEl.classList.contains('mt-opacity-solid')).toBe(true);
    expect(mainEl.style.getPropertyValue('--mt-font-family')).toBe('var(--font-display)');
    expect(mainEl.style.getPropertyValue('--mt-bar-h')).toBe('14px');

    expect(healEl.classList.contains('mt-compact')).toBe(true);
    expect(healEl.classList.contains('mt-opacity-solid')).toBe(true);
    expect(healEl.style.getPropertyValue('--mt-font-family')).toBe('var(--font-display)');
    expect(healEl.style.getPropertyValue('--mt-bar-h')).toBe('14px');

    // Storage must be updated
    const saved = loadMetersSettings(storage);
    expect(saved.density).toBe('compact');
    expect(saved.opacity).toBe('solid');
    expect(saved.fontFamily).toBe('cinzel');
  });

  it('opens full options dialog on click and quick menu on contextmenu', () => {
    const w = fakeWorld();
    const menus: { items: { act: string; label: string }[]; select: (act: string) => void }[] = [];
    new Meters(w, {
      attachTooltip: () => {},
      uiScale: () => 1,
      isMobileLayout: () => false,
      storage: {
        getItem: () => null,
        setItem: () => {},
        removeItem: () => {},
      },
      openMenu: (items, _x, _y, onSelect) => {
        menus.push({ items: [...items], select: onSelect });
      },
    });

    const settingsBtn = document.querySelector('#meters-window .mt-settings') as HTMLElement;
    expect(settingsBtn).toBeTruthy();

    // Left click opens the big Details! options dialog
    settingsBtn.click();
    const modal = document.getElementById('meters-options-modal');
    expect(modal).toBeTruthy();
    expect(modal?.style.display).toBe('flex');

    // Contextmenu opens the quick settings popup
    settingsBtn.dispatchEvent(
      new MouseEvent('contextmenu', { clientX: 100, clientY: 100, bubbles: true }),
    );
    expect(menus.length).toBe(1);
    const actions = menus[0].items.map((i) => i.act);
    expect(actions).toEqual(['density', 'opacity', 'numbers', 'raid_totals']);
  });

  it('removes compare, balance, export_json, and settings from encounter menu', () => {
    const w = fakeWorld();
    const menus: { items: { act: string; label: string }[]; select: (act: string) => void }[] = [];
    const meters = new Meters(w, {
      attachTooltip: () => {},
      uiScale: () => 1,
      isMobileLayout: () => false,
      storage: {
        getItem: () => null,
        setItem: () => {},
        removeItem: () => {},
      },
      openMenu: (items, _x, _y, onSelect) => {
        menus.push({ items: [...items], select: onSelect });
      },
    });

    meters.render(true);

    const segTrigger = document.querySelector('#meters-window .mt-seg-trigger') as HTMLElement;
    expect(segTrigger).toBeTruthy();
    segTrigger.click();

    expect(menus.length).toBe(1);
    const actions = menus[0].items.map((i) => i.act);
    expect(actions).not.toContain('tool:settings');
    expect(actions).not.toContain('tool:compare');
    expect(actions).not.toContain('tool:balance');
    expect(actions).not.toContain('tool:export_json');
    expect(actions).not.toContain('tool:report_chat');
    expect(actions).not.toContain('tool:timeline');
    expect(actions).not.toContain('tool:export_text');
  });
});

describe('Meters Chat Reporting', () => {
  it('formats single-line chat report for party and raid', () => {
    const w = fakeWorld();
    const party = new Set([1, 2]);
    const m = new MeterData(0);

    m.onEvent(
      {
        type: 'damage',
        sourceId: 1,
        targetId: 50,
        amount: 5000,
        crit: false,
        kind: 'hit',
        ability: 'Mortal Strike',
      } as SimEvent,
      w,
      party,
      1000,
    );
    m.onEvent(
      {
        type: 'damage',
        sourceId: 2,
        targetId: 50,
        amount: 2500,
        crit: false,
        kind: 'hit',
        ability: 'Smite',
      } as SimEvent,
      w,
      party,
      2000,
    );

    const report = formatChatReport(m.current!, 'dmg', 'Ignivar', 5);
    expect(report).toMatch(/\[WoC\] (Damage|Daño)/);
    expect(report).toContain('1. Warrior');
    expect(report).toContain('2. Priest');
    expect(report).toContain('67%');
    expect(report).toContain('33%');
  });

  it('handles empty encounters gracefully', () => {
    const _w = fakeWorld();
    const m = new MeterData(0);
    // Force empty encounter
    m.resetAll(0);

    const report = formatChatReport(m.allTime, 'heal', 'Actual', 5);
    expect(report).toMatch(/Sin datos registrados|No data recorded/);
  });
});

describe('Details! Options Dialog', () => {
  beforeEach(() => {
    for (const el of document.querySelectorAll('#meters-options-modal')) {
      el.remove();
    }
    document.body.innerHTML = MARKUP;
  });

  it('renders all 7 categories and allows tab switching', () => {
    let currentSettings = { ...DEFAULT_METERS_SETTINGS };
    const dialog = new MetersOptionsDialog({
      getSettings: () => currentSettings,
      onSettingsChanged: (s) => {
        currentSettings = { ...s };
      },
    });

    dialog.open();
    const modal = document.getElementById('meters-options-modal');
    expect(modal).toBeTruthy();

    const tabButtons = modal?.querySelectorAll('.mt-opts-tab-btn');
    expect(tabButtons?.length).toBe(7);

    // Switch to Barras
    (tabButtons?.[1] as HTMLElement | undefined)?.click();
    const groupTitle = modal?.querySelector('.mt-opts-group-title');
    expect(groupTitle?.textContent).toMatch(/Bar|Barras/);

    // Switch to Presets
    (tabButtons?.[5] as HTMLElement | undefined)?.click();
    const presetCards = modal?.querySelectorAll('.mt-opts-preset-card');
    expect(presetCards?.length).toBe(5);

    // Switch to Profiles
    (tabButtons?.[6] as HTMLElement | undefined)?.click();
    const profileSections = modal?.querySelectorAll('.mt-opts-profile-section');
    expect(profileSections?.length).toBe(3);

    dialog.close();
  });

  it('supports font selection in typography section', () => {
    let currentSettings: MetersSettings = { ...DEFAULT_METERS_SETTINGS, fontFamily: 'expressway' };
    const dialog = new MetersOptionsDialog({
      getSettings: () => currentSettings,
      onSettingsChanged: (s) => {
        currentSettings = { ...s };
      },
    });

    dialog.open();
    const modal = document.getElementById('meters-options-modal');

    // Switch to text tab
    const tabButtons = modal?.querySelectorAll('.mt-opts-tab-btn');
    (tabButtons?.[2] as HTMLElement | undefined)?.click();

    // Verify all font cards are rendered
    const fontCards = modal?.querySelectorAll('.mt-opts-font-card');
    expect(fontCards?.length).toBe(FONT_OPTIONS.length);

    // Select Cinzel font (index 3)
    (fontCards?.[3] as HTMLElement | undefined)?.click();
    expect(currentSettings.fontFamily).toBe('cinzel');

    // Select Monospace font (index 4)
    (fontCards?.[4] as HTMLElement | undefined)?.click();
    expect(currentSettings.fontFamily).toBe('monospace');

    dialog.close();
  });

  it('exports and imports profile strings cleanly', () => {
    const original: MetersSettings = {
      ...DEFAULT_METERS_SETTINGS,
      density: 'compact',
      opacity: 'solid',
      fontFamily: 'cinzel',
      barHeight: 18,
      numberFormat: 'detailed',
      showRank: false,
    };

    const exported = exportProfileString(original);
    expect(exported.startsWith('!WoC-Details:')).toBe(true);

    const imported = importProfileString(exported);
    expect(imported).not.toBeNull();
    expect(imported?.density).toBe('compact');
    expect(imported?.opacity).toBe('solid');
    expect(imported?.fontFamily).toBe('cinzel');
    expect(imported?.barHeight).toBe(18);
    expect(imported?.numberFormat).toBe('detailed');
    expect(imported?.showRank).toBe(false);

    // Also handles pure JSON
    const jsonStr = JSON.stringify(original);
    const importedJson = importProfileString(jsonStr);
    expect(importedJson).not.toBeNull();
    expect(importedJson?.fontFamily).toBe('cinzel');

    // Returns null on corrupted strings
    expect(importProfileString('!WoC-Details:not_valid_base64_???')).toBeNull();
    expect(importProfileString('')).toBeNull();
  });

  it('manages profiles in options dialog: create, switch, duplicate, and import', () => {
    const mem = new Map<string, string>();
    const storage = {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => {
        mem.set(k, v);
      },
      removeItem: (k: string) => {
        mem.delete(k);
      },
    };

    let currentSettings = { ...DEFAULT_METERS_SETTINGS };
    const dialog = new MetersOptionsDialog({
      getSettings: () => currentSettings,
      onSettingsChanged: (s) => {
        currentSettings = { ...s };
      },
      storage,
    });

    dialog.open();
    const modal = document.getElementById('meters-options-modal');

    // Switch to Profiles tab (index 6)
    const tabButtons = modal?.querySelectorAll('.mt-opts-tab-btn');
    (tabButtons?.[6] as HTMLElement | undefined)?.click();

    // Verify select has default profiles
    const select = modal?.querySelector('.mt-opts-select') as HTMLSelectElement;
    expect(select).toBeTruthy();
    expect(select.options.length).toBeGreaterThanOrEqual(4);

    // Switch to 'Minimalista'
    select.value = 'Minimalista';
    select.dispatchEvent(new Event('change'));
    expect(currentSettings.density).toBe('compact');
    expect(currentSettings.themePreset).toBe('minimal');
    expect(getActiveProfileName(storage)).toBe('Minimalista');

    // Import a new profile via the import textarea
    const customExport = exportProfileString({
      ...DEFAULT_METERS_SETTINGS,
      density: 'compact',
      fontFamily: 'futura',
      barHeight: 22,
    });

    const importInput = modal?.querySelector('.mt-opts-import-input') as HTMLTextAreaElement;
    const nameInput = modal?.querySelector('.mt-opts-text-input') as HTMLInputElement;
    const importBtn = modal?.querySelector('.mt-opts-btn-import') as HTMLElement;

    expect(importInput).toBeTruthy();
    expect(importBtn).toBeTruthy();

    importInput.value = customExport;
    nameInput.value = 'Mi Perfil Futura';
    importBtn.click();

    expect(currentSettings.fontFamily).toBe('futura');
    expect(currentSettings.barHeight).toBe(22);
    expect(getActiveProfileName(storage)).toBe('Mi Perfil Futura');

    dialog.close();
  });

  it('updates settings on toggle and slider interactions', () => {
    let currentSettings = { ...DEFAULT_METERS_SETTINGS, barHeight: 20, alwaysShowMe: false };
    const dialog = new MetersOptionsDialog({
      getSettings: () => currentSettings,
      onSettingsChanged: (s) => {
        currentSettings = { ...s };
      },
    });

    dialog.open();
    const modal = document.getElementById('meters-options-modal');

    // Switch to bars tab
    const tabButtons = modal?.querySelectorAll('.mt-opts-tab-btn');
    (tabButtons?.[1] as HTMLElement | undefined)?.click();

    // Toggle alwaysShowMe checkbox
    const checkboxes = modal?.querySelectorAll('input[type="checkbox"]');
    expect(checkboxes && checkboxes.length > 0).toBe(true);
    const lastCheckbox = checkboxes?.[(checkboxes?.length ?? 1) - 1] as
      | HTMLInputElement
      | undefined;
    if (lastCheckbox) {
      lastCheckbox.checked = true;
      lastCheckbox.dispatchEvent(new Event('change'));
    }

    expect(currentSettings.alwaysShowMe).toBe(true);

    dialog.close();
  });

  it('applies preset themes and triggers onSettingsChanged', () => {
    let currentSettings = { ...DEFAULT_METERS_SETTINGS };
    const dialog = new MetersOptionsDialog({
      getSettings: () => currentSettings,
      onSettingsChanged: (s) => {
        currentSettings = { ...s };
      },
    });

    dialog.open();
    const modal = document.getElementById('meters-options-modal');

    // Switch to presets tab
    const tabButtons = modal?.querySelectorAll('.mt-opts-tab-btn');
    (tabButtons?.[5] as HTMLElement | undefined)?.click();

    // Click Apply on Classic WoW preset (second card)
    const applyButtons = modal?.querySelectorAll('.mt-opts-btn-apply');
    expect(applyButtons && applyButtons.length >= 5).toBe(true);
    (applyButtons?.[1] as HTMLElement | undefined)?.click();

    expect(currentSettings.themePreset).toBe('classic');
    expect(currentSettings.barTexture).toBe('smooth');
    expect(currentSettings.numberFormat).toBe('detailed');

    // Click Apply on Pro Gradient preset (fifth card)
    (applyButtons?.[4] as HTMLElement | undefined)?.click();
    expect(currentSettings.themePreset).toBe('pro_gradient');
    expect(currentSettings.barTexture).toBe('gradient');
    expect(currentSettings.numberFormat).toBe('damage_dps');
    expect(currentSettings.barHeight).toBe(22);
    expect(currentSettings.barSpacing).toBe(0);

    dialog.close();
  });

  it('closes cleanly on close button click and on Escape key', () => {
    let currentSettings = { ...DEFAULT_METERS_SETTINGS };
    let closed = false;
    const dialog = new MetersOptionsDialog({
      getSettings: () => currentSettings,
      onSettingsChanged: (s) => {
        currentSettings = { ...s };
      },
      onClose: () => {
        closed = true;
      },
    });

    dialog.open();
    const modal = document.getElementById('meters-options-modal');
    expect(modal?.style.display).toBe('flex');

    // Escape closes
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(modal?.style.display).toBe('none');
    expect(closed).toBe(true);

    // Re-open and close with close button
    dialog.open();
    expect(modal?.style.display).toBe('flex');
    const closeBtn = modal?.querySelector('.mt-opts-close') as HTMLElement;
    closeBtn.click();
    expect(modal?.style.display).toBe('none');
  });

  it('resets to defaults when clicking reset button', () => {
    let currentSettings: MetersSettings = {
      ...DEFAULT_METERS_SETTINGS,
      barHeight: 14,
      density: 'compact',
      numberFormat: 'detailed',
    };

    const dialog = new MetersOptionsDialog({
      getSettings: () => currentSettings,
      onSettingsChanged: (s) => {
        currentSettings = { ...s };
      },
    });

    dialog.open();
    const modal = document.getElementById('meters-options-modal');
    const resetBtn = modal?.querySelector('.mt-opts-btn-reset') as HTMLElement;
    resetBtn.click();

    expect(currentSettings.barHeight).toBe(DEFAULT_METERS_SETTINGS.barHeight);
    expect(currentSettings.density).toBe(DEFAULT_METERS_SETTINGS.density);
    expect(currentSettings.numberFormat).toBe(DEFAULT_METERS_SETTINGS.numberFormat);

    dialog.close();
  });

  it('resolves spec icons with fallback to class icons', () => {
    // Valid registered specs return spec icon URLs
    expect(meterIconUrl('warrior', 'arms')).toBe('/ui/specs/warrior/arms.webp');
    expect(meterIconUrl('warrior', 'fury')).toBe('/ui/specs/warrior/fury.webp');
    expect(meterIconUrl('warrior', 'prot')).toBe('/ui/specs/warrior/prot.webp');
    expect(meterIconUrl('mage', 'frost')).toBe('/ui/specs/mage/frost.webp');
    expect(meterIconUrl('priest', 'discipline')).toBe('/ui/specs/priest/discipline.webp');

    // Missing or invalid spec falls back to class icon
    expect(meterIconUrl('warrior', null)).toBe('/ui/classes/warrior.webp');
    expect(meterIconUrl('warrior', undefined)).toBe('/ui/classes/warrior.webp');
    expect(meterIconUrl('warrior', '')).toBe('/ui/classes/warrior.webp');
    expect(meterIconUrl('warrior', 'unknown_spec')).toBe('/ui/classes/warrior.webp');
    expect(meterIconUrl('mage', null)).toBe('/ui/classes/mage.webp');

    // Null or invalid class returns null
    expect(meterIconUrl(null, null)).toBeNull();
    expect(meterIconUrl('not_a_class', null)).toBeNull();
  });

  it('infers spec from signature abilities when available', () => {
    expect(inferSpecFromAbility('warrior', 'Mortal Strike')).toBe('arms');
    expect(inferSpecFromAbility('warrior', 'mortal_strike')).toBe('arms');
    expect(inferSpecFromAbility('warrior', 'Bloodthirst')).toBe('fury');
    expect(inferSpecFromAbility('warrior', 'shield_slam')).toBe('prot');
    expect(inferSpecFromAbility('mage', 'Ice Lance')).toBe('frost');
    expect(inferSpecFromAbility('priest', 'Penance')).toBe('discipline');
    expect(inferSpecFromAbility('warlock', 'Chaos Bolt')).toBe('destruction');
    expect(inferSpecFromAbility('druid', 'Moonkin Form')).toBe('balance');
    expect(inferSpecFromAbility('warrior', 'Attack')).toBeNull();
    expect(inferSpecFromAbility(null, 'Mortal Strike')).toBeNull();
  });

  it('renders spec icon in row when spec is selected', () => {
    const world = fakeWorld();
    (world as any).talentSpec = 'fury';
    (world.player as any).templateId = 'warrior';

    const meters = new Meters(world, {
      attachTooltip: () => {},
    });
    meters.toggle();

    meters.onEvent({
      type: 'damage',
      sourceId: 1,
      targetId: 50,
      amount: 150,
      crit: false,
      school: 'physical',
      ability: 'Bloodthirst',
      kind: 'hit',
    } as SimEvent);
    meters.render(true);

    const rowIcon = document.querySelector('#meters-window .mt-row .mt-icon') as HTMLElement;
    expect(rowIcon).not.toBeNull();
    expect(rowIcon.style.backgroundImage).toContain('/ui/specs/warrior/fury.webp');
  });

  it('falls back to class icon in row when no spec is chosen', () => {
    const worldNoSpec = fakeWorld();
    (worldNoSpec as any).talentSpec = null;
    (worldNoSpec.player as any).templateId = 'warrior';

    const metersNoSpec = new Meters(worldNoSpec, {
      attachTooltip: () => {},
    });
    metersNoSpec.toggle();

    metersNoSpec.onEvent({
      type: 'damage',
      sourceId: 1,
      targetId: 50,
      amount: 80,
      crit: false,
      school: 'physical',
      ability: 'Attack',
      kind: 'hit',
    } as SimEvent);
    metersNoSpec.render(true);

    const rowIconNoSpec = document.querySelector('#meters-window .mt-row .mt-icon') as HTMLElement;
    expect(rowIconNoSpec).not.toBeNull();
    expect(rowIconNoSpec.style.backgroundImage).toContain('/ui/classes/warrior.webp');
  });

  it('keeps last fight menu clean showing only fights and no phases, timeline, or export clutter', () => {
    document.body.innerHTML = MARKUP;
    const world = fakeWorld();
    const menus: { items: { act: string; label: string }[]; select: (act: string) => void }[] = [];

    const meters = new Meters(world, {
      attachTooltip: () => {},
      openMenu: (items, _x, _y, onSelect) => {
        menus.push({ items: [...items], select: onSelect });
      },
    });
    meters.toggle();

    // Record two fights
    meters.onEvent({
      type: 'damage',
      sourceId: 1,
      targetId: 50,
      amount: 100,
      crit: false,
      school: 'physical',
      ability: 'Attack',
      kind: 'hit',
    } as SimEvent);
    meters.data.endEncounter();

    meters.onEvent({
      type: 'damage',
      sourceId: 1,
      targetId: 50,
      amount: 200,
      crit: false,
      school: 'physical',
      ability: 'Attack',
      kind: 'hit',
    } as SimEvent);
    meters.render(true);

    const segTrigger = document.querySelector('#meters-window .mt-seg-trigger') as HTMLElement;
    expect(segTrigger).not.toBeNull();
    segTrigger.click();

    expect(menus.length).toBe(1);
    const menu = menus[0];

    // Check acts: only encounter index acts (0, 1, 2)
    const acts = menu.items.map((i) => i.act);
    expect(acts).toEqual(['0', '1', '2']);

    // Ensure no phase, timeline, export or chat clutter
    expect(acts.some((act) => act.startsWith('phase:'))).toBe(false);
    expect(acts.includes('tool:timeline')).toBe(false);
    expect(acts.includes('tool:export_text')).toBe(false);
    expect(acts.includes('tool:report_chat')).toBe(false);
  });

  it('renders damage_dps number format and breakdown targets in tooltip', () => {
    document.body.innerHTML = MARKUP;
    const world = fakeWorld();
    let tipHtml = '';
    const meters = new Meters(world, {
      attachTooltip: (el, fn) => {
        el.addEventListener('mouseenter', () => {
          tipHtml = fn();
        });
      },
    });

    meters.updateSettings({
      ...DEFAULT_METERS_SETTINGS,
      ...PRESETS.pro_gradient,
      numberFormat: 'damage_dps',
      showDps: true,
      showPercent: false,
    });

    meters.onEvent({
      type: 'damage',
      sourceId: 1,
      targetId: 50,
      targetName: 'Swift Lynx',
      amount: 24000,
      crit: false,
      school: 'physical',
      ability: 'Attack',
      abilityId: 'attack',
      kind: 'hit',
    } as unknown as SimEvent);
    meters.render(true);

    const row = document.querySelector('#meters-window .mt-row') as HTMLElement;
    expect(row).not.toBeNull();
    const numEl = row.querySelector('.mt-num');
    expect(numEl?.innerHTML).toContain('mt-val-sep');
    expect(numEl?.textContent).toContain('|');
    expect(numEl?.textContent).toContain('24.0k');

    // Trigger hover tooltip
    row.dispatchEvent(new MouseEvent('mouseenter'));
    expect(tipHtml).toContain('mt-tip-targets-section');
    expect(tipHtml).toContain('Ignivar');
    expect(tipHtml).toContain('mt-tip-target-bar');
    expect(tipHtml).toContain('mt-tip-icon');
  });
});
