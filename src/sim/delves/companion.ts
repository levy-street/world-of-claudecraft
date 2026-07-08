// I2c delve companion AI: Acolyte Tessa's per-tick brain, MOVED VERBATIM from
// Sim.updateDelveCompanion behind the SimContext seam (move + import, not a rewrite).
//
// She runs INSIDE the shared updateMob mob-AI pass, in entity-iteration order,
// dispatched BEFORE the hunter/warlock pet branch (the mob-AI coordinator calls
// `ctx.updateDelveCompanion(mob)` for an owned, non-stunned companion mob). Her
// rng-drawing callees (mobSwing -> dealDamage crit/hit rolls) therefore fire at the
// global stream position set by where she sits in `entities.values()` order, so the
// statement + branch + draw order here is load-bearing and preserved exactly.
//
// Lifecycle (spawn/despawn/identity) and the vendor upgrade/read-API stay on Sim;
// this slice is the per-tick brain only. `mobSwing`/`moveToward` are shared entry
// points consumed via the seam (still defined on Sim); `maybeCompanionBark` stays on
// Sim (foreign quest/delve callers). The heal is a DIRECT hp mutation + heal/spellfx
// emit (no aura). `src/sim`-pure: no DOM/Three/Math.random.

import type { SimContext } from '../sim_context';
import { addThreat } from '../threat';
import {
  DELVE_COMPANION_HEAL_INTERVAL,
  DELVE_COMPANION_MAX_RANK,
  type DelveCompanionRole,
  DT,
  dist2d,
  type Entity,
  MELEE_RANGE,
  PET_TELEPORT_DISTANCE,
  steadyAngleTo,
} from '../types';

const DELVE_COMPANION_HEAL_RANGE = 22;
const DELVE_COMPANION_FOLLOW = 4;
// Tessa heals a PERCENT of the target's max HP each tick, indexed by rank (1-3), so
// her output stays relevant as player HP grows, the old flat `8 + rank*4` decayed to
// noise by level 9. Tuned (combat spec) so L7 Normal is sustainable, L7 Heroic is not
// savable by Tessa alone, and L9 Heroic is sustainable from rank 2.
const DELVE_COMPANION_HEAL_PCT = [0, 0.06, 0.08, 0.1];
const DELVE_COMPANION_TAUNT_RANGE = 8;

interface DelveCompanionRoleProfile {
  healthMult: number;
  armorMult: number;
  damageMult: number;
  threatMultiplier: number;
  healMultiplier: number;
  taunt: boolean;
  tauntInterval: number;
}

const DELVE_COMPANION_ROLE_PROFILES: Record<DelveCompanionRole, DelveCompanionRoleProfile> = {
  healer: {
    healthMult: 1,
    armorMult: 1,
    damageMult: 1,
    threatMultiplier: 1,
    healMultiplier: 1,
    taunt: false,
    tauntInterval: 0,
  },
  tank: {
    healthMult: 1.35,
    armorMult: 1.4,
    damageMult: 0.85,
    threatMultiplier: 1.5,
    healMultiplier: 0.5,
    taunt: true,
    tauntInterval: 8,
  },
  damage: {
    healthMult: 0.9,
    armorMult: 0.85,
    damageMult: 1.45,
    threatMultiplier: 0.85,
    healMultiplier: 0,
    taunt: false,
    tauntInterval: 0,
  },
};

export function normalizeDelveCompanionRole(
  role: DelveCompanionRole | string | null | undefined,
): DelveCompanionRole {
  return role === 'tank' || role === 'damage' || role === 'healer' ? role : 'healer';
}

export function applyDelveCompanionRoleStats(
  companion: Entity,
  role: DelveCompanionRole | string | null | undefined,
): DelveCompanionRole {
  const normalized = normalizeDelveCompanionRole(role);
  const profile = DELVE_COMPANION_ROLE_PROFILES[normalized];
  companion.maxHp = Math.max(1, Math.round(companion.maxHp * profile.healthMult));
  companion.hp = companion.maxHp;
  companion.stats.armor = Math.max(0, Math.round(companion.stats.armor * profile.armorMult));
  companion.weapon = {
    ...companion.weapon,
    min: Math.max(1, Math.round(companion.weapon.min * profile.damageMult)),
    max: Math.max(1, Math.round(companion.weapon.max * profile.damageMult)),
  };
  companion.companionTauntTimer = profile.taunt ? 0 : undefined;
  return normalized;
}

export function updateDelveCompanion(ctx: SimContext, companion: Entity): void {
  const owner = companion.ownerId !== null ? ctx.entities.get(companion.ownerId) : null;
  if (owner?.kind !== 'player') {
    ctx.dropEntity(companion.id);
    return;
  }
  const run = ctx.delveRunForPlayer(owner.id);
  if (!run?.companion || run.companion.entityId !== companion.id) {
    ctx.dropEntity(companion.id);
    return;
  }
  // Rank 3 boon (the board's "revives a fallen ally once per run"): the owner,
  // or a dead party member in heal range, comes back at half health, mirroring
  // the in-delve respawn refill. Checked before the dead-owner despawn so a
  // solo owner's death can be caught. No rng draws; deterministic pick order
  // (owner first, then party-member order).
  const companionRank =
    ctx.players.get(owner.id)?.companionUpgrades[run.companion.companionId] ?? 1;
  if (companionRank >= DELVE_COMPANION_MAX_RANK && !run.companionReviveUsed) {
    let fallen: Entity | null = owner.dead ? owner : null;
    if (!fallen && run.partyKey) {
      for (const pid of ctx.partyMembersForKey(run.partyKey)) {
        const ally = ctx.entities.get(pid);
        if (ally?.dead && dist2d(companion.pos, ally.pos) <= DELVE_COMPANION_HEAL_RANGE) {
          fallen = ally;
          break;
        }
      }
    }
    if (fallen) {
      // Lives on the run (not the re-minted companion state) so leaving and
      // re-entering mid-run cannot recharge the boon.
      run.companionReviveUsed = true;
      fallen.dead = false;
      fallen.hp = Math.max(1, Math.round(fallen.maxHp * 0.5));
      if (fallen.resourceType === 'mana')
        fallen.resource = Math.max(fallen.resource, Math.round(fallen.maxResource * 0.5));
      ctx.emit({ type: 'heal', targetId: fallen.id, amount: fallen.hp });
      ctx.emit({
        type: 'spellfx',
        sourceId: companion.id,
        targetId: fallen.id,
        school: 'holy',
        fx: 'tick',
      });
      ctx.maybeCompanionBark(run, owner.id, 'ally_revive');
    }
  }
  if (owner.dead) {
    ctx.despawnDelveCompanion(run);
    return;
  }
  if (owner.inCombat) ctx.maybeCompanionBark(run, owner.id, 'combat_start');
  if (owner.hp / Math.max(1, owner.maxHp) < 0.3) ctx.maybeCompanionBark(run, owner.id, 'low_hp');

  const role = normalizeDelveCompanionRole(run.companion.role);
  const profile = DELVE_COMPANION_ROLE_PROFILES[role];
  companion.swingTimer = (companion.swingTimer ?? 0) - DT;
  let combatTarget: Entity | null = null;
  if (owner.targetId !== null) {
    const t = ctx.entities.get(owner.targetId);
    if (t && !t.dead && ctx.isHostileTo(companion, t)) combatTarget = t;
  }
  if (!combatTarget) {
    let best: Entity | null = null;
    let bestD = 40;
    for (const m of ctx.entities.values()) {
      if (m.kind !== 'mob' || m.dead || !ctx.isHostileTo(companion, m)) continue;
      const engagingOwner = m.aggroTargetId === owner.id;
      const ownerOffense =
        owner.targetId === m.id && (owner.autoAttack || owner.inCombat || m.threat.has(owner.id));
      if (!engagingOwner && !ownerOffense) continue;
      const d = dist2d(companion.pos, m.pos);
      if (d < bestD) {
        best = m;
        bestD = d;
      }
    }
    combatTarget = best;
  }
  if (combatTarget) {
    companion.inCombat = true;
    if (profile.taunt && combatTarget.kind === 'mob') {
      companion.companionTauntTimer = Math.max(0, (companion.companionTauntTimer ?? 0) - DT);
      if (
        companion.companionTauntTimer <= 0 &&
        dist2d(companion.pos, combatTarget.pos) <= DELVE_COMPANION_TAUNT_RANGE
      ) {
        ctx.applyTaunt(companion, combatTarget);
        companion.companionTauntTimer = profile.tauntInterval;
      }
    }
    const reach = MELEE_RANGE * 0.9;
    const cd = dist2d(companion.pos, combatTarget.pos);
    if (cd > reach) {
      companion.swingTimer = Math.max(0, (companion.swingTimer ?? 0) - DT);
      if (!ctx.isRooted(companion)) {
        ctx.moveToward(
          companion,
          combatTarget.pos,
          companion.moveSpeed * ctx.moveSpeedMult(companion),
        );
      }
    } else {
      companion.facing = steadyAngleTo(companion.pos, combatTarget.pos, companion.facing);
      companion.swingTimer = (companion.swingTimer ?? 0) - DT;
      if (companion.swingTimer <= 0) {
        const threatBefore =
          combatTarget.kind === 'mob' ? (combatTarget.threat.get(companion.id) ?? 0) : 0;
        ctx.mobSwing(companion, combatTarget);
        if (combatTarget.kind === 'mob' && profile.threatMultiplier > 1) {
          const threatAfter = combatTarget.threat.get(companion.id) ?? 0;
          const delta = threatAfter - threatBefore;
          if (delta > 0)
            addThreat(combatTarget, companion.id, delta * (profile.threatMultiplier - 1));
        }
        companion.swingTimer = companion.weapon.speed * ctx.swingIntervalMult(companion);
      }
    }
  } else {
    companion.inCombat = false;
    companion.swingTimer = Math.max(0, (companion.swingTimer ?? 0) - DT);
  }

  companion.wanderTimer = (companion.wanderTimer ?? 0) - DT;
  if (companion.wanderTimer <= 0) {
    companion.wanderTimer = DELVE_COMPANION_HEAL_INTERVAL;
    const rank = ctx.players.get(owner.id)?.companionUpgrades[run.companion.companionId] ?? 1;
    let target: Entity = owner;
    let lowest = owner.hp / owner.maxHp;
    if (run.partyKey) {
      for (const pid of ctx.partyMembersForKey(run.partyKey)) {
        const ally = ctx.entities.get(pid);
        if (!ally || ally.dead) continue;
        const frac = ally.hp / ally.maxHp;
        if (frac < lowest && dist2d(companion.pos, ally.pos) <= DELVE_COMPANION_HEAL_RANGE) {
          lowest = frac;
          target = ally;
        }
      }
    }
    if (
      target.hp < target.maxHp &&
      dist2d(companion.pos, target.pos) <= DELVE_COMPANION_HEAL_RANGE
    ) {
      const pct =
        DELVE_COMPANION_HEAL_PCT[Math.min(rank, DELVE_COMPANION_MAX_RANK)] ??
        DELVE_COMPANION_HEAL_PCT[1];
      const healed = Math.min(
        target.maxHp - target.hp,
        Math.round(target.maxHp * pct * profile.healMultiplier),
      );
      if (healed > 0) {
        target.hp += healed;
        ctx.emit({ type: 'heal', targetId: target.id, amount: healed });
        ctx.emit({
          type: 'spellfx',
          sourceId: companion.id,
          targetId: target.id,
          school: 'holy',
          fx: 'tick',
        });
      }
    }
  }
  if (combatTarget) return;
  const d = dist2d(companion.pos, owner.pos);
  if (d > PET_TELEPORT_DISTANCE) {
    companion.pos = { ...owner.pos };
    companion.prevPos = { ...companion.pos };
    ctx.rebucket(companion);
  } else if (d > DELVE_COMPANION_FOLLOW && !ctx.isRooted(companion)) {
    ctx.moveToward(companion, owner.pos, companion.moveSpeed * ctx.moveSpeedMult(companion));
  }
}
