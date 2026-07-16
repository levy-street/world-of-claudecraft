import { readFileSync } from 'node:fs';
import {
  type ChatFilterState,
  cleanEscalationConfig,
  DEFAULT_HARD_WORDS,
  DEFAULT_SOFT_WORDS,
  type EscalationConfig,
  normalizeWord,
  parseWordList,
} from './chat_filter';
import { pool } from './db';

// SQL for the chat filter: admin-managed word lists, escalation config,
// per-account mute/strike state, and the hard-word incident log. Logic +
// matching live in chat_filter.ts; this file is the only place their SQL runs.

export type WordTier = 'soft' | 'hard';

export interface FilterWord {
  id: number;
  word: string;
  tier: WordTier;
  createdAt: string;
}

// Fold an operator-supplied list + optional file into seed terms. Used for both
// tiers; the env var names differ per tier. After first boot the list is
// DB-managed from the admin dashboard and these env vars are ignored.
function envSeedWords(listVar: string, fileVar: string): string[] {
  let raw = process.env[listVar] ?? '';
  const file = process.env[fileVar] ?? '';
  if (file) {
    try {
      raw += ` ${readFileSync(file, 'utf8')}`;
    } catch (err) {
      console.warn(`could not read ${fileVar} (${file}) for seed:`, err);
    }
  }
  return parseWordList(raw);
}

function envSeedSoftWords(): string[] {
  // Legacy operator config for the cosmetic soft tier.
  return envSeedWords('CHAT_CENSOR_LIST', 'CHAT_CENSOR_FILE');
}

function envSeedHardWords(): string[] {
  // The hard (slur) tier ships no plaintext list in this open-source repo and is
  // the SOLE punitive trigger, so the operator MUST seed the slur list here at
  // first boot — with nothing seeded, nothing is enforced. Managed from the admin
  // dashboard thereafter. See DEFAULT_HARD_WORDS in chat_filter.ts.
  return envSeedWords('CHAT_FILTER_HARD_LIST', 'CHAT_FILTER_HARD_FILE');
}

// Minimal query surface for the boot-time seeding path: ensureSchema passes its
// dedicated boot client (a plain pg Client, no release()), tests pass a
// recording client. Only query() is used. Mirrors MarketBackfillClient.
export interface ChatFilterSeedClient {
  query(text: string, values?: unknown[]): Promise<{ rows: any[] }>;
}

async function insertSeedWords(
  client: ChatFilterSeedClient,
  words: string[],
  tier: WordTier,
): Promise<void> {
  const unique = Array.from(
    new Set(words.map((w) => normalizeWord(w)).filter((w) => w.length > 0)),
  );
  for (const word of unique) {
    await client.query(
      `INSERT INTO chat_filter_words (word, tier) VALUES ($1, $2) ON CONFLICT (tier, word) DO NOTHING`,
      [word, tier],
    );
  }
}

/**
 * Seed the word lists + config the first time only. Runs inside ensureSchema's
 * boot transaction (pinned client, under the advisory lock), so it's safe under
 * concurrent realm boots and only fills a tier when that tier is empty.
 */
export async function seedChatFilterDefaults(client: ChatFilterSeedClient): Promise<void> {
  await client.query(`INSERT INTO chat_filter_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING`);
  const counts = await client.query(
    `SELECT tier, count(*)::int AS n FROM chat_filter_words GROUP BY tier`,
  );
  const byTier = new Map<string, number>(counts.rows.map((r) => [r.tier, r.n]));
  if (!byTier.get('soft')) {
    await insertSeedWords(client, [...DEFAULT_SOFT_WORDS, ...envSeedSoftWords()], 'soft');
  }
  if (!byTier.get('hard')) {
    await insertSeedWords(client, [...DEFAULT_HARD_WORDS, ...envSeedHardWords()], 'hard');
  }
}

/** Load the full live filter state (both word tiers + escalation config). */
export async function loadChatFilterState(): Promise<ChatFilterState> {
  const [words, config] = await Promise.all([
    pool.query(`SELECT word, tier FROM chat_filter_words`),
    pool.query(
      `SELECT warnings_before_mute, mute_ladder_seconds FROM chat_filter_config WHERE id = 1`,
    ),
  ]);
  const soft: string[] = [];
  const hard: string[] = [];
  for (const r of words.rows) {
    (r.tier === 'hard' ? hard : soft).push(r.word);
  }
  const cfgRow = config.rows[0];
  const escalation: EscalationConfig = cleanEscalationConfig({
    warningsBeforeMute: cfgRow?.warnings_before_mute,
    muteLadderSeconds: cfgRow?.mute_ladder_seconds,
  });
  return { soft, hard, config: escalation };
}

// ---- Admin: word list CRUD --------------------------------------------------

export async function listFilterWords(tier: WordTier): Promise<FilterWord[]> {
  const res = await pool.query(
    `SELECT id, word, tier, created_at FROM chat_filter_words WHERE tier = $1 ORDER BY word`,
    [tier],
  );
  return res.rows.map((r) => ({
    id: Number(r.id),
    word: r.word,
    tier: r.tier,
    createdAt: new Date(r.created_at).toISOString(),
  }));
}

/** Add a normalized word to a tier. Returns false if it normalizes to nothing. */
export async function addFilterWord(rawWord: unknown, tier: WordTier): Promise<boolean> {
  const word = normalizeWord(typeof rawWord === 'string' ? rawWord : '');
  if (!word) return false;
  await pool.query(
    `INSERT INTO chat_filter_words (word, tier) VALUES ($1, $2) ON CONFLICT (tier, word) DO NOTHING`,
    [word, tier],
  );
  return true;
}

export async function removeFilterWord(id: number): Promise<boolean> {
  const res = await pool.query(`DELETE FROM chat_filter_words WHERE id = $1`, [id]);
  return (res.rowCount ?? 0) > 0;
}

// ---- Admin: escalation config ----------------------------------------------

export async function getFilterConfig(): Promise<EscalationConfig> {
  const res = await pool.query(
    `SELECT warnings_before_mute, mute_ladder_seconds FROM chat_filter_config WHERE id = 1`,
  );
  const row = res.rows[0];
  return cleanEscalationConfig({
    warningsBeforeMute: row?.warnings_before_mute,
    muteLadderSeconds: row?.mute_ladder_seconds,
  });
}

export async function updateFilterConfig(input: {
  warningsBeforeMute?: unknown;
  muteLadderSeconds?: unknown;
}): Promise<EscalationConfig> {
  const clean = cleanEscalationConfig(input);
  await pool.query(
    `INSERT INTO chat_filter_config (id, warnings_before_mute, mute_ladder_seconds, updated_at)
     VALUES (1, $1, $2, now())
     ON CONFLICT (id) DO UPDATE
       SET warnings_before_mute = EXCLUDED.warnings_before_mute,
           mute_ladder_seconds = EXCLUDED.mute_ladder_seconds,
           updated_at = now()`,
    [clean.warningsBeforeMute, clean.muteLadderSeconds],
  );
  return clean;
}

// ---- Enforcement: strikes, mutes, incident log ------------------------------

export interface AppliedStrike {
  strikes: number;
  chatMutedUntil: string | null;
}

/**
 * Atomically record one hard-word offense: bump the strike count and, when
 * `muteSeconds > 0`, extend the account-wide mute (never shortening an existing
 * longer mute). Returns the authoritative post-update values for the session.
 */
export async function applyChatStrike(
  accountId: number,
  muteSeconds: number,
): Promise<AppliedStrike> {
  const res = await pool.query(
    `UPDATE accounts
     SET chat_strikes = chat_strikes + 1,
         chat_muted_until = CASE
           WHEN $2 > 0 THEN GREATEST(COALESCE(chat_muted_until, to_timestamp(0)), now() + ($2 || ' seconds')::interval)
           ELSE chat_muted_until
         END
     WHERE id = $1
     RETURNING chat_strikes, chat_muted_until`,
    [accountId, Math.max(0, Math.floor(muteSeconds))],
  );
  const row = res.rows[0];
  return {
    strikes: Number(row?.chat_strikes ?? 0),
    chatMutedUntil: row?.chat_muted_until ? new Date(row.chat_muted_until).toISOString() : null,
  };
}

export async function recordChatViolation(input: {
  accountId: number;
  characterId: number;
  characterName: string;
  term: string;
  channel: string;
  message: string;
  action: 'warning' | 'mute';
  muteSeconds: number;
}): Promise<void> {
  await pool.query(
    `INSERT INTO chat_violations
       (account_id, character_id, character_name, term, channel, message, action, mute_seconds)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      input.accountId,
      input.characterId,
      input.characterName,
      input.term.slice(0, 64),
      input.channel.slice(0, 32),
      input.message.slice(0, 400),
      input.action,
      Math.max(0, Math.floor(input.muteSeconds)),
    ],
  );
}

// ---- Admin: per-account chat moderation view + manual actions ---------------

export interface ChatViolationRow {
  id: number;
  characterName: string;
  term: string;
  channel: string;
  message: string;
  action: string;
  muteSeconds: number;
  createdAt: string;
}

export interface ChatModerationDetail {
  chatMutedUntil: string | null;
  chatStrikes: number;
  violations: ChatViolationRow[];
}

export async function chatModerationForAccount(
  accountId: number,
  limit = 25,
): Promise<ChatModerationDetail> {
  const [acct, viol] = await Promise.all([
    pool.query(`SELECT chat_muted_until, chat_strikes FROM accounts WHERE id = $1`, [accountId]),
    pool.query(
      `SELECT id, character_name, term, channel, message, action, mute_seconds, created_at
       FROM chat_violations WHERE account_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [accountId, Math.min(100, Math.max(1, limit))],
    ),
  ]);
  const row = acct.rows[0];
  const mutedUntil = row?.chat_muted_until ? new Date(row.chat_muted_until) : null;
  return {
    chatMutedUntil:
      mutedUntil && mutedUntil.getTime() > Date.now() ? mutedUntil.toISOString() : null,
    chatStrikes: Number(row?.chat_strikes ?? 0),
    violations: viol.rows.map((r) => ({
      id: Number(r.id),
      characterName: r.character_name,
      term: r.term,
      channel: r.channel,
      message: r.message,
      action: r.action,
      muteSeconds: Number(r.mute_seconds),
      createdAt: new Date(r.created_at).toISOString(),
    })),
  };
}

export interface ChatModeratedAccount {
  id: number;
  username: string;
  isAdmin: boolean;
  chatStrikes: number;
  chatMutedUntil: string | null;
}

/** Accounts that are currently chat-muted or carry strikes — the chat-filter dash list. */
export async function chatModeratedAccounts(limit = 200): Promise<ChatModeratedAccount[]> {
  const res = await pool.query(
    `SELECT id, username, is_admin, COALESCE(chat_strikes, 0) AS chat_strikes, chat_muted_until
       FROM accounts
      WHERE (chat_muted_until IS NOT NULL AND chat_muted_until > now()) OR COALESCE(chat_strikes, 0) > 0
      ORDER BY chat_muted_until DESC NULLS LAST, chat_strikes DESC, id
      LIMIT $1`,
    [Math.min(500, Math.max(1, limit))],
  );
  return res.rows.map((r) => ({
    id: Number(r.id),
    username: r.username,
    isAdmin: r.is_admin,
    chatStrikes: Number(r.chat_strikes ?? 0),
    chatMutedUntil: r.chat_muted_until ? new Date(r.chat_muted_until).toISOString() : null,
  }));
}

export async function resetChatStrikes(accountId: number): Promise<boolean> {
  const res = await pool.query(`UPDATE accounts SET chat_strikes = 0 WHERE id = $1`, [accountId]);
  return (res.rowCount ?? 0) > 0;
}
