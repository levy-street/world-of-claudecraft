import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { stripComments } from './helpers/strip_comments';

// Pin the preload <-> main IPC channel-name contract by scanning the sources:
// electron/*.cjs live outside tsc, so a rename on one side would otherwise
// only surface as a silent no-op (or a rejected invoke) at runtime.
const repoRoot = join(__dirname, '..');
const read = (rel: string) => readFileSync(join(repoRoot, rel), 'utf8');

// The shared order-safe stripper (tests/helpers/strip_comments.ts, imported
// above) is applied where a body is PINNED (the handler slices below):
// main.cjs cannot run under vitest, so textual robustness IS the coverage
// there, and a raw substring pin is satisfied by a commented-out line, exactly
// the silent-dead-feature shape it must catch. The shared helper's lookbehind
// form also refuses a line comment that immediately follows a block-comment
// closer, which the previous local consuming-guard copy let survive.

// Stripped at the shared constants too, so EVERY substring pin in this suite
// (not just the discord slices) refuses a commented-out line.
const preload = stripComments(read('electron/preload.cjs'));
const mainSide = stripComments(read('electron/main.cjs') + read('electron/updater.cjs'));

const matches = (source: string, re: RegExp): Set<string> => {
  const found = new Set<string>();
  for (const m of source.matchAll(re)) found.add(m[1]);
  return found;
};

describe('electron IPC channel contract (preload <-> main)', () => {
  it('every preload invoke has a main-side ipcMain.handle', () => {
    const invoked = matches(preload, /ipcRenderer\.invoke\('([^']+)'/g);
    const handled = matches(mainSide, /ipcMain\.handle\('([^']+)'/g);
    expect([...invoked].sort()).toEqual(
      expect.arrayContaining([
        'desktop-epic-capability',
        'desktop-epic-link-proof',
        'desktop-epic-link-settled',
        'desktop-exchange-capability',
        'desktop-app-quit',
        'desktop-gamepad-activity',
        'desktop-get-display-mode',
        'desktop-get-gpu-force-opt-out',
        'desktop-login-open-browser',
        'desktop-login-take-code',
        'desktop-set-discord-activity',
        'desktop-set-discord-presence-enabled',
        'desktop-set-display-mode',
        'desktop-set-gpu-force-opt-out',
        'desktop-set-strings',
        'desktop-show-notification',
        'desktop-steam-capability',
        'desktop-steam-link-settled',
        'desktop-steam-link-ticket',
        'desktop-update-install',
        'desktop-wallet-capability',
        'desktop-wallet-open-browser',
        'desktop-wallet-take-code',
      ]),
    );
    for (const channel of invoked) {
      expect(handled, `no ipcMain.handle for invoked channel ${channel}`).toContain(channel);
    }
  });

  it('every preload send has a main-side ipcMain.on', () => {
    const sent = matches(preload, /ipcRenderer\.send\('([^']+)'/g);
    const listened = matches(mainSide, /ipcMain\.on\('([^']+)'/g);
    expect([...sent]).toContain('desktop-renderer-error');
    for (const channel of sent) {
      expect(listened, `no ipcMain.on for sent channel ${channel}`).toContain(channel);
    }
  });

  it('every preload subscription has a main-side webContents.send', () => {
    const subscribed = matches(preload, /ipcRenderer\.on\('([^']+)'/g);
    const pushed = matches(mainSide, /webContents\.send\('([^']+)'/g);
    expect([...subscribed].sort()).toEqual([
      'desktop-display-changed',
      'desktop-gpu-status',
      'desktop-login-code',
      'desktop-presentation-changed',
      'desktop-update-event',
      'desktop-wallet-handoff-code',
    ]);
    for (const channel of subscribed) {
      expect(pushed, `nothing pushes subscribed channel ${channel}`).toContain(channel);
    }
  });

  it('every ipcMain.handle body checks the trusted-sender gate FIRST', () => {
    // A handler without the sender gate would answer IPC from any frame that
    // somehow runs in the window (the deny-by-default posture's last line).
    // Scan both registration sites: main.cjs handlers call trustedSender(...),
    // the updater's injected gate is named isTrusted(...). The check must
    // appear within the first statement's reach of the callback body.
    const registrations = mainSide.split(/ipcMain\.handle\(/).slice(1);
    expect(registrations.length).toBeGreaterThanOrEqual(5);
    for (const body of registrations) {
      const head = body.slice(0, 200);
      expect(
        /trustedSender\(|isTrusted\(/.test(head),
        `an ipcMain.handle body does not gate on the trusted sender: ${head.split('\n')[0]}`,
      ).toBe(true);
    }
  });

  it('the steam-link-settled handler body cancels the live auth ticket', () => {
    // The channel existing is not enough: the settle signal exists ONLY so the
    // shell CancelAuthTickets the live handle promptly (Valve's contract), so
    // the handler body must actually reach steamShell.cancelLinkTicket.
    const main = read('electron/main.cjs');
    const start = main.indexOf("ipcMain.handle('desktop-steam-link-settled'");
    expect(start).toBeGreaterThan(-1);
    const body = main.slice(start, main.indexOf('});', start));
    expect(body).toContain('steamShell.cancelLinkTicket()');
  });

  it('the epic-link-settled handler body cancels the live proof handle', () => {
    // Mirror of the Steam settle contract: the channel exists so the shell can
    // release any cancelable EOS adapter handle promptly after the link POST.
    const main = read('electron/main.cjs');
    const start = main.indexOf("ipcMain.handle('desktop-epic-link-settled'");
    expect(start).toBeGreaterThan(-1);
    const body = main.slice(start, main.indexOf('});', start));
    expect(body).toContain('epicShell.cancelLinkProof()');
  });

  it('reports whether the external wallet authorization page actually opened', () => {
    const main = read('electron/main.cjs');
    const start = main.indexOf("ipcMain.handle('desktop-wallet-open-browser'");
    expect(start).toBeGreaterThan(-1);
    const body = main.slice(start, main.indexOf('});', start));
    expect(body).toContain('await openDesktopWalletHandoff(code)');
  });

  it('the gpu-force-opt-out setter takes only a strict boolean and reports the write', () => {
    // The stored value decides whether the next launch re-execs itself (Linux
    // PRIME) and writes a Windows per-app preference, so a junk value must not
    // reach the file, and the renderer must learn when the write failed rather
    // than showing a toggle the next launch will not honor.
    const main = read('electron/main.cjs');
    const start = main.indexOf("ipcMain.handle('desktop-set-gpu-force-opt-out'");
    expect(start).toBeGreaterThan(-1);
    const body = main.slice(start, main.indexOf('\n});', start));
    expect(body).toContain('if (optOut !== true && optOut !== false) return false;');
    // The WHOLE record, spread from the live module-scope object: this is the
    // anti-clobber contract with the window-bounds saver. Saving only the
    // toggled field would wipe windowBounds/displayId/maximized from disk on
    // every mid-session toggle, so the spread is pinned literally.
    expect(body).toContain(
      'saveDesktopPrefs(desktopPrefsPath, { ...desktopPrefs, gpuForceOptOut: optOut })',
    );
    // The failure GUARD is load-bearing, not just the ordering: a bare save
    // call after this line would still satisfy an index comparison while
    // flipping the mirror on a write that never reached disk.
    expect(body).toContain(
      'if (!saveDesktopPrefs(desktopPrefsPath, { ...desktopPrefs, gpuForceOptOut: optOut })) {',
    );
    // The in-memory mirror is updated only after a successful save, so the
    // getter can never report a value the next launch would not read.
    const saveAt = body.indexOf('saveDesktopPrefs(desktopPrefsPath,');
    const commitAt = body.indexOf('desktopPrefs.gpuForceOptOut = optOut;');
    expect(commitAt).toBeGreaterThan(saveAt);

    const getterAt = main.indexOf("ipcMain.handle('desktop-get-gpu-force-opt-out'");
    expect(getterAt).toBeGreaterThan(-1);
    const getter = main.slice(getterAt, main.indexOf('\n});', getterAt));
    expect(getter, 'the getter must report the STORED value, not a live GPU reading').toContain(
      'return desktopPrefs.gpuForceOptOut === true;',
    );
  });

  it('the display-mode setter takes only the two literals, persists, then applies live', () => {
    // The stored mode decides how the NEXT launch reveals the window and the
    // live apply is what the player sees under the click, so a junk value must
    // reach neither, and a failed write must not leave the window in a mode the
    // next launch would not reproduce.
    const main = read('electron/main.cjs');
    const start = main.indexOf("ipcMain.handle('desktop-set-display-mode'");
    expect(start).toBeGreaterThan(-1);
    const body = main.slice(start, main.indexOf('\n});', start));
    // An untrusted frame is refused by VALUE, not just by a gate call whose
    // result something might ignore.
    expect(body).toContain('if (!trustedSender(event)) return false;');
    expect(body).toContain("if (mode !== 'borderless' && mode !== 'windowed') return false;");
    // Same anti-clobber contract as the GPU setter: the WHOLE record, spread
    // from the live module-scope object, or a mid-session change would wipe
    // windowBounds/displayId/maximized off disk.
    expect(body).toContain(
      'saveDesktopPrefs(desktopPrefsPath, { ...desktopPrefs, displayMode: mode })',
    );
    // The failure GUARD is load-bearing: without the `if (!` arm a failed disk
    // write would still flip the mirror and the live window, leaving a mode the
    // next launch cannot reproduce.
    expect(body).toContain(
      'if (!saveDesktopPrefs(desktopPrefsPath, { ...desktopPrefs, displayMode: mode })) {',
    );
    const saveAt = body.indexOf('saveDesktopPrefs(desktopPrefsPath,');
    const commitAt = body.indexOf('desktopPrefs.displayMode = mode;');
    const applyAt = body.indexOf("mainWindow.setFullScreen(mode === 'borderless');");
    expect(commitAt).toBeGreaterThan(saveAt);
    expect(applyAt).toBeGreaterThan(commitAt);
    // Idempotence: the world-entry apply-all loop re-sends the reflected mode,
    // and a same-value send must neither rewrite the file nor re-apply window
    // state over a manually fullscreened (or restored) window. The early
    // return sits after validation and before the save.
    const sameAt = body.indexOf('if (mode === desktopPrefs.displayMode) return true;');
    expect(sameAt).toBeGreaterThan(body.indexOf("if (mode !== 'borderless'"));
    expect(sameAt).toBeLessThan(saveAt);

    const getterAt = main.indexOf("ipcMain.handle('desktop-get-display-mode'");
    expect(getterAt).toBeGreaterThan(-1);
    const getter = main.slice(getterAt, main.indexOf('\n});', getterAt));
    expect(getter, 'the getter must report the STORED mode').toContain(
      'return desktopPrefs.displayMode;',
    );
    // The untrusted arm answers the DEFAULT by value: the generic gate sweep
    // only proves trustedSender is called, not that its verdict decides the
    // answer, and an untrusted frame must learn nothing about the real mode.
    expect(getter, 'an untrusted frame is answered with the default').toContain(
      "if (!trustedSender(event)) return 'borderless';",
    );
  });

  it('the gamepad-activity handler feeds the display-sleep lease', () => {
    // The channel existing proves nothing: it exists ONLY so controller input
    // keeps the display awake, and nothing else in the shell pings the lease.
    const main = read('electron/main.cjs');
    const start = main.indexOf("ipcMain.handle('desktop-gamepad-activity'");
    expect(start).toBeGreaterThan(-1);
    const body = main.slice(start, main.indexOf('\n});', start));
    expect(body).toContain('if (!trustedSender(event)) return false;');
    expect(body).toContain('powerSave.notifyActivity();');
  });

  it('the app-quit handler accepts only a trusted live-window request', () => {
    const main = stripComments(read('electron/main.cjs'));
    const start = main.indexOf("ipcMain.handle('desktop-app-quit'");
    expect(start).toBeGreaterThan(-1);
    const end = main.indexOf('\n});', start);
    expect(end).toBeGreaterThan(start);
    const body = main.slice(start, end);
    expect(body).toContain('if (!trustedSender(event)) return false;');
    expect(body).not.toContain('if (trustedSender(event)) return false;');
    expect(body).toContain('if (!mainWindow) return false;');
    expect(body).toContain('if (mainWindow.isDestroyed()) return false;');
    expect(body).toContain('app.quit();');
    expect(body).not.toContain('app.exit(');
    expect(body).toContain('return true;');
    expect(body).toMatch(/desktop-app-quit', \(event\) => \{/);
    const trustAt = body.indexOf('if (!trustedSender(event)) return false;');
    const missingWindowAt = body.indexOf('if (!mainWindow) return false;');
    const destroyedWindowAt = body.indexOf('if (mainWindow.isDestroyed()) return false;');
    const quitAt = body.indexOf('app.quit();');
    expect(missingWindowAt).toBeGreaterThan(trustAt);
    expect(destroyedWindowAt).toBeGreaterThan(missingWindowAt);
    expect(quitAt).toBeGreaterThan(destroyedWindowAt);
  });

  it('the exchange-capability handler is trusted-sender gated and answers a strict boolean', () => {
    // The $WOC Exchange store gate (issue #3692): an untrusted frame and a
    // store build must both read false, and the answer is the pure
    // desktop_config verdict compared strictly, never a truthy passthrough or
    // the collapsed resolveDistribution channel. Sliced from the STRIPPED
    // mainSide so a commented-out verdict line cannot satisfy the pin.
    const start = mainSide.indexOf("ipcMain.handle('desktop-exchange-capability'");
    expect(start).toBeGreaterThan(-1);
    const end = mainSide.indexOf('\n});', start);
    // An unfound close would make the slice run to end-of-file, letting the
    // pins below be satisfied by later handlers' text (the show-notification
    // pin carries the same guard for the same reason).
    expect(end).toBeGreaterThan(start);
    const body = mainSide.slice(start, end);
    expect(body).toContain('if (!trustedSender(event)) return false;');
    expect(body).toContain('return desktopConfig.wocExchangeEnabled === true;');
    // And the preload method must invoke THIS channel, not a sibling
    // capability whose decision reads the collapsed distribution.
    expect(preload).toContain(
      "wocExchangeSupported: () => ipcRenderer.invoke('desktop-exchange-capability'),",
    );
  });

  it('the show-notification handler validates, re-checks focus, then paces the OS surface', () => {
    // Everything this handler refuses is refused ONLY here: it is the one path
    // from the page to a surface outside the game, so an untrusted frame, an
    // unknown kind, an unbounded string, a focused window, and a repeat inside
    // the floor each have to be answered by value rather than by a call some
    // later line could ignore.
    const main = read('electron/main.cjs');
    const start = main.indexOf("ipcMain.handle('desktop-show-notification'");
    expect(start).toBeGreaterThan(-1);
    const end = main.indexOf('\n});', start);
    // An unfound close would make the slice run to end-of-file, letting every
    // pin and order comparison below be satisfied by later handlers' text.
    expect(end).toBeGreaterThan(start);
    const body = main.slice(start, end);
    expect(body).toContain('if (!trustedSender(event)) return false;');
    expect(body).toContain("if (!payload || typeof payload !== 'object') return false;");
    expect(body).toContain("if (kind !== 'update-ready' && kind !== 'party-invite') return false;");
    expect(body).toContain(
      "if (typeof payload.title !== 'string' || typeof payload.body !== 'string') return false;",
    );
    // The caps are what keep a crafted string out of the OS surface, and
    // clampText is what flattens its control characters on the way.
    expect(body).toContain('clampText(payload.title, 120)');
    expect(body).toContain('clampText(payload.body, 240)');
    expect(body).toContain("if (title.trim() === '' || body.trim() === '') return false;");
    // The trusted-side focus mirror: a renderer that lost track of focus must
    // not be able to toast a player who is looking straight at the game.
    expect(body).toContain(
      'if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isFocused()) return false;',
    );
    expect(body).toContain('if (!Notification.isSupported()) return false;');
    expect(body).toContain('if (!notifyGuard.allow(kind)) return false;');
    // A click focuses the window through the one shared path, and nothing else:
    // any other handler here would be a navigation the renderer chose.
    expect(body).toContain("notification.on('click', focusMainWindow);");
    expect(body).toContain('silent: false');
    // The one line that actually displays anything: a handler that constructs,
    // wires the click, and returns true without ever showing would pass every
    // other pin here and only the manual shell smoke would notice.
    expect(body).toContain('notification.show();');
    // The Linux markup escape: freedesktop daemons may parse body markup, so
    // both strings are entity-escaped there and ride verbatim elsewhere.
    expect(body).toContain("const escapeMarkup = process.platform === 'linux';");
    expect(body).toContain('title: escapeMarkup ? escapeNotificationMarkup(title) : title,');
    expect(body).toContain('body: escapeMarkup ? escapeNotificationMarkup(body) : body,');
    expect(main).toContain('  escapeNotificationMarkup,');
    expect(body).toContain('return true;');

    // Order is the contract, not just presence: pacing before the show means the
    // rate limit stamps only on a notification that really reaches the OS, and
    // every refusal above it costs nothing.
    const trustAt = body.indexOf('if (!trustedSender(event)) return false;');
    const kindAt = body.indexOf("if (kind !== 'update-ready'");
    const clampAt = body.indexOf('clampText(payload.title, 120)');
    const focusAt = body.indexOf('mainWindow.isFocused()');
    const allowAt = body.indexOf('notifyGuard.allow(kind)');
    const showAt = body.indexOf('new Notification(');
    const clickAt = body.indexOf("notification.on('click', focusMainWindow);");
    const showCallAt = body.indexOf('notification.show();');
    expect(trustAt).toBeGreaterThan(-1);
    expect(kindAt).toBeGreaterThan(trustAt);
    expect(clampAt).toBeGreaterThan(kindAt);
    expect(focusAt).toBeGreaterThan(clampAt);
    expect(allowAt).toBeGreaterThan(focusAt);
    expect(showAt).toBeGreaterThan(allowAt);
    // Click wiring before show: a listener attached after show() could miss a
    // click on a notification the OS already displayed.
    expect(clickAt).toBeGreaterThan(showAt);
    expect(showCallAt).toBeGreaterThan(clickAt);

    // The BINDING lines, not just the handler: a guard that was never
    // constructed (or constructed off a clock that does not move) would leave
    // the handler above reading a floor nothing enforces.
    expect(main).toContain("require('./notify_guard.cjs')");
    expect(main).toContain('const notifyGuard = createNotifyGuard({ now: () => Date.now() });');
  });

  it('the preload refuses junk notification payloads and rebuilds them for the bridge', () => {
    // These live ONLY in the preload. The kind whitelist keeps main from being
    // asked about values it would refuse anyway; the fresh object is what stops
    // a renderer prototype (or a getter) crossing the bridge; the slices keep a
    // hostile page from shipping unbounded strings across the IPC (main
    // re-clamps to the visible caps without trusting them); and the invoke is
    // fire-and-forget both ways, so its rejection is swallowed and its
    // synchronous throw is caught rather than surfacing in the caller's path.
    // Pins are scoped to the method's own slice: identical guard lines exist
    // in sibling methods, and a pin the whole file satisfies proves nothing
    // about this one.
    const showStart = preload.indexOf('showNotification: (payload) => {');
    expect(showStart).toBeGreaterThan(-1);
    const showEnd = preload.indexOf('\n  },', showStart);
    expect(showEnd).toBeGreaterThan(showStart);
    const show = preload.slice(showStart, showEnd);
    expect(show).toContain("if (!payload || typeof payload !== 'object') return;");
    expect(show).toContain("if (kind !== 'update-ready' && kind !== 'party-invite') return;");
    expect(show).toContain(
      "if (typeof payload.title !== 'string' || typeof payload.body !== 'string') return;",
    );
    expect(show).toContain(
      'const message = { kind, title: payload.title.slice(0, 512), body: payload.body.slice(0, 1024) };',
    );
    expect(show).toContain(
      "ipcRenderer.invoke('desktop-show-notification', message).catch(() => {});",
    );
    expect(show).toContain('try {');
    expect(show).toContain('} catch {}');
  });

  it('the preload refuses junk display modes and swallows gamepad-notify rejections', () => {
    // Both behaviors live ONLY in the preload and fail silently when lost. The
    // junk refusal keeps main receiving values it can apply; the catch is
    // load-bearing and NOT redundant with the renderer module's own catch:
    // notifyGamepadActivity returns undefined to its caller, so the renderer
    // side can never see the invoke rejection, and dropping this catch would
    // surface one unhandled rejection per notify on a shell whose handler
    // rejects.
    expect(preload).toContain(
      "if (mode !== 'borderless' && mode !== 'windowed') return Promise.resolve(false);",
    );
    expect(preload).toContain("ipcRenderer.invoke('desktop-gamepad-activity').catch(() => {});");
  });

  it('the discord-activity handler sends only what the whitelist returned', () => {
    // The handler is deliberately thin: the whitelist itself lives in
    // electron/discord_presence.cjs and is EXECUTED by
    // tests/electron_discord_presence.test.ts, because a pin on handler text
    // cannot see a field added to the object that actually leaves. What is
    // pinned here is the wiring around it: the sender gate, the clear arm, and
    // that the ONLY thing handed to the presence module is the sanitized
    // object, refused by value when the whitelist says no. Comments are
    // stripped first: a line-commented setActivity(clean) satisfied every
    // raw pin below while shipping a sanitize-then-drop dead feature.
    const main = stripComments(read('electron/main.cjs'));
    const start = main.indexOf("ipcMain.handle('desktop-set-discord-activity'");
    expect(start).toBeGreaterThan(-1);
    const end = main.indexOf('\n});', start);
    // An unfound close would make the slice run to end-of-file, letting every
    // pin and order comparison below be satisfied by later handlers' text.
    expect(end).toBeGreaterThan(start);
    const body = main.slice(start, end);
    expect(body).toContain('if (!trustedSender(event)) return false;');
    // A dropped `!` would ship green against the presence pin alone: with the
    // gate inverted the handler answers untrusted frames and refuses real ones.
    expect(body).not.toContain('if (trustedSender(event)) return false;');
    expect(body).toContain('if (payload === null) {');
    expect(body).toContain('discordPresence.setActivity(null);');
    // The clamp is passed IN, so the module stays require-light and the visible
    // cap (with its control-character flattening) is the shell's one clamp.
    expect(body).toContain('const clean = sanitizeDiscordActivity(payload, clampText);');
    expect(body).toContain('if (!clean) return false;');
    // The effectful line hands over the FRESH object, never the payload that
    // crossed the bridge.
    expect(body).toContain('discordPresence.setActivity(clean);');
    expect(body).not.toContain('discordPresence.setActivity(payload);');
    // Nothing may be added to the sanitized object on its way out: a line like
    // `clean.state = payload.state` here would defeat the whitelist while every
    // other pin above stayed green.
    expect(body).not.toContain('clean.');
    expect(main).toContain('  sanitizeDiscordActivity,');

    // Order is the contract: the refusal arms happen before anything is sent.
    const trustAt = body.indexOf('if (!trustedSender(event)) return false;');
    const nullArmAt = body.indexOf('if (payload === null) {');
    const sanitizeAt = body.indexOf('const clean = sanitizeDiscordActivity(payload, clampText);');
    const refuseAt = body.indexOf('if (!clean) return false;');
    const sendAt = body.indexOf('discordPresence.setActivity(clean);');
    expect(trustAt).toBeGreaterThan(-1);
    expect(nullArmAt).toBeGreaterThan(trustAt);
    expect(sanitizeAt).toBeGreaterThan(nullArmAt);
    expect(refuseAt).toBeGreaterThan(sanitizeAt);
    expect(sendAt).toBeGreaterThan(refuseAt);
  });

  it('the discord-presence setter takes a strict boolean, persists, then applies live', () => {
    const main = stripComments(read('electron/main.cjs'));
    const start = main.indexOf("ipcMain.handle('desktop-set-discord-presence-enabled'");
    expect(start).toBeGreaterThan(-1);
    const end = main.indexOf('\n});', start);
    expect(end).toBeGreaterThan(start);
    const body = main.slice(start, end);
    expect(body).toContain('if (!trustedSender(event)) return false;');
    expect(body).not.toContain('if (trustedSender(event)) return false;');
    expect(body).toContain('if (enabled !== true && enabled !== false) return false;');
    // Same anti-clobber contract as the GPU and display-mode setters: the WHOLE
    // record, spread from the live module-scope object, or a mid-session toggle
    // would wipe windowBounds/displayId/maximized off disk.
    expect(body).toContain(
      'saveDesktopPrefs(desktopPrefsPath, { ...desktopPrefs, discordPresenceEnabled: enabled })',
    );
    // The failure GUARD is load-bearing: without the `if (!` arm a failed disk
    // write would still flip the mirror and the live connection, leaving a
    // setting the next launch would not reproduce.
    expect(body).toContain(
      'if (!saveDesktopPrefs(desktopPrefsPath, { ...desktopPrefs, discordPresenceEnabled: enabled })) {',
    );
    expect(body).toContain('desktopPrefs.discordPresenceEnabled = enabled;');
    expect(body).toContain('discordPresence.setEnabled(enabled);');

    const trustAt = body.indexOf('if (!trustedSender(event)) return false;');
    const strictAt = body.indexOf('if (enabled !== true && enabled !== false) return false;');
    const sameAt = body.indexOf(
      'if (enabled === desktopPrefs.discordPresenceEnabled) return true;',
    );
    const saveAt = body.indexOf('saveDesktopPrefs(desktopPrefsPath,');
    const commitAt = body.indexOf('desktopPrefs.discordPresenceEnabled = enabled;');
    const applyAt = body.indexOf('discordPresence.setEnabled(enabled);');
    expect(strictAt).toBeGreaterThan(trustAt);
    // Idempotence, and BEFORE the save: the world-entry apply-all loop re-sends
    // the reflected value, so a same-value send must not rewrite the file (nor
    // tear down and redial a connection that is already in the right state).
    expect(sameAt).toBeGreaterThan(strictAt);
    expect(sameAt).toBeLessThan(saveAt);
    // The mirror commits only after a successful write, and the live apply only
    // after the mirror, so nothing can be true in memory and false on disk.
    expect(commitAt).toBeGreaterThan(saveAt);
    expect(applyAt).toBeGreaterThan(commitAt);
  });

  it('the presence manager is constructed once, and is the only thing that dials', () => {
    // Boot purity rides on the factory: it is built at module scope precisely
    // because construction does no IO, and a second connector anywhere in the
    // shell would be a socket opened outside that contract.
    const main = stripComments(read('electron/main.cjs'));
    expect(main).toContain("require('./discord_presence.cjs')");
    expect(main.split('const discordPresence = createDiscordPresence({')).toHaveLength(2);
    const bindingAt = main.indexOf('const discordPresence = createDiscordPresence({');
    const bindingEnd = main.indexOf('\n});', bindingAt);
    expect(bindingEnd).toBeGreaterThan(bindingAt);
    const binding = main.slice(bindingAt, bindingEnd);
    // Node's net, not the electron `net` binding beside it: the latter is the
    // Chromium HTTP stack and cannot open a local socket at all.
    expect(binding).toContain('connect: (p) => nodeNet.createConnection(p),');
    expect(main.split('createConnection(')).toHaveLength(2);
    // The ownership guard is only as real as its wiring: without a statPath the
    // module cannot tell a squatted /tmp socket from Discord's own, and without
    // a uid it can only check that the entry is a socket.
    expect(binding).toContain('statPath: (p) => fs.statSync(p),');
    expect(binding).toContain(
      "uid: typeof process.getuid === 'function' ? process.getuid() : null,",
    );
    // The shell's one clamp, so peer text in the log is bounded and flattened.
    expect(binding).toContain('clampText,');
    // The app id resolves through one function with a pinned precedence
    // (tests/electron_discord_presence.test.ts executes it): an unset
    // WOC_DISCORD_APP_ID means the baked official id, a set and VALID value
    // overrides it (the operator slot), and a set-but-invalid value (the
    // documented fork opt-out, WOC_DISCORD_APP_ID=off) keeps the feature
    // inert. The baked default is safe to ship: an application id is a public
    // snowflake every build exposes on the wire, not a secret, and it is what
    // makes presence work for players who never set environment variables.
    expect(binding).toContain('clientId: resolveDiscordClientId(process.env),');
    expect(binding).toContain('initiallyEnabled: desktopPrefs.discordPresenceEnabled,');
    // And it is released on the way out, like the display-sleep lease: pinned
    // INSIDE the will-quit slice, because an anywhere-in-file pin stays green
    // when dispose() is parked in a function nothing calls.
    const quitStart = main.indexOf("app.on('will-quit'");
    expect(quitStart).toBeGreaterThan(-1);
    const quitEnd = main.indexOf('\n});', quitStart);
    expect(quitEnd).toBeGreaterThan(quitStart);
    const quit = main.slice(quitStart, quitEnd);
    expect(quit).toContain('powerSave.shutdown();');
    expect(quit).toContain('discordPresence.dispose();');
  });

  it('the preload rebuilds the presence payload and refuses junk toggles', () => {
    // These live ONLY in the preload: the fresh object (nested timestamps
    // included) is what stops a renderer prototype or a getter crossing the
    // bridge, the slice keeps a hostile page from shipping an unbounded string
    // across the IPC, and the invoke is fire-and-forget both ways. Pins are
    // scoped to each method's own slice, because identical guard lines exist in
    // sibling methods and a pin the whole file satisfies proves nothing here.
    const activityStart = preload.indexOf('setDiscordActivity: (activity) => {');
    expect(activityStart).toBeGreaterThan(-1);
    const activityEnd = preload.indexOf('\n  },', activityStart);
    expect(activityEnd).toBeGreaterThan(activityStart);
    const activity = preload.slice(activityStart, activityEnd);
    expect(activity).toContain("if (!activity || typeof activity !== 'object') return;");
    expect(activity).toContain("if (typeof activity.details !== 'string') return;");
    expect(activity).toContain('message = { details: activity.details.slice(0, 256) };');
    expect(activity).toContain('message.timestamps = { start: timestamps.start };');
    expect(activity).toContain(
      "if (timestamps && typeof timestamps === 'object' && typeof timestamps.start === 'number') {",
    );
    expect(activity).toContain(
      "ipcRenderer.invoke('desktop-set-discord-activity', message).catch(() => {});",
    );
    expect(activity).toContain('try {');
    expect(activity).toContain('} catch {}');

    const toggleStart = preload.indexOf('setDiscordPresenceEnabled: (enabled) => {');
    expect(toggleStart).toBeGreaterThan(-1);
    const toggleEnd = preload.indexOf('\n  },', toggleStart);
    expect(toggleEnd).toBeGreaterThan(toggleStart);
    const toggle = preload.slice(toggleStart, toggleEnd);
    expect(toggle).toContain('if (enabled !== true && enabled !== false) return;');
    expect(toggle).toContain(
      "ipcRenderer.invoke('desktop-set-discord-presence-enabled', enabled).catch(() => {});",
    );
    expect(toggle).toContain('} catch {}');
  });

  it('activates the macOS app when the browser returns a wallet handoff', () => {
    const main = read('electron/main.cjs');
    const start = main.indexOf('function deliverWalletHandoffCode');
    expect(start).toBeGreaterThan(-1);
    const body = main.slice(start, main.indexOf('\n}', start));
    expect(body).toContain('app.focus({ steal: true })');
  });

  it('the bridge methods the client feature-checks exist in the preload', () => {
    for (const method of [
      'openBrowserLogin',
      'takeLoginCode',
      'onLoginCode',
      'setShellStrings',
      'reportRendererError',
      'onUpdateEvent',
      'installUpdate',
      'quitApp',
      'onGpuStatus',
      'onPresentationChanged',
      'onDisplayChanged',
      'getGpuForceOptOut',
      'setGpuForceOptOut',
      'getDisplayMode',
      'setDisplayMode',
      'notifyGamepadActivity',
      'showNotification',
      'setDiscordActivity',
      'setDiscordPresenceEnabled',
      'steamLinkTicket',
      'steamLinkSupported',
      'steamLinkSettled',
      'epicLinkProof',
      'epicLinkSupported',
      'epicLinkSettled',
      'walletConnectionSupported',
      'wocExchangeSupported',
      'openWalletBrowser',
      'takeWalletHandoffCode',
      'onWalletHandoffCode',
    ]) {
      expect(preload, `preload is missing bridge method ${method}`).toContain(`${method}:`);
    }
  });

  it('exposes app quit as an argument-free capability', () => {
    expect(preload).toContain("quitApp: () => ipcRenderer.invoke('desktop-app-quit'),");
    expect(preload).not.toMatch(/quitApp:\s*\([^)]*[A-Za-z_$][^)]*\)/);
    expect(preload).not.toMatch(/ipcRenderer\.invoke\('desktop-app-quit',\s*[^)]/);
  });
});
