import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  DESKTOP_PREFS_FILENAME,
  DESKTOP_PREFS_VERSION,
  defaultDesktopPrefs,
  desktopPrefsTempPath,
  loadDesktopPrefs,
  MAX_PREFS_FILE_BYTES,
  sanitizeDesktopPrefs,
  saveDesktopPrefs,
} from '../electron/desktop_prefs.cjs';

// The prefs file is the shell's only piece of persistence and it is UNTRUSTED
// input (a user-writable path, hand-editable, truncatable by a crash), so every
// arm below is about the loader refusing to trust it: never throwing, never
// handing back file content, and always answering a complete object the boot
// path can read fields off blindly.

const scratch = mkdtempSync(join(tmpdir(), 'woc-desktop-prefs-'));
const scratchPath = (name: string) => join(scratch, name);

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

describe('desktop prefs schema', () => {
  it('pins the stored filename and schema version to their literals', () => {
    // Both are on-disk contract: main.cjs joins the filename onto userData, and
    // the version decides whether a file is honored at all.
    expect(DESKTOP_PREFS_FILENAME).toBe('desktop-prefs.json');
    expect(DESKTOP_PREFS_VERSION).toBe(1);
    expect(MAX_PREFS_FILE_BYTES).toBe(65536);
  });

  it('defaults to no window memory, not maximized, GPU force ON', () => {
    // The GPU force is the shipped behavior; the opt-out is opt-IN, so a fresh
    // or unusable store must never read as "the player asked to disable it".
    expect(defaultDesktopPrefs()).toEqual({
      version: 1,
      maximized: false,
      gpuForceOptOut: false,
      displayMode: 'borderless',
      discordPresenceEnabled: true,
    });
  });

  it('accepts exactly the whitelisted fields and drops everything else', () => {
    const prefs = sanitizeDesktopPrefs({
      version: 1,
      windowBounds: { x: 40, y: 60, width: 1600, height: 1000 },
      displayId: 12345,
      maximized: true,
      gpuForceOptOut: true,
      displayMode: 'windowed',
      discordPresenceEnabled: false,
      // Junk a hand-edited file could carry; none of it may survive.
      apiOrigin: 'https://evil.example',
      extra: 'nope',
    });
    expect(prefs).toEqual({
      version: 1,
      windowBounds: { x: 40, y: 60, width: 1600, height: 1000 },
      displayId: 12345,
      maximized: true,
      gpuForceOptOut: true,
      displayMode: 'windowed',
      discordPresenceEnabled: false,
    });
    expect(Object.keys(prefs).sort()).toEqual([
      'discordPresenceEnabled',
      'displayId',
      'displayMode',
      'gpuForceOptOut',
      'maximized',
      'version',
      'windowBounds',
    ]);
  });

  it('never returns or mutates the parsed object', () => {
    // The returned object is handed to main.cjs, which mutates it all session;
    // a shared reference would mean file content living on inside live state.
    const parsed = {
      version: 1,
      windowBounds: { x: 10, y: 20, width: 1200, height: 800 },
      maximized: false,
      gpuForceOptOut: false,
    };
    const prefs = sanitizeDesktopPrefs(parsed);
    expect(prefs).not.toBe(parsed);
    expect(prefs.windowBounds).not.toBe(parsed.windowBounds);
    prefs.gpuForceOptOut = true;
    if (prefs.windowBounds) prefs.windowBounds.x = 999;
    expect(parsed.gpuForceOptOut).toBe(false);
    expect(parsed.windowBounds.x).toBe(10);
  });

  it('rejects a non-object root', () => {
    for (const junk of [null, undefined, 42, 'prefs', [1, 2, 3], true]) {
      expect(sanitizeDesktopPrefs(junk)).toEqual(defaultDesktopPrefs());
    }
  });

  it('discards a file stamped with an unknown schema version', () => {
    const stored = {
      version: 2,
      windowBounds: { x: 10, y: 20, width: 1200, height: 800 },
      displayId: 7,
      maximized: true,
      gpuForceOptOut: true,
    };
    expect(sanitizeDesktopPrefs(stored)).toEqual(defaultDesktopPrefs());
    expect(sanitizeDesktopPrefs({ ...stored, version: '1' })).toEqual(defaultDesktopPrefs());
    // An ABSENT version is honored: every field is validated on its own merits.
    const { version: _dropped, ...unversioned } = stored;
    expect(sanitizeDesktopPrefs(unversioned).displayId).toBe(7);
  });

  it('takes booleans strictly, per field', () => {
    // One arm per field: a shared truthiness helper that regressed on one call
    // site would still pass a test that only exercised the other.
    for (const truthy of ['true', 1, {}, 'yes']) {
      expect(sanitizeDesktopPrefs({ version: 1, maximized: truthy }).maximized).toBe(false);
      expect(sanitizeDesktopPrefs({ version: 1, gpuForceOptOut: truthy }).gpuForceOptOut).toBe(
        false,
      );
    }
    expect(sanitizeDesktopPrefs({ version: 1, maximized: true }).maximized).toBe(true);
    expect(sanitizeDesktopPrefs({ version: 1, gpuForceOptOut: true }).gpuForceOptOut).toBe(true);
    expect(sanitizeDesktopPrefs({ version: 1, maximized: false }).maximized).toBe(false);
  });

  it('takes the Discord presence toggle strictly, defaulting to ON', () => {
    // Its default is the opposite polarity from the other two booleans, so the
    // junk arms here prove the FALLBACK is per field rather than a shared
    // false: a helper that hardcoded false would pass every arm above and turn
    // this feature off for every player who never touched the setting.
    for (const junk of ['false', 'true', 0, 1, null, {}, 'no']) {
      expect(
        sanitizeDesktopPrefs({ version: 1, discordPresenceEnabled: junk }).discordPresenceEnabled,
        `discordPresenceEnabled ${JSON.stringify(junk)} must resolve to the default`,
      ).toBe(true);
    }
    expect(
      sanitizeDesktopPrefs({ version: 1, discordPresenceEnabled: false }).discordPresenceEnabled,
    ).toBe(false);
    expect(
      sanitizeDesktopPrefs({ version: 1, discordPresenceEnabled: true }).discordPresenceEnabled,
    ).toBe(true);
    // Absent is the normal reading of a file written before the field existed,
    // which is why the schema version did not move for it.
    expect(sanitizeDesktopPrefs({ version: 1, maximized: true }).discordPresenceEnabled).toBe(true);
  });

  it('takes the display mode as an exact literal, defaulting to borderless', () => {
    // The stored mode is fed straight to setFullScreen at the reveal, so a
    // near-miss has to land on the default rather than on whichever branch a
    // loose comparison would take. Case variants are junk on purpose.
    expect(sanitizeDesktopPrefs({ version: 1, displayMode: 'borderless' }).displayMode).toBe(
      'borderless',
    );
    expect(sanitizeDesktopPrefs({ version: 1, displayMode: 'windowed' }).displayMode).toBe(
      'windowed',
    );
    for (const junk of ['BORDERLESS', 'Windowed', 'full', 'fullscreen', '', 1, 0, null, true, {}]) {
      expect(
        sanitizeDesktopPrefs({ version: 1, displayMode: junk }).displayMode,
        `displayMode ${JSON.stringify(junk)} must resolve to the default`,
      ).toBe('borderless');
    }
    // Absent is the normal reading of a file written before the field existed,
    // which is why the schema version did not move for it.
    expect(sanitizeDesktopPrefs({ version: 1, maximized: true }).displayMode).toBe('borderless');
  });

  it('drops window bounds unless every field is a finite integer', () => {
    const good = { x: 0, y: 0, width: 1440, height: 900 };
    expect(sanitizeDesktopPrefs({ version: 1, windowBounds: good }).windowBounds).toEqual(good);
    // One bad field per case, so each field's check is exercised on its own.
    for (const bad of [
      { ...good, x: Number.NaN },
      { ...good, y: Number.POSITIVE_INFINITY },
      { ...good, width: 1440.5 },
      { ...good, height: '900' },
      { x: 0, y: 0, width: 1440 },
      'bounds',
      null,
    ]) {
      expect(
        sanitizeDesktopPrefs({ version: 1, windowBounds: bad }).windowBounds,
        `bounds should have been dropped: ${JSON.stringify(bad)}`,
      ).toBeUndefined();
    }
  });

  it('clamps sizes to the window minimums and the sanity ceiling', () => {
    const tiny = sanitizeDesktopPrefs({
      version: 1,
      windowBounds: { x: 0, y: 0, width: 10, height: 10 },
    }).windowBounds;
    expect(tiny).toEqual({ x: 0, y: 0, width: 1024, height: 720 });
    const huge = sanitizeDesktopPrefs({
      version: 1,
      windowBounds: { x: 99999, y: -99999, width: 99999, height: 99999 },
    }).windowBounds;
    expect(huge).toEqual({ x: 32767, y: -32768, width: 16384, height: 16384 });
  });

  it('keeps a non-integer displayId out of the store', () => {
    expect(sanitizeDesktopPrefs({ version: 1, displayId: 'primary' }).displayId).toBeUndefined();
    expect(sanitizeDesktopPrefs({ version: 1, displayId: 1.5 }).displayId).toBeUndefined();
    expect(sanitizeDesktopPrefs({ version: 1, displayId: 0 }).displayId).toBe(0);
  });
});

describe('loadDesktopPrefs', () => {
  it('answers defaults for a file that does not exist', () => {
    expect(loadDesktopPrefs(scratchPath('missing.json'))).toEqual(defaultDesktopPrefs());
  });

  it('round-trips a real save through a real file', () => {
    const filePath = scratchPath('nested/roundtrip.json');
    const saved = {
      version: 1,
      windowBounds: { x: 120, y: 80, width: 1600, height: 1000 },
      displayId: 4242,
      maximized: true,
      gpuForceOptOut: true,
      displayMode: 'windowed',
      discordPresenceEnabled: false,
    };
    expect(saveDesktopPrefs(filePath, saved)).toBe(true);
    // mkdir recursive: the userData subdirectory may not exist on a first run.
    expect(existsSync(filePath)).toBe(true);
    // Expectation built fresh, never compared against the object we passed in.
    expect(loadDesktopPrefs(filePath)).toEqual({
      version: 1,
      windowBounds: { x: 120, y: 80, width: 1600, height: 1000 },
      displayId: 4242,
      maximized: true,
      gpuForceOptOut: true,
      displayMode: 'windowed',
      // An OFF toggle survives the file: the default is ON, so a field that
      // failed to persist would read back as the value the player rejected.
      discordPresenceEnabled: false,
    });
  });

  it('answers defaults for unparseable JSON', () => {
    const filePath = scratchPath('corrupt.json');
    writeFileSync(filePath, '{"version": 1, "maximi', 'utf8');
    expect(loadDesktopPrefs(filePath)).toEqual(defaultDesktopPrefs());
  });

  it('answers defaults for a JSON root that is not an object', () => {
    const filePath = scratchPath('array.json');
    writeFileSync(filePath, '[1,2,3]', 'utf8');
    expect(loadDesktopPrefs(filePath)).toEqual(defaultDesktopPrefs());
  });

  it('refuses an oversized file WITHOUT parsing it', () => {
    const filePath = scratchPath('huge.json');
    // Valid JSON that would otherwise load cleanly, padded past the cap: the
    // size gate must win, so this cannot pass by way of a parse failure.
    const padding = ' '.repeat(MAX_PREFS_FILE_BYTES + 1);
    writeFileSync(filePath, `{"version":1,"gpuForceOptOut":true}${padding}`, 'utf8');
    expect(loadDesktopPrefs(filePath)).toEqual(defaultDesktopPrefs());
    // The same content under the cap DOES load, proving the size is the reason.
    const smallPath = scratchPath('small.json');
    writeFileSync(smallPath, '{"version":1,"gpuForceOptOut":true}', 'utf8');
    expect(loadDesktopPrefs(smallPath).gpuForceOptOut).toBe(true);
    // And the refusal must come from the STAT, before any read: the text guard
    // downstream would also refuse an oversized body, but only after bringing
    // the whole file into memory, so "without parsing it" needs its own arm
    // (the real-file case above cannot tell the two guards apart).
    const reads: string[] = [];
    expect(
      loadDesktopPrefs('/oversized/prefs.json', {
        statSync: () => ({ size: MAX_PREFS_FILE_BYTES + 1, isFile: () => true }),
        readFileSync: (readPath: string) => {
          reads.push(readPath);
          return '{}';
        },
      }),
    ).toEqual(defaultDesktopPrefs());
    expect(reads, 'the size gate must refuse BEFORE the read').toEqual([]);
  });

  it('accepts a file at exactly the size cap (the bound is strictly greater)', () => {
    // The refusal arm above proves cap+1 is rejected; this arm sits ON the cap
    // so a strictly-greater bound quietly tightening to greater-or-equal fails
    // a test instead of shrinking the accepted range by one byte.
    const filePath = scratchPath('at-cap.json');
    const content = '{"version":1,"gpuForceOptOut":true}';
    writeFileSync(filePath, content + ' '.repeat(MAX_PREFS_FILE_BYTES - content.length), 'utf8');
    expect(loadDesktopPrefs(filePath).gpuForceOptOut).toBe(true);
  });

  it('caps and type-checks the TEXT independently of the stat gate', () => {
    // stat and read are two syscalls on the same untrusted path: a stat that
    // under-reports (or a file that grew between the two) must not smuggle an
    // oversized body past the cap, so the post-read guard has to bind on its
    // own, exercised here with the stat lying small.
    const lyingStat = () => ({ size: 10, isFile: () => true });
    const oversized = `{"version":1,"gpuForceOptOut":true}${' '.repeat(MAX_PREFS_FILE_BYTES)}`;
    expect(
      loadDesktopPrefs('/lying/prefs.json', {
        statSync: lyingStat,
        readFileSync: () => oversized,
      }),
    ).toEqual(defaultDesktopPrefs());
    // A read that answers something other than a string (a fake, or an encoding
    // surprise) is refused by the same guard rather than reaching JSON.parse.
    expect(
      loadDesktopPrefs('/lying/prefs.json', {
        statSync: lyingStat,
        readFileSync: () => Buffer.from('{"version":1,"gpuForceOptOut":true}'),
      }),
    ).toEqual(defaultDesktopPrefs());
    // The same rig with a sane string body loads, proving the guard above is
    // what refused the other two, not the lying stat.
    expect(
      loadDesktopPrefs('/lying/prefs.json', {
        statSync: lyingStat,
        readFileSync: () => '{"version":1,"gpuForceOptOut":true}',
      }).gpuForceOptOut,
    ).toBe(true);
  });

  it('honors a hand-edit saved as UTF-8 with a BOM', () => {
    // Hand-editing this file is the documented no-boot rescue, and a Windows
    // editor's "UTF-8 with BOM" prepends U+FEFF, which JSON.parse rejects.
    // Refusing the file would silently resolve to defaults and force the GPU
    // back ON, the exact state the rescue edit exists to escape.
    const filePath = scratchPath('bom.json');
    writeFileSync(filePath, '\uFEFF{"version":1,"gpuForceOptOut":true}', 'utf8');
    expect(loadDesktopPrefs(filePath).gpuForceOptOut).toBe(true);
    // Exactly one BOM is stripped: a doubled BOM is still corrupt JSON.
    const doublePath = scratchPath('double-bom.json');
    writeFileSync(doublePath, '\uFEFF\uFEFF{"version":1,"gpuForceOptOut":true}', 'utf8');
    expect(loadDesktopPrefs(doublePath)).toEqual(defaultDesktopPrefs());
  });

  it('never throws when the filesystem does', () => {
    const boom = () => {
      throw new Error('EACCES');
    };
    expect(loadDesktopPrefs('/nope/prefs.json', { statSync: boom })).toEqual(defaultDesktopPrefs());
    expect(
      loadDesktopPrefs('/nope/prefs.json', {
        statSync: () => ({ size: 10, isFile: () => true }),
        readFileSync: boom,
      }),
    ).toEqual(defaultDesktopPrefs());
  });

  it('never reads a path that is not a regular file', () => {
    // The hang-proof. A FIFO left at the prefs path (or a symlink to one, since
    // statSync follows) reports size 0 and then blocks its reader FOREVER, and
    // this read is the first thing main.cjs does: the shell would hang before
    // any window exists, showing the player nothing at all. So the file type
    // has to be checked before the read, and the read must never be reached.
    let reads = 0;
    const readFileSync = () => {
      reads += 1;
      return '{"version":1,"gpuForceOptOut":true}';
    };
    expect(
      loadDesktopPrefs('/tmp/prefs-fifo', {
        statSync: () => ({ size: 0, isFile: () => false }),
        readFileSync,
      }),
    ).toEqual(defaultDesktopPrefs());
    expect(reads, 'a non-regular file must never be read').toBe(0);
    // The same stub reporting a regular file DOES get read, so the arm above
    // fails on the file type rather than on some unrelated stub mismatch.
    expect(
      loadDesktopPrefs('/tmp/prefs-fifo', {
        statSync: () => ({ size: 35, isFile: () => true }),
        readFileSync,
      }).gpuForceOptOut,
    ).toBe(true);
    expect(reads).toBe(1);
  });

  it('cannot be used to pollute Object.prototype', () => {
    const filePath = scratchPath('proto.json');
    writeFileSync(
      filePath,
      '{"__proto__":{"polluted":"yes"},"version":1,"maximized":true}',
      'utf8',
    );
    const prefs = loadDesktopPrefs(filePath);
    // Only whitelisted fields are ever copied onto a fresh object, so the
    // payload contributes nothing. The maximized:true beside it still lands,
    // which proves the file was read rather than rejected wholesale.
    expect(prefs).toEqual({
      version: 1,
      maximized: true,
      gpuForceOptOut: false,
      displayMode: 'borderless',
      discordPresenceEnabled: true,
    });
    expect(Object.prototype).not.toHaveProperty('polluted');
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.getPrototypeOf(prefs)).toBe(Object.prototype);
  });
});

describe('saveDesktopPrefs', () => {
  it('writes through an exclusive fd, fsyncs it BEFORE the rename, then fsyncs the directory', () => {
    const calls: string[] = [];
    let staged = '';
    let nextFd = 40;
    const filePath = '/userdata/desktop-prefs.json';
    const ok = saveDesktopPrefs(
      filePath,
      { version: 1, gpuForceOptOut: true },
      {
        mkdirSync: (dir, options) => calls.push(`mkdir:${dir}:${options.recursive}`),
        openSync: (target, flags) => {
          if (flags === 'wx') staged = target;
          calls.push(`open:${flags === 'wx' ? '<staged>' : target}:${flags}`);
          nextFd += 1;
          return nextFd;
        },
        writeFileSync: (fd, data, options) => calls.push(`write:${fd}:${data}:${options.encoding}`),
        fsyncSync: (fd) => calls.push(`fsync:${fd}`),
        closeSync: (fd) => calls.push(`close:${fd}`),
        renameSync: (from, to) => calls.push(`rename:${from === staged ? '<staged>' : from}:${to}`),
      },
    );
    expect(ok).toBe(true);
    // The exact syscall order is the durability contract. 'wx' is O_EXCL (the
    // anti-symlink defense, a string a typo would silently downgrade to a
    // following write); the data fsync sits BEFORE the rename, because a
    // journal-reordering filesystem may otherwise commit the rename ahead of
    // the data blocks and a power loss then lands an EMPTY prefs file at the
    // real path (losing gpuForceOptOut on exactly the machine that crashes);
    // and the directory fsync after the rename is what makes the rename itself
    // durable where the platform allows it.
    expect(calls).toEqual([
      'mkdir:/userdata:true',
      'open:<staged>:wx',
      'write:41:{"version":1,"maximized":false,"gpuForceOptOut":true,"displayMode":"borderless","discordPresenceEnabled":true}:utf8',
      'fsync:41',
      'close:41',
      'rename:<staged>:/userdata/desktop-prefs.json',
      'open:/userdata:r',
      'fsync:42',
      'close:42',
    ]);
    // Staged beside the target, under an unpredictable name: a fixed sibling is
    // a path another local process can pre-create and wait on.
    expect(staged.startsWith('/userdata/desktop-prefs.json.')).toBe(true);
    expect(staged).toMatch(/\.\d+-[0-9a-f]{8}\.tmp$/);
    expect(staged).not.toBe('/userdata/desktop-prefs.json.tmp');
  });

  it('treats the directory fsync as best-effort: a platform that refuses it still saves', () => {
    // Windows cannot open (let alone fsync) a directory, so the post-rename
    // directory sync is advisory there; a save must not report failure for it,
    // or every Windows toggle would read as "did not stick" while the file is
    // actually on disk.
    const noop = () => {};
    let opens = 0;
    expect(
      saveDesktopPrefs(
        '/x/prefs.json',
        { version: 1, gpuForceOptOut: true },
        {
          mkdirSync: noop,
          openSync: (_target, flags) => {
            opens += 1;
            if (flags === 'r') throw new Error('EISDIR');
            return 7;
          },
          writeFileSync: noop,
          fsyncSync: noop,
          closeSync: noop,
          renameSync: noop,
        },
      ),
    ).toBe(true);
    expect(opens, 'the directory open must really have been attempted').toBe(2);
    // A directory that opens but refuses the fsync itself is the same answer.
    let fsyncs = 0;
    expect(
      saveDesktopPrefs(
        '/x/prefs.json',
        { version: 1, gpuForceOptOut: true },
        {
          mkdirSync: noop,
          openSync: () => 7,
          writeFileSync: noop,
          fsyncSync: () => {
            fsyncs += 1;
            if (fsyncs === 2) throw new Error('EINVAL');
          },
          closeSync: noop,
          renameSync: noop,
        },
      ),
    ).toBe(true);
    expect(fsyncs, 'the directory fsync must really have been attempted').toBe(2);
  });

  it('mints a different scratch path on every save', () => {
    // Two saves in a row must not collide on the same name, or the second would
    // hit its own leftover and refuse.
    const paths = new Set<string>();
    for (let i = 0; i < 50; i += 1) paths.add(desktopPrefsTempPath('/userdata/prefs.json'));
    expect(paths.size).toBeGreaterThan(45);
    // The injected source is what makes the path knowable in the symlink test
    // below, so prove it actually steers the name.
    expect(desktopPrefsTempPath('/userdata/prefs.json', () => 0.5)).toBe(
      desktopPrefsTempPath('/userdata/prefs.json', () => 0.5),
    );
    expect(desktopPrefsTempPath('/userdata/prefs.json', () => 0.5)).not.toBe(
      desktopPrefsTempPath('/userdata/prefs.json', () => 0.25),
    );
  });

  it('refuses to write through a pre-existing scratch path, leaving its target alone', () => {
    // The attack this closes: another local process pre-creates the scratch
    // path as a symlink to a file it wants overwritten, and every save writes
    // through it. O_EXCL refuses the symlink instead of following it.
    const victimPath = scratchPath('victim.txt');
    const targetPath = scratchPath('planted/desktop-prefs.json');
    writeFileSync(victimPath, 'victim bytes', 'utf8');
    const random = () => 0.42;
    const tempPath = desktopPrefsTempPath(targetPath, random);
    expect(tempPath, 'the scratch path must keep its shape').toMatch(/\.\d+-[0-9a-f]{8}\.tmp$/);
    // The plant has to sit where the save will stage, so the directory exists
    // before the save (which would otherwise create it itself).
    mkdirSync(join(scratch, 'planted'), { recursive: true });
    symlinkSync(victimPath, tempPath);

    expect(saveDesktopPrefs(targetPath, { version: 1, gpuForceOptOut: true }, { random })).toBe(
      false,
    );
    expect(readFileSync(victimPath, 'utf8'), 'the victim file was written through').toBe(
      'victim bytes',
    );
    expect(existsSync(targetPath), 'nothing may reach the target on a refused save').toBe(false);
    // The refused path is deliberately left as it was found: it is not ours to
    // delete, and the exclusive write already made it harmless.
    expect(lstatSync(tempPath).isSymbolicLink()).toBe(true);

    // A later save mints a different scratch path and succeeds, so one planted
    // path cannot wedge the store forever.
    expect(saveDesktopPrefs(targetPath, { version: 1, gpuForceOptOut: true })).toBe(true);
    expect(loadDesktopPrefs(targetPath).gpuForceOptOut).toBe(true);
    expect(readFileSync(victimPath, 'utf8')).toBe('victim bytes');
  });

  it('validates on the way OUT, so junk is never persisted', () => {
    const filePath = scratchPath('sanitized.json');
    expect(
      saveDesktopPrefs(filePath, {
        version: 1,
        windowBounds: { x: 5, y: 5, width: 10, height: 10 },
        displayId: 'primary',
        maximized: 'yes',
        gpuForceOptOut: true,
        secret: 'do not persist me',
      }),
    ).toBe(true);
    const raw = readFileSync(filePath, 'utf8');
    expect(raw).not.toContain('secret');
    expect(raw).not.toContain('primary');
    expect(JSON.parse(raw)).toEqual({
      version: 1,
      windowBounds: { x: 5, y: 5, width: 1024, height: 720 },
      maximized: false,
      gpuForceOptOut: true,
      displayMode: 'borderless',
      discordPresenceEnabled: true,
    });
  });

  it('cleans up the scratch file it created, and only that one', () => {
    const noop = () => {};
    // A rename that fails after a successful staging write leaves OUR file
    // behind, and a save that fails once per toggle would litter the directory.
    const unlinked: string[] = [];
    let staged = '';
    expect(
      saveDesktopPrefs(
        '/x/prefs.json',
        { version: 1 },
        {
          mkdirSync: noop,
          openSync: (target: string) => {
            staged = target;
            return 7;
          },
          writeFileSync: noop,
          fsyncSync: noop,
          closeSync: noop,
          renameSync: () => {
            throw new Error('EXDEV');
          },
          unlinkSync: (target) => unlinked.push(target),
        },
      ),
    ).toBe(false);
    expect(unlinked).toEqual([staged]);

    // The other polarity: the exclusive open REFUSED, so that path was already
    // there, is not ours, and must be left exactly as found. Deleting it would
    // hand back the clobber the exclusive open just prevented.
    const refusedUnlinks: string[] = [];
    expect(
      saveDesktopPrefs(
        '/x/prefs.json',
        { version: 1 },
        {
          mkdirSync: noop,
          openSync: () => {
            throw new Error('EEXIST');
          },
          writeFileSync: noop,
          fsyncSync: noop,
          closeSync: noop,
          renameSync: noop,
          unlinkSync: (target) => refusedUnlinks.push(target),
        },
      ),
    ).toBe(false);
    expect(refusedUnlinks, 'a path we did not create must never be unlinked').toEqual([]);
  });

  it('closes the staged fd on the failure path, so a failing save cannot leak handles', () => {
    // A write or fsync that throws leaves the exclusive fd open; without the
    // close in the catch, a save failing once per toggle would leak one handle
    // per attempt for the life of the process.
    const closed: number[] = [];
    expect(
      saveDesktopPrefs(
        '/x/prefs.json',
        { version: 1 },
        {
          mkdirSync: () => {},
          openSync: () => 11,
          writeFileSync: () => {
            throw new Error('ENOSPC');
          },
          fsyncSync: () => {},
          closeSync: (fd: number) => closed.push(fd),
          renameSync: () => {},
          unlinkSync: () => {},
        },
      ),
    ).toBe(false);
    expect(closed).toEqual([11]);
  });

  it('reports false (and never throws) on every write failure', () => {
    const boom = () => {
      throw new Error('EROFS');
    };
    const noop = () => {};
    const prefs = { version: 1, gpuForceOptOut: true };
    const healthy = {
      mkdirSync: noop,
      openSync: () => 7,
      writeFileSync: noop,
      fsyncSync: noop,
      closeSync: noop,
      renameSync: noop,
    };
    // One failing dependency per case: a single catch that only covered the
    // write would still pass a test that only broke the write. The data fsync
    // is load-bearing (unlike the directory one): a save whose payload never
    // reached the platter must not report that it did.
    expect(saveDesktopPrefs('/x/prefs.json', prefs, { ...healthy, mkdirSync: boom })).toBe(false);
    expect(saveDesktopPrefs('/x/prefs.json', prefs, { ...healthy, openSync: boom })).toBe(false);
    expect(saveDesktopPrefs('/x/prefs.json', prefs, { ...healthy, writeFileSync: boom })).toBe(
      false,
    );
    expect(saveDesktopPrefs('/x/prefs.json', prefs, { ...healthy, fsyncSync: boom })).toBe(false);
    expect(saveDesktopPrefs('/x/prefs.json', prefs, { ...healthy, closeSync: boom })).toBe(false);
    expect(saveDesktopPrefs('/x/prefs.json', prefs, { ...healthy, renameSync: boom })).toBe(false);
    // All healthy: the same call reports true, so the arms above fail for the
    // injected reason and not because the shape was wrong.
    expect(saveDesktopPrefs('/x/prefs.json', prefs, healthy)).toBe(true);
  });
});
