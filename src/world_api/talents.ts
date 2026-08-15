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
  /** `captureGear` stores the worn set on the loadout (src/sim/loadout_gear.ts).
   *  Opt-in and last, so an existing caller keeps its arity and its behavior. */
  saveLoadout(
    name: string,
    bar: (string | null)[],
    alloc?: TalentAllocation,
    captureGear?: boolean,
  ): void;
  switchLoadout(index: number): void;
  deleteLoadout(index: number): void;
}
