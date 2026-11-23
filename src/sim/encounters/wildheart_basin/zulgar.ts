// Zulgar, Voice of the Basin, on the Jaguar Shrine Terrace (docs/design/
// dungeon-rework/wildheart_basin.md section 5.3, reworked 2026-10-13): kite
// the jaguar avatar through the sun glyphs the others light for you, pull the
// spears out between hunts, and outlast the stone jaguar's breath at the end.
//
//   Wildheart Pulse    every 12 s a 1.5 s bar, then 14 yd round him: 170 to 243.
//                      It strikes a Pinned player wherever they stand, for half
//                      as much again.
//   Jaguar Roar        a knockback on his melee hits (the template's).
//   Hunting Spear      between hunts, before every second Pulse (28.5 s apart): a
//                      1.5 s bar at a non-tank, who is Pinned (rooted, bleeding)
//                      until a teammate pulls the spear out (zulgar_spear.ts).
//   Spirit of the Hunt at 70 and 40 percent a 1.5 s bar, then he IS the Jaguar
//                      Avatar for 20 s: he marks one Prey (never the tank while
//                      anyone else stands) and chases it at 110 percent of run
//                      speed. He can be slowed and rooted through the hunt, and
//                      a stun lands for half as long (control_gate.ts). A caught
//                      Prey is Mauled (500 and a 2 s knockdown); he feeds for a
//                      second, then marks a new Prey. A Mauled player is never
//                      the Prey again for 5 s (the knockdown, then a head
//                      start), so knockdowns never chain; with nobody else to
//                      hunt he roars over the kill and waits.
//   The sun glyphs     start DARK. While he hunts, the players who are not the
//                      Prey light them by standing on them; a lit glyph the
//                      avatar crosses makes him Sunstruck (60 percent slower and
//                      taking 25 percent more damage for 3 s) and goes dark
//                      (zulgar_glyphs.ts). A hunt's end puts them all out.
//   The Idol Wakes     at 30 percent (a 2 s bar from a plain phase; a hunt in
//                      flight simply never ends): he is the Jaguar Avatar until
//                      he dies, switching Prey every 8 s (the tank is hunted
//                      like anyone now; he turns on a fresh mark for 1.5 s
//                      before he runs), while the stone jaguar breathes over
//                      one half of the terrace and then the other
//                      (zulgar_idol.ts). It replaces the template enrage.
//   Heroic             Twin Prey: two marks, he switches between them every 6
//                      s (in the final phase a fresh pair every 12 s). Ambush:
//                      when a hunt ends he vanishes for 2 s and pounces on the
//                      farthest player (a 6 yd circle painted 1.5 s before he
//                      lands); the glyphs stay lit until he lands, so a pounce
//                      onto a lit glyph leaves him Sunstruck. The Idol's Breath
//                      snuffs the lit glyphs of its half.
//
// The deed (Never Caught): defeat him without anyone Mauled. Deterministic:
// the Prey and the spear's victim are hashed (pickMarkTargets), the Ambush
// takes the farthest player, the breath's first half is hashed; the only rng
// draws are damage rolls. Every visible state rides existing fields (the
// bars, the Avatar, Prey, Sunstruck, Mauled, Pinned and Vanished auras, the
// glyph, circle, spear and breath bodies and their own bars, `spellfx` with
// the cast ids). The stone jaguar's eyes burn while the Avatar aura holds.

import { emitMobYell } from '../../mob/yells';
import type { InstanceSlot } from '../../sim';
import type { SimContext } from '../../sim_context';
import { addThreat } from '../../threat';
import { DT, dist2d, type Entity, type ZulgarFightState } from '../../types';
import {
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
  ZULGAR_AMBUSH,
  ZULGAR_AVATAR,
  ZULGAR_DEED,
  ZULGAR_HUNTING_SPEAR,
  ZULGAR_IDOL_AWAKE,
  ZULGAR_IDOL_WAKES,
  ZULGAR_LINES,
  ZULGAR_MAULED,
  ZULGAR_PREY,
  ZULGAR_PULSE,
  ZULGAR_SPIRIT_HUNT,
  ZULGAR_SUN_WARY,
  ZULGAR_SUNSTRUCK,
  ZULGAR_SUNSTRUCK_EXPOSED,
  ZULGAR_VANISHED,
} from './ids';
import {
  clearGlyphs,
  darkenGlyphs,
  layGlyphs,
  stepGlyphs,
  strikeIfOnLitGlyph,
} from './zulgar_glyphs';
import { clearIdolBreath, stepIdolBreath, wakeIdolBreath } from './zulgar_idol';
import {
  clearSpears,
  isPinned,
  landHuntingSpear,
  startHuntingSpear,
  stepSpears,
} from './zulgar_spear';
import { auraOf, shrinePlayers } from './zulgar_terrace';

export { shrinePlayers } from './zulgar_terrace';

/** His own bars: each plants him and lands in tickZulgar. */
const OWN_BARS: readonly string[] = [
  ZULGAR_PULSE,
  ZULGAR_SPIRIT_HUNT,
  ZULGAR_HUNTING_SPEAR,
  ZULGAR_IDOL_WAKES,
];

/** An aura that never ages out by itself (the final phase's). */
const FOREVER = 3600;

function freshState(timers: boolean): ZulgarFightState {
  return {
    kind: 'zulgar',
    phase: 'fight',
    pulseTimer: timers ? T.pulseFirst : 99,
    huntsFired: timers ? 0 : T.huntAtHpPct.length,
    idolFired: !timers,
    huntLeft: 0,
    preyIds: [],
    chase: 0,
    switchTimer: T.twinSwitch,
    feedTimer: 0,
    tankId: null,
    respite: [],
    waiting: false,
    glyphs: [],
    sunWary: 0,
    spearTimer: timers ? T.spearFirst : 99,
    spearTargetId: null,
    spears: [],
    markClock: 0,
    idol: null,
    ambushAt: null,
    ambushMarkId: null,
    plantedAt: null,
    mauled: false,
    casts: 0,
  };
}

/** Zulgar's control state outside the hunt: immune to control and snares
 *  (the heroic spawn stamps the same; the hunt lifts both). */
function guardControl(z: Entity, hunting: boolean): void {
  z.ccImmune = !hunting;
  z.slowImmune = !hunting;
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

/** The spirit hunts (a Spirit of the Hunt or the final phase). */
function spiritHunts(st: ZulgarFightState): boolean {
  return st.phase === 'hunt' || st.phase === 'final';
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
    // It runs down the spear: a Pinned player is struck wherever they stand,
    // and harder.
    const pinned = isPinned(p);
    if (!pinned && dist2d(p.pos, z.pos) > T.pulseRadius) continue;
    const roll = mechanicDamage(ctx, z, T.pulseMin, T.pulseMax);
    ctx.dealDamage(
      z,
      p,
      pinned ? Math.round(roll * T.pinPulseMult) : roll,
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

/** Seconds a Prey mark of the final phase stands before he switches (heroic
 *  Twin Prey: one 6 s turn on each of the pair). */
function markSpan(inst: InstanceSlot): number {
  return inst.difficulty === 'heroic' ? T.twinSwitch * 2 : T.finalPreySeconds;
}

/** What a fresh Prey mark shows: the seconds it has left, of how many. */
function markClockOf(inst: InstanceSlot, st: ZulgarFightState): { left: number; span: number } {
  if (st.phase === 'final') return { left: Math.max(DT, st.markClock), span: markSpan(inst) };
  return { left: st.huntLeft, span: T.huntSeconds };
}

function markPrey(
  ctx: SimContext,
  z: Entity,
  p: Entity,
  chased: boolean,
  clock: { left: number; span: number },
): void {
  ctx.applyAura(p, {
    id: ZULGAR_PREY,
    name: 'Prey',
    kind: 'vulnerability',
    remaining: clock.left,
    duration: clock.span,
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

/** Where he hunts: the terrace's players. In the final phase a group that
 *  left the terrace is hunted wherever it stands in the run (the idol's
 *  breath cannot be waited out from the stair). */
function huntField(ctx: SimContext, inst: InstanceSlot, st: ZulgarFightState): Entity[] {
  const terrace = shrinePlayers(ctx, inst);
  if (terrace.length > 0 || st.phase !== 'final') return terrace;
  return claimPlayers(ctx, inst);
}

/** Whom he may mark in slot `slot`: the hunt field's players, never one
 *  marked in another slot, never one in a Mauled respite, and (`avoid`) never
 *  the last Prey while another can be had. Never the tank while anyone else
 *  can be had or is getting up from a maul; with nobody else at all, the tank
 *  is the Prey (the hunt is never skipped by standing off the terrace). The
 *  final phase names no tank: everyone is hunted. */
function preyPool(
  ctx: SimContext,
  inst: InstanceSlot,
  st: ZulgarFightState,
  slot: number,
  avoid: number | null,
): { players: Entity[]; busy: Set<number> } {
  const field = huntField(ctx, inst, st);
  const others = field.filter((p) => p.id !== st.tankId);
  const players = others.length > 0 || st.respite.length > 0 ? others : field;
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
  markPrey(ctx, z, prey, slot === st.chase, markClockOf(inst, st));
  addThreat(z, prey.id, 1);
  return prey;
}

/** He wears the Jaguar Avatar: for a hunt's 20 s, or (`forever`) until he dies. */
function wearAvatar(ctx: SimContext, z: Entity, forever: boolean): void {
  const seconds = forever ? FOREVER : T.huntSeconds;
  ctx.applyAura(z, {
    id: ZULGAR_AVATAR,
    name: 'Jaguar Avatar',
    kind: 'buff_speed',
    remaining: seconds,
    duration: seconds,
    ...(forever ? { permanent: true } : {}),
    value: T.huntSpeedMult,
    sourceId: z.id,
    school: 'nature',
    undispellable: true,
  });
}

/** The bar ends: he becomes the Jaguar Avatar and marks his Prey. `final`:
 *  the idol woke him from a plain phase, and this hunt never ends. */
export function beginHunt(
  ctx: SimContext,
  inst: InstanceSlot,
  z: Entity,
  st: ZulgarFightState,
  final = false,
): number {
  // No Prey is ever rooted when the avatar comes.
  clearSpears(ctx, inst, st);
  st.phase = final ? 'final' : 'hunt';
  st.huntLeft = T.huntSeconds;
  st.markClock = markSpan(inst);
  // The tank he leaves for the hunt (his target until now, else his top
  // threat): never the Prey while anyone else stands. The final phase hunts
  // the tank like anyone.
  st.tankId = final ? null : (tankOf(ctx, z)?.id ?? null);
  st.respite = [];
  st.waiting = false;
  st.preyIds = [];
  st.chase = 0;
  st.switchTimer = T.twinSwitch;
  st.feedTimer = 0;
  guardControl(z, true);
  wearAvatar(ctx, z, final);
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
    const mark = p ? auraOf(p, ZULGAR_PREY) : undefined;
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

/** The hunt ends: the spirit sleeps (heroic: the Ambush begins, and the
 *  glyphs stay lit until he lands). */
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
  darkenGlyphs(ctx, st);
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

/** The final phase's switch: every mark moves to a fresh Prey (never the one
 *  who just carried it while another can be had). */
function switchPrey(ctx: SimContext, inst: InstanceSlot, z: Entity, st: ZulgarFightState): void {
  st.markClock = markSpan(inst);
  st.chase = 0;
  st.switchTimer = T.twinSwitch;
  for (let slot = st.preyIds.length - 1; slot >= 0; slot--) {
    const last = st.preyIds[slot];
    const p = ctx.entities.get(last);
    if (p) dropAuraById(p, ZULGAR_PREY);
    pickPrey(ctx, inst, z, st, slot, last);
  }
  repaintChase(ctx, st);
}

/** One tick of the hunt: switch, feed, chase, catch. */
function stepHunt(ctx: SimContext, inst: InstanceSlot, z: Entity, st: ZulgarFightState): void {
  const previousPreyId = st.preyIds[st.chase] ?? null;
  z.swingTimer = Math.max(z.swingTimer, 0.5);
  if (st.phase === 'hunt') {
    // The idol wakes over a hunt in flight: it simply never ends.
    if (!st.idolFired && z.maxHp > 0 && z.hp / z.maxHp <= T.idolAtHpPct) {
      wakeIdol(ctx, inst, z, st);
    } else {
      st.huntLeft -= DT;
      if (st.huntLeft <= 0) {
        endHunt(ctx, inst, z, st);
        return;
      }
    }
  }
  const final = st.phase === 'final';
  if (final) st.markClock -= DT;
  stepRespite(st);
  // A Prey who left the hunt's field (or the run) is let go.
  const present = huntField(ctx, inst, st);
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
    // nobody left at all, a hunt ends; the final phase only lets go).
    if (waitOutRespite(ctx, z, st)) return;
    if (final) {
      z.forcedTargetId = null;
      z.forcedTargetTimer = 0;
      return;
    }
    endHunt(ctx, inst, z, st);
    return;
  }
  st.waiting = false;
  st.plantedAt = null;
  if (final && st.markClock <= 1e-9) {
    // He turns on his new Prey before he runs: a fresh mark, set on someone
    // who may stand at his feet, is never caught on the tick it lands.
    switchPrey(ctx, inst, z, st);
    const next = st.preyIds.length > 0 ? ctx.entities.get(st.preyIds[0]) : undefined;
    if (next) fixateOn(z, next, FOREVER);
    st.feedTimer = T.finalSwitchPause;
    st.plantedAt = { ...z.pos };
    // Heroic Twin Prey: the turn comes out of the first twin's six seconds.
    st.switchTimer -= T.finalSwitchPause;
    return;
  }
  if (st.preyIds.length > 1) {
    st.switchTimer -= DT;
    if (st.switchTimer <= 0) {
      st.switchTimer = T.twinSwitch;
      st.chase = (st.chase + 1) % st.preyIds.length;
      repaintChase(ctx, st);
    }
  }
  if (st.preyIds.length === 0) return;
  st.chase = Math.min(st.chase, st.preyIds.length - 1);
  const prey = ctx.entities.get(st.preyIds[st.chase]);
  if (!prey) return;
  const changedPrey = previousPreyId !== prey.id;
  fixateOn(z, prey, final ? FOREVER : st.huntLeft);
  // Twin Prey, a death, or a replacement after feeding can put the next
  // chased player at his feet. Give every changed target the same turn
  // window as the final phase's scheduled fresh mark.
  if (changedPrey) {
    st.feedTimer = T.finalSwitchPause;
    st.plantedAt = { ...z.pos };
    if (st.preyIds.length > 1) st.switchTimer -= T.finalSwitchPause;
    return;
  }
  if (ctx.isStunned(z)) return;
  // Never a knockdown on a knockdown: a player still down, or in a respite,
  // is never caught.
  if (ctx.isStunned(prey) || st.respite.some((r) => r.id === prey.id)) return;
  if (dist2d(z.pos, prey.pos) <= T.catchReach) maul(ctx, z, st, prey);
}

// ---- The Idol Wakes -----------------------------------------------------------

/** The 2 s bar that opens the final phase from a plain one. Returns true when
 *  it started. */
export function startIdolWakes(z: Entity, st: ZulgarFightState): boolean {
  if (z.castingAbility !== null || st.phase !== 'fight' || st.idol) return false;
  st.casts++;
  st.idolFired = true;
  st.plantedAt = { ...z.pos };
  startBar(z, ZULGAR_IDOL_WAKES, T.idolWakeCast, null);
  return true;
}

/** The stone jaguar wakes: the final phase. From a plain phase he becomes the
 *  avatar now; a hunt in flight keeps its Prey, its respites and its glyphs
 *  and simply never ends. */
export function wakeIdol(
  ctx: SimContext,
  inst: InstanceSlot,
  z: Entity,
  st: ZulgarFightState,
): void {
  if (st.phase === 'final') return;
  st.idolFired = true;
  st.huntsFired = T.huntAtHpPct.length;
  if (st.phase === 'ambush') cancelAmbush(ctx, inst, z, st);
  clearCastIf(z, ...OWN_BARS);
  st.plantedAt = null;
  ctx.applyAura(z, {
    id: ZULGAR_IDOL_AWAKE,
    name: 'The Idol Wakes',
    // A mark of the phase: it carries no stat.
    kind: 'buff_dr',
    remaining: FOREVER,
    duration: FOREVER,
    permanent: true,
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
    ability: ZULGAR_IDOL_WAKES,
  });
  emitMobYell(ctx, z, ZULGAR_LINES.idolWakes);
  wakeIdolBreath(z, st);
  if (st.phase !== 'hunt') {
    beginHunt(ctx, inst, z, st, true);
    return;
  }
  st.phase = 'final';
  st.tankId = null;
  st.markClock = markSpan(inst);
  wearAvatar(ctx, z, true);
  // The marks he already set run on the final phase's clock from here.
  for (const id of st.preyIds) {
    const p = ctx.entities.get(id);
    const mark = p ? auraOf(p, ZULGAR_PREY) : undefined;
    if (!mark) continue;
    mark.remaining = st.markClock;
    mark.duration = st.markClock;
  }
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

/** The Ambush is called off (the idol wakes over it): he is back, unharmed. */
function cancelAmbush(ctx: SimContext, inst: InstanceSlot, z: Entity, st: ZulgarFightState): void {
  z.damageImmune = false;
  dropAuraById(z, ZULGAR_VANISHED);
  if (st.ambushMarkId !== null) dropEncounterObject(ctx, inst, st.ambushMarkId);
  st.ambushMarkId = null;
  st.ambushAt = null;
  st.phase = 'fight';
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

/** He lands on the marked spot: everyone in the circle is struck. A lit glyph
 *  under his landing leaves him Sunstruck; then the glyphs go dark. */
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
    strikeIfOnLitGlyph(ctx, inst, z, st);
  }
  darkenGlyphs(ctx, st);
  if (st.ambushMarkId !== null) dropEncounterObject(ctx, inst, st.ambushMarkId);
  st.ambushMarkId = null;
  st.ambushAt = null;
  const tank = topThreat(ctx, z);
  if (tank) z.aggroTargetId = tank.id;
  return n;
}

// ---- the fight ------------------------------------------------------------------

/** The pull ended (a kill, an evade, a wipe): the marks, the glyphs, the
 *  spears, the circle, the idol's breath and the avatar go; his immunity
 *  stands again. */
function endZulgarFight(ctx: SimContext, inst: InstanceSlot, z: Entity): void {
  const st = z.wildheartFight?.kind === 'zulgar' ? z.wildheartFight : null;
  if (st) {
    for (const id of st.preyIds) {
      const p = ctx.entities.get(id);
      if (p) dropAuraById(p, ZULGAR_PREY);
    }
    clearSpears(ctx, inst, st);
    clearGlyphs(ctx, inst, st);
    clearIdolBreath(ctx, inst, st);
    if (st.ambushMarkId !== null) dropEncounterObject(ctx, inst, st.ambushMarkId);
  }
  for (const id of [
    ZULGAR_AVATAR,
    ZULGAR_VANISHED,
    ZULGAR_SUNSTRUCK,
    ZULGAR_SUNSTRUCK_EXPOSED,
    ZULGAR_SUN_WARY,
    ZULGAR_IDOL_AWAKE,
  ])
    dropAuraById(z, id);
  z.damageImmune = false;
  z.forcedTargetId = null;
  z.forcedTargetTimer = 0;
  clearCastIf(z, ...OWN_BARS);
  guardControl(z, false);
  z.wildheartFight = undefined;
}

/** A bar of his ended: what it lands. */
function landBar(
  ctx: SimContext,
  inst: InstanceSlot,
  z: Entity,
  st: ZulgarFightState,
  bar: string,
): void {
  if (bar === ZULGAR_PULSE) landPulse(ctx, inst, z);
  else if (bar === ZULGAR_SPIRIT_HUNT) beginHunt(ctx, inst, z, st);
  else if (bar === ZULGAR_HUNTING_SPEAR) landHuntingSpear(ctx, inst, z, st);
  else wakeIdol(ctx, inst, z, st);
}

/** A Hunting Spear is due and the Pulse's clock stands at `spearLeadsPulse`
 *  (the tick or two it crosses that mark). */
function spearSlot(st: ZulgarFightState): boolean {
  return (
    st.spearTimer <= 0 &&
    st.pulseTimer <= T.spearLeadsPulse + 1e-9 &&
    st.pulseTimer > T.spearLeadsPulse - DT * 1.5
  );
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
  stepSpears(ctx, inst, z, st);
  // The glyphs may be lit while the spirit hunts (and through the Ambush that
  // ends a heroic hunt); they strike only the avatar abroad.
  stepGlyphs(ctx, inst, z, st, spiritHunts(st) || st.phase === 'ambush', spiritHunts(st));
  if (st.phase === 'final') stepIdolBreath(ctx, inst, z, st);
  if (spiritHunts(st)) {
    stepHunt(ctx, inst, z, st);
    return;
  }
  if (st.phase === 'ambush') {
    stepAmbush(ctx, inst, z, st);
    return;
  }
  const bar = z.castingAbility;
  if (bar !== null && OWN_BARS.includes(bar)) {
    if (st.plantedAt) holdPlanted(ctx, z, st.plantedAt);
    z.swingTimer = Math.max(z.swingTimer, 0.6);
    // He turns with the one his spear is meant for.
    const aim = bar === ZULGAR_HUNTING_SPEAR && z.castTargetId !== null;
    const target = aim ? ctx.entities.get(z.castTargetId as number) : undefined;
    if (target && !target.dead)
      z.facing = Math.atan2(target.pos.x - z.pos.x, target.pos.z - z.pos.z);
    z.castRemaining = Math.max(0, z.castRemaining - DT);
    if (z.castRemaining > 0) return;
    clearCastIf(z, bar);
    st.plantedAt = null;
    landBar(ctx, inst, z, st, bar);
    return;
  }
  st.pulseTimer -= DT;
  st.spearTimer -= DT;
  if (bar !== null || ctx.isStunned(z)) return;
  const share = z.maxHp > 0 ? z.hp / z.maxHp : 1;
  if (!st.idolFired && share <= T.idolAtHpPct) {
    startIdolWakes(z, st);
    return;
  }
  if (st.huntsFired < T.huntAtHpPct.length && share <= T.huntAtHpPct[st.huntsFired]) {
    st.huntsFired++;
    startSpiritHunt(ctx, z, st);
    return;
  }
  if (spearSlot(st) && startHuntingSpear(ctx, inst, z, st)) return;
  if (st.pulseTimer <= 0) startPulse(z, st);
}
