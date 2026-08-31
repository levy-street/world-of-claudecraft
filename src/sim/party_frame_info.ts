import type { PartyInfo } from '../world_api';
import { isPartyFrameRelevantAura } from './aura_classify';
import { echoVisibleTo, partyAuraPriority } from './combat/chronomancy';
import { damageTakenWithin } from './combat/damage_history';
import { rewindHealAmount } from './combat/rewind';
import { MENDING_CURRENT_ID } from './combat/shaman_spiritmend';
import type { Role } from './content/talents';
import type { SimContext } from './sim_context';
import type { AbilityEffect, Aura, Entity } from './types';
import { PARTY_MEMBER_AURA_CAP } from './types';

export interface PartyFrameAuraSummary {
  id: string;
  kind: Aura['kind'];
  neg?: 1;
  remaining: number;
  poolPct?: number;
}

export interface PartyFrameResolvedAbility {
  effects: readonly AbilityEffect[];
}

export interface PreparedPartyFrameAura {
  summary: PartyFrameAuraSummary;
  sourceId: number;
}

/** Perform the relevance, priority, and summary work once before applying a
 * viewer-specific Temporal Echo visibility filter. */
function mendingPoolPct(aura: Aura, maxHp: number | undefined): number | undefined {
  if (aura.id !== MENDING_CURRENT_ID || aura.value <= 0 || !maxHp || maxHp <= 0) return undefined;
  return Math.max(1, Math.min(100, Math.round((aura.value / maxHp) * 100)));
}

function partyFrameAuraSummary(aura: Aura, maxHp: number | undefined): PartyFrameAuraSummary {
  const poolPct = mendingPoolPct(aura, maxHp);
  return {
    id: aura.id,
    kind: aura.kind,
    ...(aura.value < 0 ? { neg: 1 as const } : {}),
    remaining: Math.max(0, Math.ceil(aura.remaining)),
    ...(poolPct !== undefined ? { poolPct } : {}),
  };
}

export function preparePartyFrameAuras(
  auras: readonly Aura[],
  maxHp?: number,
): PreparedPartyFrameAura[] {
  const relevant = auras.filter((aura) => isPartyFrameRelevantAura(aura));
  relevant.sort((a, b) => partyAuraPriority(a) - partyAuraPriority(b));
  return relevant.map((aura) => ({
    sourceId: aura.sourceId,
    summary: partyFrameAuraSummary(aura, maxHp),
  }));
}

/** Apply only the cheap viewer-specific Echo filter and cap to prepared rows. */
export function partyFrameAurasForViewer(
  prepared: readonly PreparedPartyFrameAura[],
  viewerId?: number,
  cap = PARTY_MEMBER_AURA_CAP,
): PartyFrameAuraSummary[] {
  const normalizedCap = Number.isNaN(cap) ? 0 : Math.trunc(cap);
  if (normalizedCap === 0) return [];
  const visible: PartyFrameAuraSummary[] = [];
  for (const aura of prepared) {
    if (
      viewerId !== undefined &&
      !echoVisibleTo({ kind: aura.summary.kind, sourceId: aura.sourceId }, viewerId)
    ) {
      continue;
    }
    visible.push(aura.summary);
    if (normalizedCap > 0 && visible.length === normalizedCap) break;
  }
  return normalizedCap < 0 ? visible.slice(0, normalizedCap) : visible;
}

/** Compact actionable auras for a party row. Filtering before the cap prevents
 * long-lived maintenance buffs from hiding a later debuff, HoT, or shield, and
 * the priority sort guarantees harmful effects and the viewer's own Temporal
 * Echo mark a strip slot under aura pressure (stable sort, so within a tier the
 * natural aura order is preserved). */
export function partyFrameAuras(
  auras: readonly Aura[],
  cap = PARTY_MEMBER_AURA_CAP,
  maxHp?: number,
): PartyFrameAuraSummary[] {
  // Keep the offline path single-pass. Routing it through the prepared server
  // representation would allocate both an intermediate wrapper list and the
  // final summaries for every offline tick.
  const relevant = auras.filter((aura) => isPartyFrameRelevantAura(aura));
  relevant.sort((a, b) => partyAuraPriority(a) - partyAuraPriority(b));
  return relevant.slice(0, cap).map((aura) => partyFrameAuraSummary(aura, maxHp));
}

/** Remaining damage absorption, matching the player and target frame total. */
export function partyFrameAbsorb(auras: readonly Aura[]): number {
  let total = 0;
  for (const aura of auras) {
    if (aura.kind === 'absorb') total += Math.max(0, aura.value);
  }
  return total;
}

/** Entity ids currently tanking at least one living hostile mob. */
export function partyFrameAggroTargets(entities: Iterable<Entity>): Set<number> {
  const targets = new Set<number>();
  for (const entity of entities) {
    if (
      entity.kind === 'mob' &&
      !entity.dead &&
      entity.aiState !== 'dead' &&
      entity.aggroTargetId !== null
    ) {
      targets.add(entity.aggroTargetId);
    }
  }
  return targets;
}

/** Expected base healing from active targeted casts, keyed by their locked target.
 * The midpoint is deterministic and avoids claiming the eventual random roll. */
export function partyFrameIncomingHeals(
  entities: Iterable<Entity>,
  resolve: (abilityId: string, casterId: number) => PartyFrameResolvedAbility | null,
): Map<number, number> {
  const incoming = new Map<number, number>();
  for (const caster of entities) {
    if (
      caster.kind !== 'player' ||
      caster.dead ||
      !caster.castingAbility ||
      caster.castTargetId === null
    ) {
      continue;
    }
    const ability = resolve(caster.castingAbility, caster.id);
    if (!ability) continue;
    let amount = 0;
    for (const effect of ability.effects) {
      if (effect.type === 'heal' || effect.type === 'chainHeal') {
        amount += (effect.min + effect.max) / 2;
      }
    }
    if (amount <= 0) continue;
    incoming.set(caster.castTargetId, (incoming.get(caster.castTargetId) ?? 0) + amount);
  }
  return incoming;
}

export function partyFrameRole(role: Role | null): Role {
  return role ?? 'dps';
}

/** The primary-viewer party frame projection (IWorld partyInfo): one PartyInfo
 * snapshot of the viewer's party built from the live SimContext views. Pure
 * read; Sim keeps a thin getter that delegates here. */
export function collectPartyInfo(ctx: SimContext): PartyInfo | null {
  const party = ctx.partyOf(ctx.primaryId);
  if (!party) return null;
  const aggroTargets = partyFrameAggroTargets(ctx.entities.values());
  const incomingHeals = partyFrameIncomingHeals(ctx.entities.values(), (abilityId, casterId) =>
    ctx.resolvedAbility(abilityId, casterId),
  );
  return {
    leader: party.leader,
    raid: party.raid,
    master: { ...party.lootStrategies.master },
    members: party.members.flatMap((mPid) => {
      const meta = ctx.players.get(mPid);
      const e = ctx.entities.get(mPid);
      return meta && e
        ? [
            {
              pid: mPid,
              name: meta.name,
              cls: meta.cls,
              level: e.level,
              hp: e.hp,
              mhp: e.maxHp,
              res: Math.round(e.resource),
              mres: e.maxResource,
              rtype: e.resourceType,
              x: e.pos.x,
              z: e.pos.z,
              dead: e.dead ? 1 : 0,
              inCombat: e.inCombat ? 1 : 0,
              group: party.raidGroups.get(mPid) ?? 1,
              absorb: partyFrameAbsorb(e.auras),
              role: partyFrameRole(meta.talentMods.role),
              // Effective health Rewind could currently restore to this member
              // (combat/rewind.ts); 0 for members with no recent recorded loss.
              rewind: rewindHealAmount(damageTakenWithin(e, ctx.tickCount), e.hp, e.maxHp),
              connected: 1,
              hasAggro: aggroTargets.has(mPid) ? 1 : 0,
              incomingHeal: incomingHeals.get(mPid) ?? 0,
              // Temporal Echo marks are filtered to the LOCAL player's own (owner
              // 2026-07-12): other chronomancers' echoes still heal in the sim but
              // never show in this viewer's group/raid strip. echoVisibleTo reads
              // the real aura sourceId, so no wire field is added.
              auras: partyFrameAuras(
                e.auras.filter((a) => echoVisibleTo(a, ctx.primaryId)),
                undefined,
                e.maxHp,
              ),
            },
          ]
        : [];
    }),
  };
}
