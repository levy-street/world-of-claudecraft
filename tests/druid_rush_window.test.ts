import { describe, expect, it } from 'vitest';
import {
  BRUIN_RUSH_WINDOW_ID,
  BRUIN_RUSH_WINDOW_SECONDS,
  bruinRushWindowTargetId,
  finishBruinRush,
  openBruinRushWindow,
} from '../src/sim/combat/druid_rush_window';
import type { SimContext } from '../src/sim/sim_context';
import type { Aura, Entity, SimEvent } from '../src/sim/types';

// The leaf's guard arms, pinned without a Sim: the charge-route arrival hook
// calls finishBruinRush for EVERY charge (warrior Onrush and Intervene, Lunge,
// Bruin Rush), so the no-op arms are what keep it a druid-only rider. The Sim
// level rigs live in tests/druid_wildfang_kit.test.ts.

function entity(id: number, auras: Aura[] = []): Entity {
  return { id, auras, dead: false } as unknown as Entity;
}

function windowAura(sourceId: number, targetId: number, remaining: number): Aura {
  return {
    id: BRUIN_RUSH_WINDOW_ID,
    name: 'Bruin Rush',
    kind: 'internal_cd',
    remaining,
    duration: BRUIN_RUSH_WINDOW_SECONDS,
    value: targetId,
    sourceId,
    school: 'physical',
  } as Aura;
}

function fakeCtx(events: SimEvent[] = []): SimContext {
  return {
    emit: (ev: SimEvent) => events.push(ev),
    applyAura: (target: Entity, aura: Aura) => target.auras.push(aura),
  } as unknown as SimContext;
}

describe('finishBruinRush, the route-end re-arm', () => {
  it('re-arms a live window for the route target to its full length', () => {
    const target = entity(9);
    const druid = entity(1, [windowAura(1, 9, 1.2)]);
    finishBruinRush(fakeCtx(), druid, target);
    expect(druid.auras[0].remaining).toBe(BRUIN_RUSH_WINDOW_SECONDS);
    expect(druid.auras[0].duration).toBe(BRUIN_RUSH_WINDOW_SECONDS);
    expect(druid.auras).toHaveLength(1);
  });

  it('is a no-op for a runner without the window (every non-druid charge)', () => {
    const target = entity(9);
    const other: Aura = { ...windowAura(2, 9, 1.2), id: 'loping_stride', kind: 'buff_speed' };
    const warrior = entity(2, [other]);
    finishBruinRush(fakeCtx(), warrior, target);
    expect(warrior.auras).toEqual([other]);
  });

  it('leaves a window for a different target untouched', () => {
    const target = entity(9);
    const druid = entity(1, [windowAura(1, 7, 1.2)]);
    finishBruinRush(fakeCtx(), druid, target);
    expect(druid.auras[0].remaining).toBe(1.2);
  });

  it('does not re-arm when the route ended on a dead target or no target', () => {
    const dead = entity(9);
    dead.dead = true;
    const druid = entity(1, [windowAura(1, 9, 1.2)]);
    finishBruinRush(fakeCtx(), druid, dead);
    finishBruinRush(fakeCtx(), druid, null);
    expect(druid.auras[0].remaining).toBe(1.2);
  });
});

describe('openBruinRushWindow, the cast arm', () => {
  it('opens the window carrying the Rush target id', () => {
    const events: SimEvent[] = [];
    const druid = entity(1);
    openBruinRushWindow(fakeCtx(events), druid, entity(9));
    expect(bruinRushWindowTargetId(druid)).toBe(9);
    expect(druid.auras[0].remaining).toBe(BRUIN_RUSH_WINDOW_SECONDS);
    expect(events).toEqual([]);
  });

  it('fades a live window before re-opening it, like every other removal of the aura', () => {
    const events: SimEvent[] = [];
    const druid = entity(1, [windowAura(1, 7, 0.5)]);
    openBruinRushWindow(fakeCtx(events), druid, entity(9));
    expect(druid.auras).toHaveLength(1);
    expect(bruinRushWindowTargetId(druid)).toBe(9);
    expect(events).toEqual([{ type: 'aura', targetId: 1, name: 'Bruin Rush', gained: false }]);
  });

  it('reads null with no window live', () => {
    expect(bruinRushWindowTargetId(entity(1))).toBeNull();
  });
});
