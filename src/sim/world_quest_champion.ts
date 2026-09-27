// Optional champion after a simple World Quest.
//
// When a plain kill, gather, interact or delivery world quest completes, a
// promoted champion of the site rises next to the quest area: several times
// the health of its kind, larger, standing idle until pulled. Nothing about the
// quest waits on it. It is a shared world mob: anyone on the site may fight it,
// and when it falls EVERY player on its hate table (pets credit their owner)
// who is still alive nearby earns the champion purse, so a group that arrives
// mid-fight is never locked out. An unclaimed champion fades after a few
// minutes so a site never keeps a permanent elite.
//
// Placement is rng-free (a fixed offset from the area centre) and the champion
// is a summoned, run-scoped mob (never respawns in place). State is keyed by
// SimContext in a module WeakMap, transient by design, like the rift ambush.

import { MOBS } from './data';
import { createMob } from './entity';
import { applyDungeonSpawnMinibossTuning } from './instances/dungeon_spawn_miniboss';
import type { PlayerMeta } from './sim';
import type { SimContext } from './sim_context';
import type { Entity, MobTemplate, WorldQuestBannerId, WorldQuestDef } from './types';
import { awardWorldQuestBonusCopper, worldQuestBonusCopper } from './world_quest_bonus';

export const WORLD_QUEST_CHAMPION_TYPES: ReadonlySet<WorldQuestDef['objective']['type']> = new Set([
  'kill',
  'gather',
  'interact',
  'delivery',
]);
export const WORLD_QUEST_CHAMPION_TUNING = Object.freeze({
  healthMultiplier: 5,
  scale: 1.4,
  levelAboveQuest: 2,
  lifetimeSeconds: 300,
  creditYards: 80,
  alertYards: 120,
  offsetYards: 8,
  purse: Object.freeze({ base: 900, perLevel: 70 }),
});

export interface WorldQuestChampionState {
  questId: string;
  mobId: number;
  expiresAt: number;
  paid: boolean;
  lastTick: number;
  /** Player ids seen on the hate table while the champion lived: death clears
   *  the table before this pass runs, so the purse pays from this snapshot. */
  participants: number[];
}

const STATES = new WeakMap<SimContext, Map<string, WorldQuestChampionState>>();

function states(ctx: SimContext): Map<string, WorldQuestChampionState> {
  let map = STATES.get(ctx);
  if (!map) {
    map = new Map();
    STATES.set(ctx, map);
  }
  return map;
}

export function worldQuestChampionState(
  ctx: SimContext,
  questId: string,
): WorldQuestChampionState | undefined {
  return states(ctx).get(questId);
}

export function worldQuestOffersChampion(quest: WorldQuestDef): boolean {
  return WORLD_QUEST_CHAMPION_TYPES.has(quest.objective.type);
}

/** The champion's kind: the kill target itself, else the nearest hostile of the site. */
function championTemplate(ctx: SimContext, quest: WorldQuestDef): MobTemplate | null {
  if (quest.objective.type === 'kill') return MOBS[quest.objective.targetMobId] ?? null;
  let best: Entity | null = null;
  let bestDistance = 150;
  for (const e of ctx.entities.values()) {
    if (e.kind !== 'mob' || !e.hostile || e.summonedAdd || !e.templateId) continue;
    const d = Math.hypot(e.pos.x - quest.area.x, e.pos.z - quest.area.z);
    if (d < bestDistance) {
      best = e;
      bestDistance = d;
    }
  }
  return best?.templateId ? (MOBS[best.templateId] ?? null) : null;
}

function tellNear(ctx: SimContext, quest: WorldQuestDef, banner: WorldQuestBannerId): void {
  for (const meta of ctx.players.values()) {
    const e = ctx.entities.get(meta.entityId);
    if (!e || e.dead) continue;
    if (
      Math.hypot(e.pos.x - quest.area.x, e.pos.z - quest.area.z) <=
      WORLD_QUEST_CHAMPION_TUNING.alertYards
    )
      ctx.emit({ type: 'worldQuestBanner', banner, pid: meta.entityId });
  }
}

/** Completion hook: raise the champion once per site; a live one is left alone. */
export function summonWorldQuestChampion(
  ctx: SimContext,
  quest: WorldQuestDef,
  meta: PlayerMeta,
): boolean {
  if (!worldQuestOffersChampion(quest)) return false;
  const map = states(ctx);
  const live = map.get(quest.id);
  if (live) {
    const e = ctx.entities.get(live.mobId);
    if (e && !e.dead) return false;
  }
  const template = championTemplate(ctx, quest);
  if (!template) return false;
  const level = Math.max(
    template.minLevel,
    quest.minLevel + WORLD_QUEST_CHAMPION_TUNING.levelAboveQuest,
  );
  const pos = ctx.groundPos(
    quest.area.x + WORLD_QUEST_CHAMPION_TUNING.offsetYards,
    quest.area.z + WORLD_QUEST_CHAMPION_TUNING.offsetYards,
  );
  const mob = createMob(ctx.nextId++, template, level, pos);
  mob.summonedAdd = true;
  mob.runScoped = true;
  applyDungeonSpawnMinibossTuning(mob, {
    healthMultiplier: WORLD_QUEST_CHAMPION_TUNING.healthMultiplier,
    scale: WORLD_QUEST_CHAMPION_TUNING.scale,
  });
  ctx.addEntity(mob);
  mob.leashAnchor = { ...mob.pos };
  map.set(quest.id, {
    questId: quest.id,
    mobId: mob.id,
    expiresAt: ctx.time + WORLD_QUEST_CHAMPION_TUNING.lifetimeSeconds,
    paid: false,
    lastTick: -1,
    participants: [],
  });
  tellNear(ctx, quest, 'championRises');
  void meta;
  return true;
}

/** Players who took part: every hate-table entry, pets credited to their owner. */
function participantIds(ctx: SimContext, mob: Entity): number[] {
  const out = new Set<number>();
  for (const id of mob.threat.keys()) {
    const e = ctx.entities.get(id);
    const pid = e?.kind === 'player' ? e.id : (e?.ownerId ?? null);
    if (pid !== null && pid !== undefined && ctx.players.has(pid)) out.add(pid);
  }
  return [...out];
}

function rememberParticipants(ctx: SimContext, state: WorldQuestChampionState, mob: Entity): void {
  if (mob.threat.size === 0) return;
  const seen = new Set(state.participants);
  for (const pid of participantIds(ctx, mob)) seen.add(pid);
  state.participants = [...seen];
}

function anyoneNear(ctx: SimContext, mob: Entity): boolean {
  for (const meta of ctx.players.values()) {
    const e = ctx.entities.get(meta.entityId);
    if (!e || e.dead) continue;
    if (
      Math.hypot(e.pos.x - mob.pos.x, e.pos.z - mob.pos.z) <=
      WORLD_QUEST_CHAMPION_TUNING.creditYards
    )
      return true;
  }
  return false;
}

/** Once per tick: pay a fallen champion's participants, fade an unclaimed one. */
export function updateWorldQuestChampions(ctx: SimContext): void {
  const map = STATES.get(ctx);
  if (!map || map.size === 0) return;
  for (const [questId, state] of map) {
    if (state.lastTick === ctx.tickCount) continue;
    state.lastTick = ctx.tickCount;
    const mob = ctx.entities.get(state.mobId);
    if (!mob) {
      map.delete(questId);
      continue;
    }
    if (mob.dead) {
      if (!state.paid) {
        state.paid = true;
        rememberParticipants(ctx, state, mob);
        for (const pid of state.participants) {
          const meta = ctx.players.get(pid);
          const e = meta && ctx.entities.get(meta.entityId);
          if (!meta || !e || e.dead) continue;
          if (
            Math.hypot(e.pos.x - mob.pos.x, e.pos.z - mob.pos.z) >
            WORLD_QUEST_CHAMPION_TUNING.creditYards
          )
            continue;
          awardWorldQuestBonusCopper(
            ctx,
            meta,
            worldQuestBonusCopper(
              WORLD_QUEST_CHAMPION_TUNING.purse.base,
              WORLD_QUEST_CHAMPION_TUNING.purse.perLevel,
              e.level,
            ),
          );
        }
      }
      continue;
    }
    rememberParticipants(ctx, state, mob);
    // Fade once the lifetime is up, unless someone alive is still on the site fighting it.
    if (ctx.time >= state.expiresAt && (mob.threat.size === 0 || !anyoneNear(ctx, mob))) {
      for (const meta of ctx.players.values()) {
        const p = ctx.entities.get(meta.entityId);
        if (p?.targetId === mob.id) p.targetId = null;
      }
      ctx.dropEntity(mob.id);
      map.delete(questId);
    }
  }
}

/** Test-only: forget every champion on this context. */
export function resetWorldQuestChampionsForTest(ctx: SimContext): void {
  STATES.delete(ctx);
}
