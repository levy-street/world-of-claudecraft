import {
  VANGUARD_PROT_PALADIN_4PC_CAST_SLOW_DURATION_SEC,
  VANGUARD_PROT_PALADIN_4PC_CAST_SLOW_MULT,
} from '../content/vanguard_set_bonuses_a';
import { questGateBlocksAggro } from '../mob/quest_gated_aggro';
import type { SimContext } from '../sim_context';
import { addThreat } from '../threat';
import { DT, type Entity } from '../types';
import { relocateSwept } from './heroic_leap';
import { grantSolarReprisal } from './paladin_solar_reprisal';
import { isVeilboundMarchActive } from './paladin_veilbound_state';
import { isPullEligible } from './pull_eligibility';
import { wearsSetBonus } from './set_bonus_wearer';

const OATH_CHAIN_PULL_SUFFIX = '_pull';
/** The Shieldvow Bastion 4pc cast-slow aura id on a chained enemy. */
export const SHIELDVOW_CAST_SLOW_AURA_ID = 'oath_chain_tongues';

function finishOathChainPull(ctx: SimContext, target: Entity, aura: Entity['auras'][number]): void {
  const slowDuration = aura.pullSlowDuration ?? 0;
  const slowMult = aura.pullSlowMult ?? 1;
  aura.remaining = 0;
  if (slowDuration <= 0) return;
  ctx.applyAura(target, {
    id: aura.id.replace(new RegExp(`${OATH_CHAIN_PULL_SUFFIX}$`), '_slow'),
    name: aura.name,
    kind: 'slow',
    value: slowMult,
    remaining: slowDuration,
    duration: slowDuration,
    sourceId: aura.sourceId,
    school: aura.school,
  });
}

export function tickPaladinOathChainPull(
  ctx: SimContext,
  target: Entity,
  aura: Entity['auras'][number],
): void {
  if (!aura.id?.endsWith(OATH_CHAIN_PULL_SUFFIX)) return;
  const source = ctx.entities.get(aura.sourceId);
  const stopDistance = aura.pullStopDistance;
  const travelSpeed = aura.pullSpeed;
  if (!source || source.dead || stopDistance === undefined || travelSpeed === undefined) {
    finishOathChainPull(ctx, target, aura);
    return;
  }
  if (isVeilboundMarchActive(target)) return;

  const dx = target.pos.x - source.pos.x;
  const dz = target.pos.z - source.pos.z;
  const distance = Math.hypot(dx, dz);
  if (distance <= stopDistance + 1e-6 || distance <= 1e-6) {
    finishOathChainPull(ctx, target, aura);
    return;
  }

  const nextDistance = Math.max(stopDistance, distance - travelSpeed * DT);
  relocateSwept(ctx, target, {
    x: source.pos.x + (dx / distance) * nextDistance,
    y: target.pos.y,
    z: source.pos.z + (dz / distance) * nextDistance,
  });
  ctx.grid.update(target);
  if (target.kind === 'player') ctx.playerGrid.update(target);

  const remainingDistance = Math.hypot(target.pos.x - source.pos.x, target.pos.z - source.pos.z);
  if (remainingDistance <= stopDistance + 1e-3) finishOathChainPull(ctx, target, aura);
}

export function pullPaladinTarget(
  ctx: SimContext,
  source: Entity,
  target: Entity,
  stopDistance: number,
  travelSpeed: number,
  slowMult: number,
  slowDuration: number,
  abilityId: string,
  abilityName: string,
): void {
  if (isPullEligible(target)) {
    const dx = target.pos.x - source.pos.x;
    const dz = target.pos.z - source.pos.z;
    const distance = Math.hypot(dx, dz);
    const traveling = distance > stopDistance && distance > 1e-6 && !isVeilboundMarchActive(target);
    const travelDuration = traveling
      ? Math.max(0.05, (distance - stopDistance) / Math.max(0.01, travelSpeed) + 1)
      : slowDuration;
    ctx.applyAura(target, {
      id: `${abilityId}_${traveling ? 'pull' : 'slow'}`,
      name: abilityName,
      kind: traveling ? 'forced_move' : 'slow',
      remaining: travelDuration,
      duration: travelDuration,
      value: traveling ? 1 : slowMult,
      sourceId: source.id,
      school: 'holy',
      pullStopDistance: traveling ? stopDistance : undefined,
      pullSpeed: traveling ? travelSpeed : undefined,
      pullSlowMult: traveling ? slowMult : undefined,
      pullSlowDuration: traveling ? slowDuration : undefined,
    });
  }
  ctx.enterCombat(source, target);
}

export function pullPaladinTargets(
  ctx: SimContext,
  source: Entity,
  primary: Entity,
  maxTargets: number,
  searchRadius: number,
  stopDistance: number,
  travelSpeed: number,
  slowMult: number,
  slowDuration: number,
  abilityId: string,
  abilityName: string,
): void {
  const targets = [primary];
  if (maxTargets > 1) {
    const candidates = ctx
      .hostilesInRadius(source, source.pos, searchRadius)
      .filter(
        (candidate) =>
          candidate.id !== primary.id &&
          !candidate.dead &&
          isPullEligible(candidate) &&
          ctx.hasLineOfSight(source, candidate),
      )
      .sort((a, b) => {
        const adx = a.pos.x - source.pos.x;
        const adz = a.pos.z - source.pos.z;
        const bdx = b.pos.x - source.pos.x;
        const bdz = b.pos.z - source.pos.z;
        return adx * adx + adz * adz - (bdx * bdx + bdz * bdz) || a.id - b.id;
      });
    targets.push(...candidates.slice(0, maxTargets - 1));
  }
  for (const target of targets) {
    pullPaladinTarget(
      ctx,
      source,
      target,
      stopDistance,
      travelSpeed,
      slowMult,
      slowDuration,
      abilityId,
      abilityName,
    );
  }
  // Shieldvow Bastion 4pc (Warfare Season 2): every pullable enemy the chain
  // binds casts spells slower for a few seconds (the tongues aura tonguesMult
  // reads at cast start), and an Oath Chain that binds a pullable primary
  // grants Solar Reprisal outright. grantSolarReprisal is the roll-free arm
  // (tryGrantSolarReprisal is the rolled one), so no rng draw is added;
  // bosses are not pullable, so neither half lands on them.
  if (abilityId !== 'oath_chain') return;
  if (!wearsSetBonus(ctx, source, 'vanguard_paladin_protection', 4)) return;
  for (const target of targets) {
    if (!target.dead && isPullEligible(target)) applyShieldvowCastSlow(ctx, source, target);
  }
  if (isPullEligible(primary)) grantSolarReprisal(ctx, source);
}

/** The Shieldvow Bastion 4pc cast slow: one tongues aura per chained enemy,
 *  refreshed by id (never stacks), shown under Oath Chain's name. */
function applyShieldvowCastSlow(ctx: SimContext, source: Entity, target: Entity): void {
  ctx.applyAura(target, {
    id: SHIELDVOW_CAST_SLOW_AURA_ID,
    name: 'Oath Chain',
    kind: 'tongues',
    value: VANGUARD_PROT_PALADIN_4PC_CAST_SLOW_MULT,
    remaining: VANGUARD_PROT_PALADIN_4PC_CAST_SLOW_DURATION_SEC,
    duration: VANGUARD_PROT_PALADIN_4PC_CAST_SLOW_DURATION_SEC,
    sourceId: source.id,
    school: 'holy',
  });
}

export function pulsePaladinThreat(
  ctx: SimContext,
  source: Entity,
  amount: number,
  radius: number,
): void {
  const modified = amount * ctx.threatMod(source, 'holy');
  for (const target of ctx.hostilesInRadius(source, source.pos, radius)) {
    if (!ctx.hasLineOfSight(source, target)) continue;
    if (questGateBlocksAggro(ctx.players, target, source)) continue;
    addThreat(target, source.id, modified);
    ctx.enterCombat(source, target);
  }
}
