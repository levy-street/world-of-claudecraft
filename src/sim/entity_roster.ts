// Entity roster + tick prologue plumbing, extracted from the Sim monolith (E1).
//
// This module owns the roster maintenance every other game system depends on:
// add/drop/rebucket against the two spatial grids, the despawn/decay prologue that
// runs at the top of the entity loop, the delayed-event drain, the ground-AoE drain,
// and the player release-spirit flow (graveyard respawn + in-delve respawn).
//
// PRIME DIRECTIVE: this is a MOVE, not a rewrite. Every function below is the former
// `Sim` method verbatim, with `this.X` rewritten to `ctx.X` (the SimContext seam) or
// to a sibling function in this module. Statement order, branch order, and the in-place
// mutation (the refactor's immutability waiver) are preserved exactly so the parity
// gate's full-state trace AND rng draw-order log stay byte-identical.
//
// STATE STAYS ON Sim. `entities`/`grid`/`playerGrid` are a public seam consumed by
// `server/game.ts`, and `delayedEvents`/`groundAoEs`/`dungeonDoorIds` are pushed to by
// out-of-scope schedulers that still live on `Sim` (N1/M3 delayed-event scheduling,
// C1/C4b ground-AoE scheduling). So the fields remain on `Sim` and this module reaches
// them through SimContext live views; only the behavior moved here.
//
// `src/sim`-pure: no DOM/Three/render/ui/game/net imports, no Math.random/Date.now
// (enforced by tests/architecture.test.ts).

import { tickHunterTrap } from './combat/hunter_trap';
import { tickRingOfFrost } from './combat/ring_of_frost';
import { tickTemporalHourglassGround } from './combat/temporal_hourglass';
import { DELVES, DUNGEON_X_THRESHOLD, dungeonAt, zoneAt } from './data';
import { clearDrownedLitanyBellsAndMarks } from './delves/drowned_litany_boss';
import { recalcPlayerStats } from './entity';
import { aurasSurvivingDeath } from './resurrection';
import type { SimContext } from './sim_context';
import type { Entity, SimEvent, Vec3 } from './types';
import { CAST_COMPLETE_EPS, DT, emptyMoveInput } from './types';

// Mobs that despawn after sitting out of combat too long (boss adds that should not
// litter the world). The idle timer is reset to DAMAGE_IDLE_DESPAWN_SECONDS whenever
// they take damage (that reset still lives on Sim in the damage path, C1).
export const DAMAGE_IDLE_DESPAWN_SECONDS = 60;
export const DAMAGE_IDLE_DESPAWN_MOB_IDS = new Set(['varkas_boneguard', 'bound_guardian']);

// A ticking ground hazard (e.g. Consecration). Scheduled by the damage/effect path
// (C1/C4b, still on Sim) and drained here by tickGroundAoEs.
export type GroundAoE = {
  sourceId: number;
  pos: Vec3;
  radius: number;
  min: number;
  max: number;
  remaining: number;
  interval: number;
  tickTimer: number;
  school: string;
  ability: string;
  // Spell Power added per tick, snapshotted at cast time (caster ground AoEs).
  spBonus?: number;
  // Rune of Power (mage choice row): a FRIENDLY zone. When set, each pulse
  // buffs allies inside (+allyBuffPct damage done, refreshed while they stand
  // near) instead of damaging hostiles; min/max are ignored and the pulse
  // draws NO rng (the damage roll is skipped entirely).
  allyBuffPct?: number;
  // Meteor: Ignite each struck enemy for this fraction of the resolved pulse
  // damage (fire_mage.applyIgnite copies the number; no re-roll).
  igniteFrac?: number;
  // Blizzard riders: the per-pulse snare and the Frozen Orb cooldown shave.
  slowMult?: number;
  slowDuration?: number;
  orbCdr?: boolean;
  // Ring of Frost: annular contact trap state. Its duration uses `remaining`;
  // targets are remembered so standing on or re-entering one ring cannot chain-root.
  frostRing?: {
    id: string;
    abilityId: string;
    duration: number;
    freezeDuration: number;
    innerRadius: number;
    triggeredIds: Set<number>;
  };
  // Hunter trap (combat/hunter_trap.ts): placed at the owner's feet, arms
  // after armRemaining, freezes the first enemy contact, then is consumed.
  hunterTrap?: {
    abilityId: string;
    armRemaining: number;
    freezeDuration: number;
    triggered: boolean;
  };
  temporalHourglass?: {
    id: string;
    abilityId: string;
    protectiveDuration: number;
    hostilePveDuration: number;
    hostilePvpDuration: number;
    groundDuration: number;
    healMaxHpPct: number;
    selfCooldownRate: number;
    allyCooldownRate: number;
    createdTick: number;
    sourceOrigin: Vec3;
    sourceZoneId: string;
  };
};

// A SimEvent scheduled to fire at a future sim time, optionally gated by a live-
// reference guard checked at fire time. Scheduled by N1/M3 (still on Sim), drained
// here by drainDelayedEvents.
export type DelayedEvent = { at: number; event: SimEvent; guard?: () => boolean };

// In-place vector copy (the engine mutates entity positions; see immutability waiver).
function copyPos(
  dst: { x: number; y: number; z: number },
  src: { x: number; y: number; z: number },
): void {
  dst.x = src.x;
  dst.y = src.y;
  dst.z = src.z;
}

// -------------------------------------------------------------------------
// Entity roster: every add/remove/teleport goes through these so the
// spatial indexes always match the entities map
// -------------------------------------------------------------------------

export function addEntityToRoster(ctx: SimContext, e: Entity): void {
  ctx.entities.set(e.id, e);
  ctx.grid.insert(e);
  if (e.kind === 'player') ctx.playerGrid.insert(e);
  if (e.templateId === 'dungeon_door' && ctx.dungeonDoorIds) ctx.dungeonDoorIds.push(e.id);
}

export function dropEntityFromRoster(ctx: SimContext, id: number): void {
  ctx.clearEntityMarker(id); // a despawned entity keeps no raid marker
  const e = ctx.entities.get(id);
  if (!e) return;
  // A despawned mob keeps no per-attempt Book of Deeds state: freeInstance,
  // freeDelveRun, and spawnDelveModule drop boss mobs without a kill, so a leaked
  // encounter/taint entry (entity ids are monotonic and never reused) would linger
  // and be re-scanned by the 1 Hz sweep forever. bloatPending is deliberately NOT
  // cleared here: its delayed death-throes blast may still resolve against the
  // already-dropped corpse.
  if (e.kind === 'mob') {
    ctx.deedRuntime.encounters.delete(id);
    ctx.deedRuntime.menderTainted.delete(id);
  }
  ctx.grid.remove(e);
  if (e.kind === 'player') ctx.playerGrid.remove(e);
  ctx.entities.delete(id);
}

export function rebucketEntity(ctx: SimContext, e: Entity): void {
  ctx.grid.update(e);
  if (e.kind === 'player') ctx.playerGrid.update(e);
}

// -------------------------------------------------------------------------
// Tick prologue: despawn/decay scan, delayed-event drain, ground-AoE drain
// -------------------------------------------------------------------------

// Top of the entity loop: copy prev pos/facing (movement bookkeeping), age the two
// despawn timers, expire overhead emotes. Collects ids first, then drops AFTER the
// loop so dropEntity never mutates the entities map under the iterator.
export function runDespawnDecay(ctx: SimContext): void {
  const despawnIds: number[] = [];
  for (const e of ctx.entities.values()) {
    copyPos(e.prevPos, e.pos);
    e.prevFacing = e.facing;
    if (e.despawnTimer !== undefined) {
      e.despawnTimer -= DT;
      if (e.despawnTimer <= 0) despawnIds.push(e.id);
    }
    if (
      e.kind === 'mob' &&
      DAMAGE_IDLE_DESPAWN_MOB_IDS.has(e.templateId) &&
      !e.dead &&
      !e.inCombat
    ) {
      e.damageIdleDespawnTimer = (e.damageIdleDespawnTimer ?? DAMAGE_IDLE_DESPAWN_SECONDS) - DT;
      if (e.damageIdleDespawnTimer <= 0) despawnIds.push(e.id);
    }
    if (e.overheadEmoteId && ctx.time >= e.overheadEmoteUntil) {
      e.overheadEmoteId = null;
      e.overheadEmoteUntil = 0;
    }
  }
  for (const id of despawnIds) dropEntityFromRoster(ctx, id);
}

// Fire delayed events whose time has come (subject to their guard), keep the rest.
// Iterates in insertion order; reordering events IS drift.
export function drainDelayedEvents(ctx: SimContext): void {
  if (ctx.delayedEvents.length === 0) return;
  const pending: DelayedEvent[] = [];
  for (const delayed of ctx.delayedEvents) {
    if (delayed.at <= ctx.time) {
      if (!delayed.guard || delayed.guard()) ctx.emit(delayed.event);
    } else pending.push(delayed);
  }
  ctx.delayedEvents = pending;
}

// Advance every ground hazard, pulsing it on its interval (the early-tick rng draw)
// and dropping it when expired. pulseGroundAoE stays on Sim (shared entry point) and
// is reached via the seam.
export function tickGroundAoEs(ctx: SimContext): void {
  for (let i = ctx.groundAoEs.length - 1; i >= 0; i--) {
    const effect = ctx.groundAoEs[i];
    const persistentSource = ctx.entities.get(effect.sourceId);
    const hourglassChangedRegion = Boolean(
      effect.temporalHourglass &&
        persistentSource &&
        ((effect.temporalHourglass.sourceOrigin.x <= DUNGEON_X_THRESHOLD &&
          persistentSource.pos.x <= DUNGEON_X_THRESHOLD &&
          effect.temporalHourglass.sourceZoneId !== zoneAt(persistentSource.pos.z).id) ||
          (persistentSource.pos.x - effect.temporalHourglass.sourceOrigin.x) ** 2 +
            (persistentSource.pos.z - effect.temporalHourglass.sourceOrigin.z) ** 2 >
            300 ** 2),
    );
    if (
      ((effect.frostRing || effect.hunterTrap) && !persistentSource) ||
      (effect.temporalHourglass && (!persistentSource || persistentSource.dead)) ||
      hourglassChangedRegion
    ) {
      ctx.groundAoEs.splice(i, 1);
      continue;
    }
    effect.remaining -= DT;
    if (effect.frostRing) {
      if (effect.remaining > CAST_COMPLETE_EPS) tickRingOfFrost(ctx, effect);
      if (effect.remaining <= CAST_COMPLETE_EPS) ctx.groundAoEs.splice(i, 1);
      continue;
    }
    if (effect.hunterTrap) {
      if (effect.remaining > CAST_COMPLETE_EPS) tickHunterTrap(ctx, effect);
      if (effect.remaining <= CAST_COMPLETE_EPS || effect.hunterTrap.triggered) {
        ctx.groundAoEs.splice(i, 1);
      }
      continue;
    }
    if (effect.temporalHourglass) {
      if (effect.remaining > CAST_COMPLETE_EPS && tickTemporalHourglassGround(ctx, effect)) {
        ctx.groundAoEs.splice(i, 1);
        continue;
      }
      if (effect.remaining <= CAST_COMPLETE_EPS) ctx.groundAoEs.splice(i, 1);
      continue;
    }
    effect.tickTimer -= DT;
    while (effect.tickTimer <= CAST_COMPLETE_EPS && effect.remaining > CAST_COMPLETE_EPS) {
      effect.tickTimer += effect.interval;
      ctx.pulseGroundAoE(effect);
    }
    if (effect.remaining <= CAST_COMPLETE_EPS) ctx.groundAoEs.splice(i, 1);
  }
}

// -------------------------------------------------------------------------
// Player death / respawn
// -------------------------------------------------------------------------

// The outdoor/dungeon release-spirit flow MOVED to src/sim/spirit.ts (the WoW-style
// ghost loop). The in-delve respawn stays here (delves keep their own bounded
// death rules) and spirit.ts calls into it for delve positions.
export function releaseSpiritInDelve(ctx: SimContext, pid: number): void {
  const r = ctx.resolve(pid);
  if (!r?.e.dead) return;
  const run = ctx.delveRunForPlayer(pid);
  if (!run) return;
  const deaths = (run.deathsThisRun[pid] ?? 0) + 1;
  run.deathsThisRun[pid] = deaths;
  if (deaths >= 2) {
    r.e.dead = false;
    ctx.failDelveRun(run);
    return;
  }
  const p = r.e;
  p.dead = false;
  const entry = ctx.delveModuleEntry(run);
  p.pos = entry;
  p.prevPos = { ...entry };
  rebucketEntity(ctx, p);
  // The Drowned Litany finale: in-flight Tolling Bells and Blackwater Mark
  // puddles must not outlive the death, or the respawned player can be hit
  // (or insta-killed) by an effect that was already active before they died.
  clearDrownedLitanyBellsAndMarks(ctx, run);
  p.facing = 0;
  // A held movement key at the moment of death must not carry over into the respawned
  // body, or it walks off on its own with no input held (same fix as the graveyard
  // release/revive flow in spirit.ts).
  Object.assign(r.meta.moveInput, emptyMoveInput());
  // The Keeper's Toll persists through a delve death too (see resurrection.ts); every
  // other aura clears on respawn.
  p.auras = aurasSurvivingDeath(p.auras);
  p.ccDr.clear();
  recalcPlayerStats(p, r.meta.cls, r.meta.equipment, r.meta.talentMods, r.meta.equipmentInstance);
  p.hp = Math.max(1, Math.round(p.maxHp * 0.5));
  p.resource =
    p.resourceType === 'mana'
      ? Math.round(p.maxResource * 0.5)
      : p.resourceType === 'energy'
        ? 100
        : 0;
  p.targetId = null;
  p.combatTimer = 99;
  p.inCombat = false;
  // The owner-dead arm of updateDelveCompanion despawns the auto-companion (and
  // clears run.companion) while the player is dead. Re-spawn her here so she is
  // back at the player's side promptly on release, same as a fresh delve entry.
  // Despawn any stale reference first (belt and suspenders: a caller that
  // releases without an intervening tick, e.g. a direct test/parity drive,
  // still has a live run.companion at this point) so the guard on
  // spawnDelveCompanion never no-ops. This draws no rng and does not touch
  // run.companionReviveUsed, so the once-per-run revive boon is unaffected.
  const delve = DELVES[run.delveId];
  if (run.partyKey?.startsWith('solo:') && delve?.autoCompanionId) {
    if (run.companion) ctx.despawnDelveCompanion(run);
    ctx.spawnDelveCompanion(run, pid, delve.autoCompanionId);
  }
  ctx.emit({ type: 'respawn', pid });
}

// Readout for "/graveyard": names the graveyard this position falls back to. Pure
// (zone lookups only); routed through this.error at the call site, so the S3 i18n
// guard does not see it as a literal emit.
export function graveyardReadout(p: Entity): string {
  const dungeon = dungeonAt(p.pos.x);
  const zone = zoneAt(dungeon ? dungeon.doorPos.z : p.pos.z);
  const gy = zone.graveyard;
  return `If you fall here, your spirit returns to the ${zone.name} graveyard at (${Math.floor(gy.x)}, ${Math.floor(gy.z)}).`;
}
