// @vitest-environment happy-dom

// Desktop OS notifications (src/game/desktop_notifications.ts). The decision
// half is pure and imported directly; the init half is driven through a stub
// bridge, with the away-gate's two inputs controlled independently (the shell's
// presentation latch, and document focus) so both arms of every gate are pinned.
// The English payload strings are asserted as literals, never through the same
// t() call the module makes, which would only compare the module to itself.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createDesktopNotifyCore,
  desktopNotifyOnSimEvents,
  initDesktopNotifications,
  shouldNotifyDesktop,
} from '../src/game/desktop_notifications';
import { initDesktopPresentation } from '../src/game/desktop_presentation';
import type {
  DesktopBridge,
  DesktopNotificationRequest,
  DesktopPresentationState,
  DesktopUpdateEvent,
} from '../src/runtime';
import type { SimEvent } from '../src/sim/types';
import type { UpdateToastState } from '../src/ui/desktop_update_view';

const LOCAL_PID = 7;
const realHasFocus = document.hasFocus.bind(document);
let focused = true;
let pushPresentation: (state: DesktopPresentationState) => void = () => {};

function setPlayer(env: { hidden: boolean; focused: boolean }): void {
  pushPresentation({ hidden: env.hidden });
  focused = env.focused;
}

function boot(options: { showNotification?: boolean; onUpdateEvent?: boolean } = {}) {
  const sent: DesktopNotificationRequest[] = [];
  let callback: (event: DesktopUpdateEvent) => void = () => {};
  const bridge = {
    showNotification:
      options.showNotification === false
        ? undefined
        : (request: DesktopNotificationRequest) => {
            sent.push(request);
          },
    onUpdateEvent:
      options.onUpdateEvent === false
        ? undefined
        : (cb: (event: DesktopUpdateEvent) => void) => {
            callback = cb;
            return () => {};
          },
  } as unknown as DesktopBridge;
  initDesktopNotifications(bridge);
  return { sent, fire: (event: DesktopUpdateEvent) => callback(event) };
}

const readyState = (version: string): UpdateToastState => ({
  mode: 'ready',
  version,
  percent: 100,
  dismissed: false,
  checkedOnce: true,
});

// A real SimEvent literal with no cast, so tsc binds the fixture to the union
// member: a renamed or dropped field reds this file, not just production.
const inviteEvent = (fields: { pid?: number; fromName: string }): SimEvent => ({
  type: 'partyInvite',
  fromPid: 2,
  fromName: fields.fromName,
  ...(fields.pid !== undefined ? { pid: fields.pid } : {}),
});

beforeEach(() => {
  document.hasFocus = () => focused;
  focused = true;
  const presentationBridge = {
    onPresentationChanged: (cb: (state: DesktopPresentationState) => void) => {
      pushPresentation = cb;
      return () => {};
    },
  } as unknown as DesktopBridge;
  initDesktopPresentation(presentationBridge);
});

afterEach(() => {
  document.hasFocus = realHasFocus;
});

describe('createDesktopNotifyCore party invites', () => {
  it('fires for an event with no pid at all (shape robustness: every real emission stamps one)', () => {
    const core = createDesktopNotifyCore();
    expect(core.partyInvite(inviteEvent({ fromName: 'Ayla' }), LOCAL_PID)).toEqual({
      name: 'Ayla',
    });
  });

  it('fires for an online event addressed to this player', () => {
    const core = createDesktopNotifyCore();
    expect(core.partyInvite(inviteEvent({ pid: LOCAL_PID, fromName: 'Ayla' }), LOCAL_PID)).toEqual({
      name: 'Ayla',
    });
  });

  it('ignores an event addressed to a different player', () => {
    const core = createDesktopNotifyCore();
    expect(
      core.partyInvite(inviteEvent({ pid: LOCAL_PID + 1, fromName: 'Ayla' }), LOCAL_PID),
    ).toBeNull();
  });

  it('ignores every other event type, even one addressed to this player', () => {
    const core = createDesktopNotifyCore();
    expect(
      core.partyInvite({ type: 'readyCheckStart', fromName: 'Ayla', pid: LOCAL_PID }, LOCAL_PID),
    ).toBeNull();
    expect(
      core.partyInvite(
        { type: 'guildInvite', fromName: 'Ayla', guildName: 'Oathsworn' },
        LOCAL_PID,
      ),
    ).toBeNull();
  });
});

describe('shouldNotifyDesktop', () => {
  it('counts the player as away whenever the window is hidden or unfocused', () => {
    expect(shouldNotifyDesktop({ hidden: true, focused: true })).toBe(true);
    expect(shouldNotifyDesktop({ hidden: false, focused: false })).toBe(true);
    expect(shouldNotifyDesktop({ hidden: true, focused: false })).toBe(true);
    expect(shouldNotifyDesktop({ hidden: false, focused: true })).toBe(false);
  });
});

describe('createDesktopNotifyCore update readiness', () => {
  it('fires on the transition into ready, carrying the version', () => {
    const core = createDesktopNotifyCore();
    expect(core.updateReady('downloading', readyState('0.38.0'))).toEqual({ version: '0.38.0' });
  });

  it('never fires for a state that is not ready', () => {
    const core = createDesktopNotifyCore();
    expect(
      core.updateReady('checking', {
        mode: 'downloading',
        version: '0.38.0',
        percent: 40,
        dismissed: false,
        checkedOnce: true,
      }),
    ).toBeNull();
  });

  it('does not re-fire while the card is already ready', () => {
    const core = createDesktopNotifyCore();
    expect(core.updateReady('ready', readyState('0.38.0'))).toBeNull();
  });

  it('stamps the version on a fire, so a second transition into it stays quiet', () => {
    const core = createDesktopNotifyCore();
    expect(core.updateReady('downloading', readyState('0.38.0'))).toEqual({ version: '0.38.0' });
    expect(core.updateReady('hidden', readyState('0.38.0'))).toBeNull();
  });

  it('fires again once a NEW version becomes ready', () => {
    const core = createDesktopNotifyCore();
    expect(core.updateReady('downloading', readyState('0.38.0'))).toEqual({ version: '0.38.0' });
    expect(core.updateReady('downloading', readyState('0.39.0'))).toEqual({ version: '0.39.0' });
  });

  it("fires exactly once for a ready state whose version is empty (a versionless 'downloaded')", () => {
    // The stated reason lastNotifiedVersion starts as null, not '': an update
    // event that never carried a version folds to version '' and still
    // deserves its one notification instead of colliding with the initial.
    const core = createDesktopNotifyCore();
    expect(core.updateReady('downloading', readyState(''))).toEqual({ version: '' });
    expect(core.updateReady('downloading', readyState(''))).toBeNull();
  });

  it('stays quiet for a newer version while the card is already ready', () => {
    // Documented consequence, accepted at phase 9 QA: a second update version
    // superseding an already-ready card re-surfaces the card silently but
    // never re-notifies, because prevMode is 'ready' for every later event in
    // the session's fold and the player's pending action (restart) is the
    // same either way.
    const core = createDesktopNotifyCore();
    expect(core.updateReady('downloading', readyState('0.38.0'))).toEqual({ version: '0.38.0' });
    expect(core.updateReady('ready', readyState('0.39.0'))).toBeNull();
  });
});

describe('initDesktopNotifications update trigger', () => {
  it('posts the update notification once the download lands while the player is away', () => {
    const { sent, fire } = boot();
    setPlayer({ hidden: true, focused: true });
    fire({ type: 'available', version: '0.38.0' });
    fire({ type: 'downloaded', version: '0.38.0' });
    expect(sent).toEqual([
      {
        kind: 'update-ready',
        title: 'Update 0.38.0 is ready',
        body: 'Restart World of ClaudeCraft to apply the update.',
      },
    ]);
  });

  it('posts the versionless title for a ready state with no version (no dangling space)', () => {
    // The '' version arm the core deliberately supports (a 'downloaded' event
    // that carried no version) must not render through the {version} slot,
    // which produced "Update  is ready"; it has its own key.
    const { sent, fire } = boot();
    setPlayer({ hidden: true, focused: true });
    fire({ type: 'downloaded' });
    expect(sent).toEqual([
      {
        kind: 'update-ready',
        title: 'Update is ready',
        body: 'Restart World of ClaudeCraft to apply the update.',
      },
    ]);
    expect(sent[0].title).not.toContain('  ');
  });

  it('posts nothing while the player is present: the card already tells them', () => {
    const { sent, fire } = boot();
    setPlayer({ hidden: false, focused: true });
    fire({ type: 'available', version: '0.38.0' });
    fire({ type: 'downloaded', version: '0.38.0' });
    expect(sent).toEqual([]);
  });

  it('posts nothing for the progress events leading up to the download', () => {
    const { sent, fire } = boot();
    setPlayer({ hidden: true, focused: false });
    fire({ type: 'checking' });
    fire({ type: 'available', version: '0.38.0' });
    fire({ type: 'progress', percent: 80 });
    expect(sent).toEqual([]);
  });

  it('is a total no-op on a shell without showNotification (older install, web build)', () => {
    const { sent, fire } = boot({ showNotification: false });
    setPlayer({ hidden: true, focused: false });
    fire({ type: 'downloaded', version: '0.38.0' });
    desktopNotifyOnSimEvents([inviteEvent({ fromName: 'Ayla' })], LOCAL_PID);
    expect(sent).toEqual([]);
  });

  it('keeps party invites working on a shell with notifications but no updater events', () => {
    // The older-shell split: showNotification exists, onUpdateEvent does not.
    // Arming happens before the update feature-check returns, so the invite
    // path must stay live while the update trigger is silently absent.
    const { sent, fire } = boot({ onUpdateEvent: false });
    setPlayer({ hidden: true, focused: false });
    expect(() => fire({ type: 'downloaded', version: '0.38.0' })).not.toThrow();
    desktopNotifyOnSimEvents([inviteEvent({ pid: LOCAL_PID, fromName: 'Ayla' })], LOCAL_PID);
    expect(sent).toEqual([
      { kind: 'party-invite', title: 'Party invite', body: 'Ayla invited you to a party.' },
    ]);
  });

  it('a second init tears down the previous update subscription (one live fold, one post)', () => {
    // The bridge multiplexes subscribers, so a re-init that discarded the
    // returned unsubscribe would leave the old closure's state fold live
    // beside the new one and double-post every update notification.
    const sent: DesktopNotificationRequest[] = [];
    const callbacks = new Set<(event: DesktopUpdateEvent) => void>();
    const bridge = {
      showNotification: (request: DesktopNotificationRequest) => {
        sent.push(request);
      },
      onUpdateEvent: (cb: (event: DesktopUpdateEvent) => void) => {
        callbacks.add(cb);
        return () => callbacks.delete(cb);
      },
    } as unknown as DesktopBridge;
    initDesktopNotifications(bridge);
    initDesktopNotifications(bridge);
    expect(callbacks.size).toBe(1);
    setPlayer({ hidden: true, focused: false });
    for (const cb of [...callbacks]) cb({ type: 'downloaded', version: '0.38.0' });
    expect(sent).toHaveLength(1);
  });

  it('posts nothing for a second version that lands while the card is already ready', () => {
    // 'ready' is terminal in the fold for a session (the premise the
    // away-gate ordering adjudication rests on): the second downloaded event
    // finds prevMode 'ready' and stays silent, while the card itself shows
    // the newer version.
    const { sent, fire } = boot();
    setPlayer({ hidden: true, focused: false });
    fire({ type: 'downloaded', version: '0.38.0' });
    expect(sent).toHaveLength(1);
    fire({ type: 'downloaded', version: '0.39.0' });
    expect(sent).toHaveLength(1);
  });
});

describe('desktopNotifyOnSimEvents', () => {
  it('posts a party invite while the player is away', () => {
    const { sent } = boot();
    setPlayer({ hidden: false, focused: false });
    desktopNotifyOnSimEvents([inviteEvent({ pid: LOCAL_PID, fromName: 'Ayla' })], LOCAL_PID);
    expect(sent).toEqual([
      { kind: 'party-invite', title: 'Party invite', body: 'Ayla invited you to a party.' },
    ]);
  });

  it('posts nothing while the player is present at the window', () => {
    const { sent } = boot();
    setPlayer({ hidden: false, focused: true });
    desktopNotifyOnSimEvents([inviteEvent({ pid: LOCAL_PID, fromName: 'Ayla' })], LOCAL_PID);
    expect(sent).toEqual([]);
  });

  it('posts one notification per invite in a frame, and nothing for other events', () => {
    const { sent } = boot();
    setPlayer({ hidden: true, focused: false });
    desktopNotifyOnSimEvents(
      [
        { type: 'readyCheckStart', fromName: 'Zev', pid: LOCAL_PID },
        inviteEvent({ pid: LOCAL_PID, fromName: 'Ayla' }),
        inviteEvent({ pid: LOCAL_PID + 1, fromName: 'Nym' }),
        inviteEvent({ fromName: 'Rin' }),
      ],
      LOCAL_PID,
    );
    expect(sent.map((request) => request.body)).toEqual([
      'Ayla invited you to a party.',
      'Rin invited you to a party.',
    ]);
  });

  it('is inert before composition arms it (the plain browser build)', () => {
    boot({ showNotification: false });
    setPlayer({ hidden: true, focused: false });
    expect(() =>
      desktopNotifyOnSimEvents([inviteEvent({ fromName: 'Ayla' })], LOCAL_PID),
    ).not.toThrow();
  });
});

describe('the main.ts frame wiring', () => {
  it('calls the sim-event scan at both event sites, from one import', () => {
    // A source pin, not a behavior proof: the deep proof is the desktop shell
    // smoke run. It exists because a scan wired into only one mode ships a
    // build where half the players never get an invite notification, so each
    // mode's argument form is pinned once: a second call inside one branch
    // cannot masquerade as the other mode's wiring. The online form carries
    // the spectator gate: a spectating session's net.playerId is the watched
    // player's pid, so without the gate their personal invites would notify
    // the spectator as if addressed to them.
    const source = readFileSync(join(__dirname, '../src/main.ts'), 'utf8');
    expect(source).toContain(
      "import { desktopNotifyOnSimEvents } from './game/desktop_notifications';",
    );
    expect(source.split('desktopNotifyOnSimEvents(events, offlineSim.playerId);').length - 1).toBe(
      1,
    );
    expect(
      source.split(
        'if (net.spectating === null) desktopNotifyOnSimEvents(drainedEvents, net.playerId);',
      ).length - 1,
    ).toBe(1);
    expect(source.split('desktopNotifyOnSimEvents(').length - 1).toBe(2);
  });
});
