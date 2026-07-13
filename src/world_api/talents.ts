import type { RowPicks } from '../sim/content/talent_rows';
import type { Role, SavedLoadout, TalentAllocation } from '../sim/content/talents';

export interface IWorldTalents {
  // Talents & Specializations. State is server-authoritative; the client stages
  // edits locally and commits via applyTalents (the server re-validates).
  talents: TalentAllocation;
  talentSpec: string | null;
  talentRole: Role | null;
  loadouts: SavedLoadout[];
  activeLoadout: number;
  // Choice-row talents (the Pandaria-style row system, content/talent_rows.ts):
  // the picked option id per row (null = unpicked). Server-authoritative; a pick
  // is re-validated (level gate, row membership, out-of-combat lock).
  rowPicks: RowPicks;
  talentPoints(): { total: number; spent: number };
  applyTalents(alloc: TalentAllocation): void;
  respec(): void;
  setSpec(specId: string | null): void;
  pickRowTalent(rowIndex: number, optionId: string | null): void;
  saveLoadout(name: string, bar: (string | null)[], alloc?: TalentAllocation): void;
  switchLoadout(index: number): void;
  deleteLoadout(index: number): void;
}
