# Human-readable digest of a report (what the player can read before sending the JSON).
function Format-DiagSummary {
    param($Report)

    $out = New-Object System.Collections.Generic.List[string]
    $c = $Report.collectors
    function Sect($name) { if ($c[$name] -and $c[$name].status -eq 'ok') { $c[$name].data } }

    $out.Add("host-diag $($Report.tool.version) - $($Report.generatedAt) - mode $($Report.mode) - $($Report.computer)")
    $out.Add('')
    foreach ($name in $c.Keys) {
        $e = $c[$name]
        $out.Add(('  [{0,-10}] {1,-8} {2}' -f $name, $e.status, $e.error))
    }
    $out.Add('')

    $d = Sect 'system'
    if ($d) {
        $out.Add("SYSTEM   $($d.os.caption) build $($d.os.build), uptime $($d.os.uptimeHours) h")
        $out.Add("         $($d.cpu.name) ($($d.cpu.cores)C/$($d.cpu.threads)T)")
        $out.Add("         laptop: $($d.isLaptop)")
    }
    $d = Sect 'power'
    if ($d) {
        $bat = if ($d.hasBattery) { "battery $($d.batteryPercent)%" } else { 'no battery' }
        $out.Add("POWER    $($d.acLine), $bat, battery saver: $($d.batterySaverOn)")
        $out.Add("         plan: $($d.powerPlan.name) - power mode: $($d.powerModeEffective.name)")
    }
    $d = Sect 'memory'
    if ($d) { $out.Add("MEMORY   $($d.availableGB) GB free of $($d.totalGB) GB ($($d.usedPercent)% used), $($d.moduleCount) module(s)") }
    $d = Sect 'gpu'
    if ($d) {
        foreach ($a in $d.adapters) { $out.Add("GPU      $($a.name) [$($a.vendor)] driver $($a.driverVersion) ($($a.driverDate)) VRAM $($a.vramGB) GB") }
        $out.Add("         multiple GPUs: $($d.multipleGpus) - HAGS: $($d.hardwareGpuScheduling) - game mode: $($d.gameMode)")
        foreach ($p in $d.windowsGpuPreferences) { $out.Add("         Windows GPU preference: $($p.app) -> $($p.preference)") }
    }
    $d = Sect 'display'
    if ($d) { foreach ($s in $d.displays) { $out.Add("DISPLAY  $($s.width)x$($s.height) @ $($s.refreshHz) Hz (max $($s.maxRefreshHzAtThisResolution) Hz), scale $($s.scalePercent)%, on $($s.adapter)") } }
    $d = Sect 'browsers'
    if ($d) { foreach ($b in ($d.browsers | Where-Object { $_.installed })) { $out.Add("BROWSER  $($b.name) $($b.version) - hw acceleration disabled by user: $($b.hardwareAccelerationDisabledByUser) - running: $($b.running)") } }
    $d = Sect 'processes'
    if ($d) {
        $out.Add('TOP CPU  ' + (($d.topCpu | ForEach-Object { "$($_.name) $($_.cpuPercent)%" }) -join ', '))
        $out.Add('TOP RAM  ' + (($d.topMemory | ForEach-Object { "$($_.name) $($_.memoryMB) MB" }) -join ', '))
    }
    $d = Sect 'nvidia'
    if ($d) {
        $out.Add("NVIDIA   driver $($d.driverVersion) [$($d.driverBranch)]")
        $out.Add("         [global settings] $($d.base.overriddenCount) changed from NVIDIA defaults")
        foreach ($s in ($d.base.settings | Where-Object { $_.overridden })) {
            $cur = if ($s.currentLabel) { "$($s.current) ($($s.currentLabel))" } else { $s.current }
            $def = if ($s.defaultLabel) { "$($s.default) ($($s.defaultLabel))" } else { $s.default }
            $out.Add("             * $($s.id) $($s.name): $def -> $cur")
        }
        foreach ($p in $d.apps) {
            if ($p.lookup -ne 'found') { $out.Add("         [$($p.app)] $($p.lookup) (status $($p.nvapiStatus)) -> global settings apply"); continue }
            $out.Add("         [$($p.app)] '$($p.profileName)' - $(@($p.differences).Count) difference(s) with global settings")
            foreach ($s in $p.differences) {
                $cur = if ($s.currentLabel) { "$($s.current) ($($s.currentLabel))" } else { $s.current }
                $bas = if ($s.baseLabel) { "$($s.baseValue) ($($s.baseLabel))" } else { $s.baseValue }
                $tag = if ($s.userModified) { 'changed by user' } else { 'NVIDIA preset' }
                $out.Add("             * $($s.id) $($s.name): global $bas -> app $cur  [$tag]")
            }
        }
    }
    $d = Sect 'sampling'
    if ($d) {
        $out.Add("SAMPLING $($d.seconds) s - CPU avg $($d.cpuPercent.avg)% (max $($d.cpuPercent.max)%), clock avg $($d.cpuMHz.avg) MHz (min $($d.cpuMHz.min), max $($d.cpuMHz.max))")
        if ($d.underLoadSamples -gt 0) { $out.Add("         under load ($($d.underLoadSamples) s): clock avg $($d.cpuMHzUnderLoad.avg) MHz (min $($d.cpuMHzUnderLoad.min)), perf avg $($d.cpuPerformancePercentUnderLoad.avg)%") }
        else { $out.Add('         CPU never reached 50% load: clock figures only show idle power saving') }
        $out.Add("         RAM available min $($d.memoryAvailableMB.min) MB")
        foreach ($g in $d.gpuAdapters) { $out.Add("         GPU $($g.adapter): avg $($g.usagePercent.avg)% max $($g.usagePercent.max)%, VRAM max $($g.dedicatedMemoryMB.max) MB") }
        foreach ($g in $d.gpuApps) { $out.Add("         $($g.app) on $($g.adapter): avg $($g.usagePercent.avg)% max $($g.usagePercent.max)%") }
    }
    return $out
}
