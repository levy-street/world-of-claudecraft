// The Drowned Litany room puzzle semantics (sim-only). Walk-on valves/tablets/
// candles/ropes and destroyable baptistry egg-sacs gate the module exit.

import { DELVE_MODULES, delveModuleZOffset as delveModuleZOffsetLayout, MOBS } from '../data';
import { createGroundObject, createMob } from '../entity';
import type { SimContext } from '../sim_context';
import { DELVE_PLATE_RADIUS, type DelveRun, dist2d, type Entity, type Vec3 } from '../types';
export const LITANY_PUZZLE_KINDS = new Set([
  'sluice_valve',
  'grave_tablet',
  'corpse_candle',
  'widow_egg_sac',
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
    case 'widow_egg_sac':
      return 'delve_widow_egg_sac_burst';
    case 'bell_rope':
      return 'delve_bell_rope_pulled';
    default:
      return null;
  }
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

function onEggSacBurst(ctx: SimContext, run: DelveRun, obj: Entity): void {
  if (!run.partyKey) return;
  const members = ctx.partyMembersForKey(run.partyKey);
  for (const pid of members) {
    const p = ctx.entities.get(pid);
    if (!p || p.dead) continue;
    if (dist2d(p.pos, obj.pos) > EGG_SAC_WAVE_RADIUS) continue;
    const dmg = Math.max(1, Math.round(p.maxHp * EGG_SAC_WAVE_PCT));
    ctx.dealDamage(null, p, dmg, false, 'nature', 'Egg-Sac Burst', 'hit', true);
  }
  for (const pid of members) {
    ctx.emit({
      type: 'log',
      text: 'The egg-sac bursts. Blackwater slops across the baptistry rim.',
      color: '#8c9',
      pid,
    });
  }
  const tmpl = MOBS.mirefen_widowling;
  if (!tmpl) return;
  for (let i = 0; i < 2; i++) {
    const ang = ctx.rng.range(0, Math.PI * 2);
    const dist = ctx.rng.range(2, 4.5);
    const pos = ctx.groundPos(obj.pos.x + Math.sin(ang) * dist, obj.pos.z + Math.cos(ang) * dist);
    const add = createMob(ctx.nextId++, tmpl, tmpl.minLevel, pos);
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
  if (state.kind === 'widow_egg_sac') onEggSacBurst(ctx, run, obj);
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

function spawnLitanyEggSac(ctx: SimContext, run: DelveRun, pos: Vec3): void {
  const obj = createGroundObject(ctx.nextId++, '', 'Widow Egg-Sac', pos);
  obj.templateId = 'delve_widow_egg_sac';
  obj.maxHp = 1;
  obj.hp = 1;
  run.objectState[obj.id] = {
    kind: 'widow_egg_sac',
    triggered: false,
    hp: 1,
    maxHp: 1,
    linkIds: [],
    open: true,
  };
  run.objectIds.push(obj.id);
  ctx.addEntity(obj);
}

function enableLitanyBaptistryEggSacs(ctx: SimContext, run: DelveRun, zBase: number): void {
  const mod = DELVE_MODULES.litany_baptistry;
  if (!mod || !run.litanyBaptistry || run.litanyBaptistry.eggsEnabled) return;
  run.litanyBaptistry.eggsEnabled = true;
  for (const slot of mod.interactableSlots) {
    for (const variant of slot.variants) {
      if (variant !== 'widow_egg_sac') continue;
      const pos = ctx.groundPos(run.origin.x + slot.x, run.origin.z + zBase + slot.z);
      spawnLitanyEggSac(ctx, run, pos);
    }
  }
  if (!run.partyKey) return;
  for (const pid of ctx.partyMembersForKey(run.partyKey)) {
    ctx.emit({
      type: 'log',
      text: 'The baptistry falls quiet. Widow egg-sacs swell along the rim.',
      color: '#8c9',
      pid,
    });
  }
}

export function initLitanyBaptistryModule(
  ctx: SimContext,
  run: DelveRun,
  enemyLevelBonus: number,
  zBase: number,
): void {
  run.litanyBaptistry = { wave: 0, eggsEnabled: false };
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
      markPuzzleTriggered(ctx, run, obj, state);
      break;
    }
  }
}

export function tickDrownedLitanyRooms(ctx: SimContext, run: DelveRun): void {
  tickLitanyBaptistryWaves(ctx, run);
  tickLitanyRoomPuzzles(ctx, run);
}
