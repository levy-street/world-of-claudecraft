// The Drowned Temple's lagoon keys (MobTemplate.trashKit.temple): the beasts
// of the lagoon punish a careless group. A sibling of temple_kit.ts, run
// through the Temple extension (temple_extension.ts).
//
//   gaze       Prism Glare (Glimmerscale Lurker): a bar, then everyone within
//              reach who FACES the lurker (it stands in their front arc) is
//              dazzled: their swings whiff and they stumble. Turn your back
//              before the bar ends. Not a kick; a stun breaks it.
//   whirlpool  Spiral Whirlpool (Lagoon Snapper): while it shelters in its
//              shell (trashKit.withdraw) the water round it spins: everyone
//              in the ring is dragged toward it, and the core bites once a
//              second. Walk out (the pull is slower than a run).
//   spark      Arcing Spark (Lagoon Eel): an interruptible bolt that leaps on
//              to the nearest player beside the last one struck. Spread out,
//              or kick it.
//   merge      Swollen Tide (Tidewisp, heroic only): two wisps that touch flow
//              into one, its health pooled, its burst wider and harder (read
//              by temple_kit.ts stepDetonate). Kill them apart.
//
// Zero rng in every pick (players in entity-id order, the spark's leaps by
// distance then id, wisps in roster order); the only draws are a landing
// effect's damage rolls, in roster order.

import { pullToward } from '../../pull_toward';
import type { InstanceSlot } from '../../sim';
import type { SimContext } from '../../sim_context';
import {
  angleTo,
  DT,
  dist2d,
  type Entity,
  normAngle,
  type TrashKitDef,
  type TrashKitState,
} from '../../types';
import { TRASH_WITHDRAW_AURA } from './support';
import { livingInReach, pickHashedTarget } from './targets';
import {
  TEMPLE_ARCING_SPARK,
  TEMPLE_PRISM_DAZZLE,
  TEMPLE_PRISM_GLARE,
  TEMPLE_PRISM_STUMBLE,
  TEMPLE_SPIRAL_WHIRLPOOL,
  TEMPLE_SWOLLEN_TIDE,
} from './temple_cast_ids';

function roll(ctx: SimContext, mob: Entity, min: number, max: number): number {
  return Math.max(1, Math.round(ctx.rng.range(min, max) * (mob.mechanicDamageMult ?? 1)));
}

// ---- Prism Glare ------------------------------------------------------------

/** Does `p` face `from` (it stands inside p's front `halfArcDeg` either side)? */
export function facesToward(p: Entity, from: Entity, halfArcDeg: number): boolean {
  const off = Math.abs(normAngle(angleTo(p.pos, from.pos) - p.facing));
  return off <= (halfArcDeg * Math.PI) / 180 + 1e-9;
}

/** May the gaze start? Only with someone in reach. */
export function gazeReady(mob: Entity, kit: TrashKitDef, players: readonly Entity[]): boolean {
  const def = kit.temple?.gaze;
  return !!def && livingInReach(players, mob.pos, def.range).length > 0;
}

/** The gaze's bar ran out: dazzle everyone in reach who faces the lurker.
 *  Returns how many it caught. */
export function landGaze(
  ctx: SimContext,
  inst: InstanceSlot,
  mob: Entity,
  kit: TrashKitDef,
  players: readonly Entity[],
): number {
  const def = kit.temple?.gaze;
  if (!def) return 0;
  ctx.emit({
    type: 'spellfx',
    sourceId: mob.id,
    targetId: mob.id,
    school: def.school,
    fx: 'nova',
    ability: TEMPLE_PRISM_GLARE,
  });
  const seconds = inst.difficulty === 'heroic' ? def.heroicSeconds : def.seconds;
  let caught = 0;
  for (const p of livingInReach(players, mob.pos, def.range)) {
    if (!facesToward(p, mob, def.halfArcDeg)) continue;
    caught++;
    ctx.dealDamage(
      mob,
      p,
      roll(ctx, mob, def.min, def.max),
      false,
      def.school,
      def.name,
      'hit',
      true,
    );
    if (p.dead) continue;
    ctx.applyAura(p, {
      id: TEMPLE_PRISM_DAZZLE,
      name: def.name,
      kind: 'blind',
      remaining: seconds,
      duration: seconds,
      value: def.miss,
      sourceId: mob.id,
      school: def.school,
    });
    ctx.applyAura(p, {
      id: TEMPLE_PRISM_STUMBLE,
      name: def.name,
      kind: 'slow',
      remaining: seconds,
      duration: seconds,
      value: def.slow,
      sourceId: mob.id,
      school: def.school,
    });
  }
  return caught;
}

// ---- Spiral Whirlpool --------------------------------------------------------

/** Is the mob sheltering in its shell (its withdraw holds)? */
function sheltering(mob: Entity): boolean {
  return mob.auras.some((a) => a.id === TRASH_WITHDRAW_AURA && a.remaining > 0);
}

/**
 * The whirlpool round a sheltering snapper: keep its ring aura up while the
 * shell holds, drag everyone in it toward the shell, and bite the core on
 * each beat. Returns the players the core bit this tick.
 */
export function stepWhirlpool(
  ctx: SimContext,
  inst: InstanceSlot,
  mob: Entity,
  kit: TrashKitDef,
  st: TrashKitState,
  players: readonly Entity[],
): number {
  const def = kit.temple?.whirlpool;
  if (!def) return 0;
  const shell = mob.auras.find((a) => a.id === TRASH_WITHDRAW_AURA);
  if (!shell || !sheltering(mob)) {
    if (st.temple?.whirlTick !== undefined) st.temple.whirlTick = undefined;
    // The shell opened: the water stills at once.
    const ring = mob.auras.find((a) => a.id === TEMPLE_SPIRAL_WHIRLPOOL);
    if (ring) {
      mob.auras = mob.auras.filter((a) => a !== ring);
      ctx.emit({ type: 'aura', targetId: mob.id, name: ring.name, gained: false });
    }
    return 0;
  }
  st.temple ??= {};
  if (st.temple.whirlTick === undefined) {
    // The shell just shut: the water starts to turn.
    st.temple.whirlTick = def.tick;
    ctx.applyAura(mob, {
      id: TEMPLE_SPIRAL_WHIRLPOOL,
      name: def.name,
      // A bare marker (internal_cd): the ring the renderer draws.
      kind: 'internal_cd',
      remaining: shell.remaining,
      duration: shell.remaining,
      value: 1,
      sourceId: mob.id,
      school: def.school,
      undispellable: true,
    });
    ctx.emit({
      type: 'spellfx',
      sourceId: mob.id,
      targetId: mob.id,
      school: def.school,
      fx: 'windup',
      ability: TEMPLE_SPIRAL_WHIRLPOOL,
    });
  }
  const pull = (inst.difficulty === 'heroic' ? def.heroicPull : def.pull) * DT;
  const caught = livingInReach(players, mob.pos, def.radius);
  for (const p of caught) pullToward(ctx, p, mob.pos.x, mob.pos.z, pull, 1.2);
  st.temple.whirlTick -= DT;
  if (st.temple.whirlTick > 1e-9) return 0;
  st.temple.whirlTick = def.tick;
  let bit = 0;
  for (const p of caught) {
    if (p.dead || dist2d(p.pos, mob.pos) > def.core) continue;
    ctx.dealDamage(
      mob,
      p,
      roll(ctx, mob, def.min, def.max),
      false,
      def.school,
      def.name,
      'hit',
      true,
    );
    bit++;
  }
  return bit;
}

// ---- Arcing Spark -------------------------------------------------------------

/** May the spark start? Its first victim: a hashed player in reach. */
export function sparkTarget(
  mob: Entity,
  kit: TrashKitDef,
  st: TrashKitState,
  players: readonly Entity[],
): Entity | null {
  const def = kit.temple?.spark;
  return def ? pickHashedTarget(players, mob.pos, def.range, mob.id, st.casts) : null;
}

/** The spark's chain from its first victim: each leap to the nearest living
 *  player not yet struck within `jump` of the last (ties to the lower id). */
export function sparkChain(
  first: Entity,
  players: readonly Entity[],
  jump: number,
  hits: number,
): Entity[] {
  const chain = [first];
  while (chain.length < hits) {
    const last = chain[chain.length - 1];
    let best: Entity | null = null;
    let bestD = Infinity;
    for (const p of players) {
      if (p.dead || chain.includes(p)) continue;
      const d = dist2d(p.pos, last.pos);
      if (d > jump) continue;
      if (d < bestD - 1e-9 || (Math.abs(d - bestD) <= 1e-9 && best && p.id < best.id)) {
        best = p;
        bestD = d;
      }
    }
    if (!best) break;
    chain.push(best);
  }
  return chain;
}

/** The spark's bar ran out: strike the victim and leap on. Returns the chain. */
export function landSpark(
  ctx: SimContext,
  mob: Entity,
  kit: TrashKitDef,
  targetId: number | null,
  players: readonly Entity[],
): Entity[] {
  const def = kit.temple?.spark;
  const first = targetId !== null ? ctx.entities.get(targetId) : undefined;
  if (!def || !first || first.dead) return [];
  if (dist2d(first.pos, mob.pos) > def.range + 5) return [];
  const chain = sparkChain(first, players, def.jump, def.hits);
  let from: Entity = mob;
  for (const p of chain) {
    ctx.emit({
      type: 'spellfx',
      sourceId: from.id,
      targetId: p.id,
      school: def.school,
      fx: 'heavyBolt',
      ability: TEMPLE_ARCING_SPARK,
    });
    ctx.dealDamage(
      mob,
      p,
      roll(ctx, mob, def.min, def.max),
      false,
      def.school,
      def.name,
      'hit',
      true,
    );
    from = p;
  }
  return chain;
}

// ---- Swollen Tide ---------------------------------------------------------------

/** How many wisps this wisp has drunk (0: none). */
export function swellOf(mob: Entity): number {
  return mob.auras.find((a) => a.id === TEMPLE_SWOLLEN_TIDE)?.value ?? 0;
}

/**
 * Heroic: a wisp that touches another of its kind drinks it (the lower id
 * keeps flowing, the other is gone), pooling their health and stacking the
 * swell. Returns the id of the wisp it drank, or null.
 */
export function stepMerge(
  ctx: SimContext,
  inst: InstanceSlot,
  mob: Entity,
  kit: TrashKitDef,
): number | null {
  const def = kit.temple?.merge;
  if (!def || inst.difficulty !== 'heroic' || mob.dead || mob.hp <= 0) return null;
  const mine = swellOf(mob);
  if (mine >= def.max) return null;
  for (const id of inst.mobIds) {
    if (id <= mob.id) continue;
    const other = ctx.entities.get(id);
    if (!other || other.dead || other.hp <= 0 || other.templateId !== mob.templateId) continue;
    if (!other.inCombat || dist2d(other.pos, mob.pos) > def.reach) continue;
    const swell = Math.min(def.max, mine + swellOf(other) + 1);
    mob.maxHp += other.maxHp;
    mob.hp = Math.min(mob.maxHp, mob.hp + other.hp);
    const prev = mob.auras.find((a) => a.id === TEMPLE_SWOLLEN_TIDE);
    if (prev) prev.value = swell;
    else
      ctx.applyAura(mob, {
        id: TEMPLE_SWOLLEN_TIDE,
        name: def.name,
        // A bare marker (internal_cd): the value is the merge count. Only
        // Call the Tide's summoned wisps ever merge (no wisp is placed in a
        // pack), so the pooled maxHp never outlives the add.
        kind: 'internal_cd',
        remaining: 3600,
        duration: 3600,
        permanent: true,
        value: swell,
        sourceId: mob.id,
        school: 'frost',
        undispellable: true,
      });
    ctx.emit({
      type: 'spellfx',
      sourceId: other.id,
      targetId: mob.id,
      school: 'frost',
      fx: 'nova',
      ability: TEMPLE_SWOLLEN_TIDE,
    });
    // The drunk wisp leaves the world (no corpse, no burst, no owner).
    for (const oid of inst.mobIds) {
      const owner = ctx.entities.get(oid);
      if (owner?.summonedIds.includes(other.id))
        owner.summonedIds = owner.summonedIds.filter((x) => x !== other.id);
    }
    for (const meta of ctx.players.values()) {
      const e = ctx.entities.get(meta.entityId);
      if (e?.targetId === other.id) e.targetId = mob.id;
    }
    other.trashKit = undefined;
    ctx.dropEntity(other.id);
    return other.id;
  }
  return null;
}
