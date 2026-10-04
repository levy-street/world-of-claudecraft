// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TURRET_MISSION_BRITTLE } from '../src/sim/content/fire_and_fly_missions';
import {
  TURRET_SCENARIO_HARD,
  TURRET_SCENARIO_STANDARD,
} from '../src/sim/content/fire_and_fly_scenarios';
import { TURRET_TIMING, TURRET_TOWER_POINTS } from '../src/sim/content/turret_defense';
import { createTurretDefense } from '../src/sim/minigames/turret_defense';
import { resolveTurretPlan } from '../src/sim/minigames/turret_defense_plan';
import { turretResult } from '../src/sim/minigames/turret_result';
import { turretSessionView } from '../src/sim/turret_defense_session';
import { TICK_RATE, type TurretSession } from '../src/sim/types';
import {
  TURRET_HUD_ID,
  TURRET_LIVE_ID,
  TURRET_RAIL_ID,
  TurretHudPainter,
} from '../src/ui/hud/vehicle/turret_hud_painter';
import { TurretHudView } from '../src/ui/hud/vehicle/turret_hud_view';
import { setLanguage } from '../src/ui/i18n';
import { makeWriterFacet } from '../src/ui/painter_host';
import { resolveArmedTurretPlan } from './helpers/turret_armed_plan';

const START = 300;

function seat(plan = resolveArmedTurretPlan()): TurretSession {
  return {
    kind: 'turret',
    origin: { x: 0, y: 0, z: 0 },
    defense: createTurretDefense(plan, { x: 0, z: 0 }, 7, START),
    priorMountKey: '',
    returnTo: { x: 0, y: 0, z: 0, facing: 0 },
    feedback: [],
    nextFeedbackSeq: 1,
  };
}

/** An ended seat whose result the sim's own rule scored: 71 kills, `integrity` kept. */
function ended(phase: 'won' | 'lost', integrity: number): TurretSession {
  const session = seat();
  session.defense.phase = phase;
  session.defense.integrity = integrity;
  session.defense.stats.kills = 71;
  session.defense.result = turretResult(session.defense.plan, session.defense);
  return session;
}

/** The medal modifier classes the line carries, by medal name. */
function tints(line: HTMLElement): string[] {
  return ['gold', 'silver', 'bronze'].filter((m) =>
    line.classList.contains(`turret-card-medal--${m}`),
  );
}

function rig() {
  const writes = vi.fn();
  const onLeave = vi.fn();
  const onReplay = vi.fn();
  const writers = makeWriterFacet(new Map(), new Map(), new Map(), new Map(), writes, () => {});
  const painter = new TurretHudPainter(writers, onLeave, onReplay);
  document.body.append(painter.strip, painter.rail, painter.live);
  return { painter, writes, onLeave, onReplay, view: new TurretHudView() };
}

beforeEach(() => {
  setLanguage('en');
  document.body.replaceChildren();
});

describe('the turret HUD painter', () => {
  it('builds both roots hidden, and shows them only while seated', () => {
    const { painter } = rig();
    expect(painter.strip.id).toBe(TURRET_HUD_ID);
    expect(painter.rail.id).toBe(TURRET_RAIL_ID);
    expect(painter.strip.tagName).toBe('SECTION');
    expect(painter.strip.style.display).toBe('none');
    expect(painter.rail.style.display).toBe('none');
    expect(painter.rail.contains(painter.railBar)).toBe(true);
    expect(painter.railBar.querySelector('.ui-bevel .ui-bevel-fill')).not.toBeNull();
    painter.show(true);
    expect(painter.strip.style.display).toBe('');
    expect(painter.rail.style.display).toBe('');
  });

  it('writes a frame once, then nothing until it changes, then only what changed', () => {
    const { painter, writes, view } = rig();
    painter.show(true);
    const session = seat();
    session.defense.phase = 'wave';
    const first = turretSessionView(session);
    painter.paint(view.tick(first, START), 'Esc');
    expect(writes).toHaveBeenCalled();
    writes.mockClear();
    for (let i = 0; i < 30; i++) painter.paint(view.tick(first, START + i), 'Esc');
    expect(writes).not.toHaveBeenCalled();
    painter.paint(view.tick({ ...first, monstersLeft: first.monstersLeft - 1 }, START), 'Esc');
    expect(writes).toHaveBeenCalledTimes(1);
    expect(painter.strip.querySelector('.turret-strip-slot')!.textContent).toBe(
      `Monsters left: ${first.monstersLeft - 1}`,
    );
    writes.mockClear();
    painter.paint(view.tick({ ...first, monstersLeft: first.monstersLeft - 1 }, START), 'Menu');
    expect(writes).toHaveBeenCalledTimes(1);
    expect(painter.strip.querySelector('.turret-leave-key')!.textContent).toBe('Menu');
  });

  it('hides the result row of a weapon the trial gives none of, and shows it for the next', () => {
    const { painter, view } = rig();
    painter.show(true);
    const statRows = () => [
      ...painter.strip.querySelectorAll<HTMLElement>(
        '.turret-card-stats:not(.turret-card-points) .ui-stat-row',
      ),
    ];
    const run = (arsenal: { shockwave: number; fragmentation: number }) => {
      const session = seat(resolveTurretPlan({ ...TURRET_SCENARIO_STANDARD, arsenal }));
      session.defense.phase = 'won';
      session.defense.result = turretResult(session.defense.plan, session.defense);
      view.reset();
      painter.paint(view.tick(turretSessionView(session), START), 'Esc');
    };
    run({ shockwave: 0, fragmentation: 3 });
    expect(statRows().map((row) => row.style.display)).toEqual([
      '',
      '',
      '',
      '',
      '',
      'none',
      '',
      '',
    ]);
    expect(statRows()[6].textContent).toBe('Fragmentation Shells0/3');
    run({ shockwave: 2, fragmentation: 3 });
    expect(statRows()[5].style.display).toBe('');
    expect(statRows()[5].textContent).toBe('Shockwaves0/2');
  });

  it("gives the rail the scenario's maximum, and changes it with the next seat's", () => {
    const { painter, view } = rig();
    painter.show(true);
    painter.paint(view.tick(turretSessionView(seat()), START), 'Esc');
    expect(painter.rail.getAttribute('aria-valuemin')).toBe('0');
    expect(painter.rail.getAttribute('aria-valuemax')).toBe(String(TURRET_TOWER_POINTS));
    expect(painter.rail.getAttribute('aria-valuenow')).toBe(String(TURRET_TOWER_POINTS));
    view.reset();
    // The Cracked Tower holds fewer points than every other seat: the rail must follow it.
    const brittle = seat(resolveTurretPlan(TURRET_MISSION_BRITTLE));
    painter.paint(view.tick(turretSessionView(brittle), START), 'Esc');
    const max = String(TURRET_MISSION_BRITTLE.integrity);
    expect(max).not.toBe(String(TURRET_TOWER_POINTS));
    expect(painter.rail.getAttribute('aria-valuemax')).toBe(max);
    expect(painter.rail.getAttribute('aria-valuenow')).toBe(max);
    expect(painter.rail.querySelector('.turret-rail-value')!.textContent).toBe(`${max}/${max}`);
  });

  it('unfolds the card at the end and turns Leave into the large button', () => {
    const { painter, view, onLeave } = rig();
    painter.show(true);
    const session = seat();
    session.defense.phase = 'won';
    painter.paint(view.tick(turretSessionView(session), START), 'Esc');
    expect(painter.strip.classList.contains('ended')).toBe(true);
    const leave = painter.strip.querySelector<HTMLButtonElement>('.turret-leave')!;
    expect(leave.classList.contains('ui-btn--lg')).toBe(true);
    expect(leave.querySelector('.turret-leave-label')!.textContent).toBe('Leave the tower');
    const labels = [
      ...painter.strip.querySelectorAll('.turret-card-stats:not(.turret-card-points) dt'),
    ].map((dt) => dt.textContent);
    expect(labels).toEqual([
      'Kills',
      'Shots fired',
      'Accuracy',
      'Longest throw',
      'Longest airtime',
      'Shockwaves',
      'Fragmentation Shells',
      'Tower',
    ]);
    leave.click();
    expect(onLeave).toHaveBeenCalledTimes(1);
    // A second finger (the stick's thumb already down) gets no click from the browser.
    const init = { bubbles: true, pointerId: 7, pointerType: 'touch', isPrimary: false };
    leave.dispatchEvent(new PointerEvent('pointerdown', init));
    leave.dispatchEvent(new PointerEvent('pointerup', init));
    expect(onLeave).toHaveBeenCalledTimes(2);
  });

  it('offers Replay beside Leave only on the ended card, written once, and hides it for the replayed run', () => {
    const { painter, writes, view, onReplay, onLeave } = rig();
    painter.show(true);
    const replay = painter.strip.querySelector<HTMLButtonElement>('.turret-replay')!;
    const leave = painter.strip.querySelector<HTMLButtonElement>('.turret-leave')!;
    expect(replay.type).toBe('button');
    expect(replay.classList.contains('ui-btn')).toBe(true);
    expect(replay.classList.contains('ui-btn--lg')).toBe(true);
    expect(replay.nextElementSibling).toBe(leave);
    painter.paint(view.tick(turretSessionView(seat()), START), 'Esc');
    expect(replay.style.display).toBe('none');

    const lost = turretSessionView(ended('lost', 0));
    painter.paint(view.tick(lost, START), 'Esc');
    expect(replay.style.display).toBe('');
    expect(replay.textContent).toBe('Replay');
    expect(replay.getAttribute('title')).toBe(
      "Play the same trial again from the tower. Once today's reward is earned, a replay pays no reward.",
    );
    expect(leave.querySelector('.turret-leave-label')!.textContent).toBe('Leave the tower');
    writes.mockClear();
    for (let i = 0; i < 10; i++) painter.paint(view.tick(lost, START + i), 'Esc');
    expect(writes).not.toHaveBeenCalled();
    replay.click();
    expect(onReplay).toHaveBeenCalledTimes(1);
    const init = { bubbles: true, pointerId: 7, pointerType: 'touch', isPrimary: false };
    replay.dispatchEvent(new PointerEvent('pointerdown', init));
    replay.dispatchEvent(new PointerEvent('pointerup', init));
    expect(onReplay).toHaveBeenCalledTimes(2);
    expect(onLeave).not.toHaveBeenCalled();

    // The replayed run: a new seat in its intro, the strip back and Replay gone.
    const next = seat();
    next.defense = createTurretDefense(next.defense.plan, { x: 0, z: 0 }, 8, START + 900);
    painter.paint(view.tick(turretSessionView(next), START + 900), 'Esc');
    expect(replay.style.display).toBe('none');
    expect(painter.strip.classList.contains('ended')).toBe(false);
    expect(leave.querySelector('.turret-leave-label')!.textContent).toBe('Leave');
    expect(painter.live.textContent).toBe('First wave in 3 sec');
  });

  it("heads the card with the seat's trial, written once, and the next seat's in turn", () => {
    const { painter, writes, view } = rig();
    painter.show(true);
    const kicker = painter.strip.querySelector('.turret-card-kicker')!;
    const standard = seat();
    standard.defense.phase = 'won';
    const first = turretSessionView(standard);
    painter.paint(view.tick(first, START), 'Esc');
    expect(kicker.textContent).toBe('Standing Watch');
    expect(kicker.getAttribute('aria-hidden')).toBe('true');
    expect(painter.strip.getAttribute('aria-label')).toBe('Standing Watch');
    writes.mockClear();
    for (let i = 0; i < 10; i++) painter.paint(view.tick({ ...first }, START), 'Esc');
    expect(writes).not.toHaveBeenCalled();
    view.reset();
    const hard = seat(resolveTurretPlan(TURRET_SCENARIO_HARD));
    hard.defense.phase = 'lost';
    painter.paint(view.tick(turretSessionView(hard), START), 'Esc');
    expect(kicker.textContent).toBe("Veterans' Test");
    expect(painter.strip.getAttribute('aria-label')).toBe("Veterans' Test");
  });

  it('names the medal beside its tinted disc and lists the points, then writes nothing more', () => {
    const { painter, writes, view } = rig();
    painter.show(true);
    const won = ended('won', 69);
    painter.paint(view.tick(turretSessionView(won), START), 'Esc');
    const medal = painter.strip.querySelector<HTMLElement>('.turret-card-medal')!;
    const icon = medal.querySelector<HTMLElement>('.turret-card-medal-icon')!;
    const points = painter.strip.querySelector<HTMLElement>('.turret-card-points')!;
    expect(medal.style.display).toBe('');
    expect(points.style.display).toBe('');
    expect(medal.querySelector('.turret-card-medal-text')!.textContent).toBe('Gold medal');
    expect(tints(medal)).toEqual(['gold']);
    expect(icon.getAttribute('aria-hidden')).toBe('true');
    expect(icon.style.display).toBe('');
    expect(
      [...points.querySelectorAll('.ui-stat-row')].map((row) => [
        row.querySelector('dt')!.textContent,
        row.querySelector('dd')!.textContent,
      ]),
    ).toEqual([
      ['Kills (71)', '+1,420'],
      ['Tower kept (69)', '+13,800'],
      ['Keg kills (0)', '0'],
      ['Bowled over (0)', '0'],
      ['', ''],
      ['Total points', '15,220'],
    ]);
    // A trial scores no charge kept: its row is hidden, the total stays the last row.
    const rows = [...points.querySelectorAll<HTMLElement>('.ui-stat-row')];
    expect(rows.map((row) => row.style.display)).toEqual(['', '', '', '', 'none', '']);
    expect(points.lastElementChild!.classList.contains('turret-card-total')).toBe(true);
    const wonView = turretSessionView(won);
    writes.mockClear();
    for (let i = 0; i < 10; i++) painter.paint(view.tick(wonView, START + i), 'Esc');
    expect(writes).not.toHaveBeenCalled();

    painter.paint(view.tick(turretSessionView(ended('won', 50)), START), 'Esc');
    expect(medal.querySelector('.turret-card-medal-text')!.textContent).toBe('Silver medal');
    expect(tints(medal)).toEqual(['silver']);
    painter.paint(view.tick(turretSessionView(ended('lost', 0)), START), 'Esc');
    expect(medal.querySelector('.turret-card-medal-text')!.textContent).toBe('No medal');
    expect(tints(medal)).toEqual([]);
    expect(icon.style.display).toBe('none');
  });

  it("writes the seat's own leave countdown under the points once per second, empty until then", () => {
    const { painter, writes, view } = rig();
    painter.show(true);
    const lost = ended('lost', 0);
    lost.defense.phaseEndTick = START;
    const lostView = turretSessionView(lost);
    const line = painter.strip.querySelector<HTMLElement>('.turret-card-leaving')!;
    expect(line.parentElement?.lastElementChild).toBe(line);
    const leaves = START + TURRET_TIMING.endedSeatTicks;
    painter.paint(view.tick(lostView, START), 'Esc');
    expect(line.textContent).toBe('');
    painter.paint(view.tick(lostView, leaves - 30 * TICK_RATE), 'Esc');
    expect(line.textContent).toBe('Leaving the tower in 30 sec');
    writes.mockClear();
    for (let i = 1; i < TICK_RATE; i++) {
      painter.paint(view.tick(lostView, leaves - 30 * TICK_RATE + i), 'Esc');
    }
    expect(writes).not.toHaveBeenCalled();
    painter.paint(view.tick(lostView, leaves - 29 * TICK_RATE), 'Esc');
    expect(writes).toHaveBeenCalledTimes(1);
    expect(line.textContent).toBe('Leaving the tower in 29 sec');
  });

  it('hides the medal line and the points while the ended view carries no result', () => {
    const { painter, view } = rig();
    painter.show(true);
    const session = seat();
    session.defense.phase = 'won';
    painter.paint(view.tick(turretSessionView(session), START), 'Esc');
    expect(painter.strip.querySelector<HTMLElement>('.turret-card-medal')!.style.display).toBe(
      'none',
    );
    expect(painter.strip.querySelector<HTMLElement>('.turret-card-points')!.style.display).toBe(
      'none',
    );
    expect(painter.strip.querySelector('.turret-card-verdict')!.textContent).toBe('Victory!');
  });

  it('keeps the live line outside both roots, rendered and empty while they hide', () => {
    const writers = makeWriterFacet(new Map(), new Map(), new Map(), new Map(), vi.fn(), () => {});
    const painter = new TurretHudPainter(writers, vi.fn(), vi.fn());
    const live = painter.live;
    expect(live.id).toBe(TURRET_LIVE_ID);
    expect(live.getAttribute('role')).toBe('status');
    expect(live.getAttribute('aria-live')).toBe('polite');
    expect(live.getAttribute('aria-atomic')).toBe('true');
    expect(live.classList.contains('visually-hidden')).toBe(true);
    expect(painter.strip.contains(live)).toBe(false);
    expect(painter.rail.contains(live)).toBe(false);
    expect(painter.strip.querySelector('[role="status"]')).toBeNull();
    expect(live.style.display).toBe('');
    expect(live.textContent).toBe('');
  });

  it('clears the live line on leaving, so the next seat speaks again', () => {
    const { painter, view } = rig();
    painter.show(true);
    painter.paint(view.tick(turretSessionView(seat()), START), 'Esc');
    const live = painter.live;
    expect(live.textContent).toBe('First wave in 3 sec');
    painter.show(false);
    expect(live.textContent).toBe('');
    expect(live.style.display).toBe('');
    expect(painter.strip.style.display).toBe('none');
  });
});

it('turret_hud_painter carries no literal colour or px value: tokens and classes only', () => {
  const code = readFileSync(join(process.cwd(), 'src/ui/hud/vehicle/turret_hud_painter.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
  expect(code.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).toEqual([]);
  expect(code.match(/\b(?:rgba?|hsla?|oklch)\s*\(/g) ?? []).toEqual([]);
  expect(code.match(/\b\d+(?:\.\d+)?px\b/g) ?? []).toEqual([]);
});
