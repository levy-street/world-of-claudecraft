<!-- electron/host_diag/: the host diagnostic shipped with the desktop client.
     Local conventions only; root CLAUDE.md owns the repo-wide rules. -->

# electron/host_diag/

The host diagnostic (Windows layer): a standalone PowerShell tool that collects the machine
configuration behind a game performance complaint. This directory is its single source of
truth. The contract (options, envelope, every collector's `data`) lives in `SCHEMA.md`.

- `win/Invoke-HostDiag.ps1`: the orchestrator plus the collector `$Registry`.
- `win/collectors/*.ps1`: one `Get-Diag<Name>($Ctx)` per collector, returning an ordered hashtable.
- `win/lib/*.cs`: the native helpers (C# 5, `using` inside the namespace: the files are concatenated).
- `win/lib/Summary.ps1`: `Format-DiagSummary`, the human-readable `.txt` view.
- `dist/HostDiag.ps1` + `dist/manifest.json`: the generated single-file script and its pin.

## Contract the tool must keep
- **Read-only, no admin rights, no interaction, no verdict.** It collects; the analysis is
  server-side. A collector that would write, elevate or prompt does not belong here.
- **Privacy**: no serial number, no user name, no user path. Every string leaving a collector
  goes through `Protect-DiagObject`, whose two halves are deliberately asymmetric: the path
  rewrites run only on a string holding `\` or `%`, the bare-word redaction of the user and
  machine name runs on EVERY string. The report's `computer` is a random per-report code, not
  derived from the machine name, unless `-NoAnonymize`. See `SCHEMA.md` "Privacy".
- **Constrained Language Mode**: outside a `try` block the orchestrator uses only cmdlets,
  operators and property reads, because every .NET method call throws under WDAC/AppLocker and
  a JSON document must still come out. In the non-native collectors prefer `Get-DiagRound`
  over `[math]::Round`.
- **Whatever happens, a valid JSON document comes out**, and one broken collector never takes
  another down (see `SCHEMA.md` "Fault tolerance").
- **Pure ASCII and LF-only** in every file under `win/`, no BOM. The tool runs under Windows
  PowerShell 5.1 on any locale, and the bundle's bytes are pinned. `win/**` is `-text` in
  `.gitattributes`, so git never normalizes these files: `tests/host_diag_bundle.test.ts` is what
  keeps them LF. The generated bundle is CRLF, normalized by the bundler.
- **`Add-Type` compiles, and that is what an engine sees.** `Initialize-DiagNative` hands the
  C# in `win/lib/*.cs` to `Add-Type`, which shells out to `csc.exe` and writes a DLL into
  `%TEMP%`. A game spawning PowerShell that compiles code into the temp folder is a known
  antivirus and EDR heuristic, so a first false-positive report starts there: check whether the
  engine flagged the compile rather than the script, and note that the non-native collectors
  keep working when `Add-Type` is blocked.
- **The Browsers collector reads Chromium's `Local State` whole**, the second suspect after
  `Add-Type`. The file is single-line JSON, so there is no bounded read that finds the
  `hardware_acceleration_mode` flag, and it also holds the DPAPI-wrapped `os_crypt` key, so an
  engine can read the access as infostealer-shaped. Only the boolean leaves the collector: never
  widen what is parsed or kept from that file.
- **The tool names itself `host-diag`**: `tool.name`, the `HOSTDIAG_*` test hooks, the
  `HostDiag.*` C# namespaces, the `@@HOSTDIAG...@@` splice markers and the `host-diag-*` output
  file prefix. The collector and helper functions stay neutral (`Get-Diag*`, `Protect-Diag*`).

## Who consumes it
`electron/host_diag.cjs` is the ONLY consumer. It resolves `dist/HostDiag.ps1` (packaged:
`<resourcesPath>/host-diag/`, outside the asar, because PowerShell cannot read a file inside
one; dev: this checkout), verifies the bytes against `dist/manifest.json`, which stays INSIDE
the asar, and spawns the script only on a match, with a fixed argv, `-StdoutJson`, and a
bounded runtime and output. Nothing else in the shell reads this directory, and no player ever
invokes the tool by hand. The packaging split, the hash rationale and the per-release
antivirus checklist live in `docs/desktop-release.md`, "Host diagnostic".

## Building
- Never hand-edit `dist/`. Run `npm run host-diag:build` (`scripts/host_diag_build.mjs` over the
  pure bundler `scripts/lib/host_diag_bundle.mjs`) and commit the result.
- Freshness, the ASCII and LF rules and the bundle's shape are pinned by
  `tests/host_diag_bundle.test.ts`; `node scripts/host_diag_build.mjs --check` is the same check
  as a CLI.
- `$ToolVersion` in the orchestrator is the single source of the manifest's `toolVersion`: bump it
  whenever the tool's behavior or its self-reported identity changes, and rebuild. `$SchemaVersion`
  moves only with the envelope contract in `SCHEMA.md`.
