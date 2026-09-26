import { afterEach, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import '../../src/styles/index.css';
import { Settings } from '../../src/game/settings';
import { FocusManager } from '../../src/ui/focus_manager';
import { FrameContextMenu } from '../../src/ui/frame_context_menu';
import { frameEditorMenuDeps } from '../../src/ui/frame_editor_deps';
import { FramePresets } from '../../src/ui/frame_presets';
import { renderFramePresets } from '../../src/ui/frame_presets_controls';
import { ChatGeometryController } from '../../src/ui/hud/chat/chat_geometry_controller';
import { InterfaceUnlock } from '../../src/ui/interface_unlock';
import { OptionsFrameSections } from '../../src/ui/options_frame_settings';
import { OptionsWindow } from '../../src/ui/options_window';
import { dropPointerFocus } from '../../src/ui/pointer_blur';
import { ThemeStore } from '../../src/ui/theme';
import { stubDeps } from './_harness';

afterEach(() => {
  document.body.innerHTML = '';
  document.body.className = '';
  for (const name of ['--app-vw', '--app-vh', '--ui-scale'])
    document.documentElement.style.removeProperty(name);
  localStorage.removeItem('woc_chat_geometry');
});

async function mount(width: number, height: number, scale = 1) {
  await page.viewport(width, height);
  document.body.className = 'game-active';
  document.documentElement.style.setProperty('--app-vw', width + 'px');
  document.documentElement.style.setProperty('--app-vh', height + 'px');
  document.documentElement.style.setProperty('--ui-scale', String(scale));
  document.body.innerHTML = '<div id="ui"></div>';
}

describe('frame menu layout and keyboard navigation', () => {
  it.each([1, 1.4, 2])('keeps the context menu inside the viewport at scale %s', async (scale) => {
    await mount(1024, 600, scale);
    const element = document.createElement('button');
    element.textContent = 'Frame';
    document.getElementById('ui')!.appendChild(element);
    let active = true;
    const menu = new FrameContextMenu({
      document,
      targets: () => [
        { id: 'test', element, label: () => 'Frame', isActive: () => true, resetSize: () => {} },
      ],
      unlocked: () => active,
      options: () => {},
    });
    element.dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, clientX: 1020, clientY: 595 }),
    );
    const bounds = document.getElementById('frame-context-menu')!.getBoundingClientRect();
    expect(bounds.width).toBeGreaterThan(50);
    expect(bounds.left).toBeGreaterThanOrEqual(0);
    expect(bounds.right).toBeLessThanOrEqual(1024);
    expect(bounds.bottom).toBeLessThanOrEqual(600);
    active = false;
    menu.close();
  });

  it('wraps narrow Interface settings and includes the party disclosure in the game focus trap', async () => {
    await mount(390, 844);
    document.body.classList.add('mobile-touch');
    const body = document.createElement('div');
    body.id = 'options-menu';
    body.style.cssText =
      'display:block;transform:none;color:var(--color-text-primary);width:350px;position:absolute;left:10px;top:10px;max-height:800px;overflow:auto';
    document.getElementById('ui')!.appendChild(body);
    new OptionsFrameSections().render(
      body,
      [
        {
          control: 'boolToggle',
          key: 'partyFrameShowPets',
          labelKey: 'hudChrome.partyFrames.optionsSection',
          on: true,
        },
      ],
      { settings: { get: () => false, set: (_key, value) => value }, onSettingChange: () => {} },
      null,
      () => {},
      () => {},
    );
    const label = body.querySelector('[data-focus-key="moveTargetOfTargetIndependently"]')!
      .parentElement!;
    expect(label.scrollWidth).toBeLessThanOrEqual(label.clientWidth);
    expect(label.getBoundingClientRect().height).toBeGreaterThanOrEqual(40);
    const party = body.querySelector<HTMLDetailsElement>('.interface-party-options')!;
    const summary = party.querySelector('summary')!;
    expect(summary.getBoundingClientRect().height).toBeGreaterThanOrEqual(40);
    const focus = new FocusManager();
    const trap = focus.open({ root: () => body });
    trap.focusFirst();
    await expect.poll(() => document.activeElement !== document.body).toBe(true);
    for (let i = 0; i < 45 && document.activeElement !== summary; i++)
      document.activeElement!.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }),
      );
    expect(document.activeElement).toBe(summary);
    expect(party.open).toBe(false);
    await page.getByText('Party Frame Options', { exact: true }).click();
    expect(party.open).toBe(true);
    trap.release(false);
  });

  it('resets chat dimensions while retaining its saved location', async () => {
    await mount(1280, 720);
    document.getElementById('ui')!.innerHTML =
      '<div id="chatlog-wrap"><div id="chatlog-tabs"></div><div id="chatlog-frame"></div></div><input id="chat-input">';
    localStorage.setItem(
      'woc_chat_geometry',
      JSON.stringify({ left: 80, top: 60, width: 650, height: 260 }),
    );
    const controller = new ChatGeometryController({
      document,
      window,
      storage: localStorage,
      isMobileLayout: () => false,
      hasStorePromoCard: () => false,
      uiScale: () => 1,
    });
    controller.init();
    const wrap = document.getElementById('chatlog-wrap')!;
    const before = wrap.getBoundingClientRect();
    controller.resetSize();
    const after = wrap.getBoundingClientRect();
    expect(after.left).toBe(before.left);
    expect(after.top).toBe(before.top);
    expect(after.width).toBeLessThan(before.width);
    const saved = JSON.parse(localStorage.getItem('woc_chat_geometry')!);
    expect(saved.left).toBe(before.left);
    expect(saved.width).toBe(after.width);
  });
});

it.each([1, 2])(
  'keeps the complete floating Frames Settings menu readable and in view at scale %s',
  async (scale) => {
    await mount(1280, 900, scale);
    const settings = new Settings();
    const registry = new InterfaceUnlock({
      document,
      ...frameEditorMenuDeps(
        () => ({ settings, onSettingChange: () => {} }),
        () => {},
      ),
    });
    registry.setUnlocked(true);
    document.getElementById('interface-frames-toggle')!.click();
    const menu = document.getElementById('interface-frames-menu')!;
    const box = menu.getBoundingClientRect();
    expect(box.left).toBeGreaterThanOrEqual(0);
    expect(box.right).toBeLessThanOrEqual(1280);
    expect(box.bottom).toBeLessThanOrEqual(900);
    expect(menu.querySelector('.frame-preset-loadouts')).toBeNull();
    expect(menu.querySelector('input[type="checkbox"]')).toBeTruthy();
    expect(menu.querySelector('[data-focus-key="showTargetOfTarget"]')).toBeTruthy();
    registry.setUnlocked(false);
  },
);

it.each([
  [1280, 900, 1],
  [1280, 900, 2],
  [390, 844, 1],
  [844, 390, 1],
])(
  'keeps talent-style frame loadouts accessible at %sx%s and scale %s',
  async (width, height, scale) => {
    await mount(width, height, scale);
    const host = document.createElement('div');
    host.style.cssText = `position:absolute;left:8px;top:8px;width:${Math.min(680, width / scale - 16)}px`;
    document.getElementById('ui')!.appendChild(host);
    const store = new FramePresets(localStorage);
    for (let index = 0; index < 10; index++) store.save(index, `Layout ${index + 1}`);
    const dispose = renderFramePresets(host, {
      inputDialog: () => {},
      confirmDialog: () => {},
      applyFramePreset: () => {},
    });
    const picker = host.querySelector<HTMLButtonElement>('.tal-loadout-btn')!;
    await page.getByRole('button', { name: 'Frame Presets: Layout 10', exact: true }).click();
    const menu = host.querySelector<HTMLElement>('[role="menu"]')!;
    const box = menu.getBoundingClientRect();
    expect(box.left).toBeGreaterThanOrEqual(0);
    expect(box.right).toBeLessThanOrEqual(width);
    expect(box.bottom).toBeLessThanOrEqual(height);
    expect(menu.scrollHeight).toBeGreaterThan(menu.clientHeight);
    expect(menu.querySelectorAll('.tal-lo-pick')).toHaveLength(10);
    menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    expect(document.activeElement?.textContent).toBe('Layout 10');
    menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.activeElement).toBe(picker);
    expect(host.querySelector('[role="menu"]')).toBeNull();
    dispose();
    localStorage.removeItem('woc_frame_presets_v1');
  },
);

it('opens presets under real game mouse-focus cleanup and preserves Interface scroll on a settings rebuild', async () => {
  await mount(1280, 720);
  localStorage.clear();
  const root = document.createElement('div');
  root.id = 'options-menu';
  root.className = 'window panel ui-window';
  root.style.display = 'none';
  document.getElementById('ui')!.appendChild(root);
  const settings = new Settings();
  const win = new OptionsWindow(
    stubDeps({
      root: () => root,
      world: () =>
        ({ realm: 'Claudemoon', player: { name: 'Tester', pos: { x: 0, y: 0, z: 0 } } }) as never,
      options: () =>
        stubDeps({
          settings,
          theme: new ThemeStore(),
          onSettingChange: () => {},
          perfOverlay: { setPlacement: () => {} } as never,
        }),
      auraOverlays: () => ({ setPlacement: () => {} }) as never,
      bugReport: () => null,
      captureFocus: () => null,
      buildDropdown: () => {
        const el = document.createElement('div');
        const button = document.createElement('button');
        button.className = 'ui-dd-btn';
        el.appendChild(button);
        return el;
      },
    }),
  );
  // Input.releaseMouseActivatedFocus parks mouse-activated buttons on their dialog root.
  const release = (event: MouseEvent) => {
    if (event.detail && document.activeElement instanceof HTMLButtonElement)
      dropPointerFocus(document.activeElement);
  };
  window.addEventListener('click', release);
  try {
    win.toggle();
    win.openFrameOptions('targetFrame');
    await page.getByRole('button', { name: 'All Frame Options', exact: true }).click();
    expect(root.querySelector('[data-focus-key="playerFrameHealthText:0"]')).toBeNull();
    expect(root.querySelector('[data-focus-key="targetFrameHealthText:0"]')).toBeNull();
    const picker = root.querySelector<HTMLButtonElement>('.tal-loadout-btn')!;
    await page.getByRole('button', { name: 'Frame Presets: Current Layout', exact: true }).click();
    expect(picker.getAttribute('aria-expanded')).toBe('true');
    const menu = root.querySelector<HTMLElement>('.tal-loadout-menu')!;
    expect(menu).toBeTruthy();
    expect(menu.querySelectorAll('button')).toHaveLength(0);
    expect(menu.textContent).toBe('No saved presets');
    expect([...root.querySelectorAll('[data-preset-action]')].map((el) => el.textContent)).toEqual([
      'Apply',
      'Save',
      'New Preset',
      'Delete',
      'Import',
      'Export',
    ]);
    const actionBox = root.querySelector('.frame-preset-actions')!.getBoundingClientRect();
    expect(actionBox.left).toBeGreaterThanOrEqual(picker.getBoundingClientRect().right);
    expect(root.querySelector<HTMLButtonElement>('[data-preset-action="delete"]')!.disabled).toBe(
      true,
    );
    const clip = root.querySelector<HTMLElement>('.ui-win-body')!;
    expect(menu.getBoundingClientRect().bottom).toBeLessThanOrEqual(
      clip.getBoundingClientRect().bottom,
    );
    picker.click();
    clip.scrollTop = 250;
    const before = clip.scrollTop;
    expect(before).toBeGreaterThan(0);
    root.querySelector<HTMLButtonElement>('[data-setting-key="aurasOnPlayerFrame"]')!.click();
    expect(root.querySelector('.ui-win-body')!.scrollTop).toBeCloseTo(before, 0);
    root.style.left = '80px';
    root.style.top = '15px';
    const moved = root.getBoundingClientRect();
    win.close();
    win.toggle();
    const reopened = root.getBoundingClientRect();
    expect(reopened.left + reopened.width / 2).toBeCloseTo(moved.left + moved.width / 2, 0);
    expect(reopened.top + reopened.height / 2).toBeCloseTo(moved.top + moved.height / 2, 0);
    win.openFrameOptions('targetFrame');
    await page.getByRole('tab', { name: 'General', exact: true }).click();
    expect(root.querySelector('[data-focus-key="playerFrameHealthText:0"]')).not.toBeNull();
    expect(root.querySelector('[data-focus-key="targetFrameHealthText:0"]')).not.toBeNull();
    win.close();
  } finally {
    window.removeEventListener('click', release);
  }
});

it('keeps the floating settings menu at its scroll position after changing a setting', async () => {
  await mount(1024, 600, 2);
  const settings = new Settings();
  const registry = new InterfaceUnlock({
    document,
    ...frameEditorMenuDeps(
      () => ({ settings, onSettingChange: () => {} }),
      () => {},
    ),
  });
  registry.setUnlocked(true);
  document.getElementById('interface-frames-toggle')!.click();
  const menu = document.getElementById('interface-frames-menu')!;
  menu.scrollTop = 180;
  const before = menu.scrollTop;
  expect(before).toBeGreaterThan(0);
  menu.querySelector<HTMLInputElement>('[data-focus-key="showTargetSwingTimer"]')!.click();
  expect(menu.scrollTop).toBe(before);
  registry.setUnlocked(false);
});
