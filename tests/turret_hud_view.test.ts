import { beforeEach, describe, expect, it, vi } from 'vitest';
import { turretPlanWireJson } from '../server/turret_self_wire';
import { decodeTurretPlan, decodeTurretSeat } from '../src/net/turret_session_wire';
import {
  TURRET_MISSION_DELUGE,
  TURRET_MISSION_GIANTS,
  TURRET_MISSION_PACK,
} from '../src/sim/content/fire_and_fly_missions';
import {
  TURRET_SCENARIO_HARD,
  TURRET_SCENARIO_INTRODUCTION,
  TURRET_SCENARIO_STANDARD,
} from '../src/sim/content/fire_and_fly_scenarios';
import { TURRET_TIMING } from '../src/sim/content/turret_defense';
import { positionAt } from '../src/sim/minigames/thrown_body';
import {
  createTurretDefense,
  fireTurret,
  type TurretEvent,
  tickTurretDefense,
} from '../src/sim/minigames/turret_defense';
import { resolveTurretPlan, type TurretPlan } from '../src/sim/minigames/turret_defense_plan';
import { recordTurretFeedback, TURRET_FEEDBACK_LIMIT } from '../src/sim/minigames/turret_feedback';
import { turretResult } from '../src/sim/minigames/turret_result';
import { turretSessionView } from '../src/sim/turret_defense_session';
import { TICK_RATE, type TurretScenarioDef, type TurretSession } from '../src/sim/types';
import {
  TURRET_INTEGRITY_ALERTS,
  TURRET_LEAVING_COUNTDOWN_SECONDS,
  TURRET_POINT_ROWS,
  TURRET_RESULT_ROWS,
  TurretFeedbackCursor,
  TurretHudView,
} from '../src/ui/hud/vehicle/turret_hud_view';
import { ensureLocaleLoaded, setLanguage, t } from '../src/ui/i18n';
import type { TurretSessionView } from '../src/world_api/vehicles';
import { resolveArmedTurretPlan } from './helpers/turret_armed_plan';
import { turretStateWireJson } from './helpers/turret_seat_wire';
import { probeAllocationStability } from './util/alloc_probe';

vi.mock('../src/ui/i18n', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/ui/i18n')>();
  return { ...actual, t: vi.fn(actual.t) };
});

const START = 200;

function seat(start = START, plan = resolveArmedTurretPlan()): TurretSession {
  return {
    kind: 'turret',
    origin: { x: 0, y: 0, z: 0 },
    defense: createTurretDefense(plan, { x: 0, z: 0 }, 3, start),
    priorMountKey: '',
    returnTo: { x: 0, y: 0, z: 0, facing: 0 },
    feedback: [],
    nextFeedbackSeq: 1,
  };
}

function push(session: TurretSession, tick: number, ...events: TurretEvent[]): void {
  session.nextFeedbackSeq = recordTurretFeedback(
    session.feedback,
    session.nextFeedbackSeq,
    tick,
    events,
  );
}

const stats = {
  shots: 0,
  hits: 0,
  kills: 0,
  breaches: 0,
  pointsLost: 0,
  longestThrow: 0,
  longestAirtime: 0,
  bowled: 0,
  barrelsDetonated: 0,
  barrelKills: 0,
  shockwaves: 0,
  frags: 0,
  resupplies: 0,
};

const NO_POINTS = { kills: 0, integrity: 0, kegKills: 0, bowled: 0, charges: 0 };

function endedEvent(result: 'won' | 'lost'): TurretEvent {
  const medal = result === 'won' ? 'bronze' : null;
  return { type: 'ended', result, stats: { ...stats }, medal, points: 0, breakdown: NO_POINTS };
}

beforeEach(() => setLanguage('en'));

const firstWaveBanner = {
  text: 'Wave 1 of 6',
  subtext: 'Blast the monsters before they reach the tower',
};

describe('the turret HUD view', () => {
  it('counts down to the first wave from the clock, in the strip slot', () => {
    const session = seat();
    const view = new TurretHudView();
    const frame = view.tick(turretSessionView(session), START);
    expect(frame.wave).toBe('Wave 1/6');
    expect(frame.slot).toBe(`First wave in ${TURRET_TIMING.introTicks / TICK_RATE} sec`);
    expect(view.tick(turretSessionView(session), START + TURRET_TIMING.introTicks - 1).slot).toBe(
      'First wave in 1 sec',
    );
    expect(frame.integrity).toBe(1);
    expect(frame.integrityText).toBe(
      `${TURRET_SCENARIO_STANDARD.integrity}/${TURRET_SCENARIO_STANDARD.integrity}`,
    );
    expect(frame.result).toBeNull();
  });

  it("reads the waves and the tower's maximum from the scenario's plan", () => {
    const intro = TURRET_SCENARIO_INTRODUCTION;
    const session = seat(START, resolveTurretPlan(intro));
    const view = new TurretHudView();
    const frame = view.tick(turretSessionView(session), START);
    expect(frame.wave).toBe(`Wave 1/${intro.waves.length}`);
    expect(frame.integrityMax).toBe(String(intro.integrity));
    expect(frame.integrityNow).toBe(String(intro.integrity));
    expect(frame.integrityText).toBe(`${intro.integrity}/${intro.integrity}`);
    expect(frame.integrity).toBe(1);
    session.defense.integrity = 20;
    session.defense.rev++;
    const hurt = view.tick(turretSessionView(session), START);
    expect(hurt.integrity).toBeCloseTo(20 / intro.integrity, 12);
    expect(hurt.integrityText).toBe(`20/${intro.integrity}`);
    expect(hurt.low).toBe(true);
    session.defense.phase = 'lost';
    session.defense.rev++;
    const ended = view.tick(turretSessionView(session), START);
    expect(ended.result?.rows[TURRET_RESULT_ROWS - 1].value).toBe(`20/${intro.integrity}`);
  });

  it('names the seat, its rail and its Leave and Replay buttons in the tower wording', () => {
    const { labels } = new TurretHudView().tick(turretSessionView(seat()), START);
    expect(labels).toEqual({
      title: 'Fire and Fly',
      trial: 'Standing Watch',
      meter: 'Tower integrity',
      caption: 'Tower',
      leave: 'Leave the tower',
      leaveShort: 'Leave',
      replay: 'Replay',
      replayHint:
        "Play the same trial again from the tower. Once today's reward is earned, a replay pays no reward.",
    });
  });

  it.each([
    [TURRET_SCENARIO_INTRODUCTION, "Recruit's Trial"],
    [TURRET_SCENARIO_STANDARD, 'Standing Watch'],
    [TURRET_SCENARIO_HARD, "Veterans' Test"],
  ] as const)("names the %# seat's trial for the result card's kicker", (scenario, name) => {
    const session = seat(START, resolveTurretPlan(scenario));
    const view = new TurretHudView();
    expect(view.tick(turretSessionView(session), START).labels.trial).toBe(name);
    session.defense.phase = 'won';
    session.defense.rev++;
    const frame = view.tick(turretSessionView(session), START);
    expect(frame.labels.trial).toBe(name);
    expect(frame.labels.title).toBe('Fire and Fly');
  });

  it('falls back to the title for a scenario without a trial name', () => {
    const plan = { ...resolveTurretPlan(), scenarioId: 'fire_and_fly_custom' };
    const { labels } = new TurretHudView().tick(turretSessionView(seat(START, plan)), START);
    expect(labels.trial).toBe('Fire and Fly');
  });

  it('shows the wave and the monsters left during a wave, with no aim hint', () => {
    const session = seat();
    session.defense.phase = 'wave';
    session.defense.wave = 2;
    session.defense.integrity = 20;
    const frame = new TurretHudView().tick(turretSessionView(session), START);
    expect(frame.wave).toBe('Wave 3/6');
    expect(frame.slot).toBe(
      `Monsters left: ${resolveTurretPlan().waves[2].spawns.length.toLocaleString('en')}`,
    );
    expect(frame.integrity).toBeCloseTo(0.2);
    expect(frame.low).toBe(true);
  });

  it('builds the result card with every stat, the final tower, the medal and the points', () => {
    const session = seat();
    session.defense.phase = 'won';
    session.defense.wave = 5;
    session.defense.integrity = 72;
    Object.assign(session.defense.stats, {
      shots: 40,
      hits: 30,
      kills: 55,
      longestThrow: 23.46,
      longestAirtime: 1.84,
      barrelKills: 3,
      bowled: 1234,
      shockwaves: 1,
      frags: 3,
    });
    session.defense.result = turretResult(session.defense.plan, session.defense);
    const frame = new TurretHudView().tick(turretSessionView(session), START);
    expect(frame.slot).toBe('');
    expect(frame.result).toEqual({
      won: true,
      verdict: 'Victory!',
      scored: true,
      medal: 'silver',
      medalText: 'Silver medal',
      leaving: '',
      pointRows: [
        { label: 'Kills (55)', value: '+1,100' },
        { label: 'Tower kept (72)', value: '+14,400' },
        { label: 'Keg kills (3)', value: '+15' },
        // The bonus stops under one tower point, however many bodies were bowled over.
        { label: 'Bowled over (1,234)', value: '+184' },
        // A trial scores no charge kept: the painter hides the blank row.
        { label: '', value: '' },
        { label: 'Total points', value: '15,699' },
      ],
      rows: [
        { label: 'Kills', value: '55' },
        { label: 'Shots fired', value: '40' },
        { label: 'Accuracy', value: '75%' },
        { label: 'Longest throw', value: '23.5 yd' },
        { label: 'Longest airtime', value: '1.8 sec' },
        // Used of those given: no points attached (a weapon kill scores as any kill).
        { label: 'Shockwaves', value: '1/2' },
        { label: 'Fragmentation Shells', value: '3/3' },
        { label: 'Tower', value: `72/${TURRET_SCENARIO_STANDARD.integrity}` },
      ],
    });
    expect(frame.result?.rows).toHaveLength(TURRET_RESULT_ROWS);
    expect(frame.result?.pointRows).toHaveLength(TURRET_POINT_ROWS);
    const lost = seat();
    lost.defense.phase = 'lost';
    lost.defense.integrity = 0;
    lost.defense.stats.kills = 9;
    lost.defense.result = turretResult(lost.defense.plan, lost.defense);
    const lostFrame = new TurretHudView().tick(turretSessionView(lost), START);
    expect(lostFrame.result?.won).toBe(false);
    expect(lostFrame.result?.verdict).toBe('The tower has fallen');
    expect(lostFrame.result?.rows[2].value).toBe('0%');
    expect(lostFrame.result?.medal).toBeNull();
    expect(lostFrame.result?.medalText).toBe('No medal');
    expect(lostFrame.result?.pointRows.map((row) => row.value)).toEqual([
      '+180',
      '0',
      '0',
      '0',
      '',
      '180',
    ]);
    expect(lostFrame.result?.pointRows[0].label).toBe('Kills (9)');
    expect(lostFrame.result?.pointRows[1].label).toBe('Tower kept (0)');
  });

  it('leaves the row of a weapon the trial gives none of blank', () => {
    const session = seat(
      START,
      resolveTurretPlan({
        ...TURRET_SCENARIO_STANDARD,
        arsenal: { shockwave: 0, fragmentation: 3 },
      }),
    );
    session.defense.phase = 'won';
    session.defense.stats.frags = 2;
    session.defense.result = turretResult(session.defense.plan, session.defense);
    const rows = new TurretHudView().tick(turretSessionView(session), START).result?.rows;
    expect(rows?.[5]).toEqual({ label: '', value: '' });
    expect(rows?.[6]).toEqual({ label: 'Fragmentation Shells', value: '2/3' });
  });

  it('reads the medal and the points the same off the online seat as off the offline view', () => {
    const session = seat();
    session.defense.phase = 'won';
    session.defense.wave = 5;
    session.defense.integrity = 99;
    Object.assign(session.defense.stats, { kills: 71, barrelKills: 4, bowled: 17 });
    session.defense.result = turretResult(session.defense.plan, session.defense);
    const offline = turretSessionView(session);
    const plan = decodeTurretPlan(JSON.parse(turretPlanWireJson(session.defense.plan)))!;
    const decoded = decodeTurretSeat(JSON.parse(turretStateWireJson(session, START)), plan)!;
    const online: TurretSessionView = { ...decoded, feedback: [] };
    const offlineResult = structuredClone(new TurretHudView().tick(offline, START).result);
    const onlineResult = new TurretHudView().tick(online, START).result;
    expect(onlineResult?.scored).toBe(true);
    expect(onlineResult?.medalText).toBe('Gold medal');
    expect(onlineResult?.pointRows[5]).toEqual({ label: 'Total points', value: '21,257' });
    expect(onlineResult).toEqual(offlineResult);
  });

  it('names each medal in words, for a gold, a silver and a bronze win', () => {
    const view = new TurretHudView();
    const medalAt = (integrity: number) => {
      const session = seat();
      session.defense.phase = 'won';
      session.defense.integrity = integrity;
      session.defense.result = turretResult(session.defense.plan, session.defense);
      const result = view.tick(turretSessionView(session), START).result;
      return [result?.medal, result?.medalText];
    };
    expect(medalAt(99)).toEqual(['gold', 'Gold medal']);
    expect(medalAt(60)).toEqual(['silver', 'Silver medal']);
    expect(medalAt(59)).toEqual(['bronze', 'Bronze medal']);
  });

  it('hides the medal and the points while an ended view carries no result', () => {
    const session = seat();
    session.defense.phase = 'won';
    const result = new TurretHudView().tick(turretSessionView(session), START).result;
    expect(result?.verdict).toBe('Victory!');
    expect(result?.scored).toBe(false);
    expect(result?.medal).toBeNull();
    expect(result?.medalText).toBe('');
    expect(result?.pointRows.every((row) => row.label === '' && row.value === '')).toBe(true);
  });

  it('holds a countdown at zero once the phase end tick has passed', () => {
    const session = seat();
    const frame = new TurretHudView().tick(
      turretSessionView(session),
      START + TURRET_TIMING.introTicks + 3 * TICK_RATE,
    );
    expect(frame.slot).toBe('First wave in 0 sec');
  });

  it('shows no countdown without a clock to count from', () => {
    const intro = seat();
    expect(new TurretHudView().tick(turretSessionView(intro), null).slot).toBe('');
  });

  it('reuses one frame and one result card, rebuilt only when the view or the second changes', () => {
    const view = new TurretHudView();
    const translate = vi.mocked(t);
    const ended = seat();
    ended.defense.phase = 'won';
    const endedView = turretSessionView(ended);
    const probe = probeAllocationStability(() => view.tick(endedView, START));
    expect(probe.stable, probe.detail).toBe(true);
    const { result } = view.tick(endedView, START);
    translate.mockClear();
    view.tick(endedView, START + 100);
    expect(translate).not.toHaveBeenCalled();
    ended.defense.stats.kills = 3;
    ended.defense.rev++;
    const next = view.tick(turretSessionView(ended), START);
    expect(next.result).toBe(result);
    expect(next.result?.rows).toBe(result?.rows);
    expect(next.result?.rows[0].value).toBe('3');
    const countingView = turretSessionView(seat());
    view.tick(countingView, START);
    translate.mockClear();
    view.tick(countingView, START + 1);
    expect(translate).not.toHaveBeenCalled();
    expect(view.tick(countingView, START + TICK_RATE).slot).toBe(
      `First wave in ${TURRET_TIMING.introTicks / TICK_RATE - 1} sec`,
    );
  });

  it("counts the seat's own leave down on the card over its last half minute only", () => {
    const ended = seat();
    const endTick = START + 400;
    ended.defense.phase = 'lost';
    ended.defense.integrity = 0;
    ended.defense.phaseEndTick = endTick;
    ended.defense.result = turretResult(ended.defense.plan, ended.defense);
    const endedView = turretSessionView(ended);
    const leaves = endTick + TURRET_TIMING.endedSeatTicks;
    const window = TURRET_LEAVING_COUNTDOWN_SECONDS * TICK_RATE;
    const view = new TurretHudView();
    const leaving = (clock: number | null) => view.tick(endedView, clock).result?.leaving;
    expect(TURRET_LEAVING_COUNTDOWN_SECONDS).toBe(30);
    expect(leaving(endTick)).toBe('');
    expect(leaving(leaves - window - 1)).toBe('');
    expect(leaving(leaves - window)).toBe('Leaving the tower in 30 sec');
    expect(leaving(leaves - 1)).toBe('Leaving the tower in 1 sec');
    expect(leaving(leaves)).toBe('Leaving the tower in 0 sec');
    expect(leaving(null)).toBe('');
    expect(view.tick(endedView, leaves - window).slot).toBe('');
    const translate = vi.mocked(t);
    view.tick(endedView, leaves - window);
    translate.mockClear();
    view.tick(endedView, leaves - window + 1);
    expect(translate).not.toHaveBeenCalled();
    view.tick(endedView, leaves - window + TICK_RATE);
    expect(translate).toHaveBeenCalledWith('hudChrome.turret.leavingIn', { seconds: '29' });
  });

  it('rebuilds an unchanged view when the language changes', async () => {
    const ended = seat();
    ended.defense.phase = 'won';
    const endedView = turretSessionView(ended);
    const view = new TurretHudView();
    expect(view.tick(endedView, START).result?.verdict).toBe('Victory!');
    await ensureLocaleLoaded('zh_CN');
    setLanguage('zh_CN');
    const frame = view.tick(endedView, START);
    expect(frame.result?.verdict).toBe('胜利！');
    expect(frame.announce).toBe('胜利！');
  });
});

describe('the turret HUD live line', () => {
  const at = (session: TurretSession, patch: Partial<TurretSessionView> = {}) => ({
    ...turretSessionView(session),
    ...patch,
  });

  it('speaks each phase start once, and never a kill or a countdown second', () => {
    const session = seat();
    const view = new TurretHudView();
    const intro = `First wave in ${TURRET_TIMING.introTicks / TICK_RATE} sec`;
    expect(view.tick(turretSessionView(session), START).announce).toBe(intro);
    expect(view.tick(turretSessionView(session), START + TICK_RATE).announce).toBe(intro);
    session.defense.phase = 'wave';
    session.defense.rev++;
    expect(view.tick(at(session, { monstersLeft: 8 }), START + 70).announce).toBe('Wave 1 of 6');
    const killed = view.tick(at(session, { monstersLeft: 7 }), START + 80);
    expect(killed.slot).toBe('Monsters left: 7');
    expect(killed.announce).toBe('Wave 1 of 6');
    // The next wave sets off on the clear's tick: no countdown, its own line at once.
    session.defense.wave = 1;
    session.defense.rev++;
    const next = view.tick(at(session, { monstersLeft: 9 }), START + 100);
    expect(next.announce).toBe('Wave 2 of 6');
    expect(next.slot).toBe('Monsters left: 9');
    session.defense.phase = 'lost';
    session.defense.rev++;
    expect(view.tick(turretSessionView(session), START + 200).announce).toBe(
      'The tower has fallen',
    );
  });

  it('speaks the tower crossing half, then a quarter, once each', () => {
    const session = seat();
    session.defense.phase = 'wave';
    const view = new TurretHudView();
    const max = TURRET_SCENARIO_STANDARD.integrity;
    const breach = (integrity: number) => {
      session.defense.integrity = integrity;
      session.defense.rev++;
      return view.tick(turretSessionView(session), START).announce;
    };
    expect(breach(max)).toBe('Wave 1 of 6');
    expect(breach(Math.round(max * 0.6))).toBe('Wave 1 of 6');
    expect(breach(Math.round(max * 0.45))).toBe('Tower integrity below 50%');
    expect(breach(Math.round(max * 0.3))).toBe('Tower integrity below 50%');
    expect(breach(Math.round(max * 0.2))).toBe('Tower integrity below 25%');
    expect(breach(Math.round(max * 0.1))).toBe('Tower integrity below 25%');
    session.defense.wave = 1;
    expect(breach(Math.round(max * 0.1))).toBe('Wave 2 of 6');
  });

  it('speaks the medal after the verdict as a won run ends, the verdict alone on a loss', () => {
    const ended = (phase: 'won' | 'lost', integrity: number) => {
      const session = seat();
      session.defense.phase = phase;
      session.defense.integrity = integrity;
      session.defense.result = turretResult(session.defense.plan, session.defense);
      return new TurretHudView().tick(turretSessionView(session), START).announce;
    };
    expect(ended('won', 99)).toBe('Victory! Gold medal');
    expect(ended('won', 59)).toBe('Victory! Bronze medal');
    expect(ended('lost', 0)).toBe('The tower has fallen');
  });

  it("speaks the seat's own leave once, as its countdown appears, never each second", () => {
    const session = seat();
    const endTick = START + 400;
    session.defense.phase = 'won';
    session.defense.phaseEndTick = endTick;
    session.defense.result = turretResult(session.defense.plan, session.defense);
    const endedView = turretSessionView(session);
    const leaves = endTick + TURRET_TIMING.endedSeatTicks;
    const view = new TurretHudView();
    expect(view.tick(endedView, endTick).announce).toBe('Victory! Gold medal');
    const window = TURRET_LEAVING_COUNTDOWN_SECONDS * TICK_RATE;
    expect(view.tick(endedView, leaves - window).announce).toBe('Leaving the tower in 30 sec');
    expect(view.tick(endedView, leaves - 5 * TICK_RATE).announce).toBe(
      'Leaving the tower in 30 sec',
    );
    const replayed = seat(leaves - 4 * TICK_RATE);
    expect(view.tick(turretSessionView(replayed), leaves - 4 * TICK_RATE).announce).toBe(
      `First wave in ${TURRET_TIMING.introTicks / TICK_RATE} sec`,
    );
  });

  it('forgets the seat on reset, so the next seat is announced again', () => {
    const view = new TurretHudView();
    const intro = `First wave in ${TURRET_TIMING.introTicks / TICK_RATE} sec`;
    expect(view.tick(turretSessionView(seat()), START).announce).toBe(intro);
    const again = seat();
    again.defense.integrity = 10;
    view.reset();
    const frame = view.tick(turretSessionView(again), START);
    expect(frame.announce).toBe(intro);
    expect(TURRET_INTEGRITY_ALERTS).toEqual([0.5, 0.25]);
  });

  it('closes the card and announces the replayed run with no reset, its cursor starting over', () => {
    const view = new TurretHudView();
    const cursor = new TurretFeedbackCursor();
    const lost = seat();
    push(lost, START + 60, { type: 'waveStart', wave: 0, count: 8 });
    lost.defense.phase = 'lost';
    lost.defense.integrity = 0;
    lost.defense.result = turretResult(lost.defense.plan, lost.defense);
    push(lost, START + 400, endedEvent('lost'));
    const lostView = turretSessionView(lost);
    expect(view.tick(lostView, START + 400).result).not.toBeNull();
    expect(cursor.consume(lostView)).toEqual({ text: 'The tower has fallen' });

    const replayed = seat(START + 900);
    const frame = view.tick(turretSessionView(replayed), START + 900);
    expect(frame.result).toBeNull();
    expect(frame.low).toBe(false);
    expect(frame.announce).toBe(`First wave in ${TURRET_TIMING.introTicks / TICK_RATE} sec`);
    expect(cursor.consume(turretSessionView(replayed))).toBeNull();
    push(replayed, START + 960, { type: 'waveStart', wave: 0, count: 8 });
    expect(cursor.consume(turretSessionView(replayed))).toEqual(firstWaveBanner);
  });
});

describe('the turret feedback cursor', () => {
  it('turns each wave and end event into one banner, never twice', () => {
    const session = seat();
    const cursor = new TurretFeedbackCursor();
    expect(cursor.consume(turretSessionView(session))).toBeNull();
    push(session, START + 60, { type: 'waveStart', wave: 0, count: 8 });
    expect(cursor.consume(turretSessionView(session))).toEqual(firstWaveBanner);
    expect(cursor.consume(turretSessionView(session))).toBeNull();
    push(session, START + 90, { type: 'killed', id: 1, x: 0, y: 0, z: 0 });
    expect(cursor.consume(turretSessionView(session))).toBeNull();
    push(session, START + 120, { type: 'waveCleared', wave: 0 });
    expect(cursor.consume(turretSessionView(session))).toEqual({ text: 'Wave 1 cleared' });
    push(session, START + 300, { type: 'waveStart', wave: 5, count: 9 });
    expect(cursor.consume(turretSessionView(session))).toEqual({
      text: 'Wave 6 of 6',
      subtext: 'Final wave',
    });
  });

  it("presents the weapon a trial brings in, else names only the scenario's weapons", () => {
    const banner = (plan: TurretPlan, keys?: Parameters<TurretFeedbackCursor['consume']>[1]) => {
      const session = seat(START, plan);
      push(session, START + 60, { type: 'waveStart', wave: 0, count: 8 });
      return new TurretFeedbackCursor().consume(turretSessionView(session), keys)?.subtext;
    };
    const pad = () => ({ shock: 'Y', frag: 'LB' });
    const touch = () => null;
    const plan = (scenario: TurretScenarioDef) => resolveTurretPlan(scenario);
    // The Recruit's Trial gives no weapon: the goal alone, and no key is asked for.
    const keys = vi.fn(pad);
    expect(banner(plan(TURRET_SCENARIO_INTRODUCTION), keys)).toBe(firstWaveBanner.subtext);
    expect(keys).not.toHaveBeenCalled();
    // Standing Watch brings in the Shockwave, the Veterans' Test the fragmentation shell.
    expect(banner(plan(TURRET_SCENARIO_STANDARD), pad)).toBe(
      'New weapon: the Shockwave, on Y. It slams the tower and throws back every monster at its foot.',
    );
    expect(banner(plan(TURRET_SCENARIO_STANDARD), touch)).toBe(
      "New weapon: the Shockwave. Tap its socket to throw back every monster at the tower's foot.",
    );
    expect(banner(plan(TURRET_SCENARIO_HARD), pad)).toBe(
      'New weapon: the Fragmentation Shell, on LB. Arm it, then fire at a group: it bursts into bomblets over them.',
    );
    expect(banner(plan(TURRET_SCENARIO_HARD), touch)).toBe(
      'New weapon: the Fragmentation Shell. Tap its socket to arm it, then tap a group: it bursts into bomblets over them.',
    );
    // A mission brings in nothing: the keys of the weapons it gives, and only those.
    expect(banner(plan(TURRET_MISSION_DELUGE), pad)).toBe(
      'Blast the monsters before they reach the tower. Y: Shockwave. LB: Fragmentation Shell.',
    );
    expect(banner(plan(TURRET_MISSION_DELUGE), touch)).toBe(
      'Blast the monsters before they reach the tower. Tap a socket for a Shockwave or a Fragmentation Shell.',
    );
    const fragOnly = plan({ ...TURRET_MISSION_PACK, arsenal: { fragmentation: 5 } });
    expect(banner(fragOnly, pad)).toBe(
      'Blast the monsters before they reach the tower. LB: Fragmentation Shell.',
    );
    expect(banner(fragOnly, touch)).toBe(
      'Blast the monsters before they reach the tower. Tap the socket for a Fragmentation Shell.',
    );
    const shockOnly = plan({ ...TURRET_MISSION_GIANTS, arsenal: { shockwave: 2 } });
    expect(banner(shockOnly, pad)).toBe(
      'Blast the monsters before they reach the tower. Y: Shockwave.',
    );
    expect(banner(shockOnly, touch)).toBe(
      'Blast the monsters before they reach the tower. Tap the socket for a Shockwave.',
    );
    expect(banner(plan(TURRET_MISSION_PACK))).toBe(firstWaveBanner.subtext);
  });

  it("announces a mission's resupply under the cleared wave, naming only the weapons it gave", () => {
    const resupplied = (shockwave: number, fragmentation: number) => {
      const session = seat(START, resolveTurretPlan(TURRET_MISSION_DELUGE));
      const cursor = new TurretFeedbackCursor();
      push(
        session,
        START + 60,
        { type: 'waveCleared', wave: 2 },
        { type: 'resupply', wave: 2, shockwave, fragmentation },
      );
      return cursor.consume(turretSessionView(session));
    };
    expect(resupplied(1, 1)).toEqual({
      text: 'Wave 3 cleared',
      subtext: 'Resupply: +1 Shockwave, +1 Fragmentation Shell',
    });
    expect(resupplied(1, 0)).toEqual({ text: 'Wave 3 cleared', subtext: 'Resupply: +1 Shockwave' });
    expect(resupplied(0, 1)).toEqual({
      text: 'Wave 3 cleared',
      subtext: 'Resupply: +1 Fragmentation Shell',
    });
  });

  it("puts the Veterans' Test's last resupply under its final wave's banner, as the engine batches it", () => {
    // The real engine, a clean nearest-first aimer, to the tick wave 5 (index 4) clears.
    const plan = resolveTurretPlan(TURRET_SCENARIO_HARD);
    const engine = createTurretDefense(plan, { x: 0, z: 0 }, 3, START);
    const flat = { ground: () => 0, water: () => null };
    let batch: TurretEvent[] = [];
    for (let t = START + 1; t < START + 20 * 600 && !batch.length; t++) {
      const events = tickTurretDefense(engine, t, flat);
      if (events.some((e) => e.type === 'resupply' && e.wave === 4)) batch = events;
      if (t < engine.readyTick) continue;
      let best: { x: number; z: number } | null = null;
      let bestD = Number.POSITIVE_INFINITY;
      for (const m of engine.monsters) {
        if (m.hp <= 0) continue;
        const p = positionAt(m.seg, t, flat);
        const d = Math.hypot(p.x, p.z);
        if (d < bestD) {
          bestD = d;
          best = p;
        }
      }
      if (best) fireTurret(engine, t, best.x, best.z, flat);
    }
    // Wave 6 sets off on the tick wave 5 is cleared, so the clear's own banner gives way to it.
    const phases = ['waveCleared', 'resupply', 'waveStart'];
    expect(batch.filter((e) => phases.includes(e.type))).toEqual([
      { type: 'waveCleared', wave: 4 },
      { type: 'resupply', wave: 4, shockwave: 1, fragmentation: 1 },
      { type: 'waveStart', wave: 5, count: plan.waves[5].spawns.length },
    ]);
    expect(engine.stats.resupplies).toBe(2);
    const session = seat(START, plan);
    push(session, START + 60, ...batch);
    expect(new TurretFeedbackCursor().consume(turretSessionView(session))).toEqual({
      text: 'Wave 6 of 6',
      subtext: ['Final wave', 'Resupply: +1 Shockwave, +1 Fragmentation Shell'],
    });
  });

  it("carries a mission's resupply under the next wave's banner, the final wave's line first", () => {
    const launched = (wave: number) => {
      const session = seat(START, resolveTurretPlan(TURRET_MISSION_DELUGE));
      const cursor = new TurretFeedbackCursor();
      push(
        session,
        START + 60,
        { type: 'waveCleared', wave: wave - 1 },
        { type: 'resupply', wave: wave - 1, shockwave: 1, fragmentation: 1 },
        { type: 'waveStart', wave, count: 20 },
      );
      return cursor.consume(turretSessionView(session));
    };
    expect(launched(3)).toEqual({
      text: 'Wave 4 of 8',
      subtext: 'Resupply: +1 Shockwave, +1 Fragmentation Shell',
    });
    // The seventh wave's resupply sets the last one off: both lines, the final wave's first.
    expect(launched(7)).toEqual({
      text: 'Wave 8 of 8',
      subtext: ['Final wave', 'Resupply: +1 Shockwave, +1 Fragmentation Shell'],
    });
  });

  it("never hangs an earlier clear's resupply on a later wave's banner from the same batch", () => {
    // A hidden tab reads several ticks at once: wave 3's clear resupplied, wave 4's did not.
    const session = seat(START, resolveTurretPlan(TURRET_MISSION_DELUGE));
    push(
      session,
      START + 60,
      { type: 'waveCleared', wave: 2 },
      { type: 'resupply', wave: 2, shockwave: 1, fragmentation: 1 },
      { type: 'waveStart', wave: 3, count: 20 },
      { type: 'waveCleared', wave: 3 },
      { type: 'waveStart', wave: 4, count: 20 },
    );
    expect(new TurretFeedbackCursor().consume(turretSessionView(session))).toEqual({
      text: 'Wave 5 of 8',
    });
  });

  it("scores a won mission's charges kept on their own row, none on a loss, and counts the resupplies as given", () => {
    const session = seat(START, resolveTurretPlan(TURRET_MISSION_DELUGE));
    session.defense.phase = 'won';
    session.defense.wave = 5;
    Object.assign(session.defense.stats, { kills: 40, shockwaves: 4, frags: 1, resupplies: 2 });
    session.defense.result = turretResult(session.defense.plan, session.defense);
    const result = new TurretHudView().tick(turretSessionView(session), START).result!;
    // 3 Shockwaves and 2 frags, plus 2 of each resupplied: 1 and 3 left of 5 and 4.
    expect(result.rows[5]).toEqual({ label: 'Shockwaves', value: '4/5' });
    expect(result.rows[6]).toEqual({ label: 'Fragmentation Shells', value: '1/4' });
    expect(result.pointRows[4]).toEqual({ label: 'Charges kept (4)', value: '+240' });
    expect(result.pointRows[5].label).toBe('Total points');
    const lost = seat(START, resolveTurretPlan(TURRET_MISSION_DELUGE));
    lost.defense.phase = 'lost';
    lost.defense.integrity = 0;
    lost.defense.result = turretResult(lost.defense.plan, lost.defense);
    const lostRow = new TurretHudView().tick(turretSessionView(lost), START).result!.pointRows[4];
    expect(lostRow).toEqual({ label: '', value: '' });
  });

  it('lets the end outrank the last wave clear it lands with', () => {
    const session = seat();
    const cursor = new TurretFeedbackCursor();
    push(session, START + 10, { type: 'waveCleared', wave: 5 }, endedEvent('won'));
    expect(cursor.consume(turretSessionView(session))).toEqual({ text: 'Victory!' });
  });

  it('ranks a batch by event, whatever order the events arrive in', () => {
    const ended = seat();
    const cursor = new TurretFeedbackCursor();
    push(ended, START + 10, endedEvent('won'), { type: 'waveCleared', wave: 5 });
    expect(cursor.consume(turretSessionView(ended))).toEqual({ text: 'Victory!' });
    const started = seat(START + 500);
    push(
      started,
      START + 510,
      { type: 'waveStart', wave: 1, count: 8 },
      { type: 'waveCleared', wave: 0 },
    );
    expect(cursor.consume(turretSessionView(started))).toEqual({ text: 'Wave 2 of 6' });
  });

  it('restarts with every seat, and never replays the same seat seen again', () => {
    const cursor = new TurretFeedbackCursor();
    const first = seat();
    push(first, START + 60, { type: 'waveStart', wave: 0, count: 8 });
    expect(cursor.consume(turretSessionView(first))).not.toBeNull();
    const second = seat(START + 1000);
    push(second, START + 1060, { type: 'waveStart', wave: 0, count: 8 });
    expect(second.feedback[0].seq).toBe(first.feedback[0].seq);
    expect(cursor.consume(turretSessionView(second))).toEqual(firstWaveBanner);
    expect(cursor.consume(null)).toBeNull();
    expect(cursor.consume(turretSessionView(second))).toBeNull();
  });

  it('restarts for a seat taken again within the same tick', () => {
    const cursor = new TurretFeedbackCursor();
    const first = seat();
    push(first, START + 60, { type: 'waveStart', wave: 0, count: 8 });
    push(first, START + 90, { type: 'killed', id: 1, x: 0, y: 0, z: 0 });
    expect(cursor.consume(turretSessionView(first))).not.toBeNull();
    const again = seat();
    push(again, START + 60, { type: 'waveStart', wave: 0, count: 8 });
    expect(cursor.consume(turretSessionView(again))).toEqual(firstWaveBanner);
  });

  it('still announces what survived when older entries left the ring unseen', () => {
    const session = seat();
    const cursor = new TurretFeedbackCursor();
    const overflow = TURRET_FEEDBACK_LIMIT + 8;
    for (let i = 0; i < overflow; i++)
      push(session, START + i, { type: 'killed', id: i, x: 0, y: 0, z: 0 });
    push(session, START + overflow + 10, endedEvent('lost'));
    expect(session.feedback[0].seq).toBeGreaterThan(1);
    expect(cursor.consume(turretSessionView(session))).toEqual({ text: 'The tower has fallen' });
  });
});
