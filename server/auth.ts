import { readFileSync } from 'node:fs';
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const SCRYPT_N = 16384, SCRYPT_R = 8, SCRYPT_P = 1, KEYLEN = 64;

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
  '$': 's',
  '7': 't',
  '+': 't',
  '8': 'b',
};

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

function bannedUsernameTerms(): string[] {
  const terms = parseBanlist(process.env.USERNAME_BANLIST);
  const file = process.env.USERNAME_BANLIST_FILE;
  if (!file) return terms;
  try {
    return terms.concat(parseBanlist(readFileSync(file, 'utf8')));
  } catch (err) {
    console.warn(`could not read USERNAME_BANLIST_FILE (${file}):`, err);
    return terms;
  }
}

export function offensiveUsername(u: unknown): boolean {
  if (typeof u !== 'string') return false;
  const normalized = normalizedUsernameForCensorship(u);
  return bannedUsernameTerms().some((term) => normalized.includes(term));
}

export function validUsername(u: unknown): u is string {
  return typeof u === 'string' && /^[A-Za-z0-9_]{3,24}$/.test(u) && !offensiveUsername(u);
}

export function validPassword(p: unknown): p is string {
  return typeof p === 'string' && p.length >= 6 && p.length <= 128;
}

// Character names allow any Unicode letter (Latin, Chinese/CJK, etc.) plus
// combining marks and space/apostrophe/hyphen, must start with a letter, and
// are 2-16 code points long. Digits and punctuation stay disallowed (so e.g.
// reserved "GM01"-style names remain rejected). Mirrored client-side by
// sanitizeOfflineName() in src/main.ts.
export function validCharName(n: unknown): n is string {
  return typeof n === 'string' && /^[\p{L}][\p{L}\p{M}' -]{1,15}$/u.test(n);
}
