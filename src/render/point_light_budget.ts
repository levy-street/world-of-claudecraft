import type * as THREE from 'three';
import { markPointLightSource } from './point_light_carriers_core';

/**
 * The append-only face of the fire-light registry that a subsystem is handed.
 *
 * Deliberately shaped like `Array.prototype.push` so a plain array still
 * satisfies it (tests and off-screen callers keep passing one), while the
 * renderer can pass an adopter that hides the light and marks the budget rank
 * dirty in the same step. A subsystem that appends a VISIBLE light the rank has
 * never seen changes numPointLights for the frames before the next budget pass,
 * and that relinks every material drawn in them.
 */
export interface FireLightSink {
  push(...lights: THREE.PointLight[]): number;
}

/**
 * The register/release face of the renderer's point-light budget
 * (`Renderer.budgetLights`), for a producer whose lights come and go with its
 * own lifecycle rather than with an entity view's reconcile.
 */
export interface BudgetPointLightRegistry {
  register(light: THREE.PointLight): void;
  release(light: THREE.PointLight): void;
}

/**
 * Join a self-driven light (its owner writes the intensity every frame) to the
 * budget as a dynamic carrier source. It is marked first, so even a producer
 * handed no registry never leaves a light three would gather beside the
 * carriers; such a light simply draws nothing.
 */
export function adoptDynamicBudgetLight(
  light: THREE.PointLight,
  registry?: BudgetPointLightRegistry | null,
): void {
  light.userData.budgetDynamic = true;
  markPointLightSource(light);
  registry?.register(light);
}

export interface RankedPointLight {
  light: THREE.PointLight;
  d2: number;
  worldPos: THREE.Vector3;
  /** Static view-light base intensity. Null for externally driven lights. */
  base: number | null;
  /** Moving VFX lights refresh their world position and intensity every frame. */
  dynamic: boolean;
  /** Stable index in the renderer's fire-light registry, absent for view lights. */
  fireIndex?: number;
  /** Working flag: drawn-eligibility computed by applyPointLightBudget. */
  eligible?: boolean;
}

export interface ReconciledViewPointLights {
  lights: THREE.PointLight[];
  changed: boolean;
}

function sameLights(
  left: readonly THREE.PointLight[],
  right: readonly THREE.PointLight[],
): boolean {
  return left.length === right.length && left.every((light, index) => light === right[index]);
}

/** Reconcile one streamed entity view's point lights with the renderer-wide pool.
 *  A view light is often born visible, so it becomes a carrier source here,
 *  before any render or compile can gather it beside the carriers. */
export function reconcileViewPointLights(
  root: THREE.Object3D,
  current: readonly THREE.PointLight[],
  all: THREE.PointLight[],
): ReconciledViewPointLights {
  const next: THREE.PointLight[] = [];
  root.traverse((object) => {
    const light = object as THREE.PointLight;
    if (light.isPointLight) next.push(light);
  });
  if (sameLights(current, next)) return { lights: current.slice(), changed: false };

  for (const light of current) {
    const index = all.indexOf(light);
    if (index >= 0) all.splice(index, 1);
  }
  for (const light of next) {
    markPointLightSource(light);
    const dynamic = light.userData.budgetDynamic === true;
    if (!dynamic && typeof light.userData.budgetBase !== 'number') {
      light.userData.budgetBase = light.intensity;
    }
    if (!all.includes(light)) all.push(light);
  }
  return { lights: next, changed: true };
}

/**
 * A light draws only if it AND its whole ancestor chain are visible. The
 * budget owns light.visible, but the world owns the ancestors (zone streaming,
 * far-LOD wraps, compile gates), so a chosen light under a hidden group would
 * hold a counted slot the render never draws, starving a light that could
 * shine. A light is drawn-eligible only if walking its parents reaches
 * `sceneRoot` through visible nodes.
 */
function isDrawnEligible(light: THREE.PointLight, sceneRoot: THREE.Object3D): boolean {
  let node = light.parent;
  while (node !== null) {
    if (node === sceneRoot) return node.visible;
    if (node.visible === false) return false;
    node = node.parent;
  }
  return false;
}

/**
 * Swap one owner's whole set of budgeted lights for its next one, in place, and
 * return the set to hold. For a producer that rebuilds its lights WHOLESALE
 * rather than streaming them one at a time: the editor's authored map lights
 * (Renderer.setEditorMapLights) are rebuilt as a group on every document edit,
 * so without the release half, every edit would stack another 24 dead lights
 * into the rank.
 *
 * Why the Studio needs this at all: it used to add every authored light to the
 * scene live and leave it shining, which is not merely "a few extra lights".
 * numPointLights is compiled into every lit material, so a 24-lamp city made
 * EVERY material in the scene loop 24 lights per fragment and re-upload 24
 * light structs on each material switch. Measured on one of SPACEY's maps
 * (harbour, Retina, 2026-09-17): 63 -> 172 fps with the DRAW COUNT UNCHANGED -
 * the cost was never geometry - and the lighting it bought was a look no
 * player can see, since the shipped game budgets these same lights anyway.
 *
 * Authored intensities are captured as the budget's base, NOT as
 * `budgetDynamic`: a lamp's brightness is a static document value, so the
 * budget owns it and hands it back whenever the lamp wins a slot again.
 */
export function swapBudgetedLights(
  viewLights: THREE.PointLight[],
  previous: readonly THREE.PointLight[],
  next: readonly THREE.PointLight[],
): THREE.PointLight[] {
  for (const light of previous) {
    const index = viewLights.indexOf(light);
    if (index >= 0) viewLights.splice(index, 1);
  }
  const held = [...next];
  for (const light of held) {
    // A carrier source at once, like a reconciled view light: three must
    // never gather an authored lamp beside the fixed carriers.
    markPointLightSource(light);
    light.userData.budgetBase = light.intensity;
    viewLights.push(light);
  }
  return held;
}

/** Steady authored lights (map lamps, non-lava pool glows: `userData.steady`)
 *  outrank ambient flicker sources when the budget is contended, so a maker's
 *  placed lamp does not go dark because a few campfires sit slightly closer.
 *  A steady entry ranks as if twice as near (its squared distance quartered);
 *  pure distance still orders entries within each class. Ranking only: the
 *  shine range test below still reads the true d2. */
const STEADY_RANK_D2_SCALE = 0.25;

function rankDistance(entry: RankedPointLight): number {
  return entry.light.userData.steady === true ? entry.d2 * STEADY_RANK_D2_SCALE : entry.d2;
}

/** Apply a fixed-count nearest-light budget without reallocating rank entries.
 *  Returns the number of counted, drawn-eligible lights. */
export function applyPointLightBudget(
  ranked: RankedPointLight[],
  px: number,
  pz: number,
  visibleCount: number,
  liveBudget: number,
  rangeSq: number,
  sceneRoot?: THREE.Object3D,
): number {
  for (const entry of ranked) {
    // Eligibility FIRST, because getWorldPosition below walks and recomputes
    // the whole ancestor matrix chain. An ineligible light is one nothing can
    // draw (a far-LOD swap hid the rig carrying it, a streamed group is off),
    // it can never hold a counted slot, and its stale d2 only ever orders it
    // against other ineligible entries in the tail the sort pushes it into.
    // Weapon-skin lights ride a rig that hides on the LOD swap, so a crowd is
    // exactly the case that pays this walk for nothing.
    entry.eligible = sceneRoot === undefined || isDrawnEligible(entry.light, sceneRoot);
    if (entry.dynamic && entry.eligible) entry.light.getWorldPosition(entry.worldPos);
    const dx = entry.worldPos.x - px;
    const dz = entry.worldPos.z - pz;
    entry.d2 = dx * dx + dz * dz;
  }
  // Sort whenever the live budget (which can sit below visibleCount under the
  // frame-budget governor or on constrained-memory tiers) actually truncates
  // the ranked list. Comparing against visibleCount alone let array order,
  // not distance, decide which lights shine whenever
  // liveBudget < ranked.length <= visibleCount. Ineligible entries sort to
  // the tail so they never hold a counted slot; on the untruncated path they
  // are skipped by the running counter instead, so a hidden ancestor never
  // forces a per-frame sort of its own (the hot path stays allocation-free).
  if (ranked.length > liveBudget) {
    ranked.sort(
      (a, b) => Number(!a.eligible) - Number(!b.eligible) || rankDistance(a) - rankDistance(b),
    );
  }
  let drawn = 0;
  for (let index = 0; index < ranked.length; index++) {
    const entry = ranked[index];
    const counted = entry.eligible !== false && drawn < visibleCount;
    if (counted) drawn++;
    entry.light.visible = counted;
    const shine = counted && drawn <= liveBudget && entry.d2 < rangeSq;
    if (entry.dynamic) {
      if (!shine) entry.light.intensity = 0;
    } else if (entry.base !== null) {
      entry.light.intensity = shine ? entry.base : 0;
    } else if (counted && !shine) {
      entry.light.intensity = 0;
    }
  }
  return drawn;
}

/** Flicker only fire lights that the completed budget says can contribute. */
export function flickerContributingFireLights(
  ranked: readonly RankedPointLight[],
  time: number,
  visibleCount: number,
  liveBudget: number,
  rangeSq: number,
): void {
  const contributingCount = Math.min(ranked.length, visibleCount, liveBudget);
  for (let index = 0; index < contributingCount; index++) {
    const entry = ranked[index];
    const fireIndex = entry.fireIndex;
    if (fireIndex === undefined || entry.d2 >= rangeSq || entry.eligible === false) continue;
    const base = (entry.light.userData.baseIntensity as number | undefined) ?? 11;
    // Steady lights (authored lamps, still pools) hold their base; fires flicker.
    entry.light.intensity =
      entry.light.userData.steady === true
        ? base
        : base + Math.sin(time * 11 + fireIndex * 1.7) * 2.5 * (base / 11);
  }
}
