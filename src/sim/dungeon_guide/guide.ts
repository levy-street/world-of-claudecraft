// The dungeon guide system: an optional lore NPC who waits at a dungeon's
// entrance each run, offers to walk with the group, and if any member accepts
// follows behind them speaking short lines at authored moments, then plays a
// finale when the last boss falls. Everything a guide says and where he goes is
// a data record (content/dungeon_guides.ts); this module is the behavior,
// behind the SimContext seam, ticked once per claim from instances/dungeons.ts
// updateInstances.
//
// Zero gameplay effect, by construction: he is a friendly NPC kept in the
// claim's npcIds (packs, gates, the boss chain pull and wipe checks never see
// him), he never deals or takes damage, holds no threat, blocks no one, and
// counts for nothing. Deterministic: the only randomness, which variant of a
// line this run speaks, is drawn from a PRIVATE Rng seeded by the claim, so
// the shared stream is never touched; every timer counts sim time.

import { DUNGEON_GUIDES, dungeonGuideForNpc } from '../content/dungeon_guides';
import { DUNGEONS } from '../data';
import { grantDeed } from '../deeds';
import { dungeonGateState } from '../instances/dungeon_gates';
import { instanceClaimHolds } from '../instances/dungeons';
import { kitHash } from '../mob/trash_kit/targets';
import { Rng } from '../rng';
import type { InstanceSlot } from '../sim';
import type { SimContext } from '../sim_context';
import { angleTo, DT, dist2d, type Entity, INTERACT_RANGE, type Vec3 } from '../types';
import { catchUpPoint, needsCatchUp, recordTrail, stepAlongPath, stepAlongTrail } from './follow';
import { enqueueWhere, pickLine, speakLine } from './speech';
import type { DungeonGuideDef, DungeonGuideRun, GuideLineDef } from './types';

/** Trigger scans (areas, sightings, gates) run at this many ticks apart. */
const SCAN_TICKS = 5;
/** How far a member may stand from the guide and still answer him (the
 *  client's own interact reach plus its slack). */
export const GUIDE_ANSWER_RANGE = INTERACT_RANGE + 2;

// ---- the claim ---------------------------------------------------------------

function originOf(ctx: SimContext, inst: InstanceSlot): { x: number; z: number } {
  return ctx.instanceOriginOf(inst);
}

/** Is a world position inside this claim (the one claim-membership envelope
 *  every other instance question uses)? */
function inClaim(inst: InstanceSlot, p: Vec3): boolean {
  return instanceClaimHolds(inst, p);
}

/** Every player standing in the claim, dead or alive (who hears him), in
 *  entity-id order. */
function claimListeners(ctx: SimContext, inst: InstanceSlot): Entity[] {
  const out: Entity[] = [];
  for (const meta of ctx.players.values()) {
    const e = ctx.entities.get(meta.entityId);
    if (e && !e.ghost && inClaim(inst, e.pos)) out.push(e);
  }
  return out.sort((a, b) => a.id - b.id);
}

/** The guide entity of a claim, or null. */
function guideOf(ctx: SimContext, inst: InstanceSlot, def: DungeonGuideDef): Entity | null {
  for (const id of inst.npcIds) {
    const e = ctx.entities.get(id);
    if (e && e.kind === 'npc' && e.templateId === def.npcId) return e;
  }
  return null;
}

/** The live claim whose npc roster holds this entity. */
function claimOfNpc(ctx: SimContext, npcId: number): InstanceSlot | null {
  for (const inst of ctx.instances) {
    if (inst.partyKey !== null && inst.npcIds.includes(npcId)) return inst;
  }
  return null;
}

/** Is a boss in its fight (pulled and not walking home)? */
function inFight(boss: Entity): boolean {
  return (
    !boss.dead &&
    boss.hp > 0 &&
    boss.inCombat &&
    boss.aggroTargetId !== null &&
    (boss.aiState === 'chase' || boss.aiState === 'attack')
  );
}

interface ClaimView {
  inst: InstanceSlot;
  origin: { x: number; z: number };
  heroic: boolean;
  members: Entity[];
  listeners: Entity[];
  /** First roster mob of each template the guide cares about, dead or alive. */
  bosses: Map<string, Entity>;
}

/** The boss templates a guide watches, built once per record (a static
 *  table read every tick, so it is never rebuilt per tick). */
const BOSS_IDS = new WeakMap<DungeonGuideDef, ReadonlySet<string>>();

function bossIdsOf(def: DungeonGuideDef): ReadonlySet<string> {
  const cached = BOSS_IDS.get(def);
  if (cached) return cached;
  const ids = new Set<string>([def.offerClosesOn, ...def.bossIds, ...def.finale.bossIds]);
  for (const line of def.lines) {
    if (line.beforeBoss) ids.add(line.beforeBoss);
    if (line.trigger.kind === 'bossNear') ids.add(line.trigger.bossId);
    if (line.trigger.kind === 'bossDead') for (const b of line.trigger.bossIds) ids.add(b);
  }
  BOSS_IDS.set(def, ids);
  return ids;
}

function viewOf(ctx: SimContext, inst: InstanceSlot, def: DungeonGuideDef): ClaimView {
  const wanted = bossIdsOf(def);
  const bosses = new Map<string, Entity>();
  for (const id of inst.mobIds) {
    const e = ctx.entities.get(id);
    if (e && e.kind === 'mob' && wanted.has(e.templateId) && !bosses.has(e.templateId)) {
      bosses.set(e.templateId, e);
    }
  }
  const listeners = claimListeners(ctx, inst);
  return {
    inst,
    origin: originOf(ctx, inst),
    heroic: inst.difficulty === 'heroic',
    members: listeners.filter((p) => !p.dead),
    listeners,
    bosses,
  };
}

function bossStarted(view: ClaimView, bossId: string): boolean {
  const boss = view.bosses.get(bossId);
  return !!boss && (boss.dead || inFight(boss));
}

function anyBossFight(view: ClaimView, def: DungeonGuideDef): boolean {
  return def.bossIds.some((id) => {
    const boss = view.bosses.get(id);
    return !!boss && inFight(boss);
  });
}

function allDead(view: ClaimView, bossIds: readonly string[]): boolean {
  return bossIds.every((id) => view.bosses.get(id)?.dead === true);
}

// ---- the run -----------------------------------------------------------------

/** A fresh run: the offer open, nothing said, each variant group's line drawn
 *  from a private stream seeded by the claim (never the shared rng). */
export function freshGuideRun(def: DungeonGuideDef, seed: number): DungeonGuideRun {
  const rng = new Rng(seed >>> 0 || 1);
  const groups: Record<string, string[]> = {};
  for (const line of def.lines) {
    if (!line.variant) continue;
    const ids = groups[line.variant] ?? [];
    ids.push(line.id);
    groups[line.variant] = ids;
  }
  const chosen: Record<string, string> = {};
  for (const [group, ids] of Object.entries(groups))
    chosen[group] = ids[rng.int(0, ids.length - 1)];
  return {
    guideId: def.id,
    offer: 'open',
    done: new Set(),
    queue: [],
    nextSpeechAt: 0,
    chosen,
    trail: [],
    wiped: false,
    finale: null,
    pathIndex: 0,
  };
}

/** The claim's variant seed: its slot, the moment it was claimed and the
 *  guide's entity id, so two runs (or two groups) rarely hear the same set. */
export function guideSeed(inst: InstanceSlot, npc: Entity): number {
  return kitHash(npc.id, inst.slot * 7919 + Math.round((inst.claimedAt ?? 0) * 20));
}

function ensureRun(def: DungeonGuideDef, inst: InstanceSlot, npc: Entity): DungeonGuideRun {
  if (!npc.guideRun || npc.guideRun.guideId !== def.id) {
    npc.guideRun = freshGuideRun(def, guideSeed(inst, npc));
    npc.guideState = 'open';
  }
  return npc.guideRun;
}

function setOffer(npc: Entity, run: DungeonGuideRun, offer: DungeonGuideRun['offer']): void {
  run.offer = offer;
  npc.guideState = offer;
}

function place(ctx: SimContext, npc: Entity, pos: Vec3, facing: number): void {
  npc.pos.x = pos.x;
  npc.pos.y = pos.y;
  npc.pos.z = pos.z;
  npc.facing = facing;
  ctx.rebucket(npc);
}

// ---- triggers ----------------------------------------------------------------

function memberNear(view: ClaimView, x: number, z: number, r: number): boolean {
  const wx = view.origin.x + x;
  const wz = view.origin.z + z;
  return view.members.some((p) => Math.hypot(p.pos.x - wx, p.pos.z - wz) <= r);
}

function liveMobOf(ctx: SimContext, inst: InstanceSlot, ids: readonly string[]): Entity[] {
  const out: Entity[] = [];
  const add = (e: Entity | undefined) => {
    if (e && e.kind === 'mob' && !e.dead && ids.includes(e.templateId)) out.push(e);
  };
  for (const id of inst.mobIds) {
    const e = ctx.entities.get(id);
    add(e);
    if (e && e.summonedIds.length > 0) for (const s of e.summonedIds) add(ctx.entities.get(s));
  }
  return out;
}

function triggerHolds(ctx: SimContext, view: ClaimView, line: GuideLineDef): boolean {
  const t = line.trigger;
  switch (t.kind) {
    case 'area':
      return memberNear(view, t.x, t.z, t.r);
    case 'sight':
      return liveMobOf(ctx, view.inst, t.mobIds).some((m) =>
        view.members.some((p) => dist2d(p.pos, m.pos) <= t.r),
      );
    case 'mobAlive':
      return liveMobOf(ctx, view.inst, t.mobIds).length > 0;
    case 'gateOpen': {
      const gate = DUNGEONS[view.inst.dungeonId]?.gates?.find((g) => g.id === t.gateId);
      return !!gate && dungeonGateState(ctx, view.inst, gate) !== 'closed';
    }
    case 'bossNear': {
      const boss = view.bosses.get(t.bossId);
      return (
        !!boss &&
        !boss.dead &&
        !inFight(boss) &&
        view.members.some((p) => dist2d(p.pos, boss.pos) <= t.r)
      );
    }
    case 'bossDead':
      return allDead(view, t.bossIds);
    default:
      return false;
  }
}

const SCANNED = new Set(['area', 'sight', 'mobAlive', 'gateOpen', 'bossNear', 'bossDead']);

// ---- the tick ----------------------------------------------------------------

/** One tick of every dungeon guide in every live claim. */
export function tickDungeonGuides(ctx: SimContext): void {
  for (const inst of ctx.instances) {
    if (inst.partyKey === null) continue;
    for (const def of Object.values(DUNGEON_GUIDES)) {
      if (def.dungeonId !== inst.dungeonId) continue;
      const npc = guideOf(ctx, inst, def);
      if (npc) tickGuide(ctx, def, inst, npc);
    }
  }
}

function tickGuide(ctx: SimContext, def: DungeonGuideDef, inst: InstanceSlot, npc: Entity): void {
  const run = ensureRun(def, inst, npc);
  const view = viewOf(ctx, inst, def);
  const bossFight = anyBossFight(view, def);
  // The offer stands until the group's first boss fight of record begins.
  if ((run.offer === 'open' || run.offer === 'declined') && bossStarted(view, def.offerClosesOn)) {
    setOffer(npc, run, 'closed');
  }
  if (run.offer === 'joined') tickJoined(ctx, def, run, npc, view, bossFight);
  const line = pickLine(def, run, ctx.time, bossFight, (id) => bossStarted(view, id));
  if (line) {
    speakLine(ctx, def, run, npc, line, view.listeners, view.heroic);
    if (line.emote && run.finale === 'speaking') beginSong(ctx, def, run, npc, view);
  }
  if (run.finale === 'singing') loopSong(npc, def);
}

function tickJoined(
  ctx: SimContext,
  def: DungeonGuideDef,
  run: DungeonGuideRun,
  npc: Entity,
  view: ClaimView,
  bossFight: boolean,
): void {
  // The wipe: everyone in the claim lies dead (an edge, once per run).
  const wiped = view.listeners.length > 0 && view.members.length === 0;
  if (wiped && !run.wiped)
    enqueueWhere(def, run, view.heroic, ctx.time, (l) => l.trigger.kind === 'wipe');
  run.wiped = wiped;
  // The finale: the last boss fell. The deed goes to the whole claim at once.
  if (run.finale === null && allDead(view, def.finale.bossIds)) {
    run.finale = 'walking';
    run.pathIndex = 0;
    grantGuideDeed(ctx, view, def);
  }
  if (run.finale !== null) {
    if (run.finale === 'walking') walkFinale(ctx, def, run, npc, view);
    return;
  }
  if (ctx.tickCount % SCAN_TICKS === 0) {
    enqueueWhere(def, run, view.heroic, ctx.time, (l) =>
      SCANNED.has(l.trigger.kind) ? triggerHolds(ctx, view, l) : false,
    );
  }
  followGroup(ctx, def, run, npc, view, bossFight);
}

function followGroup(
  ctx: SimContext,
  def: DungeonGuideDef,
  run: DungeonGuideRun,
  npc: Entity,
  view: ClaimView,
  bossFight: boolean,
): void {
  if (view.members.length === 0) return;
  // The rearmost member: the living one nearest him (ties by entity id).
  let leader = view.members[0];
  let best = dist2d(npc.pos, leader.pos);
  for (const p of view.members) {
    const d = dist2d(npc.pos, p.pos);
    if (d < best) {
      best = d;
      leader = p;
    }
  }
  recordTrail(run, leader.pos);
  // In a fight he stands where he is; a boss fight roots him even when a
  // sealed gate shuts him out.
  if (bossFight || view.members.some((p) => p.inCombat)) {
    npc.facing = angleTo(npc.pos, leader.pos);
    return;
  }
  if (needsCatchUp(npc.pos, leader.pos, def.follow)) {
    const snap = catchUpPoint(run.trail, leader.pos, def.follow.snapBehind);
    if (snap) {
      run.trail = snap.rest;
      place(ctx, npc, snap.at, angleTo(snap.at, leader.pos));
      npc.prevPos = { ...npc.pos };
      enqueueWhere(def, run, view.heroic, ctx.time, (l) => l.trigger.kind === 'catchUp');
      return;
    }
  }
  const step = stepAlongTrail(run, npc.pos, npc.facing, leader.pos, def.follow, DT);
  if (step.moved) place(ctx, npc, step.pos, step.facing);
  else npc.facing = step.facing;
}

// ---- the finale --------------------------------------------------------------

/** The finale's deed goes to everyone in the claim, and to every member who
 *  entered this run and is away from it right now (a released spirit running
 *  back from the graveyard still walked the Temple with him). */
function grantGuideDeed(ctx: SimContext, view: ClaimView, def: DungeonGuideDef): void {
  for (const meta of ctx.players.values()) {
    const e = ctx.entities.get(meta.entityId);
    if (!e) continue;
    if (inClaim(view.inst, e.pos) || view.inst.enteredBy.has(meta.entityId)) {
      grantDeed(ctx, meta, def.finale.deedId);
    }
  }
}

function walkFinale(
  ctx: SimContext,
  def: DungeonGuideDef,
  run: DungeonGuideRun,
  npc: Entity,
  view: ClaimView,
): void {
  const path = def.finale.path.map((p) => ctx.groundPos(view.origin.x + p.x, view.origin.z + p.z));
  // Left far behind: he steps onto the walk's start (out of sight of it).
  if (run.pathIndex === 0 && dist2d(npc.pos, path[0]) > def.follow.catchUpDistance) {
    place(ctx, npc, path[0], npc.facing);
    npc.prevPos = { ...npc.pos };
    run.pathIndex = 1;
  }
  const step = stepAlongPath(npc.pos, npc.facing, path, run.pathIndex, def.follow.walkSpeed, DT);
  run.pathIndex = step.index;
  place(ctx, npc, step.pos, step.facing);
  if (run.pathIndex < path.length) return;
  const face = ctx.groundPos(view.origin.x + def.finale.face.x, view.origin.z + def.finale.face.z);
  npc.facing = angleTo(npc.pos, face);
  run.finale = 'speaking';
  enqueueWhere(def, run, view.heroic, ctx.time, (l) => l.trigger.kind === 'finale');
}

function beginSong(
  ctx: SimContext,
  def: DungeonGuideDef,
  run: DungeonGuideRun,
  npc: Entity,
  view: ClaimView,
): void {
  run.finale = 'singing';
  npc.guideState = 'singing';
  npc.castingAbility = def.finale.castId;
  npc.castTotal = def.finale.castSeconds;
  npc.castRemaining = def.finale.castSeconds;
  npc.castTargetId = null;
  npc.channeling = true;
  // Where the Choir's fallen lie: every slain roster mob of the listed
  // templates, in roster order (rounded to a decimetre for the wire).
  const spots: number[] = [];
  const r = (v: number) => Math.round(v * 10) / 10;
  for (const id of view.inst.mobIds) {
    const e = ctx.entities.get(id);
    if (e?.kind !== 'mob' || !e.dead) continue;
    if (!def.finale.dissolveMobIds.includes(e.templateId)) continue;
    spots.push(r(e.pos.x), r(e.pos.y), r(e.pos.z));
  }
  for (const p of view.listeners) {
    ctx.emit({ type: 'dungeonGuideFinale', guideId: def.id, npcId: npc.id, spots, pid: p.id });
  }
}

/** The song never ends while the claim lives: the channel bar refills each verse. */
function loopSong(npc: Entity, def: DungeonGuideDef): void {
  npc.castingAbility = def.finale.castId;
  npc.channeling = true;
  npc.castRemaining -= DT;
  if (npc.castRemaining <= 0) {
    npc.castTotal = def.finale.castSeconds;
    npc.castRemaining = def.finale.castSeconds;
  }
}

// ---- the answer --------------------------------------------------------------

/** A member's answer to the guide's offer ("Come with us" / "We go alone").
 *  Authoritative and silent on refusal: the sender must stand alive in the
 *  guide's own claim within reach of him while the offer stands. Any member
 *  may answer for the whole group, and a "go alone" can be taken back until
 *  the offer closes. */
export function answerDungeonGuide(
  ctx: SimContext,
  npcId: number,
  accept: boolean,
  pid?: number,
): void {
  const r = ctx.resolve(pid);
  if (!r || r.e.dead || r.e.ghost) return;
  const npc = ctx.entities.get(npcId);
  if (npc?.kind !== 'npc') return;
  const def = dungeonGuideForNpc(npc.templateId);
  if (!def) return;
  const inst = claimOfNpc(ctx, npcId);
  if (!inst || inst.dungeonId !== def.dungeonId) return;
  if (!inClaim(inst, r.e.pos)) return;
  if (dist2d(r.e.pos, npc.pos) > GUIDE_ANSWER_RANGE) return;
  const run = ensureRun(def, inst, npc);
  if (run.offer !== 'open' && run.offer !== 'declined') return;
  const heroic = inst.difficulty === 'heroic';
  if (accept) {
    setOffer(npc, run, 'joined');
    run.trail = [];
    enqueueWhere(def, run, heroic, ctx.time, (l) => l.trigger.kind === 'accept');
    return;
  }
  if (run.offer === 'declined') return;
  setOffer(npc, run, 'declined');
  enqueueWhere(def, run, heroic, ctx.time, (l) => l.trigger.kind === 'decline');
}
