// Pure, host-agnostic core for the Social panel (#social-window): friends,
// guild, ignore, and raid tabs. It owns the two DOM-free decisions the panel
// makes: (1) the structural signature that tells the per-frame loop whether the
// panel must be fully rebuilt (tab / online / guild-membership / raid-roster
// change) versus refreshed in place, and (2) the per-tab row view models (which
// rows, each row's status-dot kind, link-vs-plain name, and which guild/raid
// action buttons are allowed). i18n + DOM live in social_window; this returns
// keyed (not localized) labels so the marking + permission rules are unit-tested
// in Node, mirroring the vendor/talents pure cores.
//
// DOM/Three-free and i18n-free (registered in tests/architecture.test.ts
// UI_PURE_CORES); world types are imported type-only from world_api so the same
// model is derived from a Sim and a ClientWorld mirror.

import type {
  FriendInfo,
  GuildMemberInfo,
  PartyInfo,
  PartyMemberInfo,
  SocialInfo,
} from '../world_api';

export type SocialTab = 'friends' | 'guild' | 'ignore' | 'raid';

/** Structural identity of the panel: which tab, online or not, and the guild
 *  membership/rank (which changes the footer) plus the raid roster shape.
 *  Content within a tab (a friend's zone, a member's hp) does NOT count, so it
 *  refreshes in place rather than triggering a full rebuild. */
export function socialStructSig(
  tab: SocialTab,
  social: SocialInfo | null,
  party: PartyInfo | null,
): string {
  const g = social?.guild ?? null;
  const raidSig = party
    ? `${party.raid ? 1 : 0}:${party.leader}:${party.members.map((m) => `${m.pid}.${m.group}`).join(',')}`
    : 'solo';
  return `${tab}|${social !== null}|${g?.id ?? 0}|${g?.rank ?? ''}|${raidSig}`;
}

/** The status dot kind for a presence row: 'off' when offline, otherwise the
 *  presence status ('online' when none is reported). */
export function socialDot(online: boolean, status: string | undefined): string {
  return online ? (status ?? 'online') : 'off';
}

export interface FriendRow {
  name: string;
  cls: string;
  level: number;
  online: boolean;
  /** Status dot kind: 'off' | 'online' | 'combat' | 'dungeon' | 'dead'. */
  dot: string;
  status: string | undefined;
  zone: string | undefined;
}

/** Friends-tab rows in source order. */
export function friendRows(social: SocialInfo | null): FriendRow[] {
  const friends = social?.friends ?? [];
  return friends.map((f: FriendInfo) => ({
    name: f.name,
    cls: f.cls,
    level: f.level,
    online: f.online,
    dot: socialDot(f.online, f.status),
    status: f.status,
    zone: f.zone,
  }));
}

export interface IgnoreRow {
  name: string;
}

/** Ignore-tab rows in source order. */
export function ignoreRows(social: SocialInfo | null): IgnoreRow[] {
  const blocks = social?.blocks ?? [];
  return blocks.map((b) => ({ name: b.name }));
}

export interface GuildRow {
  name: string;
  cls: string;
  level: number;
  online: boolean;
  dot: string;
  status: string | undefined;
  zone: string | undefined;
  /** This member's guild rank key ('leader' | 'officer' | 'member'). */
  rank: string;
  /** True when this row is the viewing player. */
  self: boolean;
  /** Whisper button is shown (online + not self). */
  canWhisper: boolean;
  /** Hand over leadership (viewer is leader, target is not self). */
  canTransfer: boolean;
  /** Promote member -> officer (viewer is leader, target a member). */
  canPromote: boolean;
  /** Demote officer -> member (viewer is leader, target an officer). */
  canDemote: boolean;
  /** Remove from guild: leaders may remove members + officers; officers may
   *  remove only members; never self or another leader. */
  canKick: boolean;
}

export interface GuildView {
  /** Null when the viewer has no guild (the tab shows the empty state). */
  guild: { name: string; rank: string; memberCount: number; rows: GuildRow[] } | null;
}

/** Guild-tab view: the header (name + viewer rank + count) and per-member rows
 *  with each action button's permission resolved against the viewer's rank. */
export function guildView(social: SocialInfo | null, myName: string): GuildView {
  const guild = social?.guild ?? null;
  if (!guild) return { guild: null };
  const me = guild.rank;
  const rows = guild.members.map((m: GuildMemberInfo) => {
    const self = m.name === myName;
    const canKick =
      !self &&
      ((me === 'leader' && m.rank !== 'leader') || (me === 'officer' && m.rank === 'member'));
    return {
      name: m.name,
      cls: m.cls,
      level: m.level,
      online: m.online,
      dot: socialDot(m.online, m.status),
      status: m.status,
      zone: m.zone,
      rank: m.rank,
      self,
      canWhisper: m.online && !self,
      canTransfer: !self && me === 'leader',
      canPromote: !self && me === 'leader' && m.rank === 'member',
      canDemote: !self && me === 'leader' && m.rank === 'officer',
      canKick,
    };
  });
  return { guild: { name: guild.name, rank: me, memberCount: guild.members.length, rows } };
}

export interface RaidMemberRow {
  pid: number;
  name: string;
  cls: PartyMemberInfo['cls'];
  level: number;
  /** Health percent, rounded, 0..100 (mhp floored to 1 to avoid divide-by-0). */
  hpPct: number;
  /** True when this member leads the raid. */
  isLead: boolean;
  /** Group to move this member to, or null when no move button is shown
   *  (viewer not leader, or the other group is full at 5). */
  moveTo: 1 | 2 | null;
}

export interface RaidGroupView {
  group: 1 | 2;
  count: number;
  members: RaidMemberRow[];
}

export interface RaidView {
  /** True when the party is a raid (the two-group layout is shown). */
  raid: boolean;
  /** When not a raid: whether the viewer (leader of a 5+ party) may convert. */
  canConvert: boolean;
  /** When a raid: whether the viewer (leader of a <=5 raid) may fold it back into
   *  a normal party. Raid groups cannot enter standard instances, so a small raid
   *  can un-convert; a larger one must shed members first. */
  canUnconvert: boolean;
  /** Present only when raid is true. */
  groups: [RaidGroupView, RaidGroupView] | null;
}

/** Raid-tab view: when not a raid, a flag for the convert action; when a raid,
 *  the two groups with each member's hp percent and move-target eligibility,
 *  plus whether the leader may un-convert a small raid. */
export function raidView(party: PartyInfo | null, myPid: number): RaidView {
  if (!party?.raid) {
    const canConvert = !!party && party.leader === myPid && party.members.length >= 5;
    return { raid: false, canConvert, canUnconvert: false, groups: null };
  }
  const leader = party.leader === myPid;
  const byGroup: Record<1 | 2, PartyMemberInfo[]> = {
    1: party.members.filter((m) => m.group === 1),
    2: party.members.filter((m) => m.group === 2),
  };
  const buildGroup = (group: 1 | 2): RaidGroupView => {
    const otherGroup: 1 | 2 = group === 1 ? 2 : 1;
    const otherFull = byGroup[otherGroup].length >= 5;
    const members = byGroup[group].map((m) => ({
      pid: m.pid,
      name: m.name,
      cls: m.cls,
      level: m.level,
      hpPct: Math.round((m.hp / Math.max(1, m.mhp)) * 100),
      isLead: m.pid === party.leader,
      moveTo: leader && !otherFull ? otherGroup : null,
    }));
    return { group, count: byGroup[group].length, members };
  };
  const canUnconvert = leader && party.members.length <= 5;
  return { raid: true, canConvert: false, canUnconvert, groups: [buildGroup(1), buildGroup(2)] };
}
