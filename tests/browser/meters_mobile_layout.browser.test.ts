import { afterEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import entry from '../../index.html?raw';
import type { SimEvent } from '../../src/sim/types';
import { MeterData, MetersPanel } from '../../src/ui/meters';
import { DEFAULT_METERS_SETTINGS } from '../../src/ui/meters_settings';
import { resolveMobileHudLayout } from '../../src/ui/mobile_hud_layout';
import type { IWorld } from '../../src/world_api';
import '../../src/styles/index.css';

const profiles = [
  { name: 'landscape', width: 844, height: 390, ui: 1, meter: 100 },
  { name: 'short', width: 667, height: 375, ui: 1, meter: 100 },
  { name: 'small-ui', width: 844, height: 390, ui: 0.75, meter: 150 },
  { name: 'large-ui', width: 844, height: 390, ui: 1.4, meter: 200 },
  { name: 'left-handed', width: 844, height: 390, ui: 1, meter: 100, left: true },
  { name: 'portrait', width: 390, height: 844, ui: 1, meter: 100 },
] as const;

async function mount(
  profile: { width: number; height: number; ui: number; meter: number; left?: boolean },
  count = 1,
  mobile = true,
) {
  await page.viewport(profile.width, profile.height);
  const tier = resolveMobileHudLayout({
    width: profile.width,
    height: profile.height,
    safeAreaTop: 0,
    safeAreaRight: 0,
    safeAreaBottom: 0,
    safeAreaLeft: 0,
    touchMode: mobile,
    menuOpen: false,
    chatOpen: false,
  });
  document.body.className = mobile
    ? `mobile-touch game-active ${tier.classes.join(' ')} ${profile.left ? 'mobile-left-handed' : ''}`
    : 'game-active';
  for (const [key, value] of Object.entries({
    '--app-vw': `${profile.width}px`,
    '--app-vh': `${profile.height}px`,
    '--ui-scale': String(profile.ui),
  }))
    document.documentElement.style.setProperty(key, value);
  const source = new DOMParser().parseFromString(entry, 'text/html');
  const ui = document.createElement('div');
  ui.id = 'ui';
  ui.style.zoom = String(profile.ui);
  const root = source
    .querySelector<HTMLTemplateElement>('#game-ui-template')!
    .content.querySelector<HTMLElement>('#meters-window')!;
  ui.append(root);
  document.body.append(ui);
  document.body.append(source.querySelector('#mobile-controls')!);
  const entities = new Map();
  for (let id = 1; id <= count; id++)
    entities.set(id, {
      id,
      kind: 'player',
      name: id === 1 ? 'Vareck Christos' : `Player ${id}`,
      templateId: 'warrior',
      threat: new Map(),
    });
  entities.set(51, {
    id: 51,
    kind: 'mob',
    name: 'Training Dummy',
    templateId: 'forest_wolf',
    maxHp: 10000,
    threat: new Map(),
    dead: false,
  });
  const world = {
    entities,
    player: entities.get(1),
    partyInfo: {
      leader: 1,
      raid: false,
      members: [...entities.values()]
        .filter((e) => e.kind === 'player' && e.id !== 1)
        .map((e) => ({ pid: e.id, name: e.name, cls: 'warrior', group: 1 })),
    },
  } as unknown as IWorld;
  const data = new MeterData(0);
  for (let id = 1; id <= count; id++)
    data.onEvent(
      {
        type: 'damage',
        sourceId: id,
        targetId: 51,
        amount: 100 + id,
        ability: 'heroic_strike',
        crit: false,
        school: 'physical',
        kind: 'hit',
      } as SimEvent,
      world,
      new Set(entities.keys()),
      1000,
    );
  const host = {
    world,
    data,
    petsByOwner: () => new Map(),
    partyPids: () => new Set(entities.keys()),
    attachTooltip: () => {},
    onDock: () => {},
    isDetached: () => false,
    openTabMenu: () => {},
    openMenu: vi.fn(),
    resetCurrent: vi.fn(),
    resetAll: vi.fn(),
    getSettings: () => ({ ...DEFAULT_METERS_SETTINGS, windowScale: profile.meter }),
  };
  const panel = new MetersPanel({ root, lockedTab: null }, host);
  panel.setOpen(true);
  return { root, panel, host, controls: document.querySelector<HTMLElement>('#mobile-controls')! };
}
function overlaps(a: DOMRect, b: DOMRect) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}
afterEach(() => {
  document.body.innerHTML = '';
  document.body.className = '';
  for (const key of ['--app-vw', '--app-vh', '--ui-scale'])
    document.documentElement.style.removeProperty(key);
});

describe('mobile meter layout', () => {
  for (const profile of profiles)
    it(`${profile.name}: compact readable chrome clears movement and Actions`, async () => {
      const { root } = await mount(profile);
      const capture = import.meta.env.VITE_METER_CAPTURE;
      if (capture && ['landscape', 'portrait', 'left-handed'].includes(profile.name))
        await page.screenshot({
          path: `../../docs/screenshots/mobile-meter/${capture}-${profile.name}.png`,
        });
      const rect = root.getBoundingClientRect();
      expect(rect.left).toBeGreaterThanOrEqual(0);
      expect(rect.right).toBeLessThanOrEqual(profile.width);
      expect(rect.top).toBeGreaterThanOrEqual(0);
      expect(rect.bottom).toBeLessThanOrEqual(profile.height);
      expect(rect.width).toBeLessThanOrEqual(200);
      for (const selector of ['#mobile-move-joystick', '#mobile-menu-anchor'])
        expect(
          overlaps(rect, document.querySelector(selector)!.getBoundingClientRect()),
          selector,
        ).toBe(false);
      for (const selector of ['.mt-mode-trigger', '.mt-mobile-tools', '.mt-close']) {
        const button = root.querySelector<HTMLElement>(selector)!;
        expect(button, selector).not.toBeNull();
        const target = button.getBoundingClientRect();
        expect(target.width, selector).toBeGreaterThanOrEqual(40);
        expect(target.height, selector).toBeGreaterThanOrEqual(40);
        const header = root.querySelector('.panel-title')!.getBoundingClientRect();
        expect(target.top).toBeGreaterThanOrEqual(header.top);
        expect(target.bottom).toBeLessThanOrEqual(header.bottom + 1);
      }
      expect(root.scrollHeight).toBeLessThanOrEqual(root.clientHeight + 1);
    });
  it('keeps large groups scrollable without a fixed empty-height panel', async () => {
    const one = await mount(profiles[0]);
    const oneHeight = one.root.getBoundingClientRect().height;
    document.body.innerHTML = '';
    const many = await mount(profiles[0], 10);
    const rows = many.root.querySelector<HTMLElement>('.mt-rows')!;
    expect(rows.scrollHeight).toBeGreaterThan(rows.clientHeight);
    expect(many.root.querySelectorAll('.mt-row').length).toBeGreaterThanOrEqual(10);
    expect(oneHeight).toBeLessThan(many.root.getBoundingClientRect().height);
    expect(many.root.getBoundingClientRect().height).toBeLessThanOrEqual(200);
  });
  it('keeps player drilldown, back, and close usable inside the compact header', async () => {
    const { root, panel } = await mount(profiles[0]);
    panel.selectPlayer(1);
    expect(panel.getSelectedPid()).toBe(1);
    const back = root.querySelector<HTMLButtonElement>('.mt-back-btn')!;
    const header = root.querySelector('.panel-title')!.getBoundingClientRect();
    const rect = back.getBoundingClientRect();
    expect(rect.width).toBeGreaterThanOrEqual(40);
    expect(rect.height).toBeGreaterThanOrEqual(40);
    expect(rect.right).toBeLessThanOrEqual(header.right);
    back.click();
    expect(panel.getSelectedPid()).toBeNull();
    root.querySelector<HTMLButtonElement>('.mt-close')!.click();
    expect(getComputedStyle(root).display).toBe('none');
  });
  it('keeps desktop chrome and saved meter scale unchanged', async () => {
    const { root } = await mount({ width: 1280, height: 800, ui: 1, meter: 150 }, 1, false);
    if (import.meta.env.VITE_METER_CAPTURE)
      await page.screenshot({
        path: `../../docs/screenshots/mobile-meter/${import.meta.env.VITE_METER_CAPTURE}-desktop.png`,
      });
    expect(getComputedStyle(root).zoom).toBe('1.5');
    expect(root.querySelector('.mt-new-window')!.getBoundingClientRect().width).toBeGreaterThan(0);
  });
});
