# host diagnostic: input/output contract (schemaVersion 2)

Windows layer of the host diagnostic. Read-only, no admin rights, no interaction,
compatible with Windows PowerShell 5.1 (32 and 64 bit). No verdicts: the script collects,
the analysis happens server-side.

The tool names itself `host-diag` throughout: the `tool.name` field, the `HOSTDIAG_*` test hooks,
the `HostDiag.*` C# namespaces, the `@@HOSTDIAG-JSON@@` marker and the `host-diag-*` output file
prefix.

## Invocation

```
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File HostDiag.ps1 [options]
```

| Option | Default | Role |
|---|---|---|
| `-OutDir <dir>` | the script folder | where to write `host-diag-<machine>-<date>.json`. If not writable: falls back to `%TEMP%` (the real path is printed in the progress output) |
| `-Apps a.exe,b.exe` | chrome, msedge, firefox, brave, opera | executables of interest: NVIDIA profile, Windows GPU preference, GPU usage in Sample mode. **Add the game's Electron exe here.** |
| `-Mode Snapshot` or `-Mode Sample` | Snapshot | Sample = Snapshot plus live measurements |
| `-SampleSeconds <3..300>` | 20 | measurement duration (1 point per second) |
| `-Only x,y` / `-Skip x,y` | (none) | collector selection |
| `-StdoutJson` | (off) | JSON on stdout (UTF-8), nothing else, no file |
| `-Summary` | (off) | also writes a readable `.txt` (what the player can review before sending) |
| `-Quiet` | (off) | no progress output |
| `-NoAnonymize` | (off) | keeps the real machine name (otherwise a random `pc-<10 hex>` code, see `computer` below) |
| `-CollectorTimeoutSeconds <5..600>` | 60 | maximum delay per collector (Sample mode adds `-SampleSeconds` to it) |
| `-InProcess` | (off) | debug: no process isolation |

## Fault tolerance

Each collector runs in **its own child process** (`-Worker <name>`, internal use), with a maximum delay.
Phase 1 runs in parallel, then `processes`, then `sampling` alone (so we do not measure our own workers).

| Failure | Result |
|---|---|
| PowerShell exception | `status=error`, message in `error` |
| native crash (access violation inside a driver DLL) | `error: collector process crashed (exit code ...)` |
| hang (frozen WMI, ...) | process killed, `error: timeout: collector killed after N s` |
| child process cannot be started | automatic fallback: runs in the current process (`host.isolation = "none"`) |
| the caller kills the tool (Electron, window closed) | each worker watches its parent and exits within about 2 s: no orphan process |
| 32-bit PowerShell on 64-bit Windows | automatic relaunch as 64-bit (otherwise registry and DLLs are redirected, so the data would be wrong) |
| restricted PowerShell (Constrained Language Mode: WDAC, AppLocker) | no isolation and no native code (`display`, `nvidia`, `sampling` report an error, `power` falls back to CIM), the rest keeps working, and `warnings` says so |
| error in the orchestrator itself | `fatalError` is filled in, JSON is emitted anyway, exit code 2 |
| output folder not writable | falls back to `%TEMP%`; if that also fails: a `@@HOSTDIAG-JSON@@` line followed by the JSON on stdout, exit code 2 |
| `-Only` / `-Skip` with an unknown name | reported in `warnings`; exit code 2 if nothing runs any more |

In every case a valid JSON document comes out, and the other collectors are unaffected.
Test hooks: `HOSTDIAG_TEST_FAIL`, `HOSTDIAG_TEST_HANG`, `HOSTDIAG_TEST_CRASH` = `<collector>`. They exist in the dev sources only (`win/Invoke-HostDiag.ps1`); the bundler strips the `BUILD:TESTHOOKS` region, so the shipped `dist/HostDiag.ps1` ignores them.

Progress (stdout, one line per collector): `[name] status  durationMs  error`.

Line order is completion order (parallel); inside the JSON the order is fixed.

Exit codes: `0` all good, `1` at least one collector in error (the JSON is still written),
`2` no collector completed, or a fatal error.

## Envelope

```json
{
  "schemaVersion": 2,
  "tool": { "name": "host-diag", "version": "0.3.1" },
  "generatedAt": "ISO-8601", "mode": "Snapshot|Sample",
  "computer": "pc-041569db9d", "apps": ["chrome.exe"],
  "host": { "powershell": "5.1...", "bitness": 64, "languageMode": "FullLanguage", "culture": "fr-FR", "isolation": "process|none" },
  "warnings": [], "fatalError": null,
  "collectors": {
    "<name>": { "status": "ok|error|skipped", "durationMs": 12, "error": null, "errorType": null, "data": { } }
  }
}
```

`computer` is a **random code minted for THIS report** (`pc-` plus 10 hex characters from a fresh
GUID), not a value derived from the machine name: it changes on every run, so it identifies
nothing and two reports cannot be matched through it. With `-NoAnonymize` it is the real machine
name instead, and `pc-unknown` is the fallback when even the draw fails. To correlate several
reports from one player, use the session code the game itself sends, never this field.

`error` carries the error message (`status=error`) or the skip reason (`status=skipped`). The messages
are **localized** (the language of the player's Windows): for server-side matching, use `errorType`
(the exception type name, or `Timeout`, `WorkerCrash`, `WorkerHandling`). Every string goes through a
scrubber: user paths are replaced by `%USERPROFILE%`, `%LOCALAPPDATA%` and so on, user name and
machine name by `%REDACTED%`.
A consumer must tolerate: a missing collector, `data: null`, fields set to `null` (meaning unknown),
and extra fields.

## Collectors

| Name | Contents of `data` | Notes |
|---|---|---|
| `system` | `os{caption,version,build,architecture,uptimeHours}`, `cpu{name,cores,threads,maxClockMHz}`, `isLaptop`, `laptopHints{...}`, `systemDrive{sizeGB,freeGB}` | `isLaptop` = 2 out of 3 vote between chassis type, PCSystemType and battery presence; the raw hints are provided. The machine manufacturer and model are deliberately not collected, in either half of the report: a model name is a machine identifier. |
| `power` | `acLine` (battery/plugged/unknown), `hasBattery`, `batteryPercent`, `batteryCharging`, `batteryMinutesLeft`, `batterySaverOn`, `powerPlan{guid,name}`, `powerModeEffective{guid,name}`, `powerModeSelected{guid,name}`, `source` | `powerMode*` = the Windows 10/11 slider: BestPowerEfficiency, Balanced, BetterPerformance, BestPerformance. `source=cim-fallback` if the native code is blocked (then no powerMode) |
| `memory` | `totalGB`, `availableGB`, `usedPercent`, `commitLimitGB`, `commitUsedGB`, `moduleCount`, `slotCount`, `singleModule`, `modules[]` | `singleModule=true` means single channel for certain |
| `gpu` | `adapters[]{name,vendor,driverVersion,driverDate,vramGB,status,isPhysical}`, `multipleGpus` (iGPU plus dGPU: hybrid on a laptop, a single active iGPU on a desktop, cross-check with `system.isLaptop` and `display.primaryDisplayAdapter`), `hardwareGpuScheduling` (on/off/null), `gameMode`, `windowsGpuPreferences[]{app,preference,raw}`, `windowsGlobalGraphicsSettings` | preferences are filtered to `-Apps` only |
| `display` | `count`, `primaryDisplayAdapter`, `mixedRefreshRates` (59 and 60 Hz count as identical), `displays[]{device,adapter,primary,width,height,refreshHz,maxRefreshHzAtThisResolution,scalePercent,bitsPerPixel}` | native |
| `browsers` | `defaultBrowser` (`chrome`, `edge`, `brave`, `opera`, `firefox`, `other`, or null; the raw ProgId is never emitted), `browsers[]{name,exe,installed,version,running,hardwareAccelerationDisabledByUser,note}` | only the hardware-acceleration key is read from the browser profile. `false` does not prove the GPU is used (launch flags, driver blocklist): the ground truth is `sampling.gpuApps` |
| `processes` | `processCount`, `topCpu[5]`, `topMemory[5]`: `{name,instances,cpuPercent,memoryMB}` | aggregated process names only |
| `nvidia` | `driverVersion`, `driverBranch`, `baseIsCurrentGlobal`, `base{}`, `apps[]` | `skipped` without an NVIDIA GPU. Native |
| `sampling` | `seconds`, `{min,avg,max}` stats for `cpuPercent`, `cpuPerformancePercent`, `cpuMHz`, `memoryAvailableMB`; `gpuAdapters[]{adapter,usagePercent,dedicatedMemoryMB,series}`; `gpuApps[]{app,adapter,usagePercent,samples}`; `series{}`; `counterErrors{}` | Sample mode only. `gpuApps` = **which GPU each tracked app actually uses**. `cpuMHz` = real frequency (the nominal one is `system.cpu.maxClockMHz`). `cpuPerformancePercent` below 100 = CPU under its nominal frequency: normal at idle. To detect throttling, use `cpuPerformancePercentUnderLoad` / `cpuMHzUnderLoad` (the seconds where CPU load was at or above 50 percent; `null` if never reached, see `underLoadSamples`). GPU usage = the Task Manager rule (sum per engine, then the busiest engine) |

### `nvidia.base`: global settings of the NVIDIA control panel

`profileName`, `settingsStored`, `overriddenCount`, `settings[]`: **every** setting the driver knows
(no hard-coded list), each with `id`, `name`, `type`, `overridden`, `default`, `current`,
`defaultLabel` / `currentLabel` (cosmetic labels, often `null`), `allowedValues[]`, `note`.

`overridden` = effective value differs from the NVIDIA default value (a value comparison: the driver's
`isCurrentPredefined` flag is not reliable on the base profile).

### `nvidia.apps[]`: one element per exe in `-Apps`

`app`, `lookup` (`found`, `noProfile` = only the global settings apply, `unknown` = the lookup failed,
see `nvapiStatus`), `profileName`, `isPredefined`, `settingsStored`, `differences[]`.

`differences[]` contains **only what makes the app behave differently from the base profile**:
`id`, `name`, `type`, `current`, `baseValue`, `currentLabel` / `baseLabel`, `differsFromBase`,
`userModified` (the player changed this setting in the app profile), `nvidiaDefaultForApp`, `internal`.
A global override inherited by the app is NOT repeated there (it lives in `base`). Real example: NVIDIA ships
Firefox with the power mode "Adaptive", which wins over a global "Prefer max performance" setting.
Undocumented internal driver flags (no known base value) are omitted unless the user modified them.

## Privacy

No serial number, no user name, no user path (paths reduced to the exe name),
processes reduced to aggregated names, browser profiles: a single key read.

The machine name is **not** in the report by default and **not** encoded in it either: `computer`
is a random per-report code (see the envelope above), so there is nothing to reverse. An earlier
version carried a truncated hash of the machine name, which a dictionary of plausible names
reverses; that is gone.

Every string a collector returns passes `Protect-DiagObject`. Two halves, and the distinction
matters: the **path rewrites** (`%USERPROFILE%`, `%LOCALAPPDATA%`, ...) run only on a string that
holds a `\` or a `%`, since nothing else can contain a path, while the **bare-word redaction** of
the user name and the machine name runs on **every** string, because those appear in plain prose,
in a device name or in a profile name with no path punctuation anywhere.

## Development

Sources: `win/Invoke-HostDiag.ps1` (orchestrator plus the collector registry), `win/collectors/*.ps1`
(one `Get-Diag<Name>($Ctx)` function returning an ordered hashtable), `win/lib/*.cs` (native code, C# 5,
with `using` inside the namespace because the files are concatenated), `win/lib/Summary.ps1`.
Keep every source in pure ASCII.

`npm run host-diag:build` (`scripts/host_diag_build.mjs` over the pure bundler
`scripts/lib/host_diag_bundle.mjs`) inlines those sources into the single shipped file
`dist/HostDiag.ps1` (UTF-8 with BOM, CRLF) and writes `dist/manifest.json`, which pins the
tool version, the schema version and the SHA-256 of the exact bytes. Never hand-edit `dist/`:
`node scripts/host_diag_build.mjs --check` and `tests/host_diag_bundle.test.ts` both fail when it
drifts from the sources.

Rule for the orchestrator: outside a `try`, use only cmdlets, operators and property reads (restricted
mode). In the non-native collectors, use `Get-DiagRound` rather than `[math]::Round`.
