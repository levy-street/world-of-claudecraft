// Trial 6, The Final Court: a VANILLA-combat free-for-all. Every survivor (the
// player plus the NPC field) drops into one circular arena and fights until a
// single champion remains, using the game's ordinary combat: the player targets
// (click or tab), auto-attacks, and casts abilities exactly as in the open world,
// with the selection reticle and target frame on their foe. What makes it work is
// hostility: gauntletCourtFoes (below) marks every live fellow contestant a foe,
// so Sim.isHostileTo returns true for them and the whole targeting/combat stack
// engages. A lethal blow routes to `eliminateContestant` instead of the normal
// death flow (no death screen), intercepted in dealDamage via gauntletCourtTakedown,
// the same shape the Fiesta takedown uses (social/fiesta.ts).
//
// Equalized HP: at the bell every fighter is normalized to the same hp pool
// (GAUNTLET.court.maxHp) so it stays a fair test; a player's real maxHp is banked
// and restored (ctx.recalcPlayer) the moment they leave the court. The player's
// swings deal their real (gear-scaled) damage; the NPC field deals the authored,
// flat strikeDamage through the normal damage path (dealDamage is post-mitigation,
// so it never touches armor and stays equal for all). The vitality field the
// standings board reads is reverse-mirrored from hp each tick.
//
// Determinism: NPC target re-evaluation draws from run.rng in the fixed fighter
// order (the trial.fighters Map's insertion order). Players fight with their own
// vanilla combat (resolved in the per-player tick); updateCourt runs in the
// end-of-tick block AFTER movement and drives only the NPC field.

import { GAUNTLET, GAUNTLET_VENUE } from '../content/gauntlet';
import type { SimContext } from '../sim_context';
import { angleTo, dist2d, type Entity, type Vec3 } from '../types';
import type {
  GauntletContestant,
  GauntletCourtFighter,
  GauntletCourtState,
  GauntletRun,
} from './state';
import { aliveContestants, cullNpcsToward, eliminateContestant } from './vitality';

// The arena centre in world coordinates (the venue anchor + the run origin).
function arenaCenter(run: GauntletRun): { cx: number; cz: number } {
  return { cx: run.origin.x + GAUNTLET_VENUE.court.x, cz: run.origin.z + GAUNTLET_VENUE.court.z };
}

export function startCourt(ctx: SimContext, run: GauntletRun): GauntletCourtState {
  const t = GAUNTLET.court;
  const { cx, cz } = arenaCenter(run);
  const fighters = new Map<number, GauntletCourtFighter>();
  // Every alive, non-spectating contestant fights. Spectators (already knocked
  // out) stay parked on the terrace.
  const roster = aliveContestants(run).filter(
    (c) => !(c.player && run.playerStates.get(c.entityId)?.spectating),
  );
  const placeR = t.arenaRadius * 0.72; // start ringed just inside the wall
  for (let i = 0; i < roster.length; i++) {
    const c = roster[i];
    const e = ctx.entities.get(c.entityId);
    if (!e) continue;
    const ang = (i / Math.max(1, roster.length)) * Math.PI * 2;
    e.pos = ctx.groundPos(cx + Math.sin(ang) * placeR, cz + Math.cos(ang) * placeR);
    e.prevPos = cloneVec(e.pos);
    e.facing = Math.atan2(-Math.sin(ang), -Math.cos(ang)); // face the centre
    e.targetId = null;
    e.autoAttack = false;
    const fighter = newFighter(ctx, c, e.maxHp);
    // Normalize to the shared pool. Everyone starts full and equal at the bell.
    e.maxHp = t.maxHp;
    e.hp = t.maxHp;
    c.vitality = GAUNTLET.vitalityMax;
    ctx.rebucket(e);
    fighters.set(c.entityId, fighter);
  }
  return { kind: 'court', fighters };
}

function newFighter(
  ctx: SimContext,
  c: GauntletContestant,
  savedMaxHp: number,
): GauntletCourtFighter {
  const t = GAUNTLET.court;
  // An opening beat before the first swing, plus a skill-scaled reaction delay
  // for NPCs (lower skill is slower off the mark). Deterministic (no rng).
  const react = c.player ? 0 : t.npcReactMaxS - (t.npcReactMaxS - t.npcReactMinS) * c.skill;
  return {
    entityId: c.entityId,
    player: c.player,
    skill: c.skill,
    targetId: null,
    swingReadyAt: ctx.time + t.strikeIntervalS + react,
    savedMaxHp,
    retargetAt: ctx.time,
  };
}

export function updateCourt(ctx: SimContext, run: GauntletRun, dt: number): boolean {
  const trial = run.trial;
  if (!trial || trial.kind !== 'court') return true;

  // Drop the records of fighters knocked out on an earlier tick.
  for (const [id, f] of trial.fighters) {
    const c = contestantOf(run, id);
    if (!c || c.eliminatedAtTrial !== null) trial.fighters.delete(id);
  }

  // Trial cap: resolve by highest remaining hp and end.
  if (ctx.time >= run.phaseEndsAt) {
    resolveByTimeout(ctx, run, trial);
    return true;
  }

  // Already down to a lone survivor (or none): crown and end.
  if (livingFighters(run, trial).length <= 1) return crown(ctx, run, trial);

  // Drive every fighter once, in the fixed insertion order (so the NPC rng draw
  // order is stable). A snapshot array guards against mid-loop map churn.
  for (const f of [...trial.fighters.values()]) {
    const c = contestantOf(run, f.entityId);
    if (!c || c.eliminatedAtTrial !== null) continue; // knocked out earlier this tick
    const e = ctx.entities.get(f.entityId);
    if (!e) continue;
    // Players fight with their OWN vanilla combat (auto-attack + abilities,
    // resolved in the per-player tick BEFORE this end-of-tick driver): the court
    // never swings or targets for them. Only the NPC field is driven here.
    if (!f.player) {
      updateNpc(ctx, run, trial, f, e, dt);
      npcStrike(ctx, run, trial, f, e);
    }
    clampToArena(ctx, run, e); // keep every fighter (player included) in the ring
    // Reverse-mirror the standings board / health meter from real hp (a live
    // fighter only; the eliminate path already zeroes a downed foe's vitality).
    if (c.eliminatedAtTrial === null) c.vitality = vitalityFromHp(e);
  }

  // A killing blow may have ended the melee: re-check.
  if (livingFighters(run, trial).length <= 1) return crown(ctx, run, trial);
  return false;
}

// Crown the lone survivor (or nobody, on a same-tick double-out), restore every
// player's real hp, and finish.
function crown(ctx: SimContext, run: GauntletRun, trial: GauntletCourtState): boolean {
  const living = livingFighters(run, trial);
  if (living.length === 1 && living[0].player) markFinished(ctx, run, living[0].entityId);
  for (const f of trial.fighters.values()) denormalize(ctx, run, f);
  cullNpcsToward(ctx, run); // no-op at <=1 alive; keeps the every-trial contract
  return true;
}

// Clock ran out with a crowd still up: the highest hp is champion (tie-break
// roster order); everyone else is knocked out.
function resolveByTimeout(ctx: SimContext, run: GauntletRun, trial: GauntletCourtState): void {
  const living = livingFighters(run, trial);
  if (living.length === 0) return;
  let champ = living[0];
  let champHp = hpOf(ctx, champ);
  for (const f of living) {
    const fhp = hpOf(ctx, f);
    if (fhp > champHp) {
      champ = f;
      champHp = fhp;
    }
  }
  for (const f of living) {
    if (f.entityId === champ.entityId) continue;
    courtEliminate(ctx, run, trial, f);
  }
  if (champ.player) markFinished(ctx, run, champ.entityId);
  for (const f of trial.fighters.values()) denormalize(ctx, run, f);
}

// One NPC fighter's tick: keep a target and close to melee reach. The swing
// itself is handled by the shared auto-attack (tryStrike).
function updateNpc(
  ctx: SimContext,
  run: GauntletRun,
  trial: GauntletCourtState,
  f: GauntletCourtFighter,
  e: Entity,
  dt: number,
): void {
  const t = GAUNTLET.court;
  if (ctx.time >= f.retargetAt || !isLiveEnemy(ctx, run, trial, f.entityId, f.targetId)) {
    f.targetId = pickTarget(ctx, run, trial, f, e);
    f.retargetAt = ctx.time + t.npcRetargetS * run.rng.range(0.7, 1.3);
  }
  const target = f.targetId !== null ? ctx.entities.get(f.targetId) : undefined;
  if (!target) return;
  const d = dist2d(e.pos, target.pos);
  const desired = t.strikeRange * 0.85; // press just inside reach
  if (d > desired) stepToward(ctx, e, target.pos.x, target.pos.z, t.npcMoveSpeed * dt);
  else e.facing = angleTo(e.pos, target.pos);
}

// One NPC auto-attack: swing at the current foe when it is in reach and the swing
// timer is up. The swing goes through the normal damage path (ctx.dealDamage), so
// it lands a real `damage` event (floaties) and a lethal blow routes to the Final
// Court takedown (dealDamage's gauntletCourtTakedown interception), exactly like a
// player's swing. dealDamage is post-mitigation, so the authored flat strikeDamage
// never touches armor and stays equal for every fighter.
function npcStrike(
  ctx: SimContext,
  run: GauntletRun,
  trial: GauntletCourtState,
  f: GauntletCourtFighter,
  e: Entity,
): void {
  const t = GAUNTLET.court;
  if (ctx.time < f.swingReadyAt) return;
  const foe = resolveFoe(ctx, run, trial, f, e);
  if (!foe) return;
  const te = ctx.entities.get(foe.entityId);
  if (!te || dist2d(e.pos, te.pos) > t.strikeRange) return;
  e.facing = angleTo(e.pos, te.pos);
  f.swingReadyAt = ctx.time + t.strikeIntervalS;
  // Flag both in-combat so the target's out-of-combat regen can't heal mid-fight.
  ctx.enterCombat(e, te);
  ctx.dealDamage(e, te, t.strikeDamage, false, 'physical', null, 'hit');
}

// Knock a fighter out at a timeout loss: zero their hp + vitality, restore, poof.
function courtEliminate(
  ctx: SimContext,
  run: GauntletRun,
  trial: GauntletCourtState,
  f: GauntletCourtFighter,
): void {
  const c = contestantOf(run, f.entityId);
  if (!c || c.eliminatedAtTrial !== null) return;
  const e = ctx.entities.get(f.entityId);
  if (e) e.hp = 0;
  c.vitality = 0;
  denormalize(ctx, run, f);
  eliminateContestant(ctx, run, c);
}

// -------------------------------------------------------------------------
// Targeting + helpers
// -------------------------------------------------------------------------

// Resolve a fighter's current foe to its contestant record (nearest live enemy
// as a fallback), or null if the arena is empty of enemies.
function resolveFoe(
  ctx: SimContext,
  run: GauntletRun,
  trial: GauntletCourtState,
  f: GauntletCourtFighter,
  e: Entity,
): GauntletContestant | null {
  let id = f.targetId;
  if (!isLiveEnemy(ctx, run, trial, f.entityId, id)) id = pickTarget(ctx, run, trial, f, e);
  return id !== null ? contestantOf(run, id) : null;
}

// The nearest live enemy fighter's entity id, or null. (Every fighter is hostile
// to every other: a free-for-all.)
function pickTarget(
  ctx: SimContext,
  run: GauntletRun,
  trial: GauntletCourtState,
  f: GauntletCourtFighter,
  e: Entity,
): number | null {
  let best: number | null = null;
  let bestD = Infinity;
  for (const other of trial.fighters.values()) {
    if (other.entityId === f.entityId) continue;
    const oc = contestantOf(run, other.entityId);
    if (!oc || oc.eliminatedAtTrial !== null) continue;
    const oe = ctx.entities.get(other.entityId);
    if (!oe) continue;
    const d = dist2d(e.pos, oe.pos);
    if (d < bestD) {
      bestD = d;
      best = other.entityId;
    }
  }
  return best;
}

function isLiveEnemy(
  ctx: SimContext,
  run: GauntletRun,
  trial: GauntletCourtState,
  selfId: number,
  id: number | null,
): boolean {
  if (id === null || id === selfId) return false;
  if (!trial.fighters.has(id)) return false;
  const c = contestantOf(run, id);
  return !!c && c.eliminatedAtTrial === null && ctx.entities.has(id);
}

function livingFighters(run: GauntletRun, trial: GauntletCourtState): GauntletCourtFighter[] {
  const out: GauntletCourtFighter[] = [];
  for (const f of trial.fighters.values()) {
    const c = contestantOf(run, f.entityId);
    if (c && c.eliminatedAtTrial === null) out.push(f);
  }
  return out;
}

function contestantOf(run: GauntletRun, id: number): GauntletContestant | null {
  return run.contestants.find((c) => c.entityId === id) ?? null;
}

function hpOf(ctx: SimContext, f: GauntletCourtFighter): number {
  return ctx.entities.get(f.entityId)?.hp ?? 0;
}

// The 0..vitalityMax board value for a fighter's current hp fraction.
function vitalityFromHp(e: Entity): number {
  return e.maxHp > 0 ? Math.max(0, Math.round((GAUNTLET.vitalityMax * e.hp) / e.maxHp)) : 0;
}

// Restore a player's real maxHp (and re-scale hp) once they leave the court. A
// no-op for NPCs (despawned) and for a player already de-normalized.
function denormalize(ctx: SimContext, run: GauntletRun, f: GauntletCourtFighter): void {
  if (!f.player) return;
  const e = ctx.entities.get(f.entityId);
  if (!e) return;
  e.targetId = null; // drop the court foe so the target frame + reticle clear on exit
  e.autoAttack = false; // stop swinging once the fight is over / on knockout
  if (e.maxHp !== f.savedMaxHp) ctx.recalcPlayer(e);
}

function markFinished(ctx: SimContext, run: GauntletRun, pid: number): void {
  const ps = run.playerStates.get(pid);
  if (ps && ps.finishedAt === null) ps.finishedAt = ctx.time;
}

// Keep a fighter inside the arena ring (clamped to arenaRadius from the centre).
function clampToArena(ctx: SimContext, run: GauntletRun, e: Entity): void {
  const t = GAUNTLET.court;
  const { cx, cz } = arenaCenter(run);
  const dx = e.pos.x - cx;
  const dz = e.pos.z - cz;
  const d = Math.hypot(dx, dz);
  if (d <= t.arenaRadius || d < 1e-6) return;
  e.pos.x = cx + (dx / d) * t.arenaRadius;
  e.pos.z = cz + (dz / d) * t.arenaRadius;
  e.pos.y = ctx.groundPos(e.pos.x, e.pos.z).y;
  ctx.rebucket(e);
}

// Step an entity toward a world point by up to `dist` yards, facing the move.
function stepToward(ctx: SimContext, e: Entity, tx: number, tz: number, dist: number): void {
  const dx = tx - e.pos.x;
  const dz = tz - e.pos.z;
  const d = Math.hypot(dx, dz);
  if (d < 1e-6 || dist <= 0) return;
  const step = Math.min(dist, d);
  e.prevPos = cloneVec(e.pos);
  e.pos.x += (dx / d) * step;
  e.pos.z += (dz / d) * step;
  e.pos.y = ctx.groundPos(e.pos.x, e.pos.z).y;
  e.facing = Math.atan2(dx, dz);
  ctx.rebucket(e);
}

function cloneVec(v: Vec3): Vec3 {
  return { x: v.x, y: v.y, z: v.z };
}

// -------------------------------------------------------------------------
// The seam into the shared combat core. The Final Court is a standard-combat
// free-for-all, so contestants must be mutually hostile (so ordinary targeting,
// the reticle, tab-cycling, auto-attack, and abilities engage) and a lethal blow
// must eliminate from the event instead of triggering a real death.
// -------------------------------------------------------------------------

// True when a and b are two DISTINCT, live, non-spectating contestants of the
// same active Final Court: the predicate Sim.isHostileTo consults so the whole
// vanilla combat + targeting stack treats them as foes. Kind-agnostic (a player
// vs the NPC field, or two NPCs) and pure (no rng), so it never perturbs the
// world's draw order.
export function gauntletCourtFoes(runs: GauntletRun[], a: Entity, b: Entity): boolean {
  if (a.id === b.id) return false;
  for (const run of runs) {
    if (run.trial?.kind !== 'court') continue;
    if (!run.trial.fighters.has(a.id) || !run.trial.fighters.has(b.id)) continue;
    const ca = run.contestants.find((k) => k.entityId === a.id);
    const cb = run.contestants.find((k) => k.entityId === b.id);
    if (!ca || ca.eliminatedAtTrial !== null) return false;
    if (!cb || cb.eliminatedAtTrial !== null) return false;
    if (run.playerStates.get(a.id)?.spectating || run.playerStates.get(b.id)?.spectating)
      return false;
    return true;
  }
  return false;
}

// True when the entity is a live fighter in an active Final Court: dealDamage
// consults this to route a lethal blow to elimination (below) instead of the
// normal death flow.
export function gauntletCourtContestant(ctx: SimContext, target: Entity): boolean {
  for (const run of ctx.gauntletRuns) {
    if (run.trial?.kind !== 'court') continue;
    if (!run.trial.fighters.has(target.id)) continue;
    const c = run.contestants.find((k) => k.entityId === target.id);
    if (c && c.eliminatedAtTrial === null) return true;
  }
  return false;
}

// Eliminate a court fighter felled by a vanilla killing blow: restore their real
// maxHp FIRST (so eliminateContestant's hp clamp uses it, and autoAttack/target
// are cleared), zero the board meter, then knock them out (NPCs despawn; players
// park as spectators, no death screen). Called by dealDamage's Final Court arm.
export function gauntletCourtTakedown(ctx: SimContext, target: Entity): void {
  for (const run of ctx.gauntletRuns) {
    if (run.trial?.kind !== 'court') continue;
    const f = run.trial.fighters.get(target.id);
    if (!f) continue;
    const c = run.contestants.find((k) => k.entityId === target.id);
    if (!c || c.eliminatedAtTrial !== null) return;
    denormalize(ctx, run, f);
    c.vitality = 0;
    eliminateContestant(ctx, run, c);
    return;
  }
}
