// The rideable mount hanging under a player view: building it when its lazy
// GLB lands, swapping it when the rider changes mount, tearing it down on
// dismount, and carrying whatever lit lamps the mount wears on its own rig.
//
// Extracted out of renderer.ts, which owns the per-frame entity sweep and is
// under a line ratchet (tests/monolith_budget.test.ts): the mount lifecycle is
// a self-contained state machine over three EntityView fields, so it belongs in
// its own module behind the seam src/render/CLAUDE.md names. The renderer keeps
// only the two decisions that need its own frame state (is the mount SHOWN, and
// what does the rider's seat lift become).
//
// NOT named mount_view.ts: src/render reserves the *_view and *_core suffixes
// for PURE cores registered in RENDER_PURE_CORES, and this module holds three.js
// scene graph state (tests/architecture.test.ts enforces the split).

import * as THREE from 'three';
import type { CharacterVisual } from './characters';
import { createMountVisual } from './characters';
import { mountAssetsReady, preloadMountAssets } from './characters/assets';
import { attachMountGlows, disposeMountGlows, type MountGlows } from './mount_glow';
import { attachMountLamps, disposeMountLamps, type MountLamps } from './mount_lamps';
import type { MountVisualSpec } from './mount_visuals';
import {
  attachPullerIfRickshaw,
  preloadPullerIfRickshaw,
  type RickshawMountViewState,
  releaseRickshawMountState,
  rickshawMountBuildReady,
} from './rickshaw_mount';

/** The slice of EntityView the mount lifecycle owns. The rickshaw's puller and
 *  wheel cache ride along (RickshawMountViewState): they live and die with the
 *  cart's visual, so the same build/swap/teardown edges own them. */
export interface MountViewState extends RickshawMountViewState {
  group: THREE.Group;
  mountVisual: CharacterVisual | null;
  /** '' = none; diffed each frame so a live mount swap rebuilds. */
  mountVisualKey: string;
  mountLamps: MountLamps | null;
  /** Additive halos the mount wears on its own rig (the tortoise's lenses).
   *  Unlike the lamps these are pure draw cost, so they never touch the
   *  renderer's light budget and need no reconcile. */
  mountGlows: MountGlows | null;
  mountCompilePending: boolean;
  /** Resolved seat bone, cached across frames (cleared on a mount swap). */
  mountSeatBone: THREE.Object3D | null;
}

/** Renderer services the lifecycle needs. ONE instance per renderer, never
 *  per view or per frame: the sync runs for every character view every frame
 *  and almost always early-returns, so a per-call host would be three closure
 *  allocations per entity per frame for nothing. */
export interface MountViewHost {
  /** Re-derive `v`'s contribution to the ranked point-light budget. Called
   *  whenever the mount's carried lamps appear or go away; without it a freed
   *  light stays ranked and counted into numPointLights. */
  reconcileViewLights(v: MountViewState): void;
  /** Hold the compile-pending flag until the new rig's materials have linked,
   *  so a summon does not freeze the frame it lands on (#2571). */
  gateSwapFlagOnCompile(root: THREE.Object3D, done: () => void): void;
  /** Account the rig build to the renderer's build ledger (`view:mount`). */
  recordBuild(ms: number, startedAt: number): void;
}

function teardown(v: MountViewState, host: MountViewHost): void {
  v.mountSeatBone = null;
  // The puller is parented under the cart's root and the wheel cache points
  // into it, so both go before the visual they hang off (no-op for every
  // other mount).
  releaseRickshawMountState(v, true);
  if (v.mountGlows) {
    disposeMountGlows(v.mountGlows);
    v.mountGlows = null;
  }
  if (v.mountLamps) {
    disposeMountLamps(v.mountLamps);
    v.mountLamps = null;
    host.reconcileViewLights(v);
  }
  if (v.mountVisual) {
    v.group.remove(v.mountVisual.root);
    v.mountVisual.dispose();
    v.mountVisual = null;
  }
  v.mountVisualKey = '';
}

/**
 * Reconcile the view's mount visual against the spec the rider should be on.
 *
 * `spec` is null when the rider is not mounted. Mount GLBs are lazyPreload, so
 * the first sight of a rider kicks the fetch and the visual appears on a later
 * frame once the asset is ready; until then this is a no-op beyond the fetch.
 */
export function syncMountVisual(
  v: MountViewState,
  spec: MountVisualSpec | null,
  host: MountViewHost,
): void {
  if (!spec) {
    if (v.mountVisual) teardown(v, host);
    return;
  }
  if (v.mountVisualKey === spec.visualKey) return;
  teardown(v, host);
  // A mount that composes a second rig (the rickshaw's puller) waits for BOTH
  // halves, or the cart pops in gripless for a frame; every other mount
  // answers on its own asset alone.
  if (!rickshawMountBuildReady(spec.visualKey, mountAssetsReady(spec.visualKey))) {
    void preloadMountAssets(spec.visualKey).catch((err) =>
      console.error('Failed to preload mount model:', err),
    );
    preloadPullerIfRickshaw(spec.visualKey);
    return;
  }
  const started = performance.now();
  v.mountVisual = createMountVisual(spec.visualKey);
  host.recordBuild(performance.now() - started, started);
  v.group.add(v.mountVisual.root); // group.scale already carries e.scale
  v.mountVisualKey = spec.visualKey;
  attachPullerIfRickshaw(v, spec.visualKey, v.mountVisual.root);
  // Lamps a mount carries on its own rig (the Lanternback's pair of storm
  // lanterns, the Chimeglass Tortoise's spectacle light) hang off its bones, so
  // they join the ranked point-light budget the moment the mount appears.
  v.mountLamps = attachMountLamps(v.mountVisual.root, spec);
  if (v.mountLamps) host.reconcileViewLights(v);
  v.mountGlows = attachMountGlows(v.mountVisual.root, spec);
  v.mountCompilePending = true;
  host.gateSwapFlagOnCompile(v.mountVisual.root, () => {
    v.mountCompilePending = false;
  });
}

const seatMatrix = /* @__PURE__ */ new THREE.Matrix4();
const seatOffset = /* @__PURE__ */ new THREE.Matrix4();
const groupInverse = /* @__PURE__ */ new THREE.Matrix4();
const seatScale = /* @__PURE__ */ new THREE.Vector3();

/**
 * Sit the rider ON the mount's seat bone for this frame.
 *
 * Mounts whose saddle is a fixed point on the body keep the old fixed-lift
 * path; this is for the ones whose seat MOVES under the rider. The Lanternback
 * wears his throne across his shoulders, so it rolls and pitches with every
 * stride: a rider parked at a constant height gets slid through by the chair
 * and never keeps his weight on the pan. Reading the bone puts him in the seat
 * instead, and it comes out scale-correct for free, because the offset is in
 * model units inside the same normalized wrap as the bone.
 *
 * `riderRoot` and the mount both live under `group`, so the bone's world matrix
 * is rebased into group space rather than applied raw. Scale is dropped: the
 * rider carries the entity's own scale from `group`, and multiplying in the
 * mount's normalization on top would resize him to match the troll.
 *
 * Returns false when the mount carries no seat bone, so the caller falls back.
 */
export function seatRiderOnBone(
  group: THREE.Object3D,
  riderRoot: THREE.Object3D,
  mountRoot: THREE.Object3D,
  spec: MountVisualSpec,
  cache: Pick<MountViewState, 'mountSeatBone'>,
): boolean {
  const seat = spec.seatBone;
  if (!seat) return false;
  let bone = cache.mountSeatBone;
  if (!bone || bone.name !== seat.bone) {
    bone = null;
    mountRoot.traverse((o) => {
      if (!bone && o.name === seat.bone) bone = o;
    });
    cache.mountSeatBone = bone;
    if (!bone) return false;
  }
  bone.updateWorldMatrix(true, false);
  group.updateWorldMatrix(true, false);
  seatOffset.makeTranslation(seat.offset[0], seat.offset[1], seat.offset[2]);
  seatMatrix.multiplyMatrices(bone.matrixWorld, seatOffset);
  groupInverse.copy(group.matrixWorld).invert();
  seatMatrix.premultiply(groupInverse);
  seatMatrix.decompose(riderRoot.position, riderRoot.quaternion, seatScale);
  return true;
}

/**
 * Put the rider where this mount seats him, for this frame.
 *
 * Two seat styles, one entry point. A mount whose saddle is a fixed point on
 * the body (every one but the Lanternback) holds the authored lift and forward
 * shift, plus whatever procedural bob the mount carries. A mount whose seat
 * MOVES reads its seat bone instead, so the rider tracks the seat exactly.
 *
 * `spec` null, or the mount hidden, resets him to the ground: the same call
 * covers dismounting and druid forms, so no caller has to remember to undo it.
 * That reset clears ALL of x, y, z and the rotation: a moving seat has a
 * lateral component mid-stride, so a rider who dismounts the troll or the
 * tortoise mid-lope would otherwise keep that x offset for the life of the
 * view (nothing else in the entity sweep writes the rider's x).
 */
export function placeRider(
  v: MountViewState,
  riderRoot: THREE.Object3D,
  spec: MountVisualSpec | null,
  lift: number,
  bob: number,
): void {
  if (
    spec &&
    lift > 0 &&
    v.mountVisual &&
    seatRiderOnBone(v.group, riderRoot, v.mountVisual.root, spec, v)
  ) {
    return;
  }
  riderRoot.position.x = 0;
  riderRoot.position.y = lift + bob;
  riderRoot.position.z = lift > 0 && spec ? spec.seatFwd : 0;
  riderRoot.quaternion.identity();
}

/** Drop a view's mount outright (the view itself is going away). The caller
 *  has already pulled this view's lights out of the renderer-wide pool, so
 *  this does not reconcile. */
export function disposeMountView(v: MountViewState): void {
  releaseRickshawMountState(v, true);
  if (v.mountGlows) {
    disposeMountGlows(v.mountGlows);
    v.mountGlows = null;
  }
  if (v.mountLamps) {
    disposeMountLamps(v.mountLamps);
    v.mountLamps = null;
  }
  v.mountVisual?.dispose();
  v.mountVisual = null;
  v.mountVisualKey = '';
}

/** The wire + presentation state one frame of mount transition FX reads. */
export interface MountTransitionInputs {
  mountCasting: boolean;
  mountCastKey: string;
  mountCastRemaining: number;
  mountKey: string;
  /** The rider is in a state that can play the call pose at all. */
  poseAllowed: boolean;
  /** This entity is being presented this frame (not shed by the LOD/budget). */
  present: boolean;
  playCallPose(seconds: number): void;
  summonGlow(): void;
  /** The mount's own summon call (Sfx.mountSummon); silent for a mount with
   *  no authored take. */
  summonCall(): void;
  engineReset(): void;
  preloadEngine(mountKey: string): void;
}

/**
 * Mount summon/dismount transition FX (render-only; the wire fields carry the
 * state to every client, so no SimEvent is needed). The rider throws up a call
 * pose the instant a summon begins, and a yellow-orange shimmer rings them when
 * the mount actually appears, swaps, or clears.
 *
 * Returns the next `wasMountCasting` latch for the caller to store.
 */
export function syncMountTransitionFx(
  v: { lastMountKey: string; wasMountCasting: boolean },
  x: MountTransitionInputs,
): boolean {
  // idle -> summoning edge (mountCastKey set): play the arm-raise call pose for
  // ~the transition window. A dismount (mountCastKey === '') gets no pose; its
  // effect is the completion glow below.
  if (x.mountCasting && !v.wasMountCasting && x.mountCastKey !== '' && x.poseAllowed) {
    x.playCallPose(x.mountCastRemaining);
  }
  // mountKey change = summon completed, dismount completed, or a live swap: fire
  // the shimmer at the rider. Tracked separately from mountVisualKey, which lags
  // async asset loading.
  if (x.mountKey !== v.lastMountKey) {
    v.lastMountKey = x.mountKey;
    if (x.present) x.summonGlow();
    // The mount's own call, on the same edge as the glow but only when a mount
    // actually APPEARED: mountKey '' is a dismount, which keeps the glow and
    // gets no call. A live swap is a genuine appearance and does play the new
    // mount's call. lastMountKey is seeded from the entity's current state at
    // view creation, so a rider already mounted when they enter interest range
    // (or at login) never reaches this edge and stays silent.
    if (x.mountKey !== '') x.summonCall();
    // A mountKey change (dismount, a live mount swap, or a fresh summon reusing
    // this entity id) must drop any engine mount's windup/loop state; otherwise
    // the old loop node stays connected forever once logicallyMounted goes false
    // (the entity/view-removal reset at removeView() never fires for a live swap
    // or dismount), and a swap would carry the old moving state into the new
    // mount, skipping its windup.
    x.engineReset();
    // Warm the new mount's engine clips right away (not e.g. lazily on the first
    // movement frame): a cold first ride otherwise plays the windup through
    // playAt's cold path (silently dropped past a 0.12s fetch/decode window) and
    // the loop's cold path (a fallback fade-in instead of the immediate splice),
    // reading as ~0.9s of silence then a swell. A no-op for an ordinary mount.
    if (x.mountKey !== '') x.preloadEngine(x.mountKey);
  }
  return x.mountCasting;
}
