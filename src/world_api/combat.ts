import type { ResolvedAbility } from '../sim/sim';

export interface IWorldCombat {
  known: ResolvedAbility[];
  castAbility(abilityId: string): void;
  castAbilityBySlot(slot: number): void;
  startAutoAttack(): void;
  stopAutoAttack(): void;
  releaseSpirit(): void;
}
