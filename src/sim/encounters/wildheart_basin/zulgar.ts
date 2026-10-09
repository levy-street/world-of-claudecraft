// Zulgar, Voice of the Basin, on the Jaguar Shrine Terrace (docs/design/
// dungeon-rework/wildheart_basin.md section 5.3): kite the jaguar avatar
// through the sun glyphs (G15 fixate, G10 zones, G2 phases).
//
//   Wildheart Pulse    every 12 s a 1.5 s bar, then 14 yd round him: 170 to 243.
//   Jaguar Roar        a knockback on his melee hits (the template's).
//   Spirit of the Hunt at 70 and 40 percent a 1.5 s bar, then he IS the Jaguar
//                      Avatar for 20 s: he marks one Prey (never the tank while
//                      anyone else stands) and chases it at 110 percent of run
//                      speed. He can be slowed and rooted through the hunt, and
//                      a stun lands for half as long (control_gate.ts). A caught
//                      Prey is Mauled (500 and a 2 s knockdown); he feeds for a
//                      second, then marks a new Prey. A Mauled player is never
//                      the Prey again for 5 s (the knockdown, then a head
//                      start), so knockdowns never chain; with nobody else to
//                      hunt he roars over the kill and waits. Crossing a lit sun glyph
//                      makes him Sunstruck (60 percent slower for 3 s); that
//                      glyph goes dark for 15 s.
//   Enrage             below 30 percent (the template's).
//   Heroic             Twin Prey: two marks, he switches between them every 6
//                      s. Ambush: when a hunt ends he vanishes for 2 s and
//                      pounces on the farthest player (a 6 yd circle painted
//                      1.5 s before he lands).
//
// The deed (Never Caught): defeat him without anyone Mauled. Deterministic:
// the Prey is hashed (pickMarkTargets), the Ambush takes the farthest player;
// the only rng draws are damage rolls. Every visible state rides existing
// fields (the bars, the Avatar, Prey, Sunstruck, Mauled and Vanished auras,
// the glyph and circle objects, `spellfx` with the cast ids). The stone
// jaguar's eyes burn while the Avatar aura holds.

import { SUN_GLYPHS, ZULGAR_SPOT } from '../../content/wildheart_basin_layout';
import { emitMobYell } from '../../mob/yells';
import { combatProfileForMob } from '../../mob_combat';
import type { InstanceSlot } from '../../sim';
import type { SimContext } from '../../sim_context';
import { addThreat } from '../../threat';
import { DT, dist2d, type Entity, type ZulgarFightState } from '../../types';
import {
  arenaPlayers,
  claimPlayers,
  clearCastIf,
  dropAuraById,
  dropEncounterObject,
  farthestPlayer,
  grantClaimDeed,
  holdPlanted,
  localOf,
  mechanicDamage,
  pickHuntMark,
  placeAt,
  spawnBasinObject,
  startBar,
  tankOf,
} from './claim';
import {
  ZULGAR_TUNING as T,
  WILDHEART_AMBUSH_MARK,
  WILDHEART_SUN_GLYPH_DARK,
  WILDHEART_SUN_GLYPH_LIT,
  ZULGAR_AMBUSH,
  ZULGAR_AVATAR,
  ZULGAR_DEED,
  ZULGAR_LINES,
  ZULGAR_MAULED,
  ZULGAR_PREY,
  ZULGAR_PULSE,
  ZULGAR_SPIRIT_HUNT,
  ZULGAR_SUNSTRUCK,
  ZULGAR_VANISHED,
} from './ids';

/** The terrace (the arena and a margin round it). */
const TERRACE_R = 34;

function freshState(timers: boolean): ZulgarFightState {
  return {
    kind: 'zulgar',
    phase: 'fight',
    pulseTimer: timers ? T.pulseFirst : 99,
    huntsFired: timers ? 0 : T.huntAtHpPct.length,
    huntLeft: 0,
    preyIds: [],
    chase: 0,
    switchTimer: T.twinSwitch,
    feedTimer: 0,
    tankId: null,
    respite: [],
    waiting: false,
    glyphDark: SUN_GLYPHS.map(() => 0),
    glyphIds: [],
    ambushAt: null,
    ambushMarkId: null,
    plantedAt: null,
    mauled: false,
    casts: 0,
  };
}

/** The shrine terrace's players, in entity-id order. */
export function shrinePlayers(ctx: SimContext, inst: InstanceSlot): Entity[] {
  return arenaPlayers(ctx, inst, claimPlayers(ctx, inst), ZULGAR_SPOT.x, ZULGAR_SPOT.z, TERRACE_R);
}

/** Zulgar's control state outside the hunt: immune to control and snares
 *  (the heroic spawn stamps the same; the hunt lifts both). */
function guardControl(z: Entity, hunting: boolean): void {
  z.ccImmune = !hunting;
  z.slowImmune = !hunting;
}

/** The six sun glyph objects (lit), laid when the fight starts. */
function layGlyphs(ctx: SimContext, inst: InstanceSlot, st: ZulgarFightState): void {
  st.glyphIds = SUN_GLYPHS.map(
    (g) => spawnBasinObject(ctx, inst, WILDHEART_SUN_GLYPH_LIT, 'Sun Glyph', g.x, g.z, g.r).id,
  );
}

/** Zulgar's fight state, started on his first engaged tick (a dev trigger
 *  starts it with its clocks parked and no threshold left to fire). */
export function zulgarState(
  ctx: SimContext,
  inst: InstanceSlot,
  z: Entity,
  timers = true,
): ZulgarFightState {
  if (z.wildheartFight?.kind === 'zulgar') return z.wildheartFight;
  const st = freshState(timers);
  z.wildheartFight = st;
  guardControl(z, false);
  layGlyphs(ctx, inst, st);
  return st;
}

/** The highest-threat living attacker (whom he turns on after a hunt). */
function topThreat(ctx: SimContext, z: Entity): Entity | null {
  let best: Entity | null = null;
  let bestT = -1;
  for (const [id, t] of z.threat) {
    const e = ctx.entities.get(id);
    if (!e || e.dead || t <= bestT) continue;
    best = e;
    bestT = t;
  }
  return best;
}

// ---- Wildheart Pulse ----------------------------------------------------------

/** Start a Wildheart Pulse. Returns true when it started. */
export function startPulse(z: Entity, st: ZulgarFightState): boolean {
  if (z.castingAbility !== null) return false;
  st.casts++;
  st.pulseTimer = T.pulseEvery;
  st.plantedAt = { ...z.pos };
  startBar(z, ZULGAR_PULSE, T.pulseCast, null);
  return true;
}

function landPulse(ctx: SimContext, inst: InstanceSlot, z: Entity): number {
  ctx.emit({
    type: 'spellfx',
    sourceId: z.id,
    targetId: z.id,
    school: 'nature',
    fx: 'nova',
    ability: ZULGAR_PULSE,
  });
  let n = 0;
  for (const p of claimPlayers(ctx, inst)) {
    if (dist2d(p.pos, z.pos) > T.pulseRadius) continue;
    ctx.dealDamage(
      z,
      p,
      mechanicDamage(ctx, z, T.pulseMin, T.pulseMax),
      false,
      'nature',
      'Wildheart Pulse',
      'hit',
      true,
    );
    n++;
  }
  return n;
}

// ---- Spirit of the Hunt -------------------------------------------------------

/** The spirit takes him: a 1.5 s bar. Returns true when it started. */
export function startSpiritHunt(ctx: SimContext, z: Entity, st: ZulgarFightState): boolean {
  if (z.castingAbility !== null || st.phase !== 'fight') return false;
  st.casts++;
  st.plantedAt = { ...z.pos };
  startBar(z, ZULGAR_SPIRIT_HUNT, T.huntCast, null);
  emitMobYell(ctx, z, ZULGAR_LINES.hunt);
  return true;
}

function markPrey(ctx: SimContext, z: Entity, p: Entity, chased: boolean, left: number): void {
  ctx.applyAura(p, {
    id: ZULGAR_PREY,
    name: 'Prey',
    kind: 'vulnerability',
    remaining: left,
    duration: T.huntSeconds,
    value: 0,
    value2: chased ? 1 : 0,
    sourceId: z.id,
    school: 'nature',
    undispellable: true,
  });
  ctx.emit({
    type: 'spellfx',
    sourceId: z.id,
    targetId: p.id,
    school: 'nature',
    fx: 'windup',
    ability: ZULGAR_PREY,
  });
}

/** Whom he may mark in slot `slot`: the terrace's players, never one marked
 *  in another slot, never one in a Mauled respite, and (`avoid`) never the
 *  last Prey while another can be had. Never the tank while anyone else on
 *  the terrace can be had or is getting up from a maul; with nobody else on
 *  the terrace at all, the tank is the Prey (the hunt is never skipped by
 *  standing off the terrace). */
function preyPool(
  ctx: SimContext,
  inst: InstanceSlot,
  st: ZulgarFightState,
  slot: number,
  avoid: number | null,
): { players: Entity[]; busy: Set<number> } {
  const terrace = shrinePlayers(ctx, inst);
  const others = terrace.filter((p) => p.id !== st.tankId);
  const players = others.length > 0 || st.respite.length > 0 ? others : terrace;
  const busy = new Set(st.preyIds.filter((_, i) => i !== slot));
  for (const r of st.respite) busy.add(r.id);
  if (avoid !== null && players.filter((p) => !busy.has(p.id)).length > 1) busy.add(avoid);
  return { players, busy };
}

/** Someone can be marked in slot `slot` right now. */
function canMark(ctx: SimContext, inst: InstanceSlot, st: ZulgarFightState, slot: number): boolean {
  const { players, busy } = preyPool(ctx, inst, st, slot, null);
  return players.some((p) => !busy.has(p.id));
}

/** Mark a fresh Prey in slot `slot` (see preyPool). Returns it, or null (the
 *  slot is freed). */
function pickPrey(
  ctx: SimContext,
  inst: InstanceSlot,
  z: Entity,
  st: ZulgarFightState,
  slot: number,
  avoid: number | null,
): Entity | null {
  st.casts++;
  const { players, busy } = preyPool(ctx, inst, st, slot, avoid);
  const prey = pickHuntMark(z, players, st.casts, busy);
  if (!prey) {
    st.preyIds.splice(slot, 1);
    return null;
  }
  st.preyIds[slot] = prey.id;
  markPrey(ctx, z, prey, slot === st.chase, st.huntLeft);
  addThreat(z, prey.id, 1);
  return prey;
}

/** The bar ends: he becomes the Jaguar Avatar and marks his Prey. */
export function beginHunt(
  ctx: SimContext,
  inst: InstanceSlot,
  z: Entity,
  st: ZulgarFightState,
): number {
  st.phase = 'hunt';
  st.huntLeft = T.huntSeconds;
  // The tank he leaves for the hunt (his target until now, else his top
  // threat): never the Prey while anyone else stands.
  st.tankId = tankOf(ctx, z)?.id ?? null;
  st.respite = [];
  st.waiting = false;
  st.preyIds = [];
  st.chase = 0;
  st.switchTimer = T.twinSwitch;
  st.feedTimer = 0;
  guardControl(z, true);
  ctx.applyAura(z, {
    id: ZULGAR_AVATAR,
    name: 'Jaguar Avatar',
    kind: 'buff_speed',
    remaining: T.huntSeconds,
    duration: T.huntSeconds,
    value: T.huntSpeedMult,
    sourceId: z.id,
    school: 'nature',
    undispellable: true,
  });
  ctx.emit({
    type: 'spellfx',
    sourceId: z.id,
    targetId: z.id,
    school: 'nature',
    fx: 'nova',
    ability: ZULGAR_AVATAR,
  });
  const count = inst.difficulty === 'heroic' ? 2 : 1;
  for (let slot = 0; slot < count; slot++) pickPrey(ctx, inst, z, st, slot, null);
  const prey = st.preyIds.length > 0 ? ctx.entities.get(st.preyIds[0]) : undefined;
  if (prey) fixateOn(z, prey, st.huntLeft);
  return st.preyIds.length;
}

/** He runs at the prey (held against a taunt each tick). */
function fixateOn(z: Entity, prey: Entity, left: number): void {
  z.forcedTargetId = prey.id;
  z.forcedTargetTimer = Math.max(left, DT * 2);
  z.aggroTargetId = prey.id;
  if (z.aiState === 'attack' || z.aiState === 'idle') z.aiState = 'chase';
}

/** Repaint which Prey he chases (heroic Twin Prey: value2 on the chased). */
function repaintChase(ctx: SimContext, st: ZulgarFightState): void {
  st.preyIds.forEach((id, i) => {
    const p = ctx.entities.get(id);
    const mark = p?.auras.find((a) => a.id === ZULGAR_PREY);
    if (mark) mark.value2 = i === st.chase ? 1 : 0;
  });
}

/** A caught Prey is Mauled: 500 and a 2 s knockdown; he feeds, then hunts on. */
function maul(ctx: SimContext, z: Entity, st: ZulgarFightState, prey: Entity): void {
  st.mauled = true;
  st.feedTimer = T.maulPause;
  // The respite: never his Prey again until the knockdown and a head start
  // have run out.
  st.respite = st.respite.filter((r) => r.id !== prey.id);
  st.respite.push({ id: prey.id, left: T.preyRespite });
  st.plantedAt = { ...z.pos };
  dropAuraById(prey, ZULGAR_PREY);
  ctx.emit({
    type: 'spellfx',
    sourceId: z.id,
    targetId: prey.id,
    school: 'physical',
    fx: 'nova',
    ability: ZULGAR_MAULED,
  });
  const amount = Math.max(1, Math.round(T.maulDamage * (z.mechanicDamageMult ?? 1)));
  ctx.dealDamage(z, prey, amount, false, 'physical', 'Mauled', 'hit', true);
  if (prey.dead) return;
  ctx.applyAura(prey, {
    id: ZULGAR_MAULED,
    name: 'Mauled',
    kind: 'stun',
    remaining: T.maulStun,
    duration: T.maulStun,
    value: 0,
    sourceId: z.id,
    school: 'physical',
  });
}

/** Sunstruck: crossing a lit glyph slows the avatar; the glyph goes dark. */
function stepGlyphs(
  ctx: SimContext,
  inst: InstanceSlot,
  z: Entity,
  st: ZulgarFightState,
  hunting: boolean,
): void {
  const at = localOf(ctx, inst, z);
  SUN_GLYPHS.forEach((g, i) => {
    const obj = st.glyphIds[i] !== undefined ? ctx.entities.get(st.glyphIds[i]) : undefined;
    if (st.glyphDark[i] > 0) {
      st.glyphDark[i] = Math.max(0, st.glyphDark[i] - DT);
      if (st.glyphDark[i] <= 0 && obj) obj.templateId = WILDHEART_SUN_GLYPH_LIT;
      return;
    }
    if (!hunting || Math.hypot(at.x - g.x, at.z - g.z) > g.r + 0.5) return;
    st.glyphDark[i] = T.glyphDarkSeconds;
    if (obj) obj.templateId = WILDHEART_SUN_GLYPH_DARK;
    ctx.applyAura(z, {
      id: ZULGAR_SUNSTRUCK,
      name: 'Sunstruck',
      kind: 'slow',
      remaining: T.sunstruckSeconds,
      duration: T.sunstruckSeconds,
      value: 1 - T.sunstruckSlow,
      sourceId: z.id,
      school: 'holy',
    });
    ctx.emit({
      type: 'spellfx',
      sourceId: z.id,
      targetId: obj?.id ?? z.id,
      school: 'holy',
      fx: 'nova',
      ability: ZULGAR_SUNSTRUCK,
    });
  });
}

/** The hunt ends: the spirit sleeps (heroic: the Ambush begins). */
export function endHunt(
  ctx: SimContext,
  inst: InstanceSlot,
  z: Entity,
  st: ZulgarFightState,
): void {
  for (const id of st.preyIds) {
    const p = ctx.entities.get(id);
    if (p) dropAuraById(p, ZULGAR_PREY);
  }
  st.preyIds = [];
  st.respite = [];
  st.waiting = false;
  dropAuraById(z, ZULGAR_AVATAR);
  z.forcedTargetId = null;
  z.forcedTargetTimer = 0;
  guardControl(z, false);
  st.feedTimer = 0;
  if (inst.difficulty === 'heroic') {
    startAmbush(ctx, z, st);
    return;
  }
  st.phase = 'fight';
  emitMobYell(ctx, z, ZULGAR_LINES.huntEnds);
  const tank = topThreat(ctx, z);
  if (tank) z.aggroTargetId = tank.id;
}

/** Count the Mauled respites down (a finished one frees that player). */
function stepRespite(st: ZulgarFightState): void {
  for (const r of st.respite) r.left -= DT;
  st.respite = st.respite.filter((r) => r.left > 1e-9);
}

/** Nobody can be hunted yet, but a Mauled player's respite still runs (alone,
 *  or everyone else marked or getting up): he roars over the kill once and
 *  holds his ground until someone can be had. True while he waits; false
 *  when the hunt has nobody left at all. */
function waitOutRespite(ctx: SimContext, z: Entity, st: ZulgarFightState): boolean {
  if (st.respite.length === 0) return false;
  // Planted and his swings held (stepHunt): his aggro target stays as the AI
  // keeps it, so a stun while he waits never parks the encounter.
  z.forcedTargetId = null;
  z.forcedTargetTimer = 0;
  if (!st.plantedAt) st.plantedAt = { ...z.pos };
  holdPlanted(ctx, z, st.plantedAt);
  if (!st.waiting) {
    st.waiting = true;
    ctx.emit({
      type: 'spellfx',
      sourceId: z.id,
      targetId: z.id,
      school: 'nature',
      fx: 'nova',
      ability: ZULGAR_AVATAR,
    });
  }
  return true;
}

/** One tick of the hunt: switch, feed, chase, catch. */
function stepHunt(ctx: SimContext, inst: InstanceSlot, z: Entity, st: ZulgarFightState): void {
  z.swingTimer = Math.max(z.swingTimer, 0.5);
  st.huntLeft -= DT;
  if (st.huntLeft <= 0) {
    endHunt(ctx, inst, z, st);
    return;
  }
  stepRespite(st);
  // A Prey who left the shrine terrace (or the run) is let go.
  const present = shrinePlayers(ctx, inst);
  for (let i = st.preyIds.length - 1; i >= 0; i--) {
    const p = ctx.entities.get(st.preyIds[i]);
    if (p && !p.dead && present.includes(p)) continue;
    // Dead, gone, or out of the run: a fresh Prey takes the slot.
    if (p) dropAuraById(p, ZULGAR_PREY);
    pickPrey(ctx, inst, z, st, i, null);
  }
  if (st.feedTimer > 0) {
    if (st.plantedAt) holdPlanted(ctx, z, st.plantedAt);
    st.feedTimer -= DT;
    if (st.feedTimer > 0) return;
    // The fed-on Prey's slot takes a fresh one (never the one just Mauled):
    // found by id, since a slot may have shifted while he fed.
    const fed = st.respite[st.respite.length - 1]?.id ?? null;
    const slot = fed !== null ? st.preyIds.indexOf(fed) : -1;
    if (slot >= 0) pickPrey(ctx, inst, z, st, slot, fed);
    repaintChase(ctx, st);
  }
  // A slot freed while nobody could be had (heroic Twin Prey keeps two)
  // fills again as soon as someone can.
  const want = inst.difficulty === 'heroic' ? 2 : 1;
  while (st.preyIds.length < want && canMark(ctx, inst, st, st.preyIds.length)) {
    if (!pickPrey(ctx, inst, z, st, st.preyIds.length, null)) break;
    repaintChase(ctx, st);
  }
  if (st.preyIds.length === 0) {
    // Nobody marked and nobody to mark: he waits out a respite (or, with
    // nobody left at all, the hunt ends).
    if (waitOutRespite(ctx, z, st)) return;
    endHunt(ctx, inst, z, st);
    return;
  }
  st.waiting = false;
  st.plantedAt = null;
  if (st.preyIds.length > 1) {
    st.switchTimer -= DT;
    if (st.switchTimer <= 0) {
      st.switchTimer = T.twinSwitch;
      st.chase = (st.chase + 1) % st.preyIds.length;
      repaintChase(ctx, st);
    }
  }
  st.chase = Math.min(st.chase, st.preyIds.length - 1);
  const prey = ctx.entities.get(st.preyIds[st.chase]);
  if (!prey) return;
  fixateOn(z, prey, st.huntLeft);
  if (ctx.isStunned(z)) return;
  // Never a knockdown on a knockdown: a player still down, or in a respite,
  // is never caught.
  if (ctx.isStunned(prey) || st.respite.some((r) => r.id === prey.id)) return;
  const reach = combatProfileForMob(z.templateId, z.scale).meleeRange + T.catchReach;
  if (dist2d(z.pos, prey.pos) <= reach) maul(ctx, z, st, prey);
}

// ---- Heroic Ambush ------------------------------------------------------------

/** He vanishes (immune, hidden) for the Ambush. */
export function startAmbush(ctx: SimContext, z: Entity, st: ZulgarFightState): void {
  st.phase = 'ambush';
  st.huntLeft = T.ambushSeconds;
  st.ambushAt = null;
  st.plantedAt = { ...z.pos };
  z.damageImmune = true;
  ctx.applyAura(z, {
    id: ZULGAR_VANISHED,
    name: 'Vanished',
    kind: 'buff_dr',
    remaining: T.ambushSeconds,
    duration: T.ambushSeconds,
    value: 0,
    sourceId: z.id,
    school: 'nature',
    undispellable: true,
  });
  ctx.emit({
    type: 'spellfx',
    sourceId: z.id,
    targetId: z.id,
    school: 'nature',
    fx: 'nova',
    ability: ZULGAR_VANISHED,
  });
  emitMobYell(ctx, z, ZULGAR_LINES.ambush);
}

function stepAmbush(ctx: SimContext, inst: InstanceSlot, z: Entity, st: ZulgarFightState): void {
  z.swingTimer = Math.max(z.swingTimer, 0.5);
  if (st.plantedAt) holdPlanted(ctx, z, st.plantedAt);
  st.huntLeft -= DT;
  if (st.ambushAt === null && st.huntLeft <= T.ambushWarning + 1e-9) {
    const victim = farthestPlayer(shrinePlayers(ctx, inst), z);
    if (victim) {
      st.ambushAt = localOf(ctx, inst, victim);
      st.ambushMarkId = spawnBasinObject(
        ctx,
        inst,
        WILDHEART_AMBUSH_MARK,
        'Ambush',
        st.ambushAt.x,
        st.ambushAt.z,
        T.ambushRadius,
      ).id;
    }
  }
  if (st.huntLeft > 0) return;
  landAmbush(ctx, inst, z, st);
}

/** He lands on the marked spot: everyone in the circle is struck. */
function landAmbush(ctx: SimContext, inst: InstanceSlot, z: Entity, st: ZulgarFightState): number {
  z.damageImmune = false;
  dropAuraById(z, ZULGAR_VANISHED);
  st.phase = 'fight';
  st.plantedAt = null;
  let n = 0;
  if (st.ambushAt) {
    const o = ctx.instanceOriginOf(inst);
    placeAt(ctx, z, o.x + st.ambushAt.x, o.z + st.ambushAt.z);
    ctx.emit({
      type: 'spellfx',
      sourceId: z.id,
      targetId: z.id,
      school: 'physical',
      fx: 'nova',
      ability: ZULGAR_AMBUSH,
    });
    for (const p of claimPlayers(ctx, inst)) {
      if (Math.hypot(p.pos.x - o.x - st.ambushAt.x, p.pos.z - o.z - st.ambushAt.z) > T.ambushRadius)
        continue;
      ctx.dealDamage(
        z,
        p,
        mechanicDamage(ctx, z, T.ambushMin, T.ambushMax),
        false,
        'physical',
        'Ambush',
        'hit',
        true,
      );
      n++;
    }
  }
  if (st.ambushMarkId !== null) dropEncounterObject(ctx, inst, st.ambushMarkId);
  st.ambushMarkId = null;
  st.ambushAt = null;
  const tank = topThreat(ctx, z);
  if (tank) z.aggroTargetId = tank.id;
  return n;
}

// ---- the fight ------------------------------------------------------------------

/** The pull ended (a kill, an evade, a wipe): the marks, the glyphs, the
 *  circle and the avatar go; his immunity stands again. */
function endZulgarFight(ctx: SimContext, inst: InstanceSlot, z: Entity): void {
  const st = z.wildheartFight?.kind === 'zulgar' ? z.wildheartFight : null;
  if (st) {
    for (const id of st.preyIds) {
      const p = ctx.entities.get(id);
      if (p) dropAuraById(p, ZULGAR_PREY);
    }
    for (const id of st.glyphIds) dropEncounterObject(ctx, inst, id);
    if (st.ambushMarkId !== null) dropEncounterObject(ctx, inst, st.ambushMarkId);
  }
  dropAuraById(z, ZULGAR_AVATAR);
  dropAuraById(z, ZULGAR_VANISHED);
  z.damageImmune = false;
  z.forcedTargetId = null;
  z.forcedTargetTimer = 0;
  clearCastIf(z, ZULGAR_PULSE, ZULGAR_SPIRIT_HUNT);
  guardControl(z, false);
  z.wildheartFight = undefined;
}

/** One tick of Zulgar (after the mob AI). */
export function tickZulgar(ctx: SimContext, inst: InstanceSlot, z: Entity, engaged: boolean): void {
  const live = z.wildheartFight?.kind === 'zulgar' ? z.wildheartFight : null;
  if (z.dead) {
    if (live) {
      if (!live.mauled) grantClaimDeed(ctx, inst, ZULGAR_DEED);
      endZulgarFight(ctx, inst, z);
    }
    return;
  }
  if (!engaged) {
    if (live) endZulgarFight(ctx, inst, z);
    else guardControl(z, false);
    return;
  }
  const st = zulgarState(ctx, inst, z);
  stepGlyphs(ctx, inst, z, st, st.phase === 'hunt');
  if (st.phase === 'hunt') {
    stepHunt(ctx, inst, z, st);
    return;
  }
  if (st.phase === 'ambush') {
    stepAmbush(ctx, inst, z, st);
    return;
  }
  const bar = z.castingAbility;
  if (bar === ZULGAR_PULSE || bar === ZULGAR_SPIRIT_HUNT) {
    if (st.plantedAt) holdPlanted(ctx, z, st.plantedAt);
    z.swingTimer = Math.max(z.swingTimer, 0.6);
    z.castRemaining = Math.max(0, z.castRemaining - DT);
    if (z.castRemaining > 0) return;
    clearCastIf(z, bar);
    st.plantedAt = null;
    if (bar === ZULGAR_PULSE) landPulse(ctx, inst, z);
    else beginHunt(ctx, inst, z, st);
    return;
  }
  st.pulseTimer -= DT;
  if (bar !== null || ctx.isStunned(z)) return;
  const share = z.maxHp > 0 ? z.hp / z.maxHp : 1;
  if (st.huntsFired < T.huntAtHpPct.length && share <= T.huntAtHpPct[st.huntsFired]) {
    st.huntsFired++;
    startSpiritHunt(ctx, z, st);
    return;
  }
  if (st.pulseTimer <= 0) startPulse(z, st);
}
