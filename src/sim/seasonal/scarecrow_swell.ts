// The Swelling Gourd: the giant pumpkin Old Thatchgrin's patch heaves up behind him, twice
// a pull (THATCHGRIN_KIT.swell; numbers are DESIGN values, flagged in
// content/gourdlight_eve_scarecrow.ts).
//
//   It RISES at a health threshold, some yards behind him, so the group has to turn its
//   back on him to reach it. Its pool is a share of his maximum health at that moment, so
//   a bigger crowd faces a bigger gourd.
//   While it LIVES he wears the Harvest Ward (a buff_dr aura: most of every hit shrugged
//   off), and it ripens on a fuse: its cast bar, the timer every frame reads.
//   BROKEN, it takes the ward with it and he reels: Uprooted (a stun he applies to
//   himself, the scripted-mechanic path past his CC immunity) and Split Rind (a
//   vulnerability: every hit lands harder) for a few seconds.
//   If the fuse RUNS OUT it bursts over the whole fight: each fighter loses a share of
//   their MAXIMUM health, clamped one point short of it and resolved as an exact hit (no
//   amplifier can push it further), so it can never kill a fighter who stood at full
//   health. The ward goes with the burst.
//
// The gourd never moves, aggroes or swings: it is re-pinned every tick (the Bone Spike
// precedent, nythraxis_bone_spike.ts). Draws no rng.
import {
  SWELLING_GOURD_ID,
  THATCHGRIN_KIT,
  THATCHGRIN_SWELL_ABILITY,
} from '../content/gourdlight_eve_scarecrow';
import { MOBS } from '../data';
import { createMob } from '../entity';
import type { SimContext } from '../sim_context';
import type { Aura, Entity } from '../types';
import { DT, dist2d } from '../types';
import { scarecrowFighters } from './scarecrow_fighters';
import type { ScarecrowState } from './scarecrow_state';

export const HARVEST_WARD_AURA_ID = 'thatchgrin_harvest_ward';
export const UPROOTED_AURA_ID = 'thatchgrin_uprooted';
export const SPLIT_RIND_AURA_ID = 'thatchgrin_split_rind';
export const GOURD_BURST_SFX = 'impact_fire';
export const GOURD_RISE_SFX = 'spell_nova';

const EPS = 1e-6;

/** His ward while a gourd lives (permanent until the gourd is gone). */
export function harvestWardAura(bossId: number): Aura {
  const w = THATCHGRIN_KIT.swell.ward;
  return {
    id: HARVEST_WARD_AURA_ID,
    name: w.name,
    kind: 'buff_dr',
    value: w.reduction,
    remaining: 0,
    duration: 0,
    permanent: true,
    undispellable: true,
    sourceId: bossId,
    school: 'nature',
  };
}

function uprootedAura(bossId: number): Aura {
  const s = THATCHGRIN_KIT.swell.stagger;
  return {
    id: UPROOTED_AURA_ID,
    name: s.name,
    kind: 'stun',
    value: 0,
    remaining: s.seconds,
    duration: s.seconds,
    undispellable: true,
    // self-applied: the scripted-mechanic path past his CC immunity (sim.ts applyAura)
    sourceId: bossId,
    school: 'nature',
  };
}

function splitRindAura(bossId: number): Aura {
  const x = THATCHGRIN_KIT.swell.exposed;
  return {
    id: SPLIT_RIND_AURA_ID,
    name: x.name,
    kind: 'vulnerability',
    value: x.amp,
    remaining: x.seconds,
    duration: x.seconds,
    undispellable: true,
    sourceId: bossId,
    school: 'nature',
  };
}

function dropWard(ctx: SimContext, boss: Entity): void {
  const i = boss.auras.findIndex((a) => a.id === HARVEST_WARD_AURA_ID);
  if (i < 0) return;
  const [ward] = boss.auras.splice(i, 1);
  ctx.emit({ type: 'aura', targetId: boss.id, name: ward.name, gained: false });
}

/** Hold the gourd where it rose, never swinging, its bar showing the fuse. */
function pinGourd(gourd: Entity, fuse: number): void {
  gourd.pos = { ...gourd.spawnPos };
  gourd.prevPos = { ...gourd.spawnPos };
  gourd.vx = 0;
  gourd.vz = 0;
  gourd.aggroTargetId = null;
  gourd.inCombat = true;
  gourd.aiState = 'attack';
  gourd.swingTimer = Number.POSITIVE_INFINITY;
  const s = THATCHGRIN_KIT.swell;
  gourd.castingAbility = s.fuseName;
  gourd.castTotal = s.fuse;
  gourd.castRemaining = Math.max(0, fuse);
  gourd.castTargetId = null;
  gourd.channeling = false;
}

/** Where the gourd heaves up: `distance` yards straight behind him. */
export function swellingGourdSpot(boss: Entity): { x: number; z: number } {
  const d = THATCHGRIN_KIT.swell.distance;
  return {
    x: boss.pos.x - Math.sin(boss.facing) * d,
    z: boss.pos.z - Math.cos(boss.facing) * d,
  };
}

/** Raise a Swelling Gourd now. Null when one already stands or the template is missing. */
export function raiseSwellingGourd(
  ctx: SimContext,
  boss: Entity,
  st: ScarecrowState,
): Entity | null {
  const kit = st.kit;
  const template = MOBS[SWELLING_GOURD_ID];
  if (!kit || !template || kit.swellId !== null) return null;
  const s = THATCHGRIN_KIT.swell;
  const spot = swellingGourdSpot(boss);
  const gourd = createMob(ctx.nextId++, template, template.maxLevel, ctx.groundPos(spot.x, spot.z));
  gourd.maxHp = Math.max(1, Math.round(boss.maxHp * s.hpShare));
  gourd.hp = gourd.maxHp;
  gourd.spawnPos = { ...gourd.pos };
  // it faces him, its carved grin turned on the group that has to turn away from him
  gourd.facing = Math.atan2(boss.pos.x - gourd.pos.x, boss.pos.z - gourd.pos.z);
  gourd.prevFacing = gourd.facing;
  gourd.tappedById = boss.tappedById;
  gourd.lootable = false;
  gourd.loot = null;
  gourd.summonedAdd = true;
  pinGourd(gourd, s.fuse);
  ctx.addEntity(gourd);
  boss.summonedIds.push(gourd.id);
  kit.swellId = gourd.id;
  kit.swellFuse = s.fuse;
  kit.swellsRisen++;
  ctx.applyAura(boss, harvestWardAura(boss.id));
  ctx.emit({
    type: 'spellfxAt',
    sourceId: boss.id,
    targetId: gourd.id,
    x: gourd.pos.x,
    z: gourd.pos.z,
    school: s.school,
    fx: 'burst',
    radius: 3,
    duration: s.fuse,
    ability: THATCHGRIN_SWELL_ABILITY,
    sfxKey: GOURD_RISE_SFX,
  });
  return gourd;
}

/** The gourd fell to the group: the ward goes, he reels and splits open. */
function breakGourd(ctx: SimContext, boss: Entity, st: ScarecrowState, gourd: Entity): void {
  const kit = st.kit;
  if (kit) kit.swellId = null;
  dropWard(ctx, boss);
  ctx.applyAura(boss, uprootedAura(boss.id));
  ctx.applyAura(boss, splitRindAura(boss.id));
  ctx.emit({
    type: 'spellfxAt',
    sourceId: boss.id,
    targetId: boss.id,
    x: gourd.pos.x,
    z: gourd.pos.z,
    school: THATCHGRIN_KIT.swell.school,
    fx: 'tick',
    radius: 3,
    ability: THATCHGRIN_SWELL_ABILITY,
  });
}

/** The fuse ran out: the gourd bursts over his whole fight, then it is gone. */
function burstGourd(ctx: SimContext, boss: Entity, st: ScarecrowState, gourd: Entity): void {
  const kit = st.kit;
  const s = THATCHGRIN_KIT.swell;
  ctx.emit({
    type: 'spellfxAt',
    sourceId: boss.id,
    x: gourd.pos.x,
    z: gourd.pos.z,
    school: s.school,
    fx: 'nova',
    radius: s.burst.radius,
    ability: THATCHGRIN_SWELL_ABILITY,
    sfxKey: GOURD_BURST_SFX,
  });
  for (const p of scarecrowFighters(ctx, boss)) {
    if (dist2d(p.pos, gourd.pos) > s.burst.radius) continue;
    ctx.dealDamage(
      boss,
      p,
      swellingBurstDamage(p.maxHp),
      false,
      s.school,
      s.burst.name,
      'hit',
      true,
      undefined,
      true,
      false,
      false,
      null,
      true,
      undefined,
      // an exact hit: no amplifier, absorb or redirect can move it off the clamp
      true,
    );
  }
  if (kit) kit.swellId = null;
  dropWard(ctx, boss);
  ctx.dropEntity(gourd.id);
}

/** The burst's damage to a fighter with this maximum health: the design share, clamped one
 *  point short of the whole bar, so a fighter at full health always survives it. */
export function swellingBurstDamage(maxHp: number): number {
  const share = Math.round(maxHp * THATCHGRIN_KIT.swell.burst.maxHpShare);
  return Math.max(0, Math.min(share, maxHp - 1));
}

/** Take a standing gourd and his ward out of the world (a pull reset, the event closing,
 *  his death). No burst, no reel. */
export function clearSwellingGourd(ctx: SimContext, boss: Entity | null, st: ScarecrowState): void {
  const kit = st.kit;
  if (!kit) return;
  if (kit.swellId !== null) {
    const gourd = ctx.entities.get(kit.swellId);
    if (gourd && gourd.templateId === SWELLING_GOURD_ID) ctx.dropEntity(gourd.id);
    kit.swellId = null;
  }
  if (boss) dropWard(ctx, boss);
}

/** One tick of the gourd (scarecrow_kit.ts calls it every engaged tick). */
export function tickSwellingGourd(ctx: SimContext, boss: Entity, st: ScarecrowState): void {
  const kit = st.kit;
  if (!kit) return;
  if (kit.swellId !== null) {
    const gourd = ctx.entities.get(kit.swellId);
    if (!gourd || gourd.templateId !== SWELLING_GOURD_ID) {
      kit.swellId = null;
      dropWard(ctx, boss);
      return;
    }
    if (gourd.dead) {
      breakGourd(ctx, boss, st, gourd);
      return;
    }
    kit.swellFuse -= DT;
    if (kit.swellFuse <= EPS) {
      burstGourd(ctx, boss, st, gourd);
      return;
    }
    pinGourd(gourd, kit.swellFuse);
    return;
  }
  const at = THATCHGRIN_KIT.swell.atHpPct[kit.swellsRisen];
  if (at === undefined) return;
  // breaking a gourd buys its whole window: the next one never rises (and wards him
  // again) while he is still Uprooted or his rind still split, even if he is already
  // under its threshold; it rises the tick the window closes
  if (boss.auras.some((a) => a.id === UPROOTED_AURA_ID || a.id === SPLIT_RIND_AURA_ID)) return;
  if (boss.hp / Math.max(1, boss.maxHp) <= at) raiseSwellingGourd(ctx, boss, st);
}
