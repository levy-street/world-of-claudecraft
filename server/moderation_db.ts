import { pool } from './db';

export const REPORT_REASONS = ['harassment', 'spam', 'cheating', 'offensive_name_or_chat', 'other'] as const;
export type ReportReason = typeof REPORT_REASONS[number];
export type ModerationAction = 'ignore' | 'suspend' | 'ban' | 'unban';

const REPORT_DETAILS_MAX = 1000;
const ACTION_REASON_MAX = 500;
const DUPLICATE_REPORT_WINDOW_HOURS = 12;

export function cleanReportReason(value: unknown): ReportReason | null {
  return typeof value === 'string' && REPORT_REASONS.includes(value as ReportReason)
    ? value as ReportReason
    : null;
}

export function cleanText(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

export interface LiveReportTarget {
  accountId: number;
  characterId: number;
  characterName: string;
}

export async function createPlayerReport(input: {
  reporterAccountId: number;
  reporterCharacterId: number;
  reporterCharacterName: string;
  target: LiveReportTarget;
  reason: ReportReason;
  details: unknown;
}): Promise<{ id: number }> {
  if (input.reporterAccountId === input.target.accountId) {
    throw new Error('cannot report yourself');
  }
  const details = cleanText(input.details, REPORT_DETAILS_MAX);
  const dup = await pool.query(
    `SELECT id FROM player_reports
     WHERE reporter_account_id = $1
       AND reported_account_id = $2
       AND status = 'open'
       AND created_at > now() - ($3 || ' hours')::interval
     LIMIT 1`,
    [input.reporterAccountId, input.target.accountId, String(DUPLICATE_REPORT_WINDOW_HOURS)],
  );
  if (dup.rows[0]) throw new Error('you have already reported this player recently');
  const res = await pool.query(
    `INSERT INTO player_reports (
       reporter_account_id, reporter_character_id, reporter_character_name,
       reported_account_id, reported_character_id, reported_character_name,
       reason, details
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING id`,
    [
      input.reporterAccountId,
      input.reporterCharacterId,
      input.reporterCharacterName,
      input.target.accountId,
      input.target.characterId,
      input.target.characterName,
      input.reason,
      details,
    ],
  );
  return { id: Number(res.rows[0].id) };
}

export interface ModerationQueueRow {
  accountId: number;
  username: string;
  status: 'active' | 'suspended' | 'banned';
  suspendedUntil: string | null;
  openReports: number;
  latestReportAt: string;
  latestReason: string;
  characterNames: string[];
  online: boolean;
}

export async function moderationQueue(onlineAccountIds: Set<number>): Promise<ModerationQueueRow[]> {
  const res = await pool.query(
    `SELECT
       a.id AS account_id,
       a.username,
       a.banned_at,
       a.suspended_until,
       count(r.id)::int AS open_reports,
       max(r.created_at) AS latest_report_at,
       (array_agg(r.reason ORDER BY r.created_at DESC))[1] AS latest_reason,
       array_remove(array_agg(DISTINCT r.reported_character_name), '') AS character_names
     FROM player_reports r
     JOIN accounts a ON a.id = r.reported_account_id
     WHERE r.status = 'open'
     GROUP BY a.id
     ORDER BY count(r.id) DESC, max(r.created_at) DESC`,
  );
  return res.rows.map((r): ModerationQueueRow => {
    const suspendedUntil = r.suspended_until ? new Date(r.suspended_until).toISOString() : null;
    const activeSuspension = suspendedUntil !== null && new Date(suspendedUntil).getTime() > Date.now();
    const status: ModerationQueueRow['status'] = r.banned_at ? 'banned' : activeSuspension ? 'suspended' : 'active';
    return {
      accountId: r.account_id,
      username: r.username,
      status,
      suspendedUntil,
      openReports: r.open_reports,
      latestReportAt: new Date(r.latest_report_at).toISOString(),
      latestReason: r.latest_reason,
      characterNames: r.character_names ?? [],
      online: onlineAccountIds.has(r.account_id),
    };
  }).sort((a, b) => (
    b.openReports - a.openReports
    || new Date(b.latestReportAt).getTime() - new Date(a.latestReportAt).getTime()
    || Number(b.online) - Number(a.online)
  ));
}

export interface ReportDetail {
  id: number;
  reason: string;
  details: string;
  status: string;
  createdAt: string;
  reporterAccountId: number | null;
  reporterUsername: string | null;
  reporterCharacterId: number | null;
  reporterCharacterName: string;
  reportedAccountId: number;
  reportedUsername: string;
  reportedCharacterId: number | null;
  reportedCharacterName: string;
  chatContext: { id: number; characterName: string; channel: string; message: string; createdAt: string }[];
}

export async function moderationReportsForAccount(accountId: number): Promise<ReportDetail[]> {
  const reports = await pool.query(
    `SELECT r.*, reporter.username AS reporter_username, reported.username AS reported_username
     FROM player_reports r
     LEFT JOIN accounts reporter ON reporter.id = r.reporter_account_id
     JOIN accounts reported ON reported.id = r.reported_account_id
     WHERE r.reported_account_id = $1 AND r.status = 'open'
     ORDER BY r.created_at DESC`,
    [accountId],
  );
  const out: ReportDetail[] = [];
  for (const r of reports.rows) {
    const chat = await pool.query(
      `SELECT id, character_name, channel, message, created_at
       FROM chat_logs
       WHERE character_id = $1 AND created_at <= $2
       ORDER BY created_at DESC
       LIMIT 50`,
      [r.reported_character_id, r.created_at],
    );
    out.push({
      id: Number(r.id),
      reason: r.reason,
      details: r.details,
      status: r.status,
      createdAt: new Date(r.created_at).toISOString(),
      reporterAccountId: r.reporter_account_id,
      reporterUsername: r.reporter_username,
      reporterCharacterId: r.reporter_character_id,
      reporterCharacterName: r.reporter_character_name,
      reportedAccountId: r.reported_account_id,
      reportedUsername: r.reported_username,
      reportedCharacterId: r.reported_character_id,
      reportedCharacterName: r.reported_character_name,
      chatContext: chat.rows.reverse().map((c) => ({
        id: Number(c.id),
        characterName: c.character_name,
        channel: c.channel,
        message: c.message,
        createdAt: new Date(c.created_at).toISOString(),
      })),
    });
  }
  return out;
}

export async function ignoreReport(reportId: number, adminAccountId: number, note: unknown): Promise<boolean> {
  const res = await pool.query(
    `UPDATE player_reports
     SET status = 'ignored', reviewed_at = now(), reviewed_by_account_id = $2, review_note = $3
     WHERE id = $1 AND status = 'open'`,
    [reportId, adminAccountId, cleanText(note, ACTION_REASON_MAX)],
  );
  return (res.rowCount ?? 0) > 0;
}

export async function moderateAccount(input: {
  accountId: number;
  adminAccountId: number;
  action: 'suspend' | 'ban' | 'unban';
  reason: unknown;
  expiresAt?: unknown;
}): Promise<void> {
  const reason = cleanText(input.reason, ACTION_REASON_MAX);
  if (!reason) throw new Error('moderation reason is required');
  let expiresAt: Date | null = null;
  if (input.action === 'suspend') {
    expiresAt = new Date(String(input.expiresAt ?? ''));
    if (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) {
      throw new Error('suspension expiry must be in the future');
    }
  }
  // Pin a single pooled client so BEGIN/…/COMMIT run on the same connection and
  // the moderation write is actually atomic. Issuing these through pool.query()
  // can spread them across different connections, leaving a partially-applied
  // action (e.g. account banned but audit row / report resolution missing).
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (input.action === 'ban') {
      await client.query(
        `UPDATE accounts
         SET banned_at = now(), suspended_until = NULL, moderation_reason = $2
         WHERE id = $1`,
        [input.accountId, reason],
      );
    } else if (input.action === 'unban') {
      await client.query(
        `UPDATE accounts
         SET banned_at = NULL, suspended_until = NULL, moderation_reason = $2
         WHERE id = $1`,
        [input.accountId, reason],
      );
    } else {
      // Suspending supersedes any standing ban (an admin downgrading a ban to a
      // timed suspension). banned_at must be cleared here for the same reason
      // the ban branch clears suspended_until — moderationStatusForAccount reads
      // banned_at first, so a leftover ban would mask the suspension entirely
      // and leave the account locked out forever.
      await client.query(
        `UPDATE accounts
         SET banned_at = NULL, suspended_until = $2, moderation_reason = $3
         WHERE id = $1`,
        [input.accountId, expiresAt!.toISOString(), reason],
      );
    }
    await client.query(
      `INSERT INTO account_moderation_actions (account_id, admin_account_id, action, reason, expires_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [input.accountId, input.adminAccountId, input.action, reason, expiresAt ? expiresAt.toISOString() : null],
    );
    await client.query(
      `UPDATE player_reports
       SET status = 'actioned', reviewed_at = now(), reviewed_by_account_id = $2, review_note = $3
       WHERE reported_account_id = $1 AND status = 'open'`,
      [input.accountId, input.adminAccountId, reason],
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function forceCharacterRename(input: {
  characterId: number;
  adminAccountId: number;
  reason: unknown;
}): Promise<{ accountId: number }> {
  const reason = cleanText(input.reason, ACTION_REASON_MAX);
  if (!reason) throw new Error('moderation reason is required');
  const character = await pool.query('SELECT account_id FROM characters WHERE id = $1', [input.characterId]);
  const accountId = character.rows[0]?.account_id;
  if (!accountId) throw new Error('character not found');
  // Pin a single pooled client so the whole transaction is atomic; see the note
  // in moderateAccount above.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('UPDATE characters SET force_rename = TRUE WHERE id = $1', [input.characterId]);
    await client.query(
      `INSERT INTO account_moderation_actions (account_id, admin_account_id, action, reason)
       VALUES ($1, $2, 'force_rename', $3)`,
      [accountId, input.adminAccountId, reason],
    );
    await client.query(
      `UPDATE player_reports
       SET status = 'actioned', reviewed_at = now(), reviewed_by_account_id = $2, review_note = $3
       WHERE reported_character_id = $1 AND status = 'open'`,
      [input.characterId, input.adminAccountId, reason],
    );
    await client.query('COMMIT');
    return { accountId };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
