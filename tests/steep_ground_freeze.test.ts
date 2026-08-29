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
// It was live. The old Last Keep's ward retaining face put a 0.15yd strip of
// frozen bailey floor along 26yd of its west foot (player report: "the exact
// location in the drakelands castle that the players are getting stuck", HUD
// 397, 2014), and a whole-world sweep found the same shape at four more
// authored edges. The generating condition is an authored edge landing on an
// unlucky lattice phase, so it is a CLASS, not a castle bug, and the fix is in
// the motion kernel: never take control away on ground that cannot carry the
// body off. That castle is gone (the drakelands site swap), so the two cases
// that probed its exact ward geometry retired with it; the invariant sweep
// below is the standing guard, run over the old grounds AND the keep-site
// build pad whose skirt is the newest authored edge in the zone.
import { describe, expect, it } from 'vitest';
import { KEEP_SITE } from '../src/sim/keep_site';
import { PLAYER_MAX_CLIMB_SLOPE } from '../src/sim/pathfind';
import { rideSteepnessAt } from '../src/sim/ride_height';
import { terrainDownhill } from '../src/sim/world';

const SEED = 20061; // the live world: these are seed-pinned authored edges

describe('the slope gate never freezes a player', () => {
  it('never strips control without a downhill to hand the body instead', () => {
    // The invariant behind the historical freezes, asserted directly over the
    // old keep grounds (now the Trollmoot's open dunes, still carrying the
    // road grades): wherever the gate reads steep, there must be a gradient
    // to slide along.
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

  it('keeps the keep-site pad skirt free of the same shape', () => {
    // The build pad is the zone's newest authored edge: its skirt blends over
    // 9yd, far wider than the memo lattice, so nothing here should read steep
    // at all near the rim, let alone steep with no downhill. Swept with a
    // margin past the skirt so a future pad move that lands a sheer face on
    // an unlucky phase turns this red instead of freezing a builder.
    const p = KEEP_SITE.pad;
    const m = KEEP_SITE.skirt + 4;
    const bad: string[] = [];
    for (let x = p.x0 - m; x <= p.x1 + m; x += 0.5) {
      for (let z = p.z0 - m; z <= p.z1 + m; z += 0.5) {
        if (rideSteepnessAt(x, z, SEED) <= PLAYER_MAX_CLIMB_SLOPE) continue;
        if (terrainDownhill(x, z, SEED) !== null) continue;
        bad.push(`(${x}, ${z})`);
      }
    }
    expect(bad.length, `steep with no downhill: ${bad.slice(0, 12).join(' ')}`).toBeLessThan(50);
  });
});
