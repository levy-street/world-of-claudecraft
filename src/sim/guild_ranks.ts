// Guild ranks: the per-guild rank LADDER (named titles, each carrying a
// permission set) that generalizes the fixed Guild Master / Officer / Member
// tiers (docs/prd/guild-custom-ranks.md). Host-agnostic on purpose: the server
// authorizes every guild op through these predicates, the client derives the
// same answers for its buttons (UX only, the server re-checks), and the one
// sanitizer below is both the wire intake's validator and the persisted row's
// load path, so the three hosts can never disagree on what a rank may do.
//
// The ladder is ordered by seniority: index 0 is ALWAYS the Guild Master
// ('leader'), the last entry is ALWAYS the rank new members join at
// ('member'), and everything between is the guild's to name, reorder, and
// grant. A member's rank is a stable rank ID, never an index, so reordering
// or renaming a rank never rewrites a member row. An id the ladder does not
// know (a rank deleted under a racing promote, a row from a newer binary)
// resolves to the bottom rank everywhere: the fail-closed direction, since a
// shared treasury and a roster must never open to an unknown title.
//
// A guild that never touched its ranks stores NO ladder and resolves to
// defaultGuildRankLadder(), whose three ranks and permissions reproduce the
// pre-ladder rules exactly (officers invite, remove members, use the vault,
// officer chat, the billboard and the calendar; only the Guild Master changes
// ranks). Existing member rows ('leader' | 'officer' | 'member') are already
// valid rank ids, so the feature needs no data migration.

/** Every permission a rank can carry, in display order. The Guild Master holds
 *  all of them implicitly (never stored, never editable). Append-only: a new
 *  permission is a new row here plus its server gate and its UI column. */
export const GUILD_RANK_PERMISSIONS = [
  'invite',
  'remove',
  'promote',
  'bank',
  'officerChat',
  'motd',
  'events',
] as const;

export type GuildRankPermission = (typeof GUILD_RANK_PERMISSIONS)[number];

/** The two built-in rank ids every ladder carries at its ends. */
export const GUILD_RANK_LEADER_ID = 'leader';
export const GUILD_RANK_MEMBER_ID = 'member';
/** The default ladder's middle rank. Not structural: a guild may rename,
 *  regrant, or delete it like any custom rank. */
export const GUILD_RANK_OFFICER_ID = 'officer';

/** Ladder bounds: the Guild Master plus the joining rank at minimum, ten ranks
 *  at most (the classic guild-control ceiling). */
export const GUILD_RANK_MIN = 2;
export const GUILD_RANK_MAX = 10;
/** Longest custom title, in UTF-16 code units (the input's maxlength). */
export const GUILD_RANK_NAME_MAX = 20;

/** A rank id: 'leader', 'member', 'officer', or a custom 'r1'..'r99'. */
export type GuildRankId = string;

export interface GuildRankDef {
  id: GuildRankId;
  /** The guild's title for this rank; '' means the rank's default label (the
   *  client localizes: 'Guild Master' / 'Officer' / 'Member' / 'Rank N'). */
  name: string;
  /** Canonical order (GUILD_RANK_PERMISSIONS order), de-duplicated. */
  perms: GuildRankPermission[];
}

/** The pre-ladder Officer's powers: everything except changing ranks, which
 *  stays the Guild Master's until a guild grants 'promote'. */
export const DEFAULT_OFFICER_PERMISSIONS: readonly GuildRankPermission[] = [
  'invite',
  'remove',
  'bank',
  'officerChat',
  'motd',
  'events',
];

/** The ladder every guild resolves to until its Guild Master edits the ranks. */
export function defaultGuildRankLadder(): GuildRankDef[] {
  return [
    { id: GUILD_RANK_LEADER_ID, name: '', perms: [...GUILD_RANK_PERMISSIONS] },
    { id: GUILD_RANK_OFFICER_ID, name: '', perms: [...DEFAULT_OFFICER_PERMISSIONS] },
    { id: GUILD_RANK_MEMBER_ID, name: '', perms: [] },
  ];
}

const CUSTOM_RANK_ID_RE = /^r[1-9][0-9]?$/;
// Letters and digits in any script, joined by single spaces, apostrophes, or
// hyphens: a title reads like a title, and no markup or emoji can ride it.
const RANK_NAME_RE = /^[\p{L}\p{N}](?:[\p{L}\p{N}' -]*[\p{L}\p{N}])?$/u;

/** Whether an id may sit BETWEEN the ladder's two ends. */
function isMiddleRankId(id: string): boolean {
  return id === GUILD_RANK_OFFICER_ID || CUSTOM_RANK_ID_RE.test(id);
}

/** A title as the guild may store it: trimmed, inner whitespace collapsed,
 *  '' allowed (the default label). Null when it is too long or carries a
 *  character outside the title alphabet. */
export function sanitizeGuildRankName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const name = raw.trim().replace(/\s+/g, ' ');
  if (name === '') return '';
  if (name.length > GUILD_RANK_NAME_MAX) return null;
  return RANK_NAME_RE.test(name) ? name : null;
}

/** Known permissions only, de-duplicated, in canonical order. Unknown entries
 *  are dropped (fail closed: a permission this binary cannot gate is never
 *  granted). */
function sanitizePerms(raw: unknown): GuildRankPermission[] | null {
  if (!Array.isArray(raw)) return null;
  const held = new Set(raw.filter((p): p is string => typeof p === 'string'));
  return GUILD_RANK_PERMISSIONS.filter((p) => held.has(p));
}

/**
 * Validate a whole ladder, returning its canonical form or null. Strict about
 * STRUCTURE (the wire intake refuses a malformed ladder rather than repairing
 * it into something the Guild Master did not ask for): the size bounds, the
 * Guild Master first, the joining rank last, known and unique middle ids, and
 * a valid title on every rank. Lenient only where leniency fails closed: an
 * unknown permission is dropped, and the Guild Master's permissions are always
 * the full set whatever was sent.
 */
export function sanitizeGuildRankLadder(raw: unknown): GuildRankDef[] | null {
  if (!Array.isArray(raw)) return null;
  if (raw.length < GUILD_RANK_MIN || raw.length > GUILD_RANK_MAX) return null;
  const out: GuildRankDef[] = [];
  const seen = new Set<string>();
  const last = raw.length - 1;
  for (let i = 0; i < raw.length; i++) {
    const entry = raw[i] as { id?: unknown; name?: unknown; perms?: unknown } | null;
    if (!entry || typeof entry !== 'object' || typeof entry.id !== 'string') return null;
    const id = entry.id;
    if (seen.has(id)) return null;
    seen.add(id);
    const expected =
      i === 0
        ? id === GUILD_RANK_LEADER_ID
        : i === last
          ? id === GUILD_RANK_MEMBER_ID
          : isMiddleRankId(id);
    if (!expected) return null;
    const name = sanitizeGuildRankName(entry.name);
    if (name === null) return null;
    const perms = sanitizePerms(entry.perms);
    if (perms === null) return null;
    out.push({ id, name, perms: i === 0 ? [...GUILD_RANK_PERMISSIONS] : perms });
  }
  return out;
}

/** The load path for a persisted ladder: a stored value that does not
 *  validate (NULL for a guild that never edited its ranks, or a damaged row)
 *  resolves to the default ladder, never to an empty or half-parsed one. */
export function resolveGuildRankLadder(stored: unknown): GuildRankDef[] {
  return sanitizeGuildRankLadder(stored) ?? defaultGuildRankLadder();
}

/** A rank id's seniority index; an id the ladder does not know sits at the
 *  bottom (see the header: unknown resolves fail-closed to the joining rank). */
export function guildRankIndex(ladder: readonly GuildRankDef[], id: GuildRankId): number {
  const at = ladder.findIndex((r) => r.id === id);
  return at >= 0 ? at : ladder.length - 1;
}

/** The id a member row is treated as: itself when the ladder knows it, the
 *  joining rank otherwise. */
export function effectiveGuildRankId(
  ladder: readonly GuildRankDef[],
  id: GuildRankId,
): GuildRankId {
  return ladder[guildRankIndex(ladder, id)]?.id ?? GUILD_RANK_MEMBER_ID;
}

/** Whether a member of this rank may do `perm`. The Guild Master always may. */
export function guildRankCan(
  ladder: readonly GuildRankDef[],
  id: GuildRankId,
  perm: GuildRankPermission,
): boolean {
  const index = guildRankIndex(ladder, id);
  if (index === 0) return true;
  return ladder[index]?.perms.includes(perm) ?? false;
}

/** Whether rank `actor` sits strictly above rank `target`. Rank powers over
 *  another member (remove, promote, demote) only ever reach strictly lower
 *  ranks, which is what keeps an officer from removing another officer. */
export function guildRankOutranks(
  ladder: readonly GuildRankDef[],
  actor: GuildRankId,
  target: GuildRankId,
): boolean {
  return guildRankIndex(ladder, actor) < guildRankIndex(ladder, target);
}

/** Whether `actor` may remove a member of rank `target`. */
export function guildRankCanRemove(
  ladder: readonly GuildRankDef[],
  actor: GuildRankId,
  target: GuildRankId,
): boolean {
  return guildRankCan(ladder, actor, 'remove') && guildRankOutranks(ladder, actor, target);
}

/** The rank one step ABOVE `target` that `actor` may promote them to, or null.
 *  Promotion never reaches the Guild Master (that is a transfer) and never
 *  lifts anyone to the actor's own rank or above. */
export function guildRankPromoteTo(
  ladder: readonly GuildRankDef[],
  actor: GuildRankId,
  target: GuildRankId,
): GuildRankId | null {
  if (!guildRankCan(ladder, actor, 'promote')) return null;
  if (!guildRankOutranks(ladder, actor, target)) return null;
  const next = guildRankIndex(ladder, target) - 1;
  if (next < 1 || next <= guildRankIndex(ladder, actor)) return null;
  return ladder[next].id;
}

/** The rank one step BELOW `target` that `actor` may demote them to, or null
 *  (the target is already at the joining rank, or out of the actor's reach). */
export function guildRankDemoteTo(
  ladder: readonly GuildRankDef[],
  actor: GuildRankId,
  target: GuildRankId,
): GuildRankId | null {
  if (!guildRankCan(ladder, actor, 'promote')) return null;
  if (!guildRankOutranks(ladder, actor, target)) return null;
  const next = guildRankIndex(ladder, target) + 1;
  return next < ladder.length ? ladder[next].id : null;
}

/** The rank a former Guild Master steps down to on a leadership transfer: the
 *  most senior rank below the Guild Master (the default ladder's Officer). */
export function guildStepDownRankId(ladder: readonly GuildRankDef[]): GuildRankId {
  return ladder[1]?.id ?? GUILD_RANK_MEMBER_ID;
}

/** The built-in tier the live sim's guild bank stamp understands (src/sim/
 *  guild_bank.ts GUILD_RANKS, whose edit gate is a positive allowlist of
 *  leader and officer): the Guild Master stamps 'leader', a rank holding the
 *  'bank' permission stamps 'officer', every other rank stamps 'member' (the
 *  read-only vault view). The sim never learns rank names, only authority. */
export function guildBankStampRank(
  ladder: readonly GuildRankDef[],
  id: GuildRankId,
): 'leader' | 'officer' | 'member' {
  const index = guildRankIndex(ladder, id);
  if (index === 0) return 'leader';
  return ladder[index]?.perms.includes('bank') ? 'officer' : 'member';
}

/** The ids present in `before` but gone from `after`: the ranks a ladder save
 *  deletes, whose holders fall back to the joining rank in the same write. */
export function removedGuildRankIds(
  before: readonly GuildRankDef[],
  after: readonly GuildRankDef[],
): GuildRankId[] {
  const kept = new Set(after.map((r) => r.id));
  return before.filter((r) => !kept.has(r.id)).map((r) => r.id);
}

/** The lowest custom id the ladder does not use yet, for a new rank; null when
 *  the ladder is already at GUILD_RANK_MAX. */
export function nextCustomGuildRankId(ladder: readonly GuildRankDef[]): GuildRankId | null {
  if (ladder.length >= GUILD_RANK_MAX) return null;
  const used = new Set(ladder.map((r) => r.id));
  for (let n = 1; n <= 99; n++) {
    const id = `r${n}`;
    if (!used.has(id)) return id;
  }
  return null;
}
