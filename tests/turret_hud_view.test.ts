import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TURRET_TIMING } from '../src/sim/content/turret_defense';
import { createTurretDefense, type TurretEvent } from '../src/sim/minigames/turret_defense';
import { resolveTurretPlan } from '../src/sim/minigames/turret_defense_plan';
import { recordTurretFeedback, TURRET_FEEDBACK_LIMIT } from '../src/sim/minigames/turret_feedback';
import { turretSessionView } from '../src/sim/turret_defense_session';
import { TICK_RATE, type TurretSession } from '../src/sim/types';
import { TurretFeedbackCursor, TurretHudView } from '../src/ui/hud/vehicle/turret_hud_view';
import { ensureLocaleLoaded, setLanguage, t } from '../src/ui/i18n';
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

describe('the turret HUD view', () => {
  it('counts down to the first wave from the clock', () => {
    const session = seat();
    const view = new TurretHudView();
    const frame = view.tick(turretSessionView(session), START);
    expect(frame.wave).toBe('Wave 1/6');
    expect(frame.left).toBe('');
    expect(frame.phase).toBe(`First wave in ${TURRET_TIMING.introTicks / TICK_RATE} sec`);
    expect(view.tick(turretSessionView(session), START + TURRET_TIMING.introTicks - 1).phase).toBe(
      'First wave in 1 sec',
    );
    expect(frame.integrity).toBe(1);
    expect(frame.integrityText).toBe(`${TURRET_TIMING.integrity}/${TURRET_TIMING.integrity}`);
    expect(frame.result).toBeNull();
  });

  it('shows the wave, the monsters left and the fire hint during a wave', () => {
    const session = seat();
    session.defense.phase = 'wave';
    session.defense.wave = 2;
    session.defense.integrity = 20;
    const frame = new TurretHudView().tick(turretSessionView(session), START);
    expect(frame.wave).toBe('Wave 3/6');
    expect(frame.left).toBe(
      `Monsters left: ${resolveTurretPlan().waves[2].spawns.length.toLocaleString('en')}`,
    );
    expect(frame.phase).toBe('Aim with the mouse and click to fire.');
    expect(frame.integrity).toBeCloseTo(0.2);
    expect(frame.low).toBe(true);
  });

  it('announces the next wave countdown between waves', () => {
    const session = seat();
    session.defense.phase = 'between';
    session.defense.wave = 1;
    session.defense.phaseEndTick = START + 4 * TICK_RATE;
    const frame = new TurretHudView().tick(turretSessionView(session), START + 1);
    expect(frame.phase).toBe('Wave cleared. Next wave in 4 sec');
    expect(frame.wave).toBe('Wave 2/6');
  });

  it('builds the result panel with every stat once the defense ends', () => {
    const session = seat();
    session.defense.phase = 'won';
    session.defense.wave = 5;
    Object.assign(session.defense.stats, {
      shots: 40,
      hits: 30,
      kills: 55,
      longestThrow: 23.46,
      longestAirtime: 1.84,
    });
    const frame = new TurretHudView().tick(turretSessionView(session), START);
    expect(frame.phase).toBe('');
    expect(frame.result).toEqual({
      won: true,
      title: 'Victory!',
      lines: [
        'Kills: 55',
        'Shots fired: 40',
        'Accuracy: 75%',
        'Longest throw: 23.5 yards',
        'Longest airtime: 1.8 sec',
      ],
    });
    const lost = seat();
    lost.defense.phase = 'lost';
    const lostFrame = new TurretHudView().tick(turretSessionView(lost), START);
    expect(lostFrame.result?.won).toBe(false);
    expect(lostFrame.result?.title).toBe('The turret has fallen');
    expect(lostFrame.result?.lines[2]).toBe('Accuracy: 0%');
  });

  it('holds a countdown at zero once the phase end tick has passed', () => {
    const session = seat();
    const frame = new TurretHudView().tick(
      turretSessionView(session),
      START + TURRET_TIMING.introTicks + 3 * TICK_RATE,
    );
    expect(frame.phase).toBe('First wave in 0 sec');
  });

  it('shows no countdown without a clock to count from', () => {
    const intro = seat();
    expect(new TurretHudView().tick(turretSessionView(intro), null).phase).toBe('');
    const between = seat();
    between.defense.phase = 'between';
    expect(new TurretHudView().tick(turretSessionView(between), null).phase).toBe('');
  });

  it('reuses one frame and one result panel, rebuilt only when the view or the second changes', () => {
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
    expect(next.result?.lines).toBe(result?.lines);
    expect(next.result?.lines[0]).toBe('Kills: 3');
    const countingView = turretSessionView(seat());
    view.tick(countingView, START);
    translate.mockClear();
    view.tick(countingView, START + 1);
    expect(translate).not.toHaveBeenCalled();
    expect(view.tick(countingView, START + TICK_RATE).phase).toBe(
      `First wave in ${TURRET_TIMING.introTicks / TICK_RATE - 1} sec`,
    );
  });

  it('rebuilds an unchanged view when the language changes', async () => {
    const ended = seat();
    ended.defense.phase = 'won';
    const endedView = turretSessionView(ended);
    const view = new TurretHudView();
    expect(view.tick(endedView, START).result?.title).toBe('Victory!');
    await ensureLocaleLoaded('zh_CN');
    setLanguage('zh_CN');
    expect(view.tick(endedView, START).result?.title).toBe('胜利！');
  });
});

describe('the turret feedback cursor', () => {
  it('turns each wave and end event into one banner, never twice', () => {
    const session = seat();
    const cursor = new TurretFeedbackCursor();
    expect(cursor.consume(turretSessionView(session))).toBeNull();
    push(session, START + 60, { type: 'waveStart', wave: 0, count: 8 });
    expect(cursor.consume(turretSessionView(session))).toEqual({ text: 'Wave 1 of 6' });
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
    expect(cursor.consume(turretSessionView(second))).toEqual({ text: 'Wave 1 of 6' });
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
    expect(cursor.consume(turretSessionView(again))).toEqual({ text: 'Wave 1 of 6' });
  });

  it('still announces what survived when older entries left the ring unseen', () => {
    const session = seat();
    const cursor = new TurretFeedbackCursor();
    const overflow = TURRET_FEEDBACK_LIMIT + 8;
    for (let i = 0; i < overflow; i++)
      push(session, START + i, { type: 'killed', id: i, x: 0, y: 0, z: 0 });
    push(session, START + overflow + 10, { type: 'ended', result: 'lost', stats: { ...stats } });
    expect(session.feedback[0].seq).toBeGreaterThan(1);
    expect(cursor.consume(turretSessionView(session))).toEqual({ text: 'The turret has fallen' });
  });
});
