'use strict';

// The desktop shell's own small preferences store: the handful of values the
// MAIN process needs before a renderer exists (window geometry, and whether the
// player opted out of the discrete-GPU force). Renderer-owned settings stay in
// the game's own settings store; nothing here is gameplay state.
//
// Two constraints shape the design:
//
//  1. It is read SYNCHRONOUSLY at the very top of main.cjs, before the Linux
//     PRIME relaunch decision and before the GPU switches are appended, because
//     both levers must run before Electron's own startup. A resolve plus a
//     small-file read plus JSON.parse measures well under a millisecond, so the
//     boot cost is noise; an async read would simply be too late.
//  2. The file is UNTRUSTED input. It sits in a user-writable directory and can
//     be hand-edited or truncated by a crash, so the loader never throws, never
//     returns (or mutates) the parsed object, and builds its answer FRESH from
//     whitelisted, individually validated fields. Nothing off the disk reaches a
//     window, an origin, a feed, or an IPC channel unvalidated.
//
// Writes are atomic (temp file plus rename) so a crash mid-write leaves the
// previous file intact rather than a half-written one that reads as corrupt,
// and DURABLE (fsync the staged fd before the rename, then the directory best
// effort) so a power loss cannot land the rename ahead of the data blocks.
// Pure and dependency-injected: tests/electron_desktop_prefs.test.ts exercises
// every arm with a real scratch directory and with throwing fake fs functions.

const nodeFs = require('node:fs');
const nodePath = require('node:path');
const {
  MAX_WINDOW_DIMENSION,
  MAX_WINDOW_POSITION,
  MIN_WINDOW_HEIGHT,
  MIN_WINDOW_POSITION,
  MIN_WINDOW_WIDTH,
} = require('./window_memory.cjs');

// Bumped only when a field's MEANING changes. A file stamped with any other
// version is discarded wholesale rather than field-matched: a future build may
// reuse a name for something else, and defaults are always safe (worst case the
// player's window opens centered once).
const DESKTOP_PREFS_VERSION = 1;

const DESKTOP_PREFS_FILENAME = 'desktop-prefs.json';

// Same 64 KiB ceiling the server's readBody uses. The real file is a couple of
// hundred bytes; anything larger is a hand-edited or corrupt file, and the size
// is checked BEFORE the read/parse so a huge file is never brought into memory.
const MAX_PREFS_FILE_BYTES = 64 * 1024;

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const isInteger = (value) => typeof value === 'number' && Number.isInteger(value);

/** Booleans are accepted strictly: 'true', 1, and null are junk, not true. */
const readBoolean = (value, fallback) => (value === true || value === false ? value : fallback);

/** The two display modes the shell can present in; the default is borderless. */
const DISPLAY_MODES = ['borderless', 'windowed'];

/**
 * The window presentation mode off disk. Exact-literal only: no case folding and
 * no aliases, because the value is fed straight to setFullScreen at the reveal,
 * and a near-miss ('Borderless', 'fullscreen') has to resolve to the default
 * rather than to whichever branch a loose comparison happened to take.
 */
const readDisplayMode = (value, fallback) => (DISPLAY_MODES.includes(value) ? value : fallback);

/**
 * A window rect off disk, or null. Partial bounds are dropped whole: three of
 * four fields cannot place a window, and pairing a saved x with a default width
 * would restore a geometry no session ever had.
 */
function readWindowBounds(value) {
  if (!value || typeof value !== 'object') return null;
  const { x, y, width, height } = value;
  if (!isInteger(x) || !isInteger(y) || !isInteger(width) || !isInteger(height)) return null;
  return {
    x: clamp(x, MIN_WINDOW_POSITION, MAX_WINDOW_POSITION),
    y: clamp(y, MIN_WINDOW_POSITION, MAX_WINDOW_POSITION),
    width: clamp(width, MIN_WINDOW_WIDTH, MAX_WINDOW_DIMENSION),
    height: clamp(height, MIN_WINDOW_HEIGHT, MAX_WINDOW_DIMENSION),
  };
}

/** The prefs a first launch (or any unusable file) gets. */
function defaultDesktopPrefs() {
  return {
    version: DESKTOP_PREFS_VERSION,
    maximized: false,
    gpuForceOptOut: false,
    displayMode: 'borderless',
    discordPresenceEnabled: true,
  };
}

/**
 * Build a complete, valid prefs object from arbitrary input. Always returns a
 * FRESH object (never the input, never a reference into it), so a caller can
 * hold and mutate the result without a path back to parsed file content. Used
 * on the way in AND on the way out, so junk can never be persisted either.
 *
 * windowBounds and displayId are omitted rather than defaulted: "no memory yet"
 * is a real state the restore resolver has to distinguish from "remembered".
 */
function sanitizeDesktopPrefs(input) {
  const prefs = defaultDesktopPrefs();
  if (!input || typeof input !== 'object' || Array.isArray(input)) return prefs;
  // A version this build does not know (a newer file, or a hand-typed value):
  // discard everything. An ABSENT version is accepted, since every field below
  // is validated on its own merits anyway, and it is stamped current on save.
  if (input.version !== undefined && input.version !== DESKTOP_PREFS_VERSION) return prefs;
  const bounds = readWindowBounds(input.windowBounds);
  if (bounds) prefs.windowBounds = bounds;
  if (isInteger(input.displayId)) prefs.displayId = input.displayId;
  prefs.maximized = readBoolean(input.maximized, false);
  prefs.gpuForceOptOut = readBoolean(input.gpuForceOptOut, false);
  // Additive since the version was stamped, so an ABSENT displayMode is the
  // normal reading of a file written by an older build, not a corrupt one: it
  // resolves to the default like any other unusable value, which is why the
  // schema version does not move for it.
  prefs.displayMode = readDisplayMode(input.displayMode, 'borderless');
  // Additive since the version was stamped, so an ABSENT discordPresenceEnabled
  // is the normal reading of a file written by an older build, not a corrupt
  // one: it resolves to the default like any other unusable value, which is why
  // the schema version does not move for it.
  prefs.discordPresenceEnabled = readBoolean(input.discordPresenceEnabled, true);
  return prefs;
}

/**
 * Read the prefs file. NEVER throws and always answers a complete prefs object:
 * a missing file, a path that is not a regular file, an oversized one,
 * unparseable JSON, a non-object root, and an unknown schema version all
 * resolve to defaults. Injectable fs for tests.
 */
function loadDesktopPrefs(filePath, deps = {}) {
  const statSync = deps.statSync ?? nodeFs.statSync;
  const readFileSync = deps.readFileSync ?? nodeFs.readFileSync;
  try {
    const stat = statSync(filePath);
    // Regular files only, and the check has to come before the read. statSync
    // follows symlinks, and a FIFO (or a symlink to one) left at this path
    // reports size 0 and then BLOCKS the reader forever. This read is the first
    // thing main.cjs does, so that would hang the shell before any window
    // exists: no game, no error, nothing to see.
    if (!stat || typeof stat.isFile !== 'function' || !stat.isFile()) {
      return defaultDesktopPrefs();
    }
    // Size next, so an absurd file is refused without ever being read.
    if (!isInteger(stat.size) || stat.size > MAX_PREFS_FILE_BYTES) {
      return defaultDesktopPrefs();
    }
    const text = readFileSync(filePath, 'utf8');
    if (typeof text !== 'string' || text.length > MAX_PREFS_FILE_BYTES) {
      return defaultDesktopPrefs();
    }
    // Hand-editing this file is the documented no-boot rescue (set
    // gpuForceOptOut by hand when the forced GPU cannot boot the game), and a
    // Windows editor saving "UTF-8 with BOM" prepends U+FEFF, which JSON.parse
    // rejects. Strip exactly one leading BOM so that rescue edit is honored
    // instead of silently resolving to defaults, which would force the GPU
    // right back ON.
    const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
    return sanitizeDesktopPrefs(JSON.parse(body));
  } catch {
    // Missing file (the first launch), a permission error, a partial write: all
    // the same answer, because every one of them means "no usable memory".
    return defaultDesktopPrefs();
  }
}

/**
 * The scratch path a save stages its payload at. Unpredictable on purpose: a
 * fixed sibling name (prefs.json.tmp) is a path any other local process can
 * pre-create, and since the prefs live in a user-writable directory that is a
 * real handle to grab. Randomized here and refused by O_EXCL in the writer, so
 * neither half stands alone.
 */
function desktopPrefsTempPath(filePath, random = Math.random) {
  const suffix = Math.floor(random() * 0x100000000)
    .toString(16)
    .padStart(8, '0');
  return `${filePath}.${process.pid}-${suffix}.tmp`;
}

/**
 * Persist the prefs. Atomic: the payload is written to a scratch sibling and
 * renamed over the target, so an interrupted write cannot leave a truncated
 * prefs file behind (rename is atomic within a directory on every platform we
 * ship). Never throws; returns whether the value actually landed on disk, which
 * is what the IPC setter reports to the renderer.
 *
 * The staging open is EXCLUSIVE ('wx' is O_EXCL): it fails outright if
 * anything already exists at the scratch path, and O_EXCL refuses a symlink
 * rather than following it. Without that, a local process that pre-created the
 * scratch path as a symlink would have every save write through it, turning a
 * settings toggle into a clobber of whatever file it pointed at. Failing the
 * save is the safe answer: the player's preference just does not stick, and the
 * IPC setter already reports that honestly.
 *
 * DURABLE, not just atomic: the staged fd is fsynced BEFORE the rename.
 * Rename alone orders the directory entry, not the data blocks, and a
 * journal-reordering filesystem may commit the rename first, so a power loss
 * in the gap lands an EMPTY file at the real path, wiping every stored
 * preference at once; the field that hurts most is gpuForceOptOut, lost on
 * exactly the crash-prone machine the opt-out exists for. After the rename the
 * DIRECTORY is fsynced too, best effort, so the rename itself survives the
 * same loss where the platform allows it (Windows cannot open or fsync a
 * directory, hence the swallowing try/catch around that arm alone).
 */
function saveDesktopPrefs(filePath, prefs, deps = {}) {
  const mkdirSync = deps.mkdirSync ?? nodeFs.mkdirSync;
  const openSync = deps.openSync ?? nodeFs.openSync;
  const writeFileSync = deps.writeFileSync ?? nodeFs.writeFileSync;
  const fsyncSync = deps.fsyncSync ?? nodeFs.fsyncSync;
  const closeSync = deps.closeSync ?? nodeFs.closeSync;
  const renameSync = deps.renameSync ?? nodeFs.renameSync;
  const unlinkSync = deps.unlinkSync ?? nodeFs.unlinkSync;
  // Set only once the exclusive open has succeeded, i.e. once the file at that
  // path is one WE created. A path that was already there is never unlinked:
  // the whole point of the exclusive open is to leave what it refused alone.
  let ownedTempPath = '';
  // The staged fd, tracked so the failure path can release it: a write or
  // fsync that throws would otherwise leak one handle per failing save.
  let stagedFd = null;
  try {
    const text = JSON.stringify(sanitizeDesktopPrefs(prefs));
    if (text.length > MAX_PREFS_FILE_BYTES) return false;
    mkdirSync(nodePath.dirname(filePath), { recursive: true });
    const tempPath = desktopPrefsTempPath(filePath, deps.random);
    stagedFd = openSync(tempPath, 'wx');
    ownedTempPath = tempPath;
    // writeFileSync on an fd writes the whole payload (looping internally) and
    // leaves the fd open, which is the point: the fsync must hit the same open
    // descriptor the data went through.
    writeFileSync(stagedFd, text, { encoding: 'utf8' });
    fsyncSync(stagedFd);
    closeSync(stagedFd);
    stagedFd = null;
    renameSync(tempPath, filePath);
    // Best-effort only from here: the payload is durable at its final name in
    // the common case, and Windows has no directory fsync to offer, so this
    // arm may fail without failing the save.
    try {
      const dirFd = openSync(nodePath.dirname(filePath), 'r');
      try {
        fsyncSync(dirFd);
      } finally {
        closeSync(dirFd);
      }
    } catch {
      // The rename still happened; only its power-loss durability is weaker.
    }
    return true;
  } catch {
    if (stagedFd !== null) {
      try {
        closeSync(stagedFd);
      } catch {
        // Nothing further to do: the save already failed.
      }
    }
    // A failure after a successful exclusive open leaves our own scratch file
    // behind; drop it best-effort so a failing save cannot litter the
    // directory once per attempt.
    if (ownedTempPath !== '') {
      try {
        unlinkSync(ownedTempPath);
      } catch {
        // Nothing further to do: the save already failed.
      }
    }
    return false;
  }
}

module.exports = {
  DESKTOP_PREFS_FILENAME,
  DESKTOP_PREFS_VERSION,
  MAX_PREFS_FILE_BYTES,
  defaultDesktopPrefs,
  desktopPrefsTempPath,
  sanitizeDesktopPrefs,
  loadDesktopPrefs,
  saveDesktopPrefs,
};
