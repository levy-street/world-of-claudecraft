function Get-DiagMemory {
    param($Ctx)

    $os = Get-CimInstance Win32_OperatingSystem   # sizes in KB
    $modules = @()
    try {
        $modules = @(Get-CimInstance Win32_PhysicalMemory | ForEach-Object {
            [ordered]@{
                slot            = $_.DeviceLocator
                sizeGB          = (Get-DiagRound ($_.Capacity / 1GB) 1)
                speedMHz        = [int]$_.Speed
                configuredMHz   = [int]$_.ConfiguredClockSpeed
                manufacturer    = "$($_.Manufacturer)".Trim()
            }
        })
    } catch { }

    $slots = $null
    try { $slots = [int](Get-CimInstance Win32_PhysicalMemoryArray | Measure-Object MemoryDevices -Sum).Sum } catch { }

    [ordered]@{
        totalGB        = (Get-DiagRound ($os.TotalVisibleMemorySize / 1MB) 1)
        availableGB    = (Get-DiagRound ($os.FreePhysicalMemory / 1MB) 1)
        usedPercent    = [int](100 - 100 * $os.FreePhysicalMemory / $os.TotalVisibleMemorySize)
        commitLimitGB  = (Get-DiagRound ($os.TotalVirtualMemorySize / 1MB) 1)
        commitUsedGB   = (Get-DiagRound (($os.TotalVirtualMemorySize - $os.FreeVirtualMemory) / 1MB) 1)
        moduleCount    = $modules.Count
        slotCount      = $slots
        # One module = single channel for sure (hurts integrated GPUs a lot). Two or more = probably dual.
        singleModule   = $modules.Count -eq 1
        modules        = $modules
    }
}
