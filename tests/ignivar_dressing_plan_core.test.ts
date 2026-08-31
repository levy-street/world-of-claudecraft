// The Ignivar prop dressing plan: gameplay clearances hold on the REAL room
// layouts, the beam outline stays flush against the collider wall line, the
// shipped prop GLBs stay inside their byte budget, and every wired prop is
// actually placed in a room (the loader downloads the whole URL map for
// every player at world entry, so an unplaced prop is pure dead weight).
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { getBounds, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { describe, expect, it } from 'vitest';
import {
  filterIgnivarPropPlacements,
  IGNIVAR_PROP_NATIVE,
  type IgnivarPropPlacement,
  ignivarApproachPropPlan,
  ignivarArenaPropPlan,
  ignivarCruciblePropPlan,
} from '../src/render/ignivar_dressing_plan_core';
import { IGNIVAR_ENV_PROP_URLS } from '../src/render/ignivar_env_props';
import { IGNIVAR_APPROACH_CLEAR_HALF_WIDTH } from '../src/render/ignivar_raid_dressing';
import {
  IGNIVAR_FORGE_APPROACH_LAYOUT,
  IGNIVAR_LAYOUT,
  IGNIVAR_SECOND_WING_LAYOUT,
} from '../src/sim/dungeon_layout';
import { VARKHUL_FORGE_LOCAL_POS } from '../src/sim/encounters/varkhul';

const publicDir = path.join(__dirname, '..', 'public');

const floorLevel = (placement: IgnivarPropPlacement) => placement.y === 0;

describe('ignivar dressing plan', () => {
  it('keeps the approach combat corridor clear along the walkable hall', () => {
    const plan = ignivarApproachPropPlan(IGNIVAR_FORGE_APPROACH_LAYOUT);
    // The hand-placed pass: perimeter pillar ring + east reactor wall +
    // both end-wall vault doors + the six centre torch pillars + chains.
    expect(plan.length).toBeGreaterThanOrEqual(22);
    expect(plan.filter((placement) => placement.key === 'vault_door').length).toBe(2);
    // One centre pillar per torch point, glued to the layout.
    expect(
      plan.filter((placement) => placement.key === 'pillar_slim').length,
    ).toBeGreaterThanOrEqual((IGNIVAR_FORGE_APPROACH_LAYOUT.pillars ?? []).length + 9);
    for (const placement of plan) {
      if (!floorLevel(placement)) continue;
      // Door dressing hugs the end walls; the corridor contract covers the
      // walkable hall span between them.
      if (Math.abs(placement.z) > 50) continue;
      expect(
        Math.abs(placement.x),
        `${placement.key} at ${placement.x},${placement.z} blocks the corridor`,
      ).toBeGreaterThan(IGNIVAR_APPROACH_CLEAR_HALF_WIDTH);
    }
  });

  it('keeps the arena fighting circle clear (dressing rings the outer walls)', () => {
    // The water pumps (the reworked conduits) and their pipes sit on the
    // corner anchors near +/-18, and the rest of the pass hugs the walls, so
    // the central fighting circle stays open for the Ignivar encounter.
    const plan = ignivarArenaPropPlan(IGNIVAR_LAYOUT);
    expect(plan.length).toBeGreaterThanOrEqual(30);
    for (const placement of plan) {
      if (!floorLevel(placement)) continue;
      expect(
        Math.hypot(placement.x, placement.z),
        `${placement.key} at ${placement.x},${placement.z} enters the fighting circle`,
      ).toBeGreaterThan(18);
    }
  });

  it('keeps the crucible fighting floor clear', () => {
    const plan = ignivarCruciblePropPlan(IGNIVAR_SECOND_WING_LAYOUT);
    // The hand-placed pass: furnace banks on the east and west walls, the
    // workshop face around the south door, the lava-fed north wall, corner
    // panels, wall drapes, and the roof chains over the forge anchor.
    expect(plan.length).toBeGreaterThanOrEqual(40);
    // Every floor placement hugs the walls: the trench-bounded fighting
    // floor (the render rig declares clear radius 32) stays open for the
    // Varkhul encounter, with margin. The one carve-out is the forge
    // anchor: the anvil the boss works pre-pull stands beside the
    // assembly forge, inside the circle by design.
    for (const placement of plan) {
      if (!floorLevel(placement)) continue;
      const forgeDistance = Math.hypot(
        placement.x - VARKHUL_FORGE_LOCAL_POS.x,
        placement.z - VARKHUL_FORGE_LOCAL_POS.z,
      );
      if (forgeDistance <= 10) continue;
      expect(
        Math.hypot(placement.x, placement.z),
        `${placement.key} at ${placement.x},${placement.z} enters the fighting floor`,
      ).toBeGreaterThan(32);
    }
  });

  it('drops density but never structure on the low tier', () => {
    for (const plan of [
      ignivarApproachPropPlan(IGNIVAR_FORGE_APPROACH_LAYOUT),
      ignivarArenaPropPlan(IGNIVAR_LAYOUT),
      ignivarCruciblePropPlan(IGNIVAR_SECOND_WING_LAYOUT),
    ]) {
      const low = filterIgnivarPropPlacements(plan, true);
      const high = filterIgnivarPropPlacements(plan, false);
      expect(high.length).toBe(plan.length);
      expect(low.length).toBeLessThan(high.length);
      for (const key of ['anvil', 'forge', 'vault_door'] as const) {
        const inFull = plan.some((placement) => placement.key === key);
        if (inFull) expect(low.some((placement) => placement.key === key)).toBe(true);
      }
    }
  });

  it('ships every prop GLB inside the byte budget', () => {
    let total = 0;
    for (const url of Object.values(IGNIVAR_ENV_PROP_URLS)) {
      const file = path.join(publicDir, url.replace(/^\//, ''));
      expect(existsSync(file), `${url} should exist under public/`).toBe(true);
      const bytes = statSync(file).size;
      expect(bytes, `${url} exceeds the per-prop budget`).toBeLessThanOrEqual(400_000);
      // The total budget covers the bytes THIS set adds to the download:
      // cross-referenced fixtures from other shipped systems (the town
      // streetlamp the placer kit reuses) ship regardless and count only
      // against the per-prop bound above.
      if (url.includes('/ignivar_prop_')) total += bytes;
    }
    // Raised from 7_000_000 when the 19-piece Exterior_Assets fortress kit
    // joined the roster (35 to 54 props), re-tightened to the measured
    // KTX2 total (9_645_164), then raised for the owner-directed fortress
    // night glow: the whole exterior kit carries a half-resolution floored
    // emissive texture (the soft red sheen, floor scaled per piece so
    // floor times strength stays even; measured total 10_560_556), raised
    // for the owner's dungeon_entrance facade (10_802_120), again for the
    // eight-piece forge-lift car kit and the winch remake's mount and
    // spool pair minus the retired one-piece winch and sliding door
    // (12_731_480), then TIGHTENED twice: the entrance arm stripped the
    // unplaced lava_furnace_2 and lava_ramp, and the raid arm's 2026-08
    // unplaced-prop trim dropped the unplaced interior placer stock while
    // adding water_pump; the merge restored gear_machine, which the
    // approach room's forge-lift shaft dressing places (merged measured
    // total 10_139_544) plus a sliver of rebake headroom. The
    // no-unplaced-props rule itself is pinned by
    // tests/ignivar_asset_hygiene.test.ts over the real sim tables.
    expect(total, 'prop set exceeds the total budget').toBeLessThanOrEqual(10_200_000);
  });

  it('pins the native dims table to the shipped GLBs (canonical long-axis-on-X)', async () => {
    const io = new NodeIO()
      .registerExtensions(ALL_EXTENSIONS)
      .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
    for (const [key, url] of Object.entries(IGNIVAR_ENV_PROP_URLS)) {
      const doc = await io.read(path.join(publicDir, url.replace(/^\//, '')));
      const root = doc.getRoot();
      // The runtime template bakes exactly one mesh; a rebake that splits
      // the prop would silently drop geometry there. The reused town
      // streetlamp is the one sanctioned exception: its second primitive is
      // the flame, and only the placer PREVIEW rides the env-prop template
      // (the world instance renders complete through render/streetlamps.ts).
      expect(root.listMeshes().length, `${key} must stay a single mesh`).toBe(1);
      if (key !== 'street_lamp')
        expect(root.listMeshes()[0].listPrimitives().length, `${key} single primitive`).toBe(1);
      const scene = root.getDefaultScene() ?? root.listScenes()[0];
      const bounds = getBounds(scene);
      let dx = bounds.max[0] - bounds.min[0];
      const dy = bounds.max[1] - bounds.min[1];
      let dz = bounds.max[2] - bounds.min[2];
      if (dz > dx) [dx, dz] = [dz, dx];
      const native = IGNIVAR_PROP_NATIVE[key as keyof typeof IGNIVAR_PROP_NATIVE];
      expect(Math.abs(dx - native.len), `${key} len drifted (${dx.toFixed(3)})`).toBeLessThan(0.02);
      expect(Math.abs(dy - native.hei), `${key} hei drifted (${dy.toFixed(3)})`).toBeLessThan(0.02);
      expect(Math.abs(dz - native.dep), `${key} dep drifted (${dz.toFixed(3)})`).toBeLessThan(0.02);
    }
  });

  it('never spends more draw calls on the low tier than on high', () => {
    const drawsFor = (placements: readonly IgnivarPropPlacement[]) => {
      const counts = new Map<string, number>();
      for (const placement of placements)
        counts.set(placement.key, (counts.get(placement.key) ?? 0) + 1);
      let draws = 0;
      // Mirrors appendIgnivarEnvProps: kinds with 2+ placements batch into
      // one InstancedMesh; singles draw as plain meshes.
      for (const count of counts.values()) draws += count >= 2 ? 1 : count;
      return draws;
    };
    for (const plan of [
      ignivarApproachPropPlan(IGNIVAR_FORGE_APPROACH_LAYOUT),
      ignivarArenaPropPlan(IGNIVAR_LAYOUT),
      ignivarCruciblePropPlan(IGNIVAR_SECOND_WING_LAYOUT),
    ]) {
      const low = drawsFor(filterIgnivarPropPlacements(plan, true));
      const high = drawsFor(filterIgnivarPropPlacements(plan, false));
      expect(low, `low tier draws (${low}) must not exceed high (${high})`).toBeLessThanOrEqual(
        high,
      );
    }
  });
});
