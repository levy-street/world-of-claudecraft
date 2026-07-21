import type { PetMode } from '../sim/types';

export interface IWorldPet {
  abandonPet(): void;
  renamePet(name: string): void;
  revivePet(): void;
  petAttack(): void;
  petTaunt(): void;
  petWaterJet(): void;
  setPetAutoTaunt(enabled: boolean): void;
  setPetAutoWaterJet(enabled: boolean): void;
  feedPet(itemId: string): void;
  healPet(): void;
  setPetMode(mode: PetMode): void;
}
