// The Guardian of the Quench's ice-state badge and water veil (src/ui/hud/
// dungeon/quench_ice_view.ts; the team's playtest of 2026-11-25: "add a UI
// indicator (top middle of the screen) for the ice/water state", "a frosty
// blue screen border plus a blue tint when you're in the water"): shown while
// the player fights on the lake; in the water over breaking ice over plain
// ice; the veil only in the water; never gated on a preset or the hints.
// Over a REAL fight too: a crack under a raider reads "breaking", the hole
// it opens holds them and reads "water".

import { describe, expect, it } from 'vitest';
import {
  crackTemplate,
  QUENCH_AURAS,
  QUENCH_OBJECTS,
  QUENCH_TUNING as T,
} from '../src/sim/encounters/smith_heart/quench_ids';
import {
  buildQuenchIceView,
  makeQuenchIceView,
  QUENCH_ICE_BREAK_MARGIN,
  QuenchIceScan,
} from '../src/ui/hud/dungeon/quench_ice_view';
import { quenchFight } from './helpers/quench_fight';

const crack = (id: number, x: number, z: number) => ({
  id,
  templateId: crackTemplate(T.crackWarn),
  pos: { x, z },
  scale: T.holeR,
});
const me = (x: number, auras: { id: string; remaining?: number }[], dead = false) => ({
  pos: { x, z: 0 },
  auras,
  dead,
});
const COLD = { id: QUENCH_AURAS.cold };

describe('the Quench ice badge', () => {
  it('reads the ice, the ice breaking under you and the water, the veil only in the water', () => {
    const entities = new Map([[5, crack(5, 0, 0)]]);
    const world = { entities, entityRosterVersion: 1 };
    const scan = new QuenchIceScan();
    const cracks = scan.frame(world);
    expect(cracks).toEqual([5]);
    const out = makeQuenchIceView();
    // Far from the crack: on the ice.
    expect(buildQuenchIceView(world, cracks, me(20, [COLD]), out)).toMatchObject({
      visible: true,
      state: 'ice',
      label: 'On the ice',
      veil: false,
    });
    // On its footprint, and a step past its edge: breaking.
    for (const x of [0, T.holeR, T.holeR + QUENCH_ICE_BREAK_MARGIN - 0.05])
      expect(buildQuenchIceView(world, cracks, me(x, [COLD]), out)).toMatchObject({
        state: 'breaking',
        label: 'Ice breaking!',
        veil: false,
      });
    expect(
      buildQuenchIceView(world, cracks, me(T.holeR + QUENCH_ICE_BREAK_MARGIN + 0.1, [COLD]), out)
        .state,
    ).toBe('ice');
    // In the water: over everything, the veil on, the seconds to the climb out.
    const v = buildQuenchIceView(
      world,
      cracks,
      me(0, [COLD, { id: QUENCH_AURAS.trapped, remaining: T.trapSeconds + 1 }]),
      out,
    );
    expect(v).toMatchObject({ state: 'water', label: 'In the water!', veil: true });
    expect(v.seconds).toBe(`${T.trapSeconds}s`);
  });

  it('hides off the lake and when dead', () => {
    const out = makeQuenchIceView();
    const world = { entities: new Map(), entityRosterVersion: 1 };
    expect(buildQuenchIceView(world, [], me(0, []), out).visible).toBe(false);
    expect(buildQuenchIceView(world, [], me(0, [COLD], true), out)).toMatchObject({
      visible: false,
      veil: false,
    });
  });

  it('finds the cracks once per roster', () => {
    const scan = new QuenchIceScan();
    const entities = new Map<number, ReturnType<typeof crack>>([
      [3, { ...crack(3, 0, 0), templateId: QUENCH_OBJECTS.hole }],
      [7, crack(7, 1, 1)],
    ]);
    expect([...scan.frame({ entities, entityRosterVersion: 1 })]).toEqual([7]);
    entities.delete(7);
    expect([...scan.frame({ entities, entityRosterVersion: 1 })]).toEqual([7]);
    expect([...scan.frame({ entities, entityRosterVersion: 2 })]).toEqual([]);
  });

  it('over a real fight: a crack under a raider reads breaking, its hole reads water', () => {
    const f = quenchFight(4, 31);
    f.dev('/dev heart quench pull');
    f.tick(2);
    const p = f.players[1];
    const world = { entities: f.sim.entities, entityRosterVersion: 0 };
    const scan = new QuenchIceScan();
    const out = makeQuenchIceView();
    const view = () => {
      world.entityRosterVersion++;
      return buildQuenchIceView(world, scan.frame(world), p, out);
    };
    expect(view().state).toBe('ice');
    expect(f.dev('/dev heart quench crack', p.id)).toBe(true);
    f.tick(1);
    expect(view().state).toBe('breaking');
    // Held still on it until it opens: the water.
    f.tick(Math.round((T.crackWarn + 0.3) * 20));
    expect(view()).toMatchObject({ state: 'water', veil: true });
  });
});
