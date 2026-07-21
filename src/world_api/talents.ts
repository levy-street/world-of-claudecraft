import type { Role, SavedLoadout, TalentAllocation, TalentRowLevel } from '../sim/content/talents';

export interface IWorldTalents {
  // Talents & Specializations. State is server-authoritative; the client stages
  // edits locally and commits via applyTalents (the server re-validates).
  talents: TalentAllocation;
  talentSpec: string | null;
  talentRole: Role | null;
  loadouts: SavedLoadout[];
  activeLoadout: number;
  talentPoints(): { total: number; spent: number };
  applyTalents(alloc: TalentAllocation): void;
  respec(): void;
  setSpec(specId: string | null): void;
  selectTalentRow(level: TalentRowLevel, optionId: string | null): void;
  saveLoadout(name: string, bar: (string | null)[], alloc?: TalentAllocation): void;
  switchLoadout(index: number): void;
  deleteLoadout(index: number): void;
}
