// Thin painter for the post-login Welcome Screen (news, patch notes, Join our
// Discord strip, and the desktop-web Season 1 Armory promo). Cold window: it is
// shown once per login, so this follows the store_promo_card.ts / dialog_root.ts
// cold-path convention (raw DOM writes, not the per-frame PainterHost elider).
// Pure gating/badge/intent logic lives in ./welcome_screen_view; this module
// only resolves DOM refs, paints from that view, and wires callbacks.
import { appVersionInfo } from './app_version';
import { markDialogRoot } from './dialog_root';
import { discordInviteUrl } from './discord_status';
import { FocusManager, type FocusTrapHandle } from './focus_manager';
import { formatDateTime, t } from './i18n';
import {
  type NewsReleaseEntry,
  newsEmptyHtml,
  newsErrorHtml,
  newsLoadingHtml,
  renderWelcomeNews,
} from './news_feed';
import { mountStorePromoCard, type StorePromoCardController } from './store_promo_card';
import {
  buildWelcomeScreenView,
  consumeArmoryOpenIntent,
  markNewReleases,
  nextLastSeenReleaseId,
  setArmoryOpenIntent,
  type WelcomeChestInput,
  type WelcomeDiscordInput,
  type WelcomeNewsInput,
  type WelcomePlatformInput,
} from './welcome_screen_view';

const LAST_SEEN_RELEASE_KEY = 'woc.welcome.lastSeenReleaseId';
const GITHUB_RELEASES_URL = 'https://github.com/levy-street/world-of-claudecraft/releases';

// Shared trap for this one dialog root (same "dedicated FocusManager instance
// for a non-Hud dialog" pattern as src/ui/camera_prompt.ts): the Welcome Screen
// exists before Hud is constructed, so it cannot ride Hud.windowFocus().
const welcomeFocusManager = new FocusManager();

export interface WelcomeScreenHeader {
  characterName: string;
  level: number;
  className: string;
  realmName: string;
  lastPlayed: string | null;
}

export interface WelcomeScreenDeps {
  platform: WelcomePlatformInput;
  fetchReleases(): Promise<NewsReleaseEntry[]>;
  fetchArmoryPromoEnabled(): Promise<boolean>;
  fetchDiscord(): Promise<WelcomeDiscordInput>;
  fetchChest(): Promise<WelcomeChestInput>;
  header(): WelcomeScreenHeader | null;
  onContinue(): void;
  /** Mounts the desktop character stage into the given host; null when the
   *  stage cannot show (mobile, no live preview). Optional: absent = no stage. */
  mountStage?(container: HTMLElement): { release(): void } | null;
  /** Read/write the one-shot Armory-open intent; defaults to window.sessionStorage. */
  storage?: Storage;
}

export interface WelcomeScreenController {
  /** Shows the screen and kicks off the async news/discord/chest/flag reads. */
  show(): Promise<void>;
  hide(): void;
  /** Call when the online readiness condition changes (world.connected + player entity). */
  setConnectionReady(ready: boolean): void;
  destroy(): void;
}

function storageOrSession(storage?: Storage): Storage {
  return storage ?? window.sessionStorage;
}

/** Reads the persisted "last seen release" marker (localStorage; survives across sessions). */
function readLastSeenReleaseId(): number | null {
  const raw = window.localStorage.getItem(LAST_SEEN_RELEASE_KEY);
  const n = raw === null ? Number.NaN : Number(raw);
  return Number.isFinite(n) ? n : null;
}

function writeLastSeenReleaseId(id: number): void {
  window.localStorage.setItem(LAST_SEEN_RELEASE_KEY, String(id));
}

export function mountWelcomeScreen(
  root: HTMLElement,
  deps: WelcomeScreenDeps,
): WelcomeScreenController {
  const headerEl = root.querySelector<HTMLElement>('#ws-header');
  const newsEl = root.querySelector<HTMLElement>('#ws-news');
  const discordStripEl = root.querySelector<HTMLElement>('#ws-discord');
  const discordJoinBtn = root.querySelector<HTMLButtonElement>('#ws-discord-join');
  const armoryHost = root.querySelector<HTMLElement>('#ws-armory-card');
  const chestTileEl = root.querySelector<HTMLElement>('#ws-chest-tile');
  const statusEl = root.querySelector<HTMLElement>('#ws-status');
  const continueBtn = root.querySelector<HTMLButtonElement>('#ws-continue');
  const continueHintEl = root.querySelector<HTMLElement>('#ws-continue-hint');
  const versionEl = root.querySelector<HTMLElement>('#ws-version');
  const stageEl = root.querySelector<HTMLElement>('#ws-stage');

  markDialogRoot(root, { label: t('welcome.continue'), modal: true });

  // Touch platforms have no physical Enter/Esc keys: "Tap to continue" per the
  // layout spec's mobile/native paragraph. Re-target the element's data-i18n key
  // (not just its textContent) so a later language switch re-applies the RIGHT
  // key instead of translatePage() silently reverting it to the keyboard hint.
  if (continueHintEl && (deps.platform.mobileTouch || deps.platform.nativeApp)) {
    continueHintEl.setAttribute('data-i18n', 'welcome.continueHintTouch');
    continueHintEl.textContent = t('welcome.continueHintTouch');
  }

  let armoryCard: StorePromoCardController | null = null;
  let connectionReady = deps.platform.offline;
  let focusHandle: FocusTrapHandle | null = null;
  let stageHandle: { release(): void } | null = null;

  function paintHeader(): void {
    const h = deps.header();
    if (!headerEl) return;
    if (!h) {
      headerEl.textContent = '';
      return;
    }
    const when = h.lastPlayed
      ? formatDateTime(new Date(h.lastPlayed), { dateStyle: 'medium' })
      : '';
    headerEl.textContent = '';
    const title = document.createElement('div');
    title.className = 'ws-welcome-back';
    title.textContent = t('welcome.back', { name: h.characterName });
    const meta = document.createElement('div');
    meta.className = 'ws-header-meta';
    meta.textContent = [
      t('welcome.level', { level: h.level }),
      h.className,
      h.realmName,
      when ? t('welcome.lastPlayed', { when }) : '',
    ]
      .filter(Boolean)
      .join(' · ');
    headerEl.append(title, meta);
  }

  function paintStatus(): void {
    if (!statusEl) return;
    statusEl.textContent = '';
    if (connectionReady) return;
    const spin = document.createElement('span');
    spin.className = 'ws-spin';
    spin.setAttribute('aria-hidden', 'true');
    statusEl.append(spin, document.createTextNode(t('loading.connectingRealm')));
  }

  function refreshContinue(): void {
    if (!continueBtn) return;
    continueBtn.disabled = !connectionReady;
  }

  function setConnectionReady(ready: boolean): void {
    connectionReady = ready || deps.platform.offline;
    paintStatus();
    refreshContinue();
  }

  function paintDiscordStrip(show: boolean): void {
    if (!discordStripEl) return;
    discordStripEl.hidden = !show;
  }

  function paintChestTile(show: boolean): void {
    if (!chestTileEl) return;
    chestTileEl.hidden = !show;
  }

  function paintArmoryCard(show: boolean): void {
    if (!armoryHost) return;
    if (!show) {
      armoryCard?.dismiss();
      armoryCard = null;
      armoryHost.hidden = true;
      return;
    }
    armoryHost.hidden = false;
    if (armoryCard) return;
    armoryCard = mountStorePromoCard(armoryHost, {
      labels: {
        open: t('hudChrome.wocStore.title'),
        close: t('hudChrome.wocStore.close'),
        season: t('hudChrome.wocStore.seasonOne'),
        title: t('hudChrome.wocStore.armoryTitle'),
        cta: t('welcome.armory.cta'),
      },
      returnFocusTo: () => continueBtn,
      onOpenStore: () => setArmoryOpenIntent(storageOrSession(deps.storage)),
    });
  }

  function paintVersion(): void {
    if (!versionEl) return;
    // Same format as the homepage footer's syncBuildInfo (src/main.ts): plain
    // "v<version> · build <id>", not routed through t() there either.
    const { version, build } = appVersionInfo();
    versionEl.textContent = `v${version} · build ${build}`;
  }

  /**
   * Fetches releases and paints the compact Welcome Screen news column (latest
   * expanded with a NEW badge, older releases collapsed, capped at 5, "View all
   * updates on GitHub" link). Also advances the last-seen marker and keeps
   * newsState in sync for buildWelcomeScreenView's own feed-state tracking.
   */
  async function loadWelcomeNews(newsState: WelcomeNewsInput): Promise<void> {
    if (!newsEl) return;
    newsEl.innerHTML = newsLoadingHtml();
    let releases: NewsReleaseEntry[];
    try {
      releases = await deps.fetchReleases();
    } catch {
      newsState.state = 'failed';
      newsEl.innerHTML = newsErrorHtml();
      return;
    }
    newsState.state = 'loaded';
    newsState.releases = releases.map((r) => ({
      id: r.id,
      tag: r.tag,
      name: r.name,
      publishedAt: r.publishedAt,
    }));
    const lastSeen = readLastSeenReleaseId();
    const next = nextLastSeenReleaseId(releases, lastSeen);
    if (next !== null) writeLastSeenReleaseId(next);
    if (releases.length === 0) {
      newsEl.innerHTML = newsEmptyHtml();
      return;
    }
    newsEl.innerHTML = renderWelcomeNews(markNewReleases(releases, lastSeen), GITHUB_RELEASES_URL);
  }

  discordJoinBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    window.open(discordInviteUrl(), '_blank', 'noopener,noreferrer');
  });

  continueBtn?.addEventListener('click', () => {
    if (continueBtn.disabled) return;
    deps.onContinue();
  });

  function onKeydown(e: KeyboardEvent): void {
    if (root.hidden) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      deps.onContinue();
    } else if (e.key === 'Enter' && !(continueBtn?.disabled ?? true)) {
      e.preventDefault();
      deps.onContinue();
    }
  }
  root.addEventListener('keydown', onKeydown);

  async function show(): Promise<void> {
    root.hidden = false;
    if (stageEl && deps.mountStage && !stageHandle) {
      stageHandle = deps.mountStage(stageEl);
    }
    paintHeader();
    setConnectionReady(deps.platform.offline);
    // Focus trap: same shared-FocusManager convention as every other dialog
    // root (camera_prompt.ts). focusFirst() defers a tick and skips disabled
    // controls itself, so it correctly lands on the first REAL focusable
    // element (Continue starts disabled online, so a raw continueBtn.focus()
    // was a silent no-op there before this).
    focusHandle = welcomeFocusManager.open({ root: () => root });
    focusHandle.focusFirst();

    const newsState: WelcomeNewsInput = { state: 'loading', releases: [] };
    void loadWelcomeNews(newsState);

    const [armoryEnabled, discord, chest] = await Promise.all([
      deps.platform.offline
        ? Promise.resolve(false)
        : deps.fetchArmoryPromoEnabled().catch(() => false),
      deps.platform.offline
        ? Promise.resolve<WelcomeDiscordInput>({
            enabled: null,
            linked: null,
            guildMember: null,
            fetchFailed: false,
          })
        : deps.fetchDiscord().catch(
            (): WelcomeDiscordInput => ({
              enabled: null,
              linked: null,
              guildMember: null,
              fetchFailed: true,
            }),
          ),
      deps.platform.offline
        ? Promise.resolve<WelcomeChestInput>({ ready: false, unknown: true })
        : deps.fetchChest().catch((): WelcomeChestInput => ({ ready: false, unknown: true })),
    ]);

    const view = buildWelcomeScreenView(
      deps.platform,
      newsState,
      discord,
      chest,
      { ready: connectionReady, offline: deps.platform.offline },
      armoryEnabled,
      readLastSeenReleaseId(),
    );
    paintDiscordStrip(view.showDiscordStrip);
    paintChestTile(view.showChestTile);
    paintArmoryCard(view.showArmoryCard);
  }

  function hide(): void {
    root.hidden = true;
    focusHandle?.release();
    focusHandle = null;
  }

  function destroy(): void {
    root.removeEventListener('keydown', onKeydown);
    focusHandle?.release();
    focusHandle = null;
    armoryCard?.dismiss();
    armoryCard = null;
    stageHandle?.release();
    stageHandle = null;
  }

  paintVersion();

  return { show, hide, setConnectionReady, destroy };
}

/** Reads and clears the one-shot Armory-open intent (call once the HUD/store exist). */
export function takeArmoryOpenIntent(storage?: Storage): boolean {
  return consumeArmoryOpenIntent(storageOrSession(storage));
}
