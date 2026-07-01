// Pure render-model core for the Loot Settings window. Maps the IWorld PartyInfo
// (leader flag + master-loot settings + member list) into a flat model both the
// editable (leader) and read-only (member) painters consume. DOM/i18n-free, so a
// Vitest drives it directly and it is identical for Sim and ClientWorld inputs.
import type { MasterLootThreshold } from '../sim/types';
import type { PartyInfo } from '../world_api';

export interface LootSettingsMemberOption {
  pid: number;
  name: string;
}

export interface LootSettingsModel {
  isLeader: boolean;
  enabled: boolean;
  threshold: MasterLootThreshold;
  looterPid: number; // raw setting; 0 = "the current leader"
  looterName: string; // resolved effective looter display name
  memberOptions: LootSettingsMemberOption[];
}

export function lootSettingsView(info: PartyInfo, selfPid: number): LootSettingsModel {
  const leaderName = info.members.find((m) => m.pid === info.leader)?.name ?? '';
  const resolvedPid = info.master.looter === 0 ? info.leader : info.master.looter;
  const looterName = info.members.find((m) => m.pid === resolvedPid)?.name ?? leaderName;
  return {
    isLeader: info.leader === selfPid,
    enabled: info.master.enabled,
    threshold: info.master.threshold,
    looterPid: info.master.looter,
    looterName,
    memberOptions: info.members.map((m) => ({ pid: m.pid, name: m.name })),
  };
}
