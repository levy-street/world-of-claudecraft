// Defense events: "hold the position beside an allied NPC against waves". A
// DefenseSiteDef (content) plants a world-owned ally (src/sim/ally.ts) at a
// site; a player with the linked quest ACTIVE talks to the site NPC to arm the
// event, scripted enemy waves spawn at fixed offsets pre-aggroed onto the
// ally, and every quest-holder inside the radius earns wave-by-wave objective
// credit. The ally dying (or every participant leaving) fails and resets the
// event after a cooldown.
//
// Determinism: wave composition, offsets, and levels are all fixed data; this
// module draws NO rng, ever. Spawned wave mobs advance ctx.nextId like any
// other spawn and despawn through the roster ops, so parity re-records only
// when CONTENT lands, never from the machinery.
//
// System module behind SimContext: functions only; the per-site state lives on
// Sim as the ctx.defenseEvents view (world state, like mob positions: it is
// deliberately not persisted; a restart resets sites to idle and quest counts
// simply re-earn).

import { type AllyDirective, spawnAllyAt } from '../ally';
import { DEFENSE_SITES, MOBS, QUESTS } from '../data';
import { createMob } from '../entity';
import { checkQuestReady } from '../quests/quest_credit';
import type { PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';
import { addThreat } from '../threat';
import { type DefenseSiteDef, DT, dist2d, type Entity } from '../types';

export interface DefenseEventState {
  siteId: string;
  allyEntityId: number;
  phase: 'idle' | 'prep' | 'wave' | 'cooldown';
  /** Waves fully repelled so far this run. */
  wave: number;
  /** Seconds until the next phase step (prep delay, next wave, cooldown end). */
  timer: number;
  waveMobIds: number[];
  /** Quest-holding pids seen in radius this run (credit set, refreshed per wave). */
  participants: Set<number>;
  /** Throttle for the once-per-second abandon check. */
  abandonCheck: number;
}

function directiveFor(site: DefenseSiteDef): AllyDirective {
  return {
    post: { x: site.pos.x, y: 0, z: site.pos.z },
    engageRadius: site.radius,
    moveTo: null,
  };
}

/** Sim-ctor spawner: plant every site's defender ally. Draws no rng; runs in
 *  the documented rng-free ctor slot (after the Spirit Healers). */
export function spawnDefenseSites(ctx: SimContext): void {
  for (const site of Object.values(DEFENSE_SITES)) {
    const ally = spawnAllyAt(
      ctx,
      site.allyTemplateId,
      site.allyLevel,
      site.pos.x,
      site.pos.z,
      Math.PI,
      directiveFor(site),
    );
    ctx.defenseEvents.set(site.id, {
      siteId: site.id,
      allyEntityId: ally.id,
      phase: 'idle',
      wave: 0,
      timer: 0,
      waveMobIds: [],
      participants: new Set(),
      abandonCheck: 0,
    });
  }
}

/** Quest-holders currently inside the site radius. */
function questHoldersInRadius(ctx: SimContext, site: DefenseSiteDef): PlayerMeta[] {
  const out: PlayerMeta[] = [];
  for (const meta of ctx.players.values()) {
    const e = ctx.entities.get(meta.entityId);
    if (!e || e.dead) continue;
    if (meta.questLog.get(site.questId)?.state !== 'active') continue;
    if (dist2d(e.pos, { x: site.pos.x, y: 0, z: site.pos.z }) > site.radius) continue;
    out.push(meta);
  }
  return out;
}

function setParticipantCounts(ctx: SimContext, site: DefenseSiteDef, count: number): void {
  const state = ctx.defenseEvents.get(site.id);
  if (!state) return;
  const quest = QUESTS[site.questId];
  const obj = quest.objectives[site.objectiveIndex];
  for (const pid of state.participants) {
    const meta = ctx.players.get(pid);
    const qp = meta?.questLog.get(site.questId);
    if (!meta || !qp || qp.state !== 'active') continue;
    if (qp.counts[site.objectiveIndex] === count) continue;
    qp.counts[site.objectiveIndex] = count;
    meta.counters.questProgress++;
    ctx.emit({
      type: 'questProgress',
      questId: site.questId,
      text: `${obj.label}: ${count}/${obj.count}`,
      pid,
    });
    checkQuestReady(ctx, qp, meta);
  }
}

/** Fixed-offset, fixed-level wave spawn, pre-aggroed onto the site's ally so
 *  the assault starts marching immediately. Zero rng draws. */
function spawnWave(ctx: SimContext, site: DefenseSiteDef, state: DefenseEventState): void {
  const ally = ctx.entities.get(state.allyEntityId);
  state.waveMobIds = [];
  for (const spawn of site.waves[state.wave].spawns) {
    const template = MOBS[spawn.mobId];
    const mob = createMob(
      ctx.nextId++,
      template,
      spawn.level,
      ctx.groundPos(site.pos.x + spawn.dx, site.pos.z + spawn.dz),
    );
    ctx.addEntity(mob);
    if (ally && !ally.dead) {
      addThreat(mob, ally.id, 1);
      mob.aggroTargetId = ally.id;
      mob.aiState = 'chase';
      mob.inCombat = true;
    }
    state.waveMobIds.push(mob.id);
  }
}

// Failure cleanup: living leftovers vanish; corpses stay lootable but must
// never respawn in place (the normal death path armed their respawnTimer).
function despawnWave(ctx: SimContext, state: DefenseEventState): void {
  for (const id of state.waveMobIds) {
    const m = ctx.entities.get(id);
    if (!m) continue;
    if (m.dead) m.respawnTimer = Number.POSITIVE_INFINITY;
    else ctx.dropEntity(id);
  }
  state.waveMobIds = [];
}

// Wave-clear sweep: corpses remain for looting, never respawn; the tracking
// list resets for the next wave.
function releaseWaveCorpses(ctx: SimContext, state: DefenseEventState): void {
  for (const id of state.waveMobIds) {
    const m = ctx.entities.get(id);
    if (m?.dead) m.respawnTimer = Number.POSITIVE_INFINITY;
  }
  state.waveMobIds = [];
}

function emitToParticipants(ctx: SimContext, state: DefenseEventState, ev: object): void {
  for (const pid of state.participants) {
    ctx.emit({ ...(ev as Record<string, unknown>), pid } as never);
  }
}

/** talkToNpc hook: arm the site when a quest-holder talks to its NPC while the
 *  event is idle and they stand inside the radius. Returns true when it
 *  consumed the interaction. */
export function tryStartSiteEvent(ctx: SimContext, npc: Entity, meta: PlayerMeta): boolean {
  for (const site of Object.values(DEFENSE_SITES)) {
    if (site.npcId !== npc.templateId) continue;
    const state = ctx.defenseEvents.get(site.id);
    if (!state || state.phase !== 'idle') return false;
    if (meta.questLog.get(site.questId)?.state !== 'active') return false;
    const e = ctx.entities.get(meta.entityId);
    if (!e || dist2d(e.pos, npc.pos) > site.radius) return false;
    const ally = ctx.entities.get(state.allyEntityId);
    if (!ally || ally.dead) return false;
    state.phase = 'prep';
    state.wave = 0;
    state.timer = site.waves[0].delaySeconds;
    state.participants = new Set(questHoldersInRadius(ctx, site).map((m) => m.entityId));
    setParticipantCounts(ctx, site, 0);
    emitToParticipants(ctx, state, {
      type: 'defenseWave',
      siteId: site.id,
      wave: 0,
      totalWaves: site.waves.length,
    });
    return true;
  }
  return false;
}

/** Ally-death fan-out target: fail any running event holding that ally. */
export function onAllyDeathForDefense(ctx: SimContext, ally: Entity): void {
  for (const site of Object.values(DEFENSE_SITES)) {
    const state = ctx.defenseEvents.get(site.id);
    if (!state || state.allyEntityId !== ally.id) continue;
    if (state.phase === 'prep' || state.phase === 'wave') {
      failEvent(ctx, site, state);
    } else {
      // idle/cooldown death (wandering mob kill): just schedule the respawn
      state.phase = 'cooldown';
      state.timer = site.cooldownSeconds;
    }
  }
}

function failEvent(ctx: SimContext, site: DefenseSiteDef, state: DefenseEventState): void {
  despawnWave(ctx, state);
  setParticipantCounts(ctx, site, 0);
  emitToParticipants(ctx, state, { type: 'defenseResult', siteId: site.id, won: false });
  state.phase = 'cooldown';
  state.timer = site.cooldownSeconds;
  state.wave = 0;
}

/** Per-tick driver (end-of-tick system block, after the delve runs). Touches
 *  nothing while every site is idle, so pre-content parity stays green. */
export function updateDefenseEvents(ctx: SimContext): void {
  for (const site of Object.values(DEFENSE_SITES)) {
    const state = ctx.defenseEvents.get(site.id);
    if (!state || state.phase === 'idle') continue;

    if (state.phase === 'cooldown') {
      state.timer -= DT;
      if (state.timer > 0) continue;
      // replace a dead defender with a fresh one at the post
      const ally = ctx.entities.get(state.allyEntityId);
      if (!ally || ally.dead) {
        if (ally) ctx.dropEntity(ally.id);
        const fresh = spawnAllyAt(
          ctx,
          site.allyTemplateId,
          site.allyLevel,
          site.pos.x,
          site.pos.z,
          Math.PI,
          directiveFor(site),
        );
        state.allyEntityId = fresh.id;
      }
      state.phase = 'idle';
      state.wave = 0;
      state.participants.clear();
      continue;
    }

    // prep/wave: abandon check once per second of sim time
    state.abandonCheck += DT;
    if (state.abandonCheck >= 1) {
      state.abandonCheck = 0;
      if (questHoldersInRadius(ctx, site).length === 0) {
        failEvent(ctx, site, state);
        continue;
      }
    }

    if (state.phase === 'prep') {
      state.timer -= DT;
      if (state.timer > 0) continue;
      spawnWave(ctx, site, state);
      state.phase = 'wave';
      continue;
    }

    // wave phase: cleared when every wave mob is dead or gone
    const alive = state.waveMobIds.some((id) => {
      const m = ctx.entities.get(id);
      return m && !m.dead;
    });
    if (alive) continue;
    releaseWaveCorpses(ctx, state);
    state.wave++;
    // refresh the credit set with everyone holding the line right now
    for (const meta of questHoldersInRadius(ctx, site)) state.participants.add(meta.entityId);
    setParticipantCounts(ctx, site, state.wave);
    emitToParticipants(ctx, state, {
      type: 'defenseWave',
      siteId: site.id,
      wave: state.wave,
      totalWaves: site.waves.length,
    });
    if (state.wave >= site.waves.length) {
      emitToParticipants(ctx, state, { type: 'defenseResult', siteId: site.id, won: true });
      state.phase = 'cooldown';
      state.timer = site.cooldownSeconds;
    } else {
      state.phase = 'prep';
      state.timer = site.waves[state.wave].delaySeconds;
    }
  }
}
