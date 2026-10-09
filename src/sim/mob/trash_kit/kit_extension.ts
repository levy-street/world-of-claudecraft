// A trash kit EXTENSION: a dungeon's own block of kit keys (the Drowned
// Temple's `trashKit.temple`, the Wildheart Basin's `trashKit.wildheart`)
// plugged into the shared driver (driver.ts) without growing it. An extension
// lends the driver its casts (a real bar each, run by the driver's own cast
// machinery: the pack stagger, the swing hold, the stun, silence and lockout
// breaks, and the area plant through cast_hold.ts isPlantedCast) and its
// per-tick upkeep (no-bar auras, links, drags), and cleans up when a pull
// ends.
//
// Determinism: the driver calls an extension at fixed points of a mob's tick,
// in roster order; an extension picks its targets by hash or by sorted reach,
// and draws rng only for a landing effect's damage rolls.

import type { InstanceSlot } from '../../sim';
import type { SimContext } from '../../sim_context';
import type { Entity, TrashKitCast, TrashKitDef, TrashKitState } from '../../types';

/** A cast's readiness: may it start now, and at whom. */
export interface KitCastPick {
  ok: boolean;
  target: Entity | null;
}

export interface TrashKitExtension {
  /** The cast keys this extension owns, in priority order. They run after
   *  the driver's own keys, so no existing cast's timing moves. */
  readonly castKeys: readonly string[];
  /** The authored cast record of `key` on this kit (undefined: absent). */
  castDef(kit: TrashKitDef, key: string): TrashKitCast | undefined;
  /** A physical cast: a silence never breaks it, no school lockout gates it. */
  isPhysical(key: string): boolean;
  /** May the cast start now? Its victim (or ally) when it has one. */
  ready(
    ctx: SimContext,
    inst: InstanceSlot,
    mob: Entity,
    kit: TrashKitDef,
    key: string,
    st: TrashKitState,
    players: readonly Entity[],
  ): KitCastPick;
  /** The bar just began (lock a lane's aim, mark a once-per-pull cast). */
  started?(
    ctx: SimContext,
    inst: InstanceSlot,
    mob: Entity,
    key: string,
    st: TrashKitState,
    target: Entity | null,
  ): void;
  /** While the bar runs: hold an aim the mob AI may have turned. True when it
   *  owns the facing this tick (the driver then leaves it alone). */
  hold?(mob: Entity, key: string, st: TrashKitState): boolean;
  /** The bar ran out: the cast lands. */
  land(
    ctx: SimContext,
    inst: InstanceSlot,
    mob: Entity,
    kit: TrashKitDef,
    key: string,
    targetId: number | null,
    players: readonly Entity[],
    st: TrashKitState,
  ): void;
  /** Per engaged tick, before any cast steps (auras kept up, drags, links).
   *  True ends the mob's tick (it left the world, or crumbled). */
  step?(
    ctx: SimContext,
    inst: InstanceSlot,
    mob: Entity,
    kit: TrashKitDef,
    st: TrashKitState,
    players: () => Entity[],
  ): boolean;
  /** Its bar broke before it landed (a kick, a stun, a silence, a lost
   *  sight): drop what the bar laid while it ran (a locked aim, a draw). */
  broken?(
    ctx: SimContext,
    mob: Entity,
    key: string,
    targetId: number | null,
    st: TrashKitState,
  ): void;
  /** The pull ended for this mob (death, evade, reset): lift what it left
   *  on others (a link, a mark, a ring). */
  endPull?(ctx: SimContext, inst: InstanceSlot, mob: Entity, st: TrashKitState): void;
}
