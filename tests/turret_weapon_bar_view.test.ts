import { afterEach, describe, expect, it } from 'vitest';
import { turretPlanWireJson, turretStateWireJson } from '../server/turret_self_wire';
import { QuestWorldWireState } from '../src/net/quest_world_wire_state';
import {
  FIRE_AND_FLY_SCENARIOS,
  TURRET_SCENARIO_INTRODUCTION,
} from '../src/sim/content/fire_and_fly_scenarios';
import { TURRET_SHOCKWAVE, TURRET_WEAPON } from '../src/sim/content/turret_defense';
import { stillSegment } from '../src/sim/minigames/thrown_body';
import { createTurretDefense } from '../src/sim/minigames/turret_defense';
import { resolveTurretPlan } from '../src/sim/minigames/turret_defense_plan';
import { turretSessionView } from '../src/sim/turret_defense_session';
import type { TurretSession } from '../src/sim/types';
import { TurretOwnShotLedger } from '../src/ui/hud/vehicle/turret_own_shot_core';
import {
  TURRET_SHOCK_NUDGE_WINDUPS,
  TURRET_SHOCK_NUDGE_WINDUPS_FIRST_TRIAL,
  TURRET_WEAPON_ICONS,
  TurretWeaponBarView,
  turretShockNudgeWindups,
} from '../src/ui/hud/vehicle/turret_weapon_bar_view';
import { ensureLocaleLoaded, setLanguage, t } from '../src/ui/i18n';
import type { TurretSessionView } from '../src/world_api/vehicles';

afterEach(() => setLanguage('en'));

const START = 500;
const CENTER = { x: 0, z: 0 };

function seat(phase: 'intro' | 'wave' | 'between' | 'won' = 'wave'): TurretSession {
  const session: TurretSession = {
    kind: 'turret',
    origin: { x: 0, y: 0, z: 0 },
    defense: createTurretDefense(resolveTurretPlan(), CENTER, 3, START),
    priorMountKey: '',
    returnTo: { x: 0, y: 0, z: 0, facing: 0 },
    feedback: [],
    nextFeedbackSeq: 1,
  };
  session.defense.phase = phase;
  session.defense.phaseEndTick = START + 200;
  session.defense.rev++;
  return session;
}

function tick(
  view: TurretWeaponBarView,
  session: TurretSessionView,
  clock: number | null = START,
  shots = new TurretOwnShotLedger(),
  fragArmed = false,
) {
  return view.tick({ session, clock, shots, fragArmed, keycap: (slot) => String(slot + 1) });
}

/** `n` living monsters winding up a strike at the tower. */
function windingUp(session: TurretSession, n: number): TurretSession {
  const template = {
    id: 0,
    kind: 0,
    hp: 10,
    maxHp: 10,
    state: 'windup' as const,
    seg: stillSegment(START, 30, { x: 3, y: 0, z: 0 }),
    facing: 0,
    airSince: -1,
    throwX: 0,
    throwZ: 0,
    throwOpen: false,
    knocked: [],
  };
  session.defense.monsters = Array.from({ length: n }, (_, i) => ({
    ...template,
    id: i + 1,
  })) as unknown as TurretSession['defense']['monsters'];
  session.defense.rev++;
  return session;
}

describe('the turret weapon sockets view', () => {
  it('shows each weapon with its icon, keycap and charges, both ready in a wave', () => {
    const state = tick(new TurretWeaponBarView(), turretSessionView(seat()));
    const [shock, frag] = state.slots;
    expect(shock).toMatchObject({
      iconKey: TURRET_WEAPON_ICONS.shock,
      keybindLabel: '1',
      count: '2',
      isCharges: true,
      usable: true,
      ariaLabel: 'Shockwave',
      cooldownPercent: 0,
      procGlow: false,
    });
    expect(frag).toMatchObject({
      iconKey: TURRET_WEAPON_ICONS.frag,
      keybindLabel: '2',
      count: '3',
      usable: true,
      aiming: false,
      ariaLabel: 'Fragmentation Shell',
    });
    expect(shock.ariaDescription).toContain('Slam the tower');
  });

  it('draws the two procedural icons the icon table ships', () => {
    expect(TURRET_WEAPON_ICONS).toEqual({ shock: 'turret_shockwave', frag: 'turret_frag' });
  });

  it('reads both sockets as not ready outside a wave, charges still shown', () => {
    for (const phase of ['intro', 'between'] as const) {
      const state = tick(new TurretWeaponBarView(), turretSessionView(seat(phase)));
      expect(state.slots.map((s) => s.usable)).toEqual([false, false]);
      expect(state.slots.map((s) => s.count)).toEqual(['2', '3']);
    }
    const rearming = seat();
    rearming.defense.shockReadyTick = START + 10;
    rearming.defense.rev++;
    const noClock = tick(new TurretWeaponBarView(), turretSessionView(rearming), null);
    expect(noClock.slots.map((s) => s.usable)).toEqual([false, false]);
    // Without a clock there is no rearm to draw.
    expect(noClock.slots[0].cooldownPercent).toBe(0);
  });

  it("draws the Shockwave's rearm as the cooldown sweep, and only its own", () => {
    const session = seat();
    session.defense.stats.shockwaves = 1;
    session.defense.shockReadyTick = START + TURRET_SHOCKWAVE.rearmTicks / 2;
    session.defense.readyTick = START + TURRET_WEAPON.cooldownTicks;
    session.defense.rev++;
    const [shock, frag] = tick(new TurretWeaponBarView(), turretSessionView(session)).slots;
    expect(shock.count).toBe('1');
    expect(shock.usable).toBe(false);
    expect(shock.cooldownTotal).toBe(TURRET_SHOCKWAVE.rearmTicks / 20);
    expect(shock.cooldownPercent).toBeCloseTo(50);
    expect(shock.cdText).toBe('1');
    // The shell's reload dims the frag socket without a sweep of its own.
    expect(frag.usable).toBe(false);
    expect(frag.cooldownPercent).toBe(0);
    expect(frag.cdText).toBe('');
  });

  it('desaturates an empty weapon and keeps its socket with a 0', () => {
    const session = seat();
    session.defense.stats.shockwaves = 2;
    session.defense.stats.frags = 3;
    session.defense.shockReadyTick = START + 10;
    session.defense.rev++;
    const [shock, frag] = tick(new TurretWeaponBarView(), turretSessionView(session)).slots;
    expect([shock.count, frag.count]).toEqual(['0', '0']);
    expect([shock.usable, frag.usable]).toEqual([false, false]);
    // No sweep on a weapon with nothing left to rearm.
    expect(shock.cooldownPercent).toBe(0);
  });

  it('drops a charge on a played click at once and marks the armed shell', () => {
    const view = new TurretWeaponBarView();
    const session = turretSessionView(seat());
    const shots = new TurretOwnShotLedger();
    expect(tick(view, session, START, shots).slots[0].count).toBe('2');
    shots.markWeapon(session, START, { x: 0, z: 0, dirX: 0, dirZ: 1, range: 0 }, 'shock');
    const state = tick(view, session, START, shots, true);
    expect(state.slots[0].count).toBe('1');
    expect(view.chargesAt(0)).toBe(1);
    expect(state.slots[1].aiming).toBe(true);
  });

  it(`pulses the Shockwave gold while ${TURRET_SHOCK_NUDGE_WINDUPS} or more monsters wind up`, () => {
    const view = new TurretWeaponBarView();
    expect(tick(view, turretSessionView(windingUp(seat(), 2))).slots[0].procGlow).toBe(false);
    expect(tick(view, turretSessionView(windingUp(seat(), 3))).slots[0].procGlow).toBe(true);
    expect(tick(view, turretSessionView(windingUp(seat(), 3))).slots[1].procGlow).toBe(false);
    // Never a nudge toward a weapon with nothing left.
    const empty = windingUp(seat(), 4);
    empty.defense.stats.shockwaves = 2;
    empty.defense.rev++;
    expect(tick(view, turretSessionView(empty)).slots[0].procGlow).toBe(false);
  });

  it('pulses from two windups in the first trial only, where the Shockwave is learned', () => {
    expect(turretShockNudgeWindups(TURRET_SCENARIO_INTRODUCTION.id)).toBe(
      TURRET_SHOCK_NUDGE_WINDUPS_FIRST_TRIAL,
    );
    expect(TURRET_SHOCK_NUDGE_WINDUPS_FIRST_TRIAL).toBeLessThan(TURRET_SHOCK_NUDGE_WINDUPS);
    for (const scenario of FIRE_AND_FLY_SCENARIOS) {
      if (scenario.id === TURRET_SCENARIO_INTRODUCTION.id) continue;
      expect(turretShockNudgeWindups(scenario.id), scenario.id).toBe(TURRET_SHOCK_NUDGE_WINDUPS);
    }
    const first = (count: number): TurretSession => {
      const session = windingUp(seat(), count);
      (session.defense as { plan: unknown }).plan = resolveTurretPlan(TURRET_SCENARIO_INTRODUCTION);
      session.defense.rev++;
      return session;
    };
    const view = new TurretWeaponBarView();
    expect(tick(view, turretSessionView(first(1))).slots[0].procGlow).toBe(false);
    expect(tick(view, turretSessionView(first(2))).slots[0].procGlow).toBe(true);
    expect(tick(view, turretSessionView(windingUp(seat(), 2))).slots[0].procGlow).toBe(false);
  });

  it('never pulses a Shockwave a press would not play: rearming, between waves', () => {
    const view = new TurretWeaponBarView();
    const rearming = windingUp(seat(), 3);
    rearming.defense.stats.shockwaves = 1;
    rearming.defense.shockReadyTick = START + TURRET_SHOCKWAVE.rearmTicks;
    rearming.defense.rev++;
    const [shock] = tick(view, turretSessionView(rearming)).slots;
    expect(shock.usable).toBe(false);
    expect(shock.procGlow).toBe(false);
    expect(tick(view, turretSessionView(windingUp(seat('between'), 3))).slots[0].procGlow).toBe(
      false,
    );
  });

  it('counts only living monsters winding up toward the pulse', () => {
    const view = new TurretWeaponBarView();
    const session = windingUp(seat(), 3);
    session.defense.monsters[2].hp = 0;
    session.defense.rev++;
    expect(tick(view, turretSessionView(session)).slots[0].procGlow).toBe(false);
  });

  it('pulses off the online mirror too, on and off as the seat key moves', () => {
    class Mirror extends QuestWorldWireState {}
    const mirror = new Mirror();
    const view = new TurretWeaponBarView();
    const session = seat();
    const turp = JSON.parse(turretPlanWireJson(session.defense.plan));
    // The state key holds a revision back until a later tick, as the server sends it.
    const snapshot = (tick: number, withSeat = true) =>
      mirror.applyQuestSelfSnapshot(
        withSeat ? { turp, tur: JSON.parse(turretStateWireJson(session, tick)) } : {},
        0,
        tick,
      );
    const glow = () => tick(view, mirror.turretSession!, mirror.turretClock).slots[0].procGlow;
    snapshot(START);
    expect(glow()).toBe(false);
    windingUp(session, 3);
    snapshot(START + 1);
    expect(glow()).toBe(true);
    // A snapshot that moves nothing keeps the seat object and the pulse.
    snapshot(START + 2, false);
    expect(glow()).toBe(true);
    windingUp(session, 0);
    snapshot(START + 3);
    expect(glow()).toBe(false);
  });

  it('rewrites the names and rules on a language switch, with nothing else moving', async () => {
    const view = new TurretWeaponBarView();
    const session = turretSessionView(seat());
    expect(tick(view, session).slots[0].ariaLabel).toBe('Shockwave');
    await ensureLocaleLoaded('zh_CN');
    setLanguage('zh_CN');
    const [shock] = tick(view, session).slots;
    expect(shock.ariaLabel).toBe(t('hudChrome.turret.shockwave'));
    expect(shock.ariaLabel).not.toBe('Shockwave');
  });

  it('reuses one state between ticks (no per-frame garbage)', () => {
    const view = new TurretWeaponBarView();
    const session = turretSessionView(seat());
    const a = tick(view, session);
    const b = tick(view, session, START + 1);
    expect(b).toBe(a);
    expect(b.slots[0]).toBe(a.slots[0]);
  });
});
