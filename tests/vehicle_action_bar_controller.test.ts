// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { GLIDER_QUEST_ID } from '../src/sim/content/world_quest_glider';
import { createCannonEncounter } from '../src/sim/minigames/cannon_encounter';
import { applyGliderBoost } from '../src/sim/minigames/glider_boost';
import { createGliderFlightState } from '../src/sim/minigames/glider_flight';
import type { VehicleSession, WorldQuestProgress } from '../src/sim/types';
import {
  GLIDER_PITCH_TAP_MS,
  VehicleActionBarController,
} from '../src/ui/hud/vehicle/vehicle_action_bar_controller';
import { makeWriterFacet } from '../src/ui/painter_host';

vi.mock('../src/ui/icons', () => ({ iconDataUrl: (_kind: string, key: string) => `/${key}.webp` }));
vi.mock('../src/game/sfx', () => ({ sfx: { preload: vi.fn(), playUi: vi.fn() } }));

afterEach(() => {
  document.body.replaceChildren();
  document.body.className = '';
});

it('uses slot 1 for flight boost only, shows cooldown and restores the bar after flight', () => {
  document.body.innerHTML = '<div id="ui"></div>';
  const glider = createGliderFlightState();
  const world = {
    vehicleSession: null as VehicleSession | null,
    worldQuestLog: new Map<string, WorldQuestProgress>([
      [
        GLIDER_QUEST_ID,
        {
          questId: GLIDER_QUEST_ID,
          state: 'active',
          count: 0,
          glider,
        },
      ],
    ]),
    enterVehicle: vi.fn(),
    useVehicleAction: vi.fn(),
    leaveVehicle: vi.fn(),
    boostWorldQuestGlider: vi.fn(() => {
      applyGliderBoost(glider);
    }),
  };
  const writes = vi.fn();
  const pitchHold = vi.fn();
  const bar = new VehicleActionBarController({
    world,
    writers: makeWriterFacet(new Map(), new Map(), new Map(), new Map(), writes, () => {}),
    keyLabel: (slot) => String(slot + 1),
    consumePeek: () => false,
    cancelOnEnter: [],
    attachTooltip: () => {},
    gliderPitchHold: pitchHold,
  });
  bar.update();
  const buttons = [...document.querySelectorAll<HTMLButtonElement>('.vehicle-action')];
  expect(buttons[0].getAttribute('aria-disabled')).toBe('true');
  // Flight keeps Climb (slot 2) and Dive (slot 3) on the bar, disabled until airborne.
  expect(buttons[1].style.display).toBe('');
  expect(buttons[2].style.display).toBe('');
  expect(buttons[1].getAttribute('aria-disabled')).toBe('true');
  bar.chooseSlot(1);
  expect(pitchHold).not.toHaveBeenCalled();
  expect(
    document.getElementById('vehicle-action-bar')!.classList.contains('glider-action-bar'),
  ).toBe(true);
  expect(VehicleActionBarController.blocksPlayerActions(world)).toBe(true);
  buttons[0].click();
  bar.chooseSlot(0);
  expect(world.boostWorldQuestGlider).not.toHaveBeenCalled();
  glider.phase = 'flying';
  bar.update();
  expect(buttons[0].getAttribute('aria-disabled')).toBe('false');
  expect(buttons[0].querySelector('.keybind')!.textContent).toBe('1');
  expect(buttons[0].getAttribute('aria-description')).toContain('14 yd/s');
  buttons[0].click();
  expect(world.boostWorldQuestGlider).toHaveBeenCalledTimes(1);
  bar.update();
  expect(buttons[0].querySelector('.cdtext')!.textContent).toBe('10');
  bar.chooseSlot(0);
  expect(world.boostWorldQuestGlider).toHaveBeenCalledTimes(1);
  expect(world.useVehicleAction).not.toHaveBeenCalled();
  // A tap on Climb nudges the pitch and lets go on its own; a hold pins it until
  // the pointer releases; Dive mirrors it with -1.
  vi.useFakeTimers();
  try {
    expect(buttons[1].getAttribute('aria-disabled')).toBe('false');
    bar.chooseSlot(1);
    expect(pitchHold).toHaveBeenLastCalledWith(1);
    expect(bar.heldGliderPitch).toBe(1);
    vi.advanceTimersByTime(GLIDER_PITCH_TAP_MS + 1);
    expect(pitchHold).toHaveBeenLastCalledWith(0);
    expect(bar.heldGliderPitch).toBe(0);
    buttons[2].dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(bar.heldGliderPitch).toBe(-1);
    vi.advanceTimersByTime(GLIDER_PITCH_TAP_MS * 4);
    expect(bar.heldGliderPitch).toBe(-1);
    buttons[2].dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    expect(bar.heldGliderPitch).toBe(0);
    expect(pitchHold).toHaveBeenLastCalledWith(0);
    expect(world.useVehicleAction).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
  writes.mockClear();
  bar.update();
  expect(writes).not.toHaveBeenCalled();
  glider.tick += 200;
  bar.chooseSlot(0);
  expect(world.boostWorldQuestGlider).toHaveBeenCalledTimes(2);
  for (const phase of ['won', 'failed'] as const) {
    glider.phase = phase;
    bar.update();
    expect(VehicleActionBarController.blocksPlayerActions(world)).toBe(false);
    expect(document.getElementById('vehicle-action-bar')!.style.display).toBe('none');
  }
  world.worldQuestLog.clear();
  bar.update();
  expect(document.body.classList.contains('operating-vehicle')).toBe(false);
});

it('elides unchanged frames, routes all three buttons, and restores normal controls on exit', () => {
  const ui = document.createElement('div');
  ui.id = 'ui';
  document.body.append(ui);
  const world = {
    vehicleSession: null as VehicleSession | null,
    enterVehicle: vi.fn(),
    useVehicleAction: vi.fn(),
    leaveVehicle: vi.fn(() => {
      world.vehicleSession = null;
    }),
  };
  const writes = vi.fn();
  const cancel = vi.fn();
  const consumePeek = vi.fn(() => false);
  const presentation = { setGroundAimReticle: vi.fn(), addShake: vi.fn() };
  const controller = new VehicleActionBarController({
    world,
    writers: makeWriterFacet(new Map(), new Map(), new Map(), new Map(), writes, () => {}),
    keyLabel: (slot) => String(slot + 1),
    consumePeek,
    clearReticle: vi.fn(),
    presentation,
    cancelOnEnter: [{ cancel }],
    attachTooltip: (element, html) => {
      element.addEventListener('focus', () => {
        element.setAttribute('data-test-tooltip', html());
      });
    },
  });
  controller.update();
  expect(document.body.classList.contains('operating-vehicle')).toBe(false);
  const encounter = createCannonEncounter();
  encounter.phase = 'wave';
  world.vehicleSession = {
    kind: 'cannon',
    stationId: 'north_watch_cannon',
    cycle: 'wq3_8',
    origin: { x: 442, y: 3, z: 1034 },
    encounter,
  };
  controller.update();
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(document.body.classList.contains('operating-vehicle')).toBe(true);
  expect(document.querySelector('.vehicle-bar-title')!.textContent).toBe('North Watch Cannon');
  world.vehicleSession.stationId = 'last_keep_cannon';
  controller.update();
  expect(document.querySelector('.vehicle-bar-title')!.textContent).toBe('The Last Keep Cannon');
  world.vehicleSession.stationId = 'north_watch_cannon';
  controller.update();
  const buttons = [...document.querySelectorAll<HTMLButtonElement>('.vehicle-action')];
  expect(buttons).toHaveLength(3);
  const meter = document.querySelector<HTMLElement>('.vehicle-integrity')!;
  expect(meter.tabIndex).toBe(0);
  meter.focus();
  expect(meter.getAttribute('data-test-tooltip')).toContain('Gold:');
  expect(document.querySelector('.vehicle-comfort')).toBeNull();
  encounter.feedback.push({ id: 1, tick: 0, kind: 'shot', x: 440, z: 1000 });
  encounter.feedback.push({ id: 2, tick: 0, kind: 'barrel', x: 440, z: 1000 });
  controller.update();
  expect(presentation.addShake).not.toHaveBeenCalled();
  consumePeek.mockReturnValueOnce(true);
  buttons[0].click();
  expect(controller.aim.isActive()).toBe(false);
  for (const [slot, button] of buttons.entries()) {
    button.click();
    controller.update();
    expect(controller.aim.activeSlot()).toBe(slot);
    expect(button.querySelector<HTMLElement>('.icon-label')!.style.backgroundImage).toContain(
      '.webp',
    );
    expect(button.getAttribute('aria-label')).toBeTruthy();
    button.focus();
    expect(button.getAttribute('data-test-tooltip')).toContain('damage');
    expect(button.getAttribute('aria-description')).toContain('No mana cost');
  }
  writes.mockClear();
  for (let frame = 0; frame < 60; frame++) controller.update();
  expect(writes).not.toHaveBeenCalled();
  document.querySelector<HTMLButtonElement>('.vehicle-exit')!.click();
  controller.update();
  expect(world.leaveVehicle).toHaveBeenCalledTimes(1);
  expect(controller.aim.isActive()).toBe(false);
  expect(document.body.classList.contains('operating-vehicle')).toBe(false);
  expect(document.getElementById('vehicle-action-bar')!.style.display).toBe('none');
});

it('checks live temporary action locks without building HUD chrome', () => {
  const world = {
    vehicleSession: null as VehicleSession | null,
    worldQuestLog: new Map<string, WorldQuestProgress>(),
  };
  const createElement = vi.spyOn(document, 'createElement');
  try {
    expect(VehicleActionBarController.blocksPlayerActions(world)).toBe(false);
    const entry: WorldQuestProgress = {
      questId: 'wq_eastbrook_shadow',
      state: 'active',
      count: 0,
      shadow: { phase: 'cloaked', suspicion: 0, cooldown: 0 },
    };
    world.worldQuestLog.set(entry.questId, entry);
    expect(VehicleActionBarController.blocksPlayerActions(world)).toBe(true);
    if (!entry.shadow) throw new Error('missing shadow');
    entry.shadow.phase = 'caught';
    expect(VehicleActionBarController.blocksPlayerActions(world)).toBe(false);
    world.vehicleSession = { stationId: 'test' } as VehicleSession;
    expect(VehicleActionBarController.blocksPlayerActions(world)).toBe(true);
    expect(createElement).not.toHaveBeenCalled();
  } finally {
    createElement.mockRestore();
  }
});
