// @vitest-environment happy-dom
import { beforeAll, describe, expect, it, vi } from 'vitest';
import {
  dispatchTargetingAction,
  type TargetingWorld,
  targetingInputCallbacks,
} from '../src/game/targeting_actions';
import type { Entity } from '../src/sim/types';
import { FocusTargetsController } from '../src/ui/focus_targets_controller';
import { ensureLocaleLoaded, setLanguage } from '../src/ui/i18n';
import type { PainterHostWriters } from '../src/ui/painter_host';
import type { IWorld } from '../src/world_api';

beforeAll(async () => {
  await ensureLocaleLoaded('en');
  setLanguage('en');
});
describe('focus targets', () => {
  it('assigns by button, selects through the world, tolerates despawn and clears a slot', () => {
    const doc = document;
    doc.body.innerHTML = '<div id="ui"></div>';
    const root = doc.getElementById('ui')!;
    const mark = {
      id: 4,
      kind: 'player',
      name: 'Mark',
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
      targetEntity: vi.fn(),
    };
    const writers: PainterHostWriters = {
      setText: (el, text) => {
        if (el) el.textContent = text;
      },
      setDisplay: (el, value) => {
        if (el) el.style.display = value;
      },
      setTransform: vi.fn(),
      setWidth: vi.fn(),
      setStyleProp: (el, name, value) => {
        el?.style.setProperty(name, value);
      },
      setAttr: vi.fn(),
      toggleClass: (el, cls, on) => {
        el?.classList.toggle(cls, on);
      },
    };
    let showEmpty = true;
    let shortcut = 'Ctrl+F1';
    let assignShortcut = 'Shift+F1';
    const controller = new FocusTargetsController({
      document: doc as unknown as Document,
      world: () => world as unknown as IWorld,
      writers,
      keybinds: {
        primaryLabel: (id) =>
          id === 'targetFocus1' ? shortcut : id === 'setFocus1' ? assignShortcut : '',
      },
      showEmpty: () => showEmpty,
    });
    const rows = [...root.children[0].children] as HTMLElement[];
    const [assign, frame] = [...rows[0].children] as HTMLElement[];
    controller.update();
    expect(rows.map((row) => (row as unknown as HTMLElement).id)).toEqual([
      'focus-target-1',
      'focus-target-2',
      'focus-target-3',
    ]);
    expect(rows[0].children[2].textContent).toBe(
      'Select a target. Press Shift+F1 or click Set focus 1.',
    );
    expect(rows[0].querySelector('.focus-target-key')?.textContent).toBe('Shift+F1');
    assignShortcut = 'Alt+1';
    controller.update();
    expect(rows[0].children[2].textContent).toContain('Alt+1');
    expect(rows[0].querySelector('.focus-target-key')?.textContent).toBe('Alt+1');
    expect(rows[1].children[2].textContent).toBe('Select a target. Click Set focus 2.');
    expect(rows[0].classList.contains('focus-empty')).toBe(true);
    assign.focus();
    assign.dispatchEvent(new Event('click'));
    expect(doc.activeElement).toBe(frame);
    expect(rows[0].classList.contains('focus-empty')).toBe(false);
    expect(frame.querySelector('.uf-name')?.textContent).toBe('Mark');
    expect(rows[0].querySelector('.focus-target-key')?.textContent).toBe('Ctrl+F1');
    expect(rows[0].querySelector('.focus-target-reaction')?.textContent).toBe('Ally');
    expect(rows[0].classList.contains('focus-friendly')).toBe(true);
    Object.assign(world, { duelInfo: { state: 'active', otherPid: 4 } });
    controller.update();
    expect(rows[0].querySelector('.focus-target-reaction')?.textContent).toBe('Enemy');
    expect(rows[0].classList.contains('focus-hostile')).toBe(true);
    expect(rows[0].classList.contains('focus-friendly')).toBe(false);
    const pet = { ...mark, id: 5, kind: 'mob', ownerId: 4, hostile: false } as Entity;
    world.entities.set(5, pet);
    world.player.targetId = 5;
    controller.action(1, true);
    expect(rows[1].querySelector('.focus-target-reaction')?.textContent).toBe('Enemy');
    Object.assign(world, { duelInfo: null });
    controller.update();
    expect(rows[1].querySelector('.focus-target-reaction')?.textContent).toBe('Ally');
    pet.ownerId = null;
    pet.hostile = true;
    controller.update();
    expect(rows[1].querySelector('.focus-target-reaction')?.textContent).toBe('Enemy');
    controller.clear(1);
    shortcut = 'Alt+2';
    showEmpty = false;
    controller.update();
    expect(rows[0].querySelector('.focus-target-key')?.textContent).toBe('Alt+2');
    expect(rows[0].classList.contains('focus-hide-empty')).toBe(true);
    showEmpty = true;
    world.player.targetId = 4;
    expect(assign.style.display).toBe('none');
    expect((rows[0].children[2] as HTMLElement).style.display).toBe('none');
    rows[0].dispatchEvent(new Event('mouseenter'));
    expect(controller.hoveredEntityId).toBe(4);
    expect(controller.castTarget({ requiresTarget: true }, null, true)).toBeNull();
    expect(
      controller.castTarget({ requiresTarget: true, targetType: 'friendly' }, null, true),
    ).toBe(4);
    expect(controller.castTarget({ requiresTarget: true }, null, false)).toBeNull();
    rows[0].dispatchEvent(new Event('mouseleave'));
    expect(controller.hoveredEntityId).toBeNull();
    rows[0].dispatchEvent(new Event('mouseenter'));
    expect(controller.contextActions('focusTarget1')).toHaveLength(1);
    frame.dispatchEvent(new Event('click'));
    expect(world.targetEntity).toHaveBeenLastCalledWith(4);
    world.targetEntity.mockClear();
    world.entities.clear();
    controller.action(0, false);
    expect(world.targetEntity).not.toHaveBeenCalled();
    world.entities.set(4, mark);
    controller.action(0, false);
    expect(world.targetEntity).toHaveBeenCalledWith(4);
    frame.focus();
    controller.contextActions('focusTarget1')[0].run();
    expect(doc.activeElement).toBe(assign);
    expect(rows[0].querySelector('.focus-target-key')?.textContent).toBe('Alt+1');
    expect(rows[0].children[2].textContent).toContain('Alt+1');
    expect(controller.hoveredEntityId).toBeNull();
    expect(assign.style.display).not.toBe('none');
    controller.update();
    expect(rows[0].classList.contains('focus-empty')).toBe(true);
    const textWrites = vi.spyOn(writers, 'setText');
    controller.update(100, 100);
    expect(textWrites).not.toHaveBeenCalled();
    controller.action(0, true);
    textWrites.mockClear();
    controller.update(10, 100);
    expect(textWrites).not.toHaveBeenCalled();
    controller.update(100, 100);
    expect(textWrites).toHaveBeenCalled();
    world.actionBarReadOnly = true;
    controller.reset();
    world.actionBarReadOnly = false;
    world.targetEntity.mockClear();
    controller.action(0, false);
    expect(world.targetEntity).not.toHaveBeenCalled();
    expect(controller.contextActions('focusTarget1')).toHaveLength(0);
    world.actionBarReadOnly = true;
    assign.dispatchEvent(new Event('click'));
    controller.update();
    expect(rows[0].classList.contains('focus-empty')).toBe(true);
  });
  it('routes keyboard and controller focus actions to the same HUD callback', () => {
    const hud = { targetOwnPet: vi.fn(), focusTarget: vi.fn() };
    const world = {} as TargetingWorld;
    for (let slot = 0; slot < 3; slot++) {
      targetingInputCallbacks(world, hud, undefined).onFocusTarget?.(slot, true);
      expect(hud.focusTarget).toHaveBeenLastCalledWith(slot, true);
      expect(dispatchTargetingAction('targetFocus' + (slot + 1), world, hud, undefined)).toBe(true);
      expect(hud.focusTarget).toHaveBeenLastCalledWith(slot, false);
    }
  });
});
