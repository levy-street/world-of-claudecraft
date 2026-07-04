// The sealed-frontier barricades of the level-40 launch: two authored rockslides
// plug the only road passes leading out of the launch play space (the Landing
// exit at z = 900 and the Breach frontier at SEALED_FRONTIER_Z). The boulders
// ride the deterministic decoration field (world.ts), so the SAME list drives
// the renderer and the circle colliders: these tests pin that the wall actually
// stops movement at every crossing x, that the authored rows exist and are
// collider-eligible, and that a save stranded past the frontier reslots to the
// last open zone's graveyard.

import { describe, expect, it } from 'vitest';
import { resolveMovement } from '../src/sim/colliders';
import { LANDING_EXIT_Z, SEALED_FRONTIER_Z, ZONES } from '../src/sim/data';
import { Sim } from '../src/sim/sim';
import { generateDecorations } from '../src/sim/world';
import { atlasZoneSealed, buildAtlasModel } from '../src/ui/map_atlas_view';

const SEED = 20061; // production world seed (tests/terrain_walls.test.ts uses the same)
const BODY = 0.5; // player body radius (sim.ts BODY_RADIUS)

// Walk straight north across the barricade line from 6 units south of it to 6
// units north, at every half-unit x across the road pass. Outside the pass
// (|x| > 10 rising to full wall by 28) the ridge slope gate blocks movement in
// the sim (pinned by tests/terrain_walls.test.ts); resolveMovement only knows
// colliders, so this sweep covers the span the boulders must close.
function sweepBlocked(lineZ: number): void {
  for (let x = -12; x <= 12; x += 0.5) {
    let pos = { x, z: lineZ - 6 };
    // step in 1u hops like real movement (resolveMovement sub-steps internally)
    for (let i = 0; i < 12; i++) {
      pos = resolveMovement(SEED, pos.x, pos.z, pos.x, pos.z + 1, BODY);
    }
    expect(pos.z, `crossed the barricade at x=${x} (reached z=${pos.z.toFixed(2)})`).toBeLessThan(
      lineZ + 1,
    );
  }
}

describe('sealed-frontier barricades', () => {
  it('authored boulders reach the decoration field, collider-eligible, on both lines', () => {
    const rocks = generateDecorations(SEED).filter((d) => d.kind === 'rock');
    const landing = rocks.filter((d) => Math.abs(d.z - LANDING_EXIT_Z) <= 3 && Math.abs(d.x) <= 14);
    const frontier = rocks.filter(
      (d) => Math.abs(d.z - SEALED_FRONTIER_Z) <= 3 && Math.abs(d.x) <= 14,
    );
    expect(landing.length).toBeGreaterThanOrEqual(30);
    expect(frontier.length).toBeGreaterThanOrEqual(30);
    // every authored boulder is big enough for the collider arm (scale >= 0.8)
    for (const b of [...landing, ...frontier]) expect(b.scale).toBeGreaterThanOrEqual(0.8);
  });

  it('the Landing exit pass (z=900) is impassable at every x', () => {
    sweepBlocked(LANDING_EXIT_Z);
  });

  it('the Breach frontier pass (z=2970) is impassable at every x', () => {
    sweepBlocked(SEALED_FRONTIER_Z);
  });

  it('a jump cannot clear the boulders (circles are not fences)', () => {
    // ignoreFences=true is the airborne/jump collider mode: fences open up, but
    // circle colliders (the boulders) still block.
    let pos = { x: 0, z: LANDING_EXIT_Z - 6 };
    for (let i = 0; i < 12; i++) {
      pos = resolveMovement(SEED, pos.x, pos.z, pos.x, pos.z + 1, BODY, true);
    }
    expect(pos.z).toBeLessThan(LANDING_EXIT_Z + 1);
  });

  it('a save stranded past the frontier reslots to the last open graveyard', () => {
    const donor = new Sim({ seed: 42, playerClass: 'warrior', autoEquip: true }) as Sim &
      Record<string, any>;
    const state = donor.serializeCharacter(donor.playerId)!;
    state.pos = { x: 0, z: 3200 };
    const sim = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true }) as Sim &
      Record<string, any>;
    const pid = sim.addPlayer('warrior', 'Stranded', { state });
    const e = sim.entities.get(pid)!;
    expect(e.pos.z).toBeLessThan(SEALED_FRONTIER_Z);
    const lastOpen = [...ZONES].reverse().find((z) => z.zMax <= SEALED_FRONTIER_Z)!;
    expect(Math.abs(e.pos.x - lastOpen.graveyard.x)).toBeLessThan(1);
    expect(Math.abs(e.pos.z - lastOpen.graveyard.z)).toBeLessThan(1);
  });

  it('the atlas marks exactly the frontier zones sealed, derived from geometry', () => {
    expect(atlasZoneSealed('the_breach')).toBe(true);
    expect(atlasZoneSealed('ashveil_wastes')).toBe(true);
    expect(atlasZoneSealed('redspire_pass')).toBe(true);
    expect(atlasZoneSealed('pale_crossing')).toBe(false);
    expect(atlasZoneSealed('grey_hollows')).toBe(false);
    expect(atlasZoneSealed('kael_empire')).toBe(false);
    const model = buildAtlasModel({
      level: 'breach',
      canvasW: 800,
      canvasH: 600,
      playerZoneId: 'eastbrook_vale',
      hoverNodeId: null,
    });
    const sealedIds = model.shapes.filter((s) => s.sealed).map((s) => s.nodeId);
    // the Breach core + the five northern territories, nothing else
    expect(sealedIds.length).toBe(6);
    const sealedLabels = model.labels.filter((l) => l.sealed);
    expect(sealedLabels.length).toBe(6);
  });

  it('saves inside the open world are untouched by the frontier clamp', () => {
    const donor = new Sim({ seed: 42, playerClass: 'warrior', autoEquip: true }) as Sim &
      Record<string, any>;
    const state = donor.serializeCharacter(donor.playerId)!;
    state.pos = { x: 12, z: 1500 };
    const sim = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true }) as Sim &
      Record<string, any>;
    const pid = sim.addPlayer('warrior', 'Settler', { state });
    const e = sim.entities.get(pid)!;
    expect(Math.abs(e.pos.x - 12)).toBeLessThan(0.5);
    expect(Math.abs(e.pos.z - 1500)).toBeLessThan(0.5);
  });
});
