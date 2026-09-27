function Get-DiagProcesses {
    param($Ctx)

    # Two snapshots one second apart to turn cumulative CPU time into a percentage.
    # Privacy: process NAMES only, aggregated; no path, no command line, no window title.
    function Snapshot {
        $h = @{}
        foreach ($p in Get-Process) {
            $cpu = 0.0; try { if ($null -ne $p.CPU) { $cpu = [double]$p.CPU } } catch { }
            $h[$p.Id] = @{ Name = $p.ProcessName; Cpu = $cpu; Ws = [long]$p.WorkingSet64 }
        }
        $h
    }

    $cores = [int]$env:NUMBER_OF_PROCESSORS; if ($cores -lt 1) { $cores = 1 }
    $t0 = Get-Date
    $a = Snapshot
    Start-Sleep -Milliseconds 1000
    $b = Snapshot
    $elapsed = (New-TimeSpan -Start $t0 -End (Get-Date)).TotalSeconds; if ($elapsed -le 0) { $elapsed = 1 }

    $byName = @{}
    foreach ($id in $b.Keys) {
        $n = $b[$id].Name
        if (-not $byName.ContainsKey($n)) { $byName[$n] = @{ Cpu = 0.0; Ws = 0L; Count = 0 } }
        $delta = if ($a.ContainsKey($id) -and $a[$id].Name -eq $n) { $(if ($b[$id].Cpu -gt $a[$id].Cpu) { [double]($b[$id].Cpu - $a[$id].Cpu) } else { 0.0 }) } else { 0.0 }
        $byName[$n].Cpu += $delta; $byName[$n].Ws += $b[$id].Ws; $byName[$n].Count++
    }

    $rows = @($byName.GetEnumerator() | ForEach-Object {
        New-Object psobject -Property @{
            name       = $_.Key
            instances  = $_.Value.Count
            cpuPercent = (Get-DiagRound (100 * $_.Value.Cpu / ($elapsed * $cores)) 1)
            memoryMB   = [int]($_.Value.Ws / 1MB)
        }
    })

    $shape = { param($r) [ordered]@{ name = $r.name; instances = $r.instances; cpuPercent = $r.cpuPercent; memoryMB = $r.memoryMB } }
    [ordered]@{
        processCount = $b.Count
        topCpu    = @($rows | Sort-Object cpuPercent -Descending | Select-Object -First 5 | ForEach-Object { & $shape $_ })
        topMemory = @($rows | Sort-Object memoryMB   -Descending | Select-Object -First 5 | ForEach-Object { & $shape $_ })
    }
}
