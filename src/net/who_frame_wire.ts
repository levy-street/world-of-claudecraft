// Wire decode for the Who tab's one-shot `who` frame (server/who_roster.ts
// whoFrame), following the online.ts decode idiom: DOM-free, ClientWorld-free,
// every field re-validated, and a malformed row DROPPED rather than rendered so
// a version-skewed or truncated frame never puts `undefined` into a row a
// player reads. The status vocabulary is restated here as a closed allowlist
// (an unknown status renders as plain 'online', never as raw server text).
import type { PresenceStatus, WhoRosterEntry, WhoRosterInfo } from '../world_api';

const STATUSES: ReadonlySet<string> = new Set<PresenceStatus>([
  'online',
  'combat',
  'dungeon',
  'dead',
  'afk',
]);

function decodeRow(raw: unknown): WhoRosterEntry | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.name !== 'string' || r.name === '') return null;
  if (typeof r.cls !== 'string') return null;
  if (typeof r.level !== 'number' || !Number.isFinite(r.level)) return null;
  const status = typeof r.status === 'string' && STATUSES.has(r.status) ? r.status : 'online';
  return {
    name: r.name,
    cls: r.cls,
    level: r.level,
    zone: typeof r.zone === 'string' ? r.zone : '',
    status: status as PresenceStatus,
    guild: typeof r.guild === 'string' ? r.guild : '',
  };
}

/** Decode a `who` frame; null when the frame carries no usable roster. */
export function whoRosterFromFrame(msg: unknown): WhoRosterInfo | null {
  if (typeof msg !== 'object' || msg === null) return null;
  const m = msg as Record<string, unknown>;
  if (!Array.isArray(m.rows)) return null;
  const rows: WhoRosterEntry[] = [];
  for (const raw of m.rows) {
    const row = decodeRow(raw);
    if (row) rows.push(row);
  }
  const total =
    typeof m.total === 'number' && Number.isFinite(m.total) && m.total >= rows.length
      ? Math.floor(m.total)
      : rows.length;
  const limit =
    typeof m.limit === 'number' && Number.isFinite(m.limit) && m.limit > 0
      ? Math.floor(m.limit)
      : rows.length;
  return { filter: typeof m.filter === 'string' ? m.filter : '', rows, total, limit };
}
