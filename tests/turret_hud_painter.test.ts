// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTurretDefense } from '../src/sim/minigames/turret_defense';
import { resolveTurretPlan } from '../src/sim/minigames/turret_defense_plan';
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

function seat(): TurretSession {
  return {
    kind: 'turret',
    origin: { x: 0, y: 0, z: 0 },
    defense: createTurretDefense(resolveTurretPlan(), { x: 0, z: 0 }, 7, START),
    priorMountKey: '',
    returnTo: { x: 0, y: 0, z: 0, facing: 0 },
    feedback: [],
    nextFeedbackSeq: 1,
  };
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
    const labels = [...painter.strip.querySelectorAll('.turret-card-stats dt')].map(
      (dt) => dt.textContent,
    );
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
