// OS notifications posted through the desktop shell: the player alt-tabbed away
// (or minimized the window) and something happened that is worth pulling them
// back for. Two triggers today: a downloaded update becoming restart-ready, and
// an incoming party invite.
//
// Lives in src/game so main.ts stays a firewall and so the decision half stays
// DOM-free and directly Node-testable (tests/desktop_notifications.test.ts).
// The module-scope armed latch mirrors src/game/desktop_gpu_status.ts: the sim
// event path calls a plain module function that no-ops until composition armed
// it, so neither the web build nor an older shell pays anything per frame.

import type { DesktopBridge, DesktopNotificationRequest, DesktopUpdateEvent } from '../runtime';
import type { SimEvent } from '../sim/types';
import {
  INITIAL_UPDATE_TOAST_STATE,
  reduceUpdateToast,
  type UpdateToastState,
} from '../ui/desktop_update_view';
import { t } from '../ui/i18n';
import { desktopPresentationHidden } from './desktop_presentation';

export interface DesktopNotifyCore {
  partyInvite(event: SimEvent, localPid: number): { name: string } | null;
  updateReady(
    prevMode: UpdateToastState['mode'],
    state: UpdateToastState,
  ): { version: string } | null;
}

/**
 * The pure decision half: what deserves a notification, independent of whether
 * one can be posted right now. Stateful only in the once-per-version memory the
 * update trigger needs, so each core instance is one session's worth of memory.
 */
export function createDesktopNotifyCore(): DesktopNotifyCore {
  // null, not '', so a 'downloaded' event that carries no version still gets its
  // one notification instead of colliding with the initial value.
  let lastNotifiedVersion: string | null = null;
  return {
    partyInvite(event, localPid) {
      if (event.type !== 'partyInvite') return null;
      // The hud's per-event addressing gate, mirrored exactly (see the
      // `ev.pid !== undefined && ev.pid !== sim.playerId` skip in
      // src/ui/hud.ts handleEvents). Every real emission stamps a pid
      // (src/sim/social/party.ts): offline it equals the local player's id,
      // online the server routes each event to its addressee. The undefined
      // arm is shape robustness, not the offline case.
      if (event.pid !== undefined && event.pid !== localPid) return null;
      return { name: event.fromName };
    },
    updateReady(prevMode, state) {
      if (prevMode === 'ready' || state.mode !== 'ready') return null;
      if (state.version === lastNotifiedVersion) return null;
      lastNotifiedVersion = state.version;
      return { version: state.version };
    },
  };
}

/**
 * Whether the player is away from the game right now. Hidden-ness cannot come
 * from document.hidden: the shell window is created with backgroundThrottling
 * disabled, so the Page Visibility API reports 'visible' even while minimized
 * (src/game/desktop_presentation.ts). A visible but unfocused window still
 * counts as away: the player is looking at another app on top of it.
 */
export function shouldNotifyDesktop(env: { hidden: boolean; focused: boolean }): boolean {
  return env.hidden || !env.focused;
}

// Armed by initDesktopNotifications, and only on a shell that can post at all.
let send: ((request: DesktopNotificationRequest) => void) | null = null;
let core: DesktopNotifyCore | null = null;
// The previous init's update subscription, torn down on re-init so a stale
// closure's state fold cannot double-notify beside the new one (the same
// fresh-boot reset shape as initGpuNotice's applyShellVerdict).
let unsubscribeUpdates: (() => void) | null = null;

function playerIsAway(): boolean {
  return shouldNotifyDesktop({ hidden: desktopPresentationHidden(), focused: document.hasFocus() });
}

/**
 * Compose the notification triggers onto the bridge. A no-op on any bridge
 * without showNotification (older installed shell, or the plain browser build),
 * which leaves the latch disarmed and the frame path free.
 */
export function initDesktopNotifications(bridge: DesktopBridge): void {
  // Before the capability checks, so even an init that then disarms (older
  // shell) still leaves no previous subscription live.
  unsubscribeUpdates?.();
  unsubscribeUpdates = null;
  send = null;
  core = null;
  const notify = bridge.showNotification;
  if (typeof notify !== 'function') return;
  send = (request: DesktopNotificationRequest) => {
    notify.call(bridge, request);
  };
  core = createDesktopNotifyCore();

  const subscribe = bridge.onUpdateEvent;
  if (typeof subscribe !== 'function') return;
  // A second, independent subscription alongside the update card's own: the
  // bridge multiplexes subscribers, and this side must not reach into the
  // card's DOM module for state it can fold itself.
  let state = INITIAL_UPDATE_TOAST_STATE;
  const unsubscribe = subscribe.call(bridge, (event: DesktopUpdateEvent) => {
    const prevMode = state.mode;
    state = reduceUpdateToast(state, event);
    // The away gate runs BEFORE the core, so an update that lands while the
    // player is present never stamps its version: the card is on screen at that
    // moment and has already told them. The once-per-version memory lives in
    // this composition (never on disk) and 'ready' is terminal in the fold, so
    // the order is not observable in any reachable scenario; gate-first keeps
    // the stamp meaning "a notification was actually posted".
    if (!playerIsAway()) return;
    const ready = core?.updateReady(prevMode, state);
    if (!ready) return;
    send?.({
      kind: 'update-ready',
      // The '' version arm is deliberate core behavior (a 'downloaded' event
      // that carried no version): it gets its own key rather than rendering
      // a dangling "Update  is ready" through the {version} slot.
      title: ready.version
        ? t('desktop.notify.updateReadyTitle', { version: ready.version })
        : t('desktop.notify.updateReadyTitleNoVersion'),
      body: t('desktop.notify.updateReadyBody'),
    });
  });
  // Retained so the next init tears this closure down instead of leaving two
  // folds subscribed; a shell whose subscribe returns nothing keeps the null.
  unsubscribeUpdates = typeof unsubscribe === 'function' ? unsubscribe : null;
}

/**
 * Scan one frame's sim events for anything worth a notification. Called from
 * the frame path in both modes, so it early-outs before touching anything and
 * allocates only on a matching invite, never on the empty-batch or no-match
 * frames. (tests/client_frame_allocations.test.ts scans the caller, src/main.ts
 * frame(), not this module; the per-match allocation here is the notification
 * itself, off the steady-state path.)
 * Deliberately unthrottled: each invite is a discrete act by another player.
 */
export function desktopNotifyOnSimEvents(events: readonly SimEvent[], localPid: number): void {
  if (send === null || core === null || events.length === 0) return;
  for (let i = 0; i < events.length; i++) {
    const invite = core.partyInvite(events[i], localPid);
    if (invite === null) continue;
    if (!playerIsAway()) continue;
    send({
      kind: 'party-invite',
      title: t('desktop.notify.partyInviteTitle'),
      body: t('desktop.notify.partyInviteBody', { name: invite.name }),
    });
  }
}
