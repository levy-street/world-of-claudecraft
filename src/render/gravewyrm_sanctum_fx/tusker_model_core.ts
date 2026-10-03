// The Sledge Tusker's Blender body and its sledge, measured (the delivery's
// integration notes, E:/woc/entregas/santuario/tusker NOTAS.md, and a posed
// probe of the shipped GLBs): the facts the look
// (characters/sanctum_creature_looks.ts), the sledge and body effects
// (tusker_fx.ts) and the telegraph draw (sanctum_fx_core.ts) all key on, so
// the dust lands on the model's own feet and the three braziers land on the
// sim's three soulfire patches.
//
// Model space: yards at the authored size, glTF axes: +Y up, the beast faces
// +Z, its LEFT is +X; the origin is on the ground under the middle of its
// barrel. Clip times are seconds in the shipped clips, which key their first
// frame at 1/24 s (KEY_LEAD): every authored beat of the notes sits KEY_LEAD
// later in the file.
//
// Three-free, DOM-free, deterministic.

import { TUSKER_TUNING } from '../../sim/encounters/gravewyrm_sanctum/ids';

/** The template's sim scale (sim/content/gravewyrm_sanctum.ts sledge_tusker). */
export const TUSKER_SIM_SCALE = 2.8;

/** In-game yards per model yard: the delivery is authored at its final size
 *  (7.76 yd to the dome, three times the 2.6 yd knight). */
export const TUSKER_DRAWN_SCALE = 1;

/** The clips key their first frame one 24 fps frame in. */
export const KEY_LEAD = 1 / 24;

export const TUSKER_MODEL = {
  url: 'models/creatures/sledge_tusker.glb',
  /** The Idle pose's skinned bounds at 0.5 s (what prepareVisual samples),
   *  lowest vertex (-0.02, the hitch bar) to the dome and hump (7.76). */
  idleBoundsHeight: 7.78,
  /** The top of the dome and the hump. */
  headTop: 7.76,
  /** The beast's own reach along its body: the tail tuft behind, the trunk
   *  tip ahead and the tusk tips (with their iron caps) further still. */
  tailBack: 6.35,
  trunkTip: { x: 0.09, y: 1.32, z: 7.17 },
  tuskTip: { x: 1.42, y: 4.95, z: 11.2 },
  /** The half-width of the coat and the flanks. */
  halfWidth: 2.6,
  /** The pads at rest: forefeet and hind feet, |x| out to each side. */
  foreFoot: { x: 1.6, z: 2.3 },
  hindFoot: { x: 1.5, z: -2.45 },
  /** The forehead and its burning sigil (the chamfron), and the collar's
   *  soul lantern under the neck. */
  head: { x: 0, y: 5.82, z: 4.95 },
  lantern: { x: 0, y: 4.6, z: 4.1 },
  /** The hitch ring the sledge's tongue hooks onto, behind the haunches. */
  hitch: { x: 0, y: 2.75, z: -6.15 },
  /** The gaits' reference speeds (the planted pads slide at these) and cycles. */
  walkRef: 1.9,
  walkCycle: 2.2,
  runRef: 5.6,
  runCycle: 1,
  /** Lying dead it rests on its left side, this far to its left. */
  deathRollLeft: 2,
} as const;

/** The clips' beats (seconds in the shipped clips): where the effects fire. */
export const TUSKER_CLIP = {
  /** TuskSweep (2.9 authored, the 1.5 s bar): the wind-up to 1.4, the tusks
   *  cross the front at 1.62 (the cone's hit and the throw), right to left,
   *  the sweep ends at 1.8. */
  sweepWindup: 1.4 + KEY_LEAD,
  sweepCross: 1.62 + KEY_LEAD,
  sweepEnd: 1.8 + KEY_LEAD,
  /** TrampleWindup (the 2 s lane warning): the forefoot paws the ice at 0.55
   *  and 1.05, the trumpet runs 1.3 to 1.8, the head is levelled at 2.0. */
  paws: [0.55 + KEY_LEAD, 1.05 + KEY_LEAD],
  trumpet: 1.3 + KEY_LEAD,
  levelled: 2 + KEY_LEAD,
  /** Charge: a 1 s loop at runRef (head low, tusks levelled). */
  charge: 1 + KEY_LEAD,
  /** Roar (the enrage): the trumpet peaks at 1.0, both forefeet slam at 1.75. */
  roarPeak: 1 + KEY_LEAD,
  roarSlam: 1.75 + KEY_LEAD,
  roar: 2.6 + KEY_LEAD,
  /** Unhitch (the pull): the trace hooks open at 0.9, the hitch bar hits the
   *  ice at 1.35, the clip ends at 2.6. */
  unhitchHooks: 0.9 + KEY_LEAD,
  unhitchBar: 1.35 + KEY_LEAD,
  unhitch: 2.6 + KEY_LEAD,
  /** Death: the knees buckle at 1.0, the body hits the ice at 2.0, the head
   *  at 2.2, at rest from 2.8. */
  deathKnees: 1 + KEY_LEAD,
  deathBody: 2 + KEY_LEAD,
  deathHead: 2.2 + KEY_LEAD,
} as const;

/** The sledge prop (models/creatures/sledge_tusker_sledge.glb): its origin on
 *  the ground at the middle of its bed, facing the beast's way. */
export const SLEDGE_MODEL = {
  url: 'models/creatures/sledge_tusker_sledge.glb',
  /** Hitched, its origin hangs this far behind the beast's (the tongue's ring
   *  then meets the hitch ring). */
  behind: 10.5,
  /** The bed's footprint: runners |x| 1.68, z -3 to 4.39; the stacked
   *  braziers stand 3 yd tall. */
  halfWidth: 1.68,
  back: 3,
  front: 4.39,
  top: 3,
  /** The three bowls at rest (sledge space: x its left, z forward) and the
   *  height of their fires. */
  bowls: [
    { x: 0, z: 1.3 },
    { x: -0.75, z: -0.6 },
    { x: 0.75, z: -1.5 },
  ],
  fireY: 1.7,
  /** The Haul loop is in step with the beast's Walk (2.2 s). */
  haulCycle: 2.2,
} as const;

/** Yards from the sledge's origin forward to the tongue's ring. */
export function sledgeTongue(): number {
  return SLEDGE_MODEL.behind + TUSKER_MODEL.hitch.z;
}

/** The Tip clip's beats: the lurch at 0.25, over by 1.0, the three bowls land
 *  at 1.05, 1.15 and 1.25 and stay burning where they fell. */
export const SLEDGE_TIP = {
  lurch: 0.25 + KEY_LEAD,
  over: 1 + KEY_LEAD,
  bowlsLand: [1.05 + KEY_LEAD, 1.15 + KEY_LEAD, 1.25 + KEY_LEAD],
  length: 2.6 + KEY_LEAD,
  /** Where the bowls come to rest, sledge space (x its left, z forward). */
  bowlRest: [
    { x: 5.2, z: 2.4 },
    { x: 6, z: -0.6 },
    { x: 4.8, z: -3.2 },
  ],
} as const;

/** The def height (pivot to the Idle bounds' top at sim scale 1) that draws
 *  the model at TUSKER_DRAWN_SCALE. */
export function tuskerLookHeight(): number {
  return (TUSKER_MODEL.idleBoundsHeight * TUSKER_DRAWN_SCALE) / TUSKER_SIM_SCALE;
}

/** In-game yards per model yard for a Tusker drawn at sim `scale`. */
export function tuskerModelScale(scale: number): number {
  return (TUSKER_DRAWN_SCALE * scale) / TUSKER_SIM_SCALE;
}

/** The rate a bar-locked clip plays at so its contact beat lands on the bar's
 *  end (VisualDef.castClipSync holds the clip to the bar at this rate). */
export function barLockedRate(beat: number, bar: number): number {
  return bar > 0 ? beat / bar : 1;
}

/** The Tusk Sweep's rate: the tusks cross the cone on the 1.5 s bar's end. */
export function sweepClipRate(): number {
  return barLockedRate(TUSKER_CLIP.sweepCross, TUSKER_TUNING.sweepCast);
}

/** The Trample warning's rate: the head is levelled on the 2 s bar's end. */
export function trampleClipRate(): number {
  return barLockedRate(TUSKER_CLIP.levelled, TUSKER_TUNING.trampleCast);
}

/** The Charge's rate: one stride cycle across the 0.8 s run down the lane. */
export function chargeClipRate(): number {
  return barLockedRate(TUSKER_CLIP.charge, TUSKER_TUNING.trampleRun);
}

/** A model-space point on the ground (x its left, z forward) to the world,
 *  for a body at `pos` facing `facing` drawn `k` yards per model yard. Writes
 *  `out`. Forward is (sin f, cos f); the model's +x (its left) is
 *  (cos f, -sin f). */
export function modelToWorld(
  pos: { x: number; z: number },
  facing: number,
  k: number,
  mx: number,
  mz: number,
  out: { x: number; z: number },
): { x: number; z: number } {
  const s = Math.sin(facing);
  const c = Math.cos(facing);
  out.x = pos.x + (mz * s + mx * c) * k;
  out.z = pos.z + (mz * c - mx * s) * k;
  return out;
}

/** A world point to model space (the inverse of modelToWorld). Writes `out`. */
export function worldToModel(
  pos: { x: number; z: number },
  facing: number,
  k: number,
  wx: number,
  wz: number,
  out: { x: number; z: number },
): { x: number; z: number } {
  const s = Math.sin(facing);
  const c = Math.cos(facing);
  const dx = (wx - pos.x) / k;
  const dz = (wz - pos.z) / k;
  out.x = dx * c - dz * s;
  out.z = dx * s + dz * c;
  return out;
}

// ---- footfalls ---------------------------------------------------------------

export type TuskerFoot = 'leftHind' | 'leftFore' | 'rightHind' | 'rightFore';

/** A pad's resting point in model space. */
export function tuskerFootPoint(foot: TuskerFoot): { x: number; z: number } {
  const fore = foot === 'leftFore' || foot === 'rightFore';
  const left = foot === 'leftFore' || foot === 'leftHind';
  const p = fore ? TUSKER_MODEL.foreFoot : TUSKER_MODEL.hindFoot;
  return { x: left ? p.x : -p.x, z: p.z };
}

/** The gaits' touchdowns as a share of the cycle (Walk: the hauling walk, a
 *  lateral sequence; Run and Charge: the loaded trot). */
export const TUSKER_FOOTFALLS: Readonly<
  Record<'walk' | 'run', readonly { foot: TuskerFoot; phase: number }[]>
> = {
  walk: [
    { foot: 'leftHind', phase: 0 },
    { foot: 'leftFore', phase: 0.55 / TUSKER_MODEL.walkCycle },
    { foot: 'rightHind', phase: 1.1 / TUSKER_MODEL.walkCycle },
    { foot: 'rightFore', phase: 1.65 / TUSKER_MODEL.walkCycle },
  ],
  run: [
    { foot: 'leftHind', phase: 0 },
    { foot: 'rightFore', phase: 0.1 / TUSKER_MODEL.runCycle },
    { foot: 'rightHind', phase: 0.5 / TUSKER_MODEL.runCycle },
    { foot: 'leftFore', phase: 0.6 / TUSKER_MODEL.runCycle },
  ],
};

/** The yards one gait cycle carries the Tusker at sim `scale` (its planted
 *  pads slide at the reference speed, so a cycle is ref x cycle seconds). */
export function tuskerStride(gait: 'walk' | 'run', scale: number): number {
  const k = tuskerModelScale(scale);
  return gait === 'walk'
    ? TUSKER_MODEL.walkRef * TUSKER_MODEL.walkCycle * k
    : TUSKER_MODEL.runRef * TUSKER_MODEL.runCycle * k;
}

/** The gait the look plays at a drawn `speed` (yards a second, sim scale
 *  `scale`): the walk until it is clearly quicker than the hauling walk. */
export function tuskerGait(speed: number, scale: number): 'walk' | 'run' {
  return speed > TUSKER_MODEL.walkRef * tuskerModelScale(scale) * 1.9 ? 'run' : 'walk';
}

/** The touchdowns crossed when the cycle phase moves from `from` to `to`
 *  (both cycle counts, `to` >= `from`; whole cycles wrap). Writes the feet
 *  into `out` and returns how many. */
export function tuskerFootfallsBetween(
  gait: 'walk' | 'run',
  from: number,
  to: number,
  out: TuskerFoot[],
): number {
  out.length = 0;
  if (!(to > from)) return 0;
  const falls = TUSKER_FOOTFALLS[gait];
  // At most a cycle's worth per step (a long hitch would only flood the ice).
  const start = Math.max(from, to - 1);
  for (let c = Math.floor(start); c <= Math.floor(to); c++) {
    for (const f of falls) {
      const at = c + f.phase;
      if (at > start && at <= to) out.push(f.foot);
    }
  }
  return out.length;
}

// ---- the sledge ----------------------------------------------------------------

/** Where the sledge stands on the ground, and which way it faces. */
export interface SledgePose {
  x: number;
  z: number;
  yaw: number;
}

/** The furthest the tongue swings off the beast's line (radians): past it the
 *  sledge is dragged round with the beast instead of folding under it. */
export const SLEDGE_MAX_SWING = (50 * Math.PI) / 180;

/** How fast the sledge's bed settles back in line behind the beast (per
 *  second) when the drag alone would leave it askew (a beast turning on the
 *  spot, or shoved sideways). */
export const SLEDGE_RELAX = 0.9;

/** The hitch ring on the ground under a beast at `pos` facing `facing`
 *  (sim scale `scale`). Writes `out`. */
export function hitchPoint(
  pos: { x: number; z: number },
  facing: number,
  scale: number,
  out: { x: number; z: number },
): { x: number; z: number } {
  return modelToWorld(
    pos,
    facing,
    tuskerModelScale(scale),
    TUSKER_MODEL.hitch.x,
    TUSKER_MODEL.hitch.z,
    out,
  );
}

/** The sledge hung rigidly behind a beast (the first frame, or a re-hitch). */
export function rigidSledge(
  pos: { x: number; z: number },
  facing: number,
  scale: number,
  out: SledgePose,
): SledgePose {
  const k = tuskerModelScale(scale);
  out.x = pos.x - Math.sin(facing) * SLEDGE_MODEL.behind * k;
  out.z = pos.z - Math.cos(facing) * SLEDGE_MODEL.behind * k;
  out.yaw = facing;
  return out;
}

function wrapAngle(a: number): number {
  let r = a % (Math.PI * 2);
  if (r > Math.PI) r -= Math.PI * 2;
  if (r < -Math.PI) r += Math.PI * 2;
  return r;
}

/**
 * Drag the sledge after its beast like a trailer: its tongue's ring stays on
 * the hitch, and its bed swings round behind it along the path it was pulled
 * (a turn at the end of the road sweeps it round, never snaps it), settling
 * back in line at SLEDGE_RELAX over `dt` seconds. The tongue never folds more
 * than SLEDGE_MAX_SWING off the beast's line. Writes `pose`.
 */
export function trailSledge(
  pose: SledgePose,
  pos: { x: number; z: number },
  facing: number,
  scale: number,
  dt = 0,
): SledgePose {
  const k = tuskerModelScale(scale);
  const tongue = sledgeTongue() * k;
  const h = hitchPoint(pos, facing, scale, { x: 0, z: 0 });
  let dx = h.x - pose.x;
  let dz = h.z - pose.z;
  let yaw = Math.hypot(dx, dz) > 1e-6 ? Math.atan2(dx, dz) : facing;
  let off = wrapAngle(yaw - facing);
  off *= Math.max(0, 1 - SLEDGE_RELAX * Math.max(0, dt));
  if (Math.abs(off) > SLEDGE_MAX_SWING) off = Math.sign(off) * SLEDGE_MAX_SWING;
  yaw = facing + off;
  dx = Math.sin(yaw);
  dz = Math.cos(yaw);
  pose.x = h.x - dx * tongue;
  pose.z = h.z - dz * tongue;
  pose.yaw = yaw;
  return pose;
}

/** The sledge's state: hauled behind the beast, left where it was unhitched,
 *  or tipped over (its braziers spilled on the road). */
export type SledgeState = 'hitched' | 'dropped' | 'tipped';

/** What the sledge does next, from the Tusker's mirrored state: unhitched on
 *  its first engaged frame, tipped by the spill (or a view that joins a fight
 *  already past half health, or its death), hitched again once a reset pull
 *  has it out of combat at full health. */
export function nextSledgeState(
  state: SledgeState,
  t: { dead: boolean; inCombat: boolean; hpShare: number },
  spilled: boolean,
): SledgeState {
  if (!t.dead && !t.inCombat && t.hpShare >= 0.999) return 'hitched';
  if (state === 'tipped') return 'tipped';
  if (spilled) return 'tipped';
  if (t.dead) return state === 'hitched' ? 'hitched' : 'tipped';
  if (t.inCombat) {
    if (t.hpShare <= TUSKER_TUNING.spillAtHpPct) return 'tipped';
    return 'dropped';
  }
  return state;
}

/** A sledge-space point to the world for a sledge standing at `pose`. */
export function sledgeToWorld(
  pose: SledgePose,
  sx: number,
  sz: number,
  out: { x: number; z: number },
): { x: number; z: number } {
  return modelToWorld(pose, pose.yaw, 1, sx, sz, out);
}

/**
 * The offsets (sledge space) that carry each tipped bowl from where the Tip
 * clip throws it onto the soulfire patch the sim lit for it: the sim lays the
 * patches from the Tusker's own frame at the pull (and halves a spot that
 * falls off the road), the sledge stands where it was really dragged, so each
 * bowl is matched to its nearest free patch within `reach` yards (wide: the
 * sim frame at the pull can stand well off the hauled sledge). A bowl with no
 * patch in reach keeps the clip's spot (offset zero).
 */
export function bowlOffsets(
  pose: SledgePose,
  patches: readonly { x: number; z: number }[],
  reach = 30,
): { x: number; z: number }[] {
  const taken = new Set<number>();
  const at = { x: 0, z: 0 };
  const local = { x: 0, z: 0 };
  return SLEDGE_TIP.bowlRest.map((rest) => {
    sledgeToWorld(pose, rest.x, rest.z, at);
    let best = -1;
    let bestD = reach;
    patches.forEach((p, i) => {
      if (taken.has(i)) return;
      const d = Math.hypot(p.x - at.x, p.z - at.z);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    if (best < 0) return { x: 0, z: 0 };
    taken.add(best);
    worldToModel(pose, pose.yaw, 1, patches[best].x, patches[best].z, local);
    return { x: local.x - rest.x, z: local.z - rest.z };
  });
}

/** How far into its fall a thrown bowl is (0 until the Tip throws it, 1 once
 *  it has landed): the offset onto its patch eases in over the flight. */
export function bowlFlight(tipTime: number, bowl: number): number {
  const land = SLEDGE_TIP.bowlsLand[bowl] ?? SLEDGE_TIP.over;
  const start = SLEDGE_TIP.lurch;
  if (tipTime <= start) return 0;
  if (tipTime >= land) return 1;
  const t = (tipTime - start) / (land - start);
  return t * t * (3 - 2 * t);
}

/** The Haul loop's rate at a drawn speed (in step with the beast's Walk);
 *  0 below a crawl (the sledge rests on its Idle). */
export function haulRate(speed: number, scale: number): number {
  const ref = TUSKER_MODEL.walkRef * tuskerModelScale(scale);
  if (speed < 0.25) return 0;
  return Math.min(2.2, Math.max(0.4, speed / ref));
}
