import { describe, expect, it } from 'vitest';
import { isUpdateDue } from '../server/entity_update_cadence';
import { VALE_CUP_BALL_TEMPLATE_ID } from '../src/sim/content/vale_cup';
import type { Entity } from '../src/sim/types';

// A minimal entity: isUpdateDue reads only id, templateId, aggroTargetId (plus
// the viewer's targetId, read off the passed-in viewer entity).
function mkEntity(overrides: Partial<Entity> = {}): Entity {
  return {
    id: 1,
    templateId: 'forest_wolf',
    targetId: null,
    aggroTargetId: null,
    ...overrides,
  } as unknown as Entity;
}

describe('entity_update_cadence: isUpdateDue', () => {
  it('the Vale Cup ball is always due, regardless of distance or how long ago it last sent', () => {
    const ball = mkEntity({ id: 5, templateId: VALE_CUP_BALL_TEMPLATE_ID });
    const viewer = mkEntity({ id: 1 });
    // far beyond quarter-rate radius, and just sent last tick (divisor not owed)
    expect(isUpdateDue(100, ball, 200 * 200, viewer, 99)).toBe(true);
    expect(isUpdateDue(100, ball, 200 * 200, viewer, 100)).toBe(true);
  });

  it('is always due inside the 55yd full-rate radius, even freshly sent', () => {
    const e = mkEntity({ id: 2 });
    const viewer = mkEntity({ id: 1 });
    const d2 = 54 * 54; // just inside 55yd
    expect(isUpdateDue(100, e, d2, viewer, 100)).toBe(true); // sent this very tick
  });

  it('is always due when the entity is the viewer target, even at long range and freshly sent', () => {
    const e = mkEntity({ id: 2 });
    const viewer = mkEntity({ id: 1, targetId: 2 });
    const d2 = 200 * 200;
    expect(isUpdateDue(100, e, d2, viewer, 100)).toBe(true);
  });

  it('is always due when the entity is aggroed on the viewer, even at long range and freshly sent', () => {
    const e = mkEntity({ id: 2, aggroTargetId: 1 });
    const viewer = mkEntity({ id: 1 });
    const d2 = 200 * 200;
    expect(isUpdateDue(100, e, d2, viewer, 100)).toBe(true);
  });

  it('half-rate gating between 55 and 80yd: due only every 2nd tick', () => {
    const e = mkEntity({ id: 2 });
    const viewer = mkEntity({ id: 1 });
    const d2 = 70 * 70; // strictly between 55 and 80
    expect(isUpdateDue(101, e, d2, viewer, 100)).toBe(false); // 1 tick since last send
    expect(isUpdateDue(102, e, d2, viewer, 100)).toBe(true); // 2 ticks since last send
  });

  it('quarter-rate gating beyond 80yd: due only every 4th tick', () => {
    const e = mkEntity({ id: 2 });
    const viewer = mkEntity({ id: 1 });
    const d2 = 90 * 90; // strictly beyond 80
    expect(isUpdateDue(101, e, d2, viewer, 100)).toBe(false);
    expect(isUpdateDue(102, e, d2, viewer, 100)).toBe(false);
    expect(isUpdateDue(103, e, d2, viewer, 100)).toBe(false);
    expect(isUpdateDue(104, e, d2, viewer, 100)).toBe(true); // 4 ticks since last send
  });

  it('is always due exactly at the 55yd full-rate boundary (d2 == 55 * 55)', () => {
    const e = mkEntity({ id: 2 });
    const viewer = mkEntity({ id: 1 });
    const d2 = 55 * 55;
    expect(isUpdateDue(100, e, d2, viewer, 100)).toBe(true); // sent this very tick
  });

  it('is still half-rate, not quarter-rate, exactly at the 80yd boundary (d2 == 80 * 80)', () => {
    const e = mkEntity({ id: 2 });
    const viewer = mkEntity({ id: 1 });
    const d2 = 80 * 80;
    expect(isUpdateDue(101, e, d2, viewer, 100)).toBe(false); // 1 tick since last send
    expect(isUpdateDue(102, e, d2, viewer, 100)).toBe(true); // 2 ticks since last send: half rate, not quarter
  });
});
