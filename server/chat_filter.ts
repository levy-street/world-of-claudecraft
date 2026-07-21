// Pure, host-agnostic chat profanity/slur filtering. No SQL, no DOM — the SQL
// layer lives in chat_filter_db.ts and the wiring in game.ts. Two tiers:
//
//   - "soft" words (everyday swearing): cosmetic only. The server ships the
//     normalized soft list to each client in `hello`; the client masks matches
//     locally *iff* the player's profanity filter is on. The server itself
//     never alters soft words, so toggling the filter off shows raw text.
//   - "hard" words (slurs): enforced server-side. A message containing one is
//     blocked and the sender is warned, then escalated to timed, account-wide
//     chat mutes (see `escalate`). The two tiers never interact: a soft word is
//     never punitive, and a hard word is never merely masked.
//
// The hard tier is driven SOLELY by the admin-managed hard list (see
// `tokenMatchesHard`): a message is punished only when one of its tokens, after
// normalization, equals a configured hard word (or its trailing-"s" plural).
// Normalization folds leet/confusable/diacritic/Unicode obfuscation, so
// "n1gg3r"/"nî99er"-style spellings of a LISTED word still resolve to it.
// Whole-token (not substring) matching keeps innocent words safe with NO
// whitelist needed — "snigger", "assassin", "classy pass" can never match.
// Affixed forms the list does not contain (e.g. <slur> + a suffix) are NOT
// caught unless an operator adds them.
//
// NOTE: this is open-source and intentionally ships NO plaintext slur list
// (DEFAULT_HARD_WORDS is empty). Operators seed the hard list privately via the
// CHAT_FILTER_HARD_LIST / CHAT_FILTER_HARD_FILE env vars (see chat_filter_db.ts)
// at first boot, then manage it from the admin dashboard. With an empty hard
// list NOTHING is enforced, so seeding is required for slur enforcement.

const CONFUSABLE_CHARS: Record<string, string> = {
  '0': 'o',
  '1': 'i',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '6': 'g',
  '7': 't',
  '8': 'b',
  '9': 'g',
  '!': 'i',
  '|': 'i',
  '@': 'a',
  '$': 's',
  '+': 't',
  '©': 'c',
  '€': 'e',
  '£': 'l',
};

const CONFUSABLE_RE = /[0-9!|@$+©€£]/g;

// Tokens we scan: any Unicode letter/mark/number plus the leet punctuation that
// folds into letters. Unicode-aware so accented/styled glyphs (î, ⓖ, 𝓰, ｇ) stay
// inside one token rather than splitting an evasion apart. Else = separator.
const TOKEN_RE = /[\p{L}\p{M}\p{N}_@$!|+©€£]+/gu;

/**
 * Fold text toward its comparable ASCII core *without* dropping separators:
 * Unicode-decompose (NFKD — so fullwidth ｇ, circled ⓖ, math 𝓰, and ligatures
 * resolve), strip combining diacritics (î→i, é→e), lowercase, then map
 * leet/confusable glyphs to letters. This is what the obscenity baseline scans
 * a copy of, so "nî99er" / "ni66@" de-obfuscate to the underlying slur.
 */
export function foldConfusables(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(CONFUSABLE_RE, (ch) => CONFUSABLE_CHARS[ch] ?? ch);
}

/** Fold a token to its comparable core: de-leet/deburr, then strip non-letters. */
export function normalizeWord(term: string): string {
  return foldConfusables(term).replace(/[^a-z]/g, '');
}

/** Split a raw blob (newline / comma / space separated) into normalized terms. */
export function parseWordList(raw: string): string[] {
  return raw
    .split(/[\s,]+/)
    .map((t) => normalizeWord(t))
    .filter((t) => t.length > 0);
}

// Soft tier: generous substring match (cosmetic, so "shitty" → masked is fine).
function tokenMatchesSoft(normalizedToken: string, terms: readonly string[]): boolean {
  return normalizedToken.length > 0 && terms.some((term) => normalizedToken.includes(term));
}

/**
 * Mask every token matching a soft term with asterisks. Used client-side for
 * the display filter and never on the server's broadcast path.
 */
export function maskText(text: string, terms: readonly string[]): string {
  if (terms.length === 0) return text;
  return text.replace(TOKEN_RE, (tok) =>
    tokenMatchesSoft(normalizeWord(tok), terms) ? '*'.repeat(tok.length) : tok,
  );
}

// Hard tier: strict whole-token equality (plus a stripped trailing plural "s"),
// NOT substring. Substring matching on a *punitive* list is unacceptable — it
// would auto-mute "despicable" for containing "spic" or "class" for "ass". The
// cost of a miss here is small (human reports + admins extend the list); the
// cost of a false positive is muting an innocent player.
function tokenMatchesHard(normalizedToken: string, terms: readonly string[]): boolean {
  if (normalizedToken.length === 0) return false;
  const singular = normalizedToken.endsWith('s') ? normalizedToken.slice(0, -1) : normalizedToken;
  return terms.some((term) => normalizedToken === term || singular === term);
}

/**
 * First hard term a message hits, or null. This is the SOLE punitive trigger:
 * only a token that — after normalization — equals a configured hard word (or
 * its trailing-"s" plural) counts. An empty list enforces nothing.
 */
export function findHardWord(text: string, terms: readonly string[]): string | null {
  if (terms.length === 0) return null;
  const tokens = text.match(TOKEN_RE);
  if (!tokens) return null;
  for (const tok of tokens) {
    const normalized = normalizeWord(tok);
    if (tokenMatchesHard(normalized, terms)) {
      // Return the configured term that fired, for the incident log.
      const singular = normalized.endsWith('s') ? normalized.slice(0, -1) : normalized;
      return terms.find((term) => normalized === term || singular === term) ?? normalized;
    }
  }
  return null;
}

// -------------------------------------------------------------------------
// Escalation: warnings, then a ladder of timed account-wide chat mutes.
// -------------------------------------------------------------------------

export interface EscalationConfig {
  /** Free passes (warning only) before the first mute. */
  warningsBeforeMute: number;
  /** Mute durations in seconds for the 1st, 2nd, … mute. The last entry caps. */
  muteLadderSeconds: number[];
}

export const DEFAULT_ESCALATION: EscalationConfig = {
  warningsBeforeMute: 1,
  muteLadderSeconds: [10 * 60, 60 * 60, 24 * 60 * 60], // 10m → 1h → 24h
};

export interface EscalationOutcome {
  kind: 'warning' | 'mute';
  /** Mute length in seconds; 0 for a warning. */
  muteSeconds: number;
  /** The sender's new strike total after this offense. */
  strikes: number;
}

/**
 * Given the sender's previous strike count, decide what this offense earns.
 * Strikes are 1-based: the Nth hard-word offense is strike N. The first
 * `warningsBeforeMute` offenses are warnings; the rest walk the mute ladder,
 * clamping at its final (longest) entry.
 */
export function escalate(previousStrikes: number, cfg: EscalationConfig): EscalationOutcome {
  const strikes = previousStrikes + 1;
  const ladder = cfg.muteLadderSeconds;
  if (strikes <= cfg.warningsBeforeMute || ladder.length === 0) {
    return { kind: 'warning', muteSeconds: 0, strikes };
  }
  const idx = Math.min(strikes - cfg.warningsBeforeMute - 1, ladder.length - 1);
  return { kind: 'mute', muteSeconds: Math.max(0, Math.floor(ladder[idx])), strikes };
}

/** Sanitize an escalation config coming from the DB / admin input. */
export function cleanEscalationConfig(input: {
  warningsBeforeMute?: unknown;
  muteLadderSeconds?: unknown;
}): EscalationConfig {
  const warnings = Number(input.warningsBeforeMute);
  const ladderRaw = Array.isArray(input.muteLadderSeconds) ? input.muteLadderSeconds : [];
  const ladder = ladderRaw
    .map((n) => Math.floor(Number(n)))
    .filter((n) => Number.isFinite(n) && n > 0);
  return {
    warningsBeforeMute: Number.isFinite(warnings) && warnings >= 0 ? Math.floor(warnings) : DEFAULT_ESCALATION.warningsBeforeMute,
    muteLadderSeconds: ladder.length > 0 ? ladder : [...DEFAULT_ESCALATION.muteLadderSeconds],
  };
}

// -------------------------------------------------------------------------
// Built-in seed lists ("sensible starting points"). Admins edit the live lists
// from the dashboard; these only seed an empty table on first boot. Kept short
// and unambiguous — the hard list especially, since it carries punitive weight.
// -------------------------------------------------------------------------

export const DEFAULT_SOFT_WORDS: string[] = [
  'fuck',
  'shit',
  'bitch',
  'bastard',
  'cunt',
  'dick',
  'piss',
  'asshole',
  'dumbass',
  'douche',
  'wanker',
  'bollocks',
  'prick',
  'slut',
  'whore',
];

// Slur seed list — intentionally EMPTY in this open-source repo. The hard tier
// is the SOLE punitive trigger, so an operator MUST seed the slur list privately
// via CHAT_FILTER_HARD_LIST / CHAT_FILTER_HARD_FILE (see chat_filter_db.ts) at
// first boot — otherwise nothing is enforced — then manage it from the admin
// dashboard. Do NOT commit slurs here.
export const DEFAULT_HARD_WORDS: string[] = [];

/** A live snapshot of the filter state, loaded from the DB and cached. */
export interface ChatFilterState {
  soft: string[];
  hard: string[];
  config: EscalationConfig;
}

/**
 * Holds the loaded word lists + escalation config and exposes the operations
 * the server needs. The GameServer owns one instance and refreshes it from the
 * DB at boot and whenever an admin edits the lists.
 */
export class ChatFilter {
  private state: ChatFilterState = { soft: [], hard: [], config: DEFAULT_ESCALATION };

  load(state: ChatFilterState): void {
    this.state = {
      soft: [...state.soft],
      hard: [...state.hard],
      config: cleanEscalationConfig(state.config),
    };
  }

  /** Normalized soft terms shipped to clients for local masking. */
  softWords(): string[] {
    return [...this.state.soft];
  }

  config(): EscalationConfig {
    return this.state.config;
  }

  /** The first hard term `text` hits, or null. */
  findHardHit(text: string): string | null {
    return findHardWord(text, this.state.hard);
  }

  /** Decide the outcome for a sender who has `previousStrikes` prior offenses. */
  escalate(previousStrikes: number): EscalationOutcome {
    return escalate(previousStrikes, this.state.config);
  }
}
