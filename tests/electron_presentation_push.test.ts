import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Text pins for the 'desktop-presentation-changed' push. electron/*.cjs live
// outside tsc and outside every runnable suite (they need a real Electron main
// process), so these placement contracts can only be held by reading the
// sources, the same arrangement as tests/electron_gpu_push.test.ts.
const repoRoot = join(__dirname, '..');
const read = (rel: string) => readFileSync(join(repoRoot, rel), 'utf8');

const main = read('electron/main.cjs');
const preload = read('electron/preload.cjs');
const flat = (text: string) => text.replace(/\s+/g, ' ');

// Every placement pin below is bounded to one function body, so a match
// elsewhere in main.cjs cannot satisfy it.
const sendHelperBody = (): string => {
  const start = main.indexOf('function sendPresentationState()');
  expect(start, 'sendPresentationState is gone from electron/main.cjs').toBeGreaterThan(-1);
  const end = main.indexOf('\n}', start);
  expect(end, 'could not find the end of sendPresentationState').toBeGreaterThan(start);
  return main.slice(start, end + 2);
};

const createMainWindowBody = (): string => {
  const start = main.indexOf('function createMainWindow()');
  expect(start, 'createMainWindow is gone from electron/main.cjs').toBeGreaterThan(-1);
  const end = main.indexOf('function openDesktopLogin()', start);
  expect(end, 'could not find the end of createMainWindow').toBeGreaterThan(start);
  return main.slice(start, end);
};

describe('the window presentation push to the renderer', () => {
  it('pins the whole send helper: guard, live derive, reducer, then send', () => {
    // The derive is the contract. An event-written latch would strand the
    // renderer on a VISIBLE window after a single missed 'restore' (Electron's
    // restore events have WM-specific misfire history) with nothing able to
    // correct it; reading the live window means every later event heals it.
    // Pin the body verbatim, so neither the derive nor the guard polarity can
    // flip and no latch can creep back in between the lines.
    const body = flat(sendHelperBody());
    expect(body).toBe(
      'function sendPresentationState() { ' +
        'if (!mainWindow || mainWindow.isDestroyed()) return; ' +
        'const hidden = mainWindow.isMinimized() || !mainWindow.isVisible(); ' +
        // The display-sleep lease rides the same single derivation the
        // renderer is told about (phase 8); a second reading could disagree
        // with the push.
        'powerSave.setHidden(hidden); ' +
        'if (hidden && hiddenRederiveTimer === null) { ' +
        'hiddenRederiveTimer = setInterval(sendPresentationState, HIDDEN_REDERIVE_INTERVAL_MS); ' +
        '} else if (!hidden) clearHiddenRederiveTimer(); ' +
        'const presentationState = presentationStatePayload(hidden); ' +
        "mainWindow.webContents.send('desktop-presentation-changed', presentationState); }",
    );
    // No module-level latch anywhere: the whole point is that there is no second
    // copy of this state to go stale. (The re-derive timer HANDLE is not a
    // state copy: every tick re-reads the live window.)
    expect(main).not.toContain('presentationHidden');
  });

  it('arms a re-derive backstop while hidden, and tears it down on visible and on closed', () => {
    // A WM can make a window visible without emitting restore/show/focus
    // (phase 4 QA F2); the focus self-heal then needs a click. The backstop
    // bounds that stale-hidden window to one interval. It must be keyed on the
    // DERIVED value inside the one send helper (so the tick after an un-hide
    // disarms itself) and be cleared with the window, like the move debounce.
    const body = flat(sendHelperBody());
    expect(body).toContain('if (hidden && hiddenRederiveTimer === null)');
    expect(body).toContain('setInterval(sendPresentationState, HIDDEN_REDERIVE_INTERVAL_MS)');
    expect(body).toContain('else if (!hidden) clearHiddenRederiveTimer();');
    expect(main).toContain('const HIDDEN_REDERIVE_INTERVAL_MS = 15000;');
    // Exactly one arm site: the backstop cannot be re-armed from an event
    // handler where a missed clear would leak intervals.
    expect([...main.matchAll(/setInterval\(sendPresentationState/g)].length).toBe(1);
    // Torn down with its window, alongside the sibling timers.
    const closed = flat(main);
    expect(closed).toContain(
      "mainWindow.on('closed', () => { powerSave.setHidden(true); clearReadyToShowFallback(); clearMoveDisplayTimer(); clearBoundsSaveTimer(); clearHiddenRederiveTimer(); mainWindow = null; });",
    );
  });

  it('has exactly one send site, built through the reducer, never an inline literal', () => {
    expect(main).toContain("require('./presentation_events.cjs')");
    const body = sendHelperBody();
    // The payload argument must be a bare identifier (this regex refuses an
    // inline object literal), and that identifier must come from the reducer.
    const send = /webContents\.send\('desktop-presentation-changed', (\w+)\)/.exec(body);
    expect(send, 'the send does not pass a prebuilt payload').not.toBeNull();
    const arg = (send as RegExpExecArray)[1];
    expect(body).toContain(`const ${arg} = presentationStatePayload(`);
    expect(
      [...main.matchAll(/webContents\.send\('desktop-presentation-changed'/g)].length,
      'desktop-presentation-changed must have exactly one send site in main.cjs',
    ).toBe(1);
  });

  it('registers all five window events, including the focus self-heal', () => {
    // 'focus' is the recovery path, not decoration: restoring a window focuses
    // it, so even a WM that swallows 'restore' still clears a stale hidden on
    // the first click or alt-tab into the game. Losing it silently reintroduces
    // the frozen-HUD-on-a-visible-window failure.
    const body = flat(createMainWindowBody());
    for (const event of ['minimize', 'restore', 'hide', 'show', 'focus']) {
      expect(body, `the '${event}' presentation registration is missing`).toContain(
        `mainWindow.on('${event}', sendPresentationState);`,
      );
    }
  });

  it('re-pushes on did-finish-load without entangling the GPU flow', () => {
    // The channel has no replay: a reload or the crash-recovery page comes up
    // knowing nothing about whether its window is hidden.
    const body = flat(createMainWindowBody());
    expect(body).toContain(
      "mainWindow.webContents.on('did-finish-load', () => { sendPresentationState(); });",
    );
    // The GPU binding is a separate listener and keeps its own bare-identifier
    // shape (tests/electron_gpu_push.test.ts pins that it is the only one).
    expect(body).toContain("mainWindow.webContents.on('did-finish-load', logGpuStatus);");
  });

  it('the preload subscription shape-checks the payload and can unsubscribe', () => {
    const start = preload.indexOf('onPresentationChanged: (callback)');
    expect(start, 'preload is missing the onPresentationChanged bridge method').toBeGreaterThan(-1);
    const end = preload.indexOf('\n  },', start);
    expect(end).toBeGreaterThan(start);
    const body = preload.slice(start, end);
    expect(body).toContain("typeof callback !== 'function'");
    expect(body).toContain("typeof payload.hidden === 'boolean'");
    expect(body).toContain("ipcRenderer.on('desktop-presentation-changed', listener)");
    expect(body).toContain("ipcRenderer.removeListener('desktop-presentation-changed', listener)");
  });

  it('is push-only in BOTH directions: no invoke/handle, no send/on', () => {
    // The renderer-to-main direction is the one that historically forgets the
    // trustedSender gate, so pin its absence rather than trusting review.
    expect(preload).not.toContain("ipcRenderer.invoke('desktop-presentation-changed'");
    expect(main).not.toContain("ipcMain.handle('desktop-presentation-changed'");
    expect(preload).not.toContain("ipcRenderer.send('desktop-presentation-changed'");
    expect(main).not.toContain("ipcMain.on('desktop-presentation-changed'");
  });
});
