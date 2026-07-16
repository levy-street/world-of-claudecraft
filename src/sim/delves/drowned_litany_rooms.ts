// The Drowned Litany room puzzle semantics (sim-only). Walk-on valves/tablets/
// candles/ropes and destroyable baptistry egg-sacs gate the module exit.

import { DELVES, delveModuleZOffset as delveModuleZOffsetLayout, MOBS } from '../data';
import { litanyModuleColliders, litanyModuleGeometry } from '../delve_litany_layout';
import { createMob } from '../entity';
import { polygonContainsPoint } from '../geometry2d';
import type { SimContext } from '../sim_context';
import { DELVE_PLATE_RADIUS, type DelveRun, dist2d, type Entity, type Vec3 } from '../types';
export const LITANY_PUZZLE_KINDS = new Set([
  'sluice_valve',
  'grave_tablet',
  'corpse_candle',
  'bell_rope',
]);

export function isLitanyPuzzleKind(kind: string | undefined): boolean {
  return kind !== undefined && LITANY_PUZZLE_KINDS.has(kind);
}

export function isDelvePuzzleKind(kind: string | undefined): boolean {
  return kind === 'pressure_plate' || isLitanyPuzzleKind(kind);
}

const EGG_SAC_WAVE_RADIUS = 7;
const EGG_SAC_WAVE_PCT = 0.06;
const BELL_ROPE_DAMAGE = 18;

// Sinkhole Baptistry egg-sac spawn points, on the pit-rim walkway, clear of the
// two flanking stubs and the four pit pillars (same spots the old widow_egg_sac
// interactables used).
export const BAPTISTRY_EGG_SAC_SPOTS: Array<{ x: number; z: number }> = [
  { x: 15, z: 10 },
  { x: -15, z: 6 },
  { x: 0, z: 58 },
];

// Sinkhole Baptistry waves (PRD section 9, Room 4). Positions sit on the pit-rim
// walkway, clear of the two flanking stubs (x=+-14, z 35..45) and the four pit
// pillars (x=+-8, z 34/46). Validated by the spawn-collision audit test.
export const BAPTISTRY_WAVES: Array<Array<{ mobId: string; x: number; z: number }>> = [
  // Wave 1: a widowling swarm with two spearjaw skirmishers.
  [
    { mobId: 'mirefen_widowling', x: -12, z: 22 },
    { mobId: 'mirefen_widowling', x: 12, z: 22 },
    { mobId: 'mirefen_widowling', x: -16, z: 30 },
    { mobId: 'mirefen_widowling', x: 16, z: 30 },
    { mobId: 'deepfen_spearjaw', x: -4, z: 26 },
    { mobId: 'deepfen_spearjaw', x: 4, z: 26 },
  ],
  // Wave 2: ranged acolytes and a cantor behind a choir-thrall screen.
  [
    { mobId: 'reedbound_acolyte', x: -16, z: 56 },
    { mobId: 'reedbound_acolyte', x: 16, z: 56 },
    { mobId: 'drowned_cantor', x: 0, z: 58 },
    { mobId: 'choir_thrall', x: -5, z: 52 },
    { mobId: 'choir_thrall', x: 5, z: 52 },
    { mobId: 'choir_thrall', x: 0, z: 64 },
  ],
  // Wave 3: a grave-silt bulwark anchored by two widowlings.
  [
    { mobId: 'grave_silt_bulwark', x: 0, z: 30 },
    { mobId: 'mirefen_widowling', x: -10, z: 24 },
    { mobId: 'mirefen_widowling', x: 10, z: 24 },
  ],
];

export function litanyPuzzleTriggeredTemplate(kind: string, triggered: boolean): string | null {
  if (!triggered) return null;
  switch (kind) {
    case 'sluice_valve':
      return 'delve_sluice_valve_open';
    case 'grave_tablet':
      return 'delve_grave_tablet_lit';
    case 'corpse_candle':
      return 'delve_corpse_candle_lit';
    case 'bell_rope':
      return 'delve_bell_rope_pulled';
    default:
      return null;
  }
}

function litanyEnemyLevelBonus(run: DelveRun): number {
  const tier = DELVES[run.delveId]?.tiers.find((t) => t.id === run.tierId);
  return tier?.enemyLevelBonus ?? 0;
}

function livingCantorsInRun(ctx: SimContext, run: DelveRun): Entity[] {
  const out: Entity[] = [];
  for (const id of run.mobIds) {
    const m = ctx.entities.get(id);
    if (m && !m.dead && m.templateId === 'drowned_cantor') out.push(m);
  }
  return out;
}

function combatOpenInModule(ctx: SimContext, run: DelveRun): boolean {
  return run.mobIds.some((id) => {
    const m = ctx.entities.get(id);
    return m && !m.dead && m.inCombat;
  });
}

function onBellRopePulled(ctx: SimContext, run: DelveRun): void {
  if (!combatOpenInModule(ctx, run)) return;
  const cantors = livingCantorsInRun(ctx, run);
  if (!cantors.length) return;
  for (const cantor of cantors) {
    ctx.dealDamage(null, cantor, BELL_ROPE_DAMAGE, false, 'holy', 'Bell Shock', 'hit', true);
  }
  if (!run.partyKey) return;
  for (const pid of ctx.partyMembersForKey(run.partyKey)) {
    ctx.emit({
      type: 'log',
      text: 'The bell rope snaps taut. Drowned Cantors reel from the shock.',
      color: '#adf',
      pid,
    });
  }
}

// How long the burst VFX plays before the corpse is removed from the world.
const EGG_SAC_BURST_DESPAWN = 1.1;
const HATCHLING_BODY_R = 0.8;
const HATCHLING_SPAWN_ATTEMPTS = 12;

/** True when a Baptistry hatchling center is on authored floor and clear of
 * the exact rotated shell/interior colliders. Coordinates are world-space. */
export function litanyHatchlingSpawnClear(
  run: DelveRun,
  worldX: number,
  worldZ: number,
  r = HATCHLING_BODY_R,
): boolean {
  const geo = litanyModuleGeometry('litany_baptistry');
  if (!geo) return false;
  const zBase = delveModuleZOffsetLayout(run.modules, run.moduleIndex);
  const x = worldX - run.origin.x;
  const z = worldZ - run.origin.z - zBase;
  const polygon = geo.walkable[0]?.points;
  if (!polygon || !polygonContainsPoint(polygon, x, z)) return false;
  for (const c of litanyModuleColliders('litany_baptistry')) {
    if (c.type === 'circle') {
      if (Math.hypot(x - c.x, z - c.z) < c.r + r) return false;
      continue;
    }
    const cos = Math.cos(-c.rot);
    const sin = Math.sin(-c.rot);
    const lx = (x - c.x) * cos + (z - c.z) * sin;
    const lz = -(x - c.x) * sin + (z - c.z) * cos;
    if (Math.abs(lx) < c.hw + r && Math.abs(lz) < c.hd + r) return false;
  }
  return true;
}

function hatchlingSpawnPos(ctx: SimContext, run: DelveRun, dead: Entity): Vec3 {
  for (let attempt = 0; attempt < HATCHLING_SPAWN_ATTEMPTS; attempt++) {
    const ang = ctx.rng.range(0, Math.PI * 2);
    const dist = ctx.rng.range(2, 4.5);
    const x = dead.pos.x + Math.sin(ang) * dist;
    const z = dead.pos.z + Math.cos(ang) * dist;
    if (litanyHatchlingSpawnClear(run, x, z)) return ctx.groundPos(x, z);
  }
  // Every authored sac site is itself collider-clear. Falling back to the sac
  // center guarantees a valid spawn even under an adversarial RNG sequence.
  return ctx.groundPos(dead.pos.x, dead.pos.z);
}

/** Fires once a spawned spider_egg_sac mob dies: a burst VFX, small nature-damage
 * tick on nearby players, 2 mirefen_widowling adds hatching out near the corpse,
 * then the sac itself is gone shortly after, it is a stationary prop, not a real
 * creature, so it should not linger as a normal lootable mob corpse. */
function onEggSacBurst(ctx: SimContext, run: DelveRun, dead: Entity): void {
  ctx.emit({ type: 'spellfx', sourceId: dead.id, targetId: dead.id, school: 'nature', fx: 'nova' });
  dead.despawnTimer = EGG_SAC_BURST_DESPAWN;
  if (!run.partyKey) return;
  const members = ctx.partyMembersForKey(run.partyKey);
  for (const pid of members) {
    const p = ctx.entities.get(pid);
    if (!p || p.dead) continue;
    if (dist2d(p.pos, dead.pos) > EGG_SAC_WAVE_RADIUS) continue;
    const dmg = Math.max(1, Math.round(p.maxHp * EGG_SAC_WAVE_PCT));
    ctx.dealDamage(null, p, dmg, false, 'nature', 'Egg-Sac Burst', 'hit', true);
  }
  for (const pid of members) {
    ctx.emit({
      type: 'log',
      text: 'The egg-sac bursts. Spiderlings skitter free across the baptistry rim.',
      color: '#8c9',
      pid,
    });
  }
  const tmpl = MOBS.mirefen_widowling;
  if (!tmpl) return;
  // Hatchlings carry the same Heroic level bonus as the waves (and the sac
  // itself), so they are not 3 levels grey under the rest of the room.
  const enemyLevelBonus = litanyEnemyLevelBonus(run);
  for (let i = 0; i < 2; i++) {
    const pos = hatchlingSpawnPos(ctx, run, dead);
    const add = createMob(ctx.nextId++, tmpl, tmpl.minLevel + enemyLevelBonus, pos);
    add.facing = Math.PI;
    ctx.addEntity(add);
    run.mobIds.push(add.id);
  }
}

function markPuzzleTriggered(
  ctx: SimContext,
  run: DelveRun,
  obj: Entity,
  state: { kind: string; triggered: boolean },
): void {
  state.triggered = true;
  const nextTpl = litanyPuzzleTriggeredTemplate(state.kind, true);
  if (nextTpl) obj.templateId = nextTpl;
  if (state.kind === 'bell_rope') onBellRopePulled(ctx, run);
}

/** Deliberate F-pull on a bell rope (delveInteract routes here). Unlike the
 * walk-on plates, ropes only trigger on an explicit interact. Range and run
 * membership are already checked by the caller. */
export function pullLitanyBellRope(
  ctx: SimContext,
  run: DelveRun,
  obj: Entity,
  state: { kind: string; triggered: boolean },
): void {
  if (state.triggered) return;
  markPuzzleTriggered(ctx, run, obj, state);
}

function livingTrashInModule(ctx: SimContext, run: DelveRun): boolean {
  return run.mobIds.some((id) => {
    const m = ctx.entities.get(id);
    return m && !m.dead;
  });
}

function spawnBaptistryWave(
  ctx: SimContext,
  run: DelveRun,
  waveIndex: number,
  enemyLevelBonus: number,
  zBase: number,
): void {
  const wave = BAPTISTRY_WAVES[waveIndex];
  if (!wave) return;
  for (const spawn of wave) {
    const template = MOBS[spawn.mobId];
    if (!template) continue;
    const level = template.minLevel + enemyLevelBonus;
    const mob = createMob(
      ctx.nextId++,
      template,
      level,
      ctx.groundPos(run.origin.x + spawn.x, run.origin.z + zBase + spawn.z),
    );
    mob.facing = Math.PI;
    mob.prevFacing = mob.facing;
    if (run.affixes.includes('belligerent_dead') && spawn.mobId === 'grave_silt_bulwark') {
      mob.maxHp = Math.round(mob.maxHp * 1.1);
      mob.hp = mob.maxHp;
    }
    ctx.addEntity(mob);
    run.mobIds.push(mob.id);
  }
}

/** Spawns a stationary spider_egg_sac mob (1hp, real combat target) at `pos`,
 * registers it on the run, and returns its entity id. */
function spawnLitanyEggSacMob(
  ctx: SimContext,
  run: DelveRun,
  pos: Vec3,
  enemyLevelBonus: number,
): number {
  const tmpl = MOBS.spider_egg_sac;
  if (!tmpl) return -1;
  const mob = createMob(ctx.nextId++, tmpl, tmpl.minLevel + enemyLevelBonus, pos);
  mob.facing = 0;
  mob.prevFacing = mob.facing;
  ctx.addEntity(mob);
  run.mobIds.push(mob.id);
  return mob.id;
}

function enableLitanyBaptistryEggSacs(ctx: SimContext, run: DelveRun, zBase: number): void {
  if (!run.litanyBaptistry || run.litanyBaptistry.eggsEnabled) return;
  run.litanyBaptistry.eggsEnabled = true;
  const enemyLevelBonus = litanyEnemyLevelBonus(run);
  for (const spot of BAPTISTRY_EGG_SAC_SPOTS) {
    const pos = ctx.groundPos(run.origin.x + spot.x, run.origin.z + zBase + spot.z);
    const id = spawnLitanyEggSacMob(ctx, run, pos, enemyLevelBonus);
    if (id >= 0) run.litanyBaptistry.eggSacIds.push(id);
  }
  if (!run.partyKey) return;
  for (const pid of ctx.partyMembersForKey(run.partyKey)) {
    ctx.emit({
      type: 'log',
      text: 'The baptistry falls quiet. Spider egg-sacs cling wetly to the rim.',
      color: '#8c9',
      pid,
    });
  }
}

/** Polls the spawned egg-sac mobs for a kill and fires the burst exactly once
 * per sac (mob death has no dedicated event hook into delve room logic, so
 * this rides the same per-tick poll the baptistry waves already use). */
function tickLitanyEggSacBursts(ctx: SimContext, run: DelveRun): void {
  const st = run.litanyBaptistry;
  if (!st?.eggsEnabled) return;
  for (const id of st.eggSacIds) {
    if (st.burstIds.includes(id)) continue;
    const dead = ctx.entities.get(id);
    if (!dead?.dead) continue;
    st.burstIds.push(id);
    onEggSacBurst(ctx, run, dead);
  }
}

export function initLitanyBaptistryModule(
  ctx: SimContext,
  run: DelveRun,
  enemyLevelBonus: number,
  zBase: number,
): void {
  run.litanyBaptistry = { wave: 0, eggsEnabled: false, eggSacIds: [], burstIds: [] };
  spawnBaptistryWave(ctx, run, 0, enemyLevelBonus, zBase);
}

function tickLitanyBaptistryWaves(ctx: SimContext, run: DelveRun): void {
  const st = run.litanyBaptistry;
  if (!st || run.modules[run.moduleIndex] !== 'litany_baptistry') return;
  if (livingTrashInModule(ctx, run)) return;
  const tier = run.tierId === 'heroic' ? 3 : 0;
  const zBase = delveModuleZOffsetLayout(run.modules, run.moduleIndex);
  const nextWave = st.wave + 1;
  if (nextWave < BAPTISTRY_WAVES.length) {
    st.wave = nextWave;
    spawnBaptistryWave(ctx, run, nextWave, tier, zBase);
    if (!run.partyKey) return;
    for (const pid of ctx.partyMembersForKey(run.partyKey)) {
      ctx.emit({
        type: 'log',
        text: 'Something stirs in the black baptistry water.',
        color: '#a9c',
        pid,
      });
    }
    return;
  }
  if (!st.eggsEnabled) enableLitanyBaptistryEggSacs(ctx, run, zBase);
}

function tickLitanyRoomPuzzles(ctx: SimContext, run: DelveRun): void {
  if (run.delveId !== 'drowned_litany') return;
  for (const id of run.objectIds) {
    const state = run.objectState[id];
    if (!state || state.triggered || !isLitanyPuzzleKind(state.kind)) continue;
    const obj = ctx.entities.get(id);
    if (!obj || !run.partyKey) continue;
    for (const pid of ctx.partyMembersForKey(run.partyKey)) {
      const p = ctx.entities.get(pid);
      if (!p || p.dead) continue;
      const d = dist2d(p.pos, obj.pos);
      if (d <= DELVE_PLATE_RADIUS + 4) ctx.maybeCompanionBark(run, pid, 'trap_spotted');
      if (d > DELVE_PLATE_RADIUS) continue;
      // Bell ropes are deliberate F-pulls (pullLitanyBellRope via delveInteract),
      // never walk-on triggers; the companion still barks the hint above.
      if (state.kind === 'bell_rope') continue;
      markPuzzleTriggered(ctx, run, obj, state);
      break;
    }
  }
}

export function tickDrownedLitanyRooms(ctx: SimContext, run: DelveRun): void {
  tickLitanyBaptistryWaves(ctx, run);
  tickLitanyEggSacBursts(ctx, run);
  tickLitanyRoomPuzzles(ctx, run);
}
