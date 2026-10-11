function Get-DiagSampling {
    param($Ctx)

    Initialize-DiagNative
    $seconds = [int]$Ctx.SampleSeconds

    # LUID -> adapter name (the GPU counters only know adapters by LUID).
    $luidNames = @{}
    foreach ($a in Get-DiagDxAdapters) { if ($null -ne $a.Luid) { $luidNames[[uint64]$a.Luid] = $a.Description } }
    $appNames = @{}
    foreach ($app in $Ctx.Apps) { $appNames[([IO.Path]::GetFileNameWithoutExtension($app)).ToLower()] = $app }

    function Stats($values) {
        $v = @($values | Where-Object { $null -ne $_ })
        if ($v.Count -eq 0) { return $null }
        $m = $v | Measure-Object -Minimum -Maximum -Average
        [ordered]@{ min = [math]::Round($m.Minimum, 1); avg = [math]::Round($m.Average, 1); max = [math]::Round($m.Maximum, 1) }
    }

    $q = New-Object HostDiag.Sys.PdhQuery
    try {
        # English counter paths on purpose: PDH resolves them on any Windows language.
        [void]$q.Add('cpuUtil', '\Processor Information(_Total)\% Processor Utility')
        [void]$q.Add('cpuTime', '\Processor Information(_Total)\% Processor Time')
        [void]$q.Add('cpuPerf', '\Processor Information(_Total)\% Processor Performance')
        [void]$q.Add('cpuFreq', '\Processor Information(_Total)\Processor Frequency')
        [void]$q.Add('memAvail', '\Memory\Available MBytes')
        [void]$q.Add('gpuEngine', '\GPU Engine(*)\Utilization Percentage')
        [void]$q.Add('gpuMem', '\GPU Adapter Memory(*)\Dedicated Usage')

        $series = [ordered]@{ cpuPercent = @(); cpuPerformancePercent = @(); cpuMHz = @(); memoryAvailableMB = @() }
        $gpuAdapterSeries = @{}     # adapter name -> values
        $gpuVramSeries    = @{}     # adapter name -> MB
        $gpuAppSeries     = @{}     # "app.exe @ adapter" -> values
        $pidNames         = @{}     # pid -> process name (cache)

        $q.Collect()                # rate counters need a first baseline
        for ($i = 0; $i -lt $seconds; $i++) {
            Start-Sleep -Milliseconds 1000
            $q.Collect()

            $cpu = $q.Read('cpuUtil'); if (-not $cpu.Count) { $cpu = $q.Read('cpuTime') }
            if ($cpu.Count) { $series.cpuPercent += [math]::Round([math]::Min(100, $cpu[0].Value), 1) }
            $perf = $q.Read('cpuPerf'); $freq = $q.Read('cpuFreq')
            if ($perf.Count) {
                # < 100 = the CPU runs below its nominal clock (power saving or thermal throttling); > 100 = turbo.
                $series.cpuPerformancePercent += [math]::Round($perf[0].Value, 1)
                if ($freq.Count) { $series.cpuMHz += [int]($freq[0].Value * $perf[0].Value / 100) }
            }
            $mem = $q.Read('memAvail'); if ($mem.Count) { $series.memoryAvailableMB += [int]$mem[0].Value }

            # GPU engines. Instance: pid_<pid>_luid_0x<hi>_0x<lo>_phys_0_eng_<n>_engtype_<type>
            $perAdapterType = @{}; $perAppType = @{}
            foreach ($s in $q.Read('gpuEngine')) {
                if ($s.Instance -notmatch '^pid_(\d+)_luid_0x([0-9A-Fa-f]+)_0x([0-9A-Fa-f]+)_(phys_\d+_eng_\d+)_engtype_') { continue }
                $luid = ([uint64][Convert]::ToUInt32($Matches[2], 16) -shl 32) -bor [Convert]::ToUInt32($Matches[3], 16)
                $adapter = if ($luidNames.ContainsKey($luid)) { $luidNames[$luid] } else { 'luid:0x{0:X}' -f $luid }
                $type = $Matches[4]      # one physical engine (several engines can share a type)
                $k = "$adapter|$type"
                $perAdapterType[$k] = [double]$perAdapterType[$k] + $s.Value
                $procId = [int]$Matches[1]
                if (-not $pidNames.ContainsKey($procId)) {      # resolve each pid once, not the whole process list every second
                    $pidNames[$procId] = ''
                    try { $pidNames[$procId] = (Get-Process -Id $procId -ErrorAction Stop).ProcessName.ToLower() } catch { }
                }
                $pname = $pidNames[$procId]
                if ($pname -and $appNames.ContainsKey($pname)) {
                    $k2 = "$($appNames[$pname]) @ $adapter|$type"
                    $perAppType[$k2] = [double]$perAppType[$k2] + $s.Value
                }
            }
            # Same rule as Task Manager: sum the processes per ENGINE, then usage of an adapter = its busiest engine.
            foreach ($group in @(@{ src = $perAdapterType; dst = $gpuAdapterSeries }, @{ src = $perAppType; dst = $gpuAppSeries })) {
                $best = @{}
                foreach ($k in $group.src.Keys) {
                    $name = $k.Substring(0, $k.LastIndexOf('|'))
                    if (-not $best.ContainsKey($name) -or $group.src[$k] -gt $best[$name]) { $best[$name] = $group.src[$k] }
                }
                foreach ($name in $best.Keys) {
                    if (-not $group.dst.ContainsKey($name)) { $group.dst[$name] = @() }
                    $group.dst[$name] += [math]::Round([math]::Min(100, $best[$name]), 1)
                }
            }

            foreach ($s in $q.Read('gpuMem')) {
                if ($s.Instance -notmatch 'luid_0x([0-9A-Fa-f]+)_0x([0-9A-Fa-f]+)') { continue }
                $luid = ([uint64][Convert]::ToUInt32($Matches[1], 16) -shl 32) -bor [Convert]::ToUInt32($Matches[2], 16)
                $adapter = if ($luidNames.ContainsKey($luid)) { $luidNames[$luid] } else { 'luid:0x{0:X}' -f $luid }
                if (-not $gpuVramSeries.ContainsKey($adapter)) { $gpuVramSeries[$adapter] = @() }
                $gpuVramSeries[$adapter] += [int]($s.Value / 1MB)
            }
        }

        $gpuAdapters = @($gpuAdapterSeries.Keys | Sort-Object | ForEach-Object {
            [ordered]@{ adapter = $_; usagePercent = Stats $gpuAdapterSeries[$_]; dedicatedMemoryMB = Stats $gpuVramSeries[$_]; series = $gpuAdapterSeries[$_] }
        })
        # Which GPU each app of interest really uses. An app missing here did no GPU work during the window.
        $gpuApps = @($gpuAppSeries.Keys | Sort-Object | ForEach-Object {
            $parts = $_ -split ' @ ', 2
            [ordered]@{ app = $parts[0]; adapter = $parts[1]; usagePercent = Stats $gpuAppSeries[$_]; samples = $gpuAppSeries[$_].Count }
        })

        $underLoadPerf = @(); $underLoadMHz = @()
        $n = [math]::Min([math]::Min($series.cpuPercent.Count, $series.cpuPerformancePercent.Count), $series.cpuMHz.Count)
        for ($k = 0; $k -lt $n; $k++) {
            if ($series.cpuPercent[$k] -ge 50) { $underLoadPerf += $series.cpuPerformancePercent[$k]; $underLoadMHz += $series.cpuMHz[$k] }
        }

        [ordered]@{
            seconds               = $seconds
            cpuPercent            = Stats $series.cpuPercent
            cpuPerformancePercent = Stats $series.cpuPerformancePercent
            cpuMHz                = Stats $series.cpuMHz
            # Same two metrics restricted to the seconds where the CPU was busy (>= 50 %): a low clock at idle
            # is normal power saving, a low clock UNDER LOAD is throttling. null = the CPU was never busy.
            cpuPerformancePercentUnderLoad = Stats $underLoadPerf
            cpuMHzUnderLoad       = Stats $underLoadMHz
            underLoadSamples      = @($underLoadPerf).Count
            memoryAvailableMB     = Stats $series.memoryAvailableMB
            gpuAdapters           = $gpuAdapters
            gpuApps               = $gpuApps
            series                = $series
            counterErrors         = $q.Errors
        }
    }
    finally { $q.Dispose() }
}
