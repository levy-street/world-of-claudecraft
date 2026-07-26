// The Frontier Incursion: the public, Greater-Rift-style spawn event that puts the
// frost rares in the world without an always-present idle mob (which would draw wander
// rng every tick and fork the parity goldens). Instead:
//
//   - While at least one player is in the band, a spawner keeps a live population of
//     weak frost trash (Rimebound Wisp) roaming it, and a shared meter (0..1) fills
//     from trash kills, PvP kills, healing, and a passive public-timer drip.
//   - At a full meter a hard, UNKITABLE rare (alternating, deterministic) spawns at the
//     muster point out in the band; the whole zone converges on it.
//   - On the rare's death (rewarded by the existing awardFrontierRareKill over the
//     bossDamagers roster, healers included via the applyHeal hook), the meter rebuilds.
//
// PLAYER-GATED + ZERO RNG: with an empty band nothing spawns and the meter does not
// tick, and every position/id here is deterministic (a pid/counter fan-out, never
// ctx.rng), so the phase draws no rng and the parity goldens (which never place a
// player at x >= FRONTIER_X_MIN) are untouched. Runs at the zero-rng tail of tick()
// (the Vale Cup / deeds precedent). State lives on Sim as a live SimContext view.
import { MOBS } from '../data';
import { createMob } from '../entity';
import type { SimContext } from '../sim_context';
import type { Entity } from '../types';
import { TICK_RATE } from '../types';
import {
  FRONTIER_HUB,
  FRONTIER_HUB_RADIUS,
  FRONTIER_MUSTER,
  FRONTIER_TRASH_HONOR,
  FRONTIER_X_MAX,
  FRONTIER_X_MIN,
  INCURSION_ENRAGE_SECONDS,
  INCURSION_HEAL_CAP_PER_CAST,
  INCURSION_HEAL_PCT_PER_HP,
  INCURSION_PASSIVE_FULL_SECONDS,
  INCURSION_PLAYER_KILL_PCT,
  INCURSION_TRASH_CAP,
  INCURSION_TRASH_KILL_PCT,
  INCURSION_TRASH_RESPAWN_SECONDS,
  inFrontierHub,
  isFrontierPos,
} from './frontier';
import { grantHonor } from './honor';

// Reserved id block for incursion-spawned mobs: well past the FURY/QM/Marshal reserved
// ids (1_000_000_001..3) and any world-gen id, so spawning never perturbs nextId.
const INCURSION_ID_BASE = 1_000_100_000;
const RARE_ROTATION = ['rimefang_stalker', 'frostbound_revenant'] as const;
const TRASH_TEMPLATE = 'rimebound_wisp';
const TRASH_LEVEL = 19;
const RARE_LEVEL = 20;

export interface FrontierIncursionState {
  progress: number; // 0..1 meter, only meaningful while 'building'
  phase: 'building' | 'active';
  rareId: number | null; // the live rare's entity id while 'active'
  rareTemplateId: string | null;
  spawnCount: number; // deterministic rare rotation, no rng
  rareTicks: number; // ticks the current rare has been up (enrage)
  trashTicks: number; // ticks since the last trash spawn attempt
  trashIds: number[]; // live trash we spawned (pruned as they die)
  nextId: number; // monotonic reserved id counter for spawned mobs
}

export function createFrontierIncursionState(): FrontierIncursionState {
  return {
    progress: 0,
    phase: 'building',
    rareId: null,
    rareTemplateId: null,
    spawnCount: 0,
    rareTicks: 0,
    trashTicks: 0,
    trashIds: [],
    nextId: INCURSION_ID_BASE,
  };
}

/** True when a live player is currently inside the band (the whole gate). */
function anyPlayerInBand(ctx: SimContext): boolean {
  for (const meta of ctx.players.values()) {
    const p = ctx.entities.get(meta.entityId);
    if (p && !p.dead && isFrontierPos(p.pos.x)) return true;
  }
  return false;
}

// A deterministic point out in the band for trash spawn number `n` (a ring that walks
// with the counter, no rng, always inside the band and clear of the safe hub).
// Exported for the hub-clearance sweep test.
export function trashSpawnPoint(n: number): { x: number; z: number } {
  const angle = ((n % 12) / 12) * Math.PI * 2;
  const radius = 60 + (n % 5) * 12;
  const clamped = Math.min(FRONTIER_X_MAX - 20, FRONTIER_MUSTER.x + Math.cos(angle) * radius);
  let x = Math.max(FRONTIER_X_MIN + 20, clamped);
  const z = Math.sin(angle) * radius;
  // A mouth-facing candidate (angle near pi) sits between the muster point and the
  // band edge, and can land inside the safe hub (e.g. n % 12 == 6 with n % 5 == 4).
  // Step it deterministically back out past the hub perimeter, deeper into the band,
  // so a wisp never spawns on the shoppers (no rng: still a pure function of n).
  if (inFrontierHub(x, z)) x = FRONTIER_HUB.x + FRONTIER_HUB_RADIUS + 8;
  return { x, z };
}

function spawnMob(
  ctx: SimContext,
  state: FrontierIncursionState,
  templateId: string,
  level: number,
  x: number,
  z: number,
): number {
  const id = state.nextId++;
  const mob = createMob(id, MOBS[templateId], level, ctx.groundPos(x, z));
  ctx.addEntity(mob);
  return id;
}

function despawnIncursionMobs(ctx: SimContext, state: FrontierIncursionState): void {
  for (const id of state.trashIds) ctx.dropEntity(id);
  state.trashIds = [];
  if (state.rareId !== null) ctx.dropEntity(state.rareId);
  state.rareId = null;
  state.rareTemplateId = null;
}

// The per-tick driver (a zero-rng end-of-tick phase).
export function updateFrontierIncursion(ctx: SimContext): void {
  const state = ctx.frontierIncursionState;
  if (!anyPlayerInBand(ctx)) {
    // Empty band: tear down the event and reset. Idempotent, draws no rng, and (once
    // the band is empty) never runs in a parity scenario.
    if (
      state.trashIds.length ||
      state.rareId !== null ||
      state.progress > 0 ||
      state.phase !== 'building'
    ) {
      despawnIncursionMobs(ctx, state);
      state.progress = 0;
      state.phase = 'building';
      state.rareTicks = 0;
      state.trashTicks = 0;
    }
    return;
  }

  // Prune dead/gone trash from our roster.
  state.trashIds = state.trashIds.filter((id) => {
    const e = ctx.entities.get(id);
    return !!e && !e.dead;
  });

  if (state.phase === 'active') {
    const rare = state.rareId !== null ? ctx.entities.get(state.rareId) : null;
    if (!rare || rare.dead) {
      // Killed (reward handled by awardFrontierRareKill in handleDeath) or gone: rebuild.
      state.rareId = null;
      state.rareTemplateId = null;
      state.phase = 'building';
      state.progress = 0;
      state.rareTicks = 0;
      return;
    }
    state.rareTicks++;
    if (state.rareTicks >= INCURSION_ENRAGE_SECONDS * TICK_RATE) {
      // Uncleared: despawn and rebuild so the band is never stuck with a dead event.
      ctx.dropEntity(state.rareId!);
      state.rareId = null;
      state.rareTemplateId = null;
      state.phase = 'building';
      state.progress = 0;
      state.rareTicks = 0;
    }
    return;
  }

  // phase 'building': maintain trash, drip the meter, spawn at full.
  state.trashTicks++;
  if (
    state.trashIds.length < INCURSION_TRASH_CAP &&
    state.trashTicks >= INCURSION_TRASH_RESPAWN_SECONDS * TICK_RATE
  ) {
    state.trashTicks = 0;
    const spot = trashSpawnPoint(state.spawnCount + state.trashIds.length);
    state.trashIds.push(spawnMob(ctx, state, TRASH_TEMPLATE, TRASH_LEVEL, spot.x, spot.z));
  }

  state.progress = Math.min(1, state.progress + 1 / (INCURSION_PASSIVE_FULL_SECONDS * TICK_RATE));
  if (state.progress >= 1) {
    // Spawn the rare (deterministic rotation), clear the trash so the zone converges.
    for (const id of state.trashIds) ctx.dropEntity(id);
    state.trashIds = [];
    const templateId = RARE_ROTATION[state.spawnCount % RARE_ROTATION.length];
    state.spawnCount++;
    state.rareId = spawnMob(
      ctx,
      state,
      templateId,
      RARE_LEVEL,
      FRONTIER_MUSTER.x,
      FRONTIER_MUSTER.z,
    );
    state.rareTemplateId = templateId;
    state.phase = 'active';
    state.progress = 0;
    state.rareTicks = 0;
  }
}

// Add to the meter (clamped), only while building. Called from the kill/heal hooks.
function addMeter(state: FrontierIncursionState, amount: number): void {
  if (state.phase !== 'building' || amount <= 0) return;
  state.progress = Math.min(1, state.progress + amount);
}

// Kill hook (from handleDeath): trash and PvP kills in the band feed the meter; a
// trash kill also pays a small honor trickle to the killer.
export function frontierIncursionOnKill(
  ctx: SimContext,
  dead: Entity,
  killer: Entity | null,
): void {
  if (!isFrontierPos(dead.pos.x)) return;
  const state = ctx.frontierIncursionState;
  if (dead.kind === 'mob' && dead.templateId === TRASH_TEMPLATE) {
    addMeter(state, INCURSION_TRASH_KILL_PCT);
    const creditId = killer ? (killer.kind === 'player' ? killer.id : killer.ownerId) : null;
    if (creditId !== null) {
      const meta = ctx.players.get(creditId);
      if (meta) grantHonor(ctx, meta, FRONTIER_TRASH_HONOR, 'frontier_kill');
    }
    return;
  }
  if (dead.kind === 'player' && killer && (killer.kind === 'player' || killer.ownerId !== null)) {
    addMeter(state, INCURSION_PLAYER_KILL_PCT);
  }
}

// Heal hook (from applyHeal): healing a hurt ally in the band drives the meter (healer
// incentive #1), and healing during an active rare adds the healer to the rare's
// contributor roster so the kill pays them too (healer incentive #2). Draws no rng.
export function frontierIncursionOnHeal(
  ctx: SimContext,
  source: Entity,
  target: Entity,
  healed: number,
): void {
  if (healed <= 0 || source.kind !== 'player' || !isFrontierPos(target.pos.x)) return;
  const state = ctx.frontierIncursionState;
  addMeter(state, Math.min(healed, INCURSION_HEAL_CAP_PER_CAST) * INCURSION_HEAL_PCT_PER_HP);
  // Roster credit is for keeping someone who is actually FIGHTING the rare alive
  // (the PRD's "healing anyone who is fighting the rare"): the healed target must be
  // on the rare's threat table, and a self-heal never rides the roster. Otherwise a
  // hub bystander could self-heal a scratch once and collect the full rare payout.
  if (state.phase === 'active' && state.rareId !== null && source.id !== target.id) {
    const rare = ctx.entities.get(state.rareId);
    if (rare && !rare.dead && rare.threat.has(target.id)) rare.bossDamagers.add(source.id);
  }
}
