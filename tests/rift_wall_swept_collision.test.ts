// Regression pin for issue #2706: Blink/Shadowstep/Heroic Leap swept relocations
// must stop at a rift wall exactly like ordinary movement does. The crest
// re-resolve inside sweptLanding (src/sim/combat/heroic_leap.ts) previously
// called resolvePosition without the riftToken argument, so a rift wall never
// registered as a collider for the "is the crest clear" check and the sweep
// walked straight through it. Uses the same seed-2 floor-0 chamber-waist
// geometry pinned by tests/rift_wall_solidity.test.ts (a real side wall at
// local x=35 inside the origin(0,0) room band).

import { describe, expect, it } from 'vitest';
import { isBlocked, setRiftRegion } from '../src/sim/colliders';
import { relocateSwept } from '../src/sim/combat/heroic_leap';
import { riftInstanceOrigin } from '../src/sim/data';
import { layoutColliders } from '../src/sim/dungeon_layout';
import { PLAYER_BODY_RADIUS } from '../src/sim/pathfind';
import { generateRiftFloor } from '../src/sim/rift/rift_gen';
import { Sim } from '../src/sim/sim';
import { MAX_LEVEL } from '../src/sim/types';

function armWithRiftWall(sim: Sim): { origin: { x: number; z: number } } {
  const origin = riftInstanceOrigin(0, 0);
  const floor = generateRiftFloor(2, 20, 0);
  setRiftRegion(sim.riftCollisionToken, origin.x, origin.z, layoutColliders(floor.layout));
  return { origin };
}

describe('rift walls stop swept relocations (Blink, Shadowstep, Heroic Leap)', () => {
  it('Heroic Leap aimed across a rift wall lands the player inside the shell', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', autoEquip: true });
    sim.setPlayerLevel(MAX_LEVEL);
    const { origin } = armWithRiftWall(sim);
    const p = sim.player;
    p.pos = { x: origin.x + 33.1, y: p.pos.y, z: origin.z + 61 };
    p.gcdRemaining = 0;

    const aim = { x: origin.x + 46.5, y: p.pos.y, z: origin.z + 61 };
    sim.castAbility('heroic_leap', p.id, aim);
    expect(p.leap).not.toBeNull();
    // The flight target is the swept landing computed at cast time: it must
    // already be clamped at the wall, not past it.
    const localTargetX = (p.leap?.to.x ?? 0) - origin.x;
    expect(localTargetX, 'Heroic Leap flight target crossed the rift wall').toBeLessThan(36);
  });

  it('Blink aimed across a rift wall lands the player inside the shell', () => {
    const sim = new Sim({ seed: 42, playerClass: 'mage', autoEquip: true });
    sim.setPlayerLevel(MAX_LEVEL);
    const { origin } = armWithRiftWall(sim);
    const p = sim.player;
    p.pos = { x: origin.x + 33.1, y: p.pos.y, z: origin.z + 61 };
    p.facing = Math.PI / 2; // face toward +x, straight at the wall
    p.gcdRemaining = 0;

    sim.castAbility('blink', p.id);
    const localX = p.pos.x - origin.x;
    expect(localX, 'Blink crossed the rift wall').toBeLessThan(36);
  });

  it('relocateSwept (the shared Blink/Shadowstep helper) stops at a rift wall directly', () => {
    const sim = new Sim({ seed: 42, playerClass: 'rogue', autoEquip: true });
    const { origin } = armWithRiftWall(sim);
    const p = sim.player;
    p.pos = { x: origin.x + 33.1, y: p.pos.y, z: origin.z + 61 };

    relocateSwept(sim.ctx, p, { x: origin.x + 46.5, y: p.pos.y, z: origin.z + 61 });
    const localX = p.pos.x - origin.x;
    expect(localX, 'relocateSwept crossed the rift wall').toBeLessThan(36);
  });
});

describe('click-to-move A* cell walkability respects a rift wall (isBlocked riftToken)', () => {
  it('a cell just past the wall is walkable with no token but blocked with the live token', () => {
    // This is the exact check findPlayerPath's A* grid runs per candidate cell
    // (playerDestinationWalkable / resolvePlayerDestination run the equivalent
    // check for the click-to-move destination). main.ts's two findPlayerPath
    // call sites (clickMovePathTo, the stuck reroute) used to omit the token,
    // so the A* grid treated this rift wall as open floor and could string-pull
    // a route straight through it even though the destination itself was
    // already correctly rift-aware.
    const sim = new Sim({ seed: 42, playerClass: 'warrior', autoEquip: true });
    const { origin } = armWithRiftWall(sim);
    const x = origin.x + 35;
    const z = origin.z + 61;

    expect(
      isBlocked(sim.cfg.seed, x, z, PLAYER_BODY_RADIUS, true, undefined, 0),
      'sanity: without a token the wall cell reads as open floor',
    ).toBe(false);
    expect(
      isBlocked(sim.cfg.seed, x, z, PLAYER_BODY_RADIUS, true, undefined, sim.riftCollisionToken),
      'with the live token the wall cell must be blocked',
    ).toBe(true);
  });
});
