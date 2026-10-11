<#
.SYNOPSIS
    Host diagnostic for game performance issues (Windows native layer).
    Runs independent collectors and writes one versioned JSON file.
    READ-ONLY, no admin rights, no interaction. See SCHEMA.md.

.EXAMPLE
    powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File Invoke-HostDiag.ps1 -OutDir C:\temp
.EXAMPLE
    ... -Mode Sample -SampleSeconds 30 -Apps chrome.exe,MyGame.exe
#>
[CmdletBinding()]
param(
    [string]$OutDir = '',
    # Executables of interest: NVIDIA profile, Windows GPU preference, GPU usage while sampling.
    [string[]]$Apps = @('chrome.exe', 'msedge.exe', 'firefox.exe', 'brave.exe', 'opera.exe'),
    # Snapshot = configuration only. Sample = configuration + live measures during -SampleSeconds.
    [ValidateSet('Snapshot', 'Sample')][string]$Mode = 'Snapshot',
    [ValidateRange(3, 300)][int]$SampleSeconds = 20,
    [string[]]$Only = @(),
    [string[]]$Skip = @(),
    # Keep the real computer name in the report (default: short hash only).
    [switch]$NoAnonymize,
    # Also write a human-readable .txt next to the JSON.
    [switch]$Summary,
    # Print the JSON on stdout and nothing else (progress is silenced).
    [switch]$StdoutJson,
    [switch]$Quiet,
    # A collector still running after this delay is killed and reported as "error: timeout".
    [ValidateRange(5, 600)][int]$CollectorTimeoutSeconds = 60,
    # Debug: run collectors inside this process (no crash/hang protection).
    [switch]$InProcess,
    # Internal (isolation mechanism): run a single collector, write its result to -ResultFile,
    # and die with the parent process.
    [string]$Worker = '',
    [string]$ResultFile = '',
    [int]$ParentPid = 0
)

# ==============================================================================
# RULE FOR THIS FILE: outside of a try{} block, use only cmdlets, operators and
# property reads. On locked-down machines (Constrained Language Mode) every .NET
# method call / New-Object throws; the orchestrator must still emit a JSON there.
# ==============================================================================
$ErrorActionPreference = 'Stop'
$ToolVersion = '0.3.1'
$SchemaVersion = 2
$FullLanguage = "$($ExecutionContext.SessionState.LanguageMode)" -eq 'FullLanguage'
$SelfPath = $MyInvocation.MyCommand.Path

# ------------------------------------------------------------
# 32-bit PowerShell on 64-bit Windows (e.g. spawned by a 32-bit Electron): registry and
# System32 are redirected, so half of the data would be wrong. Relaunch as 64-bit.
# Start-Process -NoNewWindow hands our stdout/stderr handles to the child untouched.
# ------------------------------------------------------------
if ($env:PROCESSOR_ARCHITEW6432 -and -not $Worker -and $SelfPath -and -not $env:HOSTDIAG_NO_RELAUNCH) {
    $relaunched = $false; $code = 0
    try {
        $native = Join-Path $env:windir 'sysnative\WindowsPowerShell\v1.0\powershell.exe'
        if (Test-Path $native) {
            $argList = @('-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', "`"$SelfPath`"")
            foreach ($k in $PSBoundParameters.Keys) {
                $v = $PSBoundParameters[$k]
                if ($v -is [switch]) { if ($v) { $argList += "-$k" } }
                else { $argList += "-$k"; $argList += "`"$(@($v) -join ',')`"" }
            }
            $env:HOSTDIAG_NO_RELAUNCH = '1'
            $p = Start-Process -FilePath $native -ArgumentList $argList -NoNewWindow -Wait -PassThru
            $code = $p.ExitCode; $relaunched = $true
        }
    } catch { $relaunched = $false }
    if ($relaunched) { exit $code }
}

# "-Apps a.exe,b.exe" through powershell.exe -File arrives as ONE string.
$Apps = @($Apps | ForEach-Object { $_ -split ',' } | ForEach-Object { $_.Trim() } | Where-Object { $_ -and $_ -ne '_none_' })
$Only = @($Only | ForEach-Object { $_ -split ',' } | ForEach-Object { $_.Trim().ToLower() } | Where-Object { $_ })
$Skip = @($Skip | ForEach-Object { $_ -split ',' } | ForEach-Object { $_.Trim().ToLower() } | Where-Object { $_ })

#region BUILD:INCLUDES  (replaced by scripts/host_diag_build.mjs with the inlined content)
$script:NativeSources = @(
    Get-Content (Join-Path $PSScriptRoot 'lib\NvDrs.cs') -Raw
    Get-Content (Join-Path $PSScriptRoot 'lib\SysNative.cs') -Raw
)
foreach ($f in @(Get-ChildItem (Join-Path $PSScriptRoot 'lib\*.ps1')) + @(Get-ChildItem (Join-Path $PSScriptRoot 'collectors\*.ps1'))) {
    try { . $f.FullName } catch { Write-Warning "host-diag: cannot load $($f.Name)" }   # its collector will report "error"
}
#endregion

# ------------------------------------------------------------
# Shared helpers (available to every collector)
# ------------------------------------------------------------

# Compiles the C# helpers once. Throws a clear error where Add-Type is blocked: native
# collectors then report "error" (or use their fallback) and the others keep working.
$script:NativeState = $null
function Initialize-DiagNative {
    if ($script:NativeState -eq 'ok') { return }
    if ($script:NativeState) { throw $script:NativeState }
    try {
        if (-not ('HostDiag.Sys.Power' -as [type])) {
            Add-Type -Language CSharp -TypeDefinition ($script:NativeSources -join "`n")
        }
        [HostDiag.Sys.Runtime]::DisableCrashDialogs()      # a native crash must not pop a Windows error box
        $script:NativeState = 'ok'
    } catch {
        $script:NativeState = "Native helpers unavailable (LanguageMode=$($ExecutionContext.SessionState.LanguageMode)): $($_.Exception.Message)"
        throw $script:NativeState
    }
}

# GPU list from CIM, shared by several collectors.
$script:VideoControllers = $null
function Get-DiagVideoControllers {
    if ($null -eq $script:VideoControllers) { $script:VideoControllers = @(Get-CimInstance Win32_VideoController) }
    return $script:VideoControllers
}

function Write-DiagProgress([string]$Text) {
    if (-not $Quiet -and -not $StdoutJson) { Write-Host $Text }
}

# Rounding without [math] (method calls are forbidden in Constrained Language Mode; casts are not).
function Get-DiagRound($Value, [int]$Decimals = 1) {
    if ($null -eq $Value) { return $null }
    $m = 1; for ($i = 0; $i -lt $Decimals; $i++) { $m *= 10 }
    return ([long]([double]$Value * $m)) / $m
}

function Get-DiagElapsedMs($since) {
    try { return [int](New-TimeSpan -Start $since -End (Get-Date)).TotalMilliseconds } catch { return 0 }
}

# Privacy: error texts and notes come from exceptions and may quote user paths. Every string
# leaving a collector goes through this. Operators only (works in Constrained Language Mode).
# Two independent jobs, split on purpose (see Protect-DiagObject):
#   Protect-DiagPaths - rewrites a user path to a token. Only a string holding '\' or '%' can
#                       contain one, so that test is a sound fast path for THIS half.
#   Protect-DiagWords - redacts the bare user name / machine name. Those appear in plain prose
#                       ("access denied for mathieu"), in a device name, in a profile name: no
#                       backslash and no percent in sight, so this half must run on EVERY string.
$script:ScrubPairs = @()
foreach ($pair in @(
        @($env:LOCALAPPDATA, '%LOCALAPPDATA%'), @($env:APPDATA, '%APPDATA%'), @($env:TEMP, '%TEMP%'),
        @($env:USERPROFILE, '%USERPROFILE%'), @($(if ($SelfPath) { Split-Path -Parent $SelfPath }), '%SCRIPTDIR%'))) {
    if ($pair[0]) { $script:ScrubPairs += , @(($pair[0] -replace '([\\\.\^\$\|\?\*\+\(\)\[\]\{\}])', '\$1'), $pair[1]) }
}
# Built once: a per-string rebuild of these two patterns would run on every scrubbed value.
$script:ScrubWords = @()
foreach ($word in @($env:USERNAME, $env:COMPUTERNAME)) {
    if ($word -and $word.Length -ge 3) { $script:ScrubWords += ('(?i)\b' + ($word -replace '([\\\.\^\$\|\?\*\+\(\)\[\]\{\}])', '\$1') + '\b') }
}
function Protect-DiagPaths([string]$Text) {
    if (-not $Text) { return $Text }
    foreach ($pair in $script:ScrubPairs) { $Text = $Text -replace $pair[0], $pair[1] }
    return ($Text -replace '(?i)[a-z]:\\Users\\[^\\''"<>|:*?\r\n]+', '%USERPROFILE%')
}
function Protect-DiagWords([string]$Text) {
    if (-not $Text) { return $Text }
    foreach ($re in $script:ScrubWords) { $Text = $Text -replace $re, '%REDACTED%' }
    return $Text
}
# The full scrub, in that order: rewrite the paths first, then redact whatever bare word
# survived. What every error message and note goes through.
function Protect-DiagText([string]$Text) {
    return (Protect-DiagWords (Protect-DiagPaths $Text))
}
function Protect-DiagObject($Value, [int]$Depth = 0) {
    if ($null -eq $Value -or $Depth -gt 12) { return $Value }
    # Every string gets the bare-word redaction; only a path-shaped one pays for the rewrites.
    if ($Value -is [string]) { if ($Value -match '\\|%') { return (Protect-DiagText $Value) } else { return (Protect-DiagWords $Value) } }
    if ($Value -is [System.Collections.IDictionary]) {
        foreach ($k in @($Value.Keys)) { $Value[$k] = Protect-DiagObject $Value[$k] ($Depth + 1) }
        return $Value
    }
    if ($Value -is [array]) {
        for ($i = 0; $i -lt $Value.Count; $i++) { $Value[$i] = Protect-DiagObject $Value[$i] ($Depth + 1) }
        return , $Value
    }
    return $Value
}

# ------------------------------------------------------------
# Collector registry. Order = order in the report.
#   Phase    : 1 (default) runs in parallel; 2 and 3 run alone afterwards so that
#              processes/sampling do not measure our own workers.
#   Condition: scriptblock returning $null (run) or a skip reason. Evaluated inside the worker
#              (it may query WMI, which can hang) unless ConditionIsCheap.
# ------------------------------------------------------------
$Registry = @(
    @{ Name = 'system';    Fn = 'Get-DiagSystem' }
    @{ Name = 'power';     Fn = 'Get-DiagPower' }
    @{ Name = 'memory';    Fn = 'Get-DiagMemory' }
    @{ Name = 'gpu';       Fn = 'Get-DiagGpu' }
    @{ Name = 'display';   Fn = 'Get-DiagDisplay' }
    @{ Name = 'browsers';  Fn = 'Get-DiagBrowsers' }
    @{ Name = 'processes'; Fn = 'Get-DiagProcesses'; Phase = 2 }
    @{ Name = 'nvidia';    Fn = 'Get-DiagNvidia'
       Condition = { if (-not (Get-DiagVideoControllers | Where-Object { $_.PNPDeviceID -match 'VEN_10DE' })) { 'no NVIDIA GPU detected' } } }
    @{ Name = 'sampling';  Fn = 'Get-DiagSampling'; Phase = 3; ConditionIsCheap = $true
       Condition = { if ($Mode -ne 'Sample') { 'snapshot mode' } } }
)
$MaxParallel = 4      # more concurrent PowerShell + C# compilations would choke slow laptops

$Ctx = @{ Apps = $Apps; Mode = $Mode; SampleSeconds = $SampleSeconds }

# ------------------------------------------------------------
# Running ONE collector (used in-process and by worker processes)
# ------------------------------------------------------------
function Invoke-DiagCollector($c) {
    $entry = [ordered]@{ status = 'ok'; durationMs = 0; error = $null; errorType = $null; data = $null }
    $t0 = Get-Date
    try {
        #region BUILD:TESTHOOKS dev-only, the bundler strips this region from the shipped script
        # Environment variables are inherited by worker processes.
        if ($env:HOSTDIAG_TEST_FAIL  -eq $c.Name) { throw 'injected failure (HOSTDIAG_TEST_FAIL)' }
        if ($env:HOSTDIAG_TEST_HANG  -eq $c.Name) { Start-Sleep -Seconds 3600 }
        if ($env:HOSTDIAG_TEST_CRASH -eq $c.Name) { [Environment]::FailFast('injected crash (HOSTDIAG_TEST_CRASH)') }
        #endregion
        $reason = $null
        if ($c.Condition) { $reason = & $c.Condition }
        if ($reason) { $entry.status = 'skipped'; $entry.error = "$reason" }
        else { $entry.data = Protect-DiagObject (& $c.Fn $Ctx) }
    } catch {
        $entry.status = 'error'
        $entry.data   = $null
        $entry.error  = Protect-DiagText "$($_.Exception.Message)"
        # Messages are localized; the exception type is what a server can match on.
        try { $entry.errorType = $_.Exception.GetType().Name } catch { $entry.errorType = "$($_.FullyQualifiedErrorId)" }
    }
    $entry.durationMs = Get-DiagElapsedMs $t0
    return $entry
}

# ------------------------------------------------------------
# Worker mode: run one collector and hand the result back through a file.
# (Not through stdout: a grandchild such as csc.exe can keep that pipe open.)
# ------------------------------------------------------------
if ($Worker) {
    if ($ParentPid -gt 0) {
        # Die with the parent (Electron killed the tool, console closed...). Runs on its own thread,
        # so it works even while the collector is stuck in a blocking call.
        try {
            $watchdog = [powershell]::Create()
            [void]$watchdog.AddScript('param($id) while (Get-Process -Id $id -ErrorAction SilentlyContinue) { Start-Sleep -Seconds 2 }; [Environment]::Exit(3)').AddArgument($ParentPid)
            [void]$watchdog.BeginInvoke()
        } catch { }
    }
    $c = $Registry | Where-Object { $_.Name -eq $Worker } | Select-Object -First 1
    $entry = if ($c) { Invoke-DiagCollector $c } else { [ordered]@{ status = 'error'; durationMs = 0; error = "unknown collector '$Worker'"; errorType = $null; data = $null } }
    try { $text = $entry | ConvertTo-Json -Depth 12 -Compress }
    catch { $text = ([ordered]@{ status = 'error'; durationMs = $entry.durationMs; error = 'result serialization failed'; errorType = $null; data = $null } | ConvertTo-Json -Compress) }
    try {
        if ($ResultFile) { [IO.File]::WriteAllText($ResultFile, $text, (New-Object Text.UTF8Encoding($false))) }
        else { Write-Output $text }
    } catch { Write-Output $text }
    exit 0
}

# ------------------------------------------------------------
# Stale worker residue. Complete-DiagWorker deletes each fragment in its finally block, but a
# run the caller KILLED (Electron's 120 s cap, the console closed, a reboot) never reaches it,
# and %TEMP%\hostdiag-<guid>-<collector>.json is left behind. Orchestrator only, once, and
# strictly older than 10 minutes so a concurrent run's live fragments are never touched.
# Entirely best-effort: a locked file, a redirected TEMP, a missing folder all just mean the
# residue stays, which costs a few KB and nothing else.
# ------------------------------------------------------------
try {
    $staleBefore = (Get-Date) - (New-TimeSpan -Minutes 10)
    foreach ($old in @(Get-ChildItem -LiteralPath $env:TEMP -Filter 'hostdiag-*.json' -File -Force -ErrorAction SilentlyContinue)) {
        if ($old.LastWriteTime -lt $staleBefore) { Remove-Item -LiteralPath $old.FullName -Force -ErrorAction SilentlyContinue }
    }
} catch { }

# ------------------------------------------------------------
# Isolation: each collector runs in its own child process with a timeout, so that a native
# crash (access violation inside a driver DLL) or a hang (stuck WMI query) only loses THAT
# collector. try/catch alone cannot protect against those two.
# Not available in Constrained Language Mode -> collectors run in-process there.
# ------------------------------------------------------------
$HostExe = $null
try { $HostExe = (Get-Process -Id $PID).Path } catch { }
$Isolate = $FullLanguage -and (-not $InProcess) -and $SelfPath -and $HostExe

function Start-DiagWorker($c) {
    $appsArg = if ($Apps.Count) { $Apps -join ',' } else { '_none_' }
    $result  = Join-Path $env:TEMP ("hostdiag-{0}-{1}.json" -f [guid]::NewGuid().ToString('N'), $c.Name)
    $psi = New-Object Diagnostics.ProcessStartInfo
    $psi.FileName  = $HostExe
    $psi.Arguments = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$SelfPath`" -Worker $($c.Name) -ResultFile `"$result`" -ParentPid $PID -Apps `"$appsArg`" -Mode $Mode -SampleSeconds $SampleSeconds"
    $psi.UseShellExecute = $false; $psi.CreateNoWindow = $true
    $psi.RedirectStandardError = $true
    $p = [Diagnostics.Process]::Start($psi)
    $seconds = if ($c.Name -eq 'sampling') { $SampleSeconds + $CollectorTimeoutSeconds } else { $CollectorTimeoutSeconds }
    @{ Collector = $c; Process = $p; Started = Get-Date; TimeoutMs = 1000 * $seconds; ResultFile = $result
       Err = $p.StandardError.ReadToEndAsync() }      # async read: no pipe deadlock
}

# Turns a finished/expired worker into @{ Entry = <object>; Raw = <json text or $null> }.
function Complete-DiagWorker($w, [bool]$timedOut) {
    $ms = Get-DiagElapsedMs $w.Started
    $fail = { param($msg, $type) @{ Raw = $null; Entry = [ordered]@{ status = 'error'; durationMs = $ms; error = (Protect-DiagText $msg); errorType = $type; data = $null } } }
    try {
        if ($timedOut) {
            try { $w.Process.Kill() } catch { }
            return & $fail "timeout: collector killed after $([int]($w.TimeoutMs / 1000)) s" 'Timeout'
        }
        $w.Process.WaitForExit()
        $out = ''
        try { if (Test-Path $w.ResultFile) { $out = [IO.File]::ReadAllText($w.ResultFile).Trim() } } catch { }
        if ($out.StartsWith('{') -and $out.EndsWith('}')) {
            try { return @{ Raw = $out; Entry = ($out | ConvertFrom-Json) } } catch { }
        }
        $err = ''
        try { if ($w.Err.Wait(500)) { $err = "$($w.Err.Result)".Trim() } } catch { }
        if ($err.Length -gt 300) { $err = $err.Substring(0, 300) }
        return & $fail ("collector process crashed (exit code {0}) {1}" -f $w.Process.ExitCode, $err).Trim() 'WorkerCrash'
    } catch {
        return & $fail "worker handling failed: $($_.Exception.Message)" 'WorkerHandling'
    } finally {
        try { $w.Process.Dispose() } catch { }
        try { if (Test-Path $w.ResultFile) { Remove-Item $w.ResultFile -Force } } catch { }
    }
}

# ------------------------------------------------------------
# Main. Whatever happens, a JSON document comes out.
# ------------------------------------------------------------
# The report's machine label. NOT derived from the computer name: a truncated SHA-256 of a
# name is a pseudonym anyone can reverse by hashing a dictionary of plausible names (and the
# default Windows name is DESKTOP-<7 chars> from a tiny alphabet), and this file is mailed to
# a stranger. A fresh random code per report tells a reader nothing about the machine, which
# is all that is wanted here: two reports from one player are correlated by the session code
# the game already sends, not by this field.
$computer = 'pc-unknown'
try {
    $computer = if ($NoAnonymize) { $env:COMPUTERNAME } else {
        'pc-' + (("$(New-Guid)" -replace '-', '') -replace '^(.{10}).*$', '$1')
    }
} catch { }

$warnings = @()
$known = @($Registry | ForEach-Object { $_.Name })
foreach ($n in @($Only) + @($Skip)) { if ($known -notcontains $n) { $warnings += "unknown collector name '$n' in -Only/-Skip" } }
if (-not $FullLanguage) { $warnings += 'restricted PowerShell language mode: no process isolation, native collectors unavailable' }

$report = [ordered]@{
    schemaVersion = $SchemaVersion
    tool          = [ordered]@{ name = 'host-diag'; version = $ToolVersion }
    generatedAt   = Get-Date -Format 'o'
    mode          = $Mode
    computer      = $computer
    apps          = $Apps
    host          = [ordered]@{
        powershell   = "$($PSVersionTable.PSVersion)"
        bitness      = if ($env:PROCESSOR_ARCHITECTURE -eq 'x86') { 32 } else { 64 }
        languageMode = "$($ExecutionContext.SessionState.LanguageMode)"
        culture      = "$((Get-Culture).Name)"
        isolation    = if ($Isolate) { 'process' } else { 'none' }
    }
    warnings      = $warnings
    fatalError    = $null
    collectors    = [ordered]@{}
}
$entries = [ordered]@{}     # name -> entry object (for the summary and the exit code)
$rawJson = @{}              # name -> JSON text produced by a worker, spliced as-is into the report

function Register-DiagResult($name, $entry, $raw) {
    $entries[$name] = $entry
    if ($raw) { $rawJson[$name] = $raw }
    Write-DiagProgress ("[{0,-10}] {1,-8} {2,6} ms  {3}" -f $name, $entry.status, $entry.durationMs, $entry.error)
}

try {
    $todo = @()
    foreach ($c in $Registry) {
        $reason = $null
        if     ($Only.Count -and $Only -notcontains $c.Name) { $reason = 'not selected (-Only)' }
        elseif ($Skip -contains $c.Name)                     { $reason = 'excluded (-Skip)' }
        elseif ($c.Condition -and $c.ConditionIsCheap) { try { $reason = & $c.Condition } catch { $reason = $null } }
        if ($reason) { Register-DiagResult $c.Name ([ordered]@{ status = 'skipped'; durationMs = 0; error = "$reason"; errorType = $null; data = $null }) $null }
        else { $todo += $c }
    }

    foreach ($phase in 1, 2, 3) {
        $queue = @($todo | Where-Object { $p = if ($_.Phase) { $_.Phase } else { 1 }; $p -eq $phase })
        $workers = @()
        while ($queue.Count -or $workers.Count) {
            while ($queue.Count -and $workers.Count -lt $MaxParallel) {
                $c = $queue[0]
                $queue = @($queue | Select-Object -Skip 1)
                $started = $null
                if ($Isolate) { try { $started = Start-DiagWorker $c } catch { $started = $null } }
                if ($started) { $workers += $started }
                else { Register-DiagResult $c.Name (Invoke-DiagCollector $c) $null }     # isolation unavailable: run here
            }
            $still = @()
            foreach ($w in $workers) {
                $expired = (Get-DiagElapsedMs $w.Started) -gt $w.TimeoutMs
                if ($w.Process.HasExited -or $expired) {
                    $r = Complete-DiagWorker $w ($expired -and -not $w.Process.HasExited)
                    Register-DiagResult $w.Collector.Name $r.Entry $r.Raw
                } else { $still += $w }
            }
            $workers = $still
            if ($workers.Count) { Start-Sleep -Milliseconds 100 }
        }
    }
} catch {
    $report.fatalError = Protect-DiagText "orchestrator: $($_.Exception.Message)"
}

# Keep registry order in the output, whatever the completion order was.
$failed = 0; $ran = 0
foreach ($c in $Registry) {
    $e = $entries[$c.Name]
    if (-not $e) { $e = [ordered]@{ status = 'error'; durationMs = 0; error = 'not run (orchestrator failure)'; errorType = $null; data = $null }; $entries[$c.Name] = $e }
    if ($e.status -eq 'ok') { $ran++ } elseif ($e.status -eq 'error') { $failed++ }
    $report.collectors[$c.Name] = if ($rawJson[$c.Name]) { "@@HOSTDIAG:$($c.Name)@@" } else { $e }
}
# 0 = all good, 1 = partial, 2 = nothing usable (includes "everything skipped", e.g. a typo in -Only).
$exit = if ($report.fatalError -or $ran -eq 0) { 2 } elseif ($failed -gt 0) { 1 } else { 0 }

$json = $null
try {
    $json = $report | ConvertTo-Json -Depth 12
    foreach ($name in @($rawJson.Keys)) { $json = $json -replace [regex]::Escape("`"@@HOSTDIAG:$name@@`""), ($rawJson[$name] -replace '\$', '$$$$') }
} catch {
    $exit = 2
    $json = '{"schemaVersion":' + $SchemaVersion + ',"fatalError":"report serialization failed","collectors":{}}'
}

function Write-DiagTextFile([string]$Path, $Lines) {
    if ($FullLanguage) { [IO.File]::WriteAllLines($Path, [string[]]@($Lines), (New-Object Text.UTF8Encoding($false))) }   # no BOM: friendlier to JSON.parse
    else { Set-Content -LiteralPath $Path -Value $Lines -Encoding UTF8 }
}

$written = $false
if (-not $StdoutJson) {
    # Asked folder, then the script folder, then %TEMP% (the script folder is read-only under Program Files).
    $candidates = @($OutDir, $(if ($SelfPath) { Split-Path -Parent $SelfPath }), $env:TEMP) | Where-Object { $_ } | Select-Object -Unique
    if ($OutDir) { $candidates = @($OutDir, $env:TEMP) | Select-Object -Unique }
    foreach ($dir in $candidates) {
        try {
            if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force $dir | Out-Null }
            $base = Join-Path $dir ("host-diag-{0}-{1}" -f $computer, (Get-Date -Format 'yyyyMMdd-HHmmss'))
            Write-DiagTextFile "$base.json" $json
            Write-DiagProgress "Written: $base.json"
            $written = $true
            if ($Summary) {
                try {
                    $view = [ordered]@{ tool = $report.tool; generatedAt = $report.generatedAt; mode = $Mode; computer = $computer; warnings = $warnings; collectors = $entries }
                    Write-DiagTextFile "$base.txt" (Format-DiagSummary $view)
                    Write-DiagProgress "Written: $base.txt"
                } catch { Write-DiagProgress 'Summary failed.' }
            }
            break
        } catch { Write-DiagProgress "Cannot write to $dir" }
    }
}
if (-not $written) {
    # -StdoutJson, or nowhere to write: the JSON is the ONLY thing on stdout, after this marker line.
    if (-not $StdoutJson) { $exit = 2 }
    try { [Console]::OutputEncoding = New-Object Text.UTF8Encoding($false) } catch { }
    if (-not $StdoutJson) { Write-Output '@@HOSTDIAG-JSON@@' }
    Write-Output $json
}
exit $exit
