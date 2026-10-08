// The client bootstrap junction: account transport, local preference stores and
// the migration dialog meet here, before any game subsystem reads its settings.
import { classifyAccountSettingsDevice } from './game/account_settings_device_core';
import { refreshAccountSettingsRuntime } from './game/account_settings_runtime';
import {
  applyAccountSettings,
  readPendingAccountSettings,
  snapshotAccountSettings,
  startAccountSettingsSync,
} from './game/account_settings_sync';
import { AccountSettingsClient } from './net/account_settings';
import type { RealmDirectory, RealmEntry } from './net/online';
import { showAccountSettingsNotice } from './ui/account_settings_notice_controller';
import { ensureLocaleLoaded, isSupportedLanguage, setLanguage } from './ui/i18n';
import { CONTENT_LOCALE_CHANNEL_ENSURERS } from './ui/locale_channels';

interface SettingsSession {
  token: string | null;
  base: string;
}

let acknowledgedSession: { token: string; accountId: number } | null = null;
let acknowledgement: { token: string; promise: Promise<number> } | null = null;
let settingsSync: ReturnType<typeof startAccountSettingsSync> | null = null;
let reportSaveError: (error: unknown) => void = (error) =>
  console.warn('[account-settings] save failed', error);

export function setAccountSettingsSaveErrorReporter(reporter: (error: unknown) => void): void {
  reportSaveError = reporter;
}

/** Every login path, including restored sessions, awaits this before character selection. */
export async function ensureAccountSettingsAcknowledged(session: SettingsSession): Promise<number> {
  const token = session.token;
  if (!token) throw new Error('Account settings require an authenticated session');
  if (acknowledgedSession?.token === token) return acknowledgedSession.accountId;
  if (acknowledgement?.token === token) return acknowledgement.promise;
  const client = new AccountSettingsClient(token, session.base);
  const promise = (async () => {
    const status = await client.status();
    if (!status.acknowledged) await showAccountSettingsNotice(() => client.acknowledge());
    if (session.token !== token) throw new Error('Account changed during settings acknowledgement');
    acknowledgedSession = { token, accountId: status.accountId };
    return status.accountId;
  })();
  acknowledgement = { token, promise };
  try {
    return await promise;
  } finally {
    if (acknowledgement?.promise === promise) acknowledgement = null;
  }
}

/** The selected character provides the seed, and an existing device profile always wins. */
export async function prepareAccountSettings(
  session: SettingsSession,
  characterId: number,
): Promise<void> {
  const accountId = await ensureAccountSettingsAcknowledged(session);
  const token = session.token;
  if (!token) throw new Error('Account settings require an authenticated session');
  const deviceType = classifyAccountSettingsDevice({
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    maxTouchPoints: navigator.maxTouchPoints,
    screenWidth: screen.width,
    screenHeight: screen.height,
  });
  const client = new AccountSettingsClient(token, session.base);
  const journalKey = `woc_account_settings_pending:${accountId}:${deviceType}`;
  const pending = readPendingAccountSettings(localStorage, journalKey);
  const entries = await client.initialize(
    deviceType,
    characterId,
    snapshotAccountSettings(localStorage, characterId),
  );
  if (session.token !== token) throw new Error('Account changed during settings initialization');
  settingsSync?.stop();
  applyAccountSettings(localStorage, pending ?? entries);
  const storedLanguage = localStorage.getItem('locale');
  const language = storedLanguage && isSupportedLanguage(storedLanguage) ? storedLanguage : 'en';
  await Promise.all([
    ensureLocaleLoaded(language),
    ...CONTENT_LOCALE_CHANNEL_ENSURERS.map((ensure) => ensure(language)),
  ]);
  if (session.token !== token) throw new Error('Account changed during language loading');
  setLanguage(language);
  document.dispatchEvent(new CustomEvent('woc:languagechange', { detail: { language } }));
  settingsSync = startAccountSettingsSync({
    storage: localStorage,
    eventTarget: window,
    journalKey,
    initialPending: pending ?? undefined,
    save: (snapshot, keepalive) => client.save(deviceType, snapshot, keepalive),
    onError: (error) => reportSaveError(error),
  });
  refreshAccountSettingsRuntime();
  if (pending) await settingsSync.flush();
}

/** Explicit logout waits for pending edits before tearing down the page. */
export async function flushAccountSettings(): Promise<void> {
  await settingsSync?.flush();
}

// Existing realm-entry behavior extracted from main.ts to keep it a thin bootstrap.
export async function enterAccountRealmFlow(
  api: SettingsSession & { username: string | null; realms(): Promise<RealmDirectory> },
  hooks: { selectRealm(entry: RealmEntry): void; showRealmList(directory: RealmDirectory): void },
): Promise<void> {
  await ensureAccountSettingsAcknowledged(api);
  const dir = await api.realms();
  const user = document.getElementById('realm-list-user');
  if (user) user.textContent = api.username ?? '';
  const remembered = localStorage.getItem('woc_last_realm');
  const auto = dir.realms.find((entry) => entry.name === remembered);
  if (auto) hooks.selectRealm(auto);
  else hooks.showRealmList(dir);
}
