// The Forgefather's Isle fortress bake: the world-space placement table
// resolves real props, deck pieces emit STANDABLE platforms at their own
// surface height (the strait bridge is walked ON, above the water), solids
// follow the ground-standing blocker derivation exactly (walk-over trim and
// aerial stack members never block), and seawalls may stand submerged by
// design.
import { describe, expect, it } from 'vitest';
import type { ObbCollider } from '../src/sim/colliders';
import {
  FORGEFATHER_FORTRESS_PLACEMENTS,
  FORTRESS_CYLINDRICAL_KEYS,
  FORTRESS_STANDABLE_KEYS,
  forgefatherFortressColliders,
  forgefatherStreetlampSites,
} from '../src/sim/forgefather_fortress';
import {
  IGNIVAR_NON_COLLIDING_PROPS,
  IGNIVAR_PROP_COLLIDER_FOOTPRINT,
  IGNIVAR_PROP_NATIVE,
} from '../src/sim/ignivar_props';
import { terrainHeight, WATER_LEVEL } from '../src/sim/world';
import { WORLD_SEED } from '../src/sim/world_seed';

const GROUND_STAND_TOLERANCE = 2.5;

describe('forgefather fortress bake', () => {
  it('every placement resolves a registered prop', () => {
    expect(FORGEFATHER_FORTRESS_PLACEMENTS.length).toBe(185);
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
    const expected = FORGEFATHER_FORTRESS_PLACEMENTS.filter(
      (placement) =>
        placement.key !== 'staircase' &&
        !FORTRESS_STANDABLE_KEYS.has(placement.key) &&
        !IGNIVAR_NON_COLLIDING_PROPS.has(placement.key) &&
        placement.y <=
          terrainHeight(placement.x, placement.z, WORLD_SEED) + GROUND_STAND_TOLERANCE &&
        placement.y + IGNIVAR_PROP_NATIVE[placement.key].hei * placement.scale >=
          terrainHeight(placement.x, placement.z, WORLD_SEED) + 0.5,
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
    }
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
      const ground = terrainHeight(placement.x, placement.z, WORLD_SEED);
      const aerial = placement.y > ground + GROUND_STAND_TOLERANCE;
      const interred =
        placement.y + IGNIVAR_PROP_NATIVE[placement.key].hei * placement.scale < ground + 0.5;
      if (!walkOver && !aerial && !interred) continue;
      // A stacked twin at the same x/z/rot (a different y) may be a
      // legitimate blocker; only flag when no such twin explains the hit.
      const twinBlocks = FORGEFATHER_FORTRESS_PLACEMENTS.some((other) => {
        if (other === placement || other.x !== placement.x || other.z !== placement.z) return false;
        if (other.ry !== placement.ry) return false;
        if (FORTRESS_STANDABLE_KEYS.has(other.key) || IGNIVAR_NON_COLLIDING_PROPS.has(other.key))
          return false;
        const g = terrainHeight(other.x, other.z, WORLD_SEED);
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
});
