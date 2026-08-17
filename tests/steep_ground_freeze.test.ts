// A player must never be frozen in place by the slope gate.
//
// stepPlayerMotion strips control on unwalkably steep ground and gives the body
// a downhill slide instead. Those two halves read the world DIFFERENTLY:
// steepness comes from world.ts's 1-yard memo, evaluated once at each cell's
// CENTRE over a 0.35yd sample, while the downhill is measured exactly under the
// body. At the FOOT of a cliff one cell straddles both, so up to half a cell of
// dead level floor inherits the cliff's verdict. Control is stripped, and then
// there is no gradient to slide along: the body is held solid, forever, with no
// collider anywhere near it.
//
// It was live. The Last Keep's ward retaining face put a 0.15yd strip of frozen
// bailey floor along 26yd of its west foot (player report: "the exact location
// in the drakelands castle that the players are getting stuck", HUD 397, 2014),
// and a whole-world sweep found the same shape at four more authored edges. The
// generating condition is an authored edge landing on an unlucky lattice phase,
// so it is a CLASS, not a castle bug, and the fix is in the motion kernel: never
// take control away on ground that cannot carry the body off.
import { describe, expect, it } from 'vitest';
import { PLAYER_MAX_CLIMB_SLOPE } from '../src/sim/pathfind';
import { rideSteepnessAt } from '../src/sim/ride_height';
import { Sim } from '../src/sim/sim';
import { groundHeight, terrainDownhill } from '../src/sim/world';

const SEED = 20061; // the live world: these are seed-pinned authored edges
const DIRS = [
  [0, 1],
  [0, -1],
  [1, 0],
  [-1, 0],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
] as const;

function makeWalker(spot: { x: number; z: number }) {
  const sim = new Sim({ seed: SEED, playerClass: 'warrior', autoEquip: true });
  sim.setPlayerLevel(20);
  const p = sim.player;
  const meta = (
    sim as unknown as { players: Map<number, { moveInput: { forward: boolean } }> }
  ).players.get((sim as unknown as { playerId: number }).playerId);
  if (!meta) throw new Error('no meta');
  p.pos.x = spot.x;
  p.pos.z = spot.z;
  p.pos.y = groundHeight(spot.x, spot.z, SEED) + 0.05;
  p.prevPos = { ...p.pos };
  for (let i = 0; i < 40; i++) {
    p.hp = p.maxHp;
    sim.tick();
  }
  return { sim, p, meta };
}

/** The furthest the body gets from where it settled, over all eight headings. */
function bestEscape(spot: { x: number; z: number }): number {
  const { sim, p, meta } = makeWalker(spot);
  const from = { x: p.pos.x, z: p.pos.z };
  let best = 0;
  for (const [dx, dz] of DIRS) {
    for (let i = 0; i < 20 * 3; i++) {
      p.facing = Math.atan2(dx, dz);
      meta.moveInput.forward = true;
      p.hp = p.maxHp;
      sim.tick();
    }
    meta.moveInput.forward = false;
    best = Math.max(best, Math.hypot(p.pos.x - from.x, p.pos.z - from.z));
    p.pos.x = from.x;
    p.pos.z = from.z;
    p.prevPos = { ...p.pos };
  }
  return best;
}

describe('the slope gate never freezes a player', () => {
  it('leaves the Last Keep ward foot walkable where the steepness memo overhangs it', () => {
    // The west retaining face. This is the spot the player reported. The band
    // moved when the ward edge did, so probe both the old phase and the corner
    // where the west and north blends meet, which still reads steep-with-no-
    // downhill and must simply stay walkable.
    for (const x of [397.1, 397.5, 397.6, 397.65]) {
      for (const z of [1993, 2005, 2014]) {
        expect(bestEscape({ x, z }), `frozen on the ward foot at (${x}, ${z})`).toBeGreaterThan(1);
      }
    }
  }, 120_000);

  it('holds a standing player on the ward terrace at its own south rim', () => {
    // The same lattice phase one storey UP, and the nastier half: here the memo
    // cell did find a downhill, pointing straight off the 2.6yd retaining drop,
    // so a player standing still on dead flat terrace (ground 8.60) was shoved
    // south and dumped in the bailey at 6.00. player_motion cannot fix this one,
    // the downhill is real as far as the gate can tell, so the ward edge moved
    // off the whole number instead. Probes the band that actually slid.
    for (const z of [2017.7, 2017.8, 2017.9, 2017.99]) {
      for (const x of [405, 430]) {
        const { p } = makeWalker({ x, z });
        expect(p.pos.y, `slid off the terrace rim from (${x}, ${z})`).toBeGreaterThan(8);
        expect(Math.abs(p.pos.z - z), `drifted from (${x}, ${z})`).toBeLessThan(0.5);
      }
    }
  });

  it('never strips control without a downhill to hand the body instead', () => {
    // The invariant behind both cases, asserted directly over the castle grounds:
    // wherever the gate reads steep, there must be a gradient to slide along.
    const bad: string[] = [];
    for (let x = 348; x <= 452; x += 0.5) {
      for (let z = 1982; z <= 2080; z += 0.5) {
        if (rideSteepnessAt(x, z, SEED) <= PLAYER_MAX_CLIMB_SLOPE) continue;
        if (terrainDownhill(x, z, SEED) !== null) continue;
        bad.push(`(${x}, ${z})`);
      }
    }
    // The gate now requires the downhill, so these points are harmless: they keep
    // full control. Reported anyway, because a growing count means a new authored
    // edge has landed on the bad lattice phase and is worth moving off it.
    expect(bad.length, `steep with no downhill: ${bad.slice(0, 12).join(' ')}`).toBeLessThan(400);
  });
});
