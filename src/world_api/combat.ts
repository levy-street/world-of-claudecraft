import type { ResolvedAbility } from '../sim/sim';
import type { WorldInteractionOutcome } from './interaction';

export interface ActiveFrostRing {
  id: string;
  x: number;
  z: number;
  radius: number;
  innerRadius: number;
  duration: number;
  remaining: number;
}

export interface ActiveTemporalHourglass {
  id: string;
  x: number;
  z: number;
  radius: number;
  duration: number;
  remaining: number;
}

export interface IWorldCombat {
  known: ResolvedAbility[];
  /** Server-authored persistent traps currently visible to this world view. */
  activeFrostRings: ActiveFrostRing[];
  activeTemporalHourglasses: ActiveTemporalHourglass[];
  castAbility(abilityId: string): void;
  castAbilityBySlot(slot: number): void;
  // Ground-targeted cast: the ability is aimed at a world point (x, z) the player
  // chose, instead of the current entity target. Cast by ability id (like
  // castAbility) so the client never depends on server slot semantics. No-op for
  // an ability that is not `targetMode: 'position'`.
  castAbilityAt(abilityId: string, aim: { x: number; z: number }): void;
  // Mouseover cast (Clique-style): cast a friendly ability on an explicit
  // target id (e.g. the hovered party frame) without touching the player's
  // persistent selection. A stale/invalid target falls back to the classic
  // current-friendly-target-else-self resolution in the sim.
  castAbilityOn(abilityId: string, targetId: number): void;
  /** Release the local player's active hold-to-charge spell. */
  releaseEmpoweredAbility(abilityId: string): void;
  // Voluntarily cancel one of the local player's own helpful auras (right-click a
  // buff). No-op if the id names a debuff or an aura the player does not carry.
  cancelAura(auraId: string): void;
  startAutoAttack(): void;
  stopAutoAttack(): void;
  // Death loop: releaseSpirit leaves the body and rises as a ghost at the nearest
  // graveyard; resurrectAtCorpse revives at the body (no penalty, must be in range);
  // resurrectAtSpiritHealer revives at the angel with Resurrection Sickness.
  releaseSpirit(): void;
  resurrectAtCorpse(): void;
  resurrectAtSpiritHealer(): WorldInteractionOutcome;
  /** Accept or decline the currently pending player-cast resurrection offer. */
  respondToResurrection(accept: boolean): void;
}
