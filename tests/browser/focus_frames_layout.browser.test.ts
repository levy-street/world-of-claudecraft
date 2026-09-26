import { afterEach, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import '../../src/styles/index.css';
import type { Entity } from '../../src/sim/types';
import { FocusTargetsController } from '../../src/ui/focus_targets_controller';
import { makeUiRootDetacher } from '../../src/ui/interface_unlock';
import { HUD_FRAME_SPECS } from '../../src/ui/interface_unlock_core';
import { MovableFrame } from '../../src/ui/movable_frame';
import { makeWriterFacet } from '../../src/ui/painter_host';
import type { IWorld } from '../../src/world_api';

const movers: MovableFrame[] = [];
afterEach(() => {
  for (const mover of movers.splice(0)) mover.dispose();
  document.body.innerHTML = '';
  document.body.className = '';
  for (const name of ['--app-vw', '--app-vh', '--ui-scale'])
    document.documentElement.style.removeProperty(name);
  for (const spec of HUD_FRAME_SPECS.filter((spec) => spec.id.startsWith('focusTarget')))
    localStorage.removeItem(spec.storageKey);
});

async function mount(
  width: number,
  height: number,
  mobile: boolean,
  populate = true,
  showEmpty = () => false,
) {
  await page.viewport(width, height);
  document.body.className = mobile ? 'mobile-touch game-active' : 'game-active';
  document.documentElement.style.setProperty('--app-vw', width + 'px');
  document.documentElement.style.setProperty('--app-vh', height + 'px');
  document.documentElement.style.setProperty('--ui-scale', '1');
  document.body.innerHTML = '<div id="ui"></div>';
  const mark = {
    id: 4,
    kind: 'player',
    name: 'Focus Target',
    templateId: 'mage',
    level: 20,
    hp: 60,
    maxHp: 100,
    resourceType: 'mana',
    resource: 35,
    maxResource: 100,
    auras: [],
    dead: false,
  } as unknown as Entity;
  const world = {
    player: { targetId: 4 },
    actionBarReadOnly: false,
    entities: new Map([[4, mark]]),
    targetEntity: () => {},
  } as unknown as IWorld;
  const controller = new FocusTargetsController({
    document,
    showEmpty,
    world: () => world,
    keybinds: { primaryLabel: (id) => (id.startsWith('set') ? 'Shift+F' : 'Ctrl+F') + id.at(-1) },
    writers: makeWriterFacet(
      new WeakMap(),
      new WeakMap(),
      new WeakMap(),
      new WeakMap(),
      () => {},
      () => {},
    ),
  });
  if (populate) for (let slot = 0; slot < 3; slot++) controller.action(slot, true);
  else controller.update();
  return { rows: [...document.querySelectorAll<HTMLElement>('.focus-target-row')], controller };
}

describe('independent focus frame layout', () => {
  it('hides empty frames by default, reveals them for editing or the setting, and shows assigned focus', async () => {
    let showEmpty = false;
    const { rows, controller } = await mount(1024, 600, false, false, () => showEmpty);
    expect(rows.every((row) => getComputedStyle(row).display === 'none')).toBe(true);
    expect(rows[0].querySelector('.focus-target-key')?.textContent).toBe('Shift+F1');
    expect(rows[0].querySelector('.focus-target-hint')?.textContent).toBe(
      'Select a target. Press Shift+F1 or click Set focus 1.',
    );
    rows[0].classList.add('tf-unlocked');
    expect(getComputedStyle(rows[0]).display).not.toBe('none');
    rows[0].classList.remove('tf-unlocked');
    showEmpty = true;
    controller.update();
    expect(rows.every((row) => getComputedStyle(row).display !== 'none')).toBe(true);
    showEmpty = false;
    controller.action(0, true);
    expect(rows[0].querySelector('.focus-target-key')?.textContent).toBe('Ctrl+F1');
    expect(getComputedStyle(rows[0]).display).not.toBe('none');
    expect(getComputedStyle(rows[1]).display).toBe('none');
    controller.clear(0);
    expect(getComputedStyle(rows[0]).display).toBe('none');
  });
  it.each([
    [844, 390, true],
    [667, 375, true],
    [1024, 600, false],
  ] as const)(
    'keeps all populated focus controls inside %ix%i (mobile=%s)',
    async (width, height, mobile) => {
      const { rows } = await mount(width, height, mobile);
      for (const row of rows) {
        const box = row.getBoundingClientRect();
        expect(box.width).toBeGreaterThan(0);
        expect(box.left).toBeGreaterThanOrEqual(0);
        expect(box.right).toBeLessThanOrEqual(width);
        expect(box.top).toBeGreaterThanOrEqual(0);
        expect(box.bottom).toBeLessThanOrEqual(height);
        const key = row.querySelector<HTMLElement>('.focus-target-key')!;
        const keyBox = key.getBoundingClientRect();
        expect(key.textContent).toContain('Ctrl+F');
        expect(keyBox.left).toBeGreaterThanOrEqual(box.left);
        expect(keyBox.right).toBeLessThanOrEqual(box.right);
        expect(keyBox.bottom).toBeLessThanOrEqual(
          row.querySelector('.uf-name-header')!.getBoundingClientRect().top,
        );
        expect(row.querySelector('.focus-target-reaction')!.textContent).toBe('Ally');
      }
      expect(rows[0].getBoundingClientRect().right).toBeLessThanOrEqual(
        rows[1].getBoundingClientRect().left,
      );
      expect(rows[1].getBoundingClientRect().right).toBeLessThanOrEqual(
        rows[2].getBoundingClientRect().left,
      );
    },
  );

  it('moves one focus without moving its siblings in a short desktop viewport', async () => {
    const { rows } = await mount(1024, 600, false);
    const before = rows.map((row) => row.getBoundingClientRect().toJSON());
    const spec = HUD_FRAME_SPECS.find((entry) => entry.id === 'focusTarget1')!;
    const mover = new MovableFrame({
      frame: rows[0],
      storageKey: spec.storageKey,
      unlockLabelKey: 'hudChrome.interfaceUnlock.unlockFrame',
      lockLabelKey: 'hudChrome.interfaceUnlock.lockFrame',
      draggingBodyClass: 'hud-frame-dragging',
      fallbackSize: spec.fallbackSize,
      isMobileLayout: () => false,
      onPositioned: makeUiRootDetacher(document, spec, rows[0]),
    });
    movers.push(mover);
    mover.setLockState(true);
    rows[0]
      .querySelector('button.tf-move-btn')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(rows[0].getBoundingClientRect().left).toBeGreaterThan(before[0].left);
    expect(rows[0].getBoundingClientRect().top).toBe(before[0].top);
    expect(rows[1].getBoundingClientRect().toJSON()).toEqual(before[1]);
    expect(rows[2].getBoundingClientRect().toJSON()).toEqual(before[2]);
  });
});
