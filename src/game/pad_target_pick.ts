// Which entity a pad press acts on.
//
// A mouse player names the target with the cursor before they press anything. A
// pad player has no such gesture, so the press itself has to choose, and both
// choices are the same concern: which npc a talk press addresses, and which enemy
// a cast that needs one selects. The client carries the calls; the rules live here.
//
// World-touching, so it acts only through an injected `IWorld`-shaped handle
// (src/game/CLAUDE.md) and never imports `Sim`/`ClientWorld`.

import { resolveActionReplacement } from '../sim/combat/action_replacement';
import { ABILITIES } from '../sim/content/classes';
import { dist2d, type Entity, INTERACT_RANGE } from '../sim/types';
import type { IWorld } from '../world_api';
import { type AutoTargetAbility, nearestAutoTarget, shouldAutoTarget } from './auto_target';
import { CROSS_HOTBAR_ATTACK_ID, type CrossHotbarAction } from './cross_hotbar';
import { activePvpOpponentIds, isAttackableEntity } from './interactions';
import { nearbyNpcs } from './npc_cycle';

/** The slice of the world a pad press reads and selects through. */
export interface PadTargetPickWorld {
  player: IWorld['player'];
  playerId: IWorld['playerId'];
  entities: IWorld['entities'];
  known: IWorld['known'];
  duelInfo?: IWorld['duelInfo'];
  arenaInfo?: IWorld['arenaInfo'];
  targetEntity(id: number | null): void;
}

export interface PadTargetPickDeps {
  world: PadTargetPickWorld;
  /** The client's one interact path, told which npc the pad chose. */
  interactKey(preferNpcId: number | null): void;
}

export interface PadTargetPick {
  /**
   * The pad's talk press. Selects before it talks, so the target frame shows who
   * is being addressed and a press never answers a different npc from the one the
   * player stepped onto with the d-pad. Everything else about interacting (loot,
   * doors, nodes, fishing) is unchanged: this only decides WHICH npc.
   */
  interact(): void;
  /**
   * Choose an enemy for a pad press that needs one and has none. A mouse player
   * targets by clicking what they can see; a pad player has no such gesture, so
   * without this a new player who sees a wolf and presses the attack they know
   * gets an error instead of a fight.
   */
  autoTarget(action: NonNullable<CrossHotbarAction>): void;
}

// A cell stores the BASE ability id while an aura can transform what the button
// actually casts, so the press is judged on the resolved definition the cross
// hotbar already paints. The class-specific resolvers layered on top of this one
// (the hunter spec/talent passes) only retune cost and effects, never whether a
// hostile target is needed, so they are deliberately not repeated here.
function resolvedAbility(world: PadTargetPickWorld, id: string): AutoTargetAbility | undefined {
  const known = world.known.find((k) => k.def.id === id);
  return known ? resolveActionReplacement(known, world.player).def : ABILITIES[id];
}

export function createPadTargetPick(deps: PadTargetPickDeps): PadTargetPick {
  const { world, interactKey } = deps;
  return {
    interact(): void {
      const targeted = world.player.targetId ?? null;
      const current = targeted !== null ? world.entities.get(targeted) : undefined;
      const inReach = (e: Entity) => dist2d(world.player.pos, e.pos) <= INTERACT_RANGE;
      const prefer =
        current?.kind === 'npc' && inReach(current)
          ? targeted
          : (nearbyNpcs(world.entities.values(), world.player.pos, INTERACT_RANGE)[0]?.id ?? null);
      if (prefer !== null && prefer !== targeted) world.targetEntity(prefer);
      interactKey(prefer);
    },
    autoTarget(action): void {
      if (action.type !== 'ability') return;
      // Attack is not in ABILITIES (it is the fixed slot-0 toggle, not a spell), so
      // it would otherwise be the ONE press that skips this, and it is the press a
      // new player reaches for first. It plainly needs a hostile target: without one
      // the sim answers "Invalid attack target."
      const ability: AutoTargetAbility | undefined =
        action.id === CROSS_HOTBAR_ATTACK_ID
          ? { requiresTarget: true }
          : resolvedAbility(world, action.id);
      const current = world.player.targetId ?? null;
      const targeted = current !== null ? world.entities.get(current) : undefined;
      const activePvpOpponents = activePvpOpponentIds(world);
      const attackable = (e: Entity | undefined) =>
        isAttackableEntity(e, world.playerId, activePvpOpponents);
      // A damage press with an ally held takes the selection rather than refusing:
      // a pad has one target, and FFXIV's auto-target does exactly this. Re-select
      // the ally afterwards, the same as a mouse player would.
      if (!shouldAutoTarget(ability, !!targeted && attackable(targeted))) return;
      const picked = nearestAutoTarget(world.entities.values(), world.player.pos, (e) =>
        attackable(e as Entity),
      );
      if (picked !== null) world.targetEntity(picked);
    },
  };
}
