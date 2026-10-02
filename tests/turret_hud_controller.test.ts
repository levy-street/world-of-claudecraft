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
import { TURRET_SCENARIO_STANDARD } from '../src/sim/content/fire_and_fly_scenarios';
import { createTurretDefense } from '../src/sim/minigames/turret_defense';
import { recordTurretFeedback } from '../src/sim/minigames/turret_feedback';
import { turretSessionView } from '../src/sim/turret_defense_session';
import type { TurretSession, VehicleSession } from '../src/sim/types';
import { createHudVehicleBar } from '../src/ui/hud/vehicle/hud_vehicle_bar';
import { TurretAimCore } from '../src/ui/hud/vehicle/turret_aim_core';
import {
  TURRET_HIT_ATTACK_MS,
  TURRET_HIT_RELEASE_MS,
} from '../src/ui/hud/vehicle/turret_hit_feedback_core';
import {
  TURRET_HIT_OVERLAY_ID,
  TURRET_SEATED_CLASS,
} from '../src/ui/hud/vehicle/turret_hud_controller';
import {
  TURRET_HUD_ID,
  TURRET_LIVE_ID,
  TURRET_RAIL_ID,
} from '../src/ui/hud/vehicle/turret_hud_painter';
import { VehicleActionBarController } from '../src/ui/hud/vehicle/vehicle_action_bar_controller';
import { VehicleAimCore } from '../src/ui/hud/vehicle/vehicle_aim_core';
import { setLanguage } from '../src/ui/i18n';
import { makeWriterFacet } from '../src/ui/painter_host';
import type { TurretSessionView } from '../src/world_api/vehicles';
import { resolveArmedTurretPlan } from './helpers/turret_armed_plan';

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
    defense: createTurretDefense(resolveArmedTurretPlan(), { x: 0, z: 0 }, 5, START),
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
  const onNewTurretRun = vi.fn();
  const bar = new VehicleActionBarController({
    world,
    writers: makeWriterFacet(new Map(), new Map(), new Map(), new Map(), writes, () => {}),
    keyLabel: (slot) => String(slot + 1),
    consumePeek: () => false,
    cancelOnEnter: [{ cancel }],
    attachTooltip: () => {},
    showBanner,
    onNewTurretRun,
    padKind: () => 'xbox',
  });
  return { world, bar, writes, cancel, showBanner, onNewTurretRun };
}

const hud = () => document.getElementById(TURRET_HUD_ID)!;
const rail = () => document.getElementById(TURRET_RAIL_ID)!;
const live = () => document.getElementById(TURRET_LIVE_ID)!;
const text = (selector: string) => document.querySelector(selector)!.textContent;
const leaveButton = () => hud().querySelector<HTMLButtonElement>('.turret-leave')!;
const seatedClass = () => document.body.classList.contains(TURRET_SEATED_CLASS);

it('shows the strip and the rail, hides the action bars and swaps in the turret aim while seated', () => {
  const { world, bar, cancel } = rig();
  bar.update();
  expect(hud().style.display).toBe('none');
  expect(rail().style.display).toBe('none');
  expect(hud().parentElement?.id).toBe('ui');
  expect(rail().parentElement?.id).toBe('ui');
  expect(live().parentElement?.id).toBe('ui');
  // The short-screen stylesheet hides the rail under the ended card with a sibling rule.
  expect(hud().compareDocumentPosition(rail()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(live().style.display).toBe('');
  expect(live().textContent).toBe('');
  expect(bar.aim).toBeInstanceOf(VehicleAimCore);
  const session = seat();
  world.turretSession = turretSessionView(session);
  world.turretClock = START;
  bar.update();
  expect(hud().style.display).toBe('');
  expect(rail().style.display).toBe('');
  expect(document.getElementById('vehicle-action-bar')!.style.display).toBe('none');
  expect(document.body.classList.contains('operating-vehicle')).toBe(true);
  expect(seatedClass()).toBe(true);
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(bar.aim).toBeInstanceOf(TurretAimCore);
  expect(bar.aim.isActive()).toBe(true);
  expect(bar.blocksPlayerActions).toBe(true);
  expect(VehicleActionBarController.blocksPlayerActions({ vehicleSession: null })).toBe(false);
  expect(hud().getAttribute('aria-label')).toBe('Standing Watch');
  expect(hud().classList.contains('ui-panel-strong')).toBe(true);
  expect(text('.turret-strip-wave')).toBe('Wave 1/6');
  expect(text('.turret-strip-slot')).toBe('First wave in 3 sec');
  expect(hud().classList.contains('ended')).toBe(false);
  const leave = leaveButton();
  expect(leave.classList.contains('ui-btn')).toBe(true);
  expect(leave.classList.contains('ui-btn--lg')).toBe(false);
  expect(text('.turret-leave-label')).toBe('Leave');
  expect(text('.turret-leave-key')).toBe('Esc');
  expect(leave.getAttribute('aria-label')).toBe('Leave the tower');
  expect(leave.getAttribute('title')).toBe('Leave the tower');
  expect(leave.getAttribute('aria-keyshortcuts')).toBe('Escape');
  expect(rail().getAttribute('role')).toBe('meter');
  expect(rail().getAttribute('aria-label')).toBe('Tower integrity');
  expect(rail().getAttribute('aria-valuemax')).toBe(String(TURRET_SCENARIO_STANDARD.integrity));
  expect(rail().getAttribute('aria-valuenow')).toBe(String(TURRET_SCENARIO_STANDARD.integrity));
  expect(text('.turret-rail-caption')).toBe('Tower');
  expect(rail().querySelectorAll('.ui-bevel-ticks > span')).toHaveLength(4);
  expect(live().classList.contains('visually-hidden')).toBe(true);
  expect(live().textContent).toBe('First wave in 3 sec');
  expect(hud().querySelector('[role="status"]')).toBeNull();
});

// The seat's Standing Watch brings in the Shockwave: its first wave presents it by its key.
it("names the pad's buttons on the first wave's banner, and the sockets on touch", () => {
  for (const [mode, subtext] of [
    [
      'pad-active',
      'New weapon: the Shockwave, on Y. It slams the tower and throws back every monster at its foot.',
    ],
    [
      'mobile-touch',
      "New weapon: the Shockwave. Tap its socket to throw back every monster at the tower's foot.",
    ],
  ] as const) {
    document.body.innerHTML = '<div id="ui"></div>';
    document.body.className = mode;
    const { world, bar, showBanner } = rig();
    const session = seat();
    session.nextFeedbackSeq = recordTurretFeedback(
      session.feedback,
      session.nextFeedbackSeq,
      START,
      [{ type: 'waveStart', wave: 0, count: 8 }],
    );
    session.defense.phase = 'wave';
    session.defense.rev++;
    world.turretSession = turretSessionView(session);
    world.turretClock = START;
    bar.update();
    expect(showBanner, mode).toHaveBeenCalledWith({ text: 'Wave 1 of 6', subtext });
  }
});

it('shows the pad Start glyph on Leave while the pad is in hand', () => {
  const { world, bar } = rig();
  world.turretSession = turretSessionView(seat());
  world.turretClock = START;
  bar.update();
  expect(text('.turret-leave-key')).toBe('Esc');
  document.body.classList.add('pad-active');
  bar.update();
  expect(text('.turret-leave-key')).toBe('Menu');
});

it('hides the player frame and the XP rail only while seated, and gives them back on leaving', () => {
  const { world, bar } = rig();
  bar.update();
  expect(seatedClass()).toBe(false);
  world.turretSession = turretSessionView(seat());
  world.turretClock = START;
  bar.update();
  expect(seatedClass()).toBe(true);
  world.leaveVehicle();
  bar.update();
  expect(seatedClass()).toBe(false);
  expect(document.body.classList.contains('operating-vehicle')).toBe(false);
});

it('writes nothing on unchanged frames, announces each wave once, and never speaks a kill', () => {
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
  // The first wave presents the weapon the trial brings in by the player's own key (slot 1).
  expect(showBanner).toHaveBeenCalledWith({
    text: 'Wave 1 of 6',
    subtext:
      'New weapon: the Shockwave, on 1. It slams the tower and throws back every monster at its foot.',
  });
  expect(text('.turret-strip-wave')).toBe('Wave 1/6');
  expect(text('.turret-strip-slot')).toBe('Monsters left: 8');
  expect(live().textContent).toBe('Wave 1 of 6');
  world.turretSession = { ...turretSessionView(session), monstersLeft: 7 };
  bar.update();
  expect(text('.turret-strip-slot')).toBe('Monsters left: 7');
  expect(live().textContent).toBe('Wave 1 of 6');
});

it('paints the tower rail from the session, and turns it to danger when low', () => {
  const { world, bar } = rig();
  const session = seat();
  const max = TURRET_SCENARIO_STANDARD.integrity;
  const low = Math.round(max * 0.2);
  session.defense.integrity = low;
  world.turretSession = turretSessionView(session);
  world.turretClock = START;
  bar.update();
  const fill = rail().querySelector<HTMLElement>('.turret-rail-fill')!;
  expect(fill.classList.contains('ui-bevel-fill')).toBe(true);
  expect(fill.style.getPropertyValue('--turret-integrity')).toBe(String(low / max));
  expect(rail().classList.contains('low-integrity')).toBe(true);
  expect(rail().getAttribute('aria-valuenow')).toBe(String(low));
  expect(text('.turret-rail-value')).toBe(`${low}/${max}`);
  expect(fill.textContent).toBe('');
  session.defense.integrity = max;
  session.defense.rev++;
  world.turretSession = turretSessionView(session);
  bar.update();
  expect(fill.style.getPropertyValue('--turret-integrity')).toBe('1');
  expect(rail().classList.contains('low-integrity')).toBe(false);
});

it('unfolds the strip into a won result card', () => {
  const { world, bar } = rig();
  const session = seat();
  session.defense.phase = 'won';
  world.turretSession = turretSessionView(session);
  world.turretClock = START;
  bar.update();
  expect(hud().classList.contains('ended')).toBe(true);
  const card = hud().querySelector<HTMLElement>('.turret-card')!;
  expect(card.classList.contains('won')).toBe(true);
  expect(text('.turret-card-kicker')).toBe('Standing Watch');
  expect(text('.turret-card-verdict')).toBe('Victory!');
  expect(live().textContent).toBe('Victory!');
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
  const clearSourceBanner = vi.fn();
  const spawn = vi.fn();
  const host = {
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
    clearSourceBanner,
    lastMinimapDrawAt: 1234,
  };
  const bar = createHudVehicleBar(host);
  return { world, bar, showBanner, spawn, clearSourceBanner, host };
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
  expect(showBanner).toHaveBeenCalledWith(
    'Wave 6 of 6',
    true,
    undefined,
    'default',
    'Final wave',
    2600,
    'turret',
  );
});

it("drops the ended run's verdict banner and redraws the minimap when a Replay starts afresh", () => {
  const { world, bar, clearSourceBanner, host } = hudHost();
  const ended = seat();
  ended.defense.phase = 'won';
  world.turretSession = turretSessionView(ended);
  world.turretClock = START;
  bar.update();
  bar.update();
  expect(clearSourceBanner).not.toHaveBeenCalled();
  expect(host.lastMinimapDrawAt).toBe(1234);
  const next = seat();
  next.defense = createTurretDefense(resolveArmedTurretPlan(), { x: 0, z: 0 }, 6, START + 900);
  world.turretSession = turretSessionView(next);
  world.turretClock = START + 900;
  bar.update();
  expect(clearSourceBanner).toHaveBeenCalledExactlyOnceWith('turret');
  expect(host.lastMinimapDrawAt).toBe(0);
  bar.update();
  expect(clearSourceBanner).toHaveBeenCalledTimes(1);
});

it('shows the result card at the end and leaves through its large Leave button', () => {
  const { world, bar } = rig();
  const session = seat();
  session.defense.phase = 'lost';
  session.defense.integrity = 0;
  session.defense.stats.shots = 4;
  session.defense.stats.hits = 1;
  world.turretSession = turretSessionView(session);
  world.turretClock = START;
  bar.update();
  expect(hud().classList.contains('ended')).toBe(true);
  const card = hud().querySelector<HTMLElement>('.turret-card')!;
  expect(card.classList.contains('won')).toBe(false);
  expect(text('.turret-strip-slot')).toBe('');
  expect(text('.turret-card-verdict')).toBe('The tower has fallen');
  const rows = [...card.querySelectorAll('.ui-stat-row')].map((row) => [
    row.querySelector('dt')!.textContent,
    row.querySelector('dd')!.textContent,
  ]);
  expect(rows).toContainEqual(['Accuracy', '25%']);
  expect(rows).toContainEqual(['Tower', `0/${TURRET_SCENARIO_STANDARD.integrity}`]);
  const leave = leaveButton();
  expect(leave.classList.contains('ui-btn--lg')).toBe(true);
  expect(text('.turret-leave-label')).toBe('Leave the tower');
  leave.click();
  bar.update();
  expect(world.leaveVehicle).toHaveBeenCalledTimes(1);
  expect(hud().style.display).toBe('none');
  expect(rail().style.display).toBe('none');
  expect(live().textContent).toBe('');
  expect(live().style.display).toBe('');
  expect(document.body.classList.contains('operating-vehicle')).toBe(false);
  expect(seatedClass()).toBe(false);
  expect(bar.aim).toBeInstanceOf(VehicleAimCore);
  expect(bar.aim.isActive()).toBe(false);
});

it('replays from the card: the seat action, then the new run fresh, nothing of the old one replayed', () => {
  vi.mocked(sfx.playAt).mockClear();
  const { world, bar, showBanner, onNewTurretRun } = rig();
  const fired = (session: TurretSession, tick: number) => {
    session.nextFeedbackSeq = recordTurretFeedback(
      session.feedback,
      session.nextFeedbackSeq,
      tick,
      [
        {
          type: 'fired',
          shotId: 1,
          fromX: 0,
          fromZ: 0,
          x: 20,
          y: 0,
          z: 0,
          flightTicks: 8,
          impactTick: tick + 8,
        },
      ],
    );
  };
  const ended = seat();
  fired(ended, START);
  ended.defense.phase = 'lost';
  ended.defense.integrity = 0;
  world.turretSession = turretSessionView(ended);
  world.turretClock = START;
  bar.update();
  const replay = hud().querySelector<HTMLButtonElement>('.turret-replay')!;
  expect(replay.style.display).toBe('');
  expect(text('.turret-replay-label')).toBe('Replay');
  const heard = vi.mocked(sfx.playAt).mock.calls.length;
  const banners = showBanner.mock.calls.length;

  bar.update();
  expect(onNewTurretRun).not.toHaveBeenCalled();
  replay.click();
  expect(world.useVehicleAction).toHaveBeenCalledExactlyOnceWith('turret_replay', { x: 0, z: 0 });
  expect(world.leaveVehicle).not.toHaveBeenCalled();

  const next = seat();
  next.defense = createTurretDefense(resolveArmedTurretPlan(), { x: 0, z: 0 }, 6, START + 900);
  world.turretSession = turretSessionView(next);
  world.turretClock = START + 900;
  bar.update();
  // The host drops the last run's verdict banner and redraws the minimap, once.
  expect(onNewTurretRun).toHaveBeenCalledTimes(1);
  expect(hud().style.display).toBe('');
  expect(hud().classList.contains('ended')).toBe(false);
  expect(replay.style.display).toBe('none');
  expect(text('.turret-leave-label')).toBe('Leave');
  expect(seatedClass()).toBe(true);
  expect(vi.mocked(sfx.playAt).mock.calls.length).toBe(heard);
  expect(showBanner.mock.calls.length).toBe(banners);

  fired(next, START + 960);
  world.turretSession = turretSessionView(next);
  world.turretClock = START + 960;
  bar.update();
  expect(onNewTurretRun).toHaveBeenCalledTimes(1);
  expect(
    vi
      .mocked(sfx.playAt)
      .mock.calls.slice(heard)
      .map((call) => call[0]),
  ).toEqual([TURRET_FIRE_SFX]);
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
      integrity: TURRET_SCENARIO_STANDARD.integrity - points,
      x: 4,
      y: 0,
      z: 0,
    },
  ]);
  session.defense.integrity -= points;
  session.defense.rev++;
}

it('flashes the screen edges and the tower rail on a strike, then clears them', () => {
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
  const gauge = rail().querySelector<HTMLElement>('.turret-rail-bar')!;
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

it('keeps the camera still and the rail steady under the in-game Reduce Motion switch', () => {
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
  const gauge = rail().querySelector<HTMLElement>('.turret-rail-bar')!;
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
  const gauge = rail().querySelector<HTMLElement>('.turret-rail-bar')!;
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
