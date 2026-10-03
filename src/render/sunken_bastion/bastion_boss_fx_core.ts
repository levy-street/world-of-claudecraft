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
} from '../../sim/content/sunken_bastion_layout';
import { DUNGEONS, instanceOrigin, instanceSlotForZ } from '../../sim/data';
import {
  BUTTRESS_TEMPLATES,
  buttressStateOf,
  FOG_SHADE_ID,
  inBeam,
  OLEN_TUNING,
  oathLaneEnd,
  VAEL_ID,
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

/** The flood's rise (yards) over the crown floor at full hymn. */
export const HYMN_FLOOD_DEPTH = 1.1;

/** The crown the flood fills. */
export const CROWN = BEACON_CROWN;

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

/** The reveal's glow on a veiled figure, stepped one frame: it LATCHES full
 *  the moment the beam catches the figure and then fades slowly, so the tell
 *  outlives the beam's brief pass (the beam crosses a figure in about a
 *  quarter second of its sweep; the glow holds about two seconds). */
export const REVEAL_FADE_PER_SEC = 0.5;
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
