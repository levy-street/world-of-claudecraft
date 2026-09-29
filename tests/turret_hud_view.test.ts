import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TURRET_TIMING } from '../src/sim/content/turret_defense';
import { createTurretDefense, type TurretEvent } from '../src/sim/minigames/turret_defense';
import { resolveTurretPlan } from '../src/sim/minigames/turret_defense_plan';
import { recordTurretFeedback, TURRET_FEEDBACK_LIMIT } from '../src/sim/minigames/turret_feedback';
import { turretSessionView } from '../src/sim/turret_defense_session';
import { TICK_RATE, type TurretSession } from '../src/sim/types';
import {
  TURRET_INTEGRITY_ALERTS,
  TURRET_RESULT_ROWS,
  TurretFeedbackCursor,
  TurretHudView,
} from '../src/ui/hud/vehicle/turret_hud_view';
import { ensureLocaleLoaded, setLanguage, t } from '../src/ui/i18n';
import type { TurretSessionView } from '../src/world_api/vehicles';
import { probeAllocationStability } from './util/alloc_probe';

vi.mock('../src/ui/i18n', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/ui/i18n')>();
  return { ...actual, t: vi.fn(actual.t) };
});

const START = 200;

function seat(start = START): TurretSession {
  return {
    kind: 'turret',
    origin: { x: 0, y: 0, z: 0 },
    defense: createTurretDefense(resolveTurretPlan(), { x: 0, z: 0 }, 3, start),
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
};

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
    expect(frame.integrityText).toBe(`${TURRET_TIMING.integrity}/${TURRET_TIMING.integrity}`);
    expect(frame.result).toBeNull();
  });

  it('names the seat, its rail and its Leave button in the tower wording', () => {
    const { labels } = new TurretHudView().tick(turretSessionView(seat()), START);
    expect(labels).toEqual({
      title: 'Fire and Fly',
      meter: 'Tower integrity',
      caption: 'Tower',
      leave: 'Leave the tower',
      leaveShort: 'Leave',
    });
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

  it('counts down to the next wave between waves, without repeating the cleared banner', () => {
    const session = seat();
    session.defense.phase = 'between';
    session.defense.wave = 1;
    session.defense.phaseEndTick = START + 4 * TICK_RATE;
    const frame = new TurretHudView().tick(turretSessionView(session), START + 1);
    expect(frame.slot).toBe('Next wave in 4 sec');
    expect(frame.wave).toBe('Wave 2/6');
  });

  it('builds the result card with every stat and the final tower once the defense ends', () => {
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
    });
    const frame = new TurretHudView().tick(turretSessionView(session), START);
    expect(frame.slot).toBe('');
    expect(frame.result).toEqual({
      won: true,
      verdict: 'Victory!',
      rows: [
        { label: 'Kills', value: '55' },
        { label: 'Shots fired', value: '40' },
        { label: 'Accuracy', value: '75%' },
        { label: 'Longest throw', value: '23.5 yd' },
        { label: 'Longest airtime', value: '1.8 sec' },
        { label: 'Tower', value: `72/${TURRET_TIMING.integrity}` },
      ],
    });
    expect(frame.result?.rows).toHaveLength(TURRET_RESULT_ROWS);
    const lost = seat();
    lost.defense.phase = 'lost';
    const lostFrame = new TurretHudView().tick(turretSessionView(lost), START);
    expect(lostFrame.result?.won).toBe(false);
    expect(lostFrame.result?.verdict).toBe('The tower has fallen');
    expect(lostFrame.result?.rows[2].value).toBe('0%');
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
    const between = seat();
    between.defense.phase = 'between';
    expect(new TurretHudView().tick(turretSessionView(between), null).slot).toBe('');
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
    session.defense.phase = 'between';
    session.defense.phaseEndTick = START + 100 + 5 * TICK_RATE;
    session.defense.rev++;
    expect(view.tick(turretSessionView(session), START + 100).announce).toBe('Next wave in 5 sec');
    expect(view.tick(turretSessionView(session), START + 100 + TICK_RATE).announce).toBe(
      'Next wave in 5 sec',
    );
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
    const max = TURRET_TIMING.integrity;
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

  it('lets the end outrank the last wave clear it lands with', () => {
    const session = seat();
    const cursor = new TurretFeedbackCursor();
    push(
      session,
      START + 10,
      { type: 'waveCleared', wave: 5 },
      { type: 'ended', result: 'won', stats: { ...stats } },
    );
    expect(cursor.consume(turretSessionView(session))).toEqual({ text: 'Victory!' });
  });

  it('ranks a batch by event, whatever order the events arrive in', () => {
    const ended = seat();
    const cursor = new TurretFeedbackCursor();
    push(
      ended,
      START + 10,
      { type: 'ended', result: 'won', stats: { ...stats } },
      { type: 'waveCleared', wave: 5 },
    );
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
    push(session, START + overflow + 10, { type: 'ended', result: 'lost', stats: { ...stats } });
    expect(session.feedback[0].seq).toBeGreaterThan(1);
    expect(cursor.consume(turretSessionView(session))).toEqual({ text: 'The tower has fallen' });
  });
});
