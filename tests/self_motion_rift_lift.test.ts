// Issue #3479 (enable self-motion prediction inside rifts): direct unit
// coverage for the pure lift-resolution pair self_motion.ts calls every
// predictor step. tests/self_motion.test.ts's "rift prediction" describe
// block already exercises this end to end through the predictor kernel; this
// file pins the two functions in isolation, including the region-containment
// guard (riftLiftFor returns 0 off the mirrored floor's band) that end-to-end
// suite has no reason to ever hit.

import { describe, expect, it } from 'vitest';
import { resolvedRiftFloorPlan, riftLiftFor } from '../src/render/self_motion_rift_lift';
import {
  isRiftPos,
  RIFT_BAND_X_MIN,
  RIFT_REGION_HALF_X,
  RIFT_REGION_HALF_Z,
  RIFT_X_MIN,
  riftInstanceOrigin,
} from '../src/sim/data';
import { generateRiftFloor, riftLiftAt } from '../src/sim/rift/rift_gen';
import type { RiftUpgradeManifest } from '../src/sim/rift/types';
import type { RiftFloorView } from '../src/world_api/dungeons';

// Same procedural fixture tests/self_motion.test.ts's ramp-walking test uses:
// a raised platform reached by a ramp spanning local z 84..94.
const PLATFORM_SEED = 6;
const PLATFORM_BASE_LEVEL = 20;

function riftFloorView(overrides: Partial<RiftFloorView> = {}): RiftFloorView {
  return {
    eventId: null,
    instanceId: 0,
    seed: PLATFORM_SEED,
    baseLevel: PLATFORM_BASE_LEVEL,
    floorIndex: 0,
    floorCount: 5,
    origin: riftInstanceOrigin(0, 0),
    contentId: `procedural-v1:${PLATFORM_SEED}:${PLATFORM_BASE_LEVEL}`,
    contentHash: `procedural-v1:${PLATFORM_SEED}:${PLATFORM_BASE_LEVEL}`,
    upgrade: null,
    name: 'Test Rift',
    themeName: 'Test Theme',
    tier: null,
    ...overrides,
  };
}

describe('resolvedRiftFloorPlan (issue #3479)', () => {
  it('resolves null for a null floor', () => {
    expect(resolvedRiftFloorPlan(null)).toBeNull();
  });

  it('resolves the same plan generateRiftFloor hands the server for a real floor', () => {
    const view = riftFloorView();
    const plan = resolvedRiftFloorPlan(view);
    expect(plan).not.toBeNull();
    const direct = generateRiftFloor(view.seed, view.baseLevel, view.floorIndex, view.upgrade);
    expect(plan).toBe(direct);
  });

  // Every other case in this describe block leaves view.upgrade at its
  // riftFloorView() default of null, so dropping the upgrade argument from
  // resolvedRiftFloorPlan's generateRiftFloor call would be undetectable.
  // This one carries a real manifest and asserts the resolved plan is the
  // UPGRADED plan (name/themeName rewritten by applyRiftUpgrade), not the
  // base procedural one, so the upgrade argument threading through is
  // actually exercised.
  it('resolves the UPGRADED plan, not the base one, when the descriptor carries an upgrade manifest', () => {
    const upgrade: RiftUpgradeManifest = {
      schemaVersion: 1,
      title: 'Test Upgrade Directive',
      synopsis: 'A test-authored directive.',
      lore: [],
      floors: [
        {
          floorIndex: 0,
          themeId: 'frost',
          pacing: 'pressure',
          monsterIds: [],
          specialEvent: 'none',
          environmentalDetails: [],
        },
      ],
      boss: { templateId: 'rift_boss_test', name: 'Test Boss', concept: 'test' },
      rewards: { lootMultiplier: 1, craftingMaterialBias: 0 },
      assetRequests: [],
    };
    const view = riftFloorView({ upgrade });
    const plan = resolvedRiftFloorPlan(view);
    expect(plan).not.toBeNull();
    const upgraded = generateRiftFloor(view.seed, view.baseLevel, view.floorIndex, upgrade);
    const base = generateRiftFloor(view.seed, view.baseLevel, view.floorIndex, null);
    expect(plan).toBe(upgraded);
    expect(plan?.name).not.toBe(base.name);
    expect(plan?.name).toContain('Test Upgrade Directive');
  });
});

describe('riftLiftFor (issue #3479)', () => {
  it('is 0 when the plan is null (not in a rift)', () => {
    const origin = riftInstanceOrigin(0, 0);
    expect(riftLiftFor(null, origin, origin.x, origin.z)).toBe(0);
  });

  // RIFT_REGION_HALF_X is deliberately aligned to RIFT_BAND_X_MIN (the
  // module header on src/sim/data.ts says so: "a position is never
  // region-detected while isRiftPos() reads false"), so for THIS axis the
  // separate containment check below always agrees with isRiftPos: there is
  // no x for which containment passes but isRiftPos fails, and no input can
  // isolate the `!isRiftPos(x)` branch in riftLiftFor from the containment
  // branch that follows it. What actually keeps that branch honest is this
  // alignment; pin it directly so a future change to either constant that
  // breaks it fails here instead of silently opening a gap between the two
  // guards.
  it('the region half-width is exactly aligned to the isRiftPos band edge', () => {
    expect(RIFT_X_MIN - RIFT_REGION_HALF_X).toBe(RIFT_BAND_X_MIN);
    expect(isRiftPos(RIFT_X_MIN - RIFT_REGION_HALF_X)).toBe(true);
    expect(isRiftPos(RIFT_X_MIN - RIFT_REGION_HALF_X - 1)).toBe(false);
  });

  it('is 0 at a non-rift x, even with a resolved plan (fails both isRiftPos and containment)', () => {
    const view = riftFloorView();
    const plan = resolvedRiftFloorPlan(view);
    expect(riftLiftFor(plan, view.origin, 0, 0)).toBe(0);
  });

  it('matches riftLiftAt on the raised plateau, local to the floor origin', () => {
    const view = riftFloorView();
    const plan = resolvedRiftFloorPlan(view);
    expect(plan).not.toBeNull();
    if (!plan) throw new Error('unreachable: plan resolved above');
    const localX = 0;
    const localZ = 100; // past the ramp's rampZ1 (94): flat plateau height
    const expected = riftLiftAt(plan, localX, localZ);
    expect(expected).toBeGreaterThan(0);
    expect(riftLiftFor(plan, view.origin, view.origin.x + localX, view.origin.z + localZ)).toBe(
      expected,
    );
  });

  it('is 0 outside the mirrored region even though isRiftPos(x) is true (containment guard)', () => {
    const view = riftFloorView();
    const plan = resolvedRiftFloorPlan(view);
    // Well past RIFT_REGION_HALF_Z from this floor's own origin, but still
    // inside the rift x-band (isRiftPos reads true): a neighboring floor's
    // footprint, which riftLiftFor must not reach into.
    const farZ = view.origin.z + RIFT_REGION_HALF_Z + 50;
    expect(riftLiftFor(plan, view.origin, view.origin.x, farZ)).toBe(0);

    const farX = view.origin.x + RIFT_REGION_HALF_X + 5;
    expect(riftLiftFor(plan, view.origin, farX, view.origin.z)).toBe(0);
  });
});
