import { describe, expect, it } from 'vitest';
import { findLedgeGrab } from '../src/sim/physics/ledge';
import { Sim } from '../src/sim/sim';
import type { MoveInput } from '../src/sim/types';
import { groundHeight, terrainHeight } from '../src/sim/world';

// Zone gating vs the ledge grab: the impassable ridge walls between zones
// must stay impassable with the 2.2 grab reach (banks may be hopped; walls
// may not be laddered).
const SEED = 42;
const IDLE: MoveInput = {
  forward: false,
  back: false,
  turnLeft: false,
  turnRight: false,
  strafeLeft: false,
  strafeRight: false,
  jump: false,
};

describe('ridge wall vs the ledge grab', () => {
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

  it('a jump-spamming player cannot cross the ridge', () => {
    const sim = new Sim({ seed: SEED, playerClass: 'warrior', autoEquip: true });
    sim.setPlayerLevel(60);
    const p = sim.player;
    const meta = sim.players.get(p.id);
    if (!meta) throw new Error('no meta');
    // Start at the wall foot south of the ridge, push north for 60 s of sim.
    p.pos.x = 3; // off the road pass (passX 0 +-10 flat opening; x=3 is inside the pass!)
    p.pos.x = 40; // well outside the pass shoulder (34)
    p.pos.z = 172;
    p.pos.y = terrainHeight(p.pos.x, p.pos.z, SEED);
    p.prevPos = { ...p.pos };
    p.fallStartY = p.pos.y;
    p.facing = 0;
    p.onGround = true;
    const startZ = p.pos.z;
    let maxClimbY = p.pos.y;
    let climbedCount = 0;
    for (let i = 0; i < 1200; i++) {
      Object.assign(meta.moveInput, IDLE, { forward: true, jump: true });
      sim.tick();
      if (p.climb) climbedCount++;
      maxClimbY = Math.max(maxClimbY, p.pos.y);
    }
    console.log(
      'z gained:',
      (p.pos.z - startZ).toFixed(1),
      'max y:',
      maxClimbY.toFixed(1),
      'climb ticks:',
      climbedCount,
      'end z:',
      p.pos.z.toFixed(1),
    );
    // The wall crest is ~40 high; crossing means z advances ~20+ past the
    // ridge line. Some grabbing up terraced treads is acceptable as long as
    // the player cannot actually CROSS into zone 2.
    expect(p.pos.z - startZ).toBeLessThan(16);
  });
});
