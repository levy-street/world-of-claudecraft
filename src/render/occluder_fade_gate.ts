// The occluder-fade GATE: the hold between "this structure blocks the camera"
// and "its materials draw transparent".
//
// A structure fades by flipping `transparent` (occluder_fade.ts) or by drawing
// a pooled transparent stand-in (instanced_occluder_ghosts.ts), and three keys
// its program cache on that flip, so the first fade of each program links it
// cold. The boot manifest stages one hidden twin per program for exactly that
// (props.ghost-fade-variants, foliage.materials), but both entries are
// droppable under the entry deadline and resume in the lowest lane, while the
// player's first camera turn after the curtain is the moment a tree or a house
// crosses the eye-to-camera segment. On a boot that dropped them the flip
// still linked inside that live frame.
//
// This module is the fade family's reveal gate (reveal_gate.ts): the key is
// the program identity (occluder_ghost_variant_key.ts, or the instanced-ghost
// key), the root is a hidden twin on that program, and the consult happens on
// the fade's edge frame. A cold key fires ONE compile of the twin through the
// renderer's reveal host and answers "hold": the structure keeps drawing
// opaque, its fade state keeps stepping, and the flip lands the frame the
// link settles. An EDGE consult (the camera is inside this structure now, and
// the player's own body is what the opaque wall hides) rides the actionable
// floor of the queue, like the character-effect swap: measured on a
// congested integrated GPU, a reveal-lane unit waited 4.4 s in the queue
// before its 0.3 s link, and the edge frame cannot wait behind cosmetic
// scenery. A PREFETCH consult asks the same question ahead of the first
// occlusion for structures within the camera's reach
// (OCCLUDER_FADE_PREFETCH_YD), at the ordinary reveal priority, or imminent
// under an arrival curtain so the curtain's bounded wait covers them too. The
// reveal gate requests a key's compile once, at the priority of its FIRST
// consult, so an edge frame that meets a key a prefetch already queued
// ESCALATES it: one more compile of the same twin, submitted at the
// actionable floor outside the gate, and the key settles when either lands
// (the driver links one program; the later unit is a cache hit). There is NO
// wall-clock bound: the hold ends on the twin's own settle or on the reveal
// gate's watchdog.
//
// Why a module-level registry rather than an injected gate: the fade painters
// are five hideable registries plus the instanced-ghost pools, none of which
// shares a host object, and the gate is owned by whichever renderer currently
// owns the compile host (a graphics rebuild installs a fresh one and the old
// twins go with the old context). Same shape as arrival_cover.ts. Without an
// installed gate (no async compile, tests, the editor) every consult answers
// "ready", which is the historical immediate flip.
//
// What the player sees during a hold is the structure itself, drawn OPAQUE
// exactly as it drew before it crossed the segment: the hold delays a
// cosmetic see-through, never a representation (every entity behind the
// wall keeps drawing, the camera simply cannot see through the wall yet, as
// it could not before the fade existed). The character-effect swap makes the
// same trade (a late fade beats a frozen frame), and like every reveal gate
// the hold ends on evidence (the twin's settle) or the reveal watchdog.
//
// Memory: one hidden twin per program key stays retained for the gate's life
// (a cloned material, its texture references, and the live geometry it
// shares): JS heap plus one pinned GL program per key, a few dozen keys for a
// whole world. uninstallOccluderFadeGate releases them with the renderer.
import * as THREE from 'three';
import { arrivalCoverActive } from './arrival_cover';
import { GPU_WORK_PRIORITY } from './background_gpu_queue';
import { cloneMaterialWithHooks } from './material_clone_hooks';
import { OCCLUDER_FADE_ALPHA } from './occluder_fade_core';
import {
  clearOccluderGhostMarker,
  markOccluderGhostTwin,
  type OccluderGhostTarget,
} from './occluder_ghost_variant_key';
import { createRevealGate, type RevealCompileHost, type RevealGate } from './reveal_gate';

/**
 * A hidden twin of `target` in EXACTLY the state applyOccluderFade writes
 * below alpha 1, sharing the live geometry and mesh kind (three reads
 * `isInstancedMesh`, `instanceColor` and the geometry's tangent/colour/morph
 * attributes into the same key). Sharing the geometry costs nothing: a twin
 * is never drawn. Never dispose one: disposing a material releases the linked
 * program the twin exists to keep.
 */
export function buildOccluderFadeTwin(target: OccluderGhostTarget, suffix: string): THREE.Mesh {
  const material = cloneMaterialWithHooks(target.material);
  material.name = `${target.material.name || target.material.type}:${suffix}`;
  material.transparent = true;
  material.depthWrite = true;
  material.opacity = target.material.opacity * OCCLUDER_FADE_ALPHA;
  clearOccluderGhostMarker(material);
  markOccluderGhostTwin(material);

  let mesh: THREE.Mesh;
  if (target.instanced) {
    const instanced = new THREE.InstancedMesh(target.geometry, material, 1);
    instanced.setMatrixAt(0, new THREE.Matrix4());
    if (target.instanceColor) instanced.setColorAt(0, new THREE.Color(1, 1, 1));
    mesh = instanced;
  } else {
    mesh = new THREE.Mesh(target.geometry, material);
  }
  mesh.name = material.name;
  mesh.visible = false;
  mesh.frustumCulled = false;
  return mesh;
}

/** Which consult a caller makes: the edge frame of a fade, or a look ahead. */
export type OccluderFadeConsult = 'edge' | 'prefetch';

let gate: RevealGate | null = null;
let installedHost: RevealCompileHost | null = null;
/** Twins whose FIRST consult was an edge frame: their compile is named at the
 *  actionable floor when the reveal gate requests it. */
const edgeTwins = new WeakSet<THREE.Object3D>();
/** Keys a later edge frame escalated past their prefetch request. */
const escalated = new Set<string>();
/** The one consult-time allocation the gate avoids: a mint is a function
 *  plus its argument, never a closure built per frame. */
export type OccluderFadeTwinMint<T> = (arg: T) => THREE.Object3D;

/** Key to its compile root. Minted on the first consult of a key and kept for
 *  the life of the gate: the twin's material is the reference that keeps the
 *  variant program linked while every live material is still opaque. */
const twins = new Map<string, THREE.Object3D>();

/** The renderer that owns the reveal compile host installs the gate; a
 *  rebuild installs a fresh one, and the previous twins go with the previous
 *  context. */
export function installOccluderFadeGate(host: RevealCompileHost): void {
  twins.clear();
  escalated.clear();
  installedHost = host;
  const fadeHost: RevealCompileHost = {
    ...host,
    compile: (root, imminent) =>
      host.compile(
        root,
        imminent,
        edgeTwins.has(root as THREE.Object3D) ? GPU_WORK_PRIORITY.ACTIONABLE_VIEW : undefined,
      ),
  };
  gate = createRevealGate(fadeHost, (key) => {
    const twin = twins.get(key);
    return twin ? [twin] : [];
  });
}

/** The renderer's teardown drops the gate and its twins with the context
 *  they were linked on (renderer_resource_lifecycle.ts). */
export function uninstallOccluderFadeGate(): void {
  gate = null;
  installedHost = null;
  twins.clear();
  escalated.clear();
}

/** The edge frame met a key the reveal gate already requested at a lower
 *  priority: compile the twin once more at the actionable floor and settle
 *  the key on that result. Fail-soft like the gate itself: a throw or a
 *  rejection settles too (no compile remains active, the flip's first draw
 *  falls back to three's own link). */
function escalate(key: string, twin: THREE.Object3D): void {
  const host = installedHost;
  const owner = gate;
  if (host === null || owner === null) return;
  escalated.add(key);
  const settle = (): void => {
    if (gate === owner) owner.settle(key);
  };
  const compile = (): void => {
    try {
      Promise.resolve(host.compile(twin, true, GPU_WORK_PRIORITY.ACTIONABLE_VIEW)).then(
        settle,
        settle,
      );
    } catch {
      settle();
    }
  };
  // The same page-entry barrier the reveal gate's own requests honour: no
  // cosmetic GPU work before the first painted world frame.
  let afterFirstPaint: Promise<void> | null | undefined;
  try {
    afterFirstPaint = host.startAfterInitialPaint?.();
  } catch {
    afterFirstPaint = null;
  }
  if (afterFirstPaint) void Promise.resolve(afterFirstPaint).then(compile, compile);
  else compile();
}

export function occluderFadeGateInstalled(): boolean {
  return gate !== null;
}

/**
 * May a fade on the program `key` draw now? The first consult of a key mints
 * its twin and fires its compile; every consult until the settle answers
 * false. An edge consult is imminent and names the actionable floor; a
 * prefetch is imminent only under an arrival curtain (the structures within
 * reach of the camera it lands among are part of what the curtain's bounded
 * wait exists to link). Priority buys queue position only, never an early
 * flip.
 */
export function occluderFadeTwinReady<T>(
  key: string,
  consult: OccluderFadeConsult,
  mint: OccluderFadeTwinMint<T>,
  arg: T,
): boolean {
  if (gate === null) return true;
  let twin = twins.get(key);
  if (twin === undefined) {
    twin = mint(arg);
    twins.set(key, twin);
    if (consult === 'edge') edgeTwins.add(twin);
  }
  const ready = gate.allow(key, consult === 'edge' || arrivalCoverActive());
  if (!ready && consult === 'edge' && !edgeTwins.has(twin) && !escalated.has(key)) {
    escalate(key, twin);
  }
  return ready;
}

/** Keys escalated so far, for tests and diagnostics. */
export function occluderFadeEscalatedCount(): number {
  return escalated.size;
}

/** Twins minted so far, for tests and diagnostics. */
export function occluderFadeTwinCount(): number {
  return twins.size;
}

export function resetOccluderFadeGateForTest(): void {
  uninstallOccluderFadeGate();
}
