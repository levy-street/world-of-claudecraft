// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TURRET_TANK_MOUNT, TURRET_TIMING } from '../src/sim/content/turret_defense';
import { createTurretDefense } from '../src/sim/minigames/turret_defense';
import { resolveTurretPlan } from '../src/sim/minigames/turret_defense_plan';
import { recordTurretFeedback } from '../src/sim/minigames/turret_feedback';
import { turretSessionView } from '../src/sim/turret_defense_session';
import type { TurretSession, VehicleSession } from '../src/sim/types';
import { createHudVehicleBar } from '../src/ui/hud/vehicle/hud_vehicle_bar';
import { TurretAimCore } from '../src/ui/hud/vehicle/turret_aim_core';
import { VehicleActionBarController } from '../src/ui/hud/vehicle/vehicle_action_bar_controller';
import { VehicleAimCore } from '../src/ui/hud/vehicle/vehicle_aim_core';
import { setLanguage } from '../src/ui/i18n';
import { makeWriterFacet } from '../src/ui/painter_host';
import type { TurretSessionView } from '../src/world_api/vehicles';

vi.mock('../src/ui/icons', () => ({ iconDataUrl: (_kind: string, key: string) => `/${key}.webp` }));
vi.mock('../src/game/sfx', () => ({ sfx: { preload: vi.fn(), playUi: vi.fn() } }));

const START = 400;

beforeEach(() => {
  setLanguage('en');
  document.body.innerHTML = '<div id="ui"></div>';
});

afterEach(() => {
  document.body.replaceChildren();
  document.body.className = '';
});

function seat(): TurretSession {
  return {
    kind: 'turret',
    origin: { x: 0, y: 0, z: 0 },
    defense: createTurretDefense(resolveTurretPlan(), { x: 0, z: 0 }, 5, START),
    lentMountKey: TURRET_TANK_MOUNT,
    priorMountKey: '',
    feedback: [],
    nextFeedbackSeq: 1,
  };
}

function rig() {
  const world = {
    vehicleSession: null as VehicleSession | null,
    turretSession: null as TurretSessionView | null,
    turretClock: null as number | null,
    enterVehicle: vi.fn(),
    useVehicleAction: vi.fn(),
    leaveVehicle: vi.fn(() => {
      world.turretSession = null;
      world.turretClock = null;
    }),
  };
  const writes = vi.fn();
  const cancel = vi.fn();
  const showBanner = vi.fn();
  const bar = new VehicleActionBarController({
    world,
    writers: makeWriterFacet(new Map(), new Map(), new Map(), new Map(), writes, () => {}),
    keyLabel: (slot) => String(slot + 1),
    consumePeek: () => false,
    cancelOnEnter: [{ cancel }],
    attachTooltip: () => {},
    showBanner,
  });
  return { world, bar, writes, cancel, showBanner };
}

const hud = () => document.getElementById('turret-hud')!;
const text = (selector: string) => hud().querySelector(selector)!.textContent;

it('shows the seat HUD, hides the action bars and swaps in the turret aim while seated', () => {
  const { world, bar, cancel } = rig();
  bar.update();
  expect(hud().style.display).toBe('none');
  expect(bar.aim).toBeInstanceOf(VehicleAimCore);
  const session = seat();
  world.turretSession = turretSessionView(session);
  world.turretClock = START;
  bar.update();
  expect(hud().style.display).toBe('grid');
  expect(document.getElementById('vehicle-action-bar')!.style.display).toBe('none');
  expect(document.body.classList.contains('operating-vehicle')).toBe(true);
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(bar.aim).toBeInstanceOf(TurretAimCore);
  expect(bar.aim.isActive()).toBe(true);
  expect(bar.blocksPlayerActions).toBe(true);
  expect(VehicleActionBarController.blocksPlayerActions({ vehicleSession: null })).toBe(false);
  expect(text('.vehicle-bar-title')).toBe('Fire and Fly');
  expect(text('.turret-bar-status')).toBe('Wave 1/6');
  expect(text('.vehicle-bar-hint')).toBe('First wave in 3 sec');
  const gauge = hud().querySelector('.vehicle-integrity')!;
  expect(gauge.getAttribute('role')).toBe('meter');
  expect(gauge.getAttribute('aria-valuemax')).toBe(String(TURRET_TIMING.integrity));
  expect(gauge.getAttribute('aria-valuenow')).toBe(String(TURRET_TIMING.integrity));
  expect(gauge.getAttribute('aria-label')).toBe('Turret integrity');
  expect(hud().querySelector<HTMLElement>('.turret-result')!.style.display).toBe('none');
});

it('writes nothing on unchanged frames and announces each wave once', () => {
  const { world, bar, writes, showBanner } = rig();
  const session = seat();
  world.turretSession = turretSessionView(session);
  world.turretClock = START;
  bar.update();
  expect(writes).toHaveBeenCalled();
  writes.mockClear();
  for (let frame = 0; frame < 60; frame++) bar.update();
  expect(writes).not.toHaveBeenCalled();
  session.nextFeedbackSeq = recordTurretFeedback(session.feedback, session.nextFeedbackSeq, START, [
    { type: 'waveStart', wave: 0, count: 8 },
  ]);
  session.defense.phase = 'wave';
  session.defense.rev++;
  world.turretSession = turretSessionView(session);
  bar.update();
  bar.update();
  expect(showBanner).toHaveBeenCalledTimes(1);
  expect(showBanner).toHaveBeenCalledWith({ text: 'Wave 1 of 6' });
  expect(text('.turret-bar-status')).toBe('Wave 1/6Monsters left: 8');
});

it('paints the integrity bar from the session, and turns it to danger when low', () => {
  const { world, bar } = rig();
  const session = seat();
  const max = TURRET_TIMING.integrity;
  const low = Math.round(max * 0.2);
  session.defense.integrity = low;
  world.turretSession = turretSessionView(session);
  world.turretClock = START;
  bar.update();
  const gauge = hud().querySelector<HTMLElement>('.vehicle-integrity')!;
  const fill = hud().querySelector<HTMLElement>('.vehicle-integrity-fill')!;
  expect(fill.style.getPropertyValue('--vehicle-integrity')).toBe(String(low / max));
  expect(gauge.classList.contains('low-integrity')).toBe(true);
  expect(gauge.getAttribute('aria-valuenow')).toBe(String(low));
  expect(text('.vehicle-integrity-text')).toBe(`${low}/${max}`);
  session.defense.integrity = max;
  session.defense.rev++;
  world.turretSession = turretSessionView(session);
  bar.update();
  expect(fill.style.getPropertyValue('--vehicle-integrity')).toBe('1');
  expect(gauge.classList.contains('low-integrity')).toBe(false);
});

it('marks a won result panel', () => {
  const { world, bar } = rig();
  const session = seat();
  session.defense.phase = 'won';
  world.turretSession = turretSessionView(session);
  world.turretClock = START;
  bar.update();
  const result = hud().querySelector<HTMLElement>('.turret-result')!;
  expect(result.classList.contains('won')).toBe(true);
  expect(text('.turret-result-title')).toBe('Victory!');
});

it('hands the HUD banner its text, motion, variant and the final-wave subtext', () => {
  const world = {
    vehicleSession: null as VehicleSession | null,
    turretSession: null as TurretSessionView | null,
    turretClock: null as number | null,
    enterVehicle: vi.fn(),
    useVehicleAction: vi.fn(),
    leaveVehicle: vi.fn(),
  };
  const showBanner = vi.fn();
  const bar = createHudVehicleBar({
    sim: world,
    writerFacet: makeWriterFacet(new Map(), new Map(), new Map(), new Map(), vi.fn(), () => {}),
    keybinds: { primaryLabel: () => '' },
    optionsHooks: null,
    peekGuard: { consume: () => false },
    renderer: undefined,
    playerGroundAim: { cancel: vi.fn() },
    empowerHold: { cancel: vi.fn() },
    attachTooltip: () => {},
    showBanner,
  });
  const session = seat();
  session.nextFeedbackSeq = recordTurretFeedback(session.feedback, session.nextFeedbackSeq, START, [
    { type: 'waveStart', wave: 5, count: 9 },
  ]);
  world.turretSession = turretSessionView(session);
  world.turretClock = START;
  bar.update();
  expect(showBanner).toHaveBeenCalledTimes(1);
  expect(showBanner).toHaveBeenCalledWith('Wave 6 of 6', true, undefined, 'default', 'Final wave');
});

it('shows the result panel at the end and leaves through the Leave button', () => {
  const { world, bar } = rig();
  const session = seat();
  session.defense.phase = 'lost';
  session.defense.stats.shots = 4;
  session.defense.stats.hits = 1;
  world.turretSession = turretSessionView(session);
  world.turretClock = START;
  bar.update();
  const result = hud().querySelector<HTMLElement>('.turret-result')!;
  expect(result.style.display).toBe('');
  expect(result.classList.contains('won')).toBe(false);
  expect(text('.vehicle-bar-hint')).toBe('');
  expect(text('.turret-result-title')).toBe('The turret has fallen');
  expect(result.textContent).toContain('Accuracy: 25%');
  const leave = hud().querySelector<HTMLButtonElement>('.vehicle-exit')!;
  expect(leave.textContent).toBe('Leave the tank');
  leave.click();
  bar.update();
  expect(world.leaveVehicle).toHaveBeenCalledTimes(1);
  expect(hud().style.display).toBe('none');
  expect(document.body.classList.contains('operating-vehicle')).toBe(false);
  expect(bar.aim).toBeInstanceOf(VehicleAimCore);
  expect(bar.aim.isActive()).toBe(false);
});

it('drops a stale aim point when the seat changes', () => {
  const { world, bar } = rig();
  world.turretSession = turretSessionView(seat());
  world.turretClock = START;
  bar.update();
  bar.aim.updatePoint({ x: 10, z: 0 });
  expect(bar.aim.reticle()).not.toBeNull();
  world.turretSession = null;
  bar.update();
  world.turretSession = turretSessionView(seat());
  bar.update();
  expect(bar.aim.reticle()).toBeNull();
});
