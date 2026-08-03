// Wire decode for the guild bank activity log's one-shot response frame
// (`{ t: 'gbanklog', ... }`), kept as its own DOM-free, world-free module so
// the frame contract is unit-testable without standing up a ClientWorld and so
// online.ts stays a consumer rather than growing another decode block.
//
// Defensive by construction, the online.ts decode idiom: every field is
// re-validated and a malformed row is DROPPED rather than rendered. That is
// not paranoia about our own server, it is what keeps a version-skewed or
// truncated frame from putting `undefined` into a sentence a player reads.
//
// The op vocabulary is a CLOSED allowlist here as well as server-side. The
// internal diagnostic ops (`escrow_deficit`, `counterparty_orphan`) are
// operator forensics that the read path never projects; re-stating the
// allowlist on this side means a server that ever regressed and sent one could
// still never render it as guild history.

import type { GuildBankLogEntry, GuildBankLogOp } from '../world_api';

/** The ops a client will render. Deliberately a second, independent statement
 *  of the server's projection allowlist (server/guild_bank_log.ts). */
const RENDERABLE_OPS: ReadonlySet<string> = new Set<GuildBankLogOp>([
  'deposit',
  'withdraw',
  'deposit_gold',
  'withdraw_gold',
  'buy_slots',
  'open_bank',
  'create_fee',
  'admin_purge',
]);

/**
 * How long an installed answer stays fresh, and equally how long a request that
 * never answered blocks a retry. Ten seconds is chosen against the SERVER cache
 * (server/guild_bank_log.ts), which busts on every book change: a client
 * watching the log while its guild works therefore sees a change within about
 * one TTL, while a whole guild of officers staring at an idle log costs at most
 * one cached read each per TTL and zero queries.
 */
export const GUILD_BANK_LOG_TTL_MS = 10_000;

/** Hard row bound: the server answers at most GUILD_BANK_LOG_LIMIT (50) rows,
 *  so anything past that is a defect or a hostile frame and is truncated
 *  rather than pasted into the DOM. */
export const GUILD_BANK_LOG_MAX_ROWS = 50;

/** The longest actor name that can reach a row. Character names are far
 *  shorter; this bounds the damage a malformed frame can do to one line of
 *  layout (the text itself is spliced into a TEXT sink, never HTML). */
const ACTOR_NAME_MAX = 64;

/** What the frame said. `refused` is the server declining the read (a member,
 *  a demotion mid-view, a guild that went away); it is NOT the same as an
 *  empty log and must never be rendered as one. Null means the frame was not a
 *  guild bank log frame at all, or was too malformed to interpret. */
export interface GuildBankLogFrame {
  refused: boolean;
  entries: GuildBankLogEntry[];
}

function decodeEntry(raw: unknown): GuildBankLogEntry | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const row = raw as Record<string, unknown>;
  if (!Number.isSafeInteger(row.id) || (row.id as number) <= 0) return null;
  if (!Number.isFinite(row.at)) return null;
  if (typeof row.op !== 'string' || !RENDERABLE_OPS.has(row.op)) return null;
  // The actor is player-authored text. It is carried verbatim (the painter
  // splices it into a text sink), so the only shaping here is the type and
  // length check: never a trim that would silently rename somebody, and never
  // an empty string, which would render as a nameless sentence.
  const actor =
    typeof row.actor === 'string' && row.actor.length > 0 && row.actor.length <= ACTOR_NAME_MAX
      ? row.actor
      : null;
  const itemId = typeof row.itemId === 'string' && row.itemId.length > 0 ? row.itemId : null;
  const count =
    Number.isSafeInteger(row.count) && (row.count as number) > 0 ? (row.count as number) : null;
  const copper =
    Number.isSafeInteger(row.copper) && (row.copper as number) > 0 ? (row.copper as number) : null;
  return {
    id: row.id as number,
    at: Math.floor(row.at as number),
    actor,
    op: row.op as GuildBankLogOp,
    itemId,
    count,
    copper,
  };
}

/**
 * Decode a `gbanklog` frame. Returns null when the message is not one, so the
 * caller can fall through to its other frame handlers. A frame carrying
 * `ok: false` is a REFUSAL and always decodes to zero entries, whatever the
 * payload claimed, so a refusal can never smuggle rows onto the pane.
 */
export function decodeGuildBankLogFrame(msg: unknown): GuildBankLogFrame | null {
  if (typeof msg !== 'object' || msg === null) return null;
  const frame = msg as Record<string, unknown>;
  if (frame.t !== 'gbanklog') return null;
  if (frame.ok !== true) return { refused: true, entries: [] };
  const rows = Array.isArray(frame.entries) ? frame.entries : [];
  const entries: GuildBankLogEntry[] = [];
  for (const raw of rows) {
    if (entries.length >= GUILD_BANK_LOG_MAX_ROWS) break;
    const entry = decodeEntry(raw);
    if (entry !== null) entries.push(entry);
  }
  return { refused: false, entries };
}
