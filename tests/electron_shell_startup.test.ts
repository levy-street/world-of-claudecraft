import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { stripComments } from './helpers/strip_comments';

const raw = readFileSync(join(__dirname, '..', 'electron', 'main.cjs'), 'utf8');

// Strip comments before matching via the shared single-pass helper
// (tests/helpers/strip_comments.ts), so a commented-out line never satisfies
// a positive pin and a bare /* inside a line comment cannot open a phantom
// block. Its colon guard keeps main.cjs's real scheme literals (`app://`,
// `${deepLinkProtocol}://`) intact.
const code = stripComments(raw);

const count = (haystack: string, needle: string) => haystack.split(needle).length - 1;

// Slice from an opening anchor to the first line that closes at the given
// indent, so every pin below scans a bounded region (one handler, one function)
// rather than the whole file, where an unrelated match could satisfy it.
function block(from: string, close: string, label: string): string {
  const start = code.indexOf(from);
  expect(start, `${label}: anchor "${from}" not found in main.cjs`).toBeGreaterThan(-1);
  const end = code.indexOf(close, start);
  expect(end, `${label}: unterminated block after "${from}"`).toBeGreaterThan(start);
  return code.slice(start, end);
}

// electron/main.cjs is the Electron entry and cannot run under vitest, so the
// shell startup wiring is pinned as text (same rationale as the app:// scheme,
// updater, and gpu pins). All three behaviors here fail SILENTLY when lost: a
// dropped show:false shows an unpainted frame, a dropped fallback timer leaves
// a wedged renderer windowless, a dropped second-instance focus makes a second
// launch look like nothing happened, and a dropped platform guard on the menu
// would strip macOS of its copy/paste/quit accelerators. None of that reds a
// runtime test.
describe('shell startup polish pins (electron/main.cjs)', () => {
  it('creates the one window hidden, keeping the dark backgroundColor', () => {
    expect(count(code, 'new BrowserWindow('), 'expected exactly one BrowserWindow').toBe(1);
    const options = block('new BrowserWindow({', '\n  });', 'BrowserWindow options');
    // Whole-line matches: `show: falseish` or a trailing-expression form must
    // not satisfy either pin.
    expect(/^\s*show: false,$/m.test(options), 'window must be created with show: false').toBe(
      true,
    );
    expect(
      /^\s*backgroundColor: '#05070a',$/m.test(options),
      'the dark backgroundColor must survive the hidden-window change',
    ).toBe(true);
  });

  it('shows the window on ready-to-show and clears the fallback there', () => {
    expect(count(code, "once('ready-to-show'"), 'expected one ready-to-show registration').toBe(1);
    const handler = block("mainWindow.once('ready-to-show'", '\n  });', 'ready-to-show handler');
    expect(handler, 'ready-to-show must disarm the fallback timer').toContain(
      'clearReadyToShowFallback();',
    );
    expect(handler, 'ready-to-show must show the window').toContain('showMainWindow();');
  });

  it('shows once: only a live, still-hidden window, via a captured instance', () => {
    // The helpers act on the captured `win`, never the module-level mainWindow:
    // createMainWindow can run again (macOS activate), and a stale timer must
    // not act on a successor window.
    expect(/^\s*const win = mainWindow;$/m.test(code), 'the window must be captured').toBe(true);
    const helper = block('const showMainWindow = () => {', '\n  };', 'showMainWindow');
    expect(helper, 'show helper must skip a destroyed window').toContain('win.isDestroyed()');
    expect(helper, 'show helper must skip an already visible window').toContain('win.isVisible()');
    expect(helper, 'show helper must actually show the window').toContain('win.show();');
    expect(helper, 'show helper must not read the reassignable module binding').not.toContain(
      'mainWindow.',
    );
  });

  it('arms a 4000 ms fallback that shows the window and warns', () => {
    expect(
      /^const READY_TO_SHOW_FALLBACK_MS = 4000;$/m.test(code),
      'the fallback timeout must be a top-level named 4000 ms constant',
    ).toBe(true);
    const timerStart = code.indexOf('let readyToShowFallback = setTimeout(');
    expect(timerStart, 'fallback timer not armed with setTimeout').toBeGreaterThan(-1);
    // Ends the slice on the delay argument itself, so a literal delay in place
    // of the constant fails the pin instead of passing it.
    const timerEnd = code.indexOf('}, READY_TO_SHOW_FALLBACK_MS);', timerStart);
    expect(
      timerEnd,
      'the fallback timer must be armed with READY_TO_SHOW_FALLBACK_MS',
    ).toBeGreaterThan(timerStart);
    const timerBody = code.slice(timerStart, timerEnd);
    expect(timerBody, 'the fallback must show the window through the show-once helper').toContain(
      'showMainWindow()',
    );
    expect(timerBody, 'the fallback must record that it fired').toContain('log.warn(');
  });

  it('never lets a fallback timer outlive its window', () => {
    const clear = block('const clearReadyToShowFallback = () => {', '\n  };', 'clear helper');
    expect(clear, 'the clear helper must call clearTimeout').toContain(
      'clearTimeout(readyToShowFallback);',
    );
    const closed = block("mainWindow.on('closed'", '\n  });', 'closed handler');
    expect(closed, "the 'closed' handler must clear the fallback timer").toContain(
      'clearReadyToShowFallback();',
    );
    expect(closed, "the 'closed' handler must still drop the window reference").toContain(
      'mainWindow = null;',
    );
  });

  it('focuses the running window on second-instance before any deep-link work', () => {
    const handler = block("app.on('second-instance'", '\n  });', 'second-instance handler');
    const focusAt = handler.indexOf('focusMainWindow();');
    const findAt = handler.indexOf('argv.find(');
    expect(focusAt, 'second-instance must focus the window').toBeGreaterThan(-1);
    expect(findAt, 'second-instance must still scan argv for a deep link').toBeGreaterThan(-1);
    // Position, not presence: focusing must happen for every second launch, not
    // only on the deep-link path.
    expect(
      focusAt,
      'focus must run before the deep-link scan, so it runs unconditionally',
    ).toBeLessThan(findAt);
    expect(handler, 'the deep-link scheme test must survive').toContain(
      // biome-ignore lint/suspicious/noTemplateCurlyInString: pins main.cjs source text verbatim
      'arg.startsWith(`${deepLinkProtocol}://`)',
    );
    expect(handler, 'a found deep link must still be handled').toContain(
      'if (url) handleDeepLink(url);',
    );
  });

  it('defines focusMainWindow once and routes every focus site through it', () => {
    expect(count(code, 'function focusMainWindow('), 'expected one focusMainWindow').toBe(1);
    const def = block('function focusMainWindow(', '\n}', 'focusMainWindow');
    // The pre-paint reveal must go through the published reveal closure (the
    // same displayMode/maximized discipline as 'ready-to-show'), with the bare
    // show() only as the guarded fallback: a bare show() FIRST would present
    // the window with neither, and showMainWindow no-ops once visible, so the
    // stored borderless default and maximized memory would silently never
    // apply for the whole session. Whole-expression pin, polarity included: a
    // dropped `!` would invert the routing and ship green without it.
    expect(def, 'focus must route a hidden window through the reveal discipline').toContain(
      '!mainWindow.isVisible() && !(revealMainWindow && revealMainWindow())',
    );
    expect(def, 'focus must reveal a still-hidden window (pre-paint deep links)').toContain(
      'mainWindow.show()',
    );
    expect(
      def.indexOf('revealMainWindow') < def.indexOf('mainWindow.show()'),
      'the reveal-discipline routing must guard the bare show(), not follow it',
    ).toBe(true);
    expect(def, 'focus must restore a minimized window first').toContain(
      'mainWindow.isMinimized()',
    );
    expect(def, 'focus must restore a minimized window first').toContain('mainWindow.restore()');
    expect(def, 'focus must focus the window').toContain('mainWindow.focus()');
    // Exactly the definition plus the four call sites (login, wallet,
    // second-instance, activate): a fifth caller is an unreviewed focus path
    // and must show up here.
    expect(
      count(code, 'focusMainWindow('),
      'focusMainWindow call-site count drifted from the reviewed set',
    ).toBe(5);
  });

  it('publishes the reveal closure for the pre-paint focus path', () => {
    // Exactly one publication, and it must sit INSIDE createMainWindow's
    // reveal block (after the showMainWindow definition, before the fallback
    // timer arms): published anywhere else it could capture the wrong window,
    // and absent it silently reverts focusMainWindow to the bare show() whose
    // miss holds for the whole session.
    expect(
      count(code, 'revealMainWindow = showMainWindow;'),
      'expected exactly one reveal-closure publication',
    ).toBe(1);
    const reveal = block('const showMainWindow = ', '\n  let readyToShowFallback', 'reveal block');
    expect(reveal, 'the publication must ride the reveal block itself').toContain(
      'revealMainWindow = showMainWindow;',
    );
  });

  it('reveals the existing window on activate instead of no-opping', () => {
    const handler = block("app.on('activate'", '\n  });', 'activate handler');
    expect(handler, 'activate must still create a window when none exists').toContain(
      'createMainWindow()',
    );
    expect(handler, 'activate with a live (possibly hidden) window must reveal it').toContain(
      'focusMainWindow()',
    );
  });

  it('routes the login and wallet handoff deliveries through the shared helper', () => {
    const login = block('function deliverLoginCode(', '\n}', 'deliverLoginCode');
    expect(login, 'login delivery must use the shared focus helper').toContain(
      'focusMainWindow();',
    );
    expect(login, 'login delivery must not re-inline focus').not.toContain('mainWindow.focus()');
    expect(login, 'login delivery must not re-inline restore').not.toContain(
      'mainWindow.restore()',
    );

    const wallet = block('function deliverWalletHandoffCode(', '\n}', 'deliverWalletHandoffCode');
    expect(wallet, 'wallet delivery must use the shared focus helper').toContain(
      'focusMainWindow();',
    );
    expect(wallet, 'wallet delivery must not re-inline restore').not.toContain(
      'mainWindow.restore()',
    );
    // The darwin app-level focus must stay ahead of the no-window early return:
    // it is what raises the app when the handoff arrives with no window yet.
    const steal = wallet.indexOf("if (process.platform === 'darwin') app.focus({ steal: true });");
    const guard = wallet.indexOf('if (!mainWindow) return;');
    expect(steal, 'the darwin app.focus line must survive').toBeGreaterThan(-1);
    expect(guard, 'the no-window early return must survive').toBeGreaterThan(-1);
    expect(steal, 'darwin app.focus must stay before the no-window early return').toBeLessThan(
      guard,
    );
  });

  it('nulls the application menu on win32 and linux only, before app ready', () => {
    const requireBlock = block('const {', "} = require('electron');", 'electron require');
    expect(/^\s*Menu,$/m.test(requireBlock), 'Menu must be required from electron').toBe(true);

    expect(
      count(code, 'Menu.setApplicationMenu(null)'),
      'expected exactly one setApplicationMenu(null)',
    ).toBe(1);
    // The guard is pinned as one contiguous form, so the call cannot drift out
    // of it and an inverted `!== darwin` allowlist cannot satisfy the pin.
    const guard =
      /^if \(process\.platform === 'win32' \|\| process\.platform === 'linux'\) \{\n {2}Menu\.setApplicationMenu\(null\);\n\}$/m;
    const match = guard.exec(code);
    expect(
      match,
      'setApplicationMenu(null) must sit in a top-level win32/linux allowlist',
    ).not.toBeNull();
    expect(
      match?.[0] ?? '',
      'darwin must be excluded by omission, never named in the guard',
    ).not.toContain('darwin');

    const menuAt = code.indexOf('Menu.setApplicationMenu(null)');
    const ready = code.indexOf('app.whenReady()');
    const schemes = code.indexOf('protocol.registerSchemesAsPrivileged(');
    expect(ready, 'app.whenReady() not found in main.cjs').toBeGreaterThan(-1);
    // Electron applies the menu at window creation, so nulling it after ready
    // would pass a position-blind scan while a menu bar still flashed.
    expect(menuAt, 'the menu must be nulled before app ready').toBeLessThan(ready);
    expect(schemes, 'registerSchemesAsPrivileged not found in main.cjs').toBeGreaterThan(-1);
    expect(
      menuAt,
      'the menu guard must sit after the scheme registration, which pins its own position',
    ).toBeGreaterThan(schemes);
  });

  it('reads the prefs store before anything that depends on it', () => {
    // The store gates the two GPU-force levers, and both of those must run
    // before Electron's own startup, so the read has to be the first thing this
    // file does. A read that drifted below them would leave the opt-out silently
    // inert with every unit test still green.
    expect(code, 'the store must live in userData under the module-owned filename').toContain(
      "path.join(app.getPath('userData'), DESKTOP_PREFS_FILENAME)",
    );
    const loadAt = code.indexOf('loadDesktopPrefs(desktopPrefsPath)');
    const relaunchAt = code.indexOf('relaunchForLinuxPrime({ log: console })');
    const forceAt = code.indexOf('forceHighPerformanceGpu({ app, log });');
    expect(loadAt, 'the prefs must be loaded synchronously at module scope').toBeGreaterThan(-1);
    expect(relaunchAt, 'the PRIME relaunch call must survive').toBeGreaterThan(-1);
    expect(loadAt, 'the prefs read must precede the PRIME relaunch decision').toBeLessThan(
      relaunchAt,
    );
    expect(loadAt, 'the prefs read must precede the GPU force call').toBeLessThan(forceAt);
  });

  it('arms the no-boot escape hatch before both GPU-force levers, strict and launch-only', () => {
    // WOC_DISABLE_GPU_FORCE=1 is the recovery for a machine the force prevents
    // from booting (docs/desktop-release.md): it must read the env exactly
    // once with the strict '1' comparison (a truthy test would let any stray
    // value disable the force), gate BOTH levers, and sit ahead of the stored
    // opt-out arm so it works even when the prefs file is unreadable.
    expect(
      count(code, "process.env.WOC_DISABLE_GPU_FORCE === '1'"),
      'expected exactly one strict env read for the escape hatch',
    ).toBe(1);
    expect(
      count(code, 'if (gpuForceDisabledByEnv) {'),
      'expected the hatch guard at both lever call sites',
    ).toBe(2);
    expect(
      [
        ...code.matchAll(
          /if \(gpuForceDisabledByEnv\) \{\n[^\n]*\n\} else if \(desktopPrefs\.gpuForceOptOut === true\) \{/g,
        ),
      ].length,
      'each hatch arm must lead its lever guard chain, ahead of the stored opt-out',
    ).toBe(2);
    expect(
      code.indexOf("process.env.WOC_DISABLE_GPU_FORCE === '1'"),
      'the hatch must be derived before its first lever use',
    ).toBeLessThan(code.indexOf('if (gpuForceDisabledByEnv) {'));
  });

  it('skips a GPU-force lever only when the stored opt-out is exactly true', () => {
    // Polarity, both sites: an inverted or truthy test would disable the force
    // for every player (the default record carries gpuForceOptOut: false) and
    // reintroduce the 13-FPS hybrid-laptop bug the levers exist for.
    expect(
      count(code, 'if (desktopPrefs.gpuForceOptOut === true) {'),
      'expected the strict-true guard at both lever call sites',
    ).toBe(2);
    // Skipping means NOT CALLING: the relaunch spawns a process and the force
    // appends its switches on every platform before its own internal gates, so
    // each call must sit in the else arm of its guard.
    expect(
      /if \(desktopPrefs\.gpuForceOptOut === true\) \{\n[^\n]*\n\} else if \(relaunchForLinuxPrime\(\{ log: console \}\)\) \{/.test(
        code,
      ),
      'the PRIME relaunch must be the else arm of the opt-out guard',
    ).toBe(true);
    expect(
      /if \(desktopPrefs\.gpuForceOptOut === true\) \{\n[^\n]*\n\} else \{\n {2}forceHighPerformanceGpu\(\{ app, log \}\);\n\}/.test(
        code,
      ),
      'the GPU force must be the else arm of the opt-out guard',
    ).toBe(true);
    // Exactly ONE call site per lever: the else-arm regexes above prove a
    // guarded call exists, and these counts prove it is the only one, so a
    // second unguarded call added anywhere cannot revert the opt-out while
    // every shape pin stays green.
    expect(
      count(code, 'forceHighPerformanceGpu({ app, log });'),
      'expected exactly one GPU force call site',
    ).toBe(1);
    expect(
      count(code, 'relaunchForLinuxPrime({ log: console })'),
      'expected exactly one PRIME relaunch call site',
    ).toBe(1);
  });

  it('constructs the window at the restored geometry rather than resizing it after', () => {
    // Applying saved bounds after construction would create the window at the
    // default size first, so the reveal on 'ready-to-show' could catch a resize
    // (and a maximized session would flash its un-maximized size).
    const resolveAt = code.indexOf('resolveWindowRestore({');
    const ctorAt = code.indexOf('new BrowserWindow({');
    expect(resolveAt, 'the restore must be resolved in createMainWindow').toBeGreaterThan(-1);
    expect(resolveAt, 'the restore must be resolved before the constructor').toBeLessThan(ctorAt);
    const options = block('new BrowserWindow({', '\n  });', 'BrowserWindow options');
    for (const field of [
      'x: restore.x,',
      'y: restore.y,',
      'width: restore.width,',
      'height: restore.height,',
    ]) {
      expect(
        options.includes(`\n    ${field}\n`),
        `the constructor options must carry ${field}`,
      ).toBe(true);
    }
    // maximize() on a hidden window also SHOWS it (BrowserWindow contract), so
    // the maximize must live inside the reveal, not at construction: a
    // constructor-time maximize presents an unpainted frame for the whole load.
    expect(
      code,
      'a constructor-time maximize would show the unpainted window for the whole load',
    ).not.toContain('if (restore.maximized) mainWindow.maximize();');
    const reveal = block('const showMainWindow = () => {', '\n  };', 'showMainWindow');
    const revealMaximizeAt = reveal.indexOf('if (restore.maximized) win.maximize();');
    expect(
      revealMaximizeAt,
      'a maximized session must be restored maximized at the reveal',
    ).toBeGreaterThan(-1);
    expect(
      revealMaximizeAt,
      'maximize must precede show() so the first visible frame is the maximized one',
    ).toBeLessThan(reveal.indexOf('win.show();'));
  });

  it('drives the display-sleep lease from the one presentation derivation', () => {
    // A second reading of the window could disagree with the push the renderer
    // got, and then the shell would hold the display awake for a window the
    // renderer already stopped drawing. Both failures are silent.
    const derive = block('function sendPresentationState() {', '\n}', 'sendPresentationState');
    expect(derive).toContain('const hidden = mainWindow.isMinimized() || !mainWindow.isVisible();');
    expect(derive, 'the lease must read the derived value, not the window again').toContain(
      'powerSave.setHidden(hidden);',
    );
    expect(count(code, 'isMinimized() || !mainWindow.isVisible()'), 'one derivation only').toBe(1);
    // A destroyed window can no longer derive (that function returns early), so
    // the lease is released from 'closed' rather than waiting out its timer,
    // and quit is terminal.
    const closed = block("mainWindow.on('closed', () => {", '\n  });', 'closed handler');
    expect(closed).toContain('powerSave.setHidden(true);');
    const quit = block("app.on('will-quit', () => {", '\n});', 'will-quit handler');
    expect(quit).toContain('powerSave.shutdown();');
  });

  it('wires the lease to the real powerSaveBlocker, timers, and clock', () => {
    // The pure state machine proves every transition against injected fakes;
    // this construction is the one place those proofs become real. A no-op
    // stop (or swapped start/stop) would leak the display-sleep claim with
    // the whole unit suite green, and nothing at runtime reds it.
    expect(count(code, 'createPowerSave('), 'exactly one lease construction').toBe(1);
    const wiring = block('const powerSave = createPowerSave({', '\n});', 'createPowerSave wiring');
    expect(wiring).toContain('start: (type) => powerSaveBlocker.start(type),');
    expect(wiring).toContain('stop: (id) => powerSaveBlocker.stop(id),');
    expect(wiring).toContain('setTimer: (callback, delayMs) => setTimeout(callback, delayMs),');
    expect(wiring).toContain('clearTimer: (handle) => clearTimeout(handle),');
    expect(wiring).toContain('now: () => Date.now(),');
  });

  it('applies the stored display mode at the reveal, never at construction', () => {
    // Same reasoning as the maximize above: setFullScreen on a hidden window is
    // window state the reveal discipline owns, and a `fullscreen` key in the
    // constructor options would both skip that discipline and (as an explicit
    // false) disable the macOS full-screen button for the whole session.
    const reveal = block('const showMainWindow = () => {', '\n  };', 'showMainWindow');
    const fullScreenAt = reveal.indexOf(
      "if (desktopPrefs.displayMode === 'borderless') win.setFullScreen(true);",
    );
    expect(fullScreenAt, 'a borderless session must be revealed full screen').toBeGreaterThan(-1);
    expect(
      fullScreenAt,
      'the mode must be applied before show() so the first visible frame is the right one',
    ).toBeLessThan(reveal.indexOf('win.show();'));
    // Borderless supersedes maximize: doing both would leave the window
    // remembering a maximized state it never presented.
    expect(reveal, 'the maximize must be the else arm of the borderless branch').toContain(
      'else if (restore.maximized) win.maximize();',
    );
    expect(count(code, 'win.setFullScreen(true);'), 'one reveal-time apply only').toBe(1);
    const options = block('new BrowserWindow({', '\n  });', 'BrowserWindow options');
    expect(
      options,
      'an explicit fullscreen option would disable the macOS full-screen button',
    ).not.toContain('fullscreen:');
    expect(options).not.toContain('setFullScreen');
  });

  it('remembers the window geometry on settle and once more at close', () => {
    const capture = block('const captureWindowBounds = () => {', '\n  };', 'captureWindowBounds');
    expect(
      capture,
      'a maximized session must remember the size it un-maximizes to, not the full screen',
    ).toContain('win.getNormalBounds()');
    // On Linux getNormalBounds() equals getBounds(), so a capture during a
    // borderless session would persist the full display rect over the
    // remembered windowed geometry (the startup smoke reproduced it). The
    // guard must sit BEFORE the read, and with the right polarity.
    const fullScreenGuardAt = capture.indexOf('if (win.isFullScreen()) return;');
    expect(fullScreenGuardAt, 'no capture while full screen').toBeGreaterThan(-1);
    expect(fullScreenGuardAt).toBeLessThan(capture.indexOf('win.getNormalBounds()'));
    expect(capture).not.toContain('!win.isFullScreen()');
    expect(capture, 'getBounds would persist the maximized rect').not.toContain('win.getBounds()');
    expect(capture, 'the maximized state itself must be remembered').toContain('win.isMaximized()');
    expect(capture, 'the display the window sits on must be remembered').toContain(
      'screen.getDisplayMatching(',
    );
    // Persist-then-commit, the same discipline the IPC setters pin in
    // tests/electron_ipc_channels.test.ts: the candidate record is built fresh
    // (the WHOLE record, spread from the live module-scope object, which is
    // also the anti-clobber contract with the other setters), saved, and
    // committed to the in-memory record only when the save reached disk.
    // Mutating first would leave memory ahead of disk on a failed save, and
    // the next unrelated successful save would then silently persist bounds no
    // save ever accepted.
    expect(capture, 'the candidate must carry the whole live record').toContain('...desktopPrefs,');
    expect(capture, 'the save-failure guard is load-bearing').toContain(
      'if (!saveDesktopPrefs(desktopPrefsPath, nextPrefs)) {',
    );
    const captureSaveAt = capture.indexOf('saveDesktopPrefs(desktopPrefsPath, nextPrefs)');
    const captureCommitAt = capture.indexOf('desktopPrefs.windowBounds = nextPrefs.windowBounds;');
    expect(captureSaveAt, 'the whole prefs record must be persisted').toBeGreaterThan(-1);
    expect(
      captureCommitAt,
      'the in-memory record must commit only after a successful save',
    ).toBeGreaterThan(captureSaveAt);
    expect(capture, 'every captured field commits together').toContain(
      'desktopPrefs.displayId = nextPrefs.displayId;',
    );
    expect(capture, 'every captured field commits together').toContain(
      'desktopPrefs.maximized = nextPrefs.maximized;',
    );

    // The schedule must CANCEL the pending timer before arming a new one:
    // without it, a drag stacks one timer per resize/move event and the
    // debounce degenerates into dozens of whole-file writes 700ms later.
    const schedule = block(
      'const scheduleWindowBoundsSave = () => {',
      '\n  };',
      'scheduleWindowBoundsSave',
    );
    expect(schedule, 'each schedule must cancel the pending debounce first').toContain(
      'clearBoundsSaveTimer();',
    );
    expect(
      schedule.indexOf('clearBoundsSaveTimer();'),
      'the cancel must precede the re-arm',
    ).toBeLessThan(schedule.indexOf('setTimeout('));
    expect(code, 'a resize must schedule a save').toContain(
      "mainWindow.on('resize', scheduleWindowBoundsSave);",
    );
    const move = block("mainWindow.on('move'", '\n  });', 'move handler');
    expect(move, 'a drag must schedule a save').toContain('scheduleWindowBoundsSave();');
    expect(move, 'the display re-read must still fire on move').toContain('sendDisplayChange();');

    // 'closed' is after destruction, where the bounds can no longer be read, so
    // the final capture has to hang off 'close'.
    const close = block("mainWindow.on('close', () => {", '\n  });', 'close handler');
    expect(close, 'the pending debounce must be cancelled first').toContain(
      'clearBoundsSaveTimer();',
    );
    expect(close, 'the final capture must be synchronous on close').toContain(
      'captureWindowBounds();',
    );
    const closed = block("mainWindow.on('closed'", '\n  });', 'closed handler');
    expect(closed, 'no save timer may outlive its window').toContain('clearBoundsSaveTimer();');
  });

  it('no longer carries a per-window setMenu(null)', () => {
    expect(
      count(code, 'setMenu(null)'),
      'the per-window menu strip is replaced by the app-level guard',
    ).toBe(0);
  });

  it('the startup banner logs the Exchange verdict for the per-channel smoke', () => {
    // docs/desktop-release.md step 6 reads this field: on an unstamped build
    // `distribution` collapses to website while this correctly says false, so
    // the log alone answers the smoke. Sliced from the banner call so a field
    // elsewhere cannot satisfy it.
    const banner = block("log.info('[shell] starting'", '});', 'startup banner');
    expect(banner).toContain('wocExchangeEnabled: desktopConfig.wocExchangeEnabled,');
  });
});
