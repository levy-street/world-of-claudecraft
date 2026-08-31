import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import {
  APPIMAGE_ENTRY_NAME,
  appImagePathFrom,
  buildDesktopEntry,
  configureLinuxDesktopName,
  DEB_ENTRY_NAME,
  DESKTOP_ENTRY_BASENAME,
  defaultRunCommand,
  desktopEntryDir,
  execArgumentFor,
  installDesktopEntry,
  PRODUCT_NAME,
  registerLinuxUrlHandler,
} from '../electron/linux_url_handler.cjs';

const PKG = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

const APPIMAGE = '/home/deck/Applications/world-of-claudecraft.AppImage';
const SCHEME = 'worldofclaudecraft';
const APPS_DIR = '/home/deck/.local/share/applications';
const ENTRY_PATH = `${APPS_DIR}/world-of-claudecraft-appimage.desktop`;

// Built without literals so no control character ever appears in this source file.
const NL = String.fromCharCode(10);
const CR = String.fromCharCode(13);
const TAB = String.fromCharCode(9);
const DQUOTE = String.fromCharCode(34);

type Ran = { command: string; args: string[] };

/** An installDesktopEntry dep set with the filesystem and xdg-utils faked out. */
function harness({
  existing = null,
  writeThrows = false,
  mkdirThrows = false,
  renameThrows = false,
  entryExists = false,
  env = { APPIMAGE, HOME: '/home/deck' } as Record<string, string | undefined>,
}: {
  existing?: string | null;
  writeThrows?: boolean;
  mkdirThrows?: boolean;
  renameThrows?: boolean;
  entryExists?: boolean;
  env?: Record<string, string | undefined>;
} = {}) {
  const written: { file: string; data: string; options: unknown }[] = [];
  const removed: string[] = [];
  const renamed: { from: string; to: string }[] = [];
  const dirs: { dir: string; options: unknown }[] = [];
  const ran: Ran[] = [];
  return {
    written,
    removed,
    renamed,
    dirs,
    ran,
    deps: {
      platform: 'linux',
      env,
      scheme: SCHEME,
      dir: APPS_DIR,
      fileExists: () => entryExists,
      readFile: () => {
        if (existing === null) throw new Error('ENOENT');
        return existing;
      },
      writeFile: (file: string, data: string, options: unknown) => {
        if (writeThrows) throw new Error('EROFS: read-only file system');
        written.push({ file, data, options });
      },
      rename: (from: string, to: string) => {
        if (renameThrows) throw new Error('EXDEV: cross-device link');
        renamed.push({ from, to });
      },
      removeFile: (file: string) => {
        removed.push(file);
      },
      mkdir: (dir: string, options: unknown) => {
        if (mkdirThrows) throw new Error('EROFS: read-only file system');
        dirs.push({ dir, options });
      },
      runCommand: (command: string, args: string[]) => {
        ran.push({ command, args });
      },
      log: { info: vi.fn(), warn: vi.fn() },
    },
  };
}

const entryFor = (execArgument: string, tryExecPath: string | null = null) =>
  buildDesktopEntry({
    execArgument,
    scheme: SCHEME,
    productName: PRODUCT_NAME,
    tryExecPath,
  }) as string;

describe('the .desktop entry filename (a cross-package literal)', () => {
  it('matches the basename electron-builder gives the deb', () => {
    // electron-builder installs /usr/share/applications/<executableName>.desktop, and
    // executableName defaults to package.json `name` lowercased (LinuxPackager). Our AppImage
    // entry and the CHROME_DESKTOP value must both use that exact name, or the deb fix
    // silently reverts to pointing at a file that does not exist. Derived from package.json
    // here rather than restated, so a rename fails this test instead of shipping.
    expect(DEB_ENTRY_NAME).toBe(`${String(PKG.name).toLowerCase()}.desktop`);
    expect(DEB_ENTRY_NAME).toBe('world-of-claudecraft.desktop');
    expect(DEB_ENTRY_NAME).toBe(`${DESKTOP_ENTRY_BASENAME}.desktop`);
  });

  it('does NOT reuse the deb basename for the entry it writes', () => {
    // Same basename means the same desktop-file ID, and XDG first-match makes a user-level file
    // win outright, so one AppImage run would replace the deb's entry everywhere it is looked
    // up. With TryExec that becomes a silent removal: delete the AppImage and the launcher
    // refuses the entry, so a deb-installed game disappears from the menu and the scheme
    // resolves to nothing, unfixable by `apt reinstall` because the file is in $HOME.
    expect(APPIMAGE_ENTRY_NAME).not.toBe(DEB_ENTRY_NAME);
    expect(APPIMAGE_ENTRY_NAME).toBe('world-of-claudecraft-appimage.desktop');
  });

  it('pins the electron-builder inputs that the derivation ASSUMES are unset', () => {
    // executableName (either spelling) or desktopName + syncDesktopName would each rename the
    // installed file WITHOUT changing package.json `name`, silently repointing CHROME_DESKTOP
    // at nothing and re-breaking Discord login on the deb. The derivation above cannot see
    // them, so pin their absence: setting one turns THIS red instead of shipping the bug.
    expect(PKG.build.executableName).toBeUndefined();
    expect(PKG.build.linux?.executableName).toBeUndefined();
    expect(PKG.build.linux?.syncDesktopName).toBeFalsy();
    expect(PKG.desktopName).toBeUndefined();
  });

  it('keeps the icon name tied to the same basename electron-builder installs', () => {
    // The deb installs its icon at /usr/share/icons/hicolor/<size>/apps/<executableName>.png,
    // so a rename that moved the entry filename but left Icon= behind ships a blank icon.
    expect(DESKTOP_ENTRY_BASENAME).toBe(String(PKG.name).toLowerCase());
  });

  it('uses the shipping product name for the entry Name', () => {
    expect(PRODUCT_NAME).toBe(PKG.build.productName);
    expect(PRODUCT_NAME).toBe('World of ClaudeCraft');
  });

  it('registers the same scheme package.json declares to electron-builder', () => {
    // The MimeType line we write and the `protocols` block electron-builder bakes into the deb
    // entry have to name one scheme, and main.cjs's deepLinkProtocol has to be that scheme
    // too, or the callback URL lands on a handler nobody registered.
    expect(PKG.build.protocols[0].schemes).toContain(SCHEME);
    const main = readFileSync(new URL('../electron/main.cjs', import.meta.url), 'utf8');
    expect(main).toContain(`const deepLinkProtocol = '${SCHEME}';`);
  });
});

describe('main.cjs wiring', () => {
  const raw = readFileSync(new URL('../electron/main.cjs', import.meta.url), 'utf8');
  // Comments are stripped before every scan below. Without this the pins are vacuous in the
  // WORST direction: commenting the call out while debugging leaves them green, shipping a
  // dead fix. Block comments first so a // inside one cannot resurrect the rest of the line.
  const main = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

  it('installs the handler BEFORE setAsDefaultProtocolClient', () => {
    // Ordering is the whole point: Electron's Linux registration shells out to xdg-settings
    // with CHROME_DESKTOP, so the name must already be corrected and (on an AppImage) the file
    // already written by the time that call runs.
    const install = main.indexOf('registerLinuxUrlHandler({');
    const register = main.indexOf('app.setAsDefaultProtocolClient(');
    expect(install).toBeGreaterThan(-1);
    expect(register).toBeGreaterThan(-1);
    expect(install).toBeLessThan(register);
  });

  it('restores CHROME_DESKTOP after the registration, from a finally', () => {
    // Restoring early would defeat the registration; not restoring at all leaks our app
    // identity into every child, including the login browser. A finally makes it hold even if
    // setAsDefaultProtocolClient throws, which is the case a plain trailing call misses.
    const register = main.indexOf('app.setAsDefaultProtocolClient(');
    const restore = main.indexOf('linuxUrlHandler.restore()');
    expect(restore).toBeGreaterThan(-1);
    expect(restore).toBeGreaterThan(register);
    expect(main).toMatch(
      /\}\s*finally\s*\{\s*linuxUrlHandler\.restore\(\);\s*linuxUrlHandler\.associate\(\);\s*\}/,
    );
  });

  it('actually CALLS it, exactly once, and not from inside a comment', () => {
    const calls = main.match(/registerLinuxUrlHandler\(/g) ?? [];
    expect(calls).toHaveLength(1);
    expect(main).toContain("require('./linux_url_handler.cjs')");
  });

  it('calls it at module top level, not deferred into a callback', () => {
    // Text order is not execution order: app.whenReady().then(() => register(...)) keeps the
    // call ABOVE setAsDefaultProtocolClient in the file while running after it. An unindented
    // call is the cheap, robust proxy for "runs during module evaluation".
    expect(main).toMatch(/^const linuxUrlHandler = registerLinuxUrlHandler\(\{/m);
  });

  it('passes the real deep-link scheme, not a hardcoded copy', () => {
    expect(main).toMatch(/registerLinuxUrlHandler\(\{\s*scheme:\s*deepLinkProtocol\s*,/);
  });
});

describe('execArgumentFor', () => {
  it('leaves an ordinary absolute path unquoted', () => {
    expect(execArgumentFor(APPIMAGE)).toBe(APPIMAGE);
  });

  it('quotes a path with spaces so it stays ONE Exec argument', () => {
    // The common real case: ~/My Games/woc.AppImage. Unquoted, the desktop entry would try to
    // run "/home/deck/My" with "Games/woc.AppImage" as an argument.
    expect(execArgumentFor('/home/deck/My Games/woc.AppImage')).toBe(
      `${DQUOTE}/home/deck/My Games/woc.AppImage${DQUOTE}`,
    );
  });

  it('quotes shell-reserved characters that are legal in a filename', () => {
    expect(execArgumentFor('/home/deck/woc (1).AppImage')).toBe(
      `${DQUOTE}/home/deck/woc (1).AppImage${DQUOTE}`,
    );
  });

  it('DOUBLES a literal percent, which the spec requires', () => {
    // Launchers expand %-field-codes across the whole Exec value before shell-parsing it, and
    // GLib drops an unrecognized %X pair outright. Left alone, ~/Downloads/WoC%20(1).AppImage
    // launches WoC0(1).AppImage: a broken handler that we then promote to DEFAULT, which is
    // the exact dead end this module exists to remove.
    expect(execArgumentFor('/home/deck/WoC%20(1).AppImage')).toBe(
      `${DQUOTE}/home/deck/WoC%%20(1).AppImage${DQUOTE}`,
    );
    expect(execArgumentFor('/home/deck/Games 100%/woc.AppImage')).toBe(
      `${DQUOTE}/home/deck/Games 100%%/woc.AppImage${DQUOTE}`,
    );
  });

  it('treats a single quote as safe by QUOTING it, never bare', () => {
    // Safe only because it always takes the double-quoted branch, where shell parsing makes it
    // literal. Pinned so a future widening of EXEC_BARE_SAFE cannot silently un-quote it.
    const out = execArgumentFor("/home/deck/rocco's games/woc.AppImage");
    expect(out).toBe(`${DQUOTE}/home/deck/rocco's games/woc.AppImage${DQUOTE}`);
  });

  it.each([
    ['newline (would inject extra .desktop keys)', `/home/deck/woc${NL}Exec=/bin/sh.AppImage`],
    ['carriage return', `/home/deck/woc${CR}X.AppImage`],
    ['tab (spec-invalid control character)', `/home/deck/woc${TAB}X.AppImage`],
    ['double quote', `/home/deck/wo${DQUOTE}c.AppImage`],
    ['backslash (rebuilds a newline via the \\n escape)', '/home/deck/wo\\c.AppImage'],
    ['backtick', '/home/deck/wo`c`.AppImage'],
    ['dollar', '/home/deck/wo$HOME.AppImage'],
  ])('refuses %s rather than escaping it', (_label, badPath) => {
    expect(execArgumentFor(badPath)).toBeNull();
  });

  it('refuses a relative path, which would resolve against an unknown cwd', () => {
    expect(execArgumentFor('Applications/woc.AppImage')).toBeNull();
  });

  it('refuses empty and non-string input', () => {
    expect(execArgumentFor('')).toBeNull();
    expect(execArgumentFor(undefined)).toBeNull();
    expect(execArgumentFor(42)).toBeNull();
  });
});

describe('appImagePathFrom', () => {
  it('reads the outer AppImage path from APPIMAGE', () => {
    expect(appImagePathFrom({ APPIMAGE })).toBe(APPIMAGE);
  });

  it('trims, which FLIPS the result from no-install to install', () => {
    // Not a cosmetic trim: without it a padded value fails isAbsolute and the whole feature
    // silently turns off, so the behavior difference deserves its own pin.
    expect(appImagePathFrom({ APPIMAGE: `  ${APPIMAGE}  ` })).toBe(APPIMAGE);
  });

  it('is null off an AppImage, which is how the deb and Steam depot opt out', () => {
    expect(appImagePathFrom({})).toBeNull();
  });

  it('rejects a relative APPIMAGE', () => {
    expect(appImagePathFrom({ APPIMAGE: 'relative/woc.AppImage' })).toBeNull();
  });
});

describe('desktopEntryDir', () => {
  it('defaults to ~/.local/share/applications', () => {
    expect(desktopEntryDir({}, '/home/deck')).toBe(APPS_DIR);
  });

  it('honors an absolute XDG_DATA_HOME', () => {
    expect(desktopEntryDir({ XDG_DATA_HOME: '/var/data' }, '/home/deck')).toBe(
      '/var/data/applications',
    );
  });

  it('trims XDG_DATA_HOME instead of embedding the space in the path', () => {
    expect(desktopEntryDir({ XDG_DATA_HOME: '/var/data ' }, '/home/deck')).toBe(
      '/var/data/applications',
    );
  });

  it('ignores a relative XDG_DATA_HOME, which the XDG spec calls invalid', () => {
    expect(desktopEntryDir({ XDG_DATA_HOME: '.local/share' }, '/home/deck')).toBe(APPS_DIR);
  });
});

describe('buildDesktopEntry', () => {
  const entry = entryFor(APPIMAGE, APPIMAGE);

  it('is pinned to its exact body', () => {
    // A whole-string pin, not toContain: an ADDED or duplicated key (a second Exec= wins in
    // some parsers) is exactly the regression a substring check cannot see.
    expect(entry).toBe(
      [
        '[Desktop Entry]',
        'Type=Application',
        'Name=World of ClaudeCraft',
        `Exec=${APPIMAGE} %u`,
        `TryExec=${APPIMAGE}`,
        'Icon=world-of-claudecraft',
        'StartupWMClass=World of ClaudeCraft',
        'Terminal=false',
        'Categories=Game;',
        `MimeType=x-scheme-handler/${SCHEME};`,
        '',
      ].join(NL),
    );
  });

  it('passes the URL through as argv with %u', () => {
    // %u is what makes the clicked worldofclaudecraft:// URL reach process.argv, which is where
    // BOTH deep-link paths in main.cjs read it from. %U (plural) or a missing code would launch
    // the game with no URL and the login would hang forever.
    expect(entry).toContain(`Exec=${APPIMAGE} %u`);
  });

  it('carries TryExec for a path with spaces, UNQUOTED', () => {
    // TryExec is a plain path key, not an Exec line: no field codes, no shell parsing, so a
    // space needs no treatment and the quoted Exec form must NOT be copied into it. Gating this
    // on the unquoted-safe set dropped TryExec for exactly the paths most likely to go stale,
    // which is where a launcher most needs it to skip a dead entry.
    const spaced = '/home/deck/My Games/woc.AppImage';
    const entry = entryFor(`${DQUOTE}${spaced}${DQUOTE}`, spaced);
    expect(entry).toContain(`TryExec=${spaced}`);
    expect(entry).toContain(`Exec=${DQUOTE}${spaced}${DQUOTE} %u`);
  });

  it('refuses a tryExecPath it could not represent', () => {
    expect(
      buildDesktopEntry({
        execArgument: '/x',
        scheme: SCHEME,
        productName: PRODUCT_NAME,
        tryExecPath: `/x${NL}Exec=/bin/sh`,
      }),
    ).toBeNull();
  });

  it('is NOT NoDisplay, so it stays hand-pickable in an "open with" dialog', () => {
    expect(entry).not.toContain('NoDisplay');
  });

  it('refuses a productName that would inject extra keys', () => {
    // The module is exported and its safety story is "nothing unrepresentable reaches the
    // file"; that must not depend on every future caller remembering to validate.
    expect(
      buildDesktopEntry({
        execArgument: '/x',
        scheme: SCHEME,
        productName: `World${NL}Exec=/bin/sh`,
      }),
    ).toBeNull();
  });

  it.each([
    ['a malformed scheme', { execArgument: '/x', scheme: 'not a scheme', productName: 'W' }],
    ['an empty exec argument', { execArgument: '', scheme: SCHEME, productName: 'W' }],
    ['a non-string exec argument', { execArgument: 42, scheme: SCHEME, productName: 'W' }],
  ])('refuses %s', (_label, args) => {
    expect(buildDesktopEntry(args)).toBeNull();
  });
});

describe('installDesktopEntry', () => {
  it('writes the entry and associates the scheme on an AppImage run', () => {
    const h = harness();
    const result = installDesktopEntry(h.deps);

    expect(result.status).toBe('installed');
    expect(h.written).toHaveLength(1);
    expect(h.written[0].data).toContain(`Exec=${APPIMAGE} %u`);
  });

  it('writes to a temp file and RENAMES it into place', () => {
    // Atomic within the directory, so a crash or a concurrent second instance can never leave
    // a torn entry, and rename REPLACES a symlink at the destination instead of following it
    // into whatever it points at (a planted symlink would otherwise truncate that target).
    const h = harness();
    installDesktopEntry(h.deps);

    expect(h.written[0].file).not.toBe(ENTRY_PATH);
    expect(h.written[0].file.startsWith(`${ENTRY_PATH}.`)).toBe(true);
    expect(h.written[0].file.endsWith('.tmp')).toBe(true);
    expect(h.renamed).toEqual([{ from: h.written[0].file, to: ENTRY_PATH }]);
  });

  it('writes TryExec even when the AppImage path needs QUOTING in Exec', () => {
    // The decisive level for this: the bug was installDesktopEntry deciding what to hand
    // buildDesktopEntry, not buildDesktopEntry itself, so asserting on the built string alone
    // cannot see it. A spaced path is quoted in Exec and must still appear bare in TryExec.
    const spaced = '/home/deck/My Games/woc.AppImage';
    const h = harness({ env: { APPIMAGE: spaced, HOME: '/home/deck' } });
    installDesktopEntry(h.deps);

    expect(h.written[0].data).toContain(`TryExec=${spaced}`);
    expect(h.written[0].data).toContain(`Exec=${DQUOTE}${spaced}${DQUOTE} %u`);
  });

  it('writes TryExec for a path carrying a percent, which Exec has to escape', () => {
    const pct = '/home/deck/Games 100%/woc.AppImage';
    const h = harness({ env: { APPIMAGE: pct, HOME: '/home/deck' } });
    installDesktopEntry(h.deps);

    // Escaped in Exec (field codes), literal in TryExec (plain path key).
    expect(h.written[0].data).toContain(
      `Exec=${DQUOTE}/home/deck/Games 100%%/woc.AppImage${DQUOTE} %u`,
    );
    expect(h.written[0].data).toContain(`TryExec=${pct}`);
  });

  it('creates the temp file EXCLUSIVELY, so a planted symlink is an error not a write', () => {
    // rename already protects the destination (it replaces rather than follows), but the temp
    // path is predictable, so 'wx' is what stops a same-user process aiming it at another file.
    const h = harness();
    installDesktopEntry(h.deps);
    expect(h.written[0].options).toEqual({ encoding: 'utf8', flag: 'wx' });
  });

  it('cleans up the temp file when the rename fails', () => {
    // Otherwise a failed rename leaves a .tmp behind in the applications directory that nothing
    // ever removes, and the next launch writes another one.
    const h = harness({ renameThrows: true });
    const result = installDesktopEntry(h.deps);

    expect(result.status).toBe('failed');
    expect(h.removed).toEqual([h.written[0].file]);
    result.associate();
    expect(h.ran).toEqual([]);
  });

  it('creates the applications dir RECURSIVELY', () => {
    // Without recursive, a fresh SteamOS or Bazzite home (no ~/.local/share/applications yet)
    // throws ENOENT and the player silently gets no deep link. That is the target machine.
    const h = harness();
    installDesktopEntry(h.deps);
    expect(h.dirs).toEqual([{ dir: APPS_DIR, options: { recursive: true } }]);
  });

  it('rebuilds the MIME cache AND sets the default handler', () => {
    // Two distinct jobs: update-desktop-database makes the association visible at all, xdg-mime
    // promotes it from candidate to default. Dropping either leaves the Discord callback
    // landing in the "choose an application" dialog this whole module exists to fix.
    const h = harness();
    const result = installDesktopEntry(h.deps);

    // Nothing has run yet: the caller owns the timing, so it can keep it clear of Electron's
    // own xdg-settings pass (see the module comment on the shared unlocked file).
    expect(h.ran).toEqual([]);

    result.associate();
    expect(h.ran).toEqual([
      { command: 'update-desktop-database', args: [APPS_DIR] },
      {
        command: 'xdg-mime',
        args: ['default', 'world-of-claudecraft-appimage.desktop', `x-scheme-handler/${SCHEME}`],
      },
    ]);
  });

  it('skips the WRITE but re-asserts the ASSOCIATION when the entry already matches', () => {
    // An unchanged file does not imply an intact association: another app can claim the scheme
    // and a desktop environment can reset mimeapps.list. Re-asserting is what lets a stolen
    // default heal on the next launch instead of breaking Discord login permanently.
    const h = harness({ existing: entryFor(APPIMAGE, APPIMAGE) });
    const result = installDesktopEntry(h.deps);

    expect(result.status).toBe('unchanged');
    expect(h.written).toEqual([]);
    expect(h.renamed).toEqual([]);

    result.associate();
    // Only xdg-mime: the bytes did not change, so the MIME cache already describes this entry
    // and rebuilding it would be a subprocess spent on nothing.
    expect(h.ran.map((r) => r.command)).toEqual(['xdg-mime']);
  });

  it('re-installs when the AppImage moved, so Exec never points at a deleted file', () => {
    const h = harness({ existing: entryFor('/home/deck/Downloads/old.AppImage') });
    const result = installDesktopEntry(h.deps);

    expect(result.status).toBe('installed');
    expect(h.written[0].data).toContain(`Exec=${APPIMAGE} %u`);
  });

  it.each([
    ['a non-AppImage Linux channel (deb, Steam depot, dev run)', { platform: 'linux', env: {} }],
    ['Windows', { platform: 'win32', env: { APPIMAGE } }],
    ['macOS', { platform: 'darwin', env: { APPIMAGE } }],
  ])('is a no-op on %s', (_label, overrides) => {
    const h = harness();
    const result = installDesktopEntry({ ...h.deps, ...overrides });

    expect(result.status).toBe('not-appimage');
    expect(h.written).toEqual([]);
    expect(typeof result.associate).toBe('function');
    result.associate();
    expect(h.ran).toEqual([]);
  });

  it('refuses an AppImage path it cannot encode, and writes nothing', () => {
    const h = harness({ env: { APPIMAGE: `/home/deck/woc${NL}Exec=/bin/sh.AppImage` } });
    const result = installDesktopEntry(h.deps);

    expect(result.status).toBe('unsafe-path');
    expect(h.written).toEqual([]);
    result.associate();
    expect(h.ran).toEqual([]);
    expect(h.deps.log.warn).toHaveBeenCalled();
  });

  it('refuses a non-absolute applications dir instead of writing under the cwd', () => {
    // os.homedir() returns $HOME verbatim on POSIX, so a malformed HOME would otherwise land
    // mkdir and the write on a cwd-relative tree.
    const h = harness();
    const result = installDesktopEntry({ ...h.deps, dir: 'relative/applications' });

    expect(result.status).toBe('unsafe-dir');
    expect(h.written).toEqual([]);
    result.associate();
    expect(h.ran).toEqual([]);
  });

  it.each([
    ['a space', 'not a scheme'],
    ['a leading digit', '1woc'],
    ['a path separator', 'woc/../x'],
    ['an empty string', ''],
    ['a non-string', undefined],
  ])('refuses a scheme with %s', (_label, scheme) => {
    const h = harness();
    const result = installDesktopEntry({ ...h.deps, scheme });

    expect(result.status).toBe('invalid-scheme');
    expect(h.written).toEqual([]);
    result.associate();
    expect(h.ran).toEqual([]);
  });

  it('ACCEPTS a legal non-trivial scheme (positive control)', () => {
    // Without this, a regex tightened to only match the literal 'worldofclaudecraft' passes.
    const h = harness();
    expect(installDesktopEntry({ ...h.deps, scheme: 'x-woc.test+1' }).status).toBe('installed');
  });

  it.each([
    ['the write fails', { writeThrows: true }],
    ['mkdir fails first, as it does on a genuinely read-only home', { mkdirThrows: true }],
  ])('survives when %s, and skips the xdg calls', (_label, opts) => {
    // A failed write must never take the app down: the player can still sign in with a username
    // and password, which never leaves the shell.
    const h = harness(opts);
    const result = installDesktopEntry(h.deps);

    expect(result.status).toBe('failed');
    result.associate();
    expect(h.ran).toEqual([]);
    expect(h.deps.log.warn).toHaveBeenCalled();
  });
});

describe('defaultRunCommand (the real subprocess seam)', () => {
  // Every other test injects a fake runCommand, so without these the shipped path is never
  // exercised. It is also the control on the no-shell invariant: the scanner DOES see this call
  // (it reports linux_url_handler.cjs at the execFile line, demoted to medium), but it cannot
  // judge the OPTIONS object, so a later `shell: true` would pass the gate. It must fail HERE.
  function capture() {
    const calls: Array<{ command: string; args: unknown; options: Record<string, unknown> }> = [];
    const unref = vi.fn();
    const execFile = (
      command: string,
      args: string[],
      options: Record<string, unknown>,
      _cb: (err: unknown) => void,
    ) => {
      calls.push({ command, args, options });
      return { unref };
    };
    return { calls, unref, execFile };
  }

  it('passes an ARRAY argv and NEVER a shell option', () => {
    const c = capture();
    defaultRunCommand(
      'xdg-mime',
      ['default', 'a.desktop', 'x-scheme-handler/woc'],
      undefined,
      c.execFile,
    );

    expect(c.calls).toHaveLength(1);
    expect(c.calls[0].command).toBe('xdg-mime');
    expect(Array.isArray(c.calls[0].args)).toBe(true);
    expect(c.calls[0].args).toEqual(['default', 'a.desktop', 'x-scheme-handler/woc']);
    // Absent, not merely falsy: `shell: false` would pass a truthiness check but shows someone
    // has been editing this options object, which is exactly what should get re-reviewed.
    expect(Object.hasOwn(c.calls[0].options, 'shell')).toBe(false);
    expect(c.calls[0].options.timeout).toBe(5_000);
  });

  it('never interpolates the args into the command string', () => {
    // The single-string form is what would reintroduce shell parsing of a path we do not
    // content-check (the XDG applications dir).
    const c = capture();
    defaultRunCommand('update-desktop-database', [APPS_DIR], undefined, c.execFile);

    expect(c.calls[0].command).toBe('update-desktop-database');
    expect(c.calls[0].command).not.toContain('/home/deck');
    expect(c.calls[0].command).not.toContain(' ');
  });

  it('unrefs the child, and bounds it with a timeout', () => {
    // The timeout is what actually bounds a hang: execFile with a callback keeps the stdout and
    // stderr pipes ref'd, so unref on the process handle does not by itself release the loop.
    // Both are asserted because both are deliberate.
    const c = capture();
    defaultRunCommand('xdg-mime', [], undefined, c.execFile);
    expect(c.unref).toHaveBeenCalled();
  });

  it('swallows a spawn throw and warns instead of taking the app down', () => {
    const log = { info: vi.fn(), warn: vi.fn() };
    const throwing = () => {
      throw new Error('ENOENT: xdg-mime not installed');
    };
    expect(() => defaultRunCommand('xdg-mime', [], log, throwing)).not.toThrow();
    expect(log.warn).toHaveBeenCalled();
  });
});

describe('configureLinuxDesktopName', () => {
  it('points CHROME_DESKTOP at the filename that actually exists on disk', () => {
    // Electron infers the name from app.name ("World of ClaudeCraft.desktop"), but
    // electron-builder names the real file after executableName. Without this correction
    // setAsDefaultProtocolClient hands xdg-settings a name matching nothing, on the deb too.
    const env: Record<string, string | undefined> = {
      APPIMAGE,
      CHROME_DESKTOP: 'World of ClaudeCraft.desktop',
    };
    const out = configureLinuxDesktopName({
      platform: 'linux',
      env,
      dir: APPS_DIR,
      fileExists: () => true,
    });

    expect(out.desktopName).toBe(APPIMAGE_ENTRY_NAME);
    expect(env.CHROME_DESKTOP).toBe('world-of-claudecraft-appimage.desktop');
  });

  it('leaves CHROME_DESKTOP ALONE when no such entry exists anywhere', () => {
    // The Steam depot, the Epic package and a dev run have no entry. Pointing xdg-settings at
    // a dangling name there could REPLACE a working association (an AppImageLauncher entry,
    // say) with a broken one: strictly worse than doing nothing.
    const env: Record<string, string | undefined> = { CHROME_DESKTOP: 'other.desktop' };
    const out = configureLinuxDesktopName({
      platform: 'linux',
      env,
      dir: APPS_DIR,
      fileExists: () => false,
    });

    expect(out.desktopName).toBeNull();
    expect(env.CHROME_DESKTOP).toBe('other.desktop');
  });

  it('accepts the DEB entry in /usr/share/applications, not just our own', () => {
    const env: Record<string, string | undefined> = {};
    const seen: string[] = [];
    const out = configureLinuxDesktopName({
      platform: 'linux',
      env,
      dir: APPS_DIR,
      fileExists: (p: string) => {
        seen.push(p);
        return p === `/usr/share/applications/${DEB_ENTRY_NAME}`;
      },
    });

    // Reports the DEB's name here, not ours: we never wrote a user-level entry on this box, so
    // pointing CHROME_DESKTOP at our filename would name a file that does not exist.
    expect(out.desktopName).toBe(DEB_ENTRY_NAME);
    expect(seen).toContain(`/usr/share/applications/${DEB_ENTRY_NAME}`);
  });

  it.each([
    ['an AppImage run picks OURS', { APPIMAGE }, APPIMAGE_ENTRY_NAME],
    ['a deb run picks THEIRS, even with ours present', {}, DEB_ENTRY_NAME],
  ])('%s when both entries exist', (_label, env, expected) => {
    // The channel decides, not merely which file exists. Preferring ours unconditionally made a
    // deb launch hand xdg-settings the AppImage's filename, so the deb player's scheme resolved
    // to the AppImage and TryExec finished it off once that AppImage was deleted. Same
    // shadowing the distinct filename prevents, reached through CHROME_DESKTOP instead.
    const out = configureLinuxDesktopName({
      platform: 'linux',
      env: env as Record<string, string | undefined>,
      dir: APPS_DIR,
      fileExists: () => true,
    });
    expect(out.desktopName).toBe(expected);
  });

  it('a deb run with ONLY a stale AppImage entry registers nothing', () => {
    // The dangerous shape: the player tried the AppImage once, then installed the deb. Naming
    // our entry here would point the deb's scheme at a file it does not own and cannot repair.
    const env: Record<string, string | undefined> = {};
    const out = configureLinuxDesktopName({
      platform: 'linux',
      env,
      dir: APPS_DIR,
      fileExists: (p: string) => p.includes('-appimage.desktop'),
    });

    expect(out.desktopName).toBeNull();
    expect(env.CHROME_DESKTOP).toBeUndefined();
  });

  it('an AppImage run falls back to the deb entry when ours is missing', () => {
    const out = configureLinuxDesktopName({
      platform: 'linux',
      env: { APPIMAGE },
      dir: APPS_DIR,
      fileExists: (p: string) => p === `/usr/share/applications/${DEB_ENTRY_NAME}`,
    });
    expect(out.desktopName).toBe(DEB_ENTRY_NAME);
  });

  it('restore() puts a previous value back exactly', () => {
    const env: Record<string, string | undefined> = {
      APPIMAGE,
      CHROME_DESKTOP: 'previous.desktop',
    };
    const out = configureLinuxDesktopName({
      platform: 'linux',
      env,
      dir: APPS_DIR,
      fileExists: () => true,
    });
    expect(env.CHROME_DESKTOP).toBe(APPIMAGE_ENTRY_NAME);

    out.restore();
    expect(env.CHROME_DESKTOP).toBe('previous.desktop');
  });

  it('restore() DELETES the key when there was none, rather than leaving undefined', () => {
    // A lingering CHROME_DESKTOP=undefined would still be inherited by children as the string
    // "undefined" through some spawn paths; the key must genuinely go away.
    const env: Record<string, string | undefined> = {};
    const out = configureLinuxDesktopName({
      platform: 'linux',
      env,
      dir: APPS_DIR,
      fileExists: () => true,
    });
    out.restore();

    expect(Object.hasOwn(env, 'CHROME_DESKTOP')).toBe(false);
  });

  it.each(['win32', 'darwin'])('leaves %s alone (no xdg-settings path there)', (platform) => {
    const env: Record<string, string | undefined> = {};
    const out = configureLinuxDesktopName({ platform, env, fileExists: () => true });

    expect(out.desktopName).toBeNull();
    expect(env.CHROME_DESKTOP).toBeUndefined();
  });
});

describe('registerLinuxUrlHandler', () => {
  it('installs the entry AND then corrects the desktop name', () => {
    // Ordering inside the composite matters: the name check gates on the entry existing, which
    // the install may have only just created.
    const h = harness({ entryExists: true });
    const result = registerLinuxUrlHandler(h.deps);

    expect(result.status).toBe('installed');
    expect(result.desktopName).toBe('world-of-claudecraft-appimage.desktop');
    expect(h.deps.env.CHROME_DESKTOP).toBe('world-of-claudecraft-appimage.desktop');
    result.restore();
    expect(Object.hasOwn(h.deps.env, 'CHROME_DESKTOP')).toBe(false);
  });

  it('still corrects the desktop name on the deb, where there is no entry to write', () => {
    const env: Record<string, string | undefined> = {};
    const result = registerLinuxUrlHandler({
      platform: 'linux',
      env,
      scheme: SCHEME,
      dir: APPS_DIR,
      // Only the deb's system entry exists on this box; we never wrote a user-level one.
      fileExists: (p: string) => p === `/usr/share/applications/${DEB_ENTRY_NAME}`,
    });

    expect(result.status).toBe('not-appimage');
    // The DEB's name: on that channel we never write an entry, so ours would not exist.
    expect(result.desktopName).toBe('world-of-claudecraft.desktop');
    expect(env.CHROME_DESKTOP).toBe('world-of-claudecraft.desktop');
  });

  it('does nothing at all off Linux, and still hands back a usable restore()', () => {
    const env: Record<string, string | undefined> = { APPIMAGE };
    const result = registerLinuxUrlHandler({ platform: 'win32', env, scheme: SCHEME });

    expect(result.status).toBe('not-appimage');
    expect(result.desktopName).toBeNull();
    expect(env.CHROME_DESKTOP).toBeUndefined();
    expect(() => result.restore()).not.toThrow();
  });
});

describe('installDesktopEntry against a REAL filesystem', () => {
  // Everything above injects fs, so the production default layer (desktopEntryDir from
  // XDG_DATA_HOME, real mkdir/write/rename) is otherwise never executed. This exercises it end
  // to end with only the subprocesses faked.
  const root = mkdtempSync(path.join(tmpdir(), 'woc-urlhandler-'));
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  const ran: Ran[] = [];
  const deps = {
    platform: 'linux',
    scheme: SCHEME,
    env: { APPIMAGE, XDG_DATA_HOME: root },
    runCommand: (command: string, args: string[]) => ran.push({ command, args }),
    log: { info: vi.fn(), warn: vi.fn() },
  };
  const expectedFile = path.join(root, 'applications', APPIMAGE_ENTRY_NAME);

  it('derives the path from XDG_DATA_HOME and really creates the file', () => {
    const result = installDesktopEntry(deps);

    expect(result.status).toBe('installed');
    expect(result.file).toBe(expectedFile);
    expect(existsSync(expectedFile)).toBe(true);
    expect(readFileSync(expectedFile, 'utf8')).toContain(`Exec=${APPIMAGE} %u`);
    // The default productName, which main.cjs never passes, reaches the real file.
    expect(readFileSync(expectedFile, 'utf8')).toContain(`Name=${PRODUCT_NAME}`);
  });

  it('leaves no temp file behind', () => {
    const { readdirSync } = require('node:fs');
    expect(
      readdirSync(path.join(root, 'applications')).filter((f: string) => f.endsWith('.tmp')),
    ).toEqual([]);
  });

  it('is idempotent on a second run against the file it just wrote', () => {
    ran.length = 0;
    const result = installDesktopEntry(deps);

    expect(result.status).toBe('unchanged');
    result.associate();
    // Still re-asserts the association (the self-heal path), but only the part that asserts
    // anything: the bytes are unchanged, so the MIME cache already describes this entry.
    expect(ran.map((r) => r.command)).toEqual(['xdg-mime']);
  });

  it('REPLACES a symlink at the destination instead of writing through it', () => {
    // A same-uid process could plant a symlink here; a plain write would truncate its target.
    const { symlinkSync, unlinkSync } = require('node:fs');
    const victim = path.join(root, 'victim.txt');
    writeFileSync(victim, 'untouched', 'utf8');
    unlinkSync(expectedFile);
    symlinkSync(victim, expectedFile);

    expect(installDesktopEntry(deps).status).toBe('installed');
    expect(readFileSync(victim, 'utf8')).toBe('untouched');
    expect(readFileSync(expectedFile, 'utf8')).toContain('[Desktop Entry]');
  });
});
