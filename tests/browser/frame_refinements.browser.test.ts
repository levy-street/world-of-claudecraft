import { afterEach, describe, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import '../../src/styles/index.css';
import { FocusTargetsController } from '../../src/ui/focus_targets_controller';
import { HudFrameGroups } from '../../src/ui/hud_frame_groups';
import { registerHudFrames } from '../../src/ui/hud_frame_registry';
import { InterfaceUnlock } from '../../src/ui/interface_unlock';
import { HUD_FRAME_SPECS } from '../../src/ui/interface_unlock_core';
import { MovableFrame } from '../../src/ui/movable_frame';
import { OptionsWindow } from '../../src/ui/options_window';
import { OptionsWindowLayout } from '../../src/ui/options_window_layout';
import { makeWriterFacet } from '../../src/ui/painter_host';
import type { IWorld } from '../../src/world_api';
import { stubDeps } from './_harness';

afterEach(() => {
  document.body.innerHTML = '';
  document.body.className = '';
  for (const spec of HUD_FRAME_SPECS) localStorage.removeItem(spec.storageKey);
});
async function mount() {
  await page.viewport(1024, 768);
  document.body.className = 'game-active';
  document.documentElement.style.setProperty('--app-vw', '1024px');
  document.documentElement.style.setProperty('--app-vh', '768px');
  document.documentElement.style.setProperty('--ui-scale', '1');
  document.body.innerHTML = '<div id="ui"></div>';
}

describe('frame refinements', () => {
  it('centres actual menu navigation and its Back action at enlarged UI scale', async () => {
    await mount();
    document.documentElement.style.setProperty('--ui-scale', '1.25');
    const root = document.createElement('div');
    root.id = 'options-menu';
    root.className = 'window panel ui-window';
    root.style.display = 'none';
    document.getElementById('ui')!.appendChild(root);
    const win = new OptionsWindow(
      stubDeps({
        root: () => root,
        world: () =>
          ({ realm: 'Claudemoon', player: { name: 'Tester', pos: { x: 0, y: 0, z: 0 } } }) as never,
        options: () => null,
        auraOverlays: () => ({ setPlacement: () => {} }) as never,
        bugReport: () => null,
        captureFocus: () => null,
      }),
    );
    win.toggle();
    const before = root.getBoundingClientRect();
    await page.getByRole('button', { name: 'Interface', exact: true }).click();
    const after = root.getBoundingClientRect();
    expect(after.height).not.toBe(before.height);
    expect(after.left + after.width / 2).toBeCloseTo(before.left + before.width / 2, 0);
    expect(after.top + after.height / 2).toBeCloseTo(before.top + before.height / 2, 0);
    await page.getByRole('button', { name: 'Back', exact: true }).first().click();
    const back = root.getBoundingClientRect();
    expect(back.left).toBeCloseTo(before.left, 0);
    expect(back.top).toBeCloseTo(before.top, 0);
    win.toggle();
  });

  it('preserves existing frame tab stops through global locking', async () => {
    await mount();
    for (const tag of ['button', 'div']) {
      const frame = document.createElement(tag);
      document.getElementById('ui')!.appendChild(frame);
      const mover = new MovableFrame({
        frame,
        storageKey: 'test-tab-stop',
        isMobileLayout: () => false,
        unlockLabelKey: 'hudChrome.interfaceUnlock.unlockFrame',
        lockLabelKey: 'hudChrome.interfaceUnlock.lockFrame',
        draggingBodyClass: 'test-dragging',
        fallbackSize: { w: 200, h: 100 },
        globalLockOnly: true,
        frameLabelKey: 'hudChrome.focusTargets.frame1',
      });
      expect(frame.getAttribute('tabindex')).toBeNull();
      expect(frame.tabIndex).toBe(tag === 'button' ? 0 : -1);
      mover.setLockState(true);
      expect(frame.tabIndex).toBe(0);
      expect(frame.getAttribute('aria-label')).toBe('Focus 1');
      expect(frame.getAttribute('role')).toBe(tag === 'div' ? 'group' : null);
      expect(frame.querySelector('.tf-move-btn')).toBeNull();
      mover.setLockState(false);
      expect(frame.hasAttribute('aria-label')).toBe(false);
      expect(frame.hasAttribute('role')).toBe(false);
      expect(frame.getAttribute('tabindex')).toBeNull();
      expect(frame.tabIndex).toBe(tag === 'button' ? 0 : -1);
      mover.dispose();
    }
    const frame = document.createElement('div');
    frame.tabIndex = 0;
    document.getElementById('ui')!.appendChild(frame);
    const mover = new MovableFrame({
      frame,
      storageKey: 'test-unit-tab-stop',
      isMobileLayout: () => false,
      unlockLabelKey: 'hudChrome.interfaceUnlock.unlockFrame',
      lockLabelKey: 'hudChrome.interfaceUnlock.lockFrame',
      draggingBodyClass: 'test-dragging',
      fallbackSize: { w: 200, h: 100 },
      globalLockOnly: true,
    });
    mover.setLockState(true);
    mover.setLockState(false);
    expect(frame.tabIndex).toBe(0);
    mover.dispose();
  });
  it('keeps scaled menu centres aligned and clamps expansion at viewport edges', async () => {
    await mount();
    document.documentElement.style.setProperty('--ui-scale', '1.25');
    const el = document.createElement('div');
    el.style.cssText =
      'position:absolute;left:250px;top:200px;width:200px;height:200px;display:block';
    document.getElementById('ui')!.appendChild(el);
    const layout = new OptionsWindowLayout();
    layout.begin(el, 'main');
    const centre = layout.begin(el, 'interface');
    el.style.width = '500px';
    el.style.height = '350px';
    layout.finish(el, centre);
    const box = el.getBoundingClientRect();
    expect(box.left + box.width / 2).toBeCloseTo(centre!.x);
    expect(box.top + box.height / 2).toBeCloseTo(centre!.y);
    el.style.left = '0px';
    el.style.top = '0px';
    const corner = layout.begin(el, 'graphics');
    el.style.width = '600px';
    el.style.height = '450px';
    layout.finish(el, corner);
    expect(el.getBoundingClientRect().left).toBe(0);
    expect(el.getBoundingClientRect().top).toBe(0);
  });

  it('preserves the menu centre across larger and smaller panels, including dragged positions', async () => {
    await mount();
    const el = document.createElement('div');
    el.style.cssText =
      'position:absolute;left:300px;top:250px;width:200px;height:200px;display:block';
    document.getElementById('ui')!.appendChild(el);
    const layout = new OptionsWindowLayout();
    layout.begin(el, 'main');
    const centre = layout.begin(el, 'interface');
    el.style.width = '600px';
    el.style.height = '400px';
    layout.finish(el, centre);
    const box = el.getBoundingClientRect();
    expect(box.left + box.width / 2).toBe(400);
    expect(box.top + box.height / 2).toBe(350);
    const back = layout.begin(el, 'main');
    el.style.width = '200px';
    el.style.height = '200px';
    layout.finish(el, back);
    expect(el.getBoundingClientRect().left).toBe(300);
    expect(el.getBoundingClientRect().top).toBe(250);
  });

  it('drags from the meter body, resizes while locked and keeps the divider below pager buttons', async () => {
    await mount();
    document.getElementById('ui')!.innerHTML =
      '<div id="meters-window" class="panel mt-panel" style="display:block;left:100px;top:100px;width:400px;height:220px"><div class="panel-title"><button class="ui-disc">Previous</button><button class="ui-disc">Next</button></div><div class="mt-view">Threat</div><div class="mt-rows">No combat recorded yet.</div></div>';
    const registry = new InterfaceUnlock({ document });
    registerHudFrames({
      document,
      registry,
      groups: new HudFrameGroups(document, HUD_FRAME_SPECS),
      isMobileLayout: () => false,
      snapToGrid: () => false,
      labelKey: (row) => row.labelKey,
      isActive: () => true,
      onPositioned: () => {},
      options: () => null,
    });
    const panel = document.getElementById('meters-window')!;
    const title = panel.querySelector('.panel-title')!;
    expect(title.getBoundingClientRect().bottom).toBeGreaterThan(
      title.querySelector('button')!.getBoundingClientRect().bottom,
    );
    expect(panel.querySelector('.tf-move-btn')).toBeNull();
    const before = panel.getBoundingClientRect();
    panel.querySelector('.mt-rows')!.dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true,
        button: 0,
        pointerId: 11,
        clientX: before.left + 100,
        clientY: before.top + 100,
      }),
    );
    document.dispatchEvent(
      new PointerEvent('pointermove', {
        pointerId: 11,
        clientX: before.left + 140,
        clientY: before.top + 120,
      }),
    );
    document.dispatchEvent(new PointerEvent('pointerup', { pointerId: 11 }));
    expect(panel.getBoundingClientRect().left).toBeCloseTo(before.left + 40);
    const grip = panel.querySelector<HTMLElement>('.mf-resize-grip')!;
    expect(grip.hidden).toBe(false);
    expect(getComputedStyle(grip).display).not.toBe('none');
    const height = panel.getBoundingClientRect().height;
    grip.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(panel.getBoundingClientRect().height).toBeGreaterThan(height);
    for (const unlocked of [false, true]) {
      registry.setUnlocked(unlocked);
      const box = panel.getBoundingClientRect();
      grip.dispatchEvent(
        new PointerEvent('pointerdown', {
          bubbles: true,
          button: 0,
          pointerId: 12,
          clientX: box.right,
          clientY: box.bottom,
        }),
      );
      document.dispatchEvent(
        new PointerEvent('pointermove', {
          pointerId: 12,
          clientX: box.right + 30,
          clientY: box.bottom + 20,
        }),
      );
      document.dispatchEvent(new PointerEvent('pointerup', { pointerId: 12 }));
      expect(panel.getBoundingClientRect().width).toBeGreaterThan(box.width);
      expect(panel.getBoundingClientRect().height).toBeGreaterThan(box.height);
    }
    expect(panel.querySelector('.tf-move-btn')).toBeNull();
    panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(panel.getBoundingClientRect().left).toBeGreaterThan(before.left + 40);
  });

  it('shows target-style focus content and clears it through a locked-mode context menu', async () => {
    await mount();
    const world = {
      player: { targetId: 4 },
      entities: new Map([
        [
          4,
          {
            id: 4,
            kind: 'player',
            name: 'Focus Player',
            templateId: 'mage',
            level: 20,
            hp: 60,
            maxHp: 100,
            resourceType: 'mana',
            resource: 35,
            maxResource: 100,
            auras: [],
            dead: false,
          },
        ],
      ]),
      targetEntity: () => {},
      actionBarReadOnly: false,
    } as unknown as IWorld;
    const controller = new FocusTargetsController({
      document,
      world: () => world,
      showEmpty: () => true,
      keybinds: { primaryLabel: () => 'Ctrl+F1' },
      writers: makeWriterFacet(
        new WeakMap(),
        new WeakMap(),
        new WeakMap(),
        new WeakMap(),
        () => {},
        () => {},
      ),
    });
    const registry = new InterfaceUnlock({
      document,
      openFrameOptions: () => {},
      frameActions: (id) => controller.contextActions(id),
    });
    registerHudFrames({
      document,
      registry,
      groups: new HudFrameGroups(document, HUD_FRAME_SPECS),
      isMobileLayout: () => false,
      snapToGrid: () => false,
      labelKey: (row) => row.labelKey,
      isActive: () => true,
      onPositioned: () => {},
      options: () => null,
    });
    controller.action(0, true);
    const row = document.getElementById('focus-target-1')!;
    expect(getComputedStyle(row.querySelector('.focus-assign')!).display).toBe('none');
    expect(getComputedStyle(row.querySelector('.focus-target-hint')!).display).toBe('none');
    expect(row.querySelector('.uf-name')!.textContent).toBe('Focus Player');
    expect(row.querySelector('.portrait-wrap')).toBeNull();
    row.dispatchEvent(
      new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: 200,
        clientY: 250,
      }),
    );
    expect(document.getElementById('frame-context-menu')!.textContent).toBe('Unset Focus');
    const unset = page.getByRole('menuitem', { name: 'Unset Focus', exact: true });
    await unset.click();
    expect(document.activeElement).toBe(row.querySelector('.focus-assign'));
    expect(getComputedStyle(row.querySelector('.focus-assign')!).display).not.toBe('none');
    expect(getComputedStyle(row.querySelector('.focus-target-hint')!).display).not.toBe('none');
  });
});

it.each([1, 2])(
  'moves a fresh independent Target of Target with real pointer hit testing at scale %s',
  async (scale) => {
    await mount();
    document.documentElement.style.setProperty('--ui-scale', String(scale));
    const ui = document.getElementById('ui')!;
    ui.innerHTML =
      '<div id="target-frame" class="tf-unlocked" style="display:flex;left:20px;top:50px;position:absolute;width:200px;height:80px"><div id="totarget-frame" style="display:none"><span class="uf-name">Target of Target</span></div></div><div id="drag-destination" style="position:absolute;left:220px;top:250px;width:10px;height:10px;pointer-events:auto"></div>';
    const values: Record<string, boolean | number> = {
      moveTargetOfTargetIndependently: false,
      showTargetOfTarget: true,
    };
    const registry = new InterfaceUnlock({ document });
    const sync = registerHudFrames({
      document,
      registry,
      groups: new HudFrameGroups(document, HUD_FRAME_SPECS),
      isMobileLayout: () => false,
      snapToGrid: () => false,
      labelKey: (row) => row.labelKey,
      isActive: () => true,
      onPositioned: () => {},
      options: () => ({
        settings: { get: (key) => values[key], set: (key, value) => (values[key] = value) },
        onSettingChange: (key, value) => (values[key] = value),
      }),
    });
    sync();
    registry.setUnlocked(true);
    values.moveTargetOfTargetIndependently = true;
    sync();
    registry.refreshSettings();
    const tot = document.getElementById('totarget-frame')!;
    const target = document.getElementById('target-frame')!;
    expect(tot.parentElement).toBe(ui);
    expect(getComputedStyle(tot).display).not.toBe('none');
    const before = tot.getBoundingClientRect();
    expect(before.width).toBeGreaterThan(0);
    expect(before.right).toBeLessThanOrEqual(1024);
    const hit = document.elementFromPoint(
      before.left + before.width / 2,
      before.top + before.height / 2,
    );
    expect(hit === tot || tot.contains(hit)).toBe(true);
    const targetBefore = target.getBoundingClientRect();
    await userEvent.dragAndDrop(tot, document.getElementById('drag-destination')!);
    const after = tot.getBoundingClientRect();
    expect(Math.abs(after.left - before.left) + Math.abs(after.top - before.top)).toBeGreaterThan(
      10,
    );
    expect(target.getBoundingClientRect().left).toBe(targetBefore.left);
    expect(target.getBoundingClientRect().top).toBe(targetBefore.top);
    expect(localStorage.getItem('woc_hud_frame_target_of_target')).toBeTruthy();
    // Loading another preset replaces cached geometry immediately.
    localStorage.setItem(
      'woc_hud_frame_target_of_target',
      JSON.stringify({ left: 100, top: 120, vw: 1024, vh: 768 }),
    );
    registry.restoreSavedLayout();
    sync(true);
    registry.refreshSettings();
    expect(tot.getBoundingClientRect().left).toBeCloseTo(100);
    expect(tot.getBoundingClientRect().top).toBeCloseTo(120);
    localStorage.removeItem('woc_hud_frame_target_of_target');
    registry.restoreSavedLayout();
    sync(true);
    registry.refreshSettings();
    expect(tot.parentElement).toBe(ui);
    expect(getComputedStyle(tot).display).not.toBe('none');
    expect(tot.getBoundingClientRect().width).toBeGreaterThan(0);
    registry.setUnlocked(false);
    expect(tot.parentElement).toBe(ui);
    values.moveTargetOfTargetIndependently = false;
    sync();
    expect(tot.parentElement).toBe(target);
  },
);

it.each(['woc_party_frame_pos', 'woc_hud_frame_menu'])(
  'restores %s after startup dimensions settle without overwriting saved coordinates',
  async (storageKey) => {
    await mount();
    const saved = JSON.stringify({ left: 750, top: 500, vw: 1024, vh: 768 });
    localStorage.setItem(storageKey, saved);
    const frame = document.createElement('div');
    frame.style.cssText = 'position:absolute;width:600px;height:400px';
    document.getElementById('ui')!.appendChild(frame);
    const mover = new MovableFrame({
      frame,
      storageKey,
      observeSizeChanges: true,
      fallbackSize: { w: 600, h: 400 },
      isMobileLayout: () => false,
      unlockLabelKey: 'hudChrome.interfaceUnlock.unlockFrame',
      lockLabelKey: 'hudChrome.interfaceUnlock.lockFrame',
      draggingBodyClass: 'hud-frame-dragging',
      globalLockOnly: true,
    });
    expect(frame.getBoundingClientRect().left).toBeLessThan(750);
    frame.style.width = '180px';
    frame.style.height = '90px';
    await expect.poll(() => frame.getBoundingClientRect().left).toBe(750);
    expect(frame.getBoundingClientRect().top).toBe(500);
    expect(localStorage.getItem(storageKey)).toBe(saved);
    mover.dispose();
    frame.remove();
    localStorage.removeItem(storageKey);
  },
);

it('does not accumulate menu position drift after clamping, closing and reopening', async () => {
  await mount();
  const el = document.createElement('div');
  el.style.cssText = 'position:absolute;left:20px;top:20px;width:200px;height:200px;display:block';
  document.getElementById('ui')!.appendChild(el);
  const layout = new OptionsWindowLayout();
  layout.finish(el, layout.begin(el, 'main'));
  for (let i = 0; i < 3; i++) {
    const centre = layout.begin(el, 'interface');
    el.style.width = '700px';
    el.style.height = '650px';
    layout.finish(el, centre);
    expect(el.getBoundingClientRect().left).toBe(0);
    expect(Number(el.dataset.reqLeft)).toBe(0);
    el.style.display = 'none';
    const reopen = layout.begin(el, 'main');
    el.style.width = '200px';
    el.style.height = '200px';
    el.style.display = 'block';
    layout.finish(el, reopen);
    expect(el.getBoundingClientRect().left).toBe(20);
    expect(el.getBoundingClientRect().top).toBe(20);
  }
});

it('migrates legacy pet visibility and reclamps resized preset geometry immediately', async () => {
  await mount();
  const spec = HUD_FRAME_SPECS.find((row) => row.id === 'petFrame')!;
  const frame = document.createElement('div');
  frame.id = spec.elementId;
  frame.style.cssText = 'position:absolute;width:200px;height:60px';
  document.getElementById('ui')!.appendChild(frame);
  const saved = JSON.stringify({ left: 950, top: 700, scale: 1.4, vw: 1024, vh: 768 });
  localStorage.setItem(spec.storageKey, saved);
  localStorage.setItem(spec.storageKey + '_hidden', '1');
  let ready = false;
  const values: Record<string, number | boolean> = {
    showPetFrame: true,
    petFrameWidth: 200,
    petFrameHeight: 15,
  };
  const registry = new InterfaceUnlock({ document });
  const sync = registerHudFrames({
    document,
    registry,
    groups: new HudFrameGroups(document, HUD_FRAME_SPECS),
    isMobileLayout: () => false,
    snapToGrid: () => false,
    labelKey: (row) => row.labelKey,
    isActive: () => true,
    onPositioned: () => {},
    options: () =>
      ready
        ? {
            settings: { get: (key) => values[key], set: (key, value) => (values[key] = value) },
            onSettingChange: (key, value) => {
              values[key] = value;
              if (key === 'petFrameWidth') frame.style.width = `${value}px`;
              if (key === 'petFrameHeight') frame.style.height = `${Number(value) * 2}px`;
            },
          }
        : null,
  });
  expect(localStorage.getItem(spec.storageKey)).toBe(saved);
  ready = true;
  sync();
  expect(values.showPetFrame).toBe(false);
  expect(frame.classList.contains('tf-user-hidden')).toBe(false);
  expect(localStorage.getItem(spec.storageKey + '_hidden')).toBeNull();
  // Applying another old preset restores geometry before the migration settles.
  frame.style.width = '200px';
  localStorage.setItem(spec.storageKey, saved);
  registry.restoreSavedLayout();
  sync(true);
  expect(frame.getBoundingClientRect().right).toBeLessThanOrEqual(1024);
  expect(frame.getBoundingClientRect().bottom).toBeLessThanOrEqual(768);
  expect(JSON.parse(localStorage.getItem(spec.storageKey)!).scale).toBeUndefined();
});
