import { createHmac } from 'node:crypto';
import { pool } from './db';
import { REALM } from './realm';

export const PLAYER_REPORT_REASONS = ['harassment', 'spam', 'cheating', 'botting', 'offensive_name_or_chat', 'other'] as const;
export const REPORT_REASONS = [...PLAYER_REPORT_REASONS, 'report_abuse'] as const;
export type PlayerReportReason = typeof PLAYER_REPORT_REASONS[number];
export type ReportReason = typeof REPORT_REASONS[number];
export type ModerationAction = 'ignore' | 'suspend' | 'ban';

const REPORT_DETAILS_MAX = 1000;
const ACTION_REASON_MAX = 500;
const DUPLICATE_REPORT_WINDOW_HOURS = 12;
const REPORT_HASH_SECRET_FALLBACK = 'world-of-claudecraft-dev-report-hash-secret';
const REPORT_SUBMISSION_LOCK_KEY = 0x57_4f_43_02; // "WOC\x02"

export const REPORT_RATE_LIMITS = {
  rapidSubmitSeconds: 5,
  reporterAcceptedPerHour: 5,
  reporterAcceptedPerDay: 20,
  ipAttemptsPerHour: 20,
} as const;

export const REPORT_ABUSE_SCORING = {
  threshold: 100,
  reporterSpamWindowMinutes: 10,
  reporterSpamAttempts: 6,
  reporterSpamDistinctTargets: 3,
  rejectedWindowMinutes: 30,
  rejectedAttempts: 4,
  sameTargetWindowMinutes: 10,
  sameTargetReports: 4,
  linkedReporterCount: 3,
  dedupeHours: 24,
  scores: {
    reporterSpam: 100,
    repeatedRejected: 100,
    sameTargetBurst: 40,
    sharedIpCoordination: 80,
    identicalDetailsCoordination: 80,
    solicitation: 20,
  },
} as const;

export function cleanReportReason(value: unknown): PlayerReportReason | null {
  return typeof value === 'string' && PLAYER_REPORT_REASONS.includes(value as PlayerReportReason)
    ? value as PlayerReportReason
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

export interface ReportRequestMetadata {
  ip?: string;
  userAgent?: string;
  realm?: string;
  targetMethod?: 'pid' | 'name' | 'unknown';
}

export type ReportAttemptOutcome =
  | 'accepted'
  | 'duplicate'
  | 'rate_limited'
  | 'invalid_target'
  | 'self_report'
  | 'rejected';

export interface ReportEventSummary {
  id: number;
  createdAt: string;
  outcome: string;
  reason: string;
  reporterAccountId: number | null;
  reporterCharacterName: string;
  targetAccountId: number | null;
  targetCharacterName: string;
  detailsHash: string;
  detailsLength: number;
  ipHash: string;
  userAgentHash: string;
  abuseScore: number;
  abuseReasons: string[];
  evidence: Record<string, unknown>;
}

interface Queryable {
  query(sql: string, params?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }>;
}

function hashSecret(): string {
  if (process.env.REPORT_HASH_SECRET) return process.env.REPORT_HASH_SECRET;
  return REPORT_HASH_SECRET_FALLBACK;
}

export function hashReportMetadata(value: unknown): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return '';
  const secret = hashSecret();
  return createHmac('sha256', secret || REPORT_HASH_SECRET_FALLBACK).update(text).digest('hex');
}

function reportAbuseBucket(now = Date.now()): string {
  const hours = REPORT_ABUSE_SCORING.dedupeHours;
  const ms = hours * 60 * 60 * 1000;
  return String(Math.floor(now / ms));
}

function reasonLabels(reasons: string[]): string[] {
  return [...new Set(reasons)].sort();
}

export async function createPlayerReport(input: {
  reporterAccountId: number;
  reporterCharacterId: number;
  reporterCharacterName: string;
  target: LiveReportTarget;
  reason: PlayerReportReason;
  details: unknown;
}): Promise<{ id: number }> {
  const result = await submitPlayerReportAttempt({
    ...input,
    metadata: {},
  });
  if (!result.ok) throw new Error(result.error);
  return { id: result.reportId };
}

export type SubmitReportResult =
  | { ok: true; reportId: number }
  | { ok: false; status: number; error: string; outcome: ReportAttemptOutcome };

export async function submitPlayerReportAttempt(input: {
  reporterAccountId: number;
  reporterCharacterId: number;
  reporterCharacterName: string;
  target: LiveReportTarget | null;
  reason: PlayerReportReason;
  details: unknown;
  metadata: ReportRequestMetadata;
  invalidTargetError?: string;
  invalidTargetStatus?: number;
}): Promise<SubmitReportResult> {
  const details = cleanText(input.details, REPORT_DETAILS_MAX);
  const realm = input.metadata.realm || REALM;
  const detailsHash = hashReportMetadata(details);
  const ipHash = hashReportMetadata(input.metadata.ip);
  const userAgentHash = hashReportMetadata(input.metadata.userAgent);
  const baseEvidence = {
    realm,
    targetMethod: input.metadata.targetMethod ?? 'unknown',
    reporterCharacterName: input.reporterCharacterName,
    targetCharacterName: input.target?.characterName ?? '',
    reason: input.reason,
    detailsHash,
    detailsLength: details.length,
    ipHashPresent: ipHash !== '',
    userAgentHashPresent: userAgentHash !== '',
  };

  if (!input.target) {
    const rejected = await recordRejectedReportAttempt(input, {
      realm,
      target: null,
      detailsHash,
      detailsLength: details.length,
      ipHash,
      userAgentHash,
      baseEvidence,
      rejectedOutcome: 'invalid_target',
      rejectedStatus: input.invalidTargetStatus ?? 400,
      rejectedError: input.invalidTargetError ?? 'invalid report target',
      rejectedEvidence: { error: input.invalidTargetError ?? 'invalid report target' },
    });
    await runReportAbuseDetection(rejected.eventId, realm, input.reporterAccountId, null);
    return rejected.result;
  }

  if (input.reporterAccountId === input.target.accountId) {
    const rejected = await recordRejectedReportAttempt(input, {
      realm,
      target: input.target,
      detailsHash,
      detailsLength: details.length,
      ipHash,
      userAgentHash,
      baseEvidence,
      rejectedOutcome: 'self_report',
      rejectedStatus: 400,
      rejectedError: 'cannot report yourself',
      rejectedEvidence: { targetAccountId: input.target.accountId },
    });
    await runReportAbuseDetection(rejected.eventId, realm, input.reporterAccountId, input.target.accountId);
    return rejected.result;
  }

  const client = await pool.connect();
  let result: SubmitReportResult;
  let detectionEventId: number | null = null;
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1, $2)', [REPORT_SUBMISSION_LOCK_KEY, input.reporterAccountId]);
    const duplicate = await client.query(
      `SELECT id FROM player_reports
       WHERE reporter_account_id = $1
         AND reported_account_id = $2
         AND status = 'open'
         AND source = 'player'
         AND report_kind = 'player_report'
         AND created_at > now() - ($3 || ' hours')::interval
       LIMIT 1`,
      [input.reporterAccountId, input.target.accountId, String(DUPLICATE_REPORT_WINDOW_HOURS)],
    );
    if (duplicate.rows[0]) {
      const rateLimit = await reportRateLimit(input.reporterAccountId, ipHash, realm, client);
      if (rateLimit.limited) {
        detectionEventId = await insertRateLimitedReportEvent(input, {
          realm,
          target: input.target,
          detailsHash,
          detailsLength: details.length,
          ipHash,
          userAgentHash,
          baseEvidence,
          rateLimit,
        }, client);
        result = { ok: false, status: 429, error: 'you are submitting reports too quickly', outcome: 'rate_limited' };
      } else {
        detectionEventId = await insertReportEvent({
          realm,
          reporterAccountId: input.reporterAccountId,
          reporterCharacterId: input.reporterCharacterId,
          reporterCharacterName: input.reporterCharacterName,
          target: input.target,
          reason: input.reason,
          detailsHash,
          detailsLength: details.length,
          outcome: 'duplicate',
          playerReportId: null,
          ipHash,
          userAgentHash,
          evidence: { ...baseEvidence, duplicateReportId: Number(duplicate.rows[0].id) },
        }, client);
        result = { ok: false, status: 400, error: 'you have already reported this player recently', outcome: 'duplicate' };
      }
      await client.query('COMMIT');
      await runReportAbuseDetection(detectionEventId, realm, input.reporterAccountId, input.target.accountId);
      return result;
    }

    const rateLimit = await reportRateLimit(input.reporterAccountId, ipHash, realm, client);
    if (rateLimit.limited) {
      detectionEventId = await insertReportEvent({
        realm,
        reporterAccountId: input.reporterAccountId,
        reporterCharacterId: input.reporterCharacterId,
        reporterCharacterName: input.reporterCharacterName,
        target: input.target,
        reason: input.reason,
        detailsHash,
        detailsLength: details.length,
        outcome: 'rate_limited',
        playerReportId: null,
        ipHash,
        userAgentHash,
        evidence: { ...baseEvidence, rateLimit },
      }, client);
      await client.query('COMMIT');
      await runReportAbuseDetection(detectionEventId, realm, input.reporterAccountId, input.target.accountId);
      return { ok: false, status: 429, error: 'you are submitting reports too quickly', outcome: 'rate_limited' };
    }

    const res = await client.query(
      `INSERT INTO player_reports (
         reporter_account_id, reporter_character_id, reporter_character_name,
         reported_account_id, reported_character_id, reported_character_name,
         reason, details, source, report_kind, realm, evidence
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'player','player_report',$9,$10::jsonb)
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
        realm,
        JSON.stringify({
          ...baseEvidence,
          targetAccountId: input.target.accountId,
          targetCharacterId: input.target.characterId,
        }),
      ],
    );
    const reportId = Number(res.rows[0].id);
    detectionEventId = await insertReportEvent({
      realm,
      reporterAccountId: input.reporterAccountId,
      reporterCharacterId: input.reporterCharacterId,
      reporterCharacterName: input.reporterCharacterName,
      target: input.target,
      reason: input.reason,
      detailsHash,
      detailsLength: details.length,
      outcome: 'accepted',
      playerReportId: reportId,
      ipHash,
      userAgentHash,
      evidence: {
        ...baseEvidence,
        playerReportId: reportId,
        targetAccountId: input.target.accountId,
        targetCharacterId: input.target.characterId,
      },
    }, client);
    await client.query('COMMIT');
    await runReportAbuseDetection(detectionEventId, realm, input.reporterAccountId, input.target.accountId);
    return { ok: true, reportId };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function insertRateLimitedReportEvent(input: {
  reporterAccountId: number;
  reporterCharacterId: number;
  reporterCharacterName: string;
  reason: PlayerReportReason;
}, event: {
  realm: string;
  target: LiveReportTarget | null;
  detailsHash: string;
  detailsLength: number;
  ipHash: string;
  userAgentHash: string;
  baseEvidence: Record<string, unknown>;
  rateLimit: Record<string, unknown>;
}, db: Queryable = pool): Promise<number> {
  return insertReportEvent({
    realm: event.realm,
    reporterAccountId: input.reporterAccountId,
    reporterCharacterId: input.reporterCharacterId,
    reporterCharacterName: input.reporterCharacterName,
    target: event.target,
    reason: input.reason,
    detailsHash: event.detailsHash,
    detailsLength: event.detailsLength,
    outcome: 'rate_limited',
    playerReportId: null,
    ipHash: event.ipHash,
    userAgentHash: event.userAgentHash,
    evidence: { ...event.baseEvidence, rateLimit: event.rateLimit },
  }, db);
}

async function recordRejectedReportAttempt(input: {
  reporterAccountId: number;
  reporterCharacterId: number;
  reporterCharacterName: string;
  reason: PlayerReportReason;
}, event: {
  realm: string;
  target: LiveReportTarget | null;
  detailsHash: string;
  detailsLength: number;
  ipHash: string;
  userAgentHash: string;
  baseEvidence: Record<string, unknown>;
  rejectedOutcome: Exclude<ReportAttemptOutcome, 'accepted' | 'rate_limited'>;
  rejectedStatus: number;
  rejectedError: string;
  rejectedEvidence: Record<string, unknown>;
}): Promise<{ eventId: number; result: SubmitReportResult }> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1, $2)', [REPORT_SUBMISSION_LOCK_KEY, input.reporterAccountId]);
    const rateLimit = await reportRateLimit(input.reporterAccountId, event.ipHash, event.realm, client);
    let eventId: number;
    let result: SubmitReportResult;
    if (rateLimit.limited) {
      eventId = await insertRateLimitedReportEvent(input, {
        realm: event.realm,
        target: event.target,
        detailsHash: event.detailsHash,
        detailsLength: event.detailsLength,
        ipHash: event.ipHash,
        userAgentHash: event.userAgentHash,
        baseEvidence: event.baseEvidence,
        rateLimit,
      }, client);
      result = { ok: false, status: 429, error: 'you are submitting reports too quickly', outcome: 'rate_limited' };
    } else {
      eventId = await insertReportEvent({
        realm: event.realm,
        reporterAccountId: input.reporterAccountId,
        reporterCharacterId: input.reporterCharacterId,
        reporterCharacterName: input.reporterCharacterName,
        target: event.target,
        reason: input.reason,
        detailsHash: event.detailsHash,
        detailsLength: event.detailsLength,
        outcome: event.rejectedOutcome,
        playerReportId: null,
        ipHash: event.ipHash,
        userAgentHash: event.userAgentHash,
        evidence: { ...event.baseEvidence, ...event.rejectedEvidence },
      }, client);
      result = { ok: false, status: event.rejectedStatus, error: event.rejectedError, outcome: event.rejectedOutcome };
    }
    await client.query('COMMIT');
    return { eventId, result };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function reportRateLimit(reporterAccountId: number, ipHash: string, realm: string, db: Queryable = pool): Promise<{
  limited: boolean;
  reason: string;
  rapidAttempts: number;
  reporterAcceptedHour: number;
  reporterAcceptedDay: number;
  ipAttemptsHour: number;
}> {
  const [rapid, reporterHour, reporterDay, ipHour] = await Promise.all([
    db.query(
      `SELECT count(*)::int AS count FROM report_events
       WHERE realm = $1 AND reporter_account_id = $2 AND created_at > now() - ($3 || ' seconds')::interval`,
      [realm, reporterAccountId, String(REPORT_RATE_LIMITS.rapidSubmitSeconds)],
    ),
    db.query(
      `SELECT count(*)::int AS count FROM report_events
       WHERE realm = $1 AND reporter_account_id = $2 AND outcome = 'accepted' AND created_at > now() - interval '1 hour'`,
      [realm, reporterAccountId],
    ),
    db.query(
      `SELECT count(*)::int AS count FROM report_events
       WHERE realm = $1 AND reporter_account_id = $2 AND outcome = 'accepted' AND created_at > now() - interval '1 day'`,
      [realm, reporterAccountId],
    ),
    ipHash
      ? db.query(
          `SELECT count(*)::int AS count FROM report_events
           WHERE realm = $1 AND ip_hash = $2 AND created_at > now() - interval '1 hour'`,
          [realm, ipHash],
        )
      : Promise.resolve({ rows: [{ count: 0 }] } as any),
  ]);
  const rapidAttempts = Number(rapid.rows[0]?.count ?? 0);
  const reporterAcceptedHour = Number(reporterHour.rows[0]?.count ?? 0);
  const reporterAcceptedDay = Number(reporterDay.rows[0]?.count ?? 0);
  const ipAttemptsHour = Number(ipHour.rows[0]?.count ?? 0);
  const reason =
    rapidAttempts > 0 ? 'rapid_submit'
    : reporterAcceptedHour >= REPORT_RATE_LIMITS.reporterAcceptedPerHour ? 'reporter_hour'
    : reporterAcceptedDay >= REPORT_RATE_LIMITS.reporterAcceptedPerDay ? 'reporter_day'
    : ipAttemptsHour >= REPORT_RATE_LIMITS.ipAttemptsPerHour ? 'ip_hour'
    : '';
  return { limited: reason !== '', reason, rapidAttempts, reporterAcceptedHour, reporterAcceptedDay, ipAttemptsHour };
}

async function insertReportEvent(input: {
  realm: string;
  reporterAccountId: number;
  reporterCharacterId: number;
  reporterCharacterName: string;
  target: LiveReportTarget | null;
  reason: PlayerReportReason;
  detailsHash: string;
  detailsLength: number;
  outcome: ReportAttemptOutcome;
  playerReportId: number | null;
  ipHash: string;
  userAgentHash: string;
  evidence: Record<string, unknown>;
}, db: Queryable = pool): Promise<number> {
  const res = await db.query(
    `INSERT INTO report_events (
       realm,
       reporter_account_id, reporter_character_id, reporter_character_name,
       target_account_id, target_character_id, target_character_name,
       reason, details_hash, details_length, outcome, player_report_id,
       ip_hash, user_agent_hash, evidence
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb)
     RETURNING id`,
    [
      input.realm,
      input.reporterAccountId,
      input.reporterCharacterId,
      input.reporterCharacterName,
      input.target?.accountId ?? null,
      input.target?.characterId ?? null,
      input.target?.characterName ?? '',
      input.reason,
      input.detailsHash,
      input.detailsLength,
      input.outcome,
      input.playerReportId,
      input.ipHash,
      input.userAgentHash,
      JSON.stringify(input.evidence),
    ],
  );
  return Number(res.rows[0].id);
}

async function runReportAbuseDetection(
  eventId: number,
  realm: string,
  reporterAccountId: number,
  targetAccountId: number | null,
): Promise<void> {
  try {
    await detectReportAbuseForEvent(eventId, realm, reporterAccountId, targetAccountId);
  } catch (err) {
    console.error('report abuse detection failed:', err);
  }
}

async function detectReportAbuseForEvent(
  eventId: number,
  realm: string,
  reporterAccountId: number,
  targetAccountId: number | null,
): Promise<void> {
  const reasons: string[] = [];
  let score = 0;
  let individualScore = 0;
  const eventIds = new Set<number>([eventId]);
  const evidence: Record<string, unknown> = { triggerEventId: eventId, realm };

  const reporterStats = await pool.query(
    `SELECT
       count(*)::int AS attempts,
       count(DISTINCT target_account_id)::int AS distinct_targets,
       array_agg(id ORDER BY created_at DESC) AS event_ids
     FROM report_events
     WHERE realm = $1
       AND reporter_account_id = $2
       AND created_at > now() - ($3 || ' minutes')::interval`,
    [realm, reporterAccountId, String(REPORT_ABUSE_SCORING.reporterSpamWindowMinutes)],
  );
  const reporterRow = reporterStats.rows[0] ?? {};
  const reporterAttempts = Number(reporterRow.attempts ?? 0);
  const distinctTargets = Number(reporterRow.distinct_targets ?? 0);
  if (
    reporterAttempts >= REPORT_ABUSE_SCORING.reporterSpamAttempts
    && distinctTargets >= REPORT_ABUSE_SCORING.reporterSpamDistinctTargets
  ) {
    reasons.push('reporter_spam');
    score += REPORT_ABUSE_SCORING.scores.reporterSpam;
    individualScore += REPORT_ABUSE_SCORING.scores.reporterSpam;
    evidence.reporterSpam = {
      attempts: reporterAttempts,
      distinctTargets,
      windowMinutes: REPORT_ABUSE_SCORING.reporterSpamWindowMinutes,
    };
    for (const id of reporterRow.event_ids ?? []) eventIds.add(Number(id));
  }

  const rejectedStats = await pool.query(
    `SELECT count(*)::int AS attempts, array_agg(id ORDER BY created_at DESC) AS event_ids
     FROM report_events
     WHERE realm = $1
       AND reporter_account_id = $2
       AND outcome IN ('duplicate', 'invalid_target', 'self_report', 'rate_limited', 'rejected')
       AND created_at > now() - ($3 || ' minutes')::interval`,
    [realm, reporterAccountId, String(REPORT_ABUSE_SCORING.rejectedWindowMinutes)],
  );
  const rejectedRow = rejectedStats.rows[0] ?? {};
  const rejectedAttempts = Number(rejectedRow.attempts ?? 0);
  if (rejectedAttempts >= REPORT_ABUSE_SCORING.rejectedAttempts) {
    reasons.push('repeated_rejected_reports');
    score += REPORT_ABUSE_SCORING.scores.repeatedRejected;
    individualScore += REPORT_ABUSE_SCORING.scores.repeatedRejected;
    evidence.rejectedReports = {
      attempts: rejectedAttempts,
      windowMinutes: REPORT_ABUSE_SCORING.rejectedWindowMinutes,
    };
    for (const id of rejectedRow.event_ids ?? []) eventIds.add(Number(id));
  }

  const solicitation = await pool.query(
    `SELECT cl.id, cl.created_at
     FROM chat_logs cl
     JOIN characters c ON c.id = cl.character_id
     WHERE cl.account_id = $1
       AND cl.created_at > now() - ($2 || ' minutes')::interval
       AND cl.message ~* $3
       AND c.realm = $4
     ORDER BY cl.created_at DESC
     LIMIT 5`,
    [
      reporterAccountId,
      String(REPORT_ABUSE_SCORING.sameTargetWindowMinutes),
      '\\m(everyone|mass|all)\\M.{0,32}\\mreport\\M|\\mreport\\M.{1,32}\\m(now|them|him|her|everyone)\\M',
      realm,
    ],
  );
  let solicitationApplied = false;
  const applySolicitationEvidence = () => {
    if (solicitationApplied || score <= 0 || solicitation.rows.length === 0) return;
    solicitationApplied = true;
    reasons.push('recent_report_solicitation');
    score += REPORT_ABUSE_SCORING.scores.solicitation;
    individualScore += individualScore > 0 ? REPORT_ABUSE_SCORING.scores.solicitation : 0;
    evidence.recentReportSolicitation = {
      chatLogIds: solicitation.rows.map((row) => Number(row.id)),
      windowMinutes: REPORT_ABUSE_SCORING.sameTargetWindowMinutes,
    };
  };

  if (targetAccountId !== null) {
    const burstRows = await pool.query(
      `SELECT id, reporter_account_id, reporter_character_id, reporter_character_name,
              target_account_id, target_character_name, ip_hash, details_hash, outcome
       FROM report_events
       WHERE realm = $1
         AND target_account_id = $2
         AND created_at > now() - ($3 || ' minutes')::interval
       ORDER BY created_at DESC`,
      [realm, targetAccountId, String(REPORT_ABUSE_SCORING.sameTargetWindowMinutes)],
    );
    const rows = burstRows.rows;
    if (rows.length >= REPORT_ABUSE_SCORING.sameTargetReports) {
      reasons.push('same_target_burst');
      score += REPORT_ABUSE_SCORING.scores.sameTargetBurst;
      const coordinationReasons = ['same_target_burst'];
      let coordinationScore = REPORT_ABUSE_SCORING.scores.sameTargetBurst;
      evidence.sameTargetBurst = {
        targetAccountId,
        reports: rows.length,
        windowMinutes: REPORT_ABUSE_SCORING.sameTargetWindowMinutes,
      };
      for (const row of rows) eventIds.add(Number(row.id));

      const linkedByIp = linkedReporters(rows, 'ip_hash');
      const linkedByDetails = linkedReporters(rows, 'details_hash');
      const linked = new Map<number, any>();
      if (linkedByIp.length >= REPORT_ABUSE_SCORING.linkedReporterCount) {
        reasons.push('shared_ip_coordination');
        score += REPORT_ABUSE_SCORING.scores.sharedIpCoordination;
        coordinationReasons.push('shared_ip_coordination');
        coordinationScore += REPORT_ABUSE_SCORING.scores.sharedIpCoordination;
        evidence.sharedIpReporterCount = linkedByIp.length;
        for (const row of linkedByIp) linked.set(Number(row.reporter_account_id), row);
      }
      if (linkedByDetails.length >= REPORT_ABUSE_SCORING.linkedReporterCount) {
        reasons.push('identical_details_coordination');
        score += REPORT_ABUSE_SCORING.scores.identicalDetailsCoordination;
        coordinationReasons.push('identical_details_coordination');
        coordinationScore += REPORT_ABUSE_SCORING.scores.identicalDetailsCoordination;
        evidence.identicalDetailsReporterCount = linkedByDetails.length;
        for (const row of linkedByDetails) linked.set(Number(row.reporter_account_id), row);
      }
      if (linked.size > 0) {
        applySolicitationEvidence();
        if (evidence.recentReportSolicitation) {
          coordinationReasons.push('recent_report_solicitation');
          coordinationScore += REPORT_ABUSE_SCORING.scores.solicitation;
        }
        evidence.linkedReporterAccountIds = [...linked.keys()].sort((a, b) => a - b);
        for (const row of linked.values()) {
          await createReportAbuseCase({
            realm,
            reportedAccountId: Number(row.reporter_account_id),
            reportedCharacterId: row.reporter_character_id === null ? null : Number(row.reporter_character_id),
            reportedCharacterName: row.reporter_character_name ?? '',
            score: coordinationScore,
            reasons: reasonLabels(coordinationReasons),
            signalFamily: 'coordination',
            eventIds: [...eventIds],
            evidence: {
              triggerEventId: eventId,
              realm,
              sameTargetBurst: evidence.sameTargetBurst,
              sharedIpReporterCount: evidence.sharedIpReporterCount,
              identicalDetailsReporterCount: evidence.identicalDetailsReporterCount,
              linkedReporterAccountIds: evidence.linkedReporterAccountIds,
              recentReportSolicitation: evidence.recentReportSolicitation,
              summary: 'Linked reporters submitted a same-target burst with shared report-abuse signals.',
              originalTargetAccountId: targetAccountId,
            },
          });
        }
      }
    }
  }

  applySolicitationEvidence();

  const finalReasons = reasonLabels(reasons);
  if (finalReasons.length > 0) {
    await pool.query(
      `UPDATE report_events SET abuse_score = $2, abuse_reasons = $3 WHERE id = $1`,
      [eventId, score, finalReasons],
    );
  }
  if (individualScore >= REPORT_ABUSE_SCORING.threshold) {
    await createReportAbuseCase({
      realm,
      reportedAccountId: reporterAccountId,
      reportedCharacterId: null,
      reportedCharacterName: '',
      score: individualScore,
      reasons: finalReasons,
      signalFamily: finalReasons.includes('reporter_spam') ? 'reporter_spam' : 'repeated_rejected',
      eventIds: [...eventIds],
      evidence: {
        ...evidence,
        summary: 'Reporter crossed deterministic report-abuse thresholds.',
      },
    });
  }
}

function linkedReporters(rows: any[], field: 'ip_hash' | 'details_hash'): any[] {
  const groups = new Map<string, any[]>();
  for (const row of rows) {
    const reporterAccountId = Number(row.reporter_account_id);
    if (!Number.isFinite(reporterAccountId) || reporterAccountId <= 0) continue;
    const key = String(row[field] ?? '');
    if (!key) continue;
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  let best: any[] = [];
  for (const group of groups.values()) {
    const unique = new Map<number, any>();
    for (const row of group) unique.set(Number(row.reporter_account_id), row);
    if (unique.size > best.length) best = [...unique.values()];
  }
  return best;
}

async function createReportAbuseCase(input: {
  realm: string;
  reportedAccountId: number;
  reportedCharacterId: number | null;
  reportedCharacterName: string;
  score: number;
  reasons: string[];
  signalFamily: string;
  eventIds: number[];
  evidence: Record<string, unknown>;
}): Promise<void> {
  const dedupeKey = `report_abuse:${input.realm}:${input.reportedAccountId}:${reportAbuseBucket()}:${input.signalFamily}`;
  await pool.query(
    `INSERT INTO player_reports (
       reporter_account_id, reporter_character_id, reporter_character_name,
       reported_account_id, reported_character_id, reported_character_name,
       reason, details, source, report_kind, realm, evidence, abuse_score, abuse_reasons, dedupe_key
     ) VALUES (
       NULL, NULL, 'System',
       $1, $2, $3,
       'report_abuse', $4, 'system', 'report_abuse', $5, $6::jsonb, $7, $8, $9
     )
     ON CONFLICT DO NOTHING`,
    [
      input.reportedAccountId,
      input.reportedCharacterId,
      input.reportedCharacterName,
      'Automated report-abuse alert for moderator review.',
      input.realm,
      JSON.stringify({
        ...input.evidence,
        triggeredEventIds: input.eventIds.sort((a, b) => a - b),
        abuseReasons: input.reasons,
        abuseScore: input.score,
      }),
      input.score,
      input.reasons,
      dedupeKey,
    ],
  );
}

export interface ModerationQueueRow {
  accountId: number;
  username: string;
  status: 'active' | 'suspended' | 'banned';
  suspendedUntil: string | null;
  openReports: number;
  latestReportAt: string;
  latestReason: string;
  latestSource: string;
  latestReportKind: string;
  maxAbuseScore: number;
  abuseReasons: string[];
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
       count(DISTINCT r.id)::int AS open_reports,
       max(r.created_at) AS latest_report_at,
       (array_agg(r.reason ORDER BY r.created_at DESC))[1] AS latest_reason,
       (array_agg(r.source ORDER BY r.created_at DESC))[1] AS latest_source,
       (array_agg(r.report_kind ORDER BY r.created_at DESC))[1] AS latest_report_kind,
       max(r.abuse_score)::int AS max_abuse_score,
       array_remove(array_agg(DISTINCT unnest_reason.reason), NULL::text) AS abuse_reasons,
       array_remove(array_agg(DISTINCT r.reported_character_name), '') AS character_names
     FROM player_reports r
     JOIN accounts a ON a.id = r.reported_account_id
     LEFT JOIN LATERAL unnest(r.abuse_reasons) AS unnest_reason(reason) ON TRUE
     WHERE r.status = 'open'
     GROUP BY a.id
     ORDER BY count(DISTINCT r.id) DESC, max(r.created_at) DESC`,
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
      latestSource: r.latest_source ?? 'player',
      latestReportKind: r.latest_report_kind ?? 'player_report',
      maxAbuseScore: Number(r.max_abuse_score ?? 0),
      abuseReasons: r.abuse_reasons ?? [],
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
  source: string;
  reportKind: string;
  evidence: Record<string, unknown>;
  abuseScore: number;
  abuseReasons: string[];
  createdAt: string;
  reporterAccountId: number | null;
  reporterUsername: string | null;
  reporterCharacterId: number | null;
  reporterCharacterName: string;
  reportedAccountId: number;
  reportedUsername: string;
  reportedCharacterId: number | null;
  reportedCharacterName: string;
  relatedEvents: ReportEventSummary[];
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
    const evidence = objectEvidence(r.evidence);
    const triggeredEventIds = Array.isArray(evidence.triggeredEventIds)
      ? evidence.triggeredEventIds.map((id) => Number(id)).filter(Number.isFinite)
      : [];
    const eventParams: unknown[] = [Number(r.id), triggeredEventIds];
    const events = await pool.query(
      `SELECT id, created_at, outcome, reason,
              reporter_account_id, reporter_character_name,
              target_account_id, target_character_name,
              details_hash, details_length, ip_hash, user_agent_hash,
              abuse_score, abuse_reasons, evidence
       FROM report_events
       WHERE player_report_id = $1 OR id = ANY($2::bigint[])
       ORDER BY created_at DESC
       LIMIT 50`,
      eventParams,
    );
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
      source: r.source ?? 'player',
      reportKind: r.report_kind ?? 'player_report',
      evidence,
      abuseScore: Number(r.abuse_score ?? 0),
      abuseReasons: r.abuse_reasons ?? [],
      createdAt: new Date(r.created_at).toISOString(),
      reporterAccountId: r.reporter_account_id,
      reporterUsername: r.reporter_username,
      reporterCharacterId: r.reporter_character_id,
      reporterCharacterName: r.reporter_character_name,
      reportedAccountId: r.reported_account_id,
      reportedUsername: r.reported_username,
      reportedCharacterId: r.reported_character_id,
      reportedCharacterName: r.reported_character_name,
      relatedEvents: events.rows.map((event): ReportEventSummary => ({
        id: Number(event.id),
        createdAt: new Date(event.created_at).toISOString(),
        outcome: event.outcome,
        reason: event.reason,
        reporterAccountId: event.reporter_account_id === null ? null : Number(event.reporter_account_id),
        reporterCharacterName: event.reporter_character_name ?? '',
        targetAccountId: event.target_account_id === null ? null : Number(event.target_account_id),
        targetCharacterName: event.target_character_name ?? '',
        detailsHash: event.details_hash ?? '',
        detailsLength: Number(event.details_length ?? 0),
        ipHash: event.ip_hash ?? '',
        userAgentHash: event.user_agent_hash ?? '',
        abuseScore: Number(event.abuse_score ?? 0),
        abuseReasons: event.abuse_reasons ?? [],
        evidence: objectEvidence(event.evidence),
      })),
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

function objectEvidence(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
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
  action: 'suspend' | 'ban';
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
    } else {
      await client.query(
        `UPDATE accounts
         SET suspended_until = $2, moderation_reason = $3
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
