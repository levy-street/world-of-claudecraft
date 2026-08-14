// Rideable-mount view data + the procedural motion math: which VISUALS key a
// sim MountKey renders as, how high the rider sits, and the bob applied to the
// clipless mounts (the hover cycle floats, the griffin canters; the snail
// glides flat). Pure and Node-tested (tests/mount_visuals.test.ts); the
// renderer is a thin consumer. The catalog itself (names, gates, combat
// numbers) is sim content: src/sim/content/mounts.ts.

import type { MountKey } from '../sim/content/mounts';
import { MOUNTS } from '../sim/content/mounts';

export interface MountVisualSpec {
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
  /** Radius in world units of a mount that ROLLS rather than glides (the log,
   *  the barrel). 0 means it does not roll. The renderer turns the mount about
   *  its local X axis, which lies ACROSS the direction of travel, at omega =
   *  v / r so the contact patch stays still at any speed (mount_roll_core.ts). */
  rollRadius: number;
  /** How the RIDER is posed. 'seated' is every ordinary mount (the sit loop
   *  reads as riding). 'standing' is the rolling junk mounts: the rider stands
   *  on top and walks BACKWARDS against the surface, which at 2x body speed is
   *  exactly what holds them in place on a log rolling forward. */
  ridePose: 'seated' | 'standing';
}

const spec = (
  visualKey: string,
  seat: number,
  rigged: boolean,
  bob?: { amp: number; hz: number; idle?: boolean; shape?: 'hover' | 'hop' },
  seatFwd = 0,
  fx: 'slime' | 'exhaust' | null = null,
  opts: { rollRadius?: number; ridePose?: 'seated' | 'standing' } = {},
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
  rollRadius: opts.rollRadius ?? 0,
  ridePose: opts.ridePose ?? 'seated',
});

export const MOUNT_VISUAL_SPECS: Record<MountKey, MountVisualSpec> = {
  // seat tuned to the authored horse model: its saddle sits forward of the
  // origin and lower than the old Tripo build, so the rider shifts toward the
  // neck and drops a touch
  valorsteed: spec('mount_valorsteed', 2.4, true, undefined, 0.15),
  // The three junk mounts (log, barrel, cart) are all CLIPLESS Tripo props:
  // zero animations, so the bob below IS their locomotion, the same way the
  // snail and the hover cycle work. Each bob is tuned to what the object would
  // actually do rather than to a shared number: the log and the barrel roll, so
  // they hop at roughly a revolution's cadence, and the cart rattles faster and
  // shallower on its four small wheels. None of them bob at rest (no idle):
  // parked junk sits dead still, which is what sells the gag when a player
  // dismounts beside it.
  // Both cylinders lie ACROSS the direction of travel and roll forward under a
  // rider who stands on top. The seat is therefore the TOP of the cylinder (the
  // rider's feet rest on the surface) rather than a saddle height, and the
  // radius is half the model height, which for a log lying down IS its
  // diameter. The bob is small and fast: a real log bumps as it turns, but a
  // big bob would fight the roll and read as bucking.
  rolling_log: spec(
    'mount_rolling_log',
    1.4,
    false,
    { amp: 0.04, hz: 2.6, shape: 'hop' },
    0,
    null,
    { rollRadius: 0.7, ridePose: 'standing' },
  ),
  tavern_barrel: spec(
    'mount_tavern_barrel',
    1.5,
    false,
    { amp: 0.05, hz: 2.4, shape: 'hop' },
    0,
    null,
    { rollRadius: 0.75, ridePose: 'standing' },
  ),
  // The one mount the rider sits INSIDE rather than on: the seat drops to the
  // tub floor rather than the model top, and shifts back off the lantern post.
  // It does NOT roll and keeps the seated pose: it runs on wheels, so turning
  // the whole body would roll the tub and the rider with it.
  runaway_mine_cart: spec(
    'mount_runaway_mine_cart',
    1.15,
    false,
    { amp: 0.06, hz: 3, shape: 'hop' },
    -0.1,
  ),
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
