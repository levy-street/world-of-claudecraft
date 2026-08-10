import { en_XA, pending, translations } from './i18n.resolved.generated';
import { LOCALE_LOADERS } from './i18n.resolved.generated/loaders';

// The admin dashboard's own i18n layer (overlay + registry + release-gate
// model). Operators are users, so ALL rendered admin text routes through t().
//
// DICT is the dense resolved admin table (the barrel of the
// src/admin/i18n.resolved.generated/ directory):
// every locale overlaid onto the flat English admin base (src/admin/i18n.en.ts)
// and filled from English, so every key always resolves. The SCANNER reads the
// SPARSE source (i18n.en + i18n.locales/*) to decide which keys are `pending`;
// this runtime reads the dense table. DICT is re-exported so the status-registry
// test keeps an unchanged consumer surface. The admin bundle stays SEPARATE - it
// imports its own resolved table only, never the game locale table (src/ui/i18n*).
export const DICT = translations as Record<string, Record<string, string>>;

const SUPPORTED = Object.keys(DICT);
let current = 'en';

// --- en_XA dev-only pseudo-locale (mirrors src/ui/i18n.ts) -------------
//
// Operators are users, so the admin dashboard gets the same literal-surfacing tool
// as the game. en_XA is the generated pseudo-locale (accent-pushed + bracketed `en`,
// {placeholders} preserved); it is NOT a member of `translations`/SUPPORTED, so it
// never enters the operator language list or the admin release gate. Selectable ONLY
// via ?lang=en_XA on a NON-RELEASE build; the import.meta.env.PROD guard in
// tableFor() tree-shakes the pseudo table out of the production admin bundle.
const DEV_PSEUDO_LOCALE = 'en_XA';
let pseudoActive = false;

function detect(): string {
  try {
    if (typeof window !== 'undefined' && window.location) {
      const q = new URLSearchParams(window.location.search).get('lang');
      // Dev-only pseudo-locale: flip the flag, keep the base locale at "en". Skipped
      // on a release build, so ?lang=en_XA degrades to the default for operators.
      if (q === DEV_PSEUDO_LOCALE && !isReleaseBuild()) {
        pseudoActive = true;
        return 'en';
      }
      if (q && SUPPORTED.includes(q)) return q;
    }
    if (typeof localStorage !== 'undefined') {
      const s = localStorage.getItem('locale');
      if (s && SUPPORTED.includes(s)) return s;
    }
  } catch {
    /* ignore */
  }
  return 'en';
}
current = detect();

export function adminLanguage(): string {
  return current;
}
// BCP-47 tag for the Intl APIs. The locale codes carry an underscore region
// (de_DE, zh_CN, ...), which Intl rejects with a RangeError, so normalize the
// separator to a hyphen (mirrors the game's languageTag in src/ui/i18n.ts).
// adminLanguage() still returns the raw code for DICT/t() lookups.
export function adminLanguageTag(): string {
  return current.replace('_', '-');
}
export function setAdminLanguage(lang: string): void {
  if (SUPPORTED.includes(lang)) {
    pseudoActive = false;
    current = lang;
  }
}

// --- async locale-load seam (parity with the game's ensureLocaleLoaded) ----------
//
// Admin keeps EVERY locale static (locked decision: the admin bundle is ~38 KB gzip and
// operators are not the mobile target), so DICT already carries every locale and this
// resolves instantly - the load body below is unreachable while admin stays static. The
// async surface is mirrored structurally so the admin bootstrap awaits the same shape as
// the game client; admin never performs the static->lazy flip.
const adminInflight = new Map<string, Promise<void>>();

export function isAdminLocaleResident(lang: string): boolean {
  return lang === 'en' || DICT[lang] !== undefined;
}

export async function ensureAdminLocaleLoaded(lang: string): Promise<void> {
  if (isAdminLocaleResident(lang)) return; // always true while admin stays static
  const existing = adminInflight.get(lang);
  if (existing) return existing; // coalesce onto the in-flight import
  const loader = (
    LOCALE_LOADERS as Record<string, (() => Promise<Record<string, unknown>>) | undefined>
  )[lang];
  if (!loader) return;
  const task = loader()
    .then((mod) => {
      // Shape-tolerant read mirroring src/ui/i18n.ts (default OR named export).
      DICT[lang] = ((mod as { default?: Record<string, string> }).default ??
        (mod as Record<string, Record<string, string>>)[lang]) as Record<string, string>;
      adminInflight.delete(lang);
    })
    .catch((err) => {
      adminInflight.delete(lang); // clear so a retry can start a fresh import
      if (!isReleaseBuild()) console.warn(`admin i18n: failed to load locale "${lang}"`, err);
      throw err;
    });
  adminInflight.set(lang, task);
  return task;
}

// --- release detection + the t() miss / pending policy (mirrors src/ui/i18n.ts) ---
//
// A non-release build (dev / vitest) MAY render English for a key the active
// locale has not translated yet (a registry-`pending` key): the dense table
// carries that English fill. A RELEASE build must NEVER do that - the release CI
// gate asserts the pending set is empty, and t() additionally hard-fails on a
// pending key as a never-fires backstop, so English can never silently ship to a
// translated operator. Release is detected via I18N_RELEASE=1 (tests/build) or
// import.meta.env.PROD (the real Vite admin build). Read lazily, on the cold path.
function isReleaseBuild(): boolean {
  try {
    if (typeof process !== 'undefined' && process.env && process.env.I18N_RELEASE === '1')
      return true;
  } catch {
    // No `process` (browser runtime) - fall through to the build-time flag.
  }
  try {
    return (import.meta as { env?: { PROD?: boolean } }).env?.PROD === true;
  } catch {
    return false;
  }
}

// Keys each locale has NOT translated (the resolved table English-fills them).
// PENDING_TOTAL lets the hot path skip the membership test when nothing is pending.
const PENDING_SETS: Record<string, ReadonlySet<string>> = {};
let PENDING_TOTAL = 0;
for (const [lang, keys] of Object.entries(pending)) {
  PENDING_SETS[lang] = new Set(keys);
  PENDING_TOTAL += keys.length;
}

// A key absent from the dense table is absent from the admin `en` base, so it is
// untracked by the registry. Throw in dev/test so a typo'd / never-registered key
// surfaces immediately; on an (already-gated) release build, degrade to the raw key
// rather than crash the operator's dashboard mid-render.
function onUntrackedKey(key: string): string {
  if (!isReleaseBuild()) {
    throw new Error(`admin i18n: untracked key "${key}" is not in the admin translation table`);
  }
  return key;
}

function interpolate(tmpl: string, params?: Record<string, string | number>): string {
  if (!params) return tmpl;
  return tmpl.replace(/\{([A-Za-z0-9_]+)\}/g, (m, name: string) => {
    const v = params[name];
    return v === undefined ? m : String(v);
  });
}

// The table the admin t() resolves against. Normally DICT[current]; the en_XA
// pseudo table only when the dev pseudo-locale is active. en_XA is referenced solely
// inside the !import.meta.env.PROD branch, so the production admin build tree-shakes
// it away.
function tableFor(lang: string): Record<string, string> {
  if (!import.meta.env.PROD && pseudoActive) return en_XA as Record<string, string>;
  return DICT[lang] ?? DICT.en;
}

export function t(key: string, params?: Record<string, string | number>): string {
  const table = tableFor(current);
  const tmpl = table[key];
  if (typeof tmpl !== 'string') return onUntrackedKey(key);
  if (PENDING_TOTAL > 0 && PENDING_SETS[current]?.has(key) && isReleaseBuild()) {
    throw new Error(
      `admin i18n: key "${key}" is untranslated (pending) for locale "${current}" on a release build; English must never ship to a translated operator`,
    );
  }
  return interpolate(tmpl, params);
}

// Server-sent operator-error bodies (server/admin.ts) mapped to localized admin
// strings. Unknown / transport / code-diagnostic errors fall through to English on
// purpose (the localization design principle: only operator-facing UI is translated).
// Exported for the tests/admin coupling guard: every server error prose a
// handler emits must have a row here, or an operator sees raw English.
export const ADMIN_ERROR_KEYS: Record<string, string> = {
  'too many attempts, wait a minute and try again': 'error.tooManyAttempts',
  'too many failed attempts, wait a few minutes and try again': 'error.tooManyFailedAttempts',
  'invalid username or password': 'error.invalidCredentials',
  'this account does not have admin access': 'error.noAdminAccess',
  'invalid authentication code': 'error.invalidTwoFactorCode',
  'admin accounts cannot be suspended or banned': 'error.cannotModerateAdmin',
  'open report not found': 'error.reportNotFound',
  'open bug report not found': 'error.bugReportNotFound',
  'account not found': 'error.accountNotFound',
  'account is not suspended': 'error.accountNotSuspended',
  'moderation action failed': 'error.moderationFailed',
  'force rename failed': 'error.forceRenameFailed',
  'chat mute failed': 'error.chatMuteFailed',
  'chat unmute failed': 'error.chatUnmuteFailed',
  'account is not chat muted': 'error.accountNotChatMuted',
  'moderation reason is required': 'error.moderationReasonRequired',
  'suspension expiry must be in the future': 'error.moderationExpiryFuture',
  'character not found': 'error.characterNotFound',
  'guild not found': 'error.guildNotFound',
  'guild name is already taken': 'error.guildNameTaken',
  'guild name must change': 'error.guildNameUnchanged',
  'a moderation reason is required (500 chars max)': 'error.guildReasonInvalid',
  'guild member limit exceeded': 'error.guildMemberLimit',
  // The guild bank dormant-slot escape hatch (server/admin.ts).
  'a slot index is required': 'error.guildBankSlotRequired',
  'the item id in that slot is required': 'error.guildBankItemRequired',
  'that guild has no loaded bank': 'error.guildBankNotLoaded',
  'no member of that guild is online to persist the change': 'error.guildBankNoCarrier',
  'that slot is not a stuck item': 'error.guildBankSlotNotStuck',
  'the change could not be saved and was rolled back': 'error.guildBankSaveFailed',
  'that guild is being deleted, so its bank is closed': 'error.guildBankDeleting',
  'the guild bank change was refused': 'error.guildBankPurgeRefused',
  'guild name must be 3-24 letters with single spaces': 'error.guildNameInvalid',
  // The guild list's 503 single-flight busy path (the one guild prose the
  // release left unmapped; surfaced by the merge-audit gate run). Mapped to
  // the same key the guild directory already renders for ANY failed list
  // read, so a localized operator sees exactly what the release shipped.
  'guild list busy, try again': 'guilds.loadFailed',
  'invalid streamer link': 'error.invalidStreamerLink',
  'admin accounts cannot be chat muted': 'error.cannotChatMuteAdmin',
  'tier must be "soft" or "hard"': 'error.invalidWordTier',
  'word is empty after normalization': 'error.wordEmptyAfterNormalization',
  'word not found': 'error.wordNotFound',
  'chat mute expiry must be in the future': 'error.chatMuteExpiryFuture',
  'a valid ip address is required': 'error.invalidIp',
  'block expiry must be in the future': 'error.blockExpiryFuture',
  'failed to block ip': 'error.blockFailed',
  'ip not found': 'error.blockNotFound',
  'you do not have permission to do this': 'error.missingPermission',
  'unknown role': 'error.staffUnknownRole',
  'superadmin roles are managed via the grant script': 'error.staffSuperadmin',
  'you cannot change your own roles': 'error.staffSelfEdit',
  'method not allowed': 'error.methodNotAllowed',
  'only a superadmin can reset a staff password': 'error.resetPasswordStaff',
  'password reset failed': 'error.resetPasswordFailed',
  'password must be at least 6 chars': 'error.passwordTooShort',
  'password must be at most 128 chars': 'error.passwordTooLong',
  // R35 GM professions tooling (inspector + restores).
  'character is not online on this realm': 'error.characterNotOnline',
  'unknown item id': 'error.unknownItemId',
  'count must be a whole number between 1 and 20': 'error.restoreCountRange',
  'unknown gathering profession id': 'error.unknownGatheringProfession',
  'unknown tool effect id': 'error.unknownToolEffect',
  'the character owns no tool for that profession': 'error.restoreNoTool',
  'that profession already has a slotted effect': 'error.restoreAlreadySlotted',
  // Pre-existing prose the phase 15 scan guard surfaced as unmatched.
  'an overrides object is required': 'error.antibotOverridesRequired',
  asset_not_found: 'error.assetNotFound',
  map_not_found: 'error.mapNotFound',
  'internal error': 'error.internal',
  'unknown admin endpoint': 'error.unknownEndpoint',
  'that effect cannot be slotted on that profession': 'error.restoreBadPair',
  'character went offline before the restore landed': 'error.restoreWentOffline',
  'item restore failed': 'error.restoreItemFailed',
  'slot restore failed': 'error.restoreSlotFailed',
  // Named-constant, multi-line, and `err.message ?? literal` fallback prose the
  // widened phase 15 scan guard surfaced (it now flattens the source, resolves
  // single-identifier arguments through server/admin.ts's own constants, and
  // reads the ternary fallback literal).
  'ai must be a boolean': 'error.aiFlagRequired',
  'streamer must be a boolean': 'error.streamerFlagRequired',
  'a links object is required': 'error.streamerLinksRequired',
  'failed to update account flair': 'error.accountFlairFailed',
  'a valid daily rewards date is required': 'error.dailyRewardDayRequired',
  'daily rewards moderation failed': 'error.dailyRewardsModerationFailed',
  'daily rewards ip moderation failed': 'error.dailyRewardsIpModerationFailed',
  'failed to add note': 'error.addNoteFailed',
  'chat strikes reset failed': 'error.chatStrikesResetFailed',
  'reactivation failed': 'error.reactivationFailed',
};
export function localizeAdminError(message: string): string {
  const key = ADMIN_ERROR_KEYS[message.trim().toLowerCase()];
  return key ? t(key) : message;
}

// Operator-facing class label for the dashboard tables/charts. The class id is the
// raw PlayerClass enum value (e.g. "mage"); render the localized name to match the
// game client. Unknown ids fall back to the raw id.
const CLASS_LABEL_IDS = new Set([
  'warrior',
  'paladin',
  'hunter',
  'rogue',
  'priest',
  'shaman',
  'mage',
  'warlock',
  'druid',
]);
export function classLabel(classId: string): string {
  return CLASS_LABEL_IDS.has(classId) ? t(`class.${classId}`) : classId;
}

// Operator-facing zone/dungeon label. The server sends the ENGLISH display name
// (server/game.ts: zoneAt(...).name / DUNGEONS[id].name); reverse-map it to the
// localized name so the dashboard matches the game client. Unknown names (e.g. a
// newly-added zone not yet in the dictionary) fall back to the raw name.
const ZONE_NAME_TO_KEY = new Map<string, string>();
for (const [key, value] of Object.entries(DICT.en)) {
  if (
    key.startsWith('zone.') ||
    key.startsWith('dungeon.') ||
    key.startsWith('delve.') ||
    key.startsWith('poi.')
  )
    ZONE_NAME_TO_KEY.set(value, key);
}
function knownLabel(key: string, fallback: string | null | undefined): string {
  return typeof DICT.en[key] === 'string' ? t(key) : (fallback ?? key);
}
export function zoneLabel(name: string): string {
  const key = ZONE_NAME_TO_KEY.get(name);
  return key ? t(key) : name;
}
export function zoneIdLabel(zoneId: string | null | undefined, fallback?: string | null): string {
  return zoneId ? knownLabel(`zone.${zoneId}`, fallback) : (fallback ?? t('common.emptyValue'));
}
export function dungeonIdLabel(id: string | null | undefined, fallback?: string | null): string {
  return id ? knownLabel(`dungeon.${id}`, fallback) : (fallback ?? t('common.emptyValue'));
}
export function delveIdLabel(id: string | null | undefined, fallback?: string | null): string {
  return id ? knownLabel(`delve.${id}`, fallback) : (fallback ?? t('common.emptyValue'));
}
export function poiLabel(
  zoneId: string | null | undefined,
  poiIndex: number | null | undefined,
  fallback?: string | null,
): string {
  return zoneId && poiIndex !== null && poiIndex !== undefined
    ? knownLabel(`poi.${zoneId}.${poiIndex}`, fallback)
    : (fallback ?? t('common.emptyValue'));
}
