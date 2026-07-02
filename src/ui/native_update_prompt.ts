import {
  checkNativeAppUpdate,
  type NativeUpdateStatus,
  openNativeAppUpdate,
} from '../net/native_app_update';
import { NATIVE_APP } from '../net/online';
import { t } from './i18n';

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const INITIAL_CHECK_DELAY_MS = 12_000;
const NOT_NOW_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const LAST_CHECK_KEY = 'woc.nativeUpdate.lastCheckAt';
const DISMISSED_KEY = 'woc.nativeUpdate.dismissed';

let checkInFlight = false;
let dialogOpen = false;

function storageGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function storageSet(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage can be unavailable in private or locked-down native web views.
  }
}

function nowMs(): number {
  return Date.now();
}

function dismissedUntil(status: NativeUpdateStatus): number {
  const raw = storageGet(DISMISSED_KEY);
  if (!raw) return 0;
  try {
    const parsed = JSON.parse(raw) as { version?: unknown; until?: unknown };
    if (parsed.version !== promptVersionKey(status) || typeof parsed.until !== 'number') return 0;
    return parsed.until;
  } catch {
    return 0;
  }
}

function promptVersionKey(status: NativeUpdateStatus): string {
  return status.storeVersion || status.storeUrl || status.platform;
}

function markDismissed(status: NativeUpdateStatus): void {
  storageSet(
    DISMISSED_KEY,
    JSON.stringify({ version: promptVersionKey(status), until: nowMs() + NOT_NOW_COOLDOWN_MS }),
  );
}

function shouldPrompt(status: NativeUpdateStatus): boolean {
  return status.available && dismissedUntil(status) <= nowMs();
}

function removeDialog(root: HTMLElement): void {
  dialogOpen = false;
  root.remove();
}

function showUpdateDialog(status: NativeUpdateStatus): void {
  if (dialogOpen) return;
  dialogOpen = true;

  const root = document.createElement('div');
  root.className = 'native-update-backdrop';
  root.setAttribute('role', 'presentation');

  const dialog = document.createElement('div');
  dialog.className = 'panel native-update-dialog';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', 'native-update-title');
  dialog.setAttribute('aria-describedby', 'native-update-body');

  const title = document.createElement('div');
  title.id = 'native-update-title';
  title.className = 'native-update-title';
  title.textContent = t('hudChrome.nativeUpdate.title');

  const body = document.createElement('div');
  body.id = 'native-update-body';
  body.className = 'native-update-body';
  body.textContent = status.storeVersion
    ? t('hudChrome.nativeUpdate.bodyWithVersion', { version: status.storeVersion })
    : t('hudChrome.nativeUpdate.body');

  const actions = document.createElement('div');
  actions.className = 'native-update-actions';

  const later = document.createElement('button');
  later.type = 'button';
  later.className = 'btn native-update-later';
  later.textContent = t('hudChrome.nativeUpdate.notNow');
  later.addEventListener('click', () => {
    markDismissed(status);
    removeDialog(root);
  });

  const update = document.createElement('button');
  update.type = 'button';
  update.className = 'btn native-update-cta';
  update.textContent = t('hudChrome.nativeUpdate.update');
  update.addEventListener('click', () => {
    void openNativeAppUpdate(status.storeUrl).catch((err) => {
      console.warn('[native-update] failed to open store update', err);
    });
  });

  actions.append(later, update);
  dialog.append(title, body, actions);
  root.append(dialog);
  document.body.append(root);

  window.setTimeout(() => update.focus(), 0);
}

async function runUpdateCheck(currentVersion: string, force = false): Promise<void> {
  if (checkInFlight || !NATIVE_APP) return;
  const lastCheck = Number(storageGet(LAST_CHECK_KEY) || '0');
  if (!force && Number.isFinite(lastCheck) && nowMs() - lastCheck < CHECK_INTERVAL_MS) return;

  checkInFlight = true;
  storageSet(LAST_CHECK_KEY, String(nowMs()));
  try {
    const status = await checkNativeAppUpdate(currentVersion);
    if (status && shouldPrompt(status)) showUpdateDialog(status);
  } catch (err) {
    console.warn('[native-update] update check failed', err);
  } finally {
    checkInFlight = false;
  }
}

export function scheduleNativeUpdateCheck(currentVersion: string): void {
  if (!NATIVE_APP) return;
  window.setTimeout(() => void runUpdateCheck(currentVersion), INITIAL_CHECK_DELAY_MS);
  window.setInterval(() => void runUpdateCheck(currentVersion), CHECK_INTERVAL_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void runUpdateCheck(currentVersion);
  });
}
