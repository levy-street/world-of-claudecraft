import type { PetMode } from '../sim/types';

export interface IWorldPet {
  readonly petSpecialCommandsSupported: boolean;
  abandonPet(): void;
  renamePet(name: string): void;
  revivePet(): void;
  petAttack(): void;
  petTaunt(): void;
  petWaterJet(): void;
  petSpecial(): void;
  setPetAutoTaunt(enabled: boolean): void;
  setPetAutoWaterJet(enabled: boolean): void;
  setPetAutoSpecial(enabled: boolean): void;
  feedPet(itemId: string, target?: { slotIndex: number }): void;
  healPet(): void;
  setPetMode(mode: PetMode): void;
}
