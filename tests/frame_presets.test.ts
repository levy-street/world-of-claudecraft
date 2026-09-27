// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LAYOUT_RESET_EPOCH, LAYOUT_RESET_EPOCH_KEY } from '../src/ui/frame_pos_reset';
import { FramePresets } from '../src/ui/frame_presets';
import { renderFramePresets } from '../src/ui/frame_presets_controls';
import { FRAME_PRESETS_KEY, parseFramePresets } from '../src/ui/frame_presets_core';

beforeEach(() => localStorage.clear());
describe('frame presets', () => {
  it('keeps the menu usable when the browser blocks access to storage', () => {
    const storage = vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new Error('blocked');
    });
    try {
      const parent = document.createElement('div');
      expect(() => renderFramePresets(parent)).not.toThrow();
      expect(parent.querySelector('.tal-loadout-btn')).toBeTruthy();
      expect([...parent.querySelectorAll('button')].every((button) => button.disabled)).toBe(true);
      expect(parent.querySelector('[role="status"]')?.textContent).toContain('Could not');
    } finally {
      storage.mockRestore();
    }
  });

  it('retains ten named layouts across a new controller and refuses an eleventh', () => {
    const presets = new FramePresets(localStorage);
    for (let i = 0; i < 10; i++) {
      localStorage.setItem('woc_party_frame_pos', JSON.stringify({ left: 10 * i, top: 200 }));
      expect(presets.save(i, `Layout ${i + 1}`)).toBe(true);
    }
    expect(presets.save(10, 'Extra')).toBe(false);
    const restored = new FramePresets(localStorage);
    expect(restored.list().filter(Boolean)).toHaveLength(10);
    expect(restored.apply(3)).toBe(true);
    expect(JSON.parse(localStorage.getItem('woc_party_frame_pos')!)).toEqual({
      left: 30,
      top: 200,
    });
    expect(restored.remove(3)).toBe(true);
    expect(restored.list()[3]).toBeNull();
    expect(restored.list()[4]?.name).toBe('Layout 5');
  });
  it('replaces geometry, hidden flags and frame settings without changing unrelated preferences', () => {
    const presets = new FramePresets(localStorage);
    localStorage.setItem(
      'woc_settings',
      JSON.stringify({
        partyFrameColumns: 4,
        menuRailHorizontal: true,
        uiScale: 1.8,
        musicVolume: 0.4,
      }),
    );
    localStorage.setItem('woc_party_frame_pos_hidden', '1');
    localStorage.setItem('woc_hud_frame_menu', '{"left":400,"top":80}');
    expect(presets.save(0, 'Wide')).toBe(true);
    localStorage.setItem(
      'woc_settings',
      JSON.stringify({
        partyFrameColumns: 1,
        menuRailHorizontal: false,
        uiScale: 1,
        playerFrameWidth: 300,
        musicVolume: 0.8,
      }),
    );
    localStorage.removeItem('woc_party_frame_pos_hidden');
    localStorage.setItem('woc_target_frame_pos', '{}');
    localStorage.setItem('session', 'keep');
    expect(presets.apply(0)).toBe(true);
    expect(JSON.parse(localStorage.getItem('woc_settings')!)).toEqual({
      partyFrameColumns: 4,
      menuRailHorizontal: true,
      uiScale: 1.8,
      musicVolume: 0.8,
    });
    expect(localStorage.getItem('woc_target_frame_pos')).toBeNull();
    expect(localStorage.getItem('woc_party_frame_pos_hidden')).toBe('1');
    expect(localStorage.getItem('session')).toBe('keep');
    expect(localStorage.getItem(LAYOUT_RESET_EPOCH_KEY)).toBe(String(LAYOUT_RESET_EPOCH));
  });
  it('keeps health text preferences outside new and legacy frame presets', () => {
    const presets = new FramePresets(localStorage);
    localStorage.setItem(
      'woc_settings',
      JSON.stringify({
        playerFrameHealthText: 1,
        targetFrameHealthText: 2,
        showEmptyFocusFrames: true,
      }),
    );
    presets.save(0, 'Layout');
    expect(presets.list()[0]?.settings).toEqual({ uiScale: 1, showEmptyFocusFrames: true });
    const legacy = JSON.parse(localStorage.getItem(FRAME_PRESETS_KEY)!);
    Object.assign(legacy.slots[0].settings, { playerFrameHealthText: 0, targetFrameHealthText: 0 });
    localStorage.setItem(FRAME_PRESETS_KEY, JSON.stringify(legacy));
    localStorage.setItem(
      'woc_settings',
      JSON.stringify({
        playerFrameHealthText: 4,
        targetFrameHealthText: 3,
        showEmptyFocusFrames: false,
      }),
    );
    expect(presets.apply(0)).toBe(true);
    expect(JSON.parse(localStorage.getItem('woc_settings')!)).toEqual({
      playerFrameHealthText: 4,
      targetFrameHealthText: 3,
      uiScale: 1,
      showEmptyFocusFrames: true,
    });
  });
  it('rejects malformed snapshots and drops unrelated settings and storage keys', () => {
    expect(parseFramePresets('broken').every((slot) => slot === null)).toBe(true);
    const parsed = parseFramePresets(
      JSON.stringify({
        v: 1,
        slots: [
          {
            name: 'safe',
            geometry: {
              session: 'bad',
              woc_frame_presets_v1: 'recursive',
              woc_party_frame_pos: '{}',
            },
            settings: { uiScale: 2, musicVolume: 0.2, showTargetOfTarget: true },
          },
        ],
      }),
    );
    expect(parsed[0]).toEqual({
      name: 'safe',
      geometry: { woc_party_frame_pos: '{}' },
      settings: { uiScale: 2, showTargetOfTarget: true },
    });
  });
  it('rolls back an incomplete restore when a storage write fails', () => {
    const presets = new FramePresets(localStorage);
    localStorage.setItem('woc_party_frame_pos', 'old');
    presets.save(0, 'Old');
    localStorage.setItem('woc_party_frame_pos', 'current');
    const before = localStorage.getItem(FRAME_PRESETS_KEY);
    let reject = true;
    const failing = new FramePresets({
      get length() {
        return localStorage.length;
      },
      key: (i) => localStorage.key(i),
      getItem: (key) => localStorage.getItem(key),
      removeItem: (key) => localStorage.removeItem(key),
      setItem: (key, value) => {
        if (key === 'woc_settings' && reject) {
          reject = false;
          throw new Error('full');
        }
        localStorage.setItem(key, value);
      },
    });
    expect(failing.apply(0)).toBe(false);
    expect(localStorage.getItem('woc_party_frame_pos')).toBe('current');
    expect(localStorage.getItem(FRAME_PRESETS_KEY)).toBe(before);
  });
});

describe('talent-style frame loadouts', () => {
  it('selects without applying, applies explicitly, saves, and deletes named layouts', () => {
    const parent = document.createElement('div');
    document.body.replaceChildren(parent);
    const applyFramePreset = vi.fn();
    const inputDialog = vi.fn();
    const confirmDialog = vi.fn();
    const dispose = renderFramePresets(parent, { inputDialog, confirmDialog, applyFramePreset });
    expect(
      [...parent.querySelectorAll<HTMLElement>('[data-preset-action]')].map(
        (button) => button.dataset.presetAction,
      ),
    ).toEqual(['apply', 'save', 'new', 'delete', 'import', 'export']);
    expect(parent.querySelector<HTMLButtonElement>('[data-preset-action="apply"]')!.disabled).toBe(
      true,
    );
    const picker = parent.querySelector<HTMLButtonElement>('.tal-loadout-btn')!;
    const menuButton = (text: string) =>
      [...parent.querySelectorAll<HTMLButtonElement>('[data-preset-action]')].find(
        (button) => button.textContent === text,
      )!;
    picker.click();
    menuButton('New Preset').click();
    inputDialog.mock.calls[0][0].onOk('Raid');
    expect(picker.textContent).toContain('Raid');
    localStorage.setItem('woc_party_frame_pos', '{"left":120,"top":80}');
    picker.click();
    menuButton('Save').click();
    picker.click();
    menuButton('New Preset').click();
    inputDialog.mock.calls[1][0].onOk('Questing');
    localStorage.setItem('woc_party_frame_pos', '{"left":500,"top":100}');
    picker.click();
    [...parent.querySelectorAll<HTMLButtonElement>('.tal-lo-pick')]
      .find((button) => button.textContent === 'Raid')!
      .click();
    expect(applyFramePreset).not.toHaveBeenCalled();
    expect(localStorage.getItem('woc_party_frame_pos')).toBe('{"left":500,"top":100}');
    expect(new FramePresets(localStorage).active()).toBe(1);
    expect(picker.textContent).toContain('Raid');
    menuButton('Apply').click();
    expect(applyFramePreset).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('woc_party_frame_pos')).toBe('{"left":120,"top":80}');
    expect(new FramePresets(localStorage).active()).toBe(0);
    picker.click();
    parent.querySelector<HTMLButtonElement>('[data-preset-action="delete"]')!.click();
    expect(new FramePresets(localStorage).list()[0]?.name).toBe('Raid');
    confirmDialog.mock.calls[0][4]();
    expect(new FramePresets(localStorage).list()[0]).toBeNull();
    expect(new FramePresets(localStorage).list()[1]?.name).toBe('Questing');
    expect(picker.textContent).toContain('Current Layout');
    dispose();
  });

  it('limits new layouts to ten and supports keyboard dismissal and disposal', () => {
    const store = new FramePresets(localStorage);
    for (let index = 0; index < 10; index++) store.save(index, `Layout ${index + 1}`);
    const parent = document.createElement('div');
    document.body.replaceChildren(parent);
    const dispose = renderFramePresets(parent, {
      inputDialog: vi.fn(),
      confirmDialog: vi.fn(),
      applyFramePreset: vi.fn(),
    });
    const picker = parent.querySelector<HTMLButtonElement>('.tal-loadout-btn')!;
    picker.click();
    expect(parent.querySelectorAll('.tal-lo-pick')).toHaveLength(10);
    expect(
      [...parent.querySelectorAll<HTMLButtonElement>('[data-preset-action]')].find(
        (button) => button.textContent === 'New Preset',
      )!.disabled,
    ).toBe(true);
    parent
      .querySelector('[role="menu"]')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.activeElement).toBe(picker);
    expect(parent.querySelector('[role="menu"]')).toBeNull();
    picker.click();
    dispose();
    expect(parent.querySelector('[role="menu"]')).toBeNull();
    expect(picker.getAttribute('aria-expanded')).toBe('false');
  });
});

it('exports the selected full preset and imports a new slot without applying until requested', () => {
  const parent = document.createElement('div');
  document.body.replaceChildren(parent);
  localStorage.setItem('woc_party_frame_pos', '{"left":120,"top":80}');
  localStorage.setItem(
    'woc_settings',
    JSON.stringify({ uiScale: 1.8, combineTrackerFrames: true }),
  );
  new FramePresets(localStorage).save(0, 'Raid');
  const inputDialog = vi.fn();
  const applyFramePreset = vi.fn();
  const dispose = renderFramePresets(parent, {
    inputDialog,
    confirmDialog: vi.fn(),
    applyFramePreset,
  });
  const picker = parent.querySelector<HTMLButtonElement>('.tal-loadout-btn')!;
  const action = (name: string) =>
    [...parent.querySelectorAll<HTMLButtonElement>('[data-preset-action]')]
      .find((button) => button.textContent === name)!
      .click();
  localStorage.setItem('woc_party_frame_pos', '{"left":120,"top":80}');
  picker.click();
  localStorage.setItem(
    'woc_settings',
    JSON.stringify({ uiScale: 0.8, combineTrackerFrames: false }),
  );
  localStorage.setItem('woc_party_frame_pos', '{"left":700,"top":200}');
  action('Export');
  const exported = inputDialog.mock.calls[0][0];
  expect(exported.readOnly).toBe(true);
  expect(exported.copy).toBe(true);
  localStorage.setItem('woc_party_frame_pos', '{"left":400,"top":80}');
  picker.click();
  action('Import');
  inputDialog.mock.calls[1][0].onOk(exported.value);
  expect(localStorage.getItem('woc_party_frame_pos')).toBe('{"left":400,"top":80}');
  expect(applyFramePreset).not.toHaveBeenCalled();
  const store = new FramePresets(localStorage);
  expect(store.list()[1]).toEqual(store.list()[0]);
  expect(store.active()).toBe(0);
  action('Apply');
  expect(applyFramePreset).toHaveBeenCalledOnce();
  expect(localStorage.getItem('woc_party_frame_pos')).toBe('{"left":120,"top":80}');
  expect(JSON.parse(localStorage.getItem('woc_settings')!)).toMatchObject({
    uiScale: 1.8,
    combineTrackerFrames: true,
  });
  inputDialog.mock.calls[1][0].onOk('invalid');
  expect(applyFramePreset).toHaveBeenCalledOnce();
  expect(parent.querySelector('[role="status"]')?.textContent).toContain('not a valid');
  dispose();
});

it('confirms before overwriting a selected but unapplied layout', () => {
  const store = new FramePresets(localStorage);
  localStorage.setItem('woc_settings', JSON.stringify({ uiScale: 1.4 }));
  store.save(0, 'Raid');
  localStorage.setItem('woc_settings', JSON.stringify({ uiScale: 1.8 }));
  store.save(1, 'Questing');
  const parent = document.createElement('div');
  const confirmDialog = vi.fn();
  const dispose = renderFramePresets(parent, {
    inputDialog: vi.fn(),
    confirmDialog,
    applyFramePreset: vi.fn(),
  });
  parent.querySelector<HTMLButtonElement>('.tal-loadout-btn')!.click();
  parent.querySelector<HTMLButtonElement>('.tal-lo-pick')!.click();
  parent.querySelector<HTMLButtonElement>('[data-preset-action="save"]')!.click();
  expect(confirmDialog).toHaveBeenCalledOnce();
  expect(store.list()[0]?.settings.uiScale).toBe(1.4);
  confirmDialog.mock.calls[0][4]();
  expect(store.list()[0]?.settings.uiScale).toBe(1.8);
  dispose();
});

it('excludes gameplay input preferences from saved and imported layouts and enforces the import limit', () => {
  const store = new FramePresets(localStorage);
  localStorage.setItem(
    'woc_settings',
    JSON.stringify({ mouseoverCast: false, lockActionBars: true, frameSnapToGrid: false }),
  );
  store.save(0, 'Layout');
  expect(store.list()[0]?.settings).toEqual({ uiScale: 1 });
  const exported = JSON.parse(store.export(0)!);
  exported.preset.settings.mouseoverCast = true;
  exported.preset.settings.lockActionBars = false;
  expect(store.import(JSON.stringify(exported))).toBe(1);
  expect(store.apply(1)).toBe(true);
  expect(JSON.parse(localStorage.getItem('woc_settings')!)).toMatchObject({
    mouseoverCast: false,
    lockActionBars: true,
    frameSnapToGrid: false,
  });
  for (let i = 2; i < 10; i++) expect(store.import(store.export(0)!)).toBe(i);
  expect(store.import(store.export(0)!)).toBeNull();
  expect(store.import(JSON.stringify({ ...exported, preset: { name: 'broken' } }))).toBeNull();
});

it('rejects aggregate preset storage overflow without losing existing slots', () => {
  const store = new FramePresets(localStorage);
  const geometry = Object.fromEntries(
    [
      'woc_hud_frame_menu',
      'woc_hud_frame_pet',
      'woc_party_frame_pos',
      'woc_target_frame_pos',
      'woc_player_frame_pos',
    ].map((id) => [id, 'x'.repeat(120 * 1024)]),
  );
  const code = JSON.stringify({
    woc: 'woc-frame-preset',
    v: 1,
    preset: { name: 'Large', geometry, settings: { uiScale: 1.2 } },
  });
  expect(store.import(code)).toBe(0);
  const before = localStorage.getItem(FRAME_PRESETS_KEY);
  expect(store.import(code)).toBeNull();
  expect(localStorage.getItem(FRAME_PRESETS_KEY)).toBe(before);
  for (const [key, value] of Object.entries(geometry)) localStorage.setItem(key, value);
  expect(store.save(1, 'Too large')).toBe(false);
  expect(localStorage.getItem(FRAME_PRESETS_KEY)).toBe(before);
});
