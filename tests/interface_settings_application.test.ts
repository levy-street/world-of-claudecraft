import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  applyInterfaceSetting,
  type InterfaceSettingsHost,
} from '../src/game/interface_settings_application';

function setup() {
  const actionbar = { classList: { toggle: vi.fn() } };
  const actionbar2 = { classList: { toggle: vi.fn() } };
  const actionbar3 = { classList: { toggle: vi.fn() } };
  const elements = new Map([
    ['actionbar', actionbar],
    ['actionbar2', actionbar2],
    ['actionbar3', actionbar3],
  ]);
  const host = {
    rootStyle: { setProperty: vi.fn() },
    bodyClassList: { toggle: vi.fn() },
    getElementById: vi.fn((id: string) => elements.get(id) ?? null),
    setLockPlayerFrameToActionBar: vi.fn(),
  } satisfies InterfaceSettingsHost;

  return { actionbar, actionbar2, actionbar3, host };
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|\s)\/\/.*$/gm, '$1');
}

const mainTs = stripComments(readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8'));
const applicationTs = stripComments(
  readFileSync(new URL('../src/game/interface_settings_application.ts', import.meta.url), 'utf8'),
);

const INTERFACE_SETTING_KEYS = [
  'playerFrameScale',
  'targetFrameScale',
  'playerFrameWidth',
  'playerFrameHeight',
  'targetFrameWidth',
  'targetFrameHeight',
  'partyFrameScale',
  'partyFrameWidth',
  'partyFrameHeight',
  'partyFrameSpacing',
  'partyFrameColumns',
  'buffsLeftToRight',
  'debuffsLeftToRight',
  'lockPlayerFrameToActionBar',
  'actionBar1Vertical',
  'actionBar2Vertical',
  'actionBar3Vertical',
  'menuRailHorizontal',
  'frameSnapToGrid',
] as const;

describe('applyInterfaceSetting', () => {
  it.each([
    ['playerFrameScale', 0.9, '--player-frame-scale', '0.9'],
    ['targetFrameScale', 1.1, '--target-frame-scale', '1.1'],
    ['playerFrameWidth', 640, '--player-frame-width', '640px'],
    ['playerFrameHeight', 18, '--player-frame-height', '18px'],
    ['targetFrameWidth', 220, '--target-frame-width', '220px'],
    ['targetFrameHeight', 20, '--target-frame-height', '20px'],
    ['partyFrameScale', 1.2, '--party-frame-scale', '1.2'],
    ['partyFrameWidth', 180, '--party-frame-width', '180px'],
    ['partyFrameHeight', 48, '--party-frame-height', '48px'],
    ['partyFrameSpacing', 6, '--party-frame-spacing', '6px'],
    ['partyFrameColumns', 2.6, '--party-frame-columns', '3'],
  ] as const)('applies %s to its root CSS variable', (key, value, property, applied) => {
    const { host } = setup();

    expect(applyInterfaceSetting(key, value, host)).toBe(true);
    expect(host.rootStyle.setProperty).toHaveBeenCalledWith(property, applied);
  });

  it.each([
    ['buffsLeftToRight', true, '--buff-bar-direction', 'row'],
    ['buffsLeftToRight', false, '--buff-bar-direction', 'row-reverse'],
    ['debuffsLeftToRight', true, '--debuff-bar-direction', 'row'],
    ['debuffsLeftToRight', false, '--debuff-bar-direction', 'row-reverse'],
  ] as const)('applies %s=%s to its aura direction', (key, value, property, direction) => {
    const { host } = setup();

    expect(applyInterfaceSetting(key, value, host)).toBe(true);
    expect(host.rootStyle.setProperty).toHaveBeenCalledWith(property, direction);
    expect(host.rootStyle.setProperty).toHaveBeenCalledOnce();
    expect(host.bodyClassList.toggle).not.toHaveBeenCalled();
    expect(host.getElementById).not.toHaveBeenCalled();
    expect(host.setLockPlayerFrameToActionBar).not.toHaveBeenCalled();
  });

  it.each([true, false])('delegates player-frame lock=%s to the HUD host', (locked) => {
    const { host } = setup();

    expect(applyInterfaceSetting('lockPlayerFrameToActionBar', locked, host)).toBe(true);
    expect(host.setLockPlayerFrameToActionBar).toHaveBeenCalledWith(locked);
  });

  it.each([
    ['actionBar1Vertical', 'actionbar', true],
    ['actionBar1Vertical', 'actionbar', false],
    ['actionBar2Vertical', 'actionbar2', true],
    ['actionBar2Vertical', 'actionbar2', false],
    ['actionBar3Vertical', 'actionbar3', true],
    ['actionBar3Vertical', 'actionbar3', false],
  ] as const)('applies %s only to %s when vertical=%s', (key, elementId, vertical) => {
    const { actionbar, actionbar2, actionbar3, host } = setup();
    const bars = { actionbar, actionbar2, actionbar3 };

    expect(applyInterfaceSetting(key, vertical, host)).toBe(true);
    expect(host.getElementById).toHaveBeenCalledWith(elementId);
    expect(host.getElementById).toHaveBeenCalledOnce();
    expect(bars[elementId].classList.toggle).toHaveBeenCalledWith('bar-vertical', vertical);
    expect(bars[elementId].classList.toggle).toHaveBeenCalledOnce();
    for (const [otherId, otherBar] of Object.entries(bars)) {
      if (otherId !== elementId) expect(otherBar.classList.toggle).not.toHaveBeenCalled();
    }
    if (key === 'actionBar1Vertical') {
      expect(host.bodyClassList.toggle).toHaveBeenCalledWith('combined-bars-vertical', vertical);
      expect(host.bodyClassList.toggle).toHaveBeenCalledOnce();
    } else {
      expect(host.bodyClassList.toggle).not.toHaveBeenCalled();
    }
    expect(host.rootStyle.setProperty).not.toHaveBeenCalled();
    expect(host.setLockPlayerFrameToActionBar).not.toHaveBeenCalled();
  });

  it.each([
    ['actionBar1Vertical', true],
    ['actionBar2Vertical', false],
    ['actionBar3Vertical', false],
  ] as const)('handles a missing element for %s', (key, togglesCombinedBody) => {
    const { host } = setup();
    host.getElementById.mockReturnValue(null);

    expect(applyInterfaceSetting(key, false, host)).toBe(true);
    expect(host.getElementById).toHaveBeenCalledOnce();
    if (togglesCombinedBody) {
      expect(host.bodyClassList.toggle).toHaveBeenCalledWith('combined-bars-vertical', false);
      expect(host.bodyClassList.toggle).toHaveBeenCalledOnce();
    } else {
      expect(host.bodyClassList.toggle).not.toHaveBeenCalled();
    }
  });

  it.each([true, false])('toggles the menu-rail orientation to %s', (horizontal) => {
    const { host } = setup();

    expect(applyInterfaceSetting('menuRailHorizontal', horizontal, host)).toBe(true);
    expect(host.bodyClassList.toggle).toHaveBeenCalledWith('menu-rail-horizontal', horizontal);
  });

  it.each([true, false])('recognizes frame snapping=%s without an eager side effect', (snap) => {
    const { actionbar, actionbar2, actionbar3, host } = setup();

    expect(applyInterfaceSetting('frameSnapToGrid', snap, host)).toBe(true);
    expect(host.rootStyle.setProperty).not.toHaveBeenCalled();
    expect(host.bodyClassList.toggle).not.toHaveBeenCalled();
    expect(host.getElementById).not.toHaveBeenCalled();
    expect(host.setLockPlayerFrameToActionBar).not.toHaveBeenCalled();
    expect(actionbar.classList.toggle).not.toHaveBeenCalled();
    expect(actionbar2.classList.toggle).not.toHaveBeenCalled();
    expect(actionbar3.classList.toggle).not.toHaveBeenCalled();
  });

  it('returns false without side effects for settings owned elsewhere', () => {
    const { host } = setup();

    expect(applyInterfaceSetting('brightness', 1.2, host)).toBe(false);
    expect(host.rootStyle.setProperty).not.toHaveBeenCalled();
    expect(host.bodyClassList.toggle).not.toHaveBeenCalled();
    expect(host.getElementById).not.toHaveBeenCalled();
    expect(host.setLockPlayerFrameToActionBar).not.toHaveBeenCalled();
  });
});

describe('main interface-settings wiring', () => {
  it('owns the complete editor-setting inventory outside main.ts', () => {
    for (const key of INTERFACE_SETTING_KEYS) {
      expect(applicationTs).toContain(`case '${key}':`);
      expect(mainTs).not.toContain(`case '${key}':`);
    }
  });

  it('injects the real DOM and HUD host dependencies', () => {
    const hostStart = mainTs.indexOf('const interfaceSettingsHost = {');
    const hostEnd = mainTs.indexOf('\n  };', hostStart);
    const host = mainTs.slice(hostStart, hostEnd);

    expect(hostStart).toBeGreaterThan(-1);
    expect(hostEnd).toBeGreaterThan(hostStart);
    expect(host).toContain('rootStyle: document.documentElement.style');
    expect(host).toContain('bodyClassList: document.body.classList');
    expect(host).toContain('getElementById: (id: string) => document.getElementById(id)');
    expect(host).toContain(
      'setLockPlayerFrameToActionBar: (locked: boolean) => hud.setLockPlayerFrameToActionBar(locked)',
    );
  });

  it('persists before delegation and keeps startup settings on the same path', () => {
    const applyStart = mainTs.indexOf('function applySetting(');
    const applyEnd = mainTs.indexOf('const saved = settings.all();', applyStart);
    const applyBody = mainTs.slice(applyStart, applyEnd);
    const persistAt = applyBody.indexOf(
      'const v = settings.set(key as keyof typeof SETTING_RANGES, value as number);',
    );
    const delegateAt = applyBody.indexOf(
      'if (applyInterfaceSetting(key, v, interfaceSettingsHost)) return;',
    );

    expect(applyStart).toBeGreaterThan(-1);
    expect(applyEnd).toBeGreaterThan(applyStart);
    expect(persistAt).toBeGreaterThan(-1);
    expect(delegateAt).toBeGreaterThan(persistAt);
    expect(mainTs).toContain(
      'for (const k of Object.keys(saved) as (keyof GameSettings)[]) applySetting(k, saved[k]);',
    );
  });
});
