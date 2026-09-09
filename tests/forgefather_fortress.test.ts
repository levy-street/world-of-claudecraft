// The Forgefather's Isle fortress bake: the world-space placement table
// resolves real props, deck pieces emit STANDABLE platforms at their own
// surface height (the strait bridge is walked ON, above the water), solids
// follow the ground-standing blocker derivation exactly (walk-over trim and
// aerial stack members never block), and seawalls may stand submerged by
// design.
import { describe, expect, it } from 'vitest';
import { moverHeight, type ObbCollider, resolveMovement } from '../src/sim/colliders';
import { SEA_RING_PARAPET_Y } from '../src/sim/content/ember_coast';
import {
  FORGEFATHER_FORTRESS_PLACEMENTS,
  FORTRESS_CYLINDRICAL_KEYS,
  FORTRESS_STANDABLE_KEYS,
  forgefatherFortressColliders,
  forgefatherStreetlampSites,
  fortressDeckTopUnder,
} from '../src/sim/forgefather_fortress';
import {
  IGNIVAR_NON_COLLIDING_PROPS,
  IGNIVAR_PROP_COLLIDER_FOOTPRINT,
  IGNIVAR_PROP_NATIVE,
} from '../src/sim/ignivar_props';
import { moveSpeedMult, type PlayerMotionDeps, stepPlayerMotion } from '../src/sim/player_motion';
import { Sim } from '../src/sim/sim';
import type { Entity, MoveInput } from '../src/sim/types';
import { terrainHeight, terrainHeightSansEdits, WATER_LEVEL } from '../src/sim/world';
import { WORLD_SEED } from '../src/sim/world_seed';

const GROUND_STAND_TOLERANCE = 2.5;

/** Drive the live movement kernel from (sx, sz, sy) facing (fx, fz) for a
 *  fixed tick budget, on foot or mounted, and return the body. */
function kernelWalk(
  sim: Sim,
  sx: number,
  sz: number,
  sy: number,
  fx: number,
  fz: number,
  mountKey?: NonNullable<Entity['mountKey']>,
): Entity {
  const deps: PlayerMotionDeps = {
    seed: WORLD_SEED,
    moveSpeedMult: (e) => moveSpeedMult(e, 0),
    resolveMove: (fromX, fromZ, nx, nz, r, e, ignoreFences) =>
      resolveMovement(WORLD_SEED, fromX, fromZ, nx, nz, r, ignoreFences, undefined, moverHeight(e)),
    resolvedAbility: () => null,
    cancelCast: () => {},
    standUp: () => {},
    dealDamage: () => {},
  };
  const input: MoveInput = {
    forward: true,
    back: false,
    turnLeft: false,
    turnRight: false,
    strafeLeft: false,
    strafeRight: false,
    jump: false,
    dive: false,
    surface: false,
  };
  const p: Entity = {
    ...sim.player,
    pos: { x: sx, y: sy, z: sz },
    prevPos: { x: sx, y: sy, z: sz },
  };
  p.facing = Math.atan2(fx, fz);
  p.onGround = true;
  p.vx = 0;
  p.vz = 0;
  p.vy = 0;
  p.fallStartY = sy;
  if (mountKey !== undefined) p.mountKey = mountKey;
  for (let i = 0; i < 140; i++) {
    p.prevPos = { ...p.pos };
    stepPlayerMotion(deps, p, input);
  }
  return p;
}

describe('forgefather fortress bake', () => {
  it('every placement resolves a registered prop', () => {
    expect(FORGEFATHER_FORTRESS_PLACEMENTS.length).toBe(503);
    for (const placement of FORGEFATHER_FORTRESS_PLACEMENTS)
      expect(IGNIVAR_PROP_NATIVE[placement.key], placement.key).toBeDefined();
  });

  it('every deck piece emits standable platform pieces at its surface, above the water', () => {
    // A deck's standable footprint may be cropped into several strips
    // around a stair-ramp band rising through it (the plate-under-flight
    // rule in croppedPlateRects), so each placement matches by surface
    // height and containment rather than one exact footprint.
    const colliders = forgefatherFortressColliders(WORLD_SEED) as ObbCollider[];
    const decks = FORGEFATHER_FORTRESS_PLACEMENTS.filter((placement) =>
      FORTRESS_STANDABLE_KEYS.has(placement.key),
    );
    expect(decks.length).toBeGreaterThanOrEqual(30);
    for (const placement of decks) {
      const native = IGNIVAR_PROP_NATIVE[placement.key];
      const top = placement.y + native.hei * placement.scale;
      const cos = Math.abs(Math.cos(placement.ry));
      const halfX = ((cos * native.len + (1 - cos) * native.dep) * placement.scale) / 2;
      const halfZ = (((1 - cos) * native.len + cos * native.dep) * placement.scale) / 2;
      const pieces = colliders.filter(
        (collider) =>
          collider.type === 'obb' &&
          collider.standable === true &&
          collider.moveTopY === top &&
          collider.x - collider.hw >= placement.x - halfX - 1e-9 &&
          collider.x + collider.hw <= placement.x + halfX + 1e-9 &&
          collider.z - collider.hd >= placement.z - halfZ - 1e-9 &&
          collider.z + collider.hd <= placement.z + halfZ + 1e-9,
      );
      expect(
        pieces.length,
        `${placement.key} at (${placement.x}, ${placement.z})`,
      ).toBeGreaterThanOrEqual(1);
      // Every plate carries its slab underside, so an elevated deck admits
      // the walk beneath it (the balcony contract) while a ground paver's
      // clause stays inert at the dirt.
      for (const piece of pieces)
        expect(piece.passUnderY, `${placement.key} at (${placement.x}, ${placement.z})`).toBe(
          placement.y,
        );
      // The crossing stays dry: every walking surface clears the waterline.
      expect(top, `${placement.key} deck at (${placement.x}, ${placement.z})`).toBeGreaterThan(
        WATER_LEVEL + 1,
      );
    }
  });

  it('blockers match the ground-standing solid placements exactly', () => {
    const colliders = forgefatherFortressColliders(WORLD_SEED).filter(
      (collider) => !collider.standable,
    );
    // A solid's floor is the higher of the terrain and any deck plate under
    // its footprint (the fence-on-a-bridge rule), mirroring the builder.
    const effectiveGround = (placement: (typeof FORGEFATHER_FORTRESS_PLACEMENTS)[number]) =>
      Math.max(
        terrainHeight(placement.x, placement.z, WORLD_SEED),
        fortressDeckTopUnder(placement),
      );
    const expected = FORGEFATHER_FORTRESS_PLACEMENTS.filter(
      (placement) =>
        placement.key !== 'staircase' &&
        !FORTRESS_STANDABLE_KEYS.has(placement.key) &&
        !IGNIVAR_NON_COLLIDING_PROPS.has(placement.key) &&
        placement.y <= effectiveGround(placement) + GROUND_STAND_TOLERANCE &&
        placement.y + IGNIVAR_PROP_NATIVE[placement.key].hei * placement.scale >=
          effectiveGround(placement) + 0.5,
    );
    expect(colliders.length).toBe(expected.length);
    expect(colliders.length).toBeGreaterThanOrEqual(40);
    for (const placement of expected) {
      const native = IGNIVAR_PROP_NATIVE[placement.key];
      const footprint = IGNIVAR_PROP_COLLIDER_FOOTPRINT[placement.key] ?? 1;
      // The round tower drums collide as circles at their mean-axis radius;
      // every other solid keeps its silhouette-shaped OBB.
      if (FORTRESS_CYLINDRICAL_KEYS.has(placement.key)) {
        const match = colliders.find(
          (collider) =>
            collider.type === 'circle' &&
            collider.x === placement.x &&
            collider.z === placement.z &&
            Math.abs(collider.r - ((native.len + native.dep) * placement.scale * footprint) / 4) <
              1e-9,
        );
        expect(match, `${placement.key} circle at (${placement.x}, ${placement.z})`).toBeDefined();
        continue;
      }
      const match = colliders.find(
        (collider) =>
          collider.type === 'obb' &&
          collider.x === placement.x &&
          collider.z === placement.z &&
          collider.rot === placement.ry &&
          Math.abs(collider.hw - (native.len * placement.scale * footprint) / 2) < 1e-9 &&
          Math.abs(collider.hd - (native.dep * placement.scale * footprint) / 2) < 1e-9,
      );
      expect(match, `${placement.key} at (${placement.x}, ${placement.z})`).toBeDefined();
      // Solids carry their real top as a pass-over movement top (never
      // standable): walkers above the top cross it, everyone else is walled.
      expect(match?.moveTopY).toBeCloseTo(placement.y + native.hei * placement.scale, 9);
      expect(match?.standable).toBeUndefined();
      // A piece seated on a deck above the terrain lane carries its base as
      // passUnderY (walkers beneath the deck pass beneath its furniture);
      // terrain-grounded pieces stay full height below their top.
      const deckSeated =
        placement.y > terrainHeight(placement.x, placement.z, WORLD_SEED) + GROUND_STAND_TOLERANCE;
      expect(match?.passUnderY, `${placement.key} at (${placement.x}, ${placement.z})`).toBe(
        deckSeated ? placement.y : undefined,
      );
    }
  });

  it('an elevated deck admits the walk beneath it, but stays a wall to height-less movers', () => {
    // The training-yard balcony (the rampart walk decks at y 7.05, slab tops
    // 7.75) hangs over the pavers at ground 2.3: a player walking the
    // undercroft lane between the yard wall and the plaza must pass clean
    // beneath the plates, while a mob (no MoverHeight) still treats each
    // plate as a full-height solid and paths around.
    const walker = { y: 2.3, lift: 0 };
    const through = resolveMovement(
      WORLD_SEED,
      463.5,
      2160.5,
      463.5,
      2150,
      0.5,
      false,
      undefined,
      walker,
    );
    expect(through.z).toBeCloseTo(2150, 1);
    const walled = resolveMovement(WORLD_SEED, 463.5, 2160.5, 463.5, 2150, 0.5);
    expect(walled.z).toBeGreaterThan(2158.5);
  });

  it('the keep stairs walk BOTH ways through the live kernel (the descent regression)', () => {
    // The user could climb the temple entrance stair but not walk back down:
    // the raw-steepness memo reads the court stamps' buried rim under the
    // band, and three kernel gates each froze the descent (the steep-ground
    // control strip, the physics terrain wall, and a separating graze against
    // the deck edge). Drive the real movement kernel over the flights in both
    // directions; reaching the far end proves every gate now yields to a
    // band-carried walker.
    const sim = new Sim({ seed: WORLD_SEED, playerClass: 'warrior', autoEquip: true });
    // temple entrance stair: down to the plaza, up to the court decks
    expect(kernelWalk(sim, 477.5, 2168.15, 5.76, -1, 0).pos.x).toBeLessThan(466);
    expect(kernelWalk(sim, 464, 2168.15, 2.3, 1, 0).pos.x).toBeGreaterThan(475);
    // rampart stair A: down from the mid landing to the plaza
    expect(kernelWalk(sim, 453.4, 2163.6, 5.5, 1, 0).pos.x).toBeGreaterThan(458);
    // training yard stair: up from the yard decks onto the court
    expect(kernelWalk(sim, 482.6, 2149.8, 3.26, 0, 1).pos.y).toBeCloseTo(5.76, 1);
  });

  it('a mounted rider crosses the strait bridge: the deep-water gate reads the deck, not the seabed', () => {
    // The mount water-wall used to gate every step on the DROWNED seabed under
    // the plates, so a rider was walled at the bridge mouth and again on every
    // plate of the span; a standable deck within a step of the hooves is dry
    // footing. Ride from the strand mouth onto the decks, then along the span
    // over open water.
    const sim = new Sim({ seed: WORLD_SEED, playerClass: 'warrior', autoEquip: true });
    const mouth = kernelWalk(sim, 444, 2181, 2.0, 0, 1, 'valorsteed');
    expect(mouth.pos.z, 'the ride reaches the bridge decks').toBeGreaterThan(2192);
    const span = kernelWalk(sim, 452, 2193, -1.63, 1, 0, 'valorsteed');
    expect(span.pos.x, 'the ride carries along the span').toBeGreaterThan(470);
  });

  it('street lamp rows bake as Drakelands brazier streetlamp sites', () => {
    // The placer's 'street_lamp' key rides the town-lamp pipeline: sites
    // flow into streetlampPlacements (colliders.ts), which hands them to
    // the real fixture renderer and the night light field; the env-prop
    // paths treat the key as walk-over so nothing double-collides.
    const rows = FORGEFATHER_FORTRESS_PLACEMENTS.filter((p) => p.key === 'street_lamp');
    const sites = forgefatherStreetlampSites();
    expect(sites.length).toBe(rows.length);
    for (const site of sites) {
      expect(site.style).toBe('drakelands_brazier');
      expect(site.areaId).toBe('drakelands');
    }
    expect(IGNIVAR_NON_COLLIDING_PROPS.has('street_lamp')).toBe(true);
  });

  it('walk-over trim and aerial stack members never block', () => {
    const blockers = forgefatherFortressColliders(WORLD_SEED).filter(
      (collider) => !collider.standable,
    );
    for (const placement of FORGEFATHER_FORTRESS_PLACEMENTS) {
      if (FORTRESS_STANDABLE_KEYS.has(placement.key)) continue;
      const walkOver = IGNIVAR_NON_COLLIDING_PROPS.has(placement.key);
      const ground = Math.max(
        terrainHeight(placement.x, placement.z, WORLD_SEED),
        fortressDeckTopUnder(placement),
      );
      const aerial = placement.y > ground + GROUND_STAND_TOLERANCE;
      const interred =
        placement.y + IGNIVAR_PROP_NATIVE[placement.key].hei * placement.scale < ground + 0.5;
      if (!walkOver && !aerial && !interred) continue;
      // A stacked twin at the same x/z/rot (a different y) may be a
      // legitimate blocker; only flag when no such twin explains the hit.
      const twinBlocks = FORGEFATHER_FORTRESS_PLACEMENTS.some((other) => {
        if (other === placement || other.x !== placement.x || other.z !== placement.z) return false;
        // a cylindrical twin collides as a circle, so its rotation cannot
        // matter (the keep rebuild stacks rotate members tower by tower)
        if (other.ry !== placement.ry && !FORTRESS_CYLINDRICAL_KEYS.has(other.key)) return false;
        if (FORTRESS_STANDABLE_KEYS.has(other.key) || IGNIVAR_NON_COLLIDING_PROPS.has(other.key))
          return false;
        const g = Math.max(
          terrainHeight(other.x, other.z, WORLD_SEED),
          fortressDeckTopUnder(other),
        );
        return (
          other.y <= g + GROUND_STAND_TOLERANCE &&
          other.y + IGNIVAR_PROP_NATIVE[other.key].hei * other.scale >= g + 0.5
        );
      });
      if (twinBlocks) continue;
      const hit = blockers.find(
        (collider) =>
          collider.x === placement.x &&
          collider.z === placement.z &&
          (collider.type === 'circle' || collider.rot === placement.ry),
      );
      expect(hit, `${placement.key} at (${placement.x}, ${placement.z}) must not block`).toBe(
        undefined,
      );
    }
  });
  it('terrain edits never bury a ring wall the raw isle leaves standing', () => {
    // The walled sea pool's ring (the owner's five sea-level fortress_wall
    // rows) is what the strait sees of the keep's foot. A shore or tier
    // stamp may run INTO a wall end that the raw isle already swallows
    // (the west run's south end dies into the flank rim), but no stamp may
    // lift the ground over a stretch the raw heightfield leaves clear: the
    // ground plane then cuts through the wall panels and the parapet reads
    // as a bald hill from the water (the Drakelands terrain-clipping
    // report). Wherever the raw isle sits a yard under the parapet, the
    // edited ground stays at least half a yard under it too, sampled on
    // the spine AND both faces of the wall (the clip lives on a face, not
    // the centre line) along the wall's interior run: the end caps are
    // where a ring wall dies into the keep plinth or the postern descent
    // by design, so they are left out.
    const RING_BASE_Y = -7.25;
    const PARAPET_CLEAR = 0.5;
    const RAW_CLEAR = 1.0;
    const buried: string[] = [];
    let ringWalls = 0;
    for (const placement of FORGEFATHER_FORTRESS_PLACEMENTS) {
      if (placement.key !== 'fortress_wall' || placement.y !== RING_BASE_Y) continue;
      ringWalls++;
      const native = IGNIVAR_PROP_NATIVE[placement.key];
      const top = placement.y + native.hei * placement.scale;
      expect(top).toBeCloseTo(SEA_RING_PARAPET_Y, 6);
      const half = (native.len * placement.scale) / 2;
      const thick = (native.dep * placement.scale) / 2;
      const cos = Math.cos(placement.ry);
      const sin = Math.sin(placement.ry);
      for (let i = -5; i <= 5; i++) {
        const along = (half * i) / 6;
        for (const across of [-thick, 0, thick]) {
          const x = placement.x + along * cos - across * sin;
          const z = placement.z + along * sin + across * cos;
          const raw = terrainHeightSansEdits(x, z, WORLD_SEED);
          if (raw > top - RAW_CLEAR) continue;
          const ground = terrainHeight(x, z, WORLD_SEED);
          if (ground > top - PARAPET_CLEAR)
            buried.push(
              `wall (${placement.x}, ${placement.z}) at (${x.toFixed(1)}, ${z.toFixed(1)}): ground ${ground.toFixed(2)} over parapet ${top.toFixed(2)} (raw ${raw.toFixed(2)})`,
            );
        }
      }
    }
    expect(ringWalls).toBe(5);
    expect(buried, buried.slice(0, 6).join('; ')).toEqual([]);
  });
});
