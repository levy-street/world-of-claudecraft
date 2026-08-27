import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { closeSync, fstatSync, openSync, readSync, statSync } from 'node:fs';
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
let banlistCacheIndex: BanlistIndex = indexBannedTerms([]);
// The terms of the last banlist file read that SUCCEEDED (stale-on-error,
// the cached_read contract): an unreadable or oversized file keeps serving
// these until the file comes back, so a bad mount degrades to "yesterday's
// list", never to "no operator list at all".
let banlistLastGoodFileTerms: string[] = [];
// ...keyed to the PATH they came from: a re-pointed USERNAME_BANLIST_FILE
// that cannot be read serves NO stale terms from the previous path.
let banlistLastGoodFile = '';
// Whether the CURRENT cache entry was built from a successful file read (as
// opposed to a stale-serve after a failed one), and for which PATH: what the
// status readout reports, since "some earlier read of this path succeeded"
// is the wrong answer over a mount that just broke, and a flag for one path
// must not answer for a re-pointed one.
let banlistFileReadOk = false;
let banlistFileReadOkFor = '';

/** Ceiling on the banlist file the server will read whole. A file past it is
 *  treated exactly like an unreadable one: warned once, last-good served.
 *  64 KiB, about nine thousand hand-maintained terms, far past any real
 *  operator word list: the ceiling sanctions a list SIZE, and what a list
 *  costs is its parse (one split plus a per-term normalize, paid once per
 *  state transition of the file, never per screen) and the Set index below;
 *  a screen's own cost is independent of the term count (hasBannedTerm), so
 *  the ceiling is operator sanity rather than a CPU budget (the phase 13 QA
 *  hot-path review, which found the old per-screen linear scan priced every
 *  signup by the operator's list). */
export const USERNAME_BANLIST_FILE_MAX_BYTES = 1 << 16;

/** Minimum interval between two statSync calls on the banlist file. The
 *  stat is what lets an EDITED file take effect without a restart, but one
 *  stat per name screen was one blocking syscall per screen on the loop that
 *  runs the sim, and the guild-name screen rides the 30/s command lane
 *  (server/social.ts validateGuildName bounds the STRING, not the syscall);
 *  on a network-mounted file that is the realm stalling behind the mount at
 *  the screen rate. One second keeps the no-restart property at human
 *  timescale and bounds the stat to one per second per process whatever the
 *  screen rate. The residual, stated: the hold bounds the FREQUENCY of the
 *  synchronous syscalls, never their duration, so a mount that hangs hours
 *  after boot still blocks the loop once per hold on a name screen (the
 *  boot-time warm covers only a mount already hung at boot); an operator
 *  who must keep a banlist on a network mount copies it to local disk at
 *  deploy (DEPLOY.md). Clocked on performance.now (monotonic): a backward
 *  wall-clock step must not freeze the hold and hide an edit mid-incident. */
export const USERNAME_BANLIST_STAT_HOLD_MS = 1000;
let banlistStatHoldMs = USERNAME_BANLIST_STAT_HOLD_MS;
let banlistStatHold = { file: '', atMs: Number.NEGATIVE_INFINITY, stamp: '', size: -1 };

/** Test seam: the security suite edits the file and screens in the same
 *  millisecond, so it runs with no hold; it also proves the hold itself. */
export function setUsernameBanlistStatHoldMsForTest(ms: number): void {
  banlistStatHoldMs = ms;
  banlistStatHold = { file: '', atMs: Number.NEGATIVE_INFINITY, stamp: '', size: -1 };
}

/** The banned-term index: the Set of terms and the longest term's length
 *  (the walk bound in hasBannedTerm). */
export interface BanlistIndex {
  set: Set<string>;
  maxLen: number;
}

/** Empty terms are dropped here as well as in parseBanlist, so the exported
 *  pair keeps its `some(includes)` equivalence for ANY caller: the one input
 *  class where a substring walk of lengths one and up would diverge from
 *  `includes('')` (always true) is the empty term, which no list can mean. */
export function indexBannedTerms(terms: string[]): BanlistIndex {
  let maxLen = 0;
  const set = new Set<string>();
  for (const term of terms) {
    if (term.length === 0) continue;
    set.add(term);
    if (term.length > maxLen) maxLen = term.length;
  }
  return { set, maxLen };
}

/** Whether any banned term is a substring of `normalized`: exactly
 *  `terms.some((term) => normalized.includes(term))`, evaluated as a walk
 *  over the substrings of the NAME (lengths one through the longest term)
 *  against the Set, so a screen costs O(name length x longest term) whatever
 *  the list size, instead of O(terms) per screen: sized for a real operator
 *  list (a few hundred terms and up), and at the default single built-in
 *  term it does a handful more operations than one `includes`, immaterial
 *  beside the two obscenity-matcher passes in the same screen. Every term is
 *  non-empty (indexBannedTerms drops empties), so length one is the floor. */
export function hasBannedTerm(normalized: string, index: BanlistIndex): boolean {
  const n = normalized.length;
  const maxLen = Math.min(index.maxLen, n);
  for (let len = 1; len <= maxLen; len++) {
    for (let start = 0; start + len <= n; start++) {
      if (index.set.has(normalized.slice(start, start + len))) return true;
    }
  }
  return false;
}

export interface UsernameBanlistStatus {
  file: string;
  /** The outcome of the read that built the list now being served (not
   *  "some earlier read of this path once worked"); true with no file. */
  loaded: boolean;
  /** The FILE's own contribution, never the built-in or USERNAME_BANLIST
   *  terms, which stay enforced either way. */
  fileTerms: number;
}

/** A pure readout of the served list's state (no stat, no read): what the
 *  boot line and the woc_username_banlist_file_loaded gauge report. It
 *  reflects the state as of the LAST name screen or the boot warm: a mount
 *  that breaks on a quiet realm is seen at the next screen, since only a
 *  screen (or the warm) stats and reads. */
export function usernameBanlistStatus(): UsernameBanlistStatus {
  const file = process.env.USERNAME_BANLIST_FILE ?? '';
  const loaded = file === '' || (banlistFileReadOk && banlistFileReadOkFor === file);
  const fileTerms =
    file !== '' && banlistLastGoodFile === file ? banlistLastGoodFileTerms.length : 0;
  return { file, loaded, fileTerms };
}

/** Load (or re-validate) the configured banlist once, for the boot log: an
 *  operator whose USERNAME_BANLIST_FILE cannot be read must learn it at boot,
 *  loudly, not from one warn line buried at the first name screen hours
 *  later (the phase 13 QA hot-path review). Runs BEFORE the game loop starts
 *  (server/main.ts), so a hung mount stalls a boot, never a ticking realm. */
export function warmUsernameBanlist(): UsernameBanlistStatus {
  bannedUsernameTerms();
  return usernameBanlistStatus();
}

/** The one boot line for a configured file (nothing is printed without one). */
export function usernameBanlistBootLine(status: UsernameBanlistStatus): string {
  const verdict = status.loaded
    ? `loaded (${status.fileTerms} file terms)`
    : 'NOT READABLE (its terms are not enforced; the built-in and USERNAME_BANLIST terms still are; see the warn above)';
  return `  name banlist: ${status.file} ${verdict}`;
}

/** Read the banlist file whole, bounded on the OPEN descriptor's own size:
 *  fstat after open closes the stat-then-read window (a file regrown past
 *  the ceiling between the two syscalls is refused before any byte is
 *  allocated, and a grow after the fstat reads only `size` bytes), and the
 *  bound is bytes on disk, never a re-encoding of the decoded text, so a
 *  non-UTF-8 file under the ceiling is not refused for its U+FFFD inflation
 *  (the phase 13 QA security read of the first fix). */
function readBanlistBounded(file: string): string {
  const fd = openSync(file, 'r');
  try {
    const stat = fstatSync(fd);
    // A FIFO, a device, or a procfs-style file reports size 0 while holding
    // content: reading it "whole" would record an EMPTY list as a success.
    // Only a regular file's size is its content's size.
    if (!stat.isFile()) throw new Error('not a regular file');
    const size = stat.size;
    if (size > USERNAME_BANLIST_FILE_MAX_BYTES) {
      throw new Error(`grew past the ${USERNAME_BANLIST_FILE_MAX_BYTES} byte ceiling mid-read`);
    }
    const buf = Buffer.allocUnsafe(size);
    const read = readSync(fd, buf, 0, size, 0);
    // A short read (a truncating rewrite between the fstat and the pread)
    // must not pass a PREFIX of the list off as the whole list.
    if (read !== size) throw new Error(`read ${read} of ${size} bytes`);
    return buf.toString('utf8', 0, read);
  } finally {
    closeSync(fd);
  }
}

function bannedUsernameTerms(): BanlistIndex {
  const rawList = process.env.USERNAME_BANLIST ?? '';
  const file = process.env.USERNAME_BANLIST_FILE ?? '';
  // The file's mtime AND size ride the cache key (one stat call) so EDITING
  // the banlist file takes effect without a process restart, and a rewrite
  // that lands inside the same timestamp still busts when its length moved
  // (a same-mtime same-length rewrite is the accepted residual: only the
  // content hash could see it, and that costs the read this cache elides).
  // The stat itself is held to one per USERNAME_BANLIST_STAT_HOLD_MS per
  // process (never per call): every caller a client can drive is
  // shape-first (the pet_rename and perfect_item name screens on the
  // name-screen lane, server/msg_lanes.ts; the guild-name screen on the
  // command lane behind validateGuildName's 3 to 24 letters), which bounds
  // the STRING the matcher prices, and the hold is what bounds the syscall.
  // A missing file is the cheap no-throw arm (throwIfNoEntry: false, a
  // fraction of a throwing stat: the steady state a bad mount lives in); any
  // other stat failure collapses to the same sentinel so the read arm below
  // still owns the one warn path for an unreadable file, which stays
  // FAIL-OPEN by decision: a bad mount must not block every signup, and the
  // warn line, the boot line, and the loaded gauge are the operator's signals.
  let fileStamp = '';
  let fileSize = -1;
  if (file) {
    const nowMs = performance.now();
    if (banlistStatHold.file === file && nowMs - banlistStatHold.atMs < banlistStatHoldMs) {
      fileStamp = banlistStatHold.stamp;
      fileSize = banlistStatHold.size;
    } else {
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
      banlistStatHold = { file, atMs: nowMs, stamp: fileStamp, size: fileSize };
    }
  }
  const cacheKey = `${rawList}\0${file}\0${fileStamp}`;
  if (cacheKey === banlistCacheKey) return banlistCacheIndex;

  const terms = BUILT_IN_BANNED_NAME_TERMS.concat(parseBanlist(rawList));
  if (!file) {
    banlistFileReadOk = false;
    banlistCacheIndex = indexBannedTerms(terms);
    banlistCacheKey = cacheKey;
    return banlistCacheIndex;
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
    banlistFileReadOk = false;
    console.warn(
      `USERNAME_BANLIST_FILE (${file}) is ${fileSize} bytes, past the ${USERNAME_BANLIST_FILE_MAX_BYTES} byte ceiling; keeping the last good list`,
    );
  } else {
    try {
      banlistLastGoodFileTerms = parseBanlist(readBanlistBounded(file));
      banlistLastGoodFile = file;
      banlistFileReadOk = true;
      banlistFileReadOkFor = file;
    } catch (err) {
      banlistFileReadOk = false;
      console.warn(
        `could not read USERNAME_BANLIST_FILE (${file}); keeping the last good list:`,
        err,
      );
    }
  }
  const stale = banlistLastGoodFile === file ? banlistLastGoodFileTerms : [];
  banlistCacheIndex = indexBannedTerms(terms.concat(stale));
  banlistCacheKey = cacheKey;
  return banlistCacheIndex;
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
    hasBannedTerm(normalized, bannedUsernameTerms())
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
