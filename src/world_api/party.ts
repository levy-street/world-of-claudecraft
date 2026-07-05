import type {
  AuraKind,
  MasterLootSettings,
  MasterLootThreshold,
  PlayerClass,
  ResourceType,
} from '../sim/types';

/** A compact aura summary for a party row's mini icon strip: the ability/aura id
 *  (drives the icon and the tooltip name), its kind (the fallback icon and the
 *  debuff classification), and neg=1 when the aura's value saps (a negative
 *  stat buff reads as a debuff). Capped at PARTY_MEMBER_AURA_CAP entries per
 *  member (sim/types.ts); deliberately NO remaining time, so the party payload
 *  only changes when the aura SET changes, never every tick of a countdown. */
export interface PartyMemberAura {
  id: string;
  kind: AuraKind;
  neg?: 1;
}

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
  /** Optional (an older server snapshot without it decodes as "no auras"). */
  auras?: PartyMemberAura[];
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
  // Leader-only handoff: pass leadership to another member (roster unchanged).
  partyPromote(targetPid: number): void;
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
