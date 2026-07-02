import type { ResolvedAbility } from '../sim/sim';

export interface IWorldCombat {
  known: ResolvedAbility[];
  castAbility(abilityId: string): void;
  castAbilityBySlot(slot: number): void;
  // Ground-targeted cast: the ability is aimed at a world point (x, z) the player
  // chose, instead of the current entity target. Cast by ability id (like
  // castAbility) so the client never depends on server slot semantics. No-op for
  // an ability that is not `targetMode: 'position'`.
  castAbilityAt(abilityId: string, aim: { x: number; z: number }): void;
  // Voluntarily cancel one of the local player's own helpful auras (right-click a
  // buff). No-op if the id names a debuff or an aura the player does not carry.
  cancelAura(auraId: string): void;
  startAutoAttack(): void;
  stopAutoAttack(): void;
  releaseSpirit(): void;
}
