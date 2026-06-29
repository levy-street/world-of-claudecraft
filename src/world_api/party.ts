import type {
  MasterLootSettings,
  MasterLootThreshold,
  PlayerClass,
  ResourceType,
} from '../sim/types';

export interface PartyMemberInfo {
  pid: number;
  name: string;
  cls: PlayerClass;
  level: number;
  hp: number;
  mhp: number;
  res: number;
  mres: number;
  rtype: ResourceType | null;
  x: number;
  z: number;
  dead: number;
  inCombat: number;
  group: 1 | 2;
}

export interface PartyInfo {
  leader: number;
  raid: boolean;
  master: MasterLootSettings;
  members: PartyMemberInfo[];
}

export interface IWorldParty {
  // social systems
  partyInfo: PartyInfo | null;
  partyInvite(targetPid: number): void;
  partyAccept(): void;
  partyDecline(): void;
  partyLeave(): void;
  partyKick(targetPid: number): void;
  convertPartyToRaid(): void;
  convertRaidToParty(): void;
  moveRaidMember(targetPid: number, group: 1 | 2): void;
  // master loot (leader-only setter; master looter assigns threshold drops)
  setPartyLootMaster(enabled: boolean, looter: number, threshold: MasterLootThreshold): void;
  // The master looter's checked subset: 1 pid grants directly, 2+ opens a roll.
  assignMasterLoot(rollId: number, targetPids: number[]): void;
  // raid/target markers (party-scoped): markerId 0..7, null = no mark
  markerFor(entityId: number): number | null;
  setMarker(entityId: number, markerId: number): void;
  clearMarker(entityId: number): void;
}
