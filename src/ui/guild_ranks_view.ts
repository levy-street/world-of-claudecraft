// Pure, host-agnostic core for guild custom ranks in the Social window
// (docs/prd/guild-custom-ranks.md): the rank labels every guild surface shows,
// the viewer's permission answers (UX only: the server re-checks every op
// against the same src/sim/guild_ranks.ts rules), the Ranks tab's table model,
// and the ladder edits the tab's buttons make before they send.
//
// DOM/Three-free and i18n-free (registered in tests/architecture.test.ts
// UI_PURE_CORES): labels come back KEYED (a default rank key, a ladder
// position, or the guild's own title) and the painter localizes, so the
// marking and permission rules are unit-tested in Node against both a Sim and
// a ClientWorld mirror (an older server's frame carries no ladder and
// resolves to the default one).

import {
  GUILD_RANK_LEADER_ID,
  GUILD_RANK_MAX,
  GUILD_RANK_MEMBER_ID,
  GUILD_RANK_OFFICER_ID,
  GUILD_RANK_PERMISSIONS,
  type GuildRankDef,
  type GuildRankId,
  type GuildRankPermission,
  guildRankCan,
  guildRankIndex,
  nextCustomGuildRankId,
  resolveGuildRankLadder,
} from '../sim/guild_ranks';
import type { GuildInfo, SocialInfo } from '../world_api';

/** The guild's ladder as the client reads it (the default one for a frame
 *  that carries none). */
export function guildLadder(guild: Pick<GuildInfo, 'ranks'> | null | undefined): GuildRankDef[] {
  return resolveGuildRankLadder(guild?.ranks);
}

/** Whether the viewer's own rank grants `perm` (UX only). False guildless. */
export function viewerGuildCan(
  guild: Pick<GuildInfo, 'rank' | 'ranks'> | null | undefined,
  perm: GuildRankPermission,
): boolean {
  return !!guild && guildRankCan(guildLadder(guild), guild.rank, perm);
}

/** A rank's display label, keyed for the painter: a built-in rank left at its
 *  default title, an untitled custom rank by its ladder position ('Rank N',
 *  the Guild Master being 0), or the guild's own title verbatim. */
export type GuildRankLabel =
  | { kind: 'default'; rank: 'leader' | 'officer' | 'member' }
  | { kind: 'numbered'; n: number }
  | { kind: 'custom'; name: string };

export function guildRankLabel(ladder: readonly GuildRankDef[], id: GuildRankId): GuildRankLabel {
  const index = guildRankIndex(ladder, id);
  const rank = ladder[index];
  if (rank && rank.name !== '') return { kind: 'custom', name: rank.name };
  const rid = rank?.id ?? GUILD_RANK_MEMBER_ID;
  if (rid === GUILD_RANK_LEADER_ID || rid === GUILD_RANK_OFFICER_ID || rid === GUILD_RANK_MEMBER_ID)
    return { kind: 'default', rank: rid };
  return { kind: 'numbered', n: index };
}

/** One row of the Ranks tab table. */
export interface GuildRanksPanelRow {
  id: GuildRankId;
  /** Seniority position, 0 = the Guild Master. */
  index: number;
  label: GuildRankLabel;
  /** The stored title ('' = the default label, shown as the placeholder). */
  name: string;
  /** Held permissions in GUILD_RANK_PERMISSIONS order (all true for the GM). */
  perms: Record<GuildRankPermission, boolean>;
  /** The Guild Master row: every permission held and not editable. */
  locked: boolean;
  memberCount: number;
  /** Reorder / delete are middle-rank-only (the two ends are structural). */
  canMoveUp: boolean;
  canMoveDown: boolean;
  canRemove: boolean;
}

export interface GuildRanksPanelView {
  /** The viewer is the Guild Master (the only rank that edits the ladder). */
  editable: boolean;
  rows: GuildRanksPanelRow[];
  /** Another rank fits under GUILD_RANK_MAX (editable viewers only). */
  canAdd: boolean;
}

/** The Ranks tab: every member sees the ladder (what each title may do); the
 *  Guild Master edits it. Null for a guildless viewer (the tab is hidden). */
export function guildRanksPanelView(social: SocialInfo | null): GuildRanksPanelView | null {
  const guild = social?.guild ?? null;
  if (!guild) return null;
  const ladder = guildLadder(guild);
  const editable = guildRankIndex(ladder, guild.rank) === 0;
  const counts = new Map<GuildRankId, number>();
  for (const m of guild.members) {
    const id = ladder[guildRankIndex(ladder, m.rank)].id;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const last = ladder.length - 1;
  const rows = ladder.map((rank, index): GuildRanksPanelRow => {
    const middle = index > 0 && index < last;
    const perms = {} as Record<GuildRankPermission, boolean>;
    for (const p of GUILD_RANK_PERMISSIONS) perms[p] = index === 0 || rank.perms.includes(p);
    return {
      id: rank.id,
      index,
      label: guildRankLabel(ladder, rank.id),
      name: rank.name,
      perms,
      locked: index === 0,
      memberCount: counts.get(rank.id) ?? 0,
      canMoveUp: editable && middle && index > 1,
      canMoveDown: editable && middle && index < last - 1,
      canRemove: editable && middle,
    };
  });
  return { editable, rows, canAdd: editable && ladder.length < GUILD_RANK_MAX };
}

/** A new untitled custom rank, inserted just above the joining rank (the
 *  most junior middle position); null at GUILD_RANK_MAX. */
export function addGuildRank(ladder: readonly GuildRankDef[]): GuildRankDef[] | null {
  const id = nextCustomGuildRankId(ladder);
  if (id === null) return null;
  const next = ladder.map(cloneRank);
  next.splice(next.length - 1, 0, { id, name: '', perms: [] });
  return next;
}

/** The ladder without middle rank `id`; null for an end rank or unknown id. */
export function removeGuildRank(
  ladder: readonly GuildRankDef[],
  id: GuildRankId,
): GuildRankDef[] | null {
  const at = ladder.findIndex((r) => r.id === id);
  if (at <= 0 || at >= ladder.length - 1) return null;
  return ladder.filter((r) => r.id !== id).map(cloneRank);
}

/** Swap middle rank `id` one step more senior (-1) or junior (+1), staying
 *  between the two structural ends; null when it cannot move that way. */
export function moveGuildRank(
  ladder: readonly GuildRankDef[],
  id: GuildRankId,
  direction: -1 | 1,
): GuildRankDef[] | null {
  const at = ladder.findIndex((r) => r.id === id);
  const to = at + direction;
  if (at <= 0 || at >= ladder.length - 1) return null;
  if (to <= 0 || to >= ladder.length - 1) return null;
  const next = ladder.map(cloneRank);
  [next[at], next[to]] = [next[to], next[at]];
  return next;
}

function cloneRank(rank: GuildRankDef): GuildRankDef {
  return { id: rank.id, name: rank.name, perms: [...rank.perms] };
}
