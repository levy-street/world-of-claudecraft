// Browser regression for the mobile Interface setting. It composes the real Settings
// store, Interface descriptor, mobile ring painter, writer facet, and mobile stylesheet
// so the fixed Attack control's computed visibility and persisted state stay pinned.

import { afterEach, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import {
  type BoolSettingKey,
  type NumericSettingKey,
  SETTING_RANGES,
  Settings,
} from '../../src/game/settings';
import type { ActionBarSlotElements } from '../../src/ui/action_bar_painter';
import type { ActionBarSlotState, ActionBarState } from '../../src/ui/action_bar_view';
import { MobileActionRingPainter } from '../../src/ui/mobile_action_ring_painter';
import { boolToggleNextValue, buildInterfaceControls } from '../../src/ui/options_view';
import { makeWriterFacet } from '../../src/ui/painter_host';
import '../../src/styles/index.css';
import { cleanup } from './_harness';

const VIEWPORTS = [
  { label: 'portrait', width: 390, height: 844 },
  { label: 'landscape', width: 844, height: 390 },
] as const;

function slot(kind: ActionBarSlotState['kind']): ActionBarSlotState {
  return {
    kind,
    abilityId: null,
    itemId: null,
    iconKey: kind === 'attack' ? '__attack' : '',
    cooldownRemaining: 0,
    cooldownTotal: 0,
    cooldownPercent: 0,
    cdText: '',
    count: '',
    usable: true,
    outOfRange: false,
    queued: false,
    ariaLabel: kind,
    keybindLabel: '',
  };
}

function ringSlot(index: number): ActionBarSlotElements {
  const button = document.createElement('button');
  if (index === 0) button.id = 'mobile-action-attack';
  const label = document.createElement('span');
  const countEl = document.createElement('span');
  const keybindEl = document.createElement('span');
  const cdOverlay = document.createElement('span');
  const cdText = document.createElement('span');
  button.append(label, countEl, keybindEl, cdOverlay, cdText);
  return { btn: button, label, countEl, keybindEl, cdOverlay, cdText };
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  document.body.className = '';
  document.documentElement.style.removeProperty('--app-vw');
  document.documentElement.style.removeProperty('--app-vh');
});

describe.each(VIEWPORTS)('mobile Attack setting in $label', ({ width, height }) => {
  it('hides, persists, and restores the fixed Attack button through the Interface control', async () => {
    await page.viewport(width, height);
    document.body.className = 'mobile-touch game-active';
    document.documentElement.style.setProperty('--app-vw', `${width}px`);
    document.documentElement.style.setProperty('--app-vh', `${height}px`);

    let settings = new Settings();
    const interfaceControls = buildInterfaceControls({
      num: (key) => settings.get(key as NumericSettingKey),
      bool: (key) => settings.get(key as BoolSettingKey),
      range: (key) => SETTING_RANGES[key as NumericSettingKey],
    });
    const attackControl = interfaceControls.find(
      (control) => control.control === 'boolToggle' && control.key === 'showAttackButton',
    );
    expect(attackControl).toMatchObject({ control: 'boolToggle', on: true });

    const ring = document.createElement('div');
    ring.id = 'mobile-action-ring';
    const slots = Array.from({ length: 6 }, (_, index) => ringSlot(index));
    ring.append(...slots.map((entry) => entry.btn));
    const pageToggle = document.createElement('button');
    const pageIndicator = document.createElement('span');
    ring.append(pageToggle, pageIndicator);
    document.body.appendChild(ring);

    const painter = new MobileActionRingPainter(
      makeWriterFacet(
        new Map(),
        new Map(),
        new Map(),
        new Map(),
        () => {},
        () => {},
      ),
      { bar: { container: ring, slots }, pageToggle, pageIndicator },
      () => '',
      (key) => key,
    );
    const state: ActionBarState = {
      slots: [slot('attack'), ...Array.from({ length: 5 }, () => slot('empty'))],
      manySpells: false,
    };
    const paint = () => painter.paint(state, 0, 1, settings.get('showAttackButton'));

    const toggle = document.createElement('button');
    toggle.setAttribute('aria-label', 'Show Attack Button');
    toggle.addEventListener('click', () => {
      settings.set('showAttackButton', boolToggleNextValue(settings.get('showAttackButton')));
      paint();
    });
    document.body.appendChild(toggle);

    paint();
    const attack = slots[0].btn;
    expect(getComputedStyle(attack).display).toBe('flex');
    expect(attack.getBoundingClientRect().width).toBeGreaterThan(0);

    toggle.click();
    expect(settings.get('showAttackButton')).toBe(false);
    expect(getComputedStyle(attack).display).toBe('none');
    expect(attack.getBoundingClientRect().width).toBe(0);

    settings = new Settings();
    expect(settings.get('showAttackButton')).toBe(false);
    paint();
    expect(getComputedStyle(attack).display).toBe('none');

    toggle.click();
    expect(settings.get('showAttackButton')).toBe(true);
    expect(getComputedStyle(attack).display).toBe('flex');
    expect(attack.getBoundingClientRect().width).toBeGreaterThan(0);
  });
});
