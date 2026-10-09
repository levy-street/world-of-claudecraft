// Pure plan for the Sunken Bastion's boss visuals (bastion_boss_fx.ts): which
// kit piece stands for a buttress state, where a claim's encounter pieces sit
// in its slot, how far Olen's charge lane runs, how the hook chain sags, how
// high the Drowning Hymn floods the crown, and what the beam reveals. Every
// answer derives from the sim's own encounter constants and pure helpers, so
// the lane a player steps out of is the lane the sim tests and the figure the
// beam lights is the figure the sim calls real.
//
// Three-free, DOM-free, deterministic.

import {
  BASTION_BUTTRESSES,
  BEACON_CROWN,
  BUTTRESS_HALF,
  FOGBEACON,
  SUNKEN_BASTION_FIELD,
} from '../../sim/content/sunken_bastion_layout';
import { DUNGEONS, instanceOrigin, instanceSlotForZ } from '../../sim/data';
import {
  BUTTRESS_TEMPLATES,
  buttressStateOf,
  FOG_SHADE_ID,
  inBeam,
  OLEN_TUNING,
  oathLaneEnd,
  VAEL_BEACON_LIT,
  VAEL_ID,
  VAEL_SHADE_HOLLOW,
  VAEL_TUNING,
} from '../../sim/encounters/sunken_bastion/ids';

const DUNGEON_ID = 'sunken_bastion';

/** The instance origin of the Bastion slot a world point stands in. */
export function bastionSlotOrigin(x: number, z: number): { x: number; z: number; slot: number } {
  const def = DUNGEONS[DUNGEON_ID];
  const slot = instanceSlotForZ(z);
  const o = instanceOrigin(def.index, slot);
  return { x: o.x, z: o.z, slot };
}

/** The kit piece that draws a buttress in `templateId`'s state, or null. */
export function buttressPiece(templateId: string): string | null {
  const s = buttressStateOf(templateId);
  if (s === 'intact') return 'Kit_Buttress';
  if (s === 'cracked') return 'Kit_ButtressCracked';
  if (s === 'broken') return 'Kit_ButtressBroken';
  return null;
}

/** Every buttress piece name, for prebuilding their meshes. */
export const BUTTRESS_PIECES: readonly string[] = [
  'Kit_Buttress',
  'Kit_ButtressCracked',
  'Kit_ButtressBroken',
];

/** Is a buttress state change a crash worth a burst? (a step toward broken). */
export function buttressCrash(prev: string, next: string): boolean {
  const order = [BUTTRESS_TEMPLATES.intact, BUTTRESS_TEMPLATES.cracked, BUTTRESS_TEMPLATES.broken];
  const a = order.indexOf(prev as (typeof order)[number]);
  const b = order.indexOf(next as (typeof order)[number]);
  return a >= 0 && b > a;
}

/** The buttress an object at instance-local (lx, lz) stands for: its id and
 *  the yaw its outer face turns to, or null when none sits within a yard. */
export function buttressAt(lx: number, lz: number): { id: string; yaw: number } | null {
  for (const b of BASTION_BUTTRESSES) {
    if (Math.hypot(b.x - lx, b.z - lz) < 1) return { id: b.id, yaw: b.yaw };
  }
  return null;
}

/** The ids of the buttresses still standing (intact or cracked) among a slot's
 *  buttress objects, given their local positions and templates. */
export function standingButtressIds(
  objects: readonly { lx: number; lz: number; templateId: string }[],
): Set<string> {
  const out = new Set<string>();
  for (const o of objects) {
    const state = buttressStateOf(o.templateId);
    if (state !== 'intact' && state !== 'cracked') continue;
    const at = buttressAt(o.lx, o.lz);
    if (at) out.add(at.id);
  }
  return out;
}

/** The live length of Olen's charge lane from his local spot along `yaw`. */
export function oathLaneLength(
  lx: number,
  lz: number,
  yaw: number,
  standing: ReadonlySet<string>,
): number {
  return oathLaneEnd(lx, lz, yaw, standing).length;
}

/** The charge lane's full width (yards), for the telegraph and the wake. */
export const OATH_LANE_HALF = OLEN_TUNING.laneHalf;

/** Where Breached's dizzy stars circle, in yards over Olen's feet before his
 *  scale: round the crest of his slumped head in the Stunned clip (his sculpted
 *  body is drawn 7.4 tall, the reeling helm about 0.85 of it). */
export const OLEN_STARS_UP = 6.3;
/** How wide the stars circle round his helm, before his scale. */
export const OLEN_STARS_RADIUS = 1.4;

/** Where a crash lands: the point on the lane's end facing the buttress. */
export function crashPoint(
  lx: number,
  lz: number,
  yaw: number,
  length: number,
): { x: number; z: number } {
  return { x: lx + Math.sin(yaw) * length, z: lz + Math.cos(yaw) * length };
}

/** Half the buttress footprint, for sizing the crash burst. */
export const BUTTRESS_BURST_RADIUS = BUTTRESS_HALF * 2.2;

/**
 * Points of a hanging chain from A to B: a parabola sagging `sag` yards at its
 * middle, written as x, y, z triples into `out` (n points, n >= 2).
 */
export function chainPoints(
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  sag: number,
  n: number,
  out: Float32Array,
): void {
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    out[i * 3] = ax + (bx - ax) * t;
    out[i * 3 + 1] = ay + (by - ay) * t - sag * 4 * t * (1 - t);
    out[i * 3 + 2] = az + (bz - az) * t;
  }
}

/** How much a hook chain sags: taut when the player is far, slack when near. */
export function chainSag(span: number): number {
  return Math.max(0.3, 3.2 - span * 0.12);
}

/** 0 when the hook lands, 1 at the keelhaul: the chain heats as it nears. */
export function hookHeat(remaining: number, duration: number): number {
  if (duration <= 0) return 1;
  return Math.min(1, Math.max(0, 1 - remaining / duration));
}

/** The Drowning Hymn's flood on the crown: 0 dry to 1 at the hymn's end,
 *  eased so the water climbs faster as the drowning pulse ramps. */
export function hymnFlood(castRemaining: number, castTotal: number): number {
  if (castTotal <= 0) return 0;
  const t = Math.min(1, Math.max(0, 1 - castRemaining / castTotal));
  return t * t * (3 - 2 * t) * 0.6 + t * 0.4;
}

/** The crown the flood fills. */
export const CROWN = BEACON_CROWN;

/** The crown's parapet (bastion_plan_core.ts edge dressing, Kit_Parapet in
 *  docs/design/dungeon-rework/kit/build_sunken_bastion_kit.py): a yard-thick
 *  wall flush with the crown's lip, so its inner face stands a yard inside it,
 *  and its embrasure sills 1.08 over the flags (the wall body to 1.0 under a
 *  0.1 coping). */
export const CROWN_PARAPET_INNER = BEACON_CROWN.r - 1;
export const CROWN_SILL_HEIGHT = 1.08;

/** Where the flood's sheet starts over the flags (clear of them, never a
 *  skin fighting the floor for depth), and how far it rises at full hymn:
 *  shin-deep, well under the sills, so it never stands in an embrasure. */
export const HYMN_FLOOD_LIFT = 0.06;
export const HYMN_FLOOD_DEPTH = 0.72;

/** The sheet's ring: from under the Fogbeacon's foot to just inside the
 *  parapet's yard-thick body (its rim always tucked under the wall). */
export const CROWN_FLOOD_INNER = FOGBEACON.r - 0.5;
export const CROWN_FLOOD_OUTER = CROWN_PARAPET_INNER + 0.35;

/** The flood's depth over its lift at `level` (0 dry to 1 full). Scalars, not
 *  an object: the painter reads them every frame in every zone. */
export function crownFloodDepth(level: number): number {
  return Math.min(1, Math.max(0, level)) * HYMN_FLOOD_DEPTH;
}

/** The flood's opacity at `level`: a wet sheen first, murky sea by a third. */
export function crownFloodAlpha(level: number): number {
  return Math.min(1, Math.max(0, level) * 3);
}

/** The gap in the parapet where the crown stair comes up (the layout's
 *  `crown_stair` path crossing the crown's edge): its yaw from the crown's
 *  centre (sim convention, atan2(dx, dz)) and its half angle at the rim. */
export const CROWN_STAIR_MOUTH: { yaw: number; half: number } = stairMouth();

function stairMouth(): { yaw: number; half: number } {
  const path = SUNKEN_BASTION_FIELD.surfaces.find((s) => s.id === 'crown_stair');
  if (path?.kind !== 'path') return { yaw: 0, half: 0 };
  const r = BEACON_CROWN.r;
  const pts = path.points.map(([x, z]) => ({ x: x - BEACON_CROWN.x, z: z - BEACON_CROWN.z }));
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const ra = Math.hypot(a.x, a.z);
    const rb = Math.hypot(b.x, b.z);
    if (ra < r === rb < r) continue;
    // Where the segment crosses the rim (bisection: the segment is short).
    let lo = 0;
    let hi = 1;
    for (let k = 0; k < 40; k++) {
      const t = (lo + hi) / 2;
      const inside = Math.hypot(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t) < r;
      if (inside === ra < r) lo = t;
      else hi = t;
    }
    const x = a.x + (b.x - a.x) * lo;
    const z = a.z + (b.z - a.z) * lo;
    return { yaw: Math.atan2(x, z), half: Math.asin(Math.min(1, path.halfWidth / r)) };
  }
  return { yaw: 0, half: 0 };
}

/** The lip the flood keeps at the stair mouth: it shallows to the flags over
 *  these last yards before the rim, spilling off the stair top. */
export const CROWN_FLOOD_LIP = 4;

function smooth01(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** The share of the flood's depth kept at crown-local (lx, lz): 1 over the
 *  whole roof and at the walled rim, easing to 0 at the stair mouth's edge (no
 *  wall holds the water there, so the sheet never ends in a cliff of water). */
export function crownFloodKeep(lx: number, lz: number): number {
  const m = CROWN_STAIR_MOUTH;
  if (m.half <= 0) return 1;
  let d = Math.atan2(lx, lz) - m.yaw;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  const across = 1 - smooth01(m.half * 0.75, m.half + 0.1, Math.abs(d));
  const radial = smooth01(
    CROWN_FLOOD_OUTER - CROWN_FLOOD_LIP,
    CROWN_FLOOD_OUTER,
    Math.hypot(lx, lz),
  );
  const keep = 1 - across * radial;
  return keep > 1 - 1e-9 ? 1 : keep < 1e-9 ? 0 : keep;
}

/** The beam's half angle and the radius it sweeps the roof out to. */
export const BEAM_HALF = VAEL_TUNING.beamHalf;
export const BEAM_PERIOD = VAEL_TUNING.beamPeriod;

/** Advance a beam yaw sampled `since` seconds ago at the sim's sweep rate. */
export function predictBeamYaw(sample: number, since: number): number {
  const t = sample + (Math.max(0, since) / BEAM_PERIOD) * Math.PI * 2;
  return ((t % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
}

export type BeamReveal = 'real' | 'shade' | null;

/** What the beam at `yaw` shows of a figure at instance-local (lx, lz):
 *  the real Vael (a hard shadow and a gold flare), a fog shade (light pours
 *  through it), or nothing when the figure is not in the beam. */
export function beamReveal(templateId: string, yaw: number, lx: number, lz: number): BeamReveal {
  if (templateId !== VAEL_ID && templateId !== FOG_SHADE_ID) return null;
  if (!inBeam(yaw, lx, lz)) return null;
  return templateId === VAEL_ID ? 'real' : 'shade';
}

/** What the SIM says the beam left on a figure: the real Vael wears the
 *  Beacon-Lit tell, a shade the Hollow Shade tell, each a breath after the beam
 *  moves on (vael.ts). Every client reads the same truth the HUD's crown alert
 *  names, so the reveal no longer hangs on a locally predicted beam. */
export function auraReveal(
  templateId: string,
  auras: readonly { id: string }[] | undefined,
): BeamReveal {
  if (!auras) return null;
  if (templateId === VAEL_ID) {
    for (const a of auras) if (a.id === VAEL_BEACON_LIT) return 'real';
    return null;
  }
  if (templateId === FOG_SHADE_ID) {
    for (const a of auras) if (a.id === VAEL_SHADE_HOLLOW) return 'shade';
  }
  return null;
}

/** How much hotter and fuller the Fogbeacon's beam burns through the Fog Veil
 *  (bastion_beacon.ts): its brightness gain at full boost. */
export const VEIL_BEAM_GAIN = 2.6;

/** The beam's veil boost stepped one frame: it flares up fast as the veil
 *  takes the lamp and settles back slowly once it lets go. */
export function beaconVeilBoost(prev: number, veiled: boolean, dt: number): number {
  if (veiled) return Math.min(1, prev + dt * 3);
  return Math.max(0, prev - dt * 1.2);
}

/** The lit sector on the roof under the beam during the veil: its opacity
 *  pulse (bright enough to read from anywhere on the crown). */
export function beamPoolOpacity(clock: number): number {
  return 0.6 + 0.12 * Math.sin(clock * 9);
}

/** The gold light pillar over the real Vael while the beam has him: as tall
 *  as the lantern room's beam falls, as bright as the reveal's glow. */
export const REVEAL_PILLAR_HEIGHT = 16;
export const REVEAL_PILLAR_RADIUS = 1.6;
/** The gold ring on the flags under him: it breathes out to this radius. */
export const REVEAL_RING_RADIUS = 3.4;
export function revealRingRadius(k: number, clock: number): number {
  return (
    REVEAL_RING_RADIUS *
    (0.75 + 0.25 * Math.max(0, Math.min(1, k))) *
    (1 + 0.06 * Math.sin(clock * 6))
  );
}

/** The reveal's glow on a veiled figure, stepped one frame: it LATCHES full
 *  while the figure wears the sim's tell (the beam's pass plus the sim's 1.5 s
 *  linger, auraReveal) and then fades out in about 0.6 s. The sim holds the
 *  tell now; a long render afterglow on top kept the real one lit through
 *  most of every 4 s sweep, so he no longer had to be found. */
export const REVEAL_FADE_PER_SEC = 1.6;
export function revealGlow(prev: number, lit: boolean, dt: number): number {
  if (lit) return 1;
  return Math.max(0, prev - REVEAL_FADE_PER_SEC * dt);
}

/** Vael's soul lantern at his hip (reaper.py REST['Lantern'], the bulb's
 *  middle), in model units over his feet: the real Vael's flare burns HERE,
 *  on the lantern, not on his chest. */
export const VAEL_LANTERN = { side: 0.66, up: 2.6, fwd: 0.22 } as const;

/** One Vael (or Fogbeacon lamp) candidate in view: its claim slot, whether
 *  his Fog Veil is up, and how far it stands from the local player. */
export interface VeilCandidate {
  id: number;
  slot: number;
  veiled?: boolean;
  dist?: number;
}

/**
 * Which claim's Vael and lamp the beam effects follow when several Bastion
 * claims are in the world (offline, every claim's bodies exist at once): the
 * one whose veil is up, else the nearest Vael; the lamp is his claim's. It
 * used to follow whichever came LAST in the roster, so the beam and the real
 * one's flare tracked an idle Vael in another claim and never lit.
 */
export function pickVeilClaim(
  vaels: readonly VeilCandidate[],
  lamps: readonly VeilCandidate[],
): { vaelId: number; lampId: number } {
  let best: VeilCandidate | null = null;
  for (const v of vaels) {
    if (!best) {
      best = v;
      continue;
    }
    if (!!v.veiled !== !!best.veiled) {
      if (v.veiled) best = v;
      continue;
    }
    if ((v.dist ?? Infinity) < (best.dist ?? Infinity)) best = v;
  }
  const lamp = best ? lamps.find((l) => l.slot === best.slot) : lamps[0];
  return { vaelId: best?.id ?? -1, lampId: lamp?.id ?? -1 };
}
