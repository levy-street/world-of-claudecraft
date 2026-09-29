// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TURRET_SCENARIO_INTRODUCTION } from '../src/sim/content/fire_and_fly_scenarios';
import { createTurretDefense } from '../src/sim/minigames/turret_defense';
import { resolveTurretPlan } from '../src/sim/minigames/turret_defense_plan';
import { turretResult } from '../src/sim/minigames/turret_result';
import { turretSessionView } from '../src/sim/turret_defense_session';
import type { TurretSession } from '../src/sim/types';
import {
  TURRET_HUD_ID,
  TURRET_LIVE_ID,
  TURRET_RAIL_ID,
  TurretHudPainter,
} from '../src/ui/hud/vehicle/turret_hud_painter';
import { TurretHudView } from '../src/ui/hud/vehicle/turret_hud_view';
import { setLanguage } from '../src/ui/i18n';
import { makeWriterFacet } from '../src/ui/painter_host';

const START = 300;

function seat(plan = resolveTurretPlan()): TurretSession {
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
  const writers = makeWriterFacet(new Map(), new Map(), new Map(), new Map(), writes, () => {});
  const painter = new TurretHudPainter(writers, onLeave);
  document.body.append(painter.strip, painter.rail, painter.live);
  return { painter, writes, onLeave, view: new TurretHudView() };
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

  it("gives the rail the scenario's maximum, and changes it with the next seat's", () => {
    const { painter, view } = rig();
    painter.show(true);
    painter.paint(view.tick(turretSessionView(seat()), START), 'Esc');
    expect(painter.rail.getAttribute('aria-valuemin')).toBe('0');
    expect(painter.rail.getAttribute('aria-valuemax')).toBe('100');
    expect(painter.rail.getAttribute('aria-valuenow')).toBe('100');
    view.reset();
    const intro = seat(resolveTurretPlan(TURRET_SCENARIO_INTRODUCTION));
    painter.paint(view.tick(turretSessionView(intro), START), 'Esc');
    const max = String(TURRET_SCENARIO_INTRODUCTION.integrity);
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
      'Tower',
    ]);
    leave.click();
    expect(onLeave).toHaveBeenCalledTimes(1);
  });

  it('names the medal beside its tinted disc and lists the points, then writes nothing more', () => {
    const { painter, writes, view } = rig();
    painter.show(true);
    const won = ended('won', 95);
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
      ['Tower kept (95)', '+19,000'],
      ['Keg kills (0)', '0'],
      ['Bowled over (0)', '0'],
      ['Total points', '20,420'],
    ]);
    expect(points.lastElementChild!.classList.contains('turret-card-total')).toBe(true);
    const view95 = turretSessionView(won);
    writes.mockClear();
    for (let i = 0; i < 10; i++) painter.paint(view.tick(view95, START + i), 'Esc');
    expect(writes).not.toHaveBeenCalled();

    painter.paint(view.tick(turretSessionView(ended('won', 70)), START), 'Esc');
    expect(medal.querySelector('.turret-card-medal-text')!.textContent).toBe('Silver medal');
    expect(tints(medal)).toEqual(['silver']);
    painter.paint(view.tick(turretSessionView(ended('lost', 0)), START), 'Esc');
    expect(medal.querySelector('.turret-card-medal-text')!.textContent).toBe('No medal');
    expect(tints(medal)).toEqual([]);
    expect(icon.style.display).toBe('none');
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
    const painter = new TurretHudPainter(writers, vi.fn());
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
