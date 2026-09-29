// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { sfx } from '../src/game/sfx';
import {
  TURRET_BREACH_SFX,
  TURRET_FIRE_SFX,
  TURRET_IMPACT_SFX,
} from '../src/game/turret_defense_sfx';
import {
  TURRET_KNOCK_SFX,
  TURRET_THUMP_HEAVY_SFX,
  TURRET_THUMP_LIGHT_SFX,
} from '../src/game/turret_monster_sfx';
import { TURRET_TIMING } from '../src/sim/content/turret_defense';
import { createTurretDefense } from '../src/sim/minigames/turret_defense';
import { resolveTurretPlan } from '../src/sim/minigames/turret_defense_plan';
import { recordTurretFeedback } from '../src/sim/minigames/turret_feedback';
import { turretSessionView } from '../src/sim/turret_defense_session';
import type { TurretSession, VehicleSession } from '../src/sim/types';
import { createHudVehicleBar } from '../src/ui/hud/vehicle/hud_vehicle_bar';
import { TurretAimCore } from '../src/ui/hud/vehicle/turret_aim_core';
import {
  TURRET_HIT_ATTACK_MS,
  TURRET_HIT_RELEASE_MS,
} from '../src/ui/hud/vehicle/turret_hit_feedback_core';
import { TURRET_HIT_OVERLAY_ID } from '../src/ui/hud/vehicle/turret_hud_controller';
import { VehicleActionBarController } from '../src/ui/hud/vehicle/vehicle_action_bar_controller';
import { VehicleAimCore } from '../src/ui/hud/vehicle/vehicle_aim_core';
import { setLanguage } from '../src/ui/i18n';
import { makeWriterFacet } from '../src/ui/painter_host';
import type { TurretSessionView } from '../src/world_api/vehicles';

vi.mock('../src/ui/icons', () => ({ iconDataUrl: (_kind: string, key: string) => `/${key}.webp` }));
vi.mock('../src/game/sfx', () => ({
  sfx: {
    preload: vi.fn(),
    playUi: vi.fn(),
    playAt: vi.fn(() => true),
    hasVariants: () => false,
  },
}));

const START = 400;

beforeEach(() => {
  setLanguage('en');
  document.body.innerHTML = '<div id="ui"></div>';
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
  document.body.className = '';
});

function seat(): TurretSession {
  return {
    kind: 'turret',
    origin: { x: 0, y: 0, z: 0 },
    defense: createTurretDefense(resolveTurretPlan(), { x: 0, z: 0 }, 5, START),
    priorMountKey: '',
    returnTo: { x: 0, y: 0, z: 0, facing: 0 },
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

function hudHost(renderer?: { setGroundAimReticle(value: null): void; addShake(n: number): void }) {
  const world = {
    vehicleSession: null as VehicleSession | null,
    turretSession: null as TurretSessionView | null,
    turretClock: null as number | null,
    enterVehicle: vi.fn(),
    useVehicleAction: vi.fn(),
    leaveVehicle: vi.fn(),
  };
  const showBanner = vi.fn();
  const spawn = vi.fn();
  const bar = createHudVehicleBar({
    sim: world,
    writerFacet: makeWriterFacet(new Map(), new Map(), new Map(), new Map(), vi.fn(), () => {}),
    keybinds: { primaryLabel: () => '' },
    optionsHooks: null,
    peekGuard: { consume: () => false },
    renderer,
    playerGroundAim: { cancel: vi.fn() },
    empowerHold: { cancel: vi.fn() },
    fctPainter: { spawn },
    attachTooltip: () => {},
    showBanner,
  });
  return { world, bar, showBanner, spawn };
}

it("floats each hit's damage through the HUD floating combat text, once", () => {
  vi.spyOn(performance, 'now').mockReturnValue(1234);
  const { world, bar, spawn } = hudHost();
  const session = seat();
  session.nextFeedbackSeq = recordTurretFeedback(session.feedback, session.nextFeedbackSeq, START, [
    {
      type: 'impact',
      shotId: 1,
      x: 20,
      y: 0,
      z: 0,
      hits: [{ id: 7, falloff: 1, damage: 60, x: 19, y: 0, z: 1 }],
    },
  ]);
  world.turretSession = turretSessionView(session);
  world.turretClock = START;
  bar.update();
  bar.update();
  expect(spawn).toHaveBeenCalledTimes(1);
  expect(spawn.mock.calls[0][0]).toMatchObject({
    kind: 'damage-done-ability',
    text: '60!',
    crit: true,
    target: { pos: { x: 19, y: 0, z: 1 } },
  });
  expect(spawn.mock.calls[0][1]).toBe(1234);
});

it('floats nothing for a hit already stale on the seat clock at its first read', () => {
  const { world, bar, spawn } = hudHost();
  const session = seat();
  const hit = { id: 7, falloff: 1, damage: 60, x: 19, y: 0, z: 1 };
  session.nextFeedbackSeq = recordTurretFeedback(
    session.feedback,
    session.nextFeedbackSeq,
    START - 11,
    [{ type: 'impact', shotId: 1, x: 20, y: 0, z: 0, hits: [hit] }],
  );
  world.turretSession = turretSessionView(session);
  world.turretClock = START;
  bar.update();
  expect(spawn).not.toHaveBeenCalled();
  session.nextFeedbackSeq = recordTurretFeedback(
    session.feedback,
    session.nextFeedbackSeq,
    START - 10,
    [{ type: 'impact', shotId: 2, x: 20, y: 0, z: 0, hits: [hit] }],
  );
  world.turretSession = turretSessionView(session);
  bar.update();
  expect(spawn).toHaveBeenCalledTimes(1);
});

it('hands the HUD banner its text, motion, variant and the final-wave subtext', () => {
  const { world, bar, showBanner } = hudHost();
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
  expect(leave.textContent).toBe('Leave the tower');
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

it('plays the cannon report and the blast once each from the seat frame', () => {
  vi.mocked(sfx.playAt).mockClear();
  vi.mocked(sfx.preload).mockClear();
  const { world, bar } = rig();
  const session = seat();
  session.nextFeedbackSeq = recordTurretFeedback(session.feedback, session.nextFeedbackSeq, START, [
    {
      type: 'fired',
      shotId: 1,
      fromX: 0,
      fromZ: 0,
      x: 20,
      y: 0,
      z: 0,
      flightTicks: 8,
      impactTick: START + 8,
    },
    { type: 'impact', shotId: 1, x: 20, y: 0, z: 0, hits: [] },
  ]);
  world.turretSession = turretSessionView(session);
  world.turretClock = START;
  bar.update();
  bar.update();
  expect(vi.mocked(sfx.playAt).mock.calls.map((call) => call[0])).toEqual([
    TURRET_FIRE_SFX,
    TURRET_IMPACT_SFX,
  ]);
  const preloaded = vi.mocked(sfx.preload).mock.calls.map((call) => call[0]);
  expect(preloaded).toEqual(
    expect.arrayContaining([
      TURRET_FIRE_SFX,
      TURRET_IMPACT_SFX,
      TURRET_THUMP_LIGHT_SFX,
      TURRET_THUMP_HEAVY_SFX,
      TURRET_KNOCK_SFX,
      'mob_beast_death',
      'mob_ogre_hurt',
    ]),
  );
});

function struck(session: TurretSession, points: number, tick = START): void {
  session.nextFeedbackSeq = recordTurretFeedback(session.feedback, session.nextFeedbackSeq, tick, [
    {
      type: 'breach',
      id: 3,
      points,
      integrity: TURRET_TIMING.integrity - points,
      x: 4,
      y: 0,
      z: 0,
    },
  ]);
  session.defense.integrity -= points;
  session.defense.rev++;
}

it('flashes the screen edges and the integrity bar on a strike, then clears them', () => {
  let now = 5000;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  const renderer = { setGroundAimReticle: vi.fn(), addShake: vi.fn() };
  const { world, bar } = hudHost(renderer);
  const session = seat();
  world.turretSession = turretSessionView(session);
  world.turretClock = START;
  bar.update();
  const overlay = document.getElementById(TURRET_HIT_OVERLAY_ID)!;
  expect(overlay.parentElement?.id).toBe('ui');
  expect(overlay.getAttribute('aria-hidden')).toBe('true');
  expect(overlay.style.display).toBe('none');
  struck(session, 10);
  world.turretSession = turretSessionView(session);
  bar.update();
  expect(overlay.style.display).toBe('');
  expect(renderer.addShake).toHaveBeenCalledTimes(1);
  expect(renderer.addShake.mock.calls[0][0]).toBeGreaterThan(0);
  now += TURRET_HIT_ATTACK_MS;
  bar.update();
  const gauge = hud().querySelector<HTMLElement>('.vehicle-integrity')!;
  expect(Number(overlay.style.getPropertyValue('--turret-hit-flash'))).toBeGreaterThan(0.5);
  expect(Number(gauge.style.getPropertyValue('--turret-hit-glow'))).toBeGreaterThan(0.5);
  now += TURRET_HIT_RELEASE_MS;
  bar.update();
  bar.update();
  expect(renderer.addShake).toHaveBeenCalledTimes(1);
  expect(overlay.style.display).toBe('none');
  expect(overlay.style.getPropertyValue('--turret-hit-flash')).toBe('0.000');
  expect(gauge.style.getPropertyValue('--turret-hit-glow')).toBe('0.000');
  expect(gauge.style.getPropertyValue('--turret-hit-shake')).toBe('0.000');
});

it('keeps the camera still and the bar steady under the in-game Reduce Motion switch', () => {
  let now = 5000;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  document.body.classList.add('reduce-motion');
  const renderer = { setGroundAimReticle: vi.fn(), addShake: vi.fn() };
  const { world, bar } = hudHost(renderer);
  const session = seat();
  world.turretClock = START;
  struck(session, 12);
  world.turretSession = turretSessionView(session);
  bar.update();
  const gauge = hud().querySelector<HTMLElement>('.vehicle-integrity')!;
  for (let i = 0; i < 8; i++) {
    now += 16;
    bar.update();
    expect(gauge.style.getPropertyValue('--turret-hit-shake')).toBe('0.000');
  }
  expect(renderer.addShake).not.toHaveBeenCalled();
  const overlay = document.getElementById(TURRET_HIT_OVERLAY_ID)!;
  expect(Number(overlay.style.getPropertyValue('--turret-hit-flash'))).toBeGreaterThan(0);
});

it('keeps the camera still under the OS reduced-motion setting, resolving its query once', () => {
  let now = 5000;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  const query = '(prefers-reduced-motion: reduce)';
  const matchMedia = vi.fn((q: string) => ({ matches: q === query }) as MediaQueryList);
  vi.stubGlobal('matchMedia', matchMedia);
  const renderer = { setGroundAimReticle: vi.fn(), addShake: vi.fn() };
  const { world, bar } = hudHost(renderer);
  const session = seat();
  world.turretSession = turretSessionView(session);
  world.turretClock = START;
  bar.update();
  struck(session, 12);
  world.turretSession = turretSessionView(session);
  bar.update();
  now += TURRET_HIT_ATTACK_MS;
  struck(session, 4);
  world.turretSession = turretSessionView(session);
  bar.update();
  const gauge = hud().querySelector<HTMLElement>('.vehicle-integrity')!;
  expect(gauge.style.getPropertyValue('--turret-hit-shake')).toBe('0.000');
  expect(Number(gauge.style.getPropertyValue('--turret-hit-glow'))).toBeGreaterThan(0);
  expect(renderer.addShake).not.toHaveBeenCalled();
  expect(matchMedia.mock.calls.filter(([q]) => q === query)).toHaveLength(1);
});

it('crunches the turret once per strike frame, and preloads the crunch with the seat', () => {
  vi.mocked(sfx.playAt).mockClear();
  vi.mocked(sfx.preload).mockClear();
  const { world, bar } = rig();
  const session = seat();
  world.turretSession = turretSessionView(session);
  world.turretClock = START;
  bar.update();
  expect(vi.mocked(sfx.preload).mock.calls.map((call) => call[0])).toContain(TURRET_BREACH_SFX);
  struck(session, 2);
  struck(session, 10);
  world.turretSession = turretSessionView(session);
  bar.update();
  bar.update();
  const breaches = vi.mocked(sfx.playAt).mock.calls.filter((call) => call[0] === TURRET_BREACH_SFX);
  expect(breaches).toHaveLength(1);
  expect(breaches[0].slice(1, 4)).toEqual([4, 0, 0]);
});
