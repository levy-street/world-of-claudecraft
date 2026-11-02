// Thatchbound: Old Thatchgrin's mind control (Gourdlight Eve phase 5).
//
//   THE CAST   He spreads his fingers and pulls: a 2.5 s cast bar on him, a mark on the
//              ground under each chosen victim for exactly as long, so the whole group
//              sees who is about to be taken. An interrupt that clears his bar fizzles it.
//   THE CURSE  Each victim turns into a little straw scarecrow or a crow (kind
//              'incapacitate': their own control is gone) and for 8 s the game walks
//              them to the nearest friend in the fight and swings at them.
//   THE WAY OUT  An ally's Magic dispel lifts it; so does taking 15% of maximum health
//              in damage from any source (the classic break-on-damage threshold, the
//              aura's breakThreshold, combat/damage.ts). Otherwise it runs out.
//
// Who it takes (pickPuppetVictims): his fighters in reach, never his current target (the
// tank keeps him), and never last cast's victims while anyone else is free. One victim in
// a pair, two from three fighters up, and never everyone: there is always a friend left
// to turn on. Fought alone, he never casts it at all (a lone puppet has nobody to hit),
// and the cast waits for a second fighter instead.
//
// The puppet's swing is HIS damage (source: the boss, named Puppet's Flail), not the
// victim's: no player-versus-player rule, threat, credit or duel state is touched, and
// it rides his mechanic level scale like every other hit of his kit. Low on purpose.
//
// Determinism: the victims are one partial Fisher-Yates over the eligible fighters in id
// order (ctx.rng.int per pick), drawn only when a cast starts; then one damage roll per
// swing that lands, in puppet order. Nothing here runs outside his pull, and he only
// exists while Gourdlight Eve runs, so no shipped trace moves.

import { hasUnbreakableMovementLock } from '../combat/cc';
import {
  THATCHBOUND_AURA_IDS,
  THATCHBOUND_CROW_AURA_ID,
  THATCHBOUND_STRAWLING_AURA_ID,
  THATCHGRIN_KIT,
  THATCHGRIN_PUPPET_ABILITY,
} from '../content/gourdlight_eve_scarecrow';
import { levelScaledMechanicDamage } from '../mob/mechanic_level_scale';
import type { SimContext } from '../sim_context';
import type { Aura, Entity } from '../types';
import { DT, dist2d } from '../types';
import { scarecrowFighters } from './scarecrow_fighters';
import { PUPPET_STRIDE, type ScarecrowState } from './scarecrow_state';

const EPS = 1e-6;
const PUPPET = THATCHGRIN_KIT.puppet;
const THATCHBOUND_IDS: ReadonlySet<string> = new Set(THATCHBOUND_AURA_IDS);

/** How many victims a cast takes from this many fighters (0 when he is fought alone). */
export function puppetVictimCount(fighters: number): number {
  if (fighters < 2) return 0;
  return fighters >= PUPPET.twoFrom ? Math.min(PUPPET.maxVictims, fighters - 1) : 1;
}

/** The fighters a cast may take: in reach, not his current target, alive. Last cast's
 *  victims are spared when enough others are free to fill the cast. Id order. */
export function puppetCandidates(
  boss: Entity,
  fighters: readonly Entity[],
  last: readonly number[],
): Entity[] {
  const want = puppetVictimCount(fighters.length);
  const pool = fighters.filter(
    (p) => !p.dead && p.id !== boss.aggroTargetId && dist2d(p.pos, boss.pos) <= PUPPET.range,
  );
  const fresh = pool.filter((p) => !last.includes(p.id));
  return fresh.length >= want ? fresh : pool;
}

/** The cast's victims, picked by partial shuffle over the candidates (id order). */
export function pickPuppetVictims(
  ctx: SimContext,
  boss: Entity,
  fighters: readonly Entity[],
  last: readonly number[],
): Entity[] {
  const want = puppetVictimCount(fighters.length);
  if (want === 0) return [];
  const pool = puppetCandidates(boss, fighters, last);
  const picks = Math.min(want, pool.length);
  for (let k = 0; k < picks; k++) {
    const j = ctx.rng.int(k, pool.length - 1);
    const tmp = pool[k];
    pool[k] = pool[j];
    pool[j] = tmp;
  }
  return pool.slice(0, picks);
}

/** Is this entity a Thatchbound puppet right now (its aura worn)? */
export function thatchboundAura(e: Entity): Aura | undefined {
  return e.auras.find((a) => a.kind === 'incapacitate' && THATCHBOUND_IDS.has(a.id));
}

/** The curse's aura on one victim: the scarecrow body for the first, the crow for the
 *  second. Breaks after `breakShare` of the victim's maximum health in damage; Magic
 *  (shadow school), so an ally's dispel lifts it. */
export function thatchboundAuraFor(victim: Entity, index: number, sourceId: number): Aura {
  return {
    id: index % 2 === 0 ? THATCHBOUND_STRAWLING_AURA_ID : THATCHBOUND_CROW_AURA_ID,
    name: PUPPET.name,
    kind: 'incapacitate',
    value: 0,
    remaining: PUPPET.seconds,
    duration: PUPPET.seconds,
    sourceId,
    school: PUPPET.school,
    breaksOnDamage: true,
    breakThreshold: Math.max(1, Math.round(victim.maxHp * PUPPET.breakShare)),
  };
}

function endBar(boss: Entity): void {
  boss.castingAbility = null;
  boss.castTotal = 0;
  boss.castRemaining = 0;
  boss.castTargetId = null;
}

/** Start the cast now: the bar on him, a mark under each victim. False (no draw past the
 *  picks) when nobody may be taken. */
export function startThatchbound(ctx: SimContext, boss: Entity, st: ScarecrowState): boolean {
  const kit = st.kit;
  if (!kit || boss.castingAbility !== null) return false;
  const fighters = scarecrowFighters(ctx, boss);
  if (puppetVictimCount(fighters.length) === 0) return false;
  const victims = pickPuppetVictims(ctx, boss, fighters, kit.puppetLast);
  if (victims.length === 0) return false;
  kit.puppetCast = { victims: victims.map((v) => v.id), elapsed: 0 };
  kit.puppetTimer = PUPPET.every;
  kit.spacing = PUPPET.cast + THATCHGRIN_KIT.spacing;
  boss.castingAbility = PUPPET.name;
  boss.castTotal = PUPPET.cast;
  boss.castRemaining = PUPPET.cast;
  boss.castTargetId = victims[0].id;
  boss.channeling = false;
  // his hand clip (the renderer's windup arm; each victim's mark grows its sigil)
  ctx.emit({
    type: 'spellfx',
    sourceId: boss.id,
    targetId: boss.id,
    school: PUPPET.school,
    fx: 'windup',
    ability: THATCHGRIN_PUPPET_ABILITY,
  });
  for (const v of victims) {
    ctx.emit({
      type: 'spellfxAt',
      sourceId: boss.id,
      targetId: v.id,
      x: v.pos.x,
      z: v.pos.z,
      school: PUPPET.school,
      fx: 'runeCircle',
      radius: 1.6,
      duration: PUPPET.cast,
      ability: THATCHGRIN_PUPPET_ABILITY,
    });
  }
  return true;
}

/** The cast lands: each marked victim still in his fight is turned into a puppet. */
function landThatchbound(ctx: SimContext, boss: Entity, st: ScarecrowState): void {
  const kit = st.kit;
  const cast = kit?.puppetCast;
  if (!kit || !cast) return;
  kit.puppetCast = null;
  kit.puppetLast = cast.victims.slice();
  const fighters = scarecrowFighters(ctx, boss);
  cast.victims.forEach((id, index) => {
    const v = fighters.find((p) => p.id === id);
    if (!v) return;
    ctx.applyAura(v, thatchboundAuraFor(v, index, boss.id));
    if (!thatchboundAura(v)) return;
    kit.puppets.push(v.id, -1, PUPPET.swing.first);
    ctx.emit({
      type: 'spellfx',
      sourceId: boss.id,
      targetId: v.id,
      school: PUPPET.school,
      fx: 'nova',
      ability: THATCHGRIN_PUPPET_ABILITY,
    });
  });
}

/** The friend a puppet is turned on: the nearest other fighter, ties by id. */
export function puppetQuarry(
  puppet: Entity,
  fighters: readonly Entity[],
  currentId: number,
): Entity | null {
  const current = fighters.find((p) => p.id === currentId && p.id !== puppet.id && !p.dead);
  if (current) return current;
  let best: Entity | null = null;
  let bestD = Number.POSITIVE_INFINITY;
  for (const p of fighters) {
    if (p.id === puppet.id || p.dead || thatchboundAura(p)) continue;
    const d = dist2d(p.pos, puppet.pos);
    if (d < bestD - EPS) {
      best = p;
      bestD = d;
    }
  }
  return best;
}

/** One tick of the puppets: drop the freed, re-aim, swing at a friend in reach. */
function tickPuppets(ctx: SimContext, boss: Entity, st: ScarecrowState): void {
  const kit = st.kit;
  if (!kit || kit.puppets.length === 0) return;
  const fighters = scarecrowFighters(ctx, boss);
  const kept: number[] = [];
  for (let i = 0; i + PUPPET_STRIDE - 1 < kit.puppets.length; i += PUPPET_STRIDE) {
    const puppet = ctx.entities.get(kit.puppets[i]);
    if (!puppet || puppet.dead || !thatchboundAura(puppet)) continue;
    const quarry = puppetQuarry(puppet, fighters, kit.puppets[i + 1]);
    let swing = Math.max(0, kit.puppets[i + 2] - DT);
    if (quarry && swing <= EPS && dist2d(puppet.pos, quarry.pos) <= PUPPET.swing.reach) {
      swing = PUPPET.swing.every;
      ctx.emit({
        type: 'spellfx',
        sourceId: puppet.id,
        targetId: quarry.id,
        school: 'physical',
        fx: 'tick',
        ability: THATCHGRIN_PUPPET_ABILITY,
      });
      const dmg = ctx.rng.range(PUPPET.swing.min, PUPPET.swing.max);
      strikeAsBoss(ctx, boss, quarry, dmg);
    }
    kept.push(puppet.id, quarry ? quarry.id : -1, swing);
  }
  kit.puppets = kept;
}

function strikeAsBoss(ctx: SimContext, boss: Entity, target: Entity, raw: number): void {
  const dmg = Math.round(raw * (boss.mechanicDamageMult ?? 1));
  ctx.dealDamage(
    boss,
    target,
    levelScaledMechanicDamage(boss, target, dmg),
    false,
    'physical',
    PUPPET.swing.name,
    'hit',
    true,
  );
}

/** Every puppet goes free (the pull ended): the auras come off, the strings snap. */
export function freeAllPuppets(ctx: SimContext, st: ScarecrowState): void {
  const kit = st.kit;
  if (!kit) return;
  for (let i = 0; i + PUPPET_STRIDE - 1 < kit.puppets.length; i += PUPPET_STRIDE) {
    const puppet = ctx.entities.get(kit.puppets[i]);
    if (puppet) freePuppet(ctx, puppet);
  }
  kit.puppets = [];
  kit.puppetCast = null;
}

function freePuppet(ctx: SimContext, puppet: Entity): void {
  for (let i = puppet.auras.length - 1; i >= 0; i--) {
    const a = puppet.auras[i];
    if (a.kind !== 'incapacitate' || !THATCHBOUND_IDS.has(a.id)) continue;
    puppet.auras.splice(i, 1);
    ctx.emit({ type: 'aura', targetId: puppet.id, name: a.name, gained: false });
  }
}

/** One tick of Thatchbound (called by the kit while he is engaged): the cast's clock,
 *  then the puppets. A cleared bar (an interrupt) fizzles the cast. */
export function tickThatchbound(ctx: SimContext, boss: Entity, st: ScarecrowState): void {
  const kit = st.kit;
  if (!kit) return;
  if (kit.puppetTimer > 0) kit.puppetTimer = Math.max(0, kit.puppetTimer - DT);
  const cast = kit.puppetCast;
  if (cast) {
    if (boss.castingAbility !== PUPPET.name) {
      kit.puppetCast = null;
    } else {
      cast.elapsed += DT;
      // the bar runs on this clock: hitting him never delays the curse
      boss.castRemaining = Math.max(0, PUPPET.cast - cast.elapsed);
      if (cast.elapsed >= PUPPET.cast - EPS) {
        endBar(boss);
        landThatchbound(ctx, boss, st);
      }
    }
  }
  tickPuppets(ctx, boss, st);
}

/** Whether a Thatchbound cast is on his bar (the kit holds new telegraphs for it). */
export function thatchboundCasting(st: ScarecrowState): boolean {
  return st.kit?.puppetCast != null;
}

/**
 * The puppet's walk (the player-movement hook, before the fear walk): a Thatchbound
 * victim is walked to the friend it is turned on and stops at swing reach. True when
 * this body is a puppet (the caller skips the player's own movement). Draws no rng.
 */
export function updatePuppetMovement(ctx: SimContext, p: Entity): boolean {
  if (p.kind !== 'player') return false;
  const aura = thatchboundAura(p);
  if (!aura) return false;
  // a stronger hold wins, the fear walk's rule: a root or an unbreakable lock keeps it put
  if (p.auras.some((a) => a.kind === 'root') || hasUnbreakableMovementLock(p, aura)) return true;
  const kit = ctx.seasonal.scarecrow.kit;
  if (!kit) return true;
  for (let i = 0; i + PUPPET_STRIDE - 1 < kit.puppets.length; i += PUPPET_STRIDE) {
    if (kit.puppets[i] !== p.id) continue;
    const quarry = ctx.entities.get(kit.puppets[i + 1]);
    if (!quarry || quarry.dead) return true;
    const d = dist2d(p.pos, quarry.pos);
    p.facing = Math.atan2(quarry.pos.x - p.pos.x, quarry.pos.z - p.pos.z);
    if (d > PUPPET.swing.reach * 0.75) ctx.moveToward(p, quarry.pos, ctx.fleeMoveSpeed(p));
    return true;
  }
  return true;
}
