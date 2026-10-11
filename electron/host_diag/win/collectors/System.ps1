function Get-DiagSystem {
    param($Ctx)

    $os  = Get-CimInstance Win32_OperatingSystem
    $cs  = Get-CimInstance Win32_ComputerSystem
    $cpu = @(Get-CimInstance Win32_Processor)[0]

    $ubr = $null
    try { $ubr = (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion').UBR } catch { }

    # Laptop detection: no single source is reliable (mini PCs, USB UPS seen as a battery...),
    # so expose the three raw hints and a majority vote.
    $laptopChassis = 8, 9, 10, 11, 12, 14, 18, 21, 30, 31, 32
    $chassis = @()
    try { $chassis = @((Get-CimInstance Win32_SystemEnclosure).ChassisTypes | ForEach-Object { [int]$_ }) } catch { }
    $hasBattery = $false
    try { $hasBattery = @(Get-CimInstance Win32_Battery).Count -gt 0 } catch { }

    $hintChassis = @($chassis | Where-Object { $laptopChassis -contains $_ }).Count -gt 0
    $hintPcType  = [int]$cs.PCSystemType -eq 2          # 2 = Mobile
    $votes = @($hintChassis, $hintPcType, $hasBattery | Where-Object { $_ }).Count

    $sysDrive = $null
    try {
        $d = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='$($env:SystemDrive)'"
        $sysDrive = [ordered]@{ sizeGB = (Get-DiagRound ($d.Size / 1GB) 1); freeGB = (Get-DiagRound ($d.FreeSpace / 1GB) 1) }
    } catch { }

    [ordered]@{
        os = [ordered]@{
            caption      = $os.Caption
            version      = $os.Version
            build        = if ($ubr) { "$($os.BuildNumber).$ubr" } else { "$($os.BuildNumber)" }
            architecture = $os.OSArchitecture
            # With Windows "fast startup", a shutdown does not reset this: weeks of uptime are common.
            uptimeHours  = (Get-DiagRound (((Get-Date) - $os.LastBootUpTime).TotalHours) 1)
        }
        cpu = [ordered]@{
            name         = "$($cpu.Name)".Trim()
            cores        = [int]$cpu.NumberOfCores
            threads      = [int]$cpu.NumberOfLogicalProcessors
            maxClockMHz  = [int]$cpu.MaxClockSpeed
        }
        isLaptop = $votes -ge 2
        laptopHints = [ordered]@{
            chassisTypes      = $chassis
            chassisIsPortable = $hintChassis
            pcSystemType      = [int]$cs.PCSystemType
            pcSystemIsMobile  = $hintPcType
            hasBattery        = $hasBattery
        }
        systemDrive = $sysDrive
    }
}
