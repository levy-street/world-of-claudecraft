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

  it('decides and applies the Linux GPU backend after the GPU force, before app ready', () => {
    // The backend switches are read at app 'ready' like the discrete-GPU
    // switches, so the block has to sit at module scope between the force call
    // and whenReady; it also reads the prefs and the env, so the prefs load and
    // the escape-hatch derivation must precede it. One call site each, so a
    // second decision cannot silently override this one.
    const decideAt = code.indexOf('const gpuBackendLaunch = decideGpuBackendLaunch({');
    const applyAt = code.indexOf(
      'applyGpuBackendSwitches(app, gpuBackendLaunch, gpuPolicy.vulkanSwitches);',
    );
    const forceAt = code.indexOf('forceHighPerformanceGpu({ app, log });');
    const loadAt = code.indexOf('loadDesktopPrefs(desktopPrefsPath)');
    const ready = code.indexOf('app.whenReady()');
    expect(decideAt, 'the backend launch decision is gone').toBeGreaterThan(-1);
    expect(applyAt, 'the backend switches are no longer applied').toBeGreaterThan(-1);
    expect(loadAt).toBeLessThan(decideAt);
    expect(forceAt).toBeLessThan(decideAt);
    expect(decideAt).toBeLessThan(applyAt);
    expect(applyAt).toBeLessThan(ready);
    expect(count(code, 'decideGpuBackendLaunch({')).toBe(1);
    expect(count(code, 'applyGpuBackendSwitches(')).toBe(1);
    // The decision is fed the real process facts and the live prefs object.
    const decision = code.slice(decideAt, code.indexOf('});', decideAt)).replace(/\s+/g, ' ');
    expect(decision).toContain('platform: process.platform,');
    expect(decision).toContain('env: process.env,');
    expect(decision).toContain('prefs: desktopPrefs,');
    // The app version too: a proof from another version must not aim the climb.
    expect(decision).toContain('appVersion: app.getVersion(),');
    // And the one log line a support ticket greps for. It names the RUNG, not
    // the coarse backend: 'vulkan' cannot tell the two Vulkan rungs apart.
    expect(code).toMatch(
      /`\[gpu\] backend launch: \$\{gpuBackendLaunch\.rung\} \(\$\{gpuBackendLaunch\.reason\}\)`/,
    );
  });

  it('reads the GPU policy before the decision, and feeds both its halves', () => {
    // The policy (electron/gpu_backend_policy.cjs) must be in hand before
    // decideGpuBackendLaunch runs: its ceiling shapes the Auto decision, and
    // its per-card switches ride the Vulkan switches, whatever the mode.
    const policyAt = code.indexOf(
      'const gpuPolicy = gpuBackendPolicy({ platform: process.platform, env: process.env });',
    );
    const decideAt = code.indexOf('const gpuBackendLaunch = decideGpuBackendLaunch({');
    expect(policyAt, 'the policy read is gone').toBeGreaterThan(-1);
    expect(policyAt).toBeLessThan(decideAt);
    const decision = code.slice(decideAt, code.indexOf('});', decideAt)).replace(/\s+/g, ' ');
    expect(decision).toContain('autoCeiling: gpuPolicy.autoCeiling,');
    expect(code).toContain(
      'applyGpuBackendSwitches(app, gpuBackendLaunch, gpuPolicy.vulkanSwitches);',
    );
    expect(count(code, 'gpuBackendPolicy(')).toBe(1);
    // The options row learns it from the same state payload as the verdict.
    expect(code).toContain('autoCapped: gpuBackendLaunch.capped === true,');
  });

  it('snapshots the next-launch settings right after the prefs load, before any lever or setter', () => {
    // The getters serve the STORED values, which a setter moves live; the
    // frozen snapshot taken here is the only way the game can tell "changed,
    // restart to apply" from "already running" (electron/launch_settings.cjs).
    const loadAt = code.indexOf('const desktopPrefs = loadDesktopPrefs(desktopPrefsPath);');
    const snapshotAt = code.indexOf('const launchSettings = launchSettingsSnapshot(desktopPrefs);');
    const firstLeverAt = code.indexOf('if (gpuForceDisabledByEnv) {');
    const firstSetterAt = code.indexOf("ipcMain.handle('desktop-set-");
    expect(snapshotAt, 'the launch snapshot is gone').toBeGreaterThan(loadAt);
    expect(snapshotAt).toBeLessThan(firstLeverAt);
    expect(snapshotAt).toBeLessThan(firstSetterAt);
    expect(count(code, 'launchSettingsSnapshot(')).toBe(1);
    // Served as-is, and the restart hands the lock over on the child's spawn
    // event through app.quit (never app.exit: the window is healthy, its
    // close-time bounds save runs).
    const getter = code.indexOf("ipcMain.handle('desktop-get-launch-settings'");
    expect(code.slice(getter, getter + 200)).toContain('return launchSettings;');
    const restart = code.indexOf("ipcMain.handle('desktop-restart-app'");
    const restartBody = code.slice(restart, code.indexOf('});', restart) + 3).replace(/\s+/g, ' ');
    expect(restartBody).toContain('if (restartInFlight) return restartInFlight;');
    expect(restartBody).toContain('restartInFlight = restartApp({');
    expect(restartBody).toContain('if (!started) restartInFlight = null;');
    expect(restartBody).toContain(
      'onSpawned: () => { app.releaseSingleInstanceLock(); app.quit(); }',
    );
    expect(restartBody).not.toContain('app.exit(');
  });

  it('judges this launch once, through one function fed by every evidence source', () => {
    // The judgement has ONE shape (judgeThisLaunch): it runs once per process (a
    // crash-recovery reload lands on the post-crash fallback, not this launch's
    // rung), records what actually bound, and rescues when that fell short of
    // what was asked for. Judging is not remembering: nothing here writes the
    // memory, which only moves once the session has proven healthy.
    const defAt = code.indexOf(
      'function judgeThisLaunch(glRenderer, softwareRendering, parallelCompile) {',
    );
    expect(defAt, 'judgeThisLaunch is gone').toBeGreaterThan(-1);
    expect(count(code, 'function judgeThisLaunch(')).toBe(1);
    const judgeEnd = code.indexOf('\n}', defAt);
    expect(judgeEnd).toBeGreaterThan(defAt);
    const judge = code.slice(defAt, judgeEnd).replace(/\s+/g, ' ');
    // Judged once; a later report may only REFINE the parallel-compile reading
    // (the getGPUInfo arm cannot see the extension and can judge first), never
    // re-judge the rung or rescue.
    expect(judge).toContain(
      'if (gpuBackendJudged) { refineParallelCompile(parallelCompile); return; }',
    );
    expect(judge).toContain('gpuBackendJudged = true;');
    const refine = block('function refineParallelCompile(parallelCompile) {', '\n}', 'refine');
    const refineFlat = refine.replace(/\s+/g, ' ');
    expect(refineFlat).toContain(
      "if (parallelCompile !== false || boundRung !== 'vulkan-parallel-compile') return;",
    );
    expect(refineFlat).toContain("boundRung = 'vulkan-plain';");
    expect(refineFlat).toContain('sendGpuBackendState();');
    expect(refine).not.toContain('rescueOntoLowerBackend(');
    expect(refine).not.toContain('mergeDesktopPrefs');
    expect(count(code, 'gpuBackendJudged = true;')).toBe(1);
    expect(code.indexOf('let gpuBackendJudged = false;')).toBeLessThan(defAt);
    // The rung asked for and the page's extension report decide what bound.
    expect(judge).toContain(
      'boundRung = judgeGpuBackendLaunch({ glRenderer, softwareRendering, parallel: gpuBackendLaunch.parallel, parallelCompile, });',
    );
    // ONLY a Vulkan rung that bound something that is not Vulkan is a failure to
    // enable it (backendDidNotBind, by FAMILY). A rung compare would re-exec a
    // healthy Vulkan window whose page reports the extension absent onto the
    // backend it is already on; `!==` would also fire on a higher one.
    expect(judge).toContain('if (!backendDidNotBind(gpuBackendLaunch.rung, boundRung)) return;');
    expect(judge).not.toContain('isHigherRung(');
    expect(judge).not.toContain('boundRung === gpuBackendLaunch.rung');
    expect(judge).toContain('rescueOntoLowerBackend(`it bound ${boundRung} instead`);');
    // Judging is not remembering, and it is not mode-aware either: a rescue
    // wrapped in an Auto guard here would strand exactly the explicit-choice
    // player this commit exists to rescue, and a flattened toContain on the
    // inner statement alone survives any enclosing guard.
    expect(judge, 'the judge must not read the setting at all').not.toContain(
      'desktopPrefs.gpuBackend',
    );
    // The page is told which rung actually bound; without this call the options
    // row would sit on its pre-judgement reading for the whole session.
    expect(judge).toContain('sendGpuBackendState();');
    expect(count(code, 'sendGpuBackendState();')).toBe(2);
    // The proof's machine key is the active ADAPTER, never the renderer string:
    // that string names the backend, so a rescue ending on OpenGL would read as
    // another machine and replace a top-rung proof. Latched from getGPUInfo.
    expect(judge).not.toContain('boundGpuDriver');
    expect(code).not.toContain('boundGpuDriver');
    expect(
      count(code, "if (boundGpuAdapter === '') boundGpuAdapter = activeGpuAdapterKey(devices);"),
    ).toBe(1);
    // The launch window is armed from the launch, never from here: a page that
    // never reports would otherwise leave the session in "launch" state for its
    // whole life, and a death hours in would re-exec it out from under the player.
    expect(judge).not.toContain('armHealthySessionTimer()');
    expect(code).toContain('app.whenReady().then(armHealthySessionTimer);');
    expect(count(code, 'armHealthySessionTimer)')).toBe(1);
    // The memory is NOT written here.
    expect(judge).not.toContain('saveDesktopPrefs');
    expect(judge).not.toContain('mergeDesktopPrefs');

    // Caller one: logGpuStatus, after the desktop-gpu-status push, and ONLY when
    // the getGPUInfo reading carries evidence. An empty renderer string with no
    // software flag (the healthy Linux Vulkan reading) must not judge, so it
    // cannot rescue: it logs the waiting line and leaves the judgement pending.
    const start = code.indexOf('function logGpuStatus()');
    const body = code.slice(start, code.indexOf('\n}', start));
    const sendAt = body.indexOf("webContents.send('desktop-gpu-status'");
    const flat = body.replace(/\s+/g, ' ');
    expect(sendAt).toBeGreaterThan(-1);
    expect(flat).toContain(
      'if (hasGetGpuInfoEvidence(aux)) { judgeThisLaunch(aux.glRenderer, aux.softwareRendering); } else if (!gpuBackendJudged) { log.info(',
    );
    expect(body.indexOf('hasGetGpuInfoEvidence(aux)')).toBeGreaterThan(sendAt);
    expect(body).toContain(
      "[gpu] backend: waiting for the renderer's report (no renderer string from getGPUInfo)",
    );
    expect(count(body, 'judgeThisLaunch(')).toBe(1);
    expect(body).not.toContain('relaunchOnLowerBackend(');
    expect(body).not.toContain('judgeGpuBackendLaunch(');

    // Caller two: the renderer's own report (body pinned in
    // tests/electron_ipc_channels.test.ts). The definition plus exactly two
    // call sites in all: the GPU-process death has its OWN handler now, because
    // a death is a rescue, not a judgement.
    const reportAt = code.indexOf("ipcMain.on('desktop-report-gpu-renderer'");
    expect(reportAt).toBeGreaterThan(-1);
    const report = code.slice(reportAt, code.indexOf('\n});', reportAt));
    expect(report).toContain('judgeThisLaunch(renderer.slice(0, 256), false, parallel);');
    expect(count(code, 'judgeThisLaunch(')).toBe(3);
  });

  it('rescues a launch-time GPU death in EVERY mode, and counts one only on an Auto parent', () => {
    // The defect this replaces: an explicit choice had no rescue at all, so a
    // player who picked Vulkan on a machine that cannot run it was left on a
    // dead screen they could not click out of. The rescue is unconditional; the
    // MEMORY is what stays out of an explicit choice's way.
    const goneAt = code.indexOf("app.on('child-process-gone'");
    expect(goneAt).toBeGreaterThan(-1);
    const goneEnd = code.indexOf('\n});', goneAt);
    expect(goneEnd).toBeGreaterThan(goneAt);
    const gone = code.slice(goneAt, goneEnd).replace(/\s+/g, ' ');
    expect(gone).toContain("if (details?.type !== 'GPU') return;");
    // Off the ladder (Windows, macOS) there is no rung to step to and no memory
    // to move; without this every platform logged "rescuing off opengl".
    expect(gone).toContain('if (!gpuBackendLaunch.ladder) return;');
    // A clean exit or a kill (our own quit inside the window) is lifecycle, not
    // a launch failure: it must return BEFORE anything is counted or rescued.
    expect(gone).toContain("if (classifyRendererExit(details?.reason) === 'benign') {");
    expect(gone.indexOf("classifyRendererExit(details?.reason) === 'benign'")).toBeLessThan(
      gone.indexOf('if (sessionHealthy) {'),
    );
    expect(gone).toContain(
      'log[level](`[gpu] GPU process gone (not a crash) on ${boundRung}`, context); return; }',
    );
    // After a healthy session it is the rare late crash: Chromium restarts the
    // GPU process itself, nothing is counted and nothing is written.
    expect(gone).toContain('if (sessionHealthy) {');
    // Before that it is a launch failure: count it on an Auto launch (the
    // launch's flag, never the setting, which says Auto under
    // WOC_DISABLE_GPU_FORCE=1 and the env override too), once per process (the
    // streak counts launches, not gone events), then rescue whatever the mode.
    // No rescued-child guard here: demoteAfterRepeatedCrashes compares the rung
    // with the attempt, which is what lets a re-probe's child, landing ON the
    // attempt, count the remembered rung's failure.
    expect(gone).toContain(
      'if (gpuBackendLaunch.auto && !gpuLaunchDeathCounted) { gpuLaunchDeathCounted = true;',
    );
    expect(gone).not.toContain('gpuBackendLaunch.rescued');
    expect(gone).not.toContain('desktopPrefs.gpuBackend');
    expect(gone).toContain(
      'const next = demoteAfterRepeatedCrashes({ prefs: desktopPrefs, rung: gpuBackendLaunch.rung });',
    );
    expect(gone).toContain("rescueOntoLowerBackend('the GPU process died at launch');");
    // The CONTIGUOUS text, not a brace count: the Auto arm's slice carries
    // braces from its own object literals, so counting them let the exact
    // pre-fix defect (the rescue moved inside the arm) pass green.
    expect(gone, 'the rescue must sit OUTSIDE the Auto-only arm, which is the whole fix').toContain(
      "if (mergeDesktopPrefs(next)) log.warn('[gpu] backend memory updated after the death', next); } rescueOntoLowerBackend('the GPU process died at launch');",
    );
    // A late crash RETURNS: without it, a death after a healthy session would
    // demote the memory and re-exec a live session, the defect this replaces.
    expect(gone).toContain(
      'log.warn(`[gpu] GPU process gone after a healthy session on ${boundRung}`, context); return; }',
    );
    // And a launch-time death disarms the window, or a launch that died and
    // could not be rescued would still record itself healthy sixty seconds on.
    expect(gone).toContain(
      'if (healthySessionTimer !== null) { clearTimeout(healthySessionTimer); healthySessionTimer = null; }',
    );
  });

  it('rescues through ONE latched path, reachable from all three triggers', () => {
    // The two triggers that need the GPU process to have lived cannot see a
    // Vulkan rung whose process never started: it cannot die, and with no GPU
    // nothing can report a renderer. The feature status is the only evidence
    // there is, and the shell already reads it.
    const rescue = block('function rescueOntoLowerBackend(why) {', '\n}', 'rescueOntoLowerBackend');
    const flat = rescue.replace(/\s+/g, ' ');
    // Latched, off the ladder never, and never after the session has proven
    // healthy: a late crash is Chromium's to recover, not ours to re-exec a live
    // session for.
    expect(flat).toContain(
      'if (!gpuBackendLaunch.ladder || gpuRescueSpawned || sessionHealthy) return;',
    );
    expect(flat).toContain('gpuRescueSpawned = true;');
    // The single-instance lock is handed over, and this process exits, on the
    // child's 'spawn' event through the module's onSpawned hook: never on
    // spawn() returning (a child that never starts is an async 'error', and a
    // parent that had exited on the return would leave nothing running), never
    // on a refused spawn (a child that requested its own lock while the parent
    // still held it would see itself as a second instance and quit).
    expect(flat).toContain(
      'relaunchOnLowerBackend( { log, onSpawned: () => { app.releaseSingleInstanceLock(); app.exit(0); }, }, gpuBackendLaunch.rung, );',
    );
    expect(flat).not.toContain('if (spawned)');
    // The exit lives in the hook and nowhere else, and nothing reads the
    // return to act on it.
    expect(count(code, 'app.exit(0)')).toBe(1);
    expect(flat).not.toMatch(/=\s*relaunchOnLowerBackend\(/);
    // Two handovers of the single-instance lock in the whole shell: this rescue
    // and the player-requested restart (pinned by its own case above), each on
    // its child's 'spawn' event.
    expect(count(code, 'releaseSingleInstanceLock()')).toBe(2);
    // The spawn lives there and nowhere else, so no trigger can bypass the latch.
    expect(count(code, 'relaunchOnLowerBackend(')).toBe(1);
    expect(count(code, 'rescueOntoLowerBackend(')).toBe(4);
    // The third trigger, at the one moment the evidence exists.
    const gpu = block('function logGpuStatus() {', '\n}', 'logGpuStatus').replace(/\s+/g, ' ');
    expect(gpu).toContain(
      "if (shouldRescueMissingGpu({ rung: gpuBackendLaunch.rung, hardwareWebgl: false })) { rescueOntoLowerBackend('no hardware WebGL on a Vulkan rung'); }",
    );
  });

  it('writes the memory only after a session has PROVEN healthy, and never on explicit', () => {
    // The signal that separates "this rung runs here" from "this rung started
    // here", which the verdict it replaces never made.
    const armAt = code.indexOf('function armHealthySessionTimer() {');
    expect(armAt, 'armHealthySessionTimer is gone').toBeGreaterThan(-1);
    const armEnd = code.indexOf('\n}', armAt);
    expect(armEnd).toBeGreaterThan(armAt);
    const arm = code.slice(armAt, armEnd).replace(/\s+/g, ' ');
    // Armed once, on the shell's own clock, never off the ladder, and a
    // launch-time death disarms it (pinned in the death handler above).
    expect(arm).toContain(
      'if (!gpuBackendLaunch.ladder || healthySessionTimer !== null || sessionHealthy) return;',
    );
    // A session nobody judged is still HEALTHY (a death from here is late), but
    // it records nothing: an unjudged rung is not evidence of anything.
    expect(arm).toContain(
      "if (!gpuBackendJudged) { log.info('[gpu] session healthy, but the launch was never judged (memory untouched)'); return; }",
    );
    expect(arm.indexOf('if (!gpuBackendJudged) {')).toBeLessThan(
      arm.indexOf('gpuBackendMemoryAfterHealthySession('),
    );
    expect(arm).toContain('}, SESSION_HEALTHY_AFTER_MS);');
    expect(arm).toContain('sessionHealthy = true;');
    // Only a launch the memory DECIDED writes it back (the launch's `auto` flag,
    // never the setting: the setting reads Auto under WOC_DISABLE_GPU_FORCE=1 and
    // under the env override, and both used to be remembered). The guard must
    // RETURN: pinning its presence alone let a mutation that dropped the return
    // (so an explicit choice DID write the memory) pass.
    expect(arm).toContain(
      'if (!gpuBackendLaunch.auto) { log.info( `[gpu] session healthy on ${boundRung} (${gpuBackendLaunch.reason}, memory untouched)`, ); return; }',
    );
    expect(arm).not.toContain('desktopPrefs.gpuBackend');
    // The proof is keyed on the adapter, and a rescued child is told it is one so
    // it writes the proof it earned and never the attempt or the streak.
    expect(arm).toContain(
      'const next = gpuBackendMemoryAfterHealthySession({ prefs: desktopPrefs, rung: boundRung, appVersion: app.getVersion(), gpuAdapter: boundGpuAdapter, rescued: gpuBackendLaunch.rescued, });',
    );
    const explicitAt = arm.indexOf('if (!gpuBackendLaunch.auto) {');
    expect(arm.indexOf('gpuBackendMemoryAfterHealthySession(')).toBeGreaterThan(explicitAt);
    expect(count(code, 'gpuBackendMemoryAfterHealthySession(')).toBe(1);
    // The write itself, not only the computation: deleting the merge left every
    // pin green while no proof was ever written and the climb never aimed.
    expect(arm).toContain(
      'if (mergeDesktopPrefs(next)) { log.info(`[gpu] session healthy on ${boundRung}; memory updated`, next); }',
    );
  });

  it('persists the memory before committing it, through one writer', () => {
    // The discipline every other setter in this shell is pinned on: a value
    // that could not reach disk must never be the one the process believes,
    // or the getter reports a memory the next launch will not read. One writer
    // because three sites own three different fields of the same record.
    const merge = block('function mergeDesktopPrefs(partial) {', '\n}', 'mergeDesktopPrefs');
    const flat = merge.replace(/\s+/g, ' ');
    expect(flat).toContain(
      "if (!saveDesktopPrefs(desktopPrefsPath, next)) { log.warn('[gpu] could not persist the GPU backend memory'); return false; } Object.assign(desktopPrefs, partial);",
    );
    // A no-op partial writes nothing at all: the pure helpers answer null to
    // say "nothing changed", and a write per launch would be a write per boot.
    expect(flat).toContain('if (!partial || Object.keys(partial).length === 0) return false;');
    // Every memory write goes through it, and only through it.
    expect(count(code, 'function mergeDesktopPrefs(')).toBe(1);
    expect(count(code, 'mergeDesktopPrefs(')).toBe(4);

    // The climb cadence's only driver. Deleting this line left the counter at
    // zero for ever, so a demoted machine never climbed back and the whole
    // proof-cadence mechanism was dead code with every unit test green.
    expect(code).toContain(
      'mergeDesktopPrefs(launchCounterAfterAutoLaunch({ prefs: desktopPrefs, launch: gpuBackendLaunch }));',
    );
    const counterAt = code.indexOf('launchCounterAfterAutoLaunch({');
    expect(counterAt).toBeGreaterThan(
      code.indexOf('applyGpuBackendSwitches(app, gpuBackendLaunch);'),
    );
    expect(counterAt).toBeLessThan(code.indexOf('app.whenReady()'));
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
    const revealMaximizeAt = reveal.indexOf('} else if (restore.maximized) win.maximize();');
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

  it('applies the stored display mode at the reveal, and on Linux after the page loads', () => {
    // A `fullscreen` key in the constructor options would skip the reveal
    // discipline entirely and, as an explicit false, disable the macOS
    // full-screen button for the whole session.
    const options = block('new BrowserWindow({', '\n  });', 'BrowserWindow options');
    expect(
      options,
      'an explicit fullscreen option would disable the macOS full-screen button',
    ).not.toContain('fullscreen:');
    expect(options).not.toContain('setFullScreen');
    // Borderless supersedes maximize on BOTH arms: a session that will go full
    // screen (now or after the load) must not maximize first, or the window
    // would remember a maximized state it never presented.
    const reveal = block('const showMainWindow = () => {', '\n  };', 'showMainWindow');
    const revealApplyAt = reveal.indexOf(
      "if (desktopPrefs.displayMode === 'borderless') {\n      if (!DEFER_DISPLAY_MODE_TO_LOAD) win.setFullScreen(true);\n    } else if (restore.maximized) win.maximize();",
    );
    expect(
      revealApplyAt,
      'the reveal must apply full screen on a non-deferring platform, and never also maximize a borderless session',
    ).toBeGreaterThan(-1);
    expect(
      revealApplyAt,
      'the mode must be applied before show() so the first visible frame is the right one',
    ).toBeLessThan(reveal.indexOf('win.show();'));
  });

  it('defers the display-mode apply on Linux, where the reveal-time one is dropped', () => {
    // The window manager can only honor presentation state for a window it has
    // already mapped. Full screen asked for inside the reveal is dropped by
    // mutter (GNOME/X11), leaving a borderless session in a plain window while
    // isFullScreen() answers true, and the geometry it thrashes on the way out
    // invalidates the compositor's Vulkan swapchain, which kills the GPU
    // process and intermittently leaves the page blocked from WebGL for the
    // rest of the session: a game that never renders. Measured on the packaged
    // build, 15 of 15 reveal-time borderless Vulkan launches lost the GPU
    // process and none presented full screen; 11 of 11 deferred ones did
    // neither. Linux only: the other platforms honor the reveal-time apply and
    // are not measurable from here.
    expect(code, 'the deferral must be scoped to Linux, not applied everywhere').toContain(
      "const DEFER_DISPLAY_MODE_TO_LOAD = process.platform === 'linux';",
    );
    expect(
      count(code, 'DEFER_DISPLAY_MODE_TO_LOAD'),
      'one definition, one reveal guard, one deferred-apply guard',
    ).toBe(3);
    // A signal, never a delay: a wall-clock constant tuned on one machine is
    // not a gate anywhere else.
    const deferred = block(
      '  if (DEFER_DISPLAY_MODE_TO_LOAD) {',
      '\n  }',
      'deferred display-mode apply',
    );
    expect(deferred, 'the deferred apply must ride did-finish-load').toContain(
      "mainWindow.webContents.once('did-finish-load', () => {",
    );
    expect(deferred, 'the apply must skip a window that is already gone').toContain(
      'if (win.isDestroyed()) return;',
    );
    expect(
      deferred,
      'the stored mode must be re-read at apply time, so a mode the player changed while the page loaded is left alone',
    ).toContain("if (desktopPrefs.displayMode !== 'borderless') return;");
    expect(deferred, 'a borderless session must end up full screen').toContain(
      'win.setFullScreen(true);',
    );
    expect(
      count(code, 'win.setFullScreen(true);'),
      'exactly two applies: the reveal-time one and the deferred one',
    ).toBe(2);
    // .once, not .on: the reveal it replaces ran once per window creation, and
    // re-applying on a crash-recovery reload would snap back a window the
    // player has fullscreened or restored by hand since.
    expect(
      count(code, "mainWindow.webContents.once('did-finish-load'"),
      'the display-mode apply must be the only once-bound did-finish-load listener',
    ).toBe(1);
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

describe('the log lines the Linux runbook quotes', () => {
  // docs/desktop-release.md ("Linux CI verification") tells a maintainer what
  // to grep for in main.log; a reworded line would send them after text
  // that never appears. The lines named there and pinned nowhere else.
  it('exist in the shell, in the shape the runbook prints them', () => {
    expect(code).toContain(
      '`[gpu] backend bound: ${boundRung} (asked for ${gpuBackendLaunch.rung})`',
    );
    expect(code).toContain('`[gpu] GPU process gone at launch on ${gpuBackendLaunch.rung}`');
    expect(code).toContain('`[gpu] rescuing off ${gpuBackendLaunch.rung}: ${why}`');
    expect(code).toContain("rescueOntoLowerBackend('the GPU process died at launch')");
  });
});
