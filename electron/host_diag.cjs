'use strict';

// The host diagnostic the player triggers from the game: ONE JSON file they save
// and send to support. It combines two sources.
//
//  (a) Electron APIs, on every desktop platform: versions, CPU/memory, the app's
//      own process metrics, the displays, battery, and Chromium's GPU verdict.
//      Every reading is a WHITELIST: no user name, no file path, no machine
//      name, and never a raw API object passed through, because this file is
//      mailed to a stranger by a player who cannot audit it.
//
//  (b) On Windows only, the JSON printed by the shipped PowerShell tool
//      (electron/host_diag/dist/HostDiag.ps1, contract in
//      electron/host_diag/SCHEMA.md). That layer is where the answers to a
//      performance complaint actually live: the NVIDIA profile, the Windows
//      per-app GPU preference, the power mode, single-channel memory, hybrid
//      adapters. It is read-only, needs no admin rights, and always prints a
//      valid JSON document, so this module only has to bound it and refuse a
//      document it cannot recognize.
//
// Why the hash check before the spawn, and what it does NOT buy. The .ps1 ships
// OUTSIDE the asar (extraResources -> <resourcesPath>/host-diag/HostDiag.ps1)
// because PowerShell cannot read a file inside an archive, and the shipped NSIS
// install is per-user, so its install directory is writable by every process
// running as that player: a script that a fuse-protected asar would have covered
// is here a loose file. The manifest it is compared against
// (dist/manifest.json) stays INSIDE the asar, under embedded-asar integrity
// validation, so the pin travels with the app and the script does not. Mismatch
// or missing means the script is NEVER spawned; the player gets the Electron
// half alone.
//
// What that defeats: a script that is CORRUPTED (a partial update, a truncated
// download), one an antivirus quarantined and something later restored wrong,
// and one swapped PASSIVELY AT REST (an old or tampered install directory, a
// file dropped there by something no longer running). Those are the realistic
// cases, and they are the ones the manifest catches.
//
// What it does NOT defeat: a verify-then-spawn race. Malware already running as
// the player can swap the file between the hash read here and the moment
// PowerShell opens it, and this check cannot close that window. The window is
// wider than that first open, too: the script re-spawns itself from the same
// path per isolated collector and on the 32-bit relaunch arm, so it is re-read
// throughout the run and the hash pins the FIRST read only. It is also not
// worth pretending otherwise: such malware already owns the account, so it has
// far better options than editing a diagnostic script. The stronger control is
// not a tighter check here but Authenticode-signing the .ps1 in the release
// pipeline (signing BEFORE the manifest hash is computed, since the signature
// block changes the bytes), so Windows itself validates the file at load time
// rather than this process validating a copy of it beforehand. See
// docs/desktop-release.md, "Host diagnostic".
//
// Everything here is pure or dependency-injected through a `deps = {}` bag, in
// the same house style as electron/gpu_preference.cjs and
// electron/launch_settings.cjs: no electron import at module top (main.cjs
// passes app/screen/powerMonitor/dialog/shell in), so
// tests/electron_host_diag.test.ts drives the whole flow, the spawn included,
// against fakes.

const { spawn: nodeSpawn } = require('node:child_process');
const nodeCrypto = require('node:crypto');
const { readFileSync: nodeReadFileSync, writeFileSync: nodeWriteFileSync } = require('node:fs');
const nodeOs = require('node:os');
const nodePath = require('node:path');
const { clampText } = require('./diagnostics.cjs');
// Inside the asar, and therefore integrity-protected: the pin for the script
// that is not (see the header). Required, never read off disk beside the .ps1,
// or a swapped script could bring its own matching manifest.
const HOST_DIAG_MANIFEST = require('./host_diag/dist/manifest.json');

/** The envelope version of the file this module writes. Bumped when a consumer
 *  would have to read it differently; unrelated to the Windows tool's own
 *  `schemaVersion` (SCHEMA.md), which rides along inside `native.report`. */
const HOST_DIAG_SCHEMA_VERSION = 1;
const HOST_DIAG_KIND = 'woc-host-diag';

// The whole run, killed at the cap. The tool's own per-collector timeout is 60 s
// and a normal Snapshot run finishes in about 5 s, so this is the outer bound on
// a machine where something (frozen WMI, a wedged driver DLL) holds a worker
// past every inner deadline, not a budget the healthy path approaches.
const HOST_DIAG_TIMEOUT_MS = 120_000;
// stdout cap. A real report is tens of KB (the NVIDIA collector's full setting
// list is the large one); 2 MB is far past that and bounds the main process's
// memory against a script that prints forever.
const HOST_DIAG_MAX_STDOUT_BYTES = 2 * 1024 * 1024;
// getGPUInfo('complete') asks the GPU process, which can be busy, wedged, or
// gone. The rest of the snapshot must not wait on it.
const GPU_INFO_TIMEOUT_MS = 5_000;

// The spawn options, frozen and exported so the unit test can pin the WHOLE
// object: what a scan cannot judge is the options bag, so the control against a
// later `shell: true` (or a dropped windowsHide, which would flash a console
// window over a full-screen game) is that pin. stdin is closed and stderr is
// discarded: the tool's progress chatter goes to stdout only under -StdoutJson,
// and nothing here ever answers a prompt.
const HOST_DIAG_SPAWN_OPTIONS = Object.freeze({
  windowsHide: true,
  stdio: Object.freeze(['ignore', 'pipe', 'ignore']),
});

// The one argv element derived from this process rather than written here: the
// app's own exe name, which the tool uses to look up the NVIDIA profile and the
// Windows per-app GPU preference FOR US. Strict: 64 characters at most, and
// single interior spaces only between runs of name characters, so a path
// separator, a quote, a semicolon, a leading or trailing space and a space-only
// name all fail it ("World of ClaudeCraft.exe" passes). A name that fails is
// DROPPED rather than sanitized, so nothing unexpected can reach argv at all.
const APP_EXE_NAME_RE = /^(?=.{1,64}$)[A-Za-z0-9._-]+(?: [A-Za-z0-9._-]+)*\.exe$/;

/**
 * The Windows PowerShell 5.1 interpreter, by absolute path, resolved from
 * SystemRoot exactly like defaultRegExe in electron/gpu_preference.cjs: never
 * PATH (which a per-user PATH entry could shadow), and win32.join so the path
 * stays correct on a host that exercises this with a POSIX separator.
 * `powershell.exe` on purpose, not `pwsh.exe`: the tool targets Windows
 * PowerShell 5.1, which every supported Windows ships and PowerShell 7 does not
 * replace.
 */
function powershellExe(env) {
  const root = env?.SystemRoot || 'C:\\Windows';
  return nodePath.win32.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}

/**
 * Where the shipped script lives. Packaged: outside the asar, as
 * package.json's build.extraResources puts it. Unpackaged: the checkout's
 * committed dist, since `electron .` (scripts/electron-dev.mjs) makes
 * app.getAppPath() the repo root.
 */
function hostDiagScriptPath({ isPackaged, resourcesPath, appPath } = {}) {
  if (isPackaged === true)
    return nodePath.join(String(resourcesPath ?? ''), 'host-diag', HOST_DIAG_MANIFEST.file);
  return nodePath.join(
    String(appPath ?? ''),
    'electron',
    'host_diag',
    'dist',
    HOST_DIAG_MANIFEST.file,
  );
}

/**
 * Whether the script on disk is the one this build shipped: 'ok', 'missing'
 * (unreadable, which includes absent), or 'hash-mismatch'. The bytes are read
 * whole and hashed; the script is never spawned on anything but 'ok'. A file
 * read failure and a wrong hash are reported apart on purpose: the first is a
 * broken install (a partial update, an antivirus quarantine), the second is the
 * one worth looking at.
 */
function verifyHostDiagScript(scriptPath, manifest = HOST_DIAG_MANIFEST, deps = {}) {
  const readFile = deps.readFileSync ?? nodeReadFileSync;
  const hash = deps.sha256Hex ?? sha256Hex;
  let bytes;
  try {
    bytes = readFile(scriptPath);
  } catch {
    return 'missing';
  }
  return hash(bytes) === String(manifest?.sha256 ?? '') ? 'ok' : 'hash-mismatch';
}

function sha256Hex(bytes) {
  return nodeCrypto.createHash('sha256').update(bytes).digest('hex');
}

/**
 * The web browsers the tool also looks at. The game is played in a browser too,
 * and a player who reports a slow browser session is asked to send this same
 * report: what answers them is the NVIDIA profile and the Windows per-app GPU
 * preference of THEIR BROWSER (a driver-shipped browser profile can override a
 * global "prefer maximum performance"), plus the browsers collector (installed
 * version, hardware acceleration switched off). A fixed list, written here.
 */
const BROWSER_EXE_NAMES = Object.freeze([
  'chrome.exe',
  'msedge.exe',
  'firefox.exe',
  'brave.exe',
  'opera.exe',
]);

/**
 * The FIXED argv. No shell, no string command line, no option value that came
 * from anywhere but this file, with the single audited exception of the app's
 * own exe name (APP_EXE_NAME_RE above), which is simply left out of the list
 * when it does not match.
 * -StdoutJson keeps the report in this process (nothing is written where the
 * player did not ask for it); the default Snapshot mode keeps the run at about
 * 5 s with no live sampling.
 *
 * -Apps is ALWAYS passed explicitly (the tool splits it on commas): this game
 * first, then BROWSER_EXE_NAMES. The list the player is told about is the one
 * written in this file, never the tool's own default.
 */
function buildHostDiagArgs({ scriptPath, appExeName } = {}) {
  const apps =
    typeof appExeName === 'string' && APP_EXE_NAME_RE.test(appExeName)
      ? [appExeName, ...BROWSER_EXE_NAMES]
      : [...BROWSER_EXE_NAMES];
  return [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    String(scriptPath ?? ''),
    '-StdoutJson',
    '-Apps',
    apps.join(','),
  ];
}

/** The app's own exe name for -Apps, or null when it is not a plain name. */
function appExeNameFor(execPath) {
  const name = nodePath.win32.basename(String(execPath ?? ''));
  return APP_EXE_NAME_RE.test(name) ? name : null;
}

/** Strip a UTF-8 BOM: PowerShell's UTF-8 output carries one, and JSON.parse
 *  refuses it. */
function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * Accept only a document shaped like SCHEMA.md's envelope: a numeric
 * `schemaVersion` and an object `collectors`. Anything else (a lone progress
 * line, an HTML error page from a proxy-wrapped interpreter, a valid JSON array)
 * is not a report, and passing it through would put unrecognized content in a
 * file the player mails out.
 */
function isHostDiagReport(value) {
  return (
    !!value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    typeof value.schemaVersion === 'number' &&
    Number.isFinite(value.schemaVersion) &&
    !!value.collectors &&
    typeof value.collectors === 'object' &&
    !Array.isArray(value.collectors)
  );
}

/**
 * Run the Windows layer and return its report. Never throws and never rejects:
 * every arm answers a status.
 *
 * `spawn`, not execFileSync: the run takes about 5 s, and blocking the main
 * process that long freezes the game's window, its IPC, and its input.
 *
 * `{ status, reason?, exitCode?, durationMs, report? }`, where `reason` is a
 * short STABLE code ('missing', 'hash-mismatch', 'timeout', 'too-large',
 * 'bad-json', 'spawn-failed', 'exit-code'), never a raw error message or a path:
 * this value crosses to the renderer, and an OS error string carries the
 * player's install path.
 *
 * Exit code 1 is success with a flag ('partial'): SCHEMA.md says at least one
 * collector failed and the JSON is still whole, which is the common case on a
 * machine with a blocked WMI or no NVIDIA card. Any other non-zero code that
 * still printed a valid report is returned too, flagged 'exit-code'.
 */
async function runNativeHostDiag(deps = {}) {
  const platform = deps.platform ?? process.platform;
  const now = deps.now ?? (() => Date.now());
  const startedAt = now();
  const elapsed = () => Math.max(0, now() - startedAt);
  // Nothing to spawn off Windows: the Electron half is the whole report there,
  // and this is reported rather than hidden so a macOS/Linux bug report is not
  // mistaken for a failed collection.
  if (platform !== 'win32') return { status: 'unsupported-platform', durationMs: 0 };

  const scriptPath = deps.scriptPath ?? hostDiagScriptPath(deps.paths ?? {});
  const verdict = verifyHostDiagScript(scriptPath, deps.manifest ?? HOST_DIAG_MANIFEST, deps);
  if (verdict !== 'ok') {
    return { status: 'unavailable', reason: verdict, durationMs: elapsed() };
  }

  const spawnFn = deps.spawn ?? nodeSpawn;
  const setTimer = deps.setTimeout ?? setTimeout;
  const clearTimer = deps.clearTimeout ?? clearTimeout;
  const args = buildHostDiagArgs({
    scriptPath,
    appExeName: deps.appExeName ?? appExeNameFor(deps.execPath ?? process.execPath),
  });

  let child;
  try {
    child = spawnFn(powershellExe(deps.env ?? process.env), args, HOST_DIAG_SPAWN_OPTIONS);
  } catch {
    // A synchronous throw (EACCES on the interpreter, a blocked spawn) rather
    // than the async 'error' event both arms below answer the same way.
    return { status: 'error', reason: 'spawn-failed', durationMs: elapsed() };
  }

  return await new Promise((resolve) => {
    let settled = false;
    let bytes = 0;
    const chunks = [];
    // Declared before the closure that clears it (see withTimeout below).
    let timer = null;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimer(timer);
      resolve({ ...result, durationMs: elapsed() });
    };
    const kill = () => {
      try {
        child.kill?.();
      } catch {
        // A child that is already gone cannot be killed; nothing to do.
      }
    };
    timer = setTimer(() => {
      // The tool bounds each collector itself, so reaching this means the whole
      // process is wedged: kill it rather than leave a stray PowerShell running
      // for the life of the session.
      kill();
      finish({ status: 'error', reason: 'timeout' });
    }, deps.timeoutMs ?? HOST_DIAG_TIMEOUT_MS);

    child.once?.('error', () => finish({ status: 'error', reason: 'spawn-failed' }));
    child.stdout?.on?.('data', (chunk) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), 'utf8');
      bytes += buffer.length;
      if (bytes > (deps.maxStdoutBytes ?? HOST_DIAG_MAX_STDOUT_BYTES)) {
        kill();
        finish({ status: 'error', reason: 'too-large' });
        return;
      }
      chunks.push(buffer);
    });
    child.once?.('close', (code) => {
      const exitCode = typeof code === 'number' ? code : null;
      let report = null;
      try {
        report = JSON.parse(stripBom(Buffer.concat(chunks).toString('utf8')));
      } catch {
        report = null;
      }
      if (!isHostDiagReport(report)) {
        finish({ status: 'error', reason: 'bad-json', exitCode });
        return;
      }
      if (exitCode === 0) {
        finish({ status: 'ok', exitCode, report });
        return;
      }
      // 1 = a collector failed, the document is whole (SCHEMA.md). Anything
      // else that still printed a whole document is returned with a flag: a
      // fatalError arm (exit 2) is exactly the machine worth reading about.
      finish({
        status: 'partial',
        ...(exitCode === 1 ? {} : { reason: 'exit-code' }),
        exitCode,
        report,
      });
    });
  });
}

// --- The Electron half -------------------------------------------------------

/** Read one API, answering null instead of throwing: one wedged getter must not
 *  cost the whole snapshot. */
function safeRead(read) {
  try {
    const value = read();
    return value === undefined ? null : value;
  } catch {
    return null;
  }
}

/** Keep only the numeric entries of a flat object (process.getSystemMemoryInfo
 *  gains fields between Electron versions, and every one of them is a byte
 *  count: whitelisting by TYPE rather than by name keeps a new counter without a
 *  code change, and cannot let a string through). */
function numericFields(source) {
  const out = {};
  if (!source || typeof source !== 'object') return out;
  for (const [key, value] of Object.entries(source)) {
    if (typeof value === 'number' && Number.isFinite(value)) out[key] = value;
  }
  return out;
}

/** The auxAttributes of getGPUInfo worth having, by FIXED key list. Everything
 *  else is dropped, including the machine model name and version Chromium
 *  reports on some platforms (a machine identifier, out of scope here) and every
 *  nested object. */
const GPU_AUX_KEYS = Object.freeze([
  'glRenderer',
  'glVendor',
  'glVersion',
  'glResetNotificationStrategy',
  'glImplementationParts',
  'amdSwitchable',
  'optimus',
  'sandboxed',
  'inProcessGpu',
  'passthroughCmdDecoder',
  'directComposition',
  'supportsOverlays',
  'displayType',
  'maxMsaaSamples',
  'pixelShaderVersion',
  'vertexShaderVersion',
  'dx12FeatureLevel',
  'd3d12FeatureLevel',
  'directMLFeatureLevel',
  'vulkanVersion',
  'subpixelFontRendering',
]);

/** Scalars only, from a fixed key list: the shape of this dictionary differs
 *  per platform and per Electron version, so an unknown key simply does not
 *  appear (fail-safe) and a nested object never rides along. */
function pickScalars(source, keys, maxLength = 256) {
  const out = {};
  if (!source || typeof source !== 'object') return out;
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string') {
      if (value !== '') out[key] = clampText(value, maxLength);
    } else if (typeof value === 'number') {
      if (Number.isFinite(value)) out[key] = value;
    } else if (typeof value === 'boolean') {
      out[key] = value;
    }
  }
  return out;
}

const GPU_DEVICE_KEYS = Object.freeze([
  'vendorId',
  'deviceId',
  'active',
  'driverVendor',
  'driverVersion',
  'vendorString',
  'deviceString',
]);

/** getGPUInfo('complete'), reduced: the adapter list plus the handful of
 *  auxAttributes scalars that answer "which GPU, which driver, which GL stack".
 *  Never the raw object: it carries nested diagnostics blocks whose contents
 *  differ per driver and are not auditable from here. */
function reduceGpuInfo(info) {
  if (!info || typeof info !== 'object') return null;
  const devices = Array.isArray(info.gpuDevice)
    ? info.gpuDevice.map((device) => pickScalars(device, GPU_DEVICE_KEYS))
    : [];
  return { devices, auxAttributes: pickScalars(info.auxAttributes, GPU_AUX_KEYS) };
}

/** app.getAppMetrics(), reduced to what a memory or CPU complaint needs: the
 *  per-process TYPE (never its name, which carries the renderer's document
 *  title), its working set, and its CPU share, plus the total the player is
 *  really reporting. */
function reduceAppMetrics(metrics) {
  if (!Array.isArray(metrics)) return null;
  const processes = [];
  let totalWorkingSetKb = 0;
  for (const entry of metrics) {
    if (!entry || typeof entry !== 'object') continue;
    const workingSetKb = Number.isFinite(entry.memory?.workingSetSize)
      ? entry.memory.workingSetSize
      : null;
    if (workingSetKb !== null) totalWorkingSetKb += workingSetKb;
    processes.push({
      type: typeof entry.type === 'string' ? clampText(entry.type, 32) : null,
      workingSetKb,
      peakWorkingSetKb: Number.isFinite(entry.memory?.peakWorkingSetSize)
        ? entry.memory.peakWorkingSetSize
        : null,
      cpuPercent: Number.isFinite(entry.cpu?.percentCPUUsage)
        ? Math.round(entry.cpu.percentCPUUsage * 100) / 100
        : null,
    });
  }
  return { processes, totalWorkingSetKb };
}

/** screen.getAllDisplays(), reduced: geometry, scaling and refresh rate, which
 *  is what a "why is it slow / why is it blurry" report turns on. The display's
 *  id and label stay out (a stable machine-local identifier, and a
 *  manufacturer string, neither of which answers anything). */
function reduceDisplays(displays, primaryId) {
  if (!Array.isArray(displays)) return null;
  return displays.map((display) => ({
    width: Number.isFinite(display?.size?.width) ? display.size.width : null,
    height: Number.isFinite(display?.size?.height) ? display.size.height : null,
    scaleFactor: Number.isFinite(display?.scaleFactor) ? display.scaleFactor : null,
    displayFrequency: Number.isFinite(display?.displayFrequency) ? display.displayFrequency : null,
    internal: display?.internal === true,
    primary: primaryId !== null && display?.id === primaryId,
  }));
}

/** The shell's own state, as main.cjs already has it in hand (the GPU-force
 *  decision, the backend rung, the distribution): scalars only, so a future
 *  caller cannot widen the file by handing over a live object. */
function sanitizeShellState(raw, maxKeys = 40) {
  if (!raw || typeof raw !== 'object') return null;
  const out = {};
  for (const [key, value] of Object.entries(raw)) {
    if (Object.keys(out).length >= maxKeys) break;
    if (typeof value === 'string') out[key] = clampText(value, 128);
    else if (typeof value === 'number') {
      if (Number.isFinite(value)) out[key] = value;
    } else if (typeof value === 'boolean' || value === null) out[key] = value;
  }
  return out;
}

/**
 * Flatten a Chromium switch list (the `[name, value]` pairs
 * electron/gpu_backend.cjs appends) into one space-joined string, so the shell
 * state can carry WHICH switches this launch was given through the scalar-only
 * filter above. There is no single list of everything the shell appends, so the
 * caller joins its contributors; a valueless switch keeps its bare name.
 */
function flattenSwitchPairs(pairs) {
  if (!Array.isArray(pairs)) return '';
  return pairs
    .map((pair) => {
      if (typeof pair === 'string') return pair;
      if (!Array.isArray(pair)) return '';
      const [name, value] = pair;
      return value === undefined || value === null || value === ''
        ? String(name ?? '')
        : `${name}=${value}`;
    })
    .filter((entry) => entry !== '')
    .join(' ');
}

/** Resolve a promise, or null when it takes longer than `ms` (the promise is
 *  left to settle on its own; nothing waits on it). */
function withTimeout(promise, ms, deps = {}) {
  const setTimer = deps.setTimeout ?? setTimeout;
  const clearTimer = deps.clearTimeout ?? clearTimeout;
  return new Promise((resolve) => {
    let settled = false;
    // Assigned after the closure that clears it, and declared before it: a timer
    // seam that fires synchronously (a test, a zero delay) would otherwise reach
    // the binding before its initializer ran.
    let timer = null;
    const done = (value) => {
      if (settled) return;
      settled = true;
      clearTimer(timer);
      resolve(value);
    };
    timer = setTimer(() => done(null), ms);
    Promise.resolve(promise).then(
      (value) => done(value),
      () => done(null),
    );
  });
}

/** One reduced app.getAppMetrics() reading, guarded like every other getter.
 *  Its own function because runHostDiag takes this reading itself, on its own
 *  schedule (see the deferAppMetrics note below). */
function readAppMetrics(app) {
  return reduceAppMetrics(safeRead(() => app?.getAppMetrics?.()));
}

/**
 * The Electron-side snapshot: a whitelisted, privacy-safe reading of this
 * machine and this process. Every getter is individually guarded, so a wedged
 * or missing API yields null for its own field and nothing else.
 */
async function collectElectronHostInfo(deps = {}) {
  const app = deps.app;
  const screen = deps.screen;
  const powerMonitor = deps.powerMonitor;
  const os = deps.os ?? nodeOs;
  const proc = deps.process ?? process;

  const cpus = safeRead(() => os.cpus());
  const primaryId = safeRead(() => screen?.getPrimaryDisplay()?.id);
  const gpuInfo = await withTimeout(
    new Promise((resolve) => resolve(app?.getGPUInfo?.('complete'))).catch(() => null),
    deps.gpuInfoTimeoutMs ?? GPU_INFO_TIMEOUT_MS,
    deps,
  );

  return {
    appVersion: safeRead(() => clampText(String(app?.getVersion?.() ?? ''), 64)) || null,
    channel: typeof deps.channel === 'string' ? clampText(deps.channel, 32) : null,
    versions: {
      electron: safeRead(() => proc.versions?.electron ?? null),
      chrome: safeRead(() => proc.versions?.chrome ?? null),
      node: safeRead(() => proc.versions?.node ?? null),
    },
    platform: safeRead(() => proc.platform),
    arch: safeRead(() => proc.arch),
    osRelease: safeRead(() => os.release()),
    cpu: {
      model: Array.isArray(cpus) && cpus[0]?.model ? clampText(String(cpus[0].model), 128) : null,
      logicalCores: Array.isArray(cpus) ? cpus.length : null,
    },
    memory: numericFields(safeRead(() => proc.getSystemMemoryInfo?.())),
    // app.getAppMetrics() reports percentCPUUsage SINCE THE PREVIOUS CALL, so a
    // lone call always reads 0. runHostDiag primes it and then takes the real
    // reading after the slow native half has settled, which makes the figure the
    // app's average over the whole collection window; it asks for that by
    // passing deferAppMetrics and attaches the field itself (readAppMetrics).
    appMetrics: deps.deferAppMetrics === true ? null : readAppMetrics(app),
    onBatteryPower: safeRead(() => powerMonitor?.isOnBatteryPower?.()) === true,
    displays: reduceDisplays(
      safeRead(() => screen?.getAllDisplays?.()),
      Number.isFinite(primaryId) ? primaryId : null,
    ),
    // A flat string-to-string dictionary of Chromium's own feature verdicts
    // ('gpu_compositing: enabled', ...): no machine data, so it rides whole
    // through the scalar filter rather than a hand-kept key list.
    gpuFeatureStatus: (() => {
      const status = safeRead(() => app?.getGPUFeatureStatus?.());
      if (!status || typeof status !== 'object') return null;
      return pickScalars(status, Object.keys(status), 64);
    })(),
    gpu: reduceGpuInfo(gpuInfo),
    shell: sanitizeShellState(deps.shellState),
  };
}

// --- The envelope ------------------------------------------------------------

// What the renderer may contribute, and nothing else: the game side is
// untrusted here exactly like every other bridge payload. Strings are clamped
// through the shell's one clamp (control characters flattened, astral tails
// kept whole), numbers must be finite, and every other type is dropped.
const GAME_INFO_KEYS = Object.freeze([
  'sessionId',
  'releaseVersion',
  'buildId',
  'graphicsPreset',
  'gfxTier',
  'glRenderer',
  'glVendor',
  'renderScale',
  'targetFps',
  'zone',
  'locale',
]);
const MAX_GAME_TEXT = 128;

function sanitizeGameInfo(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const key of GAME_INFO_KEYS) {
    const value = raw[key];
    if (typeof value === 'string') {
      const cleaned = clampText(value, MAX_GAME_TEXT);
      if (cleaned !== '') out[key] = cleaned;
    } else if (typeof value === 'number' && Number.isFinite(value)) {
      out[key] = value;
    }
  }
  return out;
}

/** Two digits, for the file name's local-time stamp. */
const pad2 = (value) => String(value).padStart(2, '0');

/**
 * The suggested file name: sortable, second-resolution, local time (the player
 * reads this name in their own file manager and quotes it to support, so it
 * matches the clock on their wall rather than UTC).
 */
function hostDiagFileName(now = new Date()) {
  const date = now instanceof Date ? now : new Date(now);
  const stamp =
    `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}` +
    `-${pad2(date.getHours())}${pad2(date.getMinutes())}${pad2(date.getSeconds())}`;
  return `woc-host-diag-${stamp}.json`;
}

/**
 * The file's one envelope. `kind` and `schemaVersion` come first so a support
 * tool can recognize the document from its first bytes; the native half keeps
 * its status beside its report, because "the Windows layer could not run" is
 * itself an answer a reader needs (a blocked interpreter and a swapped script
 * both say something about the machine).
 */
function assembleHostDiagReport({ game, electron, native, now = new Date() } = {}) {
  const at = now instanceof Date ? now : new Date(now);
  return {
    kind: HOST_DIAG_KIND,
    schemaVersion: HOST_DIAG_SCHEMA_VERSION,
    generatedAt: at.toISOString(),
    game: sanitizeGameInfo(game),
    electron: electron ?? null,
    native: {
      platform: native?.platform ?? null,
      status: native?.status ?? 'error',
      reason: native?.reason ?? null,
      exitCode: native?.exitCode ?? null,
      durationMs: Number.isFinite(native?.durationMs) ? native.durationMs : null,
      report: native?.report ?? null,
    },
  };
}

// --- The run the IPC handler calls -------------------------------------------

// One run at a time. The collection spawns a process and opens a native save
// dialog, so a second click (or a page that loops) would stack both; the second
// ask is answered 'busy' rather than queued, because the first one's dialog is
// already on screen and is what the player is looking at.
let runInFlight = false;

/**
 * Collect, assemble, and save. Returns
 * `{ status: 'saved'|'cancelled'|'busy'|'error', nativeStatus, fileName?,
 * durationMs, bytes }`; the caller logs it and hands the renderer only the
 * first three. Never throws.
 *
 * The two halves run in PARALLEL: the Windows layer is about 5 s of waiting on
 * other processes, and the Electron readings are instant except getGPUInfo,
 * which has its own bound.
 *
 * The ONE reading that is deliberately not parallel is app.getAppMetrics():
 * percentCPUUsage is measured since the PREVIOUS call, so a single call always
 * reports 0. A discarded priming call here opens the window, the Electron
 * snapshot skips the field (deferAppMetrics), and the real reading is taken
 * once BOTH halves have settled, which makes the CPU figures the app's average
 * over the roughly 5 s collection rather than a row of zeros.
 */
async function runHostDiag(deps = {}) {
  const now = deps.now ?? (() => Date.now());
  const startedAt = now();
  if (runInFlight) {
    return { status: 'busy', nativeStatus: null, durationMs: 0, bytes: 0 };
  }
  runInFlight = true;
  try {
    const app = deps.app;
    const platform = deps.platform ?? process.platform;
    // Prime the CPU window (see the note above); the result is deliberately
    // discarded, and a wedged or missing API must not fail the run.
    safeRead(() => app?.getAppMetrics?.());
    const [native, electron] = await Promise.all([
      runNativeHostDiag({
        ...deps,
        platform,
        paths: deps.paths ?? {
          isPackaged: app?.isPackaged === true,
          resourcesPath: deps.resourcesPath ?? process.resourcesPath,
          appPath: safeRead(() => app?.getAppPath?.()) ?? '',
        },
      }),
      collectElectronHostInfo({ ...deps, deferAppMetrics: true }),
    ]);
    // Both halves have settled, so this reading spans the whole collection.
    if (electron && typeof electron === 'object') electron.appMetrics = readAppMetrics(app);
    const report = assembleHostDiagReport({
      game: deps.game,
      electron,
      native: { ...native, platform },
      now: new Date(now()),
    });
    const text = `${JSON.stringify(report, null, 2)}\n`;
    const saved = await saveHostDiagFile(text, deps);
    return {
      status: saved.status,
      nativeStatus: native.status,
      ...(saved.fileName ? { fileName: saved.fileName } : {}),
      durationMs: Math.max(0, now() - startedAt),
      bytes: Buffer.byteLength(text, 'utf8'),
    };
  } catch {
    return {
      status: 'error',
      nativeStatus: null,
      durationMs: Math.max(0, now() - startedAt),
      bytes: 0,
    };
  } finally {
    runInFlight = false;
  }
}

/**
 * Ask the player where to put the file, write it, and reveal it. The dialog's
 * title, button and file-type labels come from the renderer's t()-rendered
 * shell strings (electron/shell_strings.cjs): the main process has no i18n
 * runtime, so the English defaults there are only the pre-push fallback.
 * showItemInFolder, not openPath: the player sends this file, they do not read
 * it, and opening a JSON document in whatever is registered for .json is not
 * what they asked for.
 */
async function saveHostDiagFile(text, deps = {}) {
  const dialog = deps.dialog;
  const strings = deps.strings ?? {};
  const writeFile = deps.writeFileSync ?? nodeWriteFileSync;
  const fileName = hostDiagFileName(new Date((deps.now ?? (() => Date.now()))()));
  const defaultDir = safeRead(() => deps.app?.getPath?.('documents')) ?? '';
  let result;
  try {
    result = await dialog?.showSaveDialog?.(deps.window ?? null, {
      title: strings.hostDiagSaveTitle,
      buttonLabel: strings.hostDiagSaveButton,
      defaultPath: defaultDir ? nodePath.join(defaultDir, fileName) : fileName,
      filters: [{ name: strings.hostDiagFileType, extensions: ['json'] }],
      // createDirectory: the player may want a folder for the file they are
      // about to mail; showOverwriteConfirmation: the suggested name is
      // second-resolution, so a second report in the same second, or a save
      // back onto an earlier one, must ask before it clobbers.
      properties: ['createDirectory', 'showOverwriteConfirmation'],
    });
  } catch {
    return { status: 'error' };
  }
  const filePath = result?.filePath;
  if (result?.canceled === true || typeof filePath !== 'string' || filePath === '') {
    return { status: 'cancelled' };
  }
  try {
    writeFile(filePath, text, 'utf8');
  } catch {
    return { status: 'error' };
  }
  try {
    deps.shell?.showItemInFolder?.(filePath);
  } catch {
    // A file manager that will not open is not a failed save.
  }
  // The BASE name only: the full path names the player's home directory, and
  // this value crosses to the renderer.
  return { status: 'saved', fileName: nodePath.win32.basename(filePath) };
}

module.exports = {
  APP_EXE_NAME_RE,
  BROWSER_EXE_NAMES,
  GAME_INFO_KEYS,
  GPU_INFO_TIMEOUT_MS,
  HOST_DIAG_KIND,
  HOST_DIAG_MANIFEST,
  HOST_DIAG_MAX_STDOUT_BYTES,
  HOST_DIAG_SCHEMA_VERSION,
  HOST_DIAG_SPAWN_OPTIONS,
  HOST_DIAG_TIMEOUT_MS,
  appExeNameFor,
  assembleHostDiagReport,
  buildHostDiagArgs,
  collectElectronHostInfo,
  flattenSwitchPairs,
  hostDiagFileName,
  hostDiagScriptPath,
  powershellExe,
  runHostDiag,
  runNativeHostDiag,
  sanitizeGameInfo,
  sanitizeShellState,
  saveHostDiagFile,
  verifyHostDiagScript,
};
