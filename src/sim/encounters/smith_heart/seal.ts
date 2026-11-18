// The Smith's Heart's gating state (docs/design/raid/smith_heart.md, "Gating"):
// which veins burn on the heart seal, whether its crystal is charged and
// whether the crystal has burst into the portal, carried on the claim's seal
// markers; the veins and the charge are derived every tick from the claim's
// own roster, never a timer.
//
//   the Hammer ALWAYS FIRST: the Hammer Council's fall (both: the Guardian
//     and the Seam Singer) splits the Slab (the gate
//     `the_slab`, bosses = the council); nothing past it is reachable before;
//   the other three in ANY order: no gate orders the Breath, the Quench and
//     the Heat against each other (each arena's mouth waits only on its own
//     vein's three packs);
//   the seal: each guardian's death lights its vein's colour on the seal;
//   the charge (READY): with all four lit AND the Ring clear, the heart seal
//     crystal is charged (seal_crystal.ts);
//   the portal: the first tick a living player stands in the middle circle
//     (the dais) once the crystal is charged, it BURSTS (seal_crystal.ts
//     sealCrystalTriggered; `/dev heart portal` forces it, seal_burst.ts) and
//     the portal to the Heart stands open (portal.ts walks the raid through).
//     It is sticky, a bit the markers keep rather than derive, and set only by
//     a burst: a seal charged while nobody comes down to the dais stays shut;
//   the exit (2026-11-17): the Masterless Strength fallen, the Heart's exit
//     portal opens and walks the raid back to the entrance (portal.ts);
//   the arrival (phase 2J): the first tick a living player stands in the
//     Heart, the heart wakes (the renderer's arrival scene: the heart crystal
//     rises and binds the room's rocks into the Masterless Strength's body).
//     Presentation only: no mob, no damage, no gate reads it. It is the other
//     bit the markers keep rather than derive (a raid that walks back out
//     leaves the heart awake), so it lives in the markers' own value and a
//     fresh claim (markers at `smith_heart_seal_0`) starts asleep.
//
// Dead instance mobs stay dead for the claim's life, so a lit vein stays lit,
// a burst crystal stays burst (an opened portal stays open for the lockout),
// and a fresh claim (a reset) starts dark and shut. The collision half is the
// shared gate engine (instances/dungeon_gates.ts); THIS module owns the seal's
// colours and the portal's state, carried in the template id of the run's seal
// markers (content/smith_heart.ts SMITH_HEART_SEAL_MARKERS, spread so every
// walkable point stands within interest range of one) so every client mirrors
// the seal and the portal with no wire change, and the raid's lines as each
// vein lights.
//
// Draws NO rng; reads the roster through the gate engine's placed-boss read.

import {
  SMITH_HEART_COUNCIL,
  SMITH_HEART_DUNGEON,
  SMITH_HEART_FINAL_BOSS,
  SMITH_HEART_GUARDIANS,
  SMITH_HEART_PACKS,
  SMITH_HEART_SEAL_PREFIX,
} from '../../content/smith_heart';
import {
  inSmithHeartRoom,
  SMITH_HEART_VEINS,
  type SmithHeartVein,
} from '../../content/smith_heart_layout';
import { DUNGEONS, instanceOrigin } from '../../data';
import { dungeonPacksDead, dungeonPlacedBossDead } from '../../instances/dungeon_gates';
import { instanceHalfWidthOf } from '../../instances/instance_footprint';
import type { InstanceSlot } from '../../sim';
import type { SimContext } from '../../sim_context';
import { tickBreathGuardian } from './breath';
import { noteSmithHeartKills } from './checkpoint_order';
import { tickHammerCouncil } from './council';
import { finalBoss, tickFinalBoss } from './final';
import { beginArrivalVoice, stepArrivalVoice } from './final_voice';
import { tickHeatGuardian } from './heat';
import { tickSmithHeartPortal } from './portal';
import { tickQuenchGuardian } from './quench';
import {
  holdSealMarkerInert,
  sealCrystalOf,
  sealCrystalTriggered,
  tickSealCrystal,
} from './seal_crystal';

/** Each vein's bit in the seal mask (the template id's number). */
export const SMITH_HEART_VEIN_BITS: Readonly<Record<SmithHeartVein, number>> = {
  hammer: 1,
  breath: 2,
  quench: 4,
  heat: 8,
};
/** Every vein lit. */
export const SMITH_HEART_SEAL_FULL = 15;
/** The portal's bit: the heart seal crystal has burst and the portal to the
 *  Heart stands open. STICKY (kept by the markers, never derived): set only by
 *  a burst (a living player stepping into the middle circle while the crystal
 *  is charged, or `/dev heart portal`), so a seal charged while nobody comes
 *  down to the dais keeps the portal shut. */
export const SMITH_HEART_PORTAL_BIT = 16;
/** The arrival's bit (phase 2J): a living player has stood in the Heart.
 *  Kept by the markers for the claim's life once set. */
export const SMITH_HEART_AWAKE_BIT = 32;
/** The exit's bit (the team's review of 2026-11-17): the Masterless
 *  Strength has fallen, so the Heart's exit portal stands open (portal.ts).
 *  Derived every tick like the veins. */
export const SMITH_HEART_EXIT_BIT = 64;
/** The charge's bit: all four veins are lit AND the Ring is clear, so the heart
 *  seal crystal is charged and a player in the middle circle bursts it.
 *  Derived every tick like the veins, so it stays set after the burst. */
export const SMITH_HEART_READY_BIT = 128;
/** Every bit a marker can carry. */
const MARKER_BITS =
  SMITH_HEART_SEAL_FULL |
  SMITH_HEART_PORTAL_BIT |
  SMITH_HEART_AWAKE_BIT |
  SMITH_HEART_EXIT_BIT |
  SMITH_HEART_READY_BIT;

/** The seal marker template id for a marker value (the lit veins plus the
 *  charge, portal, arrival and exit bits). */
export function smithHeartSealTemplate(mask: number): string {
  return `${SMITH_HEART_SEAL_PREFIX}${mask & MARKER_BITS}`;
}

/** The value a seal marker's template id carries (the lit-vein mask plus the
 *  charge, portal, arrival and exit bits), or null. Pure (the renderer reads
 *  the mirrored entity through it). */
export function smithHeartSealMaskOf(templateId: string): number | null {
  if (!templateId.startsWith(SMITH_HEART_SEAL_PREFIX)) return null;
  const n = Number(templateId.slice(SMITH_HEART_SEAL_PREFIX.length));
  return Number.isInteger(n) && n >= 0 && n <= MARKER_BITS ? n : null;
}

/** Is `vein` lit in `mask`? Pure. */
export function smithHeartVeinLit(mask: number, vein: SmithHeartVein): boolean {
  return (mask & SMITH_HEART_VEIN_BITS[vein]) !== 0;
}

/** Does a marker value say the portal is open (the crystal has burst)? Pure. */
export function smithHeartPortalBitSet(mask: number): boolean {
  return (mask & SMITH_HEART_PORTAL_BIT) !== 0;
}

/** Does a marker value say the heart seal crystal is charged (all four veins
 *  lit and the Ring clear)? Pure. */
export function smithHeartReadyBitSet(mask: number): boolean {
  return (mask & SMITH_HEART_READY_BIT) !== 0;
}

/** Does a marker value say the heart is awake (the raid has arrived)? Pure. */
export function smithHeartAwakeBitSet(mask: number): boolean {
  return (mask & SMITH_HEART_AWAKE_BIT) !== 0;
}

/** Does a marker value say the Heart's exit portal is open? Pure. */
export function smithHeartExitBitSet(mask: number): boolean {
  return (mask & SMITH_HEART_EXIT_BIT) !== 0;
}

/** How many veins `mask` lights. Pure. */
export function smithHeartLitCount(mask: number): number {
  let n = 0;
  for (const v of SMITH_HEART_VEINS) if (smithHeartVeinLit(mask, v)) n++;
  return n;
}

/** Is a vein's guardian fight won in this claim? The Hammer's is the Hammer
 *  Council's: its vein waits on both (the Guardian and the Seam Singer),
 *  never on the Guardian alone. */
export function smithHeartVeinWon(
  ctx: SimContext,
  inst: InstanceSlot,
  vein: SmithHeartVein,
): boolean {
  if (vein === 'hammer')
    return SMITH_HEART_COUNCIL.every((id) => dungeonPlacedBossDead(ctx, inst, id));
  return dungeonPlacedBossDead(ctx, inst, SMITH_HEART_GUARDIANS[vein]);
}

/** The lit-vein mask the claim has earned right now: one bit per won vein. */
export function smithHeartEarnedMask(ctx: SimContext, inst: InstanceSlot): number {
  let mask = 0;
  for (const v of SMITH_HEART_VEINS) {
    if (smithHeartVeinWon(ctx, inst, v)) mask |= SMITH_HEART_VEIN_BITS[v];
  }
  return mask;
}

/** Claims whose arrival a dev playtest is replaying (`/dev heart arrival`):
 *  the sim time until which the heart is held asleep, keyed by the claim's
 *  identity (and its exit, so a recycled slot never inherits it). */
const devAsleep = new WeakMap<InstanceSlot, { exitId: number; until: number }>();

/** Seconds a replayed arrival holds the heart asleep: long enough for every
 *  client to see it asleep before it wakes again (a snapshot or two). */
export const SMITH_HEART_ARRIVAL_REPLAY_HOLD = 1.5;

/** Put a live claim's heart back to sleep for a dev playtest (it wakes again
 *  on the first tick past the hold with a living player in the Heart).
 *  Dev-gated by its one caller (sim/dev/smith_heart_dev.ts). */
export function replaySmithHeartArrivalForDev(ctx: SimContext, inst: InstanceSlot): void {
  if (inst.partyKey === null || inst.exitId === null) return;
  devAsleep.set(inst, { exitId: inst.exitId, until: ctx.time + SMITH_HEART_ARRIVAL_REPLAY_HOLD });
}

function devHeldAsleep(ctx: SimContext, inst: InstanceSlot): boolean {
  const h = devAsleep.get(inst);
  if (!h) return false;
  if (h.exitId !== inst.exitId || ctx.time >= h.until) {
    devAsleep.delete(inst);
    return false;
  }
  return true;
}

/** Is a living player standing in this claim's Heart? Walks the players in
 *  place (allocation free). */
export function smithHeartPlayerInHeart(ctx: SimContext, inst: InstanceSlot): boolean {
  const dungeon = DUNGEONS[inst.dungeonId];
  if (!dungeon) return false;
  const o = instanceOrigin(dungeon.index, inst.slot);
  const half = instanceHalfWidthOf(inst.dungeonId);
  for (const meta of ctx.players.values()) {
    const e = ctx.entities.get(meta.entityId);
    if (!e || e.dead) continue;
    const lx = e.pos.x - o.x;
    const lz = e.pos.z - o.z;
    if (Math.abs(lx) >= half || Math.abs(lz) >= 250) continue;
    if (inSmithHeartRoom(lx, lz)) return true;
  }
  return false;
}

/** The whole gating readout of one claim (dev tools, tests, the design doc's
 *  state table). */
export interface SmithHeartProgress {
  /** Lit-vein mask (SMITH_HEART_VEIN_BITS). */
  mask: number;
  /** The Hammer is down: the Slab is split, the Ring and the three veins open. */
  slabOpen: boolean;
  /** All four colours burn on the seal. */
  sealLit: boolean;
  /** The Ring's eight packs are dead. */
  ringClear: boolean;
  /** The heart seal crystal is charged: all four veins lit and the Ring clear
   *  (the markers' READY bit, derived every tick). A player in the middle
   *  circle bursts it. */
  ready: boolean;
  /** The crystal has burst and the portal to the Heart stands open: the
   *  markers' STICKY portal bit, set only by a burst (seal_burst.ts), never by
   *  the veins and the Ring alone. */
  portalOpen: boolean;
}

export function smithHeartProgress(ctx: SimContext, inst: InstanceSlot): SmithHeartProgress {
  const mask = smithHeartEarnedMask(ctx, inst);
  const ringClear = dungeonPacksDead(ctx, inst, SMITH_HEART_PACKS.ring);
  const sealLit = mask === SMITH_HEART_SEAL_FULL;
  const markers = markerMask(ctx, inst);
  return {
    mask,
    slabOpen: smithHeartVeinLit(mask, 'hammer'),
    sealLit,
    ringClear,
    ready: sealLit && ringClear,
    portalOpen: markers !== null && smithHeartPortalBitSet(markers),
  };
}

/** The English line each vein's lighting sends to the raid (re-localized by
 *  src/ui/sim_i18n.ts, EXACT matcher). */
export const SMITH_HEART_VEIN_LIT_LOG: Readonly<Record<SmithHeartVein, string>> = {
  hammer: 'An ochre light runs down from the Quarry toward the heart seal.',
  breath: 'A storm-blue light runs down the Breath toward the heart seal.',
  quench: 'An ice-pale light runs up the Quench toward the heart seal.',
  heat: 'A white-gold light runs out of the Hearth toward the heart seal.',
};

/** The English line the raid reads when the heart seal crystal bursts (re-
 *  localized by src/ui/sim_i18n.ts, EXACT matcher). */
export const SMITH_HEART_PORTAL_OPEN_LOG =
  'The heart seal crystal shatters, and a way down into the heart of the mountain whirls open in its place.';

/** The claim's seal markers' current value (the first marker's; all agree). */
export function markerMask(ctx: SimContext, inst: InstanceSlot): number | null {
  for (const id of inst.objectIds) {
    const e = ctx.entities.get(id);
    const m = e ? smithHeartSealMaskOf(e.templateId) : null;
    if (m !== null) return m;
  }
  return null;
}

/** Tell every player standing in the claim a line of the seal's. */
export function announce(ctx: SimContext, inst: InstanceSlot, text: string): void {
  const o = instanceOrigin(DUNGEONS[inst.dungeonId].index, inst.slot);
  const half = instanceHalfWidthOf(inst.dungeonId);
  for (const meta of ctx.players.values()) {
    const e = ctx.entities.get(meta.entityId);
    if (!e || Math.abs(e.pos.x - o.x) >= half || Math.abs(e.pos.z - o.z) >= 250) continue;
    ctx.emit({ type: 'log', text, color: '#e8c070', pid: meta.entityId });
  }
}

/** Write `value` onto every seal marker of the claim (their template id
 *  carries it) and keep each marker inert (seal_crystal.ts). */
export function writeSealMarkers(ctx: SimContext, inst: InstanceSlot, value: number): void {
  const template = smithHeartSealTemplate(value);
  for (const id of inst.objectIds) {
    const e = ctx.entities.get(id);
    if (!e || smithHeartSealMaskOf(e.templateId) === null) continue;
    if (e.templateId !== template) e.templateId = template;
    holdSealMarkerInert(e);
  }
}

/**
 * One tick of one claim's seal: write the value (the veins the claim has won,
 * the charge, the kept portal and arrival bits, the exit) onto every marker,
 * keep the crystal honest, and tell the raid about each vein that lit since
 * the last tick. The portal bit is carried over from the markers, never
 * derived: only a burst sets it (a living player in the middle circle while the
 * crystal is charged, here, or the forced burst, seal_burst.ts). Returns the claim's current
 * marker value, or null for a claim without markers.
 */
export function tickSmithHeartSeal(ctx: SimContext, inst: InstanceSlot): number | null {
  const before = markerMask(ctx, inst);
  if (before === null) return null;
  const p = smithHeartProgress(ctx, inst);
  // The arrival: kept once set, unless a dev replay holds the heart asleep.
  const asleep = devHeldAsleep(ctx, inst);
  const awake = !asleep && (smithHeartAwakeBitSet(before) || smithHeartPlayerInHeart(ctx, inst));
  const exit = dungeonPlacedBossDead(ctx, inst, SMITH_HEART_FINAL_BOSS);
  // The burst: once the crystal is charged, the first tick a living player stands
  // in the middle circle sets the portal bit, kept from then on.
  const crystal = p.ready && !p.portalOpen ? sealCrystalOf(ctx, inst) : null;
  const portal = p.portalOpen || (crystal !== null && sealCrystalTriggered(ctx, crystal));
  const value =
    p.mask |
    (p.ready ? SMITH_HEART_READY_BIT : 0) |
    (portal ? SMITH_HEART_PORTAL_BIT : 0) |
    (awake ? SMITH_HEART_AWAKE_BIT : 0) |
    (exit ? SMITH_HEART_EXIT_BIT : 0);
  writeSealMarkers(ctx, inst, value);
  tickSealCrystal(ctx, inst, portal);
  if (value === before) return value;
  for (const v of SMITH_HEART_VEINS) {
    if (smithHeartVeinLit(value, v) && !smithHeartVeinLit(before, v)) {
      announce(ctx, inst, SMITH_HEART_VEIN_LIT_LOG[v]);
    }
  }
  // The crystal burst this tick: the raid reads its line once (a forced burst,
  // burstSmithHeartSeal, announces itself and writes the bit before this tick).
  if (smithHeartPortalBitSet(value) && !smithHeartPortalBitSet(before)) {
    announce(ctx, inst, SMITH_HEART_PORTAL_OPEN_LOG);
  }
  // The heart wakes: its arrival lines follow over the scene.
  if (smithHeartAwakeBitSet(value) && !smithHeartAwakeBitSet(before)) beginArrivalVoice(ctx, inst);
  return value;
}

/** One tick of every Smith's Heart claim (instances/dungeons.ts): the Hammer
 *  Council's fight, the seal (and the arrival), then the portal hops (the
 *  Ring's portal only once the crystal has burst). The claim list is walked
 *  in place. */
export function tickSmithHeart(ctx: SimContext): void {
  for (const inst of ctx.instances) {
    if (inst.partyKey === null || inst.dungeonId !== SMITH_HEART_DUNGEON) continue;
    // The council first, so its fall lights the Hammer vein this same tick;
    // the Breath's and the Quench's guardians likewise before the seal.
    tickHammerCouncil(ctx, inst);
    tickBreathGuardian(ctx, inst);
    tickQuenchGuardian(ctx, inst);
    tickHeatGuardian(ctx, inst);
    tickFinalBoss(ctx, inst);
    const value = tickSmithHeartSeal(ctx, inst);
    // The kill order the death checkpoints read (checkpoint_order.ts): the
    // markers' value carries the earned veins, the same mask the seal lit.
    const mask = value !== null ? value & SMITH_HEART_SEAL_FULL : smithHeartEarnedMask(ctx, inst);
    noteSmithHeartKills(inst, mask, SMITH_HEART_VEIN_BITS);
    if (value !== null)
      tickSmithHeartPortal(ctx, inst, smithHeartPortalBitSet(value), smithHeartExitBitSet(value));
    stepArrivalVoice(ctx, inst, finalBoss(ctx, inst));
  }
}
