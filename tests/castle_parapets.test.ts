// The wall-walk's outer parapet must catch a player, without closing anything.
//
// The curtain is TERRAIN, and terrain gives a body no standoff at a DOWN edge:
// terrainWallStandoff only ever pushes away from RISING ground. So the walk was
// a 3.0yd strip with nothing at either lip, and a player who drifted four ticks
// off the centreline simply left it, seven yards down into the bailey. The drawn
// stone had said otherwise the whole time: castle_features lays a crenellated
// battlement along the outer edge and a rail along the inner one, and neither
// was ever solid.
//
// Outer edge only, deliberately: the inner lip overlooks the bailey a player
// often drops into on purpose, and railing both would make the circuit a
// corridor. The cases below pin both halves of that, plus every gap the parapet
// has to leave.
import { describe, expect, it } from 'vitest';
import { CASTLE, CASTLE_GATES, castleParapetSegments } from '../src/sim/castle_layout';
import { DAWNHOLD, dawnholdParapetSegments } from '../src/sim/dawnhold_layout';
import { Sim } from '../src/sim/sim';
import { groundHeight } from '../src/sim/world';

const SEED = 20061;

function drive(from: { x: number; z: number }, dir: { x: number; z: number }) {
  const sim = new Sim({ seed: SEED, playerClass: 'warrior', autoEquip: true });
  sim.setPlayerLevel(20);
  const p = sim.player;
  const meta = (
    sim as unknown as { players: Map<number, { moveInput: { forward: boolean } }> }
  ).players.get((sim as unknown as { playerId: number }).playerId);
  if (!meta) throw new Error('no meta');
  p.pos.x = from.x;
  p.pos.z = from.z;
  p.pos.y = groundHeight(from.x, from.z, SEED) + 0.05;
  p.prevPos = { ...p.pos };
  for (let i = 0; i < 40; i++) {
    p.hp = p.maxHp;
    sim.tick();
  }
  const startY = p.pos.y;
  for (let i = 0; i < 20 * 5; i++) {
    p.facing = Math.atan2(dir.x, dir.z);
    meta.moveInput.forward = true;
    p.hp = p.maxHp;
    sim.tick();
  }
  meta.moveInput.forward = false;
  return { startY, pos: { ...p.pos } };
}

describe('the castle wall-walks hold a player on', () => {
  it('catches a player driven off the OUTER edge of every Last Keep curtain', () => {
    const cases: [string, { x: number; z: number }, { x: number; z: number }][] = [
      ['east', { x: CASTLE.wx1, z: 2020 }, { x: 1, z: 0 }],
      ['west', { x: CASTLE.wx0, z: 2000 }, { x: -1, z: 0 }],
      ['north', { x: 420, z: CASTLE.wz0 }, { x: 0, z: -1 }],
      ['south', { x: 380, z: CASTLE.wz1 }, { x: 0, z: 1 }],
    ];
    for (const [name, from, dir] of cases) {
      const r = drive(from, dir);
      expect(r.startY, `${name} walk did not start on the walk`).toBeCloseTo(CASTLE.walkAbs, 1);
      expect(r.pos.y, `walked off the ${name} curtain`).toBeGreaterThan(CASTLE.walkAbs - 1);
    }
  });

  it('leaves the INNER lip open, so the bailey is still a deliberate drop', () => {
    const r = drive({ x: CASTLE.wx1, z: 2020 }, { x: -1, z: 0 });
    expect(r.pos.y, 'the inner lip was railed too').toBeLessThan(CASTLE.walkAbs - 2);
  });

  it('parts over every gate and stops short of the watch flight', () => {
    const segs = castleParapetSegments();
    const spans = (axis: 'x' | 'z', line: number) =>
      segs.filter((s) => s.axis === axis && Math.abs(s.line - line) < 2);
    const covers = (list: typeof segs, v: number) => list.some((s) => v > s.a0 && v < s.a1);
    const mid = (g: { a0: number; a1: number }) => (g.a0 + g.a1) / 2;
    expect(
      covers(spans('z', CASTLE.wx0), mid(CASTLE_GATES.main)),
      'the main gate mouth is railed over',
    ).toBe(false);
    expect(
      covers(spans('x', CASTLE.wz0), mid(CASTLE_GATES.postern)),
      'the postern mouth is railed over',
    ).toBe(false);
    expect(
      covers(spans('z', CASTLE.wx1), mid(CASTLE_GATES.breach)),
      'the breach is railed over',
    ).toBe(false);
    // the watch flight climbs the south wall itself and rises above parapet
    // height, so the south run stops at its foot
    expect(covers(spans('x', CASTLE.wz1), 430), 'the watch flight is railed over').toBe(false);
    // ...and the long solid stretches really are railed
    expect(covers(spans('z', CASTLE.wx0), 2000), 'the west curtain is unrailed').toBe(true);
    expect(covers(spans('x', CASTLE.wz1), 380), 'the south curtain is unrailed').toBe(true);
  });

  it('leaves the climbing shelves a clear approach on both castles', () => {
    // fitsOn (physics/ledge.ts) vetoes a ledge grab landing inside anything that
    // carries a movement top, standable or not, so a parapet over the shelves
    // would silently kill the outside climb without failing anything else.
    const lk = castleParapetSegments().filter((s) => s.axis === 'z' && s.line > CASTLE.wx1);
    for (const z of [2032, 2036, 2040]) {
      expect(
        lk.some((s) => z > s.a0 && z < s.a1),
        `the Last Keep shelf at z ${z} is railed over`,
      ).toBe(false);
    }
    const dh = dawnholdParapetSegments().filter((s) => s.axis === 'x' && s.line < DAWNHOLD.wz0);
    for (const x of [255, 259, 263]) {
      expect(
        dh.some((s) => x > s.a0 && x < s.a1),
        `the Dawnhold shelf at x ${x} is railed over`,
      ).toBe(false);
    }
  });

  it('stands the stone where the render draws it, on both castles', () => {
    // the band is the outermost 0.4yd of the strip, so it sits under the drawn
    // merlons rather than out in the air past the curtain face
    for (const s of castleParapetSegments()) {
      const off = s.axis === 'z' ? Math.abs(s.line - CASTLE.wx0) : Math.abs(s.line - CASTLE.wz0);
      const other = s.axis === 'z' ? Math.abs(s.line - CASTLE.wx1) : Math.abs(s.line - CASTLE.wz1);
      expect(Math.min(off, other), 'a parapet drifted off its own wall').toBeCloseTo(1.2, 6);
      expect(s.top, 'parapet top').toBeCloseTo(CASTLE.walkAbs + 1.56, 6);
    }
    for (const s of dawnholdParapetSegments()) {
      expect(s.top, 'Dawnhold parapet top').toBeCloseTo(DAWNHOLD.walkAbs + 1.56, 6);
    }
  });
});
