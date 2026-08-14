// The renderer-side owner of the CONSTANT visible point-light count.
//
// three.js bakes the light counts into every material's program cache key, lit
// materials and unlit ones alike, so the number of VISIBLE point lights must
// never change for the renderer's lifetime: one changed count relinks every
// material drawn in that frame, a measured 100 to 200 ms synchronous stall
// each. `renderer.ts` keeps the registries and the pads; this module owns the
// operations that must not be open-coded per call site: adoption into the
// budget, the reparent that keeps a light out of a cull-toggled group, and the
// pass itself.
//
// Extracted from `renderer.ts` under the monolith ratchet (tests/monolith_budget).
import * as THREE from 'three';
import {
  applyPointLightBudget,
  type FireLightSink,
  flickerContributingFireLights,
  pointLightPadCount,
  type RankedPointLight,
} from './point_light_budget';

const reparentScratch = new THREE.Vector3();

/**
 * Lift every POINT light under `root` up to `scene`, preserving its world
 * position.
 *
 * A point light rides the budget, NEVER a cull-toggled group (the Sowfield
 * brazier rule). A light left inside such a group leaves the render light list
 * the moment the toggle hides its ancestor, and the budget cannot compensate on
 * that frame: it ranks against the ancestry it sees, while the cull sweeps run
 * AFTER the frame's budget pass. So a group flipping from shown to hidden while
 * one of its lights holds a counted slot drops numPointLights for that frame and
 * relinks every lit material drawn in it. Distance does not save it either: the
 * budget counts the nearest `visibleCount` ELIGIBLE lights whatever their range,
 * which only gates whether they shine.
 *
 * Applied mechanically at attach, so the NEXT builder that parents a glow into
 * its own group cannot reintroduce the stall.
 */
export function reparentStrandedLightsToScene(
  scene: THREE.Object3D,
  root: THREE.Object3D,
): THREE.PointLight[] {
  const stranded: THREE.PointLight[] = [];
  root.traverse((obj) => {
    const light = obj as THREE.Light;
    if (!light.isLight) return;
    if ((light as THREE.PointLight).isPointLight) {
      stranded.push(light as THREE.PointLight);
      return;
    }
    // A world POSITION is the whole of what describes a point light, and the
    // whole of what this lift preserves. A spot or directional light also
    // carries an orientation and a SEPARATE `target` object that would stay
    // behind in the group, and a hemisphere light has no position at all.
    // Those are the same cache-key hazard on numSpotLights / numDirLights (see
    // the Wildheart caldera interior), but each needs its own handling, so
    // report and skip rather than move one silently wrong.
    //
    // Report, not throw, deliberately: this runs inside world build on a live
    // client, and a throw here would turn a cosmetic light in the wrong group
    // into a failed world entry. The consequence is stated rather than hidden:
    // in production the message goes to a console nobody reads, so the count
    // stays unpinned for that group until someone runs the dev build. The
    // enforcement that does not depend on a reader is the attach-point scan in
    // tests/point_light_budget.test.ts.
    console.error(
      `reparentStrandedLightsToScene: "${root.name}" holds a ${light.type} inside a ` +
        'cull-toggled group; this lift only covers point lights, so its light count is unpinned',
    );
  });
  for (const light of stranded) {
    light.getWorldPosition(reparentScratch);
    scene.add(light); // add() detaches from the old parent
    light.position.copy(reparentScratch);
    // The subtree may already be frozen (freezeStaticMatrices clears
    // matrixAutoUpdate), in which case the new local position would never reach
    // the matrix and the light would keep drawing at the old world spot.
    if (!light.matrixAutoUpdate) light.updateMatrix();
  }
  return stranded;
}

export interface FireLightAdopter {
  /** Take a light into the budget: hide it, register it, dirty the rank. */
  adopt(light: THREE.PointLight): void;
  /** The same operation shaped like `Array.push`, for subsystems handed the
   *  registry. They keep calling `.push(light)` and cannot bypass adoption. */
  readonly sink: FireLightSink;
}

/**
 * Adoption is the one way a light joins the budget after construction, and it
 * does two things that are only correct together.
 *
 * It HIDES the light, because three counts a light into numPointLights the
 * moment it is visible (intensity is irrelevant): a light visible before the
 * budget has ranked it changes the count for the frames in between. Measured:
 * one frame in 5434 sat at seven budgeted lights against a pin of six, and the
 * relink it forced is the stall this exists to prevent.
 *
 * And it marks the rank DIRTY, because the rebuild guard compares
 * `rank.length` against a COUNT: a balanced add-and-remove inside one microtask
 * leaves a stale rank that never rules on the new light at all.
 *
 * `battleground.ts` already hid its field lights for exactly the first reason;
 * this is that rule made general and impossible to forget.
 */
export function createFireLightAdopter(
  fireLights: () => THREE.PointLight[],
  markRankDirty: () => void,
): FireLightAdopter {
  const adopt = (light: THREE.PointLight): void => {
    light.visible = false;
    fireLights().push(light);
    markRankDirty();
  };
  return {
    adopt,
    sink: {
      push: (...lights: THREE.PointLight[]): number => {
        for (const light of lights) adopt(light);
        return fireLights().length;
      },
    },
  };
}

/**
 * Drop every registered light that belongs to a retiring subtree, and say
 * whether the registry actually changed.
 *
 * The caller uses the answer to dirty the rank, and it MUST: the rebuild guard
 * compares `rank.length` against a count, so a retire that removes as many
 * lights as a same-microtask build added leaves a stale rank holding the
 * retired floor and missing the new one. Returning the fact, rather than
 * leaving the caller to set a flag somewhere inside a loop, is what makes that
 * testable at all.
 */
export function pruneFireLights(
  fireLights: THREE.PointLight[],
  doomed: ReadonlySet<THREE.Object3D>,
): boolean {
  let removed = false;
  for (let i = fireLights.length - 1; i >= 0; i--) {
    if (!doomed.has(fireLights[i])) continue;
    fireLights.splice(i, 1);
    removed = true;
  }
  return removed;
}

export interface FireLightBudgetPass {
  /** Pooled rank, rebuilt in place only when the set changed. */
  rank: RankedPointLight[];
  rankDirty: boolean;
  fireLights: readonly THREE.PointLight[];
  viewLights: readonly THREE.PointLight[];
  pads: readonly THREE.PointLight[];
  px: number;
  pz: number;
  /** The tier constant. This is the pinned count, never the live governor. */
  visibleCount: number;
  /** How many of the counted lights may SHINE, which never changes the count. */
  liveBudget: number;
  rangeSq: number;
  scene: THREE.Object3D;
  /** Clock for the fire flicker, or null to skip it. */
  flickerTime: number | null;
}

/**
 * One budget pass. Ranks the union of static fire lights and entity-view lights
 * (a view light counted separately would change numPointLights as it streams in
 * and out), keeps the nearest `visibleCount` visible, and tops the total up with
 * pad lights so the count holds even when fewer real lights exist.
 *
 * The caller owns the dirty flag; a completed pass always leaves the rank
 * current, so there is nothing to hand back.
 */
export function runFireLightBudgetPass(pass: FireLightBudgetPass): void {
  const ranked = pass.rank;
  const want = pass.fireLights.length + pass.viewLights.length;
  if (pass.rankDirty || ranked.length !== want) {
    ranked.length = 0;
    for (let fireIndex = 0; fireIndex < pass.fireLights.length; fireIndex++) {
      const light = pass.fireLights[fireIndex];
      ranked.push({
        light,
        d2: 0,
        worldPos: light.getWorldPosition(new THREE.Vector3()),
        base: null,
        dynamic: false,
        fireIndex,
      });
    }
    for (const light of pass.viewLights) {
      const stored = light.userData.budgetBase;
      const base = typeof stored === 'number' ? stored : light.intensity;
      const dynamic = light.userData.budgetDynamic === true;
      ranked.push({
        light,
        d2: 0,
        worldPos: light.getWorldPosition(new THREE.Vector3()),
        base: dynamic ? null : base,
        dynamic,
      });
    }
  }
  // Ancestry-aware: a chosen light under a group the world hid (zone streaming,
  // far-LOD wraps, compile gates) is not drawn, so it must not hold a counted
  // slot; the returned drawn count is what the pad fill below keys on.
  const drawnCount = applyPointLightBudget(
    ranked,
    pass.px,
    pass.pz,
    pass.visibleCount,
    pass.liveBudget,
    pass.rangeSq,
    pass.scene,
  );
  if (pass.flickerTime !== null) {
    flickerContributingFireLights(
      ranked,
      pass.flickerTime,
      pass.visibleCount,
      pass.liveBudget,
      pass.rangeSq,
    );
  }
  const padCount = pointLightPadCount(drawnCount, pass.visibleCount);
  for (let i = 0; i < pass.pads.length; i++) pass.pads[i].visible = i < padCount;
}
