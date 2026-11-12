// The Common Hand (skill event 14, owner card 2026-11-12): every HAND_SECONDS a
// bell rings and every fighter is dealt the same four abilities, drawn from
// across all nine classes: one attack, one control, one defensive and one
// movement ability. The next hand is shown NEXT_HAND_NOTICE seconds before the
// bell. Normal health bars; a killed fighter returns RESPAWN seconds later; the
// first to KILLS_TO_WIN killing blows wins, within EVENT_SECONDS.
//
// Equal for all (owner decision 2026-11-12): between two fighters a dealt
// ability's direct hit removes DIRECT_SHARE of the target's maximum health and
// each periodic tick PERIODIC_SHARE, whatever either player's gear; any other
// damage between fighters (an auto-attack) does nothing; a dealt heal restores
// HEAL_SHARE per application, and a dealt shield holds SHIELD_SHARE. A dealt
// ability costs nothing, keeps its real cast time (shown on the cast bar to
// everyone, broken by moving, a stun or a silence) and its real cooldown, with
// a shared HAND_GCD between them. No winner within EVENT_SECONDS pays nobody
// the win, and everyone who took part their participation honor (owner).
//
// A dealt ability is fired through the effect pipeline (ctx.runEffects) as the
// fighter's own: no known-ability, class, form or resource gate applies,
// because nobody knows these abilities. The deck holds only abilities whose
// every effect is one of the plain categories below, so nothing dealt depends
// on a class resource, a form, combo points, a pet or a position target.

import { isSilenced, isStunned } from '../combat/cc';
import { ABILITIES, CLASSES } from '../content/classes';
import type { ResolvedAbility } from '../resolved_ability';
import { Rng } from '../rng';
import type { SimContext } from '../sim_context';
import { revivePlayerAt } from '../spirit';
import type { AbilityDef, Entity } from '../types';
import { KEEPSAKE_EXCLUDED_IDS, kitFor, verbReady } from './skill_event_kit';
import { SKILL_EVENT_RADIUS } from './skill_event_rules';
import type { ActiveSkillEvent, SkillEventRuleSet, SkillEventStance } from './skill_events';

export const COMMON_HAND_SECONDS = 60;
export const COMMON_HAND_NEXT_NOTICE = 5;
export const COMMON_HAND_RESPAWN = 8;
export const COMMON_HAND_KILLS_TO_WIN = 4;
export const COMMON_HAND_EVENT_SECONDS = 10 * 60;
export const COMMON_HAND_DIRECT_SHARE = 0.2;
export const COMMON_HAND_PERIODIC_SHARE = 0.05;
export const COMMON_HAND_HEAL_SHARE = 0.1;
export const COMMON_HAND_SHIELD_SHARE = 0.3;
export const COMMON_HAND_GCD = 1.5;
/** Melee reach for a dealt ability authored with range 0. */
const MELEE_REACH = 5;
/** Where a fighter returns: a ring this far inside the arena's edge. */
const RESPAWN_RING = SKILL_EVENT_RADIUS - 8;
/** Moving more than this during a cast breaks it. */
const CAST_STILL_TOLERANCE = 0.15;
const HAND_SALT = 0x7c0441d;
const FRONT_CONE_COS = Math.cos(Math.PI / 3);

export type HandCategory = 'attack' | 'control' | 'defensive' | 'movement';
export const HAND_CATEGORIES: readonly HandCategory[] = [
  'attack',
  'control',
  'defensive',
  'movement',
];
/** The four hand buttons, in bar order (the category order above). */
export const COMMON_HAND_VERBS = ['hand_0', 'hand_1', 'hand_2', 'hand_3'] as const;

const ATTACK = new Set([
  'directDamage',
  'weaponStrike',
  'weaponDamage',
  'aoeDamage',
  'chainDamage',
  'dot',
]);
const CONTROL = new Set([
  'stun',
  'root',
  'slow',
  'aoeSlow',
  'aoeRoot',
  'interrupt',
  'incapacitate',
  'polymorph',
  'aoeFear',
]);
const DEFENSIVE = new Set(['heal', 'hot', 'absorb', 'cleanseSelf', 'selfHealPctMax']);
const MOVEMENT = new Set(['charge', 'blinkForward']);
/** selfBuff kinds that defend, and the one that moves you. */
const DEFENSIVE_BUFFS = new Set([
  'buff_armor',
  'buff_dodge',
  'shield_wall',
  'guardian_ward',
  'cast_shield',
  'buff_maxhp_pct',
]);
const MOVEMENT_BUFFS = new Set(['buff_speed']);

/** One ability's place in the deck, or null when it cannot be dealt. Pure. */
export function handCategoryOf(def: AbilityDef): HandCategory | null {
  if (KEEPSAKE_EXCLUDED_IDS.has(def.id)) return null;
  const d = def as AbilityDef & { passive?: boolean; hiddenFromPlayer?: boolean };
  if (d.passive || d.hiddenFromPlayer || d.onNextSwing || d.spendsCombo || d.requiresStealth)
    return null;
  if (d.requiresForm || d.requiresAuraKind || d.requiresDodgeProc || d.requiresShield) return null;
  if (d.channel || d.empowerStages || d.devotionCost || d.ruinCost || d.targetMode) return null;
  if (d.requiresTargetHpBelow || d.executeThreshold || d.requiresOutOfCombat || d.maxCharges)
    return null;
  if (def.effects.length === 0) return null;
  const kinds = new Set<HandCategory>();
  for (const e of def.effects) {
    const kind = (e as { kind?: string }).kind ?? '';
    if (ATTACK.has(e.type)) kinds.add('attack');
    else if (CONTROL.has(e.type)) kinds.add('control');
    else if (DEFENSIVE.has(e.type) || (e.type === 'selfBuff' && DEFENSIVE_BUFFS.has(kind)))
      kinds.add('defensive');
    else if (MOVEMENT.has(e.type) || (e.type === 'selfBuff' && MOVEMENT_BUFFS.has(kind)))
      kinds.add('movement');
    else return null; // anything else needs a class's machinery
  }
  for (const c of HAND_CATEGORIES) if (kinds.has(c)) return c; // an attack that also stuns is an attack
  return null;
}

let deckCache: Readonly<Record<HandCategory, readonly string[]>> | null = null;

/** The whole deck: every class's dealable abilities by category, sorted by id. */
export function commonHandDeck(): Readonly<Record<HandCategory, readonly string[]>> {
  if (deckCache) return deckCache;
  const deck: Record<HandCategory, string[]> = {
    attack: [],
    control: [],
    defensive: [],
    movement: [],
  };
  const seen = new Set<string>();
  for (const cls of Object.keys(CLASSES) as (keyof typeof CLASSES)[]) {
    for (const id of CLASSES[cls].abilities) {
      const def = ABILITIES[id];
      if (!def || seen.has(id)) continue;
      seen.add(id);
      const c = handCategoryOf(def);
      if (c) deck[c].push(id);
    }
  }
  for (const c of HAND_CATEGORIES) deck[c].sort();
  deckCache = deck;
  return deck;
}

/** Hand number `index` of an event: one ability per category, from a private
 *  stream keyed by the event and the hand, so every host deals the same. */
export function commonHandFor(ctx: SimContext, ordinal: number, index: number): string[] {
  const rng = new Rng(
    (ctx.cfg.seed ^
      Math.imul(ordinal + 1, 0x2545f491) ^
      Math.imul(index + 1, 0x9e3779b1) ^
      HAND_SALT) >>>
      0,
  );
  const deck = commonHandDeck();
  return HAND_CATEGORIES.map((c) => deck[c][rng.int(0, deck[c].length - 1)] ?? '');
}

function handIndexAt(ev: ActiveSkillEvent, now: number): number {
  return Math.max(0, Math.floor((now - ev.startsAt) / COMMON_HAND_SECONDS));
}

export interface CommonHandBook {
  /** The hand in play and its number. */
  index: number;
  hand: string[];
  /** Every ability dealt so far (late projectiles and periodic ticks still count). */
  dealt: Set<string>;
  /** A dealt ability being cast, by fighter. */
  casts: Map<
    number,
    { abilityId: string; targetId: number | null; from: number; at: number; x: number; z: number }
  >;
  /** When each fallen fighter returns. */
  respawnAt: Map<number, number>;
  returns: number;
}

export function commonHandBookOf(ctx: SimContext, ev: ActiveSkillEvent): CommonHandBook {
  if (!ev.commonHand) {
    const hand = commonHandFor(ctx, ev.ordinal, 0);
    ev.commonHand = {
      index: 0,
      hand,
      dealt: new Set(hand),
      casts: new Map(),
      respawnAt: new Map(),
      returns: 0,
    };
  }
  return ev.commonHand;
}

/** The hand panel for the readout: the hand in play, the next one in its last
 *  NEXT_NOTICE seconds, and the seconds to the bell. */
export function commonHandInfo(
  ctx: SimContext,
  ev: ActiveSkillEvent,
): { current: string[]; next: string[] | null; bellIn: number } {
  const book = commonHandBookOf(ctx, ev);
  const now = ctx.time;
  const nextBell = ev.startsAt + (handIndexAt(ev, now) + 1) * COMMON_HAND_SECONDS;
  const bellIn = Math.max(0, nextBell - now);
  return {
    current: book.hand,
    next: bellIn <= COMMON_HAND_NEXT_NOTICE ? commonHandFor(ctx, ev.ordinal, book.index + 1) : null,
    bellIn: Math.ceil(bellIn),
  };
}

function fighter(ctx: SimContext, ev: ActiveSkillEvent, pid: number): Entity | null {
  const e = ctx.entities.get(pid);
  if (!e || e.dead || e.kind !== 'player' || !ev.participants.includes(pid)) return null;
  return e;
}

/** Your target if it is a fighter in reach, else the nearest fighter in front. */
function handTarget(
  ctx: SimContext,
  ev: ActiveSkillEvent,
  p: Entity,
  range: number,
): Entity | null {
  const within = (t: Entity) => Math.hypot(t.pos.x - p.pos.x, t.pos.z - p.pos.z) <= range;
  const targeted = p.targetId !== null ? fighter(ctx, ev, p.targetId) : null;
  if (targeted && targeted.id !== p.id && within(targeted)) return targeted;
  const fx = Math.sin(p.facing);
  const fz = Math.cos(p.facing);
  let best: Entity | null = null;
  let bestD = range;
  for (const pid of ev.participants) {
    if (pid === p.id) continue;
    const t = fighter(ctx, ev, pid);
    if (!t) continue;
    const dx = t.pos.x - p.pos.x;
    const dz = t.pos.z - p.pos.z;
    const d = Math.hypot(dx, dz);
    if (d > bestD) continue;
    if (d > 0.01 && (dx * fx + dz * fz) / d < FRONT_CONE_COS) continue;
    best = t;
    bestD = d;
  }
  return best;
}

function needsEnemy(def: AbilityDef): boolean {
  return (
    handCategoryOf(def) !== 'defensive' &&
    def.requiresTarget !== false &&
    def.targetType !== 'friendly'
  );
}

function resolvedFor(def: AbilityDef): ResolvedAbility {
  return {
    def,
    rank: 1,
    cost: 0,
    castTime: def.castTime,
    cooldown: def.cooldown,
    effects: def.effects,
    threatFlat: 0,
    threatMult: 1,
  };
}

/** Fire a dealt ability's effects as the caster's own, the hit marked as a kit verb's. */
function fire(
  ctx: SimContext,
  ev: ActiveSkillEvent,
  p: Entity,
  def: AbilityDef,
  target: Entity | null,
): void {
  const meta = ctx.players.get(p.id);
  if (!meta) return;
  ev.verbHitFrom = p.id;
  try {
    ctx.runEffects(p, meta, needsEnemy(def) ? target : p, resolvedFor(def));
  } finally {
    ev.verbHitFrom = null;
  }
}

function action(ctx: SimContext, ev: ActiveSkillEvent, pid: number, verb: string): boolean {
  const p = fighter(ctx, ev, pid);
  if (!p) return false;
  const slot = (COMMON_HAND_VERBS as readonly string[]).indexOf(verb);
  if (slot < 0) return false;
  const book = commonHandBookOf(ctx, ev);
  const def = ABILITIES[book.hand[slot] ?? ''];
  if (!def) return false;
  const kit = kitFor(ev, pid);
  const now = ctx.time;
  if (book.casts.has(pid) || !verbReady(kit, verb, now)) return false;
  if (!def.offGcd && !verbReady(kit, 'hand_gcd', now)) return false;
  if (isStunned(p) || (def.school !== 'physical' && isSilenced(p))) return false;
  let target: Entity | null = null;
  if (needsEnemy(def)) {
    target = handTarget(ctx, ev, p, def.range > 0 ? def.range : MELEE_REACH);
    if (!target) return false;
  }
  if (!def.offGcd) kit.readyAt.set('hand_gcd', now + COMMON_HAND_GCD);
  kit.readyAt.set(verb, now + Math.max(def.cooldown, def.offGcd ? 0 : COMMON_HAND_GCD));
  if (def.castTime > 0) {
    book.casts.set(pid, {
      abilityId: def.id,
      targetId: target?.id ?? null,
      from: now,
      at: now + def.castTime,
      x: p.pos.x,
      z: p.pos.z,
    });
    return true;
  }
  fire(ctx, ev, p, def, target);
  return true;
}

/** The bell, the casts in progress, and the fallen coming back. */
function everyTick(ctx: SimContext, ev: ActiveSkillEvent): void {
  const book = commonHandBookOf(ctx, ev);
  const now = ctx.time;
  const index = handIndexAt(ev, now);
  if (index !== book.index) {
    // The bell: a new hand for everyone, its buttons ready at once.
    book.index = index;
    book.hand = commonHandFor(ctx, ev.ordinal, index);
    for (const id of book.hand) book.dealt.add(id);
    book.casts.clear();
    for (const kit of ev.kits.values()) for (const v of COMMON_HAND_VERBS) kit.readyAt.delete(v);
  }
  for (const [pid, cast] of book.casts) {
    const p = fighter(ctx, ev, pid);
    const def = ABILITIES[cast.abilityId];
    if (!p || !def) {
      book.casts.delete(pid);
      continue;
    }
    const moved = Math.hypot(p.pos.x - cast.x, p.pos.z - cast.z) > CAST_STILL_TOLERANCE;
    if (
      (moved && !def.castWhileMoving) ||
      isStunned(p) ||
      (def.school !== 'physical' && isSilenced(p))
    ) {
      book.casts.delete(pid);
      continue;
    }
    if (now < cast.at) continue;
    book.casts.delete(pid);
    const target = cast.targetId === null ? null : fighter(ctx, ev, cast.targetId);
    if (needsEnemy(def) && !target) continue; // the target fell or left
    fire(ctx, ev, p, def, target);
  }
  for (const [pid, at] of book.respawnAt) {
    if (now < at) continue;
    book.respawnAt.delete(pid);
    const e = ctx.entities.get(pid);
    if (!e || !ev.participants.includes(pid)) continue;
    const rng = new Rng(
      (ctx.cfg.seed ^
        Math.imul(ev.ordinal + 7, 0x85ebca6b) ^
        Math.imul(++book.returns, 0xc2b2ae35)) >>>
        0,
    );
    const a = rng.range(0, Math.PI * 2);
    revivePlayerAt(
      ctx,
      pid,
      { x: ev.x + Math.cos(a) * RESPAWN_RING, y: e.pos.y, z: ev.z + Math.sin(a) * RESPAWN_RING },
      1,
    );
  }
}

/** A fighter casting a dealt ability shows it, filling, on the cast bar. */
function stanceOf(
  ctx: SimContext,
  ev: ActiveSkillEvent,
  pid: number,
): SkillEventStance | undefined {
  const cast = ev.commonHand?.casts.get(pid);
  if (!cast) return undefined;
  const span = Math.max(0.05, cast.at - cast.from);
  return {
    stance: 'hand',
    fill: Math.min(1, (ctx.time - cast.from) / span),
    castId: cast.abilityId,
  };
}

function onDeath(ctx: SimContext, ev: ActiveSkillEvent, victim: Entity): void {
  if (!ev.participants.includes(victim.id)) return;
  const book = commonHandBookOf(ctx, ev);
  book.casts.delete(victim.id);
  book.respawnAt.set(victim.id, ctx.time + COMMON_HAND_RESPAWN);
}

/** Everyone starts the hand at full health, and the event runs its own length. */
function start(ctx: SimContext, ev: ActiveSkillEvent): void {
  commonHandBookOf(ctx, ev);
  ev.endsAt = Math.min(ev.endsAt, ev.startsAt + COMMON_HAND_EVENT_SECONDS);
  for (const pid of ev.participants) {
    const e = fighter(ctx, ev, pid);
    if (e) e.hp = e.maxHp;
  }
}

/** The equal-damage rule, from the top of dealDamage: the points a hit between
 *  two fighters removes, or null when this rule does not apply. */
export function commonHandHitPoints(
  ev: ActiveSkillEvent,
  target: Entity,
  abilityId: string | null,
  direct: boolean,
): number {
  if (!abilityId || !ev.commonHand?.dealt.has(abilityId)) return 0; // auto-attacks and the rest
  const share = direct ? COMMON_HAND_DIRECT_SHARE : COMMON_HAND_PERIODIC_SHARE;
  return Math.max(1, Math.round(target.maxHp * share));
}

/** The equal-heal rule, from applyHeal: a dealt heal's fixed share. */
export function commonHandHealPoints(
  ev: ActiveSkillEvent,
  target: Entity,
  abilityId: string,
): number | null {
  if (!ev.commonHand?.dealt.has(abilityId)) return null;
  return Math.max(1, Math.round(target.maxHp * COMMON_HAND_HEAL_SHARE));
}

/** Killing blows: yours, the best, and the count that wins. */
function scoreFor(
  ev: ActiveSkillEvent,
  pid: number,
): { yours: number; best: number; toWin: number } {
  let best = 0;
  for (const n of ev.kills.values()) best = Math.max(best, n);
  return { yours: ev.kills.get(pid) ?? 0, best, toWin: COMMON_HAND_KILLS_TO_WIN };
}

/** The equal-shield rule, from the absorb effect: a dealt shield's fixed share. */
export function commonHandShieldPoints(
  ev: ActiveSkillEvent,
  target: Entity,
  abilityId: string,
): number | null {
  if (!ev.commonHand?.dealt.has(abilityId)) return null;
  return Math.max(1, Math.round(target.maxHp * COMMON_HAND_SHIELD_SHARE));
}

export const COMMON_HAND_RULES: SkillEventRuleSet = {
  killsToWin: COMMON_HAND_KILLS_TO_WIN,
  scoreFor,
  start,
  action,
  everyTick,
  stanceOf,
  onDeath,
};
