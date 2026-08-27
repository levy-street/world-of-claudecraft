import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { englishDataset, englishRecommendedTransformers, RegExpMatcher } from 'obscenity';

const SCRYPT_N = 16384,
  SCRYPT_R = 8,
  SCRYPT_P = 1,
  KEYLEN = 64;

export function hashPassword(password: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const salt = randomBytes(16);
    scrypt(password, salt, KEYLEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P }, (err, key) => {
      if (err) reject(err);
      else resolve(`${salt.toString('hex')}:${key.toString('hex')}`);
    });
  });
}

export function verifyPassword(password: string, stored: string): Promise<boolean> {
  return new Promise((resolve) => {
    const [saltHex, keyHex] = stored.split(':');
    if (!saltHex || !keyHex) return resolve(false);
    const salt = Buffer.from(saltHex, 'hex');
    const expected = Buffer.from(keyHex, 'hex');
    scrypt(password, salt, KEYLEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P }, (err, key) => {
      if (err || key.length !== expected.length) return resolve(false);
      resolve(timingSafeEqual(key, expected));
    });
  });
}

export function newToken(): string {
  return randomBytes(32).toString('hex');
}

const CONFUSABLE_CHARS: Record<string, string> = {
  '0': 'o',
  '1': 'i',
  '!': 'i',
  '|': 'i',
  '3': 'e',
  '4': 'a',
  '@': 'a',
  '5': 's',
  $: 's',
  '7': 't',
  '+': 't',
  '8': 'b',
};

const profanityMatcher = new RegExpMatcher({
  ...englishDataset.build(),
  ...englishRecommendedTransformers,
});

const BUILT_IN_BANNED_NAME_TERMS = parseBanlist(['hitler'].join('\n'));

function normalizedUsernameForCensorship(username: string): string {
  return username
    .toLowerCase()
    .replace(/[0134578!|@$+]/g, (ch) => CONFUSABLE_CHARS[ch] ?? ch)
    .replace(/[^a-z]/g, '');
}

function parseBanlist(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(/[\s,]+/)
    .map((term) => normalizedUsernameForCensorship(term))
    .filter((term) => term.length > 0);
}

let banlistCacheKey: string | null = null;
let banlistCacheTerms: string[] = [];
// The terms of the last banlist file read that SUCCEEDED (stale-on-error,
// the cached_read contract): an unreadable or oversized file keeps serving
// these until the file comes back, so a bad mount degrades to "yesterday's
// list", never to "no operator list at all".
let banlistLastGoodFileTerms: string[] = [];
// ...keyed to the PATH they came from: a re-pointed USERNAME_BANLIST_FILE
// that cannot be read serves NO stale terms from the previous path.
let banlistLastGoodFile = '';

/** Ceiling on the banlist file the server will read whole (the statSync
 *  result is already in hand, so the bound is free). A file past it is
 *  treated exactly like an unreadable one: warned once, last-good served.
 *  64 KiB, not larger, because the ceiling SANCTIONS a list size and every
 *  name screen runs an O(terms) substring scan over the parsed list (a
 *  1 MiB file is 150k to 350k short terms, about two milliseconds per screen
 *  on every signup, character create, guild name, and rename, measured at
 *  the phase 13 QA); 64 KiB is about nine thousand hand-maintained terms at
 *  under a tenth of a millisecond, far past any real operator word list. */
export const USERNAME_BANLIST_FILE_MAX_BYTES = 1 << 16;

/** Load (or re-validate) the configured banlist once, for the boot log: an
 *  operator whose USERNAME_BANLIST_FILE cannot be read must learn it at boot,
 *  loudly, not from one warn line buried at the first name screen hours
 *  later (the phase 13 QA hot-path review). Returns whether the configured
 *  file is the list being served and how many terms are live. */
export function warmUsernameBanlist(): { file: string; loaded: boolean; terms: number } {
  const file = process.env.USERNAME_BANLIST_FILE ?? '';
  const terms = bannedUsernameTerms().length;
  return { file, loaded: file === '' || banlistLastGoodFile === file, terms };
}

function bannedUsernameTerms(): string[] {
  const rawList = process.env.USERNAME_BANLIST ?? '';
  const file = process.env.USERNAME_BANLIST_FILE ?? '';
  // The file's mtime AND size ride the cache key (one stat call) so EDITING
  // the banlist file takes effect without a process restart, and a rewrite
  // that lands inside the same timestamp still busts when its length moved
  // (a same-mtime same-length rewrite is the accepted residual: only the
  // content hash could see it, and that costs the read this cache elides).
  // The per-call statSync is bounded: it fires only when
  // USERNAME_BANLIST_FILE is set, and every caller a client can drive is
  // shape-first and metered (the pet_rename and perfect_item name screens on
  // the name-screen lane, server/msg_lanes.ts; the guild-name screen on the
  // command lane behind validateGuildName's 3 to 24 letters), so it can never
  // become an unmetered per-frame stat. A missing file is the cheap
  // no-throw arm (throwIfNoEntry: false, a fraction of a throwing stat: the
  // steady state a bad mount lives in); any other stat failure collapses to
  // the same sentinel so the read arm below still owns the one warn path for
  // an unreadable file, which stays FAIL-OPEN by decision: a bad mount must
  // not block every signup, and the warn line plus the boot-time
  // warmUsernameBanlist line are the operator's signals.
  let fileStamp = '';
  let fileSize = -1;
  if (file) {
    try {
      const stat = statSync(file, { throwIfNoEntry: false });
      if (stat === undefined) fileStamp = 'unreadable';
      else {
        fileStamp = `${stat.mtimeMs}:${stat.size}`;
        fileSize = stat.size;
      }
    } catch {
      fileStamp = 'unreadable';
    }
  }
  const cacheKey = `${rawList}\0${file}\0${fileStamp}`;
  if (cacheKey === banlistCacheKey) return banlistCacheTerms;

  const terms = BUILT_IN_BANNED_NAME_TERMS.concat(parseBanlist(rawList));
  if (!file) {
    banlistCacheTerms = terms;
    banlistCacheKey = cacheKey;
    return banlistCacheTerms;
  }
  // A failed read (missing, unreadable, or past the ceiling) is paid ONCE per
  // state transition, never per call: the outcome is cached under this key
  // too, and the key moves the moment the file returns or changes (its stamp
  // leaves the 'unreadable' sentinel, or its size crosses back), so the cache
  // self-heals with no restart. Until then the last good file terms keep
  // being enforced (the phase 13 QA hot-path finding: the old shape re-ran the
  // stat, the read, AND a synchronous warn on every name screen while serving
  // no file terms at all).
  if (fileSize > USERNAME_BANLIST_FILE_MAX_BYTES) {
    console.warn(
      `USERNAME_BANLIST_FILE (${file}) is ${fileSize} bytes, past the ${USERNAME_BANLIST_FILE_MAX_BYTES} byte ceiling; keeping the last good list`,
    );
  } else {
    try {
      const text = readFileSync(file, 'utf8');
      // The stat above and this read are two syscalls; a file regrown past
      // the ceiling between them is refused on what was actually read.
      if (Buffer.byteLength(text, 'utf8') > USERNAME_BANLIST_FILE_MAX_BYTES) {
        throw new Error(`grew past the ${USERNAME_BANLIST_FILE_MAX_BYTES} byte ceiling mid-read`);
      }
      banlistLastGoodFileTerms = parseBanlist(text);
      banlistLastGoodFile = file;
    } catch (err) {
      console.warn(
        `could not read USERNAME_BANLIST_FILE (${file}); keeping the last good list:`,
        err,
      );
    }
  }
  const stale = banlistLastGoodFile === file ? banlistLastGoodFileTerms : [];
  banlistCacheTerms = terms.concat(stale);
  banlistCacheKey = cacheKey;
  return banlistCacheTerms;
}

export function offensiveUsername(u: unknown): boolean {
  return offensiveName(u);
}

export function offensiveName(u: unknown): boolean {
  if (typeof u !== 'string') return false;
  const normalized = normalizedUsernameForCensorship(u);
  return (
    profanityMatcher.hasMatch(u) ||
    profanityMatcher.hasMatch(normalized) ||
    bannedUsernameTerms().some((term) => normalized.includes(term))
  );
}

export function validUsername(u: unknown): u is string {
  return validUsernameShape(u) && !offensiveName(u);
}

export function validUsernameShape(u: unknown): u is string {
  return typeof u === 'string' && /^[A-Za-z0-9_]{3,24}$/.test(u);
}

export const MIN_PASSWORD_LENGTH = 6;
export const MAX_PASSWORD_LENGTH = 128;

export function validPassword(p: unknown): p is string {
  return (
    typeof p === 'string' && p.length >= MIN_PASSWORD_LENGTH && p.length <= MAX_PASSWORD_LENGTH
  );
}

// Canonical email validator, shared by the register handler, the account portal,
// and the Discord capture path so all three agree on shape and bound. Deliberately
// permissive (a single "x@y.z" check): we capture a recovery address, we do not
// try to out-validate a real mailbox, and RFC 5321 caps the whole address at 254.
export const MAX_EMAIL_LENGTH = 254;
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Trim and validate an email address. Returns the cleaned address, or null when
// it is missing, over-length, or the wrong shape. Callers store the returned
// (trimmed) value so a padded address can never be persisted.
export function normalizeEmail(e: unknown): string | null {
  if (typeof e !== 'string') return null;
  const trimmed = e.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_EMAIL_LENGTH) return null;
  return EMAIL_SHAPE.test(trimmed) ? trimmed : null;
}

export function validEmail(e: unknown): e is string {
  return normalizeEmail(e) !== null;
}

export function validCharName(n: unknown): n is string {
  return validCharNameShape(n) && !offensiveName(n);
}

export function validCharNameShape(n: unknown): n is string {
  return typeof n === 'string' && /^[A-Za-z][A-Za-z' -]{1,15}$/.test(n);
}

// Server-side canonical form for a character name: trim the ends and collapse
// any interior whitespace run to a single space. The browser already trims
// before sending, but the server is the authority — a direct API client must
// not be able to store a padded name (e.g. "Bob "), which would then fail to
// match the typed, unpadded form in findCharacterByName. Returns the cleaned
// name, or null if it is not a valid character name once normalized.
export function normalizeCharName(n: unknown): string | null {
  if (typeof n !== 'string') return null;
  const cleaned = n.trim().replace(/\s+/g, ' ');
  return validCharNameShape(cleaned) ? cleaned : null;
}
