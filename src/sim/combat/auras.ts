// Per-tick aura / regen / timer runner, extracted from the Sim monolith (C3).
//
// This module owns the per-entity "Regen, timers, auras" tick block: updateRegen
// (mana/energy/rage + hp regen + eat/drink ticks, emits 'heal'), updateTimers (gcd /
// 5-sec rule / combat timer / cooldown decrement), cleanseFriendlyNpcAuras (strip
// rejected friendly-NPC auras, emits 'aura'), and updateAuras (DoT/HoT/polymorph tick
// + aura expiry + statsDirty recalc). The Sim coordinator calls each from the same
// per-entity tick phase it ran in before (dead players still tick timers/auras).
//
// PRIME DIRECTIVE: this is a MOVE, not a rewrite. Every function below is the former
// `Sim` method verbatim, with `this.X` rewritten to `ctx.X` (the SimContext seam) or a
// module import. Statement order, branch order, the backward `e.auras` walk, and the
// in-place mutation (the refactor's immutability waiver: `p.resource = ...`, `e.hp +=`,
// `e.auras.splice`, `c.remaining -= 2`, `a.tickTimer += ...`) are preserved exactly so
// the parity gate's full-state trace AND rng draw-order log stay byte-identical.
//
// CRITICAL: updateAuras carries TWO load-bearing `e.dead` guards, the top guard and
// the post-DoT guard. A DoT tick calls ctx.dealDamage, which can kill the target
// mid-walk; both guards stop further processing of a dead entity's auras. They MUST
// stay verbatim and in place: reordering either guard, the loop, or any draw forks the
// shared rng stream for every later draw.
//
// DoTs and HoTs are fully DYNAMIC (periodic_tick.ts): each firing tick recomputes its
// amount from the caster's CURRENT stats (so a Spell/Attack Power buff instantly lifts
// active dots, no recast), scales the tick RATE by the caster's haste (duration fixed),
// and rolls ONE crit per tick against the shared Rng. So this slice now DOES draw rng:
// exactly one draw per firing dot/hot tick, in the backward aura-walk order, plus the
// draws inside ctx.dealDamage. updateGroundAoEs / pulseGroundAoE are NOT here:
// pulseGroundAoE STAYS on Sim (a shared entry point), and its per-tick driver was
// already extracted to entity_roster (tickGroundAoEs) by E1.
//
// `src/sim`-pure: no DOM/Three/render/ui/game/net imports, no Math.random/Date.now
// (enforced by tests/architecture.test.ts).

import { recalcPlayerStats } from '../entity';
import type { PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';
import { type Aura, type AuraKind, CAST_COMPLETE_EPS, DT, type Entity } from '../types';
import {
  periodicCritChance,
  periodicCritMult,
  periodicTickAmount,
  periodicTickInterval,
} from './periodic_tick';
import { tickThornsCooldown } from './thorns_charge';

// Friendly NPCs reject hostile control / debuff auras: any aura of these kinds is
// stripped on the NPC's tick (cleanseFriendlyNpcAuras). Moved here with that method
// (its only tick consumer); isRejectedFriendlyNpcAura is re-exported so the Sim
// applyAura gate (an npc target rejecting the aura on apply) still resolves it.
const FRIENDLY_NPC_REJECTED_AURA_KINDS: ReadonlySet<AuraKind> = new Set([
  'dot',
  'slow',
  'stun',
  'root',
  'incapacitate',
  'polymorph',
  'attackspeed',
  'sunder',
  'bleed_vuln',
  'corrode',
  'faerie_fire',
  'spellvuln',
  'vulnerability',
  'tongues',
  'cost_tax',
  'critvuln',
]);

export function isRejectedFriendlyNpcAura(aura: Aura): boolean {
  return FRIENDLY_NPC_REJECTED_AURA_KINDS.has(aura.kind);
}

function pctValue(value: number): number {
  return value > 1 ? value / 100 : value;
}

export function updateRegen(ctx: SimContext, p: Entity, _meta: PlayerMeta): void {
  if (ctx.tickCount % 40 !== 0) return; // every 2 seconds (the classic tick)
  if (p.resourceType === 'mana') {
    if (p.fiveSecondRule >= 5) {
      // out-of-combat mana regen: faster than before and scales with spirit
      // (gear/level) plus a small flat per-level floor so low-spirit casters
      // still recover at a reasonable pace (#103)
      const regen = p.stats.spi / 3 + 4 + Math.floor(p.level / 5);
      p.resource = Math.min(p.maxResource, p.resource + Math.round(regen));
    }
  } else if (p.resourceType === 'energy') {
    // Feral Instinct (cat form) grants a buff_energyregen aura (value = fraction, 1 = +100%).
    let regen = 20;
    for (const a of p.auras) if (a.kind === 'buff_energyregen') regen *= 1 + a.value;
    p.resource = Math.min(p.maxResource, p.resource + Math.round(regen));
  } else if (p.resourceType === 'rage' && !p.inCombat) {
    p.resource = Math.max(0, p.resource - 2);
  }
  if (!p.inCombat && p.hp < p.maxHp && !p.eating) {
    const regen = p.stats.sta * 0.3 + 2;
    p.hp = Math.min(p.maxHp, p.hp + Math.round(regen));
  }
  // food and drink tick independently, so both can run at once
  for (const slot of ['eating', 'drinking'] as const) {
    const c = p[slot];
    if (!c) continue;
    if (c.hpPer2s > 0 && p.hp < p.maxHp) {
      const heal = Math.min(Math.round(c.hpPer2s * ctx.healingTakenMult(p)), p.maxHp - p.hp);
      p.hp += heal;
      ctx.emit({ type: 'heal', targetId: p.id, amount: heal });
    }
    if (c.manaPer2s > 0 && p.resourceType === 'mana') {
      p.resource = Math.min(p.maxResource, p.resource + c.manaPer2s);
    }
    c.remaining -= 2;
    if (c.remaining <= 0) p[slot] = null;
  }
}

export function updateTimers(p: Entity): void {
  p.gcdRemaining = Math.max(0, p.gcdRemaining - DT);
  p.potionCdRemaining = Math.max(0, p.potionCdRemaining - DT);
  p.fiveSecondRule += DT;
  p.combatTimer += DT;
  for (const [k, v] of p.cooldowns) {
    const nv = v - DT;
    if (nv <= 0) p.cooldowns.delete(k);
    else p.cooldowns.set(k, nv);
  }
}

// Combo points are character-bound (retail-style): they survive target swaps and
// kills, so this per-tick check is the only passive decay. awardCombo (sim.ts)
// restamps comboUntil on every point built; spending, player death, and the
// arena/fiesta resets clear the pool explicitly.
export function updateComboExpiry(ctx: SimContext, p: Entity): void {
  if (p.comboPoints > 0 && ctx.time >= p.comboUntil) {
    p.comboPoints = 0;
    ctx.emit({ type: 'comboPoint', points: 0, pid: p.id });
  }
}

export function cleanseFriendlyNpcAuras(ctx: SimContext, e: Entity): void {
  for (let i = e.auras.length - 1; i >= 0; i--) {
    const aura = e.auras[i];
    if (!isRejectedFriendlyNpcAura(aura)) continue;
    e.auras.splice(i, 1);
    ctx.emit({ type: 'aura', targetId: e.id, name: aura.name, gained: false });
  }
}

export function updateAuras(ctx: SimContext, e: Entity): void {
  if (e.dead) {
    e.stealthed = e.auras.some((a) => a.kind === 'stealth');
    return;
  }
  let statsDirty = false;
  for (let i = e.auras.length - 1; i >= 0; i--) {
    const a = e.auras[i];
    a.remaining -= DT;
    // charge-limited thorns (Lightning Shield): age its internal cooldown so the
    // next melee hit can reflect once it elapses. No-op for ungated thorns.
    if (a.kind === 'thorns') tickThornsCooldown(a);
    if (a.tickInterval) {
      a.tickTimer = (a.tickTimer ?? a.tickInterval) - DT;
      if (a.tickTimer <= CAST_COMPLETE_EPS) {
        // Haste raises the tick rate: re-arm with the caster's live hasted interval
        // (base interval for a haste-less or mob source, so their cadence is unchanged).
        const src = ctx.entities.get(a.sourceId) ?? null;
        a.tickTimer += periodicTickInterval(a, src);
        if (a.kind === 'dot') {
          ctx.emit({
            type: 'spellfx',
            sourceId: a.sourceId,
            targetId: e.id,
            school: a.school,
            fx: 'tick',
          });
          // Dynamic per-tick amount off the caster's CURRENT stats, then one crit roll.
          // Only a PLAYER source's dot can crit: mob dot affixes (venom, soulrot, bleed,
          // frostbite, smolder, cinder, arcaneRot, stackPoison) stay non-critting so this
          // remains a talent-balance change, not a PvE difficulty bump. The roll is still
          // drawn unconditionally (chance(0) consumes one rng value), so the draw order is
          // identical whatever the source; a mob roll simply never lands.
          let tickDamage = periodicTickAmount(a, src);
          if (a.school === 'physical') {
            let bleedAmp = 0;
            for (const targetAura of e.auras) {
              if (targetAura.kind === 'bleed_vuln') bleedAmp += pctValue(targetAura.value);
            }
            if (bleedAmp > 0) tickDamage = Math.round(tickDamage * (1 + bleedAmp));
          }
          const crit = ctx.rng.chance(
            src?.kind === 'player' ? periodicCritChance(a, src, ctx.spellCrit) : 0,
          );
          const dealt = crit ? Math.round(tickDamage * periodicCritMult(a)) : tickDamage;
          ctx.dealDamage(
            src,
            e,
            dealt,
            crit,
            a.school,
            a.name,
            'hit',
            true,
            undefined,
            // Periodic (DoT) ticks are not a direct attack: they must not walk a
            // mob's leash anchor, so a DoT-kited mob still leashes home.
            false,
          );
          if (a.leechPct !== undefined && src && !src.dead) {
            const healed = Math.min(Math.round(dealt * a.leechPct), src.maxHp - src.hp);
            if (healed > 0) {
              src.hp += healed;
              ctx.emit({
                type: 'heal2',
                sourceId: src.id,
                targetId: src.id,
                amount: healed,
                crit: false,
                ability: a.name,
              });
              ctx.healingThreat(src, src, healed);
            }
          }
          if (e.dead) return;
        } else if (a.kind === 'hot') {
          // Dynamic HoT: live per-tick amount + a crit roll (heals crit at 1.5x). The
          // roll is drawn whenever the tick fires (even at full hp) to keep the shared
          // rng stream deterministic regardless of the target's health. HoTs always crit
          // off SPELL crit (never physical), so this inlines spellCrit on purpose rather
          // than periodicCritChance; do not "fix" it to the dot helper. Gated to a living
          // PLAYER source, matching the dot path (mob-cast hots stay non-critting).
          const amount = periodicTickAmount(a, src);
          const crit = ctx.rng.chance(src?.kind === 'player' && !src.dead ? ctx.spellCrit(src) : 0);
          const raw = crit ? Math.round(amount * 1.5) : amount;
          const healed = Math.min(Math.round(raw * ctx.healingTakenMult(e)), e.maxHp - e.hp);
          if (healed > 0) {
            e.hp += healed;
            ctx.emit({
              type: 'heal2',
              sourceId: a.sourceId,
              targetId: e.id,
              amount: healed,
              crit,
              ability: a.name,
            });
            if (src) ctx.healingThreat(src, e, healed);
          }
        } else if (a.kind === 'polymorph') {
          const heal = Math.round(e.maxHp * 0.1);
          e.hp = Math.min(e.maxHp, e.hp + heal);
        }
      }
    }
    if (a.remaining <= CAST_COMPLETE_EPS) {
      e.auras.splice(i, 1);
      ctx.applyNonPlayerStatAura(e, a, -1);
      ctx.emit({ type: 'aura', targetId: e.id, name: a.name, gained: false });
      // debuff_ap is the one non-buff kind recalcPlayerStats folds, so it must
      // mark stats dirty on expiry or the AP cut would persist after the fade.
      if (a.kind.startsWith('buff') || a.kind.startsWith('form') || a.kind === 'debuff_ap')
        statsDirty = true;
    }
  }
  if (statsDirty && e.kind === 'player') {
    const meta = ctx.players.get(e.id);
    if (meta)
      recalcPlayerStats(e, meta.cls, meta.equipment, ctx.playerMods(meta), meta.equipmentInstance);
  }
  e.stealthed = e.auras.some((a) => a.kind === 'stealth');
}
