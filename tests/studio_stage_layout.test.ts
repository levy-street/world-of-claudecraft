import { expect, it } from 'vitest';
import { dungeonAt, isBgPos } from '../src/sim/data';
import { groundHeight } from '../src/sim/world';
import { DEFAULT_STUDIO_CONFIG, StudioSession } from '../src/vfx_studio/session';
import { STUDIO_ORIGIN } from '../src/vfx_studio/stage_layout';

it('stages the whole party on the real flat floor outside authored instances', () => {
  const session = new StudioSession(DEFAULT_STUDIO_CONFIG);
  for (const id of session.targetIds) {
    const e = session.sim.entities.get(id)!;
    expect(dungeonAt(e.pos.x)).toBeNull();
    expect(isBgPos(e.pos.x)).toBe(false);
    expect(e.pos.y).toBe(groundHeight(e.pos.x, e.pos.z, session.config.seed));
    expect(Math.abs(e.pos.x - STUDIO_ORIGIN.x)).toBeLessThan(8);
  }
  const dummy = session.sim.entities.get(session.targetIds[0])!;
  const initial = { ...dummy.pos };
  for (let i = 0; i < 40; i++) session.tick();
  expect(dummy.pos).toEqual(initial);
  expect(session.sim.player.pos.y).toBe(initial.y);
});

it('keeps world scenery practice at its world location', () => {
  const session = new StudioSession({ ...DEFAULT_STUDIO_CONFIG, environment: 'world' });
  expect(session.sim.player.pos.x).toBeLessThan(STUDIO_ORIGIN.x - 1000);
});
