import { pool } from './db';

export const REPORT_REASONS = [
  'harassment',
  'spam',
  'cheating',
  'offensive_name_or_chat',
  'other',
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];
export type ModerationAction = 'ignore' | 'kick' | 'kill' | 'suspend' | 'ban' | 'unban';

// The closed set of values ever written to account_moderation_actions.action. The
// column is free-text in SQL, so this const is the single source of truth: every
// audit-log INSERT routes through recordModerationAction below, whose `action`
// parameter is typed to this union, turning a mistyped action into a compile error
// rather than a silently-persisted row that renders as actionUnknown.
export const MODERATION_ACTIONS = [
  'kick',
  'kill',
  'suspend',
  'unsuspend',
  'ban',
  'unban',
  'chat_mute',
  'chat_unmute',
  'note',
  'force_rename',
  'reset_password',
] as const;
export type ModerationActionKind = (typeof MODERATION_ACTIONS)[number];

// A pg pool or a pinned pool client (both expose query); lets the audit-log INSERT
// run inside a caller's transaction or standalone.
type Queryable = Pick<typeof pool, 'query'>;

function recordModerationAction(
  db: Queryable,
  action: ModerationActionKind,
  params: {
    accountId: number;
    adminAccountId: number;
    reason: string;
    expiresAt?: Date | string | null;
  },
): Promise<unknown> {
  return db.query(
    `INSERT INTO account_moderation_actions (account_id, admin_account_id, action, reason, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [params.accountId, params.adminAccountId, action, params.reason, params.expiresAt ?? null],
  );
}

const REPORT_DETAILS_MAX = 1000;
const ACTION_REASON_MAX = 500;
// Free-form moderator notes carry more context than an action reason, so they get a
// roomier bound. Notes are recorded in the same audit log as sanctions.
const NOTE_MAX = 2000;
const DUPLICATE_REPORT_WINDOW_HOURS = 12;
const REGISTRATION_BURST_WINDOW_MINUTES = 10;
const REGISTRATION_PREFIX_THRESHOLD = 25;
const REGISTRATION_IP_THRESHOLD = 8;
const REGISTRATION_SUBNET_THRESHOLD = 20;
const REGISTRATION_USER_AGENT_THRESHOLD = 60;
const SYSTEM_REPORT_PREFIX = 'Automated registration pattern:';

export function cleanReportReason(value: unknown): ReportReason | null {
  return typeof value === 'string' && REPORT_REASONS.includes(value as ReportReason)
    ? (value as ReportReason)
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

function numericPrefix(username: string): string | null {
  const m = /^([a-z][a-z_]*?)[0-9]{2,}$/i.exec(username.trim());
  return m ? m[1].toLowerCase() : null;
}

function ipv4Subnet24(ip: string | null | undefined): string | null {
  const text = String(ip ?? '').trim();
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.\d{1,3}$/.exec(text);
  if (!m) return null;
  const octets = m.slice(1).map(Number);
  if (octets.some((n) => n < 0 || n > 255)) return null;
  return `${octets[0]}.${octets[1]}.${octets[2]}.`;
}

async function countRecentRegistrations(whereSql: string, params: unknown[]): Promise<number> {
  const res = await pool.query(
    `SELECT count(*)::int AS n
     FROM accounts
     WHERE created_at > now() - ($1 || ' minutes')::interval
       AND banned_at IS NULL
       AND ${whereSql}`,
    [String(REGISTRATION_BURST_WINDOW_MINUTES), ...params],
  );
  return Number(res.rows[0]?.n ?? 0);
}

export async function createSuspiciousRegistrationReport(input: {
  accountId: number;
  username: string;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<{ created: boolean; signals: string[] }> {
  const signals: string[] = [];
  const prefix = numericPrefix(input.username);
  const ip = cleanText(input.ip, 128);
  const userAgent = cleanText(input.userAgent, 512);
  const subnet24 = ipv4Subnet24(ip);

  const prefixCount = prefix
    ? await countRecentRegistrations(
        `lower(username) LIKE $2 || '%' AND lower(username) ~ ('^' || $2 || '[0-9]+$')`,
        [prefix],
      )
    : 0;
  if (prefix && prefixCount >= REGISTRATION_PREFIX_THRESHOLD) {
    signals.push(
      `${prefixCount} accounts with username prefix "${prefix}" in ${REGISTRATION_BURST_WINDOW_MINUTES} minutes`,
    );
  }

  const ipCount = ip ? await countRecentRegistrations('created_ip = $2', [ip]) : 0;
  if (ip && ipCount >= REGISTRATION_IP_THRESHOLD) {
    signals.push(
      `${ipCount} accounts from IP ${ip} in ${REGISTRATION_BURST_WINDOW_MINUTES} minutes`,
    );
  }

  const subnetCount = subnet24
    ? await countRecentRegistrations('created_ip LIKE $2', [`${subnet24}%`])
    : 0;
  if (subnet24 && subnetCount >= REGISTRATION_SUBNET_THRESHOLD) {
    signals.push(
      `${subnetCount} accounts from subnet ${subnet24}0/24 in ${REGISTRATION_BURST_WINDOW_MINUTES} minutes`,
    );
  }

  const userAgentCount = userAgent
    ? await countRecentRegistrations('created_user_agent = $2', [userAgent])
    : 0;
  if (userAgent && userAgentCount >= REGISTRATION_USER_AGENT_THRESHOLD) {
    signals.push(
      `${userAgentCount} accounts with the same user agent in ${REGISTRATION_BURST_WINDOW_MINUTES} minutes`,
    );
  }

  if (signals.length === 0) return { created: false, signals };

  const duplicate = await pool.query(
    `SELECT id FROM player_reports
     WHERE reporter_account_id IS NULL
       AND reported_account_id = $1
       AND status = 'open'
       AND details LIKE $2
     LIMIT 1`,
    [input.accountId, `${SYSTEM_REPORT_PREFIX}%`],
  );
  if (duplicate.rows[0]) return { created: false, signals };

  const details = cleanText(
    [
      `${SYSTEM_REPORT_PREFIX} ${signals.join('; ')}.`,
      `Username: ${input.username}`,
      ip ? `IP: ${ip}` : '',
      subnet24 ? `Subnet: ${subnet24}0/24` : '',
      userAgent ? `User-Agent: ${userAgent}` : '',
    ]
      .filter(Boolean)
      .join('\n'),
    REPORT_DETAILS_MAX,
  );

  await pool.query(
    `INSERT INTO player_reports (
       reporter_account_id, reporter_character_id, reporter_character_name,
       reported_account_id, reported_character_id, reported_character_name,
       reason, details
     ) VALUES (NULL, NULL, '', $1, NULL, '', $2, $3)`,
    [input.accountId, 'spam', details],
  );
  return { created: true, signals };
}

export interface ModerationQueueRow {
  accountId: number;
  username: string;
  isAdmin: boolean;
  status: 'active' | 'suspended' | 'banned';
  suspendedUntil: string | null;
  openReports: number;
  latestReportAt: string;
  latestReason: string;
  characterNames: string[];
  online: boolean;
}

export async function moderationQueue(
  onlineAccountIds: Set<number>,
): Promise<ModerationQueueRow[]> {
  const res = await pool.query(
    `SELECT
       a.id AS account_id,
       a.username,
       a.is_admin,
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
  return res.rows
    .map((r): ModerationQueueRow => {
      const suspendedUntil = r.suspended_until ? new Date(r.suspended_until).toISOString() : null;
      const activeSuspension =
        suspendedUntil !== null && new Date(suspendedUntil).getTime() > Date.now();
      const status: ModerationQueueRow['status'] = r.banned_at
        ? 'banned'
        : activeSuspension
          ? 'suspended'
          : 'active';
      return {
        accountId: r.account_id,
        username: r.username,
        isAdmin: r.is_admin,
        status,
        suspendedUntil,
        openReports: r.open_reports,
        latestReportAt: new Date(r.latest_report_at).toISOString(),
        latestReason: r.latest_reason,
        characterNames: r.character_names ?? [],
        online: onlineAccountIds.has(r.account_id),
      };
    })
    .sort(
      (a, b) =>
        b.openReports - a.openReports ||
        new Date(b.latestReportAt).getTime() - new Date(a.latestReportAt).getTime() ||
        Number(b.online) - Number(a.online),
    );
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
  chatContext: {
    id: number;
    characterName: string;
    channel: string;
    message: string;
    createdAt: string;
  }[];
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

export async function ignoreReport(
  reportId: number,
  adminAccountId: number,
  note: unknown,
): Promise<boolean> {
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
  action: 'suspend' | 'unsuspend' | 'ban' | 'unban';
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
    } else if (input.action === 'unsuspend') {
      const updated = await client.query(
        `UPDATE accounts
         SET suspended_until = NULL, moderation_reason = $2
         WHERE id = $1 AND suspended_until > now()`,
        [input.accountId, reason],
      );
      if ((updated.rowCount ?? 0) === 0) {
        throw new Error('account is not suspended');
      }
    } else {
      if (expiresAt === null) {
        throw new Error('suspension expiry must be in the future');
      }
      // Suspending supersedes any standing ban (an admin downgrading a ban to a
      // timed suspension). banned_at must be cleared here for the same reason
      // the ban branch clears suspended_until — moderationStatusForAccount reads
      // banned_at first, so a leftover ban would mask the suspension entirely
      // and leave the account locked out forever.
      await client.query(
        `UPDATE accounts
         SET banned_at = NULL, suspended_until = $2, moderation_reason = $3
         WHERE id = $1`,
        [input.accountId, expiresAt.toISOString(), reason],
      );
    }
    await recordModerationAction(client, input.action, {
      accountId: input.accountId,
      adminAccountId: input.adminAccountId,
      reason,
      expiresAt: expiresAt ? expiresAt.toISOString() : null,
    });
    if (input.action !== 'unsuspend') {
      await client.query(
        `UPDATE player_reports
         SET status = 'actioned', reviewed_at = now(), reviewed_by_account_id = $2, review_note = $3
         WHERE reported_account_id = $1 AND status = 'open'`,
        [input.accountId, input.adminAccountId, reason],
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function muteAccountChat(input: {
  accountId: number;
  adminAccountId: number;
  reason: unknown;
  expiresAt: unknown;
}): Promise<void> {
  const reason = cleanText(input.reason, ACTION_REASON_MAX);
  if (!reason) throw new Error('moderation reason is required');
  const expiresAt = new Date(String(input.expiresAt ?? ''));
  if (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) {
    throw new Error('chat mute expiry must be in the future');
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE accounts
       SET chat_muted_until = $2, chat_mute_reason = $3
       WHERE id = $1`,
      [input.accountId, expiresAt, reason],
    );
    await recordModerationAction(client, 'chat_mute', {
      accountId: input.accountId,
      adminAccountId: input.adminAccountId,
      reason,
      expiresAt,
    });
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function liftAccountChatMute(input: {
  accountId: number;
  adminAccountId: number;
  reason: unknown;
}): Promise<void> {
  const reason = cleanText(input.reason, ACTION_REASON_MAX);
  if (!reason) throw new Error('moderation reason is required');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const updated = await client.query(
      `UPDATE accounts
       SET chat_muted_until = NULL, chat_mute_reason = NULL
       WHERE id = $1 AND chat_muted_until > now()`,
      [input.accountId],
    );
    if ((updated.rowCount ?? 0) === 0) {
      throw new Error('account is not chat muted');
    }
    await recordModerationAction(client, 'chat_unmute', {
      accountId: input.accountId,
      adminAccountId: input.adminAccountId,
      reason,
    });
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// Append a free-form moderator note to an account's audit log. Purely additive: it
// changes no account state and resolves no reports (unlike moderateAccount), so a
// single INSERT is atomic on its own and needs no transaction.
export async function addAccountNote(input: {
  accountId: number;
  adminAccountId: number;
  note: unknown;
}): Promise<void> {
  const note = cleanText(input.note, NOTE_MAX);
  if (!note) throw new Error('a note is required');
  await recordModerationAction(pool, 'note', {
    accountId: input.accountId,
    adminAccountId: input.adminAccountId,
    reason: note,
  });
}

// Audit-only record for an in-game action whose live effect is owned by the
// GameServer. Unlike account sanctions, this changes no persistent account state.
export async function recordInGameAction(input: {
  action: 'kick' | 'kill';
  accountId: number;
  adminAccountId: number;
  reason: unknown;
}): Promise<void> {
  const reason = cleanText(input.reason, ACTION_REASON_MAX);
  if (!reason) throw new Error('moderation reason is required');
  await recordModerationAction(pool, input.action, {
    accountId: input.accountId,
    adminAccountId: input.adminAccountId,
    reason,
  });
}

// Audit-only record for an admin-initiated password reset. The credential write
// itself is owned by the caller (server/admin.ts via updatePasswordHash); like
// recordInGameAction this only appends the moderation-history row.
export async function recordPasswordReset(input: {
  accountId: number;
  adminAccountId: number;
  reason: unknown;
}): Promise<void> {
  const reason = cleanText(input.reason, ACTION_REASON_MAX);
  if (!reason) throw new Error('moderation reason is required');
  await recordModerationAction(pool, 'reset_password', {
    accountId: input.accountId,
    adminAccountId: input.adminAccountId,
    reason,
  });
}

export async function forceCharacterRename(input: {
  characterId: number;
  adminAccountId: number;
  reason: unknown;
}): Promise<{ accountId: number }> {
  const reason = cleanText(input.reason, ACTION_REASON_MAX);
  if (!reason) throw new Error('moderation reason is required');
  const character = await pool.query('SELECT account_id FROM characters WHERE id = $1', [
    input.characterId,
  ]);
  const accountId = character.rows[0]?.account_id;
  if (!accountId) throw new Error('character not found');
  // Pin a single pooled client so the whole transaction is atomic; see the note
  // in moderateAccount above.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('UPDATE characters SET force_rename = TRUE WHERE id = $1', [
      input.characterId,
    ]);
    await recordModerationAction(client, 'force_rename', {
      accountId,
      adminAccountId: input.adminAccountId,
      reason,
    });
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
