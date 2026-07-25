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
// The one deliberate deviation from verbatim is updateAuras's snapshot-plus-liveness
// walk (see the comment at the loop). It fixes a re-entrancy bug the verbatim move
// carried over: a DoT tick's own dealDamage call splicing an aura out of this same
// array mid-walk, which pulled the just-processed entry back under the cursor and
// ticked it twice. It keeps the iteration ORDER, and therefore the rng draw order,
// identical for every aura that survives its own turn: the parity gate stays green
// with NO golden regeneration.
//
// CRITICAL: updateAuras carries TWO load-bearing `e.dead` guards, the top guard and
// the post-DoT guard. A DoT tick calls ctx.dealDamage, which can kill the target
// mid-walk; both guards stop further processing of a dead entity's auras. They MUST
// stay verbatim and in place: reordering either guard, the loop, or any draw forks the
// shared rng stream for every later draw.
//
// This slice draws NO rng of its own. Its only rng-bearing callee is ctx.dealDamage
// (the DoT tick), reached through the seam. updateGroundAoEs / pulseGroundAoE are NOT
// here: pulseGroundAoE STAYS on Sim (a shared entry point), and its per-tick driver was
// already extracted to entity_roster (tickGroundAoEs) by E1.
//
// `src/sim`-pure: no DOM/Three/render/ui/game/net imports, no Math.random/Date.now
// (enforced by tests/architecture.test.ts).

import { pctValue, recalcPlayerStats } from '../entity';
import type { PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';
import { type Aura, type AuraKind, CAST_COMPLETE_EPS, DT, type Entity } from '../types';
import { isStunned } from './cc';
import { onHotExpired, tickProcState } from './talent_procs';
import { temporalHourglassCooldownDelta, tickTemporalHourglassHealing } from './temporal_hourglass';
import { tickThornsCooldown } from './thorns_charge';

const SECOND_WIND_THRESHOLD = 0.35;

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

export function updateRegen(ctx: SimContext, p: Entity, meta: PlayerMeta): void {
  if (ctx.tickCount % 40 !== 0) return; // every 2 seconds (the classic tick)
  // Lifesap restores whichever resource bar is currently live, including across
  // form changes. Hard control stills the sap rather than banking free resource.
  if (!isStunned(p)) {
    for (const aura of p.auras) {
      if (aura.kind === 'resource_sap') {
        p.resource = Math.min(p.maxResource, p.resource + Math.round(aura.value));
      }
    }
  }
  if (p.resourceType === 'mana') {
    if (p.fiveSecondRule >= 5) {
      // out-of-combat mana regen: faster than before and scales with spirit
      // (gear/level) plus a small flat per-level floor so low-spirit casters
      // still recover at a reasonable pace (#103)
      const regen =
        (p.stats.spi / 3 + 4 + Math.floor(p.level / 5)) *
        (1 + ctx.playerMods(meta).global.manaRegenPct);
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
  const secondWindPct = ctx.playerMods(meta).global.secondWindPctPerSec;
  if (secondWindPct > 0 && p.hp > 0 && p.hp < p.maxHp * SECOND_WIND_THRESHOLD) {
    const heal = Math.min(Math.round(p.maxHp * secondWindPct * 2), p.maxHp - p.hp);
    if (heal > 0) {
      p.hp += heal;
      ctx.emit({ type: 'heal', targetId: p.id, amount: heal });
    }
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
    const nv = v - temporalHourglassCooldownDelta(p, k);
    if (nv <= 0) p.cooldowns.delete(k);
    else p.cooldowns.set(k, nv);
  }
  if (p.abilityCharges) {
    for (const [abilityId, state] of Object.entries(p.abilityCharges)) {
      if (state.charges >= state.maxCharges) continue;
      // Legacy sequential state (an old JSONB save without per-charge timers):
      // convert once, staggering the missing charges the way the old model
      // would have returned them, so a mid-recharge relog keeps its schedule.
      if (!state.recharges) {
        const missing = Math.max(1, state.maxCharges - state.charges);
        state.recharges = Array.from(
          { length: missing },
          (_, i) => state.recharge + i * state.rechargeLength,
        );
      }
      // Parallel per-charge recharge: every running timer ticks at once.
      const delta = temporalHourglassCooldownDelta(p, abilityId);
      state.recharges = state.recharges.map((t) => t - delta);
      while (state.recharges.length > 0 && state.recharges[0] <= 0) {
        state.recharges.shift();
        state.charges = Math.min(state.maxCharges, state.charges + 1);
      }
      if (state.charges >= state.maxCharges || state.recharges.length === 0) {
        state.recharges = [];
        state.recharge = 0;
        if (state.charges > 0) p.cooldowns.delete(abilityId);
        continue;
      }
      state.recharge = state.recharges[0];
      if (state.charges <= 0) p.cooldowns.set(abilityId, state.recharge);
    }
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
  // Talent-proc internal cooldowns age at the same cadence as auras.
  tickProcState(e, DT);
  // Walk a SNAPSHOT of e.auras, not the live array. A DoT tick's own
  // ctx.dealDamage call can splice an aura out of this SAME array mid-walk
  // (damage.ts's own backward sweeps remove a breaksOnDamage control aura, or a
  // depleted absorb shield). A removal at an index BELOW the live cursor shifts
  // everything above it down by one, so a live-indexed walk lands the
  // just-processed entry back under the cursor and processes it twice: a double
  // decrement of remaining/tickTimer and, for a DoT, a second dealDamage call in
  // the same sim tick. The snapshot fixes the iteration ORDER once, up front,
  // identical to the live order at that moment, so every aura still present when
  // its turn comes is processed exactly as before. The liveness check only skips
  // an entry a side effect already removed; it never revisits one. rng draw order
  // is unaffected: this removes a spurious extra dealDamage, it adds none.
  const snapshot = e.auras.slice();
  for (let i = snapshot.length - 1; i >= 0; i--) {
    const a = snapshot[i];
    if (!e.auras.includes(a)) continue; // removed by an earlier entry's side effect this tick
    a.remaining -= DT;
    // charge-limited thorns (Lightning Shield): age its internal cooldown so the
    // next melee hit can reflect once it elapses. No-op for ungated thorns.
    if (a.kind === 'thorns') tickThornsCooldown(a);
    if (a.tickInterval) {
      a.tickTimer = (a.tickTimer ?? a.tickInterval) - DT;
      if (a.tickTimer <= CAST_COMPLETE_EPS) {
        a.tickTimer += a.tickInterval;
        if (a.id === 'temporal_hourglass' && a.kind === 'stasis') {
          tickTemporalHourglassHealing(ctx, e, a);
        } else if (a.kind === 'dot') {
          let tickDamage = a.value;
          if (a.school === 'physical') {
            let bleedAmp = 0;
            for (const targetAura of e.auras) {
              if (targetAura.kind === 'bleed_vuln') bleedAmp += pctValue(targetAura.value);
            }
            if (bleedAmp > 0) tickDamage = Math.round(tickDamage * (1 + bleedAmp));
          }
          ctx.emit({
            type: 'spellfx',
            sourceId: a.sourceId,
            targetId: e.id,
            school: a.school,
            fx: 'tick',
          });
          ctx.dealDamage(
            ctx.entities.get(a.sourceId) ?? null,
            e,
            tickDamage,
            false,
            a.school,
            a.name,
            'hit',
            true,
            undefined,
            // Periodic (DoT) ticks are not a direct attack: they must not walk a
            // mob's leash anchor, so a DoT-kited mob still leashes home.
            false,
            false,
            // Banks copied from resolved damage (Ignite) skip the source-output
            // multipliers so the payout equals what was banked, once.
            a.finalDamage === true,
          );
          if (a.leechPct !== undefined) {
            const src = ctx.entities.get(a.sourceId);
            if (src && !src.dead) {
              const healed = Math.min(Math.round(tickDamage * a.leechPct), src.maxHp - src.hp);
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
          }
          if (e.dead) return;
        } else if (a.kind === 'hot') {
          const healed = Math.min(Math.round(a.value * ctx.healingTakenMult(e)), e.maxHp - e.hp);
          if (healed > 0) {
            e.hp += healed;
            ctx.emit({
              type: 'heal2',
              sourceId: a.sourceId,
              targetId: e.id,
              amount: healed,
              crit: false,
              ability: a.name,
            });
            const src = ctx.entities.get(a.sourceId);
            if (src) ctx.healingThreat(src, e, healed);
          }
        } else if (a.kind === 'polymorph') {
          const heal = Math.round(e.maxHp * 0.1);
          e.hp = Math.min(e.maxHp, e.hp + heal);
        }
      }
    }
    if (a.remaining <= CAST_COMPLETE_EPS) {
      // `i` indexes the snapshot, which no longer matches e.auras once a mid-tick
      // removal has shifted it, so splice the aura's actual live position. The
      // guard covers the one remaining self-removal window (an aura whose OWN
      // side effect this iteration spliced it out): whoever removed it already
      // emitted its fade, so the whole expiry block is skipped rather than
      // double-emitted. Every aura reachable here today is still live, since the
      // top-of-loop check skipped anything an EARLIER entry removed, so this is
      // behavior-identical.
      const liveIndex = e.auras.indexOf(a);
      if (liveIndex < 0) continue;
      e.auras.splice(liveIndex, 1);
      ctx.applyNonPlayerStatAura(e, a, -1);
      ctx.emit({ type: 'aura', targetId: e.id, name: a.name, gained: false });
      // A HoT that ran its FULL duration (this natural-expiry path, never a
      // dispel/overwrite) reports to the caster's talent procs. No rng.
      if (a.kind === 'hot') {
        const source = ctx.entities.get(a.sourceId);
        if (source && !source.dead && source.kind === 'player') {
          onHotExpired(ctx, source, a.id, e);
        }
      }
      // debuff_ap is the one non-buff kind recalcPlayerStats folds, so it must
      // mark stats dirty on expiry or the AP cut would persist after the fade.
      if (
        a.kind.startsWith('buff') ||
        a.kind.startsWith('form') ||
        a.kind === 'debuff_ap' ||
        a.kind === 'die_by_sword' ||
        a.kind === 'enrage' ||
        a.kind === 'bloodbath' ||
        a.kind === 'berserker_stance'
      )
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
