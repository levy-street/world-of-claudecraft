import { describe, expect, it } from 'vitest';
import { findLedgeGrab } from '../src/sim/physics/ledge';
import { Sim } from '../src/sim/sim';
import type { MoveInput } from '../src/sim/types';
import { groundHeight, terrainHeight } from '../src/sim/world';

// Border ridges vs the ledge grab: the 2.2 grab reach may hop banks, but it
// may never LADDER a player up terrain they could not walk up.
//
// The premise changed under this file. It was written on the parkour line
// (#2527) against a world whose inter-realm ridges were tall narrow walls
// (RIDGE_HEIGHT 40 over sigma 10), so "cannot be laddered" and "cannot be
// crossed" were the same statement, and the second case asserted the crossing.
// d5af0bfda ("every land border is walkable, not just the pass roads") made
// the ridges low and broad (15 over sigma 26) precisely so that every point of
// land contact between two realms is walkable, the pass roads merely being the
// easy way. Walking over a border ridge is therefore the DESIGNED behavior now,
// and the cannot-cross assertion was main's walled-world assumption; this base
// merge is where the two lines meet and it is resolved here.
//
// What survives is the guarantee #2527 actually added: no ledge climb may fire
// on the ridge, and jump-spam may not lift a player meaningfully over the
// ridge's own crest. That still fails loudly if the grab starts laddering.
const SEED = 42;
/** Height a legal jump arc can add over the ground the walker stands on. */
const JUMP_ARC = 2.5;
const IDLE: MoveInput = {
  forward: false,
  back: false,
  turnLeft: false,
  turnRight: false,
  strafeLeft: false,
  strafeRight: false,
  jump: false,
  dive: false,
  surface: false,
};

describe('the border ridge vs the ledge grab', () => {
  it('static grabs along the wall foot stay null or sub-wall', () => {
    // zone1 -> zone2 ridge sits near z = zone1.zMax (find it by height rise).
    // Probe a band of x values at several z offsets approaching the wall.
    let grabs = 0;
    let maxRise = 0;
    for (let x = -100; x <= 100; x += 7) {
      for (let dz = -8; dz <= 8; dz += 2) {
        const z = 180 + dz; // zone1 zMax region (ridge band)
        const g = groundHeight(x, z, SEED);
        for (let feet = g; feet < g + 1.2; feet += 0.4) {
          const grab = findLedgeGrab(
            { seed: SEED, radius: 0.5, facing: 0, vx: 0, vz: 5 },
            x,
            feet,
            z,
          );
          if (grab) {
            grabs++;
            maxRise = Math.max(maxRise, grab.topY - g);
          }
        }
      }
    }
    console.log('grabs:', grabs, 'maxRise above local ground:', maxRise.toFixed(2));
    // Grabs onto low banks are fine; anything reaching wall-scale height is not.
    expect(maxRise).toBeLessThan(3.4);
  });

  it('jump-spam and the ledge grab gain no illegitimate height on the ridge', () => {
    const sim = new Sim({ seed: SEED, playerClass: 'warrior', autoEquip: true });
    sim.setPlayerLevel(60);
    const p = sim.player;
    const meta = sim.players.get(p.id);
    if (!meta) throw new Error('no meta');
    // Start at the ridge foot south of the border, push north for 60 s of sim.
    p.pos.x = 40; // well outside the pass shoulder (34), so never in the opening
    p.pos.z = 172;
    p.pos.y = terrainHeight(p.pos.x, p.pos.z, SEED);
    p.prevPos = { ...p.pos };
    p.fallStartY = p.pos.y;
    p.facing = 0;
    p.onGround = true;
    // The ridge's own crest over the corridor the walker crosses, read from the
    // heightfield so the bound can never drift from the terrain it guards.
    let ridgeCrest = -Infinity;
    for (let x = 20; x <= 60; x += 0.5) {
      for (let z = 160; z <= 205; z += 0.5) {
        ridgeCrest = Math.max(ridgeCrest, terrainHeight(x, z, SEED));
      }
    }
    let maxRidgeY = p.pos.y;
    let climbedCount = 0;
    for (let i = 0; i < 1200; i++) {
      Object.assign(meta.moveInput, IDLE, { forward: true, jump: true });
      sim.tick();
      if (p.climb) climbedCount++;
      // Height is only meaningful while the walker is still ON the ridge: past
      // it he is legitimately in the next realm, whose own hills rise higher
      // than the border ever does.
      if (p.pos.z <= 205) maxRidgeY = Math.max(maxRidgeY, p.pos.y);
    }
    console.log(
      'ridge crest:',
      ridgeCrest.toFixed(2),
      'max y on the ridge:',
      maxRidgeY.toFixed(2),
      'climb ticks:',
      climbedCount,
      'end z:',
      p.pos.z.toFixed(1),
    );
    // No ledge climb may fire on a border ridge at all...
    expect(climbedCount, 'the ledge grab laddered the border ridge').toBe(0);
    // ...and jump-spam may not carry the walker past a jump arc over the
    // ridge's crest. Laddering a face shows up here in yards, not inches.
    expect(maxRidgeY, 'jump-spam gained height over the ridge crest').toBeLessThan(
      ridgeCrest + JUMP_ARC,
    );
  });
});
