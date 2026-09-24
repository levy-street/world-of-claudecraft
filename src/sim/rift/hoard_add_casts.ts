// The hoard rooms' rank and file get a signature cast each: a real cast bar on
// the mob, interruptible like every hoard control (a kick cancels it for good),
// and an effect that lands only when the bar completes. One table, one tick:
//
//   Tide Thrall      Drowning Hook   pulls its target to it (the paladin's chain)
//   Rime Elemental   Rime Beam       a channel that freezes its target a tick at a time
//   Ember Fiend      Cinder Bolt     a bolt of forge fire
//   Voidscar Acolyte Void Empowerment  the room's mobs hit harder for a while
//   Venom Weaver     Webbing         roots its target
//   Marrow Golem     Doom Ritual     two Boneclad Warriors rise, while any are dead
//
// Targeting is deterministic (a cursor, never the rng), the caster keeps fighting
// while it casts (the bigCast precedent), and death, an interrupt, a reset or an
// empty room cancel the cast. The ground tell is the control sigil every hoard
// cast already draws (hoard_encounter_accents.ts); nothing here is a boss cue.

import { pullPaladinTarget } from '../combat/paladin_control';
import { RIFT_REGION_HALF_X, RIFT_REGION_HALF_Z, riftInstanceOrigin } from '../data';
import { findNearbyAllies } from '../mob/nearby_allies';
import type { SimContext } from '../sim_context';
import { type Aura, DT, type Entity } from '../types';
import {
  HOARD_ADD_CAST_SCHOOLS,
  HOARD_CAST_CINDER_BOLT,
  HOARD_CAST_DOOM_RITUAL,
  HOARD_CAST_DROWNING_HOOK,
  HOARD_CAST_RIME_BEAM,
  HOARD_CAST_VOID_EMPOWER,
  HOARD_CAST_WEBBING,
} from './hoard_control_cast_ids';
import { hoardMechanicDamage } from './hoard_scaling';
import type { RiftInstance } from './types';

export type HoardAddCastKind = 'hook' | 'beam' | 'bolt' | 'empower' | 'web' | 'ritual';

export interface HoardAddCastDef {
  castId: string;
  kind: HoardAddCastKind;
  /** The bar. Owner rule: no hoard caster bar is shorter than two seconds. */
  castSec: number;
  /** Seconds between one caster's casts, and before its first. */
  cooldownSec: number;
  firstDelaySec: number;
  /** A target further than this from the caster is not picked. */
  rangeYards: number;
  school: Aura['school'];
  name: string;
  /** Share of the reference health (HOARD_REFERENCE_HEALTH) a hit deals (a beam deals it over its ticks). */
  damageFraction?: number;
  /** Web: seconds rooted. Empower: seconds of the buff and its attack power. */
  durationSec?: number;
  value?: number;
  /** Ritual: what rises, how many, and how many of one caster's may live at once. */
  summon?: { templateId: string; count: number; maxAlive: number };
}

const HOOK: HoardAddCastDef = {
  castId: HOARD_CAST_DROWNING_HOOK,
  kind: 'hook',
  castSec: 2.5,
  cooldownSec: 14,
  firstDelaySec: 4,
  rangeYards: 26,
  school: 'nature',
  name: 'Drowning Hook',
};
const BEAM: HoardAddCastDef = {
  castId: HOARD_CAST_RIME_BEAM,
  kind: 'beam',
  castSec: 3,
  cooldownSec: 10,
  firstDelaySec: 3,
  rangeYards: 30,
  school: 'frost',
  name: 'Rime Beam',
  damageFraction: 0.24,
};
const BOLT: HoardAddCastDef = {
  castId: HOARD_CAST_CINDER_BOLT,
  kind: 'bolt',
  castSec: 2.5,
  cooldownSec: 7,
  firstDelaySec: 2.5,
  rangeYards: 30,
  school: 'fire',
  name: 'Cinder Bolt',
  damageFraction: 0.16,
};
const EMPOWER: HoardAddCastDef = {
  castId: HOARD_CAST_VOID_EMPOWER,
  kind: 'empower',
  castSec: 3,
  cooldownSec: 18,
  firstDelaySec: 5,
  rangeYards: 40,
  school: 'shadow',
  name: 'Void Empowerment',
  durationSec: 10,
  value: 30,
};
const WEB: HoardAddCastDef = {
  castId: HOARD_CAST_WEBBING,
  kind: 'web',
  castSec: 3,
  cooldownSec: 12,
  firstDelaySec: 3.5,
  rangeYards: 28,
  school: 'nature',
  name: 'Webbing',
  durationSec: 3,
};
const RITUAL: HoardAddCastDef = {
  castId: HOARD_CAST_DOOM_RITUAL,
  kind: 'ritual',
  castSec: 4,
  cooldownSec: 20,
  firstDelaySec: 6,
  rangeYards: 40,
  school: 'shadow',
  name: 'Doom Ritual',
  summon: { templateId: 'rift_boneclad', count: 2, maxAlive: 2 },
};

/** Which mob template knows which cast. */
export const HOARD_ADD_CASTS: Readonly<Record<string, HoardAddCastDef>> = Object.freeze({
  rift_tide_thrall: HOOK,
  rift_rime_elemental: BEAM,
  rift_ember_fiend: BOLT,
  rift_void_acolyte: EMPOWER,
  rift_venom_weaver: WEB,
  rift_marrow_golem: RITUAL,
});

/** The beam hurts this often. */
const BEAM_TICK_SEC = 0.5;
/** The empowerment reaches this far round the acolyte. */
const EMPOWER_RADIUS = 30;
/** Where a mob's own on-hit root is silenced: the web is its cast now. */
export const HOARD_WEB_CASTERS: readonly string[] = ['rift_venom_weaver'];

export interface HoardAddCastState {
  targetCursor: number;
  /** Seconds until each caster may cast again, by mob id. */
  cooldowns: Map<number, number>;
  casts: Array<{ casterId: number; targetId: number | null; def: HoardAddCastDef; tick: number }>;
}

export { HOARD_ADD_CAST_SCHOOLS };

function roomPlayers(ctx: SimContext, inst: RiftInstance): Entity[] {
  const origin = riftInstanceOrigin(inst.slot, inst.floorIndex);
  return [...inst.memberIds]
    .sort((a, b) => a - b)
    .map((id) => ctx.entities.get(id))
    .filter(
      (entity): entity is Entity =>
        entity !== undefined &&
        Math.abs(entity.pos.x - origin.x) <= RIFT_REGION_HALF_X &&
        Math.abs(entity.pos.z - origin.z) <= RIFT_REGION_HALF_Z,
    );
}

function within(a: { x: number; z: number }, b: { x: number; z: number }, range: number): boolean {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return dx * dx + dz * dz <= range * range;
}

/** The caster's aggro target when it is a living player in reach, else the next
 *  living player in reach by cursor. Deterministic: no rng draw. */
function pickTarget(
  caster: Entity,
  living: readonly Entity[],
  range: number,
  state: HoardAddCastState,
): Entity | null {
  const inReach = living.filter((player) => within(caster.pos, player.pos, range));
  if (inReach.length === 0) return null;
  const aggro = inReach.find((player) => player.id === caster.aggroTargetId);
  if (aggro && state.targetCursor % 2 === 0) {
    state.targetCursor++;
    return aggro;
  }
  const picked = inReach[state.targetCursor % inReach.length];
  state.targetCursor++;
  return picked;
}

function castState(inst: RiftInstance): HoardAddCastState {
  if (!inst.hoardAddCasts) {
    inst.hoardAddCasts = { targetCursor: 0, cooldowns: new Map(), casts: [] };
  }
  return inst.hoardAddCasts;
}

function clearCast(caster: Entity | undefined, castId: string): void {
  if (!caster || caster.castingAbility !== castId) return;
  caster.castingAbility = null;
  caster.castRemaining = 0;
  caster.castTotal = 0;
  caster.castTargetId = null;
  caster.channeling = false;
}

function livingSummons(ctx: SimContext, caster: Entity): number {
  let alive = 0;
  for (const id of caster.summonedIds ?? []) {
    const add = ctx.entities.get(id);
    if (add && !add.dead && add.hp > 0) alive++;
  }
  return alive;
}

/** Whether the caster may begin its cast now: a ritual waits while its warriors live. */
function ready(ctx: SimContext, caster: Entity, def: HoardAddCastDef): boolean {
  if (def.kind !== 'ritual' || !def.summon) return true;
  return livingSummons(ctx, caster) < def.summon.maxAlive;
}

function hit(
  ctx: SimContext,
  inst: RiftInstance,
  caster: Entity,
  target: Entity,
  def: HoardAddCastDef,
  fraction: number,
): void {
  ctx.dealDamage(
    caster,
    target,
    hoardMechanicDamage(inst, fraction),
    false,
    def.school,
    def.name,
    'hit',
    true,
  );
}

function bolt(ctx: SimContext, caster: Entity, target: Entity, def: HoardAddCastDef): void {
  ctx.emit({
    type: 'spellfx',
    sourceId: caster.id,
    targetId: target.id,
    school: def.school,
    fx: 'projectile',
    ability: def.school === 'frost' ? 'frostbolt' : 'fireball',
  });
}

/** The cast completes: what lands. */
function land(
  ctx: SimContext,
  inst: RiftInstance,
  caster: Entity,
  target: Entity | undefined,
  def: HoardAddCastDef,
): void {
  switch (def.kind) {
    case 'hook':
      if (!target || target.dead) return;
      pullPaladinTarget(ctx, caster, target, 3, 18, 0.5, 3, HOARD_CAST_DROWNING_HOOK, def.name);
      return;
    case 'bolt':
      if (!target || target.dead) return;
      bolt(ctx, caster, target, def);
      hit(ctx, inst, caster, target, def, def.damageFraction ?? 0);
      return;
    case 'web':
      if (!target || target.dead) return;
      ctx.applyRootAura(
        caster,
        target,
        def.name,
        `ensnare_${caster.templateId}`,
        def.durationSec ?? 2,
        def.school,
      );
      return;
    case 'empower': {
      const allies = findNearbyAllies(ctx.grid, caster, EMPOWER_RADIUS);
      ctx.emit({
        type: 'spellfx',
        sourceId: caster.id,
        targetId: caster.id,
        school: def.school,
        fx: 'nova',
        ability: 'chain_lightning',
      });
      for (const ally of allies) {
        ctx.applyAura(ally, {
          id: HOARD_CAST_VOID_EMPOWER,
          name: def.name,
          kind: 'buff_ap',
          remaining: def.durationSec ?? 8,
          duration: def.durationSec ?? 8,
          value: def.value ?? 20,
          sourceId: caster.id,
          school: def.school,
        });
      }
      return;
    }
    case 'ritual': {
      if (!def.summon) return;
      const before = new Set(caster.summonedIds ?? []);
      ctx.spawnBossAdds(caster, def.summon.templateId, def.summon.count);
      // The risen belong to the room: the room's ticks and clean-up walk inst.mobIds.
      for (const id of caster.summonedIds ?? []) {
        if (!before.has(id) && !inst.mobIds.includes(id)) inst.mobIds.push(id);
      }
      return;
    }
    case 'beam':
      // A channel lands as it goes (beamTick); its end is nothing more.
      return;
  }
}

/** One tick of a channel: a bolt of frost every BEAM_TICK_SEC while the target is in reach. */
function beamTick(
  ctx: SimContext,
  inst: RiftInstance,
  caster: Entity,
  target: Entity | undefined,
  def: HoardAddCastDef,
): boolean {
  if (!target || target.dead || !within(caster.pos, target.pos, def.rangeYards)) return false;
  const ticks = Math.max(1, Math.round(def.castSec / BEAM_TICK_SEC));
  bolt(ctx, caster, target, def);
  hit(ctx, inst, caster, target, def, (def.damageFraction ?? 0) / ticks);
  return true;
}

/** One tick of every hoard add with a cast of its own, in every live Buried Hoard. */
export function tickHoardAddCasts(ctx: SimContext): void {
  for (const inst of ctx.riftInstances) {
    if (!inst.vault || inst.partyKey === null) {
      if (inst.hoardAddCasts) delete inst.hoardAddCasts;
      continue;
    }
    const players = roomPlayers(ctx, inst);
    const living = players.filter((player) => !player.dead);
    const state = inst.hoardAddCasts;

    if (state && state.casts.length > 0) {
      const live: HoardAddCastState['casts'] = [];
      for (const cast of state.casts) {
        const caster = ctx.entities.get(cast.casterId);
        const target = cast.targetId === null ? undefined : ctx.entities.get(cast.targetId);
        const cancelled =
          !caster ||
          caster.dead ||
          caster.hp <= 0 ||
          // Interrupted (cancelCast cleared the bar) or replaced by another cast.
          caster.castingAbility !== cast.def.castId ||
          // The encounter reset: the caster dropped combat, or nobody is left.
          (caster.aiState !== 'attack' && caster.aiState !== 'chase') ||
          living.length === 0 ||
          // A beam with nothing left to freeze stops.
          (cast.def.kind === 'beam' && (!target || target.dead));
        if (cancelled) {
          clearCast(caster, cast.def.castId);
          continue;
        }
        caster.castRemaining = Math.max(0, caster.castRemaining - DT);
        if (cast.def.kind === 'beam') {
          cast.tick += DT;
          if (cast.tick >= BEAM_TICK_SEC) {
            cast.tick -= BEAM_TICK_SEC;
            if (!beamTick(ctx, inst, caster, target, cast.def)) {
              clearCast(caster, cast.def.castId);
              continue;
            }
          }
        }
        if (caster.castRemaining > 0) {
          live.push(cast);
          continue;
        }
        clearCast(caster, cast.def.castId);
        land(ctx, inst, caster, target, cast.def);
      }
      state.casts = live;
    }

    if (living.length === 0) continue;
    for (const id of inst.mobIds) {
      const caster = ctx.entities.get(id);
      if (!caster || caster.dead || caster.hp <= 0) continue;
      const def = HOARD_ADD_CASTS[caster.templateId];
      if (!def) continue;
      const engaged = caster.aiState === 'attack' || caster.aiState === 'chase';
      const own = castState(inst);
      if (!engaged) {
        own.cooldowns.delete(caster.id);
        continue;
      }
      const cooldown = (own.cooldowns.get(caster.id) ?? def.firstDelaySec) - DT;
      own.cooldowns.set(caster.id, cooldown);
      if (cooldown > 0 || caster.castingAbility !== null) continue;
      if (!ready(ctx, caster, def)) continue;
      const wantsTarget = def.kind !== 'empower' && def.kind !== 'ritual';
      const target = wantsTarget ? pickTarget(caster, living, def.rangeYards, own) : null;
      if (wantsTarget && !target) continue;
      own.cooldowns.set(caster.id, def.cooldownSec);
      own.casts.push({ casterId: caster.id, targetId: target?.id ?? null, def, tick: 0 });
      caster.castingAbility = def.castId;
      caster.castTotal = def.castSec;
      caster.castRemaining = def.castSec;
      caster.castTargetId = target?.id ?? null;
      caster.channeling = def.kind === 'beam';
    }
  }
}
