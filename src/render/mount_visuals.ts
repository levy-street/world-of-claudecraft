// Rideable-mount view data + the procedural motion math: which VISUALS key a
// sim MountKey renders as, how high the rider sits, and the bob applied to the
// clipless mounts (the hover cycle floats, the griffin canters; the snail
// glides flat). Pure and Node-tested (tests/mount_visuals.test.ts); the
// renderer is a thin consumer. The catalog itself (names, gates, combat
// numbers) is sim content: src/sim/content/mounts.ts.

import type { MountKey } from '../sim/content/mounts';
import { MOUNTS } from '../sim/content/mounts';

export interface MountVisualSpec {
  /** Tip nose-up on a jump and right itself before landing (see
   *  mount_jump_attitude). Vehicles only: a creature's legs already absorb a
   *  launch, and pitching one reads as a bug. */
  jumpTips: boolean;
  /** VISUALS key (src/render/characters/manifest.ts, lazyPreload). */
  visualKey: string;
  /** World-unit rider lift onto the saddle at e.scale = 1. */
  seat: number;
  /** World-unit rider shift along facing (negative = toward the tail) for
   *  mounts whose saddle sits off the model origin (the toad's is well back). */
  seatFwd: number;
  /** Carries baked Idle/Walk/Run gait clips (scripts/bake_mount_gaits.mjs).
   *  The clipless rest render their generated standing pose and move via the
   *  bob below. */
  rigged: boolean;
  /** Procedural bob amplitude in world units (0 = none). */
  bobAmp: number;
  /** Bob frequency in cycles per second. */
  bobHz: number;
  /** Bob even while standing (the hover cycle floats in place). */
  bobIdle: boolean;
  /** Bob shape: a smooth hover sine, or gallop-style hops (abs sine). */
  bobShape: 'hover' | 'hop';
  /** Ambient particle effect the renderer emits for this mount: the snail's
   *  slime path while moving, the hover cycle's aether exhaust. */
  fx: 'slime' | 'exhaust' | null;
}

const spec = (
  visualKey: string,
  seat: number,
  rigged: boolean,
  bob?: { amp: number; hz: number; idle?: boolean; shape?: 'hover' | 'hop' },
  seatFwd = 0,
  fx: 'slime' | 'exhaust' | null = null,
  jumpTips = false,
): MountVisualSpec => ({
  visualKey,
  seat,
  seatFwd,
  rigged,
  bobAmp: bob?.amp ?? 0,
  bobHz: bob?.hz ?? 0,
  bobIdle: bob?.idle ?? false,
  bobShape: bob?.shape ?? 'hop',
  fx,
  jumpTips,
});

export const MOUNT_VISUAL_SPECS: Record<MountKey, MountVisualSpec> = {
  // seat tuned to the authored horse model: its saddle sits forward of the
  // origin and lower than the old Tripo build, so the rider shifts toward the
  // neck and drops a touch
  valorsteed: spec('mount_valorsteed', 2.4, true, undefined, 0.15),
  grag_bear: spec('mount_grag_bear', 3.35, true, undefined, -0.8),
  stalkglider_snail: spec('mount_stalkglider_snail', 2.65, false, undefined, -0.3, 'slime'),
  aether_hover_cycle: spec(
    'mount_aether_hover_cycle',
    2.1,
    false,
    { amp: 0.14, hz: 1.1, idle: true, shape: 'hover' },
    0,
    'exhaust',
  ),
  shadowjump_toad: spec('mount_shadowjump_toad', 2.52, true, undefined, -0.5),
  // gait-rigged by bake_mount_gaits.mjs (buildPropRig): real Walk/Run clips
  // replaced the old procedural canter hop
  stormfeather_griffin: spec('mount_stormfeather_griffin', 2.75, true),
  // ships its authored strut cycle as Walk/Run plus a baked breathing Idle;
  // the saddle sits over the hips, behind the neck (hence the rear shift)
  thunderstrut_gobbler: spec('mount_thunderstrut_gobbler', 2.05, true, undefined, -0.15),
  // Compact tracked vehicle with an authored rider socket behind the turret.
  // Its rigid-body clips animate the suspension and track wheels without a
  // procedural bob, keeping the pilot locked to the saddle.
  terrorspark_groundshaker: spec('mount_terrorspark_groundshaker', 2.38, true, undefined, -0.3),
  // The Drakemaw Raptor: authored saddle sits over the hips behind the neck
  // spines (hence the slight rear shift), gait-rigged Walk/Run cycles.
  drakemaw_raptor: spec('mount_drakemaw_raptor', 2.35, true, undefined, -0.1),
  // Bonebound Rickshaw: ships no baked clips (its wheels roll procedurally from
  // rickshaw_mount.ts's spinMountWheels), so the body gets a light procedural jostle
  // instead of a gait cycle. seat/seatFwd are the authored bench-seat socket
  // at the cart's own RICKSHAW_SCALE (2.0).
  // 2026-08-09: this `seat` value (1.94) was stale, still reflecting the
  // ORIGINAL pre-cushion socket (local Y 0.97), never updated when the socket
  // itself moved to local Y 1.12 for the tufted seat cushion (see
  // model.js's RICKSHAW_SOCKET_DEFINITIONS, "raised from v1's 0.97 to sit on
  // top of the new seat cushion"). A live look confirmed exactly this: rider
  // sitting low enough to clip into the cushion. Corrected to 1.12 * 2 = 2.24
  // to match the socket that's actually been shipping.
  // `rigged` stays false rather than true, even though this mount is now
  // procedurally animated (the wheels) rather than fully static, so it still
  // gets the procedural bob other clipless mounts get. What the flag buys
  // elsewhere is the convention that a rigged mount's clips carry ALL its
  // motion, and this one cannot follow that: the renderer applies the
  // procedural bob to the rider and, because the puller rig is parented
  // inside the mount, to the puller too. Baking a body bob into clips would
  // bob the cart WITHOUT the puller, swinging the shaft harness collar +-0.05
  // against a belt overlap with only 0.034 of margin, and the harness would
  // visibly come off his waist every cycle.
  // jumpTips: a two-wheeled cart with no suspension and no legs. It tips
  // nose-up off a jump and rights itself before landing; the puller rides that
  // rotation with it, keeping the shafts in its hands.
  rickshaw_mount: spec(
    'mount_rickshaw_mount',
    2.24,
    false,
    { amp: 0.05, hz: 2.4 },
    -0.3,
    null,
    true,
  ),
};

/** Spec for an entity's active mountKey, or null when dismounted/unknown. */
export function mountVisualSpec(mountKey: string): MountVisualSpec | null {
  return mountKey in MOUNTS ? MOUNT_VISUAL_SPECS[mountKey as MountKey] : null;
}

/** World-unit rider lift for the active mountKey ('' or unknown: 0). */
export function mountSeatLift(mountKey: string): number {
  return mountVisualSpec(mountKey)?.seat ?? 0;
}

/** Procedural vertical offset for a clipless mount at time t (seconds). */
export function mountBobY(spec: MountVisualSpec, timeSec: number, moving: boolean): number {
  if (spec.bobAmp <= 0) return 0;
  if (!moving && !spec.bobIdle) return 0;
  const wave = Math.sin(timeSec * Math.PI * 2 * spec.bobHz);
  return (spec.bobShape === 'hover' ? wave : Math.abs(wave)) * spec.bobAmp;
}
