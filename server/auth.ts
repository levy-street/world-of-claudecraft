import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
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

function bannedUsernameTerms(): string[] {
  const rawList = process.env.USERNAME_BANLIST ?? '';
  const file = process.env.USERNAME_BANLIST_FILE ?? '';
  const cacheKey = `${rawList}\0${file}`;
  if (cacheKey === banlistCacheKey) return banlistCacheTerms;

  const terms = BUILT_IN_BANNED_NAME_TERMS.concat(parseBanlist(rawList));
  if (!file) {
    banlistCacheTerms = terms;
    banlistCacheKey = cacheKey;
    return banlistCacheTerms;
  }
  try {
    banlistCacheTerms = terms.concat(parseBanlist(readFileSync(file, 'utf8')));
  } catch (err) {
    console.warn(`could not read USERNAME_BANLIST_FILE (${file}):`, err);
    return terms;
  }
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
