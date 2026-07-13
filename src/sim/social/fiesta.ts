// Session A3: 2v2 Fiesta, the dopamine-maxxed party mode, MOVED verbatim out of
// the Sim monolith behind the SimContext seam. Score-based respawning bouts with
// augment waves, a closing hazard ring, and ring power-ups. Move-not-rewrite:
// statements, branch order, iteration order, the two RNG streams' draw order, and
// the player-facing emit literals are preserved EXACTLY (the parity gate's
// full-state trace + draw-order log proves it).
//
// TWO RNG STREAMS, never crossed: the MATCH uses a PER-MATCH stream `f.rng`
// (seeded in createFiestaState off the sim clock + match id) for fiestaPickOffers
// (augment-card Fisher-Yates) and fiestaSpawnPowerup (power-up placement); the
// shared sim stream is NOT touched here (the offline bot harness in fiesta_bots.ts
// is the only Fiesta code that draws the shared stream). The per-match seed makes
// augment/power-up replays identical.
//
// Fiesta state lives on the ArenaMatch (`match.fiesta`), reached through the
// SimContext live views (arenaMatches/entities/players from E1/A1/C1, arena
// helpers from A2). Sim keeps thin same-named delegates so every foreign caller
// (dealDamage's cross-team takedown + ring bottom-out arms, the HUD augment-pick
// command, the arena match lifecycle, fiestaMatchInfo, and the tests) resolves
// unchanged. `playerMods` and `fiestaMatchInfo` STAY on Sim (read by ~13 recalc
// sites / the presentation surface); this module consumes playerMods via ctx.

import {
  AUGMENTS_BY_ID,
  type AugmentDef,
  type AugmentSpecial,
  eligibleAugments,
  POWERUPS,
  POWERUPS_BY_ID,
  type PowerupDef,
  tierForWave,
} from '../content/augments';
import {
  cloneAllocation,
  computeTalentModifiers,
  defaultBuild,
  type TalentModifiers,
  talentPointsAtLevel,
} from '../content/talents';
import { abilitiesKnownAt, arenaOrigin } from '../data';
import * as deedsMod from '../deeds';
import { ARENA_SPAWNS_A_2v2, ARENA_SPAWNS_B_2v2 } from '../dungeon_layout';
import { recalcPlayerStats } from '../entity';
import { awardFiestaKillHonor } from '../pvp';
import { Rng } from '../rng';
import type { ArenaMatch, FiestaPowerup, FiestaState, PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';
import { DT, type Entity } from '../types';
import * as arenaMod from './arena';

// Fiesta tuning consts (moved with the slice; Fiesta-only). Exported so sim.ts's
// fiestaMatchInfo presentation accessor and the offline bot harness can read the
// handful they need without re-deriving them.
export const FIESTA_SCORE_LIMIT = 15; // first team to this many takedowns wins
export const FIESTA_MAX_DURATION = 360; // hard cap (s); highest score wins, ties = draw
export const FIESTA_TOTAL_WAVES = 3; // augment waves
export const FIESTA_WAVE_INTERVAL = 50; // s of active play between augment waves
export const FIESTA_FIRST_WAVE_AT = 8; // s into the fight the first wave opens
export const FIESTA_RESPAWN_BASE = 3; // s for a first death
export const FIESTA_RESPAWN_PER_DEATH = 1.2; // each prior death lengthens your next wait
export const FIESTA_RESPAWN_PER_MINUTE = 1.5; // and the bout dragging on lengthens it too
export const FIESTA_RESPAWN_MAX = 14; // cap so it never feels hopeless
export const FIESTA_RING_CX = 0; // ring centre (instance-local) — the arena dais
export const FIESTA_RING_CZ = 2;
export const FIESTA_RING_START = 22; // radius covering both teams' spawns
export const FIESTA_RING_MIN = 6; // fully-closed radius
export const FIESTA_RING_DPS_PCT = 0.06; // max-hp fraction per second taken outside the ring
export const FIESTA_RING_SHRINK_RATE = 0.6; // yards/s the radius eases toward its target
export const FIESTA_POWERUP_FIRST = 12; // s into the bout before the first power-up
export const FIESTA_POWERUP_INTERVAL = 16; // s between power-up spawn attempts
export const FIESTA_POWERUP_TELEGRAPH = 5; // s of "spawning" warning before it's grabbable
export const FIESTA_POWERUP_TTL = 18; // s a ready power-up waits to be grabbed
export const FIESTA_POWERUP_RADIUS = 2; // grab radius
export const FIESTA_POWERUP_MAX = 3; // concurrent power-ups on the field
export const FIESTA_STANDARD_LEVEL = 20; // everyone fights at this level, balanced

// The FiestaState factory. Seeds the per-match `rng` off the sim clock + match id
// (NOT the shared draw stream) so a replay re-offers identical augment cards.
export function createFiestaState(ctx: SimContext): FiestaState {
  return {
    scoreA: 0,
    scoreB: 0,
    scoreLimit: FIESTA_SCORE_LIMIT,
    wave: 0,
    nextWaveAt: FIESTA_FIRST_WAVE_AT,
    offers: new Map(),
    ringRadius: FIESTA_RING_START,
    ringTarget: FIESTA_RING_START,
    respawn: new Map(),
    deaths: new Map(),
    kills: new Map(),
    honorKillsByPair: new Map(),
    streak: new Map(),
    lastKill: new Map(),
    pending: new Map(),
    powerups: [],
    nextPowerupId: 1,
    powerupTimer: FIESTA_POWERUP_FIRST,
    firstBlood: false,
    // Per-match deterministic stream, seeded off the sim clock + slot so a
    // replay re-offers identical augment cards.
    rng: new Rng((ctx.tickCount * 2654435761 + ctx.nextArenaMatchId * 40503) >>> 0),
  };
}

// talentMods + the chosen augments' flat effects, deep-cloned so the base
// talent struct is never mutated.
export function mergeAugmentMods(base: TalentModifiers, augIds: string[]): TalentModifiers {
  const m: TalentModifiers = {
    spec: base.spec,
    role: base.role,
    stats: { ...base.stats },
    global: { ...base.global },
    abilities: {},
    grants: [...base.grants],
  };
  for (const k in base.abilities) m.abilities[k] = { ...base.abilities[k] };
  for (const id of augIds) {
    const eff = AUGMENTS_BY_ID[id]?.effect;
    if (!eff) continue;
    if (eff.stats) {
      const s = m.stats,
        e = eff.stats;
      s.str += e.str ?? 0;
      s.agi += e.agi ?? 0;
      s.sta += e.sta ?? 0;
      s.int += e.int ?? 0;
      s.spi += e.spi ?? 0;
      s.armor += e.armor ?? 0;
      s.ap += e.ap ?? 0;
      s.crit += e.crit ?? 0;
      s.dodge += e.dodge ?? 0;
      s.apPct += e.apPct ?? 0;
      s.staPct += e.staPct ?? 0;
      s.armorPct += e.armorPct ?? 0;
      s.maxHpPct += e.maxHpPct ?? 0;
      s.strPct += e.strPct ?? 0;
      s.agiPct += e.agiPct ?? 0;
      s.intPct += e.intPct ?? 0;
      s.spiPct += e.spiPct ?? 0;
    }
    if (eff.global) {
      const g = m.global,
        e = eff.global;
      g.meleeDmgPct += e.meleeDmgPct ?? 0;
      g.spellDmgPct += e.spellDmgPct ?? 0;
      g.healPct += e.healPct ?? 0;
      g.threatPct += e.threatPct ?? 0;
      g.critVsRooted += e.critVsRooted ?? 0;
    }
    for (const am of eff.ability ?? []) {
      if (!m.abilities[am.ability]) {
        m.abilities[am.ability] = {
          dmgPct: 0,
          flatDmg: 0,
          costPct: 0,
          cooldownPct: 0,
          castPct: 0,
          buffPct: 0,
          castWhileMoving: false,
          addEffects: [],
        };
      }
      const cur = m.abilities[am.ability];
      cur.dmgPct += am.dmgPct ?? 0;
      cur.flatDmg += am.flatDmg ?? 0;
      cur.costPct += am.costPct ?? 0;
      cur.cooldownPct += am.cooldownPct ?? 0;
      cur.castPct += am.castPct ?? 0;
      cur.buffPct += am.buffPct ?? 0;
      if (am.castWhileMoving) cur.castWhileMoving = true;
      if (am.addEffects) cur.addEffects.push(...am.addEffects);
    }
    if (eff.grant) m.grants.push({ ability: eff.grant.ability, rank: eff.grant.rank ?? 1 });
  }
  return m;
}

// Recompute a fighter's effective modifiers + special bag from their picked
// augments, then rebuild known abilities and stats (preserving hp fraction so
// a +maxHp augment grows the bar instead of healing to full).
export function fiestaApplyAugments(meta: PlayerMeta, e: Entity): void {
  meta.fiestaMods = mergeAugmentMods(meta.talentMods, meta.fiestaAugments);
  const sp: AugmentSpecial = {};
  for (const id of meta.fiestaAugments) {
    const s = AUGMENTS_BY_ID[id]?.special;
    if (!s) continue;
    if (s.lifestealPct) sp.lifestealPct = (sp.lifestealPct ?? 0) + s.lifestealPct;
    if (s.moveSpeedPct) sp.moveSpeedPct = (sp.moveSpeedPct ?? 0) + s.moveSpeedPct;
    if (s.scorePerKill) sp.scorePerKill = (sp.scorePerKill ?? 0) + s.scorePerKill;
  }
  meta.fiestaSpecial = sp;
  meta.known = abilitiesKnownAt(meta.cls, e.level, meta.fiestaMods);
  const frac = e.maxHp > 0 ? e.hp / e.maxHp : 1;
  recalcPlayerStats(e, meta.cls, meta.equipment, meta.fiestaMods, meta.equipmentInstance);
  e.hp = e.dead ? 0 : Math.max(1, Math.round(e.maxHp * frac));
}

// Strip all Fiesta augment state and restore plain talent-only stats/abilities.
export function clearFiestaAugments(meta: PlayerMeta, e: Entity): void {
  if (
    meta.fiestaAugments.length === 0 &&
    !meta.fiestaMods &&
    !meta.fiestaSpecial.lifestealPct &&
    !meta.fiestaSpecial.moveSpeedPct &&
    !meta.fiestaSpecial.scorePerKill
  )
    return;
  meta.fiestaAugments = [];
  meta.fiestaMods = null;
  meta.fiestaSpecial = {};
  meta.known = abilitiesKnownAt(meta.cls, e.level, meta.talentMods);
  recalcPlayerStats(e, meta.cls, meta.equipment, meta.talentMods, meta.equipmentInstance);
}

// Standardize a fighter to a balanced level-20 build for the bout. The
// pre-fiesta character is snapshotted in meta.fiestaRestore (which also makes
// serializeCharacter persist the real, not the temporary, state).
export function fiestaStandardize(ctx: SimContext, meta: PlayerMeta, e: Entity): void {
  if (meta.fiestaRestore) return;
  meta.fiestaRestore = { level: e.level, xp: meta.xp, talents: cloneAllocation(meta.talents) };
  e.level = FIESTA_STANDARD_LEVEL;
  meta.talents = defaultBuild(meta.cls, talentPointsAtLevel(FIESTA_STANDARD_LEVEL));
  meta.talentMods = computeTalentModifiers(meta.cls, meta.talents, e.level);
  meta.known = abilitiesKnownAt(meta.cls, e.level, ctx.playerMods(meta));
  meta.wireRev++; // talents/loadouts swapped for the bout, refresh the wire promptly
  recalcPlayerStats(e, meta.cls, meta.equipment, ctx.playerMods(meta), meta.equipmentInstance);
}

// Undo fiestaStandardize: restore the player's real level/xp/talents.
export function fiestaRestoreChar(meta: PlayerMeta, e: Entity): void {
  const snap = meta.fiestaRestore;
  if (!snap) return;
  e.level = snap.level;
  meta.xp = snap.xp;
  meta.talents = snap.talents;
  meta.talentMods = computeTalentModifiers(meta.cls, meta.talents, e.level);
  meta.fiestaRestore = null;
  meta.known = abilitiesKnownAt(meta.cls, e.level, meta.talentMods);
  meta.wireRev++; // real talents restored, refresh the wire promptly
  recalcPlayerStats(e, meta.cls, meta.equipment, meta.talentMods, meta.equipmentInstance);
}

// Player command: lock in one of the augments currently on offer.
export function arenaAugmentPick(ctx: SimContext, augmentId: string, pid?: number): void {
  const r = ctx.resolve(pid);
  if (!r) return;
  const id = r.meta.entityId;
  const match = ctx.arenaMatches.get(id);
  if (!match?.fiesta || match.state !== 'active') return;
  const offer = match.fiesta.offers.get(id);
  if (!offer) {
    ctx.error(id, 'You have no augment to choose right now.');
    return;
  }
  if (!offer.choices.includes(augmentId)) {
    ctx.error(id, 'That augment is not on offer.');
    return;
  }
  match.fiesta.offers.delete(id);
  r.meta.fiestaAugments.push(augmentId);
  fiestaApplyAugments(r.meta, r.e);
  for (const mPid of ctx.arenaAllPids(match)) {
    ctx.emit({
      type: 'augmentChosen',
      augmentId,
      byPid: id,
      byName: r.meta.name,
      mine: mPid === id,
      pid: mPid,
    });
  }
  // Still benched with more waves banked? Offer the next one right away.
  if (ctx.arenaIsDown(match, id)) fiestaPresentPending(ctx, match, id);
}

export function fiestaRespawnTime(deaths: number, elapsed: number): number {
  const t =
    FIESTA_RESPAWN_BASE +
    (deaths - 1) * FIESTA_RESPAWN_PER_DEATH +
    Math.floor(elapsed / 60) * FIESTA_RESPAWN_PER_MINUTE;
  return Math.min(FIESTA_RESPAWN_MAX, t);
}

// Strip a downed fighter to a clean dead state WITHOUT the normal player-death
// (graveyard) flow — Fiesta revives them itself on a timer.
export function fiestaDownEntity(ctx: SimContext, e: Entity, killer: Entity | null): void {
  e.dead = true;
  e.hp = 0;
  // Fiesta is a clean-slate minigame with its own timed revive: it intentionally strips
  // ALL auras (including The Keeper's Toll), unlike the overworld/delve death paths.
  e.auras = [];
  e.ccDr.clear();
  e.castingAbility = null;
  e.castRemaining = 0;
  e.castTargetId = null;
  e.channeling = false;
  e.autoAttack = false;
  e.queuedOnSwing = null;
  delete e.queuedOnSwingFree;
  e.queuedCastAbility = null;
  e.queuedCastAim = null;
  e.comboPoints = 0;
  e.comboUntil = -1;
  e.eating = null;
  e.drinking = null;
  e.sitting = false;
  e.chargeTargetId = null;
  e.chargePath = [];
  e.followTargetId = null;
  e.targetId = null;
  const meta = ctx.players.get(e.id);
  if (meta) meta.counters.deaths++;
  ctx.emit({ type: 'death', entityId: e.id, killerId: killer?.id ?? -1 });
}

// Bench a fighter and start their (growing) respawn countdown.
export function fiestaDown(
  ctx: SimContext,
  match: ArenaMatch,
  victim: Entity,
  killerPid: number | null,
): void {
  const f = match.fiesta!;
  if (f.respawn.has(victim.id)) return;
  const killer = killerPid !== null ? (ctx.entities.get(killerPid) ?? null) : null;
  fiestaDownEntity(ctx, victim, killer);
  const deaths = (f.deaths.get(victim.id) ?? 0) + 1;
  f.deaths.set(victim.id, deaths);
  const respawnIn = fiestaRespawnTime(deaths, match.timer);
  f.respawn.set(victim.id, respawnIn);
  f.streak.set(victim.id, 0);
  ctx.emit({ type: 'fiestaDown', seconds: Math.ceil(respawnIn), pid: victim.id });
  // Down time is the polite moment to offer any augment that's been waiting.
  fiestaPresentPending(ctx, match, victim.id);
}

// A scored takedown: award the point(s), bench the victim, fire the right
// word-pop, broadcast the new tally, and end the bout if the cap is reached.
export function fiestaTakedown(
  ctx: SimContext,
  match: ArenaMatch,
  killerPid: number,
  victim: Entity,
): void {
  const f = match.fiesta!;
  const victimStreak = f.streak.get(victim.id) ?? 0;
  const killerTeam = ctx.arenaTeamOf(match, killerPid);
  const killerMeta = ctx.players.get(killerPid);
  const points = 1 + (killerMeta?.fiestaSpecial.scorePerKill ?? 0);
  if (killerTeam === 'A') f.scoreA += points;
  else if (killerTeam === 'B') f.scoreB += points;
  if (killerMeta) killerMeta.counters.kills++;
  f.kills.set(killerPid, (f.kills.get(killerPid) ?? 0) + 1);
  if (killerMeta && !match.practice && ctx.isArenaCrossTeam(match, killerPid, victim.id)) {
    awardFiestaKillHonor(ctx, killerMeta, victim.id, f.honorKillsByPair);
  }

  fiestaDown(ctx, match, victim, killerPid);

  const now = match.timer;
  const rapid = now - (f.lastKill.get(killerPid) ?? -999) <= 4;
  f.lastKill.set(killerPid, now);
  const ks = (f.streak.get(killerPid) ?? 0) + 1;
  f.streak.set(killerPid, ks);
  // Deed moments read the sim-side tallies, independent of the word-cue
  // else-if chain below (which reports only the loudest cue).
  deedsMod.onFiestaTakedownForDeeds(ctx, match, killerPid, {
    rapid,
    victimStreak,
    killerKills: f.kills.get(killerPid) ?? 0,
  });
  if (!f.firstBlood) {
    f.firstBlood = true;
    ctx.emit({ type: 'fiestaWord', flavor: 'firstblood', pid: killerPid });
  } else if (victimStreak >= 3)
    ctx.emit({ type: 'fiestaWord', flavor: 'shutdown', pid: killerPid });
  else if (rapid) ctx.emit({ type: 'fiestaWord', flavor: 'doublekill', pid: killerPid });
  else if (ks >= 3) ctx.emit({ type: 'fiestaWord', flavor: 'spree', n: ks, pid: killerPid });
  else ctx.emit({ type: 'fiestaWord', flavor: 'kill', pid: killerPid });

  for (const mPid of ctx.arenaAllPids(match)) {
    ctx.emit({
      type: 'fiestaScore',
      a: f.scoreA,
      b: f.scoreB,
      limit: f.scoreLimit,
      team: ctx.arenaTeamOf(match, mPid)!,
      pid: mPid,
    });
  }

  if (f.scoreA >= f.scoreLimit || f.scoreB >= f.scoreLimit) {
    ctx.endArenaMatch(match, f.scoreA >= f.scoreLimit ? 'A' : 'B', 'defeat');
  }
}

export function fiestaRevive(ctx: SimContext, match: ArenaMatch, e: Entity): void {
  const f = match.fiesta!;
  f.respawn.delete(e.id);
  const team = ctx.arenaTeamOf(match, e.id);
  if (!team) return;
  const origin = arenaOrigin(match.slot);
  const spawns = team === 'A' ? ARENA_SPAWNS_A_2v2 : ARENA_SPAWNS_B_2v2;
  const teamPids = team === 'A' ? match.teamA : match.teamB;
  const idx = Math.max(0, teamPids.indexOf(e.id));
  arenaMod.placeInArena(ctx, e, origin, spawns[idx] ?? spawns[0]);
  ctx.readyArenaFighter(e, { clearPrep: true });
  ctx.emit({ type: 'respawn', pid: e.id });
  ctx.emit({ type: 'fiestaWord', flavor: 'revived', pid: e.id });
}

export function fiestaOpenWave(ctx: SimContext, match: ArenaMatch): void {
  const f = match.fiesta!;
  f.wave++;
  f.nextWaveAt = match.timer + FIESTA_WAVE_INTERVAL;
  // Close the ring one step toward its minimum with each wave.
  const frac = f.wave / FIESTA_TOTAL_WAVES;
  f.ringTarget = Math.round(FIESTA_RING_START - (FIESTA_RING_START - FIESTA_RING_MIN) * frac);
  const tier = tierForWave(f.wave);
  for (const pid of ctx.arenaAllPids(match)) {
    const meta = ctx.players.get(pid);
    const e = ctx.entities.get(pid);
    if (!meta || !e) continue;
    const owned = new Set(meta.fiestaAugments);
    const pool = eligibleAugments(tier, meta.cls, ctx.playerMods(meta).role, owned);
    const choices = fiestaPickOffers(f.rng, pool, 3);
    if (choices.length === 0) continue;
    // Don't interrupt the fight: queue the offer and reveal it on the player's
    // next death (or right now if they're already down).
    const queue = f.pending.get(pid) ?? [];
    queue.push({ tier, wave: f.wave, choices });
    f.pending.set(pid, queue);
    if (ctx.arenaIsDown(match, pid)) fiestaPresentPending(ctx, match, pid);
  }
  for (const mPid of ctx.arenaAllPids(match)) {
    ctx.emit({ type: 'fiestaWave', wave: f.wave, totalWaves: FIESTA_TOTAL_WAVES, pid: mPid });
  }
}

// Reveal the oldest queued augment offer (the pick UI watches `offers`), unless
// the player is already mid-choice. Fired on death and on wave-open-while-down.
export function fiestaPresentPending(ctx: SimContext, match: ArenaMatch, pid: number): void {
  const f = match.fiesta!;
  if (f.offers.has(pid)) return;
  const queue = f.pending.get(pid);
  if (!queue || queue.length === 0) return;
  const next = queue.shift()!;
  if (queue.length === 0) f.pending.delete(pid);
  f.offers.set(pid, next);
  ctx.emit({
    type: 'augmentOffer',
    tier: next.tier,
    wave: next.wave,
    choices: next.choices,
    pid,
  });
}

// Deterministic Fisher–Yates draw of up to n augment ids from the eligible pool.
export function fiestaPickOffers(rng: Rng, pool: AugmentDef[], n: number): string[] {
  const arr = pool.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr.slice(0, Math.min(n, arr.length)).map((a) => a.id);
}

export function fiestaRingDamage(ctx: SimContext, match: ArenaMatch): void {
  if (ctx.tickCount % 10 !== 0) return; // twice a second
  const f = match.fiesta!;
  const origin = arenaOrigin(match.slot);
  const cx = origin.x + FIESTA_RING_CX,
    cz = origin.z + FIESTA_RING_CZ;
  const interval = 10 * DT;
  for (const pid of ctx.arenaAllPids(match)) {
    if (ctx.arenaIsDown(match, pid)) continue;
    const e = ctx.entities.get(pid);
    if (!e || e.dead) continue;
    const d = Math.hypot(e.pos.x - cx, e.pos.z - cz);
    if (d <= f.ringRadius) continue;
    const dmg = Math.max(1, Math.round(e.maxHp * FIESTA_RING_DPS_PCT * interval));
    ctx.emit({
      type: 'damage',
      sourceId: -1,
      targetId: pid,
      amount: Math.min(dmg, e.hp),
      crit: false,
      school: 'fire',
      ability: null,
      kind: 'hit',
    });
    if (e.hp - dmg <= 0) {
      e.hp = 0;
      fiestaDown(ctx, match, e, null);
    } else e.hp -= dmg;
  }
}

export function updateFiestaActive(ctx: SimContext, match: ArenaMatch): void {
  const f = match.fiesta!;
  if (match.timer >= FIESTA_MAX_DURATION) {
    const winner = f.scoreA === f.scoreB ? null : f.scoreA > f.scoreB ? 'A' : 'B';
    ctx.endArenaMatch(match, winner, 'timeout');
    return;
  }
  // Ease the ring toward its target radius and burn anyone caught outside.
  if (f.ringRadius > f.ringTarget) {
    f.ringRadius = Math.max(f.ringTarget, f.ringRadius - FIESTA_RING_SHRINK_RATE * DT);
  }
  fiestaRingDamage(ctx, match);
  fiestaUpdatePowerups(ctx, match);
  if (f.wave < FIESTA_TOTAL_WAVES && match.timer >= f.nextWaveAt) fiestaOpenWave(ctx, match);
  for (const [pid, t] of [...f.respawn]) {
    const nt = t - DT;
    const e = ctx.entities.get(pid);
    if (!e) {
      f.respawn.delete(pid);
      continue;
    }
    if (nt <= 0) fiestaRevive(ctx, match, e);
    else f.respawn.set(pid, nt);
  }
}

// ---- Ring power-ups: spawn on a timer, telegraph, then wait to be grabbed --

export function fiestaUpdatePowerups(ctx: SimContext, match: ArenaMatch): void {
  const f = match.fiesta!;
  // age existing power-ups (telegraph → ready → despawn)
  for (let i = f.powerups.length - 1; i >= 0; i--) {
    const p = f.powerups[i];
    p.timer -= DT;
    if (p.timer <= 0) {
      if (p.state === 'spawning') {
        p.state = 'ready';
        p.timer = FIESTA_POWERUP_TTL;
      } else {
        f.powerups.splice(i, 1);
      }
    }
  }
  // pickups: a live fighter touching a ready power-up scoops it
  for (let i = f.powerups.length - 1; i >= 0; i--) {
    const p = f.powerups[i];
    if (p.state !== 'ready') continue;
    for (const pid of ctx.arenaAllPids(match)) {
      if (ctx.arenaIsDown(match, pid)) continue;
      const e = ctx.entities.get(pid);
      if (!e || e.dead) continue;
      if (Math.hypot(e.pos.x - p.x, e.pos.z - p.z) > FIESTA_POWERUP_RADIUS) continue;
      fiestaGrabPowerup(ctx, match, e, p);
      f.powerups.splice(i, 1);
      break;
    }
  }
  // spawn timer
  f.powerupTimer -= DT;
  if (f.powerupTimer <= 0) {
    f.powerupTimer = FIESTA_POWERUP_INTERVAL;
    if (f.powerups.length < FIESTA_POWERUP_MAX) fiestaSpawnPowerup(match);
  }
}

export function fiestaSpawnPowerup(match: ArenaMatch): void {
  const f = match.fiesta!;
  const def: PowerupDef = f.rng.pick(POWERUPS);
  const origin = arenaOrigin(match.slot);
  const cx = origin.x + FIESTA_RING_CX,
    cz = origin.z + FIESTA_RING_CZ;
  // somewhere inside the current ring (kept off the exact centre)
  const ang = f.rng.next() * Math.PI * 2;
  const r = (0.25 + f.rng.next() * 0.6) * Math.max(3, f.ringRadius - 2);
  f.powerups.push({
    id: f.nextPowerupId++,
    defId: def.id,
    x: cx + Math.sin(ang) * r,
    z: cz + Math.cos(ang) * r,
    state: 'spawning',
    timer: FIESTA_POWERUP_TELEGRAPH,
  });
}

export function fiestaGrabPowerup(
  ctx: SimContext,
  match: ArenaMatch,
  e: Entity,
  p: FiestaPowerup,
): void {
  const def = POWERUPS_BY_ID[p.defId];
  if (!def) return;
  // Re-apply (refreshing) each buff aura for the power-up's duration. These are
  // real auras, so they survive recalc and tick down in updateAuras.
  for (const b of def.buffs) {
    ctx.applyAura(e, {
      id: `powerup_${def.id}_${b.kind}`,
      name: def.name,
      kind: b.kind,
      remaining: def.duration,
      duration: def.duration,
      value: b.value,
      sourceId: e.id,
      school: 'nature',
    });
  }
  // The client localizes the pickup banner/log from this event (defId), so no
  // English log text is emitted from the sim here.
  ctx.emit({
    type: 'fiestaPowerup',
    entityId: e.id,
    defId: def.id,
    glow: def.glow,
    duration: def.duration,
  });
  deedsMod.onFiestaPowerupForDeeds(ctx, match, e.id, def.id);
}
