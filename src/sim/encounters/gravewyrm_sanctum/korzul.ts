// Korzul the Gravewyrm (docs/design/dungeon-rework/gravewyrm_sanctum.md
// section 6.3): a dragon fight on a lake his fire is breaking. Every breath
// spends ice, and the group aims the breath, so the group decides which ice
// to spend.
//
//   The plates (G25)  the lake's nineteen LAKE_PLATES are Sound, Cracked or
//                     Broken (plates.ts). Fire cracks a Sound plate and breaks
//                     a Cracked one; a Cracked plate refreezes after 30 s
//                     (heroic Deep Quench: never). A broken plate is open
//                     quench-water: 50 percent slow and 60 a second (heroic
//                     150) to a player in it.
//   Break Free        his pull (korzul_emerge.ts): the Calving Face bursts and
//                     he tears out at its foot (a 3 s bar), climbs, glides over
//                     the lake and lands on the arena centre; out of reach the
//                     whole way, his fight and its clocks begin at the
//                     touchdown. A player out on the plates wakes him.
//   Grave Breath      every 15 s (12 s in the last phase) a 2 s bar along the
//                     tank's line, then a 60 degree cone 30 yd past his body:
//                     250 to 300 on anyone but the tank, and up to three
//                     covered plates burn (the nearest first).
//   Tail Sweep        every 12 s a 1.2 s bar, then his rear 120 degrees, 12 yd
//                     past his body: 200 to 240 and a knockback.
//   Grave Inferno     every 30 s and once at half health: the stationary 8 s
//                     channel, four pulses within 14 yd (pulse n lands n times
//                     70 to 90). Pulse 2 burns the plate under him and pulse 4
//                     burns it again; the moment it breaks he plunges into the
//                     water, Doused, and the channel ends. A pre-cracked plate
//                     halves it.
//   Flights (G26)     at 70 and 40 percent: Wing Gale (a 1.5 s bar, everyone
//                     pushed 8 yd) and he climbs out of reach (KORZUL_AIRBORNE,
//                     pos.y up KORZUL_TUNING.flightAltitude, immune, nobody's
//                     target, his fight and threat kept). One Scaleguard climbs
//                     out of each broken plate (up to three). Wyrm's Eye marks
//                     a non-tank (heroic Twin Eyes: two) for 4 s; when it ends
//                     he hangs over the plate that player stands on and pours
//                     Plunging Fire on the whole plate (3 s warning, 300 to 350
//                     to anyone on it, the plate burns). Two rounds in the
//                     first flight, three in the second. Then Crashing Descent
//                     on the unbroken plate with the most players (3 s shadow,
//                     250 to 300 within 12 yd and a knockback, the plate burns).
//   Last phase        after the second flight: the shard flares, Grave Breath
//                     every 12 s and Wing Gale every 20 s on the ground.
//   No ice left       every plate broken: he hovers over the open water and
//                     breathes without pause (the soft enrage the group
//                     brought on itself).
//   Enrage            the template's kept enrage under 30 percent (a marker
//                     aura shows it).
//
// He falls onto the last ice and it gives way: the plate under him breaks.
// "Thin Ice" (dgn_korzul_thin_ice): at least twelve plates unbroken when he
// dies. A wipe or an evade resets the lake to Sound and sends the brood away.
//
// Deterministic: no pick is rolled (the cones take everyone inside, the eyes
// are hashed among the non-tanks by kitHash, the landing plate is the most
// crowded unbroken plate with ties to the lower index); the only rng draws are
// damage rolls, in claim-player order. Every visible state rides existing
// entity fields (cast bars, facing, heights, auras, the plate objects'
// template ids, the fire and shadow objects, spellfx), so the online client
// mirrors it with no wire change.

import { LAKE_PLATES, WYRMS_HOLLOW } from '../../content/gravewyrm_sanctum_layout';
import { applyKnockback } from '../../knockback';
import {
  climbArc,
  floorUnder,
  glideToward,
  holdAloft,
  placeFlier,
  releaseAloft,
} from '../../mob/flight';
import { spawnKitAdd } from '../../mob/trash_kit/spawn';
import { inCone } from '../../mob/trash_kit/targets';
import type { InstanceSlot } from '../../sim';
import type { SimContext } from '../../sim_context';
import { type Aura, DT, dist2d, type Entity } from '../../types';
import { pickMarkTargets } from '../sunken_bastion/claim';
import { KORZUL_BODY_RADIUS, KORZUL_REACH, plateTemplate } from './boss_ids';
import {
  claimPlayers,
  clearCastIf,
  dropAuraById,
  dropEncounterObject,
  grantClaimDeed,
  holdPlanted,
  localOf,
  mechanicDamage,
  spawnSanctumObject,
  startBar,
} from './claim';
import {
  KORZUL_AIRBORNE,
  KORZUL_BREAK_FREE,
  KORZUL_BROOD,
  KORZUL_CRASHING_DESCENT,
  KORZUL_DOUSED,
  KORZUL_ENRAGE,
  KORZUL_GRAVE_BREATH,
  KORZUL_GRAVE_INFERNO,
  KORZUL_PLUNGING_FIRE,
  KORZUL_SHARD_FLARE,
  KORZUL_TAIL_SWEEP,
  KORZUL_TUNING,
  KORZUL_WING_GALE,
  KORZUL_WYRMS_EYE,
  SANCTUM_DEED_IDS,
  SANCTUM_LANDING_SHADOW,
  SANCTUM_PLUNGING_FIRE,
  SANCTUM_QUENCH_WATER,
  SCALEGUARD_ID,
} from './ids';
import {
  holdInIce,
  skipEmerge,
  standReady,
  startEmerge,
  stepEmerge,
  wakeKorzul,
} from './korzul_emerge';
import type { KorzulFightState, KorzulFlight } from './korzul_state';
import {
  burnPlate,
  conePlates,
  nearestPlate,
  type PlateRec,
  plateIndexAt,
  plateRecTemplate,
  stepRefreeze,
  unbrokenPlates,
} from './plates';
import { storyStep } from './story';

const T = KORZUL_TUNING;

/** His drawn body radius (the template's bodyRadius): cones reach from it. */
export const KORZUL_BODY = KORZUL_BODY_RADIUS;
/** The climb from the ice to the hover. */
export const KORZUL_TAKEOFF_SECONDS = 1.8;
/** How fast he glides between plates on the wing (yards a second). */
const FLY_SPEED = 12;
/** How far Wing Gale reaches. */
const GALE_REACH = 45;
/** No ice left: he hovers this low over the water (still in reach), and
 *  draws breath again this soon after each one lands. */
const DROWN_HEIGHT = 5;
const DROWN_EVERY = 1;
/** Seconds into the air of eye round k: 1 + 5k (the eye 4 s, the warning
 *  3 s, the next eye marked while the last plate burns). */
const EYE_ROUND = 5;
/** Thin Ice: at least this many plates unbroken at his death. */
export const THIN_ICE_PLATES = 12;

/** His sim-English log lines (re-localized by the client's EXACT matcher,
 *  src/ui/sim_i18n.ts). */
export { KORZUL_BREAK_FREE_LOG } from './korzul_emerge';
export const KORZUL_FLIGHT_LOG = 'Korzul beats his wings and takes to the air above the lake!';
export const KORZUL_DOUSED_LOG =
  'The ice gives way under Korzul! He plunges into the quench, Doused.';
export const KORZUL_SHARD_LOG = "The shard in Korzul's chest flares, and the aurora burns with it!";
export const KORZUL_NO_ICE_LOG =
  'No ice is left on the lake. Korzul hangs over the open quench and breathes without pause!';

// ------------------------------------------------------------------ state

function freshState(): KorzulFightState {
  return {
    kind: 'korzul',
    phase: 'idle',
    pt: 0,
    plates: [],
    breathTimer: T.breathFirst,
    tailTimer: T.tailFirst,
    infernoTimer: T.infernoFirst,
    galeTimer: T.galeEveryLast,
    infernoGates: 0,
    inferno: null,
    doused: 0,
    aimYaw: null,
    plantedAt: null,
    flights: 0,
    flight: null,
    lastPhase: false,
    enraged: false,
    broodIds: [],
    quenchTick: 1,
    casts: 0,
    emergeFrom: null,
    waking: false,
  };
}

/** Is the claim's lake under Deep Quench (heroic: cracked plates never refreeze)? */
function deepQuench(inst: InstanceSlot): boolean {
  return inst.difficulty === 'heroic';
}

/** Korzul's fight state; the lake's plates are spawned with it, Sound. */
export function korzulState(ctx: SimContext, inst: InstanceSlot, boss: Entity): KorzulFightState {
  if (boss.sanctumFight?.kind !== 'korzul') boss.sanctumFight = freshState();
  const st = boss.sanctumFight;
  ensurePlates(ctx, inst, st);
  return st;
}

/** Spawn the lake's nineteen plate objects (once per claim; again if a freed
 *  claim dropped them). */
function ensurePlates(ctx: SimContext, inst: InstanceSlot, st: KorzulFightState): void {
  if (
    st.plates.length === LAKE_PLATES.length &&
    st.plates.every((p) => ctx.entities.has(p.objectId))
  )
    return;
  for (const p of st.plates)
    if (ctx.entities.has(p.objectId)) dropEncounterObject(ctx, inst, p.objectId);
  const o = ctx.instanceOriginOf(inst);
  st.plates = LAKE_PLATES.map((p) => {
    const obj = spawnSanctumObject(
      ctx,
      inst,
      plateTemplate('sound'),
      'Lake Plate',
      o.x + p.x,
      o.z + p.z,
      p.r,
    );
    return { objectId: obj.id, state: 'sound', refreeze: 0 } satisfies PlateRec;
  });
}

/** Mirror a plate's state into its object's template id. */
function syncPlate(ctx: SimContext, inst: InstanceSlot, st: KorzulFightState, i: number): void {
  const rec = st.plates[i];
  const obj = rec ? ctx.entities.get(rec.objectId) : undefined;
  if (!obj) return;
  const template = plateRecTemplate(rec, T.refreezeSeconds, deepQuench(inst));
  if (obj.templateId !== template) obj.templateId = template;
}

/** Fire on plate `i`. Returns its new state. */
export function burnLakePlate(
  ctx: SimContext,
  inst: InstanceSlot,
  st: KorzulFightState,
  i: number,
): 'sound' | 'cracked' | 'broken' {
  const rec = st.plates[i];
  if (!rec) return 'sound';
  const now = burnPlate(rec, T.refreezeSeconds);
  syncPlate(ctx, inst, st, i);
  return now;
}

/** Set every plate Sound again (a wipe, or a dev reset). */
function resetLake(ctx: SimContext, inst: InstanceSlot, st: KorzulFightState): void {
  for (let i = 0; i < st.plates.length; i++) {
    st.plates[i].state = 'sound';
    st.plates[i].refreeze = 0;
    syncPlate(ctx, inst, st, i);
  }
}

/** The plates' states, in LAKE_PLATES order. */
export function plateStates(st: KorzulFightState): ('sound' | 'cracked' | 'broken')[] {
  return st.plates.map((p) => p.state);
}

/** The plate an entity stands on (claim-local), or null on the shelf. */
function plateUnder(ctx: SimContext, inst: InstanceSlot, e: Entity): number | null {
  const at = localOf(ctx, inst, e);
  return plateIndexAt(at.x, at.z);
}

// ------------------------------------------------------------------ helpers

function marker(e: Entity, ctx: SimContext, id: string, name: string, seconds = 3600): void {
  const aura: Aura = {
    id,
    name,
    kind: 'buff_dr',
    remaining: seconds,
    duration: seconds,
    permanent: seconds >= 3600,
    value: 0,
    sourceId: e.id,
    school: 'fire',
    undispellable: true,
  };
  ctx.applyAura(e, aura);
  // A cc-immune boss may refuse a "debuff"; a marker always lands.
  if (!e.auras.some((a) => a.id === id)) e.auras.push(aura);
}

function nova(
  ctx: SimContext,
  source: Entity,
  target: Entity,
  ability: string,
  school = 'fire',
): void {
  ctx.emit({
    type: 'spellfx',
    sourceId: source.id,
    targetId: target.id,
    school: school as Aura['school'],
    fx: 'nova',
    ability,
  });
}

function log(ctx: SimContext, boss: Entity, text: string): void {
  ctx.emit({ type: 'log', text, color: '#ff9a4a', entityId: boss.id });
}

/** Set a bar's remaining time from its own clock (a held bar is ticked here). */
function tickBar(boss: Entity): boolean {
  boss.castRemaining = Math.max(0, boss.castRemaining - DT);
  boss.swingTimer = Math.max(boss.swingTimer, 0.6);
  return boss.castRemaining <= 0;
}

/** One glide step on the wing toward a claim-local point. The mob AI may have
 *  walked him toward his target before this pass, so he flies on from where
 *  the flight last left him (`plantedAt`, world), never from there. */
function flyStep(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  st: KorzulFightState,
  tx: number,
  tz: number,
  y: number,
): void {
  if (st.plantedAt) {
    boss.pos.x = st.plantedAt.x;
    boss.pos.z = st.plantedAt.z;
  }
  glideToward(ctx, inst, boss, tx, tz, y, FLY_SPEED, DT);
  st.plantedAt = { ...boss.pos };
}

const GROUND_BARS = [KORZUL_GRAVE_BREATH, KORZUL_TAIL_SWEEP, KORZUL_WING_GALE];

// ------------------------------------------------------------------ ground kit

/** Grave Breath: a 2 s bar along the tank's line. */
export function startGraveBreath(ctx: SimContext, boss: Entity, st: KorzulFightState): boolean {
  if (boss.castingAbility !== null) return false;
  const tank = boss.aggroTargetId !== null ? ctx.entities.get(boss.aggroTargetId) : undefined;
  const yaw = tank ? Math.atan2(tank.pos.x - boss.pos.x, tank.pos.z - boss.pos.z) : boss.facing;
  st.aimYaw = yaw;
  boss.facing = yaw;
  st.plantedAt = { ...boss.pos };
  st.breathTimer = st.lastPhase ? T.breathEveryLast : T.breathEvery;
  st.casts++;
  startBar(boss, KORZUL_GRAVE_BREATH, T.breathCast, tank?.id ?? null);
  return true;
}

/** The breath lands: everyone but the tank in the cone burns, and up to three
 *  covered plates burn. Returns the plates it burned. `everyone` (no ice
 *  left) takes the tank too. */
function landGraveBreath(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  st: KorzulFightState,
  tankId: number | null,
  everyone = false,
): number[] {
  const yaw = st.aimYaw ?? boss.facing;
  st.aimYaw = null;
  nova(ctx, boss, boss, KORZUL_GRAVE_BREATH);
  const reach = KORZUL_REACH.breath;
  for (const p of claimPlayers(ctx, inst)) {
    if (p.dead || (!everyone && p.id === tankId)) continue;
    if (!inCone(boss.pos, yaw, p.pos, reach, T.breathArcDeg)) continue;
    ctx.dealDamage(
      boss,
      p,
      mechanicDamage(ctx, boss, T.breathMin, T.breathMax),
      false,
      'fire',
      'Grave Breath',
      'hit',
      true,
    );
  }
  const at = localOf(ctx, inst, boss);
  const burned = conePlates(
    at.x,
    at.z,
    yaw,
    reach,
    T.breathArcDeg,
    T.breathPlates,
    plateStates(st),
    plateIndexAt(at.x, at.z),
  );
  for (const i of burned) burnLakePlate(ctx, inst, st, i);
  return burned;
}

/** Tail Sweep: a 1.2 s bar, then his rear cone. */
export function startTailSweep(boss: Entity, st: KorzulFightState): boolean {
  if (boss.castingAbility !== null) return false;
  st.aimYaw = boss.facing + Math.PI;
  st.plantedAt = { ...boss.pos };
  st.tailTimer = T.tailEvery;
  st.casts++;
  startBar(boss, KORZUL_TAIL_SWEEP, T.tailCast, null);
  return true;
}

function landTailSweep(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  st: KorzulFightState,
): void {
  const yaw = st.aimYaw ?? boss.facing + Math.PI;
  st.aimYaw = null;
  nova(ctx, boss, boss, KORZUL_TAIL_SWEEP, 'physical');
  for (const p of claimPlayers(ctx, inst)) {
    if (p.dead || !inCone(boss.pos, yaw, p.pos, KORZUL_REACH.tail, T.tailArcDeg)) continue;
    ctx.dealDamage(
      boss,
      p,
      mechanicDamage(ctx, boss, T.tailMin, T.tailMax),
      false,
      'physical',
      'Tail Sweep',
      'hit',
      true,
    );
    if (!p.dead) applyKnockback(ctx, boss, p, T.tailKnockback);
  }
}

/** Wing Gale: a 1.5 s bar (before a flight, or on the ground in the last phase). */
export function startWingGale(boss: Entity, st: KorzulFightState): boolean {
  if (boss.castingAbility !== null) return false;
  st.plantedAt = { ...boss.pos };
  st.galeTimer = T.galeEveryLast;
  st.casts++;
  startBar(boss, KORZUL_WING_GALE, T.galeCast, null);
  return true;
}

function landWingGale(ctx: SimContext, inst: InstanceSlot, boss: Entity): void {
  nova(ctx, boss, boss, KORZUL_WING_GALE, 'physical');
  for (const p of claimPlayers(ctx, inst)) {
    if (p.dead || dist2d(p.pos, boss.pos) > GALE_REACH) continue;
    applyKnockback(ctx, boss, p, T.galePush);
  }
}

/** Grave Inferno: the stationary 8 s channel. */
export function startGraveInferno(ctx: SimContext, boss: Entity, st: KorzulFightState): boolean {
  if (boss.castingAbility !== null) return false;
  st.infernoTimer = T.infernoEvery;
  st.inferno = { t: 0, pulses: 0 };
  st.plantedAt = { ...boss.pos };
  st.casts++;
  startBar(boss, KORZUL_GRAVE_INFERNO, T.infernoDuration, null, true);
  ctx.emit({
    type: 'spellfxAt',
    x: boss.pos.x,
    z: boss.pos.z,
    school: 'fire',
    fx: 'nova',
    radius: T.infernoRadius,
  });
  return true;
}

/** Doused: his plate broke under him; the Inferno ends at once. */
function douse(ctx: SimContext, boss: Entity, st: KorzulFightState): void {
  clearCastIf(boss, KORZUL_GRAVE_INFERNO);
  st.inferno = null;
  st.doused = T.dousedSeconds;
  marker(boss, ctx, KORZUL_DOUSED, 'Doused', T.dousedSeconds);
  nova(ctx, boss, boss, KORZUL_DOUSED, 'frost');
  log(ctx, boss, KORZUL_DOUSED_LOG);
}

/** The channel in flight: pulses at 2, 4, 6 and 8 s; pulses 2 and 4 burn his
 *  plate. Returns true while it owns him. */
function stepGraveInferno(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  st: KorzulFightState,
): boolean {
  const inf = st.inferno;
  if (!inf) return false;
  if (boss.castingAbility !== KORZUL_GRAVE_INFERNO) {
    st.inferno = null;
    return false;
  }
  if (st.plantedAt) holdPlanted(ctx, boss, st.plantedAt);
  boss.swingTimer = Math.max(boss.swingTimer, 0.6);
  inf.t += DT;
  boss.castRemaining = Math.max(0, T.infernoDuration - inf.t);
  const interval = T.infernoDuration / T.infernoPulses;
  const due = Math.min(T.infernoPulses, Math.floor((inf.t + 1e-9) / interval));
  while (inf.pulses < due) {
    inf.pulses++;
    const k = inf.pulses;
    nova(ctx, boss, boss, KORZUL_GRAVE_INFERNO);
    ctx.emit({
      type: 'spellfxAt',
      x: boss.pos.x,
      z: boss.pos.z,
      school: 'fire',
      fx: 'nova',
      radius: T.infernoRadius,
    });
    for (const p of claimPlayers(ctx, inst)) {
      if (p.dead || dist2d(p.pos, boss.pos) > T.infernoRadius) continue;
      ctx.dealDamage(
        boss,
        p,
        mechanicDamage(ctx, boss, T.infernoMin * k, T.infernoMax * k),
        false,
        'fire',
        'Grave Inferno',
        'hit',
        true,
      );
    }
    if (k === T.infernoCrackPulse || k === T.infernoBreakPulse) {
      // His own fire eats the plate he stands on.
      const i = plateUnder(ctx, inst, boss);
      const broke =
        i !== null &&
        (st.plates[i].state === 'broken' || burnLakePlate(ctx, inst, st, i) === 'broken');
      if (broke) {
        douse(ctx, boss, st);
        return true;
      }
    }
  }
  if (inf.t >= T.infernoDuration - 1e-9) {
    clearCastIf(boss, KORZUL_GRAVE_INFERNO);
    st.inferno = null;
    st.plantedAt = null;
  }
  return true;
}

// ------------------------------------------------------------------ flights

/** Start a flight: Wing Gale's bar, then the climb. */
export function startFlight(ctx: SimContext, boss: Entity, st: KorzulFightState): boolean {
  if (st.flights >= T.flightAtHpPct.length || st.phase === 'air' || st.phase === 'takeoff')
    return false;
  clearCastIf(boss, ...GROUND_BARS, KORZUL_GRAVE_INFERNO);
  st.inferno = null;
  st.aimYaw = null;
  st.plantedAt = { ...boss.pos };
  st.casts++;
  st.phase = 'gale';
  st.pt = 0;
  startBar(boss, KORZUL_WING_GALE, T.galeCast, null);
  log(ctx, boss, KORZUL_FLIGHT_LOG);
  return true;
}

/** Brood from Below: one Scaleguard out of each broken plate, up to three. */
export function callBrood(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  st: KorzulFightState,
): number {
  const players = claimPlayers(ctx, inst).filter((p) => !p.dead);
  const o = ctx.instanceOriginOf(inst);
  let n = 0;
  for (let i = 0; i < st.plates.length && n < T.broodMax; i++) {
    if (st.plates[i].state !== 'broken') continue;
    const plate = LAKE_PLATES[i];
    // It climbs out at the nearest player (ties to the lower id).
    let victim: Entity | null = null;
    let best = Number.POSITIVE_INFINITY;
    for (const p of players) {
      const d = Math.hypot(p.pos.x - o.x - plate.x, p.pos.z - o.z - plate.z);
      if (d < best - 1e-9) {
        best = d;
        victim = p;
      }
    }
    const add = spawnKitAdd(ctx, inst, boss, SCALEGUARD_ID, o.x + plate.x, o.z + plate.z, victim);
    if (!add) continue;
    st.broodIds.push(add.id);
    nova(ctx, add, add, KORZUL_BROOD, 'frost');
    n++;
  }
  return n;
}

function freshFlight(ctx: SimContext, inst: InstanceSlot, boss: Entity, n: number): KorzulFlight {
  const at = localOf(ctx, inst, boss);
  return {
    n,
    t: 0,
    rounds: T.eyesPerFlight[Math.min(n, T.eyesPerFlight.length) - 1] ?? 2,
    marked: 0,
    eyes: [],
    carried: [],
    plunge: null,
    landing: null,
    hoverX: at.x,
    hoverZ: at.z,
  };
}

/** Wyrm's Eye: mark a non-tank (heroic Twin Eyes: two), never one who already
 *  carried an eye this flight while someone else is free. */
export function markWyrmsEye(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  st: KorzulFightState,
  f: KorzulFlight,
): Entity[] {
  const players = claimPlayers(ctx, inst).filter((p) => !p.dead);
  const count = inst.difficulty === 'heroic' ? 2 : 1;
  let picked = pickMarkTargets(boss, players, count, st.casts + 31, new Set(f.carried));
  if (picked.length < count)
    picked = pickMarkTargets(boss, players, count, st.casts + 31, new Set(picked.map((p) => p.id)))
      .concat(picked)
      .slice(0, count);
  st.casts++;
  f.marked++;
  for (const p of picked) {
    f.eyes.push({ pid: p.id, remaining: T.eyeSeconds });
    if (!f.carried.includes(p.id)) f.carried.push(p.id);
    ctx.applyAura(p, {
      id: KORZUL_WYRMS_EYE,
      name: "Wyrm's Eye",
      kind: 'vulnerability',
      remaining: T.eyeSeconds,
      duration: T.eyeSeconds,
      value: 0,
      sourceId: boss.id,
      school: 'fire',
      undispellable: true,
    });
  }
  return picked;
}

/** The eyes closed: he hangs over the marked players' plates and the fire's
 *  warning paints each whole plate. */
function startPlunge(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  st: KorzulFightState,
  f: KorzulFlight,
): void {
  const plates: number[] = [];
  for (const eye of f.eyes) {
    const p = ctx.entities.get(eye.pid);
    if (p) dropAuraById(p, KORZUL_WYRMS_EYE);
    if (!p || p.dead) continue;
    const at = localOf(ctx, inst, p);
    plates.push(plateIndexAt(at.x, at.z) ?? nearestPlate(at.x, at.z));
  }
  f.eyes = [];
  if (plates.length === 0) return;
  const o = ctx.instanceOriginOf(inst);
  const unique = [...new Set(plates)];
  const objectIds = unique.map(
    (i) =>
      spawnSanctumObject(
        ctx,
        inst,
        SANCTUM_PLUNGING_FIRE,
        'Plunging Fire',
        o.x + LAKE_PLATES[i].x,
        o.z + LAKE_PLATES[i].z,
        LAKE_PLATES[i].r,
      ).id,
  );
  f.plunge = { plates, objectIds, remaining: T.plungeWarn };
  f.hoverX = unique.reduce((s, i) => s + LAKE_PLATES[i].x, 0) / unique.length;
  f.hoverZ = unique.reduce((s, i) => s + LAKE_PLATES[i].z, 0) / unique.length;
  st.casts++;
  startBar(boss, KORZUL_PLUNGING_FIRE, T.plungeWarn, objectIds[0], true);
}

/** The fire falls: everyone on each burning plate is struck, and the plate
 *  burns (twice, when two eyes chose the same plate). */
function landPlunge(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  st: KorzulFightState,
  f: KorzulFlight,
): void {
  const pl = f.plunge;
  f.plunge = null;
  clearCastIf(boss, KORZUL_PLUNGING_FIRE);
  if (!pl) return;
  for (const id of pl.objectIds) {
    const obj = ctx.entities.get(id);
    if (obj) nova(ctx, boss, obj, KORZUL_PLUNGING_FIRE);
  }
  const players = claimPlayers(ctx, inst);
  for (const i of pl.plates) {
    for (const p of players) {
      if (p.dead || plateUnder(ctx, inst, p) !== i) continue;
      ctx.dealDamage(
        boss,
        p,
        mechanicDamage(ctx, boss, T.plungeMin, T.plungeMax),
        false,
        'fire',
        'Plunging Fire',
        'hit',
        true,
      );
    }
    burnLakePlate(ctx, inst, st, i);
  }
  for (const id of pl.objectIds) dropEncounterObject(ctx, inst, id);
}

/** Where he lands: the unbroken plate with the most players on it (ties to
 *  the lower index), or, with nobody on the ice, the unbroken plate nearest
 *  the tank. Null when no ice is left. */
export function landingPlate(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  st: KorzulFightState,
): number | null {
  const counts = new Array<number>(LAKE_PLATES.length).fill(0);
  for (const p of claimPlayers(ctx, inst)) {
    if (p.dead) continue;
    const i = plateUnder(ctx, inst, p);
    if (i !== null) counts[i]++;
  }
  let best: number | null = null;
  for (let i = 0; i < LAKE_PLATES.length; i++) {
    if (st.plates[i].state === 'broken') continue;
    if (best === null || counts[i] > counts[best]) best = i;
  }
  if (best === null || counts[best] > 0) return best;
  const tank = boss.aggroTargetId !== null ? ctx.entities.get(boss.aggroTargetId) : undefined;
  const at = tank ? localOf(ctx, inst, tank) : { x: WYRMS_HOLLOW.x, z: WYRMS_HOLLOW.z };
  let near: number | null = null;
  let nearD = Number.POSITIVE_INFINITY;
  for (let i = 0; i < LAKE_PLATES.length; i++) {
    if (st.plates[i].state === 'broken') continue;
    const d = Math.hypot(LAKE_PLATES[i].x - at.x, LAKE_PLATES[i].z - at.z);
    if (d < nearD - 1e-9) {
      near = i;
      nearD = d;
    }
  }
  return near;
}

/** Crashing Descent: his shadow grows on the landing plate for 3 s. */
export function startDescent(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  st: KorzulFightState,
  f: KorzulFlight,
): boolean {
  const plate = landingPlate(ctx, inst, boss, st);
  if (plate === null) return false;
  const o = ctx.instanceOriginOf(inst);
  const p = LAKE_PLATES[plate];
  const shadow = spawnSanctumObject(
    ctx,
    inst,
    SANCTUM_LANDING_SHADOW,
    'Crashing Descent',
    o.x + p.x,
    o.z + p.z,
    T.descentRadius,
  );
  f.landing = { plate, objectId: shadow.id, remaining: T.descentWarn };
  f.hoverX = p.x;
  f.hoverZ = p.z;
  st.casts++;
  startBar(boss, KORZUL_CRASHING_DESCENT, T.descentWarn, shadow.id);
  return true;
}

/** He lands: everyone within 12 yd of the plate's centre is struck and thrown,
 *  the plate burns, and the ground fight resumes. */
function land(ctx: SimContext, inst: InstanceSlot, boss: Entity, st: KorzulFightState): void {
  const f = st.flight;
  const landing = f?.landing;
  clearCastIf(boss, KORZUL_CRASHING_DESCENT, KORZUL_PLUNGING_FIRE);
  if (landing) {
    const p = LAKE_PLATES[landing.plate];
    placeFlier(ctx, inst, boss, p.x, p.z, floorUnder(ctx, inst, p.x, p.z));
    dropEncounterObject(ctx, inst, landing.objectId);
    nova(ctx, boss, boss, KORZUL_CRASHING_DESCENT, 'physical');
    for (const pl of claimPlayers(ctx, inst)) {
      if (pl.dead || dist2d(pl.pos, boss.pos) > T.descentRadius) continue;
      ctx.dealDamage(
        boss,
        pl,
        mechanicDamage(ctx, boss, T.descentMin, T.descentMax),
        false,
        'physical',
        'Crashing Descent',
        'hit',
        true,
      );
      if (!pl.dead) applyKnockback(ctx, boss, pl, T.descentKnockback);
    }
    burnLakePlate(ctx, inst, st, landing.plate);
  } else {
    const at = localOf(ctx, inst, boss);
    boss.pos.y = floorUnder(ctx, inst, at.x, at.z);
  }
  dropAuraById(boss, KORZUL_AIRBORNE);
  releaseAloft(boss);
  st.flight = null;
  st.flights++;
  st.phase = 'ground';
  st.plantedAt = null;
  st.breathTimer = Math.max(st.breathTimer, 4);
  st.tailTimer = Math.max(st.tailTimer, 6);
  if (st.flights >= T.flightAtHpPct.length && !st.lastPhase) {
    st.lastPhase = true;
    st.galeTimer = T.galeEveryLast;
    st.breathTimer = Math.min(st.breathTimer, T.breathEveryLast);
    marker(boss, ctx, KORZUL_SHARD_FLARE, 'Shard Flare');
    nova(ctx, boss, boss, KORZUL_SHARD_FLARE);
    log(ctx, boss, KORZUL_SHARD_LOG);
  }
}

/** The air: the hover, the eyes, the fire, the descent. */
function stepAir(ctx: SimContext, inst: InstanceSlot, boss: Entity, st: KorzulFightState): void {
  const f = st.flight;
  if (!f) {
    land(ctx, inst, boss, st);
    return;
  }
  holdAloft(boss);
  f.t += DT;
  // Crashing Descent: he holds his height while his shadow grows, then dives
  // through the bar's second half (accelerating), so the landing reads as a
  // fall onto the plate rather than a snap at the end of the bar.
  const dive = f.landing ? Math.min(1, f.landing.remaining / (T.descentWarn * 0.5)) : 1;
  const y = floorUnder(ctx, inst, f.hoverX, f.hoverZ) + T.flightAltitude * dive * dive;
  flyStep(ctx, inst, boss, st, f.hoverX, f.hoverZ, y);
  // The eyes count down; when they close the fire's warning starts.
  if (f.eyes.length > 0) {
    for (const e of f.eyes) e.remaining -= DT;
    if (f.eyes.every((e) => e.remaining <= 1e-9) && !f.plunge) startPlunge(ctx, inst, boss, st, f);
  }
  if (f.plunge) {
    f.plunge.remaining -= DT;
    boss.castRemaining = Math.max(0, f.plunge.remaining);
    if (f.plunge.remaining <= 1e-9) landPlunge(ctx, inst, boss, st, f);
  }
  if (f.marked < f.rounds && f.eyes.length === 0 && f.t >= 1 + EYE_ROUND * f.marked - 1e-9)
    markWyrmsEye(ctx, inst, boss, st, f);
  if (f.landing) {
    f.landing.remaining -= DT;
    boss.castRemaining = Math.max(0, f.landing.remaining);
    if (f.landing.remaining <= 1e-9) land(ctx, inst, boss, st);
    return;
  }
  const descentAt = EYE_ROUND * f.rounds + 5;
  if (f.marked >= f.rounds && f.eyes.length === 0 && !f.plunge && f.t >= descentAt - 1e-9) {
    if (!startDescent(ctx, inst, boss, st, f)) startDrown(ctx, inst, boss, st);
  }
}

// ------------------------------------------------------------------ no ice left

/** Every plate broken: he hangs low over the open water, in reach, and breathes
 *  without pause. */
export function startDrown(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  st: KorzulFightState,
): void {
  if (st.flight) {
    for (const id of [st.flight.landing?.objectId, ...(st.flight.plunge?.objectIds ?? [])])
      if (id !== undefined) dropEncounterObject(ctx, inst, id);
    for (const eye of st.flight.eyes) {
      const p = ctx.entities.get(eye.pid);
      if (p) dropAuraById(p, KORZUL_WYRMS_EYE);
    }
    st.flight = null;
  }
  clearCastIf(
    boss,
    ...GROUND_BARS,
    KORZUL_GRAVE_INFERNO,
    KORZUL_PLUNGING_FIRE,
    KORZUL_CRASHING_DESCENT,
  );
  st.inferno = null;
  dropAuraById(boss, KORZUL_AIRBORNE);
  releaseAloft(boss);
  st.phase = 'drown';
  st.pt = DROWN_EVERY;
  st.plantedAt = { ...boss.pos };
  log(ctx, boss, KORZUL_NO_ICE_LOG);
}

function stepDrown(ctx: SimContext, inst: InstanceSlot, boss: Entity, st: KorzulFightState): void {
  const y = floorUnder(ctx, inst, WYRMS_HOLLOW.x, WYRMS_HOLLOW.z) + DROWN_HEIGHT;
  flyStep(ctx, inst, boss, st, WYRMS_HOLLOW.x, WYRMS_HOLLOW.z, y);
  boss.swingTimer = Math.max(boss.swingTimer, 0.6);
  if (boss.castingAbility === KORZUL_GRAVE_BREATH) {
    if (tickBar(boss)) {
      const tankId = boss.castTargetId;
      clearCastIf(boss, KORZUL_GRAVE_BREATH);
      landGraveBreath(ctx, inst, boss, st, tankId, true);
    } else if (st.aimYaw !== null) boss.facing = st.aimYaw;
    return;
  }
  st.pt -= DT;
  if (st.pt > 0 || boss.castingAbility !== null) return;
  st.pt = DROWN_EVERY;
  const at = st.plantedAt;
  startGraveBreath(ctx, boss, st);
  st.plantedAt = at;
}

// ------------------------------------------------------------------ the tick

/** The ground fight. */
function stepGround(ctx: SimContext, inst: InstanceSlot, boss: Entity, st: KorzulFightState): void {
  // Every clock runs through the other strikes' bars (start to start).
  st.breathTimer -= DT;
  st.tailTimer -= DT;
  st.infernoTimer -= DT;
  if (st.lastPhase) st.galeTimer -= DT;
  if (stepGraveInferno(ctx, inst, boss, st)) return;
  // Doused: he hauls himself out of the water.
  if (st.doused > 0) {
    st.doused -= DT;
    if (st.plantedAt) holdPlanted(ctx, boss, st.plantedAt);
    boss.swingTimer = Math.max(boss.swingTimer, 0.6);
    if (st.doused <= 1e-9) {
      st.doused = 0;
      dropAuraById(boss, KORZUL_DOUSED);
    }
    return;
  }
  const bar = boss.castingAbility;
  if (bar !== null && GROUND_BARS.includes(bar)) {
    if (st.plantedAt) holdPlanted(ctx, boss, st.plantedAt);
    if (st.aimYaw !== null)
      boss.facing = bar === KORZUL_TAIL_SWEEP ? st.aimYaw - Math.PI : st.aimYaw;
    if (!tickBar(boss)) return;
    const tankId = boss.castTargetId;
    clearCastIf(boss, bar);
    st.plantedAt = null;
    if (bar === KORZUL_GRAVE_BREATH) landGraveBreath(ctx, inst, boss, st, tankId);
    else if (bar === KORZUL_TAIL_SWEEP) landTailSweep(ctx, inst, boss, st);
    else landWingGale(ctx, inst, boss);
    return;
  }
  if (bar !== null || ctx.isStunned(boss)) return;
  st.plantedAt = null;
  const share = boss.maxHp > 0 ? boss.hp / boss.maxHp : 1;
  if (st.flights < T.flightAtHpPct.length && share <= T.flightAtHpPct[st.flights]) {
    startFlight(ctx, boss, st);
    return;
  }
  if (unbrokenPlates(plateStates(st)) === 0) {
    startDrown(ctx, inst, boss, st);
    return;
  }
  let gate = false;
  while (st.infernoGates < T.infernoAtHpPct.length && share <= T.infernoAtHpPct[st.infernoGates]) {
    st.infernoGates++;
    gate = true;
  }
  if (gate || st.infernoTimer <= 0) {
    startGraveInferno(ctx, boss, st);
    return;
  }
  if (st.breathTimer <= 0) startGraveBreath(ctx, boss, st);
  else if (st.tailTimer <= 0) startTailSweep(boss, st);
  else if (st.lastPhase && st.galeTimer <= 0) startWingGale(boss, st);
}

/** The quench-water: a player in a broken plate's water is slowed, and burned
 *  each second (60 landed, heroic 150). */
function stepQuench(ctx: SimContext, inst: InstanceSlot, boss: Entity, st: KorzulFightState): void {
  st.quenchTick -= DT;
  const tick = st.quenchTick <= 1e-9;
  if (tick) st.quenchTick += 1;
  for (const p of claimPlayers(ctx, inst)) {
    if (p.dead) continue;
    const i = plateUnder(ctx, inst, p);
    if (i === null || st.plates[i].state !== 'broken') continue;
    ctx.applyAura(p, {
      id: SANCTUM_QUENCH_WATER,
      name: 'Quench-Water',
      kind: 'slow',
      remaining: 0.35,
      duration: 0.35,
      value: T.quenchSlow,
      sourceId: boss.id,
      school: 'frost',
    });
    if (!tick) continue;
    const amount = Math.max(1, Math.round(T.quenchPerSecond * (boss.mechanicDamageMult ?? 1)));
    ctx.dealDamage(boss, p, amount, false, 'frost', 'Quench-Water', 'hit', true);
  }
}

/** The refreeze: a Cracked plate left alone turns Sound again (normal only). */
function stepPlates(ctx: SimContext, inst: InstanceSlot, st: KorzulFightState): void {
  const deep = deepQuench(inst);
  for (let i = 0; i < st.plates.length; i++) {
    const rec = st.plates[i];
    if (rec.state !== 'cracked') continue;
    stepRefreeze(rec, DT, deep);
    syncPlate(ctx, inst, st, i);
  }
}

/** Drop everything a fight leaves on the lake and on the players. */
function clearFightObjects(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  st: KorzulFightState,
): void {
  const f = st.flight;
  if (f) {
    for (const id of [f.landing?.objectId, ...(f.plunge?.objectIds ?? [])])
      if (id !== undefined) dropEncounterObject(ctx, inst, id);
    for (const eye of f.eyes) {
      const p = ctx.entities.get(eye.pid);
      if (p) dropAuraById(p, KORZUL_WYRMS_EYE);
    }
  }
  st.flight = null;
  st.inferno = null;
  clearCastIf(
    boss,
    ...GROUND_BARS,
    KORZUL_GRAVE_INFERNO,
    KORZUL_PLUNGING_FIRE,
    KORZUL_CRASHING_DESCENT,
    KORZUL_BREAK_FREE,
  );
  for (const id of [KORZUL_AIRBORNE, KORZUL_DOUSED, KORZUL_SHARD_FLARE, KORZUL_ENRAGE])
    dropAuraById(boss, id);
}

/** A wipe or an evade: the lake freezes Sound again, the brood goes back
 *  under, and he comes down to the ice (the evade walks him home). */
export function resetKorzul(ctx: SimContext, inst: InstanceSlot, boss: Entity): void {
  const st = boss.sanctumFight?.kind === 'korzul' ? boss.sanctumFight : null;
  if (!st) return;
  const aloft =
    st.phase === 'emerge' ||
    st.phase === 'gale' ||
    st.phase === 'takeoff' ||
    st.phase === 'air' ||
    st.phase === 'drown';
  clearFightObjects(ctx, inst, boss, st);
  if (aloft || boss.damageImmune) releaseAloft(boss);
  if (!boss.dead) {
    const at = localOf(ctx, inst, boss);
    boss.pos.y = floorUnder(ctx, inst, at.x, at.z);
  }
  for (const id of st.broodIds) {
    const add = ctx.entities.get(id);
    if (!add) continue;
    const k = inst.mobIds.indexOf(id);
    if (k >= 0) inst.mobIds.splice(k, 1);
    boss.summonedIds = boss.summonedIds.filter((s) => s !== id);
    for (const meta of ctx.players.values()) {
      const p = ctx.entities.get(meta.entityId);
      if (p?.targetId === id) p.targetId = null;
    }
    ctx.dropEntity(id);
  }
  const plates = st.plates;
  Object.assign(st, freshState(), { plates });
  resetLake(ctx, inst, st);
}

/** Thin Ice (dgn_korzul_thin_ice): at least twelve plates unbroken. */
export function thinIceEarned(states: readonly ('sound' | 'cracked' | 'broken')[]): boolean {
  return unbrokenPlates(states) >= THIN_ICE_PLATES;
}

/** He fell: the deed, then the last ice under him gives way. */
function concludeKorzul(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  st: KorzulFightState,
): void {
  // Only a fought kill earns the deed (a dev kill from the ice, or one while
  // he stands ready and unfought, never does).
  const fought = st.phase !== 'idle' && st.phase !== 'ready' && !st.waking;
  const thin = fought && thinIceEarned(plateStates(st));
  clearFightObjects(ctx, inst, boss, st);
  releaseAloft(boss);
  const at = localOf(ctx, inst, boss);
  boss.pos.y = floorUnder(ctx, inst, at.x, at.z);
  const i = plateIndexAt(at.x, at.z);
  if (i !== null && st.plates[i].state !== 'broken') {
    st.plates[i].state = 'broken';
    st.plates[i].refreeze = 0;
    syncPlate(ctx, inst, st, i);
  }
  st.phase = 'slain';
  if (thin) grantClaimDeed(ctx, inst, SANCTUM_DEED_IDS.korzulThinIce);
}

/** One tick of Korzul's fight (after the mob AI). */
export function tickKorzul(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  engaged: boolean,
): void {
  const st = korzulState(ctx, inst, boss);
  if (boss.dead) {
    if (st.phase !== 'slain') concludeKorzul(ctx, inst, boss, st);
    return;
  }
  if (st.phase === 'slain') return;
  if (!engaged) {
    tickKorzulOutOfFight(ctx, inst, boss, st);
    return;
  }
  // Pulled from 'ready' (a player in his aggro radius, or a hit): the fight.
  if (st.phase === 'ready') st.phase = 'ground';
  stepPlates(ctx, inst, st);
  // The quench-water is his: it bites once he has landed.
  if (st.phase !== 'idle' && st.phase !== 'emerge') stepQuench(ctx, inst, boss, st);
  if (boss.enraged && !st.enraged) {
    st.enraged = true;
    marker(boss, ctx, KORZUL_ENRAGE, 'Enrage');
  }
  switch (st.phase) {
    case 'idle':
      // The pull: Break Free, the cinematic (korzul_emerge.ts).
      startEmerge(ctx, inst, boss, st);
      return;
    case 'emerge':
      stepEmerge(ctx, inst, boss, st, true);
      return;
    case 'ground':
      stepGround(ctx, inst, boss, st);
      return;
    case 'gale': {
      if (st.plantedAt) holdPlanted(ctx, boss, st.plantedAt);
      if (boss.castingAbility !== KORZUL_WING_GALE)
        startBar(boss, KORZUL_WING_GALE, T.galeCast, null);
      if (!tickBar(boss)) return;
      clearCastIf(boss, KORZUL_WING_GALE);
      landWingGale(ctx, inst, boss);
      marker(boss, ctx, KORZUL_AIRBORNE, 'Airborne');
      holdAloft(boss);
      st.phase = 'takeoff';
      st.pt = 0;
      callBrood(ctx, inst, boss, st);
      return;
    }
    case 'takeoff': {
      holdAloft(boss);
      st.pt += DT;
      if (st.plantedAt) holdPlanted(ctx, boss, st.plantedAt);
      const at = localOf(ctx, inst, boss);
      const floor = floorUnder(ctx, inst, at.x, at.z);
      const k = st.pt / KORZUL_TAKEOFF_SECONDS;
      placeFlier(ctx, inst, boss, at.x, at.z, floor + climbArc(k, T.flightAltitude));
      st.plantedAt = { ...boss.pos };
      if (k < 1) return;
      st.phase = 'air';
      st.flight = freshFlight(ctx, inst, boss, st.flights + 1);
      return;
    }
    case 'air':
      stepAir(ctx, inst, boss, st);
      return;
    case 'drown':
      stepDrown(ctx, inst, boss, st);
      return;
  }
}

/** Korzul out of his fight: held in the ice until a player wakes him (no
 *  pull: korzul_emerge.ts), the waking cinematic playing on, then ready on
 *  the centre for the ordinary pull. A fight that ended (a wipe, an evade)
 *  resets the lake and leaves him ready again, the ice long gone. */
function tickKorzulOutOfFight(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  st: KorzulFightState,
): void {
  if (st.phase === 'emerge' && st.waking) {
    stepEmerge(ctx, inst, boss, st, false);
    return;
  }
  if (st.phase === 'ready') return;
  if (st.phase !== 'idle') resetKorzul(ctx, inst, boss);
  if (storyStep(ctx, inst) >= 8) {
    // Already out of the ice (a wipe after his waking): ready on the centre.
    standReady(ctx, inst, boss, st);
    return;
  }
  holdInIce(boss);
  if (wakeKorzul(ctx, inst, boss)) startEmerge(ctx, inst, boss, st, true);
}

/** Is Korzul on the wing (immune and out of reach)? */
export function korzulAloft(boss: Entity): boolean {
  const st = boss.sanctumFight;
  return st?.kind === 'korzul' && (st.phase === 'takeoff' || st.phase === 'air');
}

/** `/dev sanctum trigger <mechanic>` for an engaged Korzul: the reply line, or
 *  null when `what` is not one of his mechanics. */
export function korzulDevTrigger(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  what: string,
): string | null {
  const st = korzulState(ctx, inst, boss);
  // `crack 5` or `crack5` (the /dev chat line carries one word after trigger).
  const m = /^([a-z]+)\s*(\d*)$/.exec(what.trim().toLowerCase());
  const verb = m?.[1] ?? '';
  const arg = m?.[2] ?? '';
  const plateArg = (): number | null => {
    const n = Number(arg);
    return Number.isInteger(n) && n >= 0 && n < LAKE_PLATES.length ? n : null;
  };
  const ground = (): boolean => {
    // A trigger skips what is left of Break Free: he stands on the centre.
    if (st.phase === 'emerge' || st.phase === 'idle' || st.phase === 'ready')
      skipEmerge(ctx, inst, boss, st);
    if (st.phase !== 'ground') return false;
    clearCastIf(boss, ...GROUND_BARS, KORZUL_GRAVE_INFERNO);
    st.inferno = null;
    st.doused = 0;
    dropAuraById(boss, KORZUL_DOUSED);
    return true;
  };
  switch (verb) {
    case 'breath':
      return ground() && startGraveBreath(ctx, boss, st) ? 'Grave Breath.' : 'Korzul is busy.';
    case 'tail':
      return ground() && startTailSweep(boss, st) ? 'Tail Sweep.' : 'Korzul is busy.';
    case 'inferno':
      return ground() && startGraveInferno(ctx, boss, st) ? 'Grave Inferno.' : 'Korzul is busy.';
    case 'gale':
      return ground() && startWingGale(boss, st) ? 'Wing Gale.' : 'Korzul is busy.';
    case 'flight':
      if (!ground()) return 'Korzul is already aloft.';
      if (st.flights >= T.flightAtHpPct.length) st.flights = T.flightAtHpPct.length - 1;
      return startFlight(ctx, boss, st) ? 'Flight.' : 'Korzul is busy.';
    case 'eye':
    case 'plunge': {
      if (st.phase !== 'air' || !st.flight) return 'Korzul must be in the air (trigger flight).';
      if (st.flight.eyes.length > 0 || st.flight.plunge) return 'An eye is already open.';
      const marked = markWyrmsEye(ctx, inst, boss, st, st.flight);
      if (verb === 'plunge') for (const e of st.flight.eyes) e.remaining = 0;
      return marked.length > 0 ? "Wyrm's Eye." : 'Nobody to mark.';
    }
    case 'descent': {
      if (st.phase !== 'air' || !st.flight) return 'Korzul must be in the air (trigger flight).';
      st.flight.marked = st.flight.rounds;
      st.flight.t = Math.max(st.flight.t, EYE_ROUND * st.flight.rounds + 5);
      return 'Crashing Descent.';
    }
    case 'brood':
      return `Brood from Below: ${callBrood(ctx, inst, boss, st)}.`;
    case 'crack':
    case 'break': {
      const i = plateArg();
      if (i === null) return `Plates: 0 to ${LAKE_PLATES.length - 1}.`;
      burnLakePlate(ctx, inst, st, i);
      if (verb === 'break') burnLakePlate(ctx, inst, st, i);
      return `Plate ${i}: ${st.plates[i].state}.`;
    }
    case 'lastphase':
      if (!ground()) return 'Korzul must be on the ground.';
      st.flights = T.flightAtHpPct.length;
      st.lastPhase = true;
      marker(boss, ctx, KORZUL_SHARD_FLARE, 'Shard Flare');
      nova(ctx, boss, boss, KORZUL_SHARD_FLARE);
      return 'Last phase.';
    case 'enrage':
      boss.enraged = true;
      return 'Enrage.';
    case 'lake':
      resetLake(ctx, inst, st);
      return 'The lake is Sound again.';
    default:
      return null;
  }
}
