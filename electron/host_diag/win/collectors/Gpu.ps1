function Get-DiagGpuVendor([string]$PnpId) {
    switch -Regex ($PnpId) {
        'VEN_10DE' { 'NVIDIA'; break }
        'VEN_1002' { 'AMD'; break }
        'VEN_8086' { 'Intel'; break }
        'VEN_1414' { 'Microsoft'; break }
        'VEN_5143|VEN_QCOM' { 'Qualcomm'; break }
        default    { 'Other' }
    }
}

# DirectX adapter table: real VRAM (Win32_VideoController.AdapterRAM is capped at 4 GB) and the
# adapter LUID used by the GPU performance counters.
function Get-DiagDxAdapters {
    $list = @()
    try {
        $list = @(Get-ChildItem 'HKLM:\SOFTWARE\Microsoft\DirectX' -ErrorAction Stop | ForEach-Object {
            $p = Get-ItemProperty $_.PSPath
            if ($p.Description) {
                [pscustomobject]@{
                    Description = $p.Description
                    Luid        = if ($null -ne $p.AdapterLuid) { [uint64]$p.AdapterLuid } else { $null }
                    VramBytes   = if ($null -ne $p.DedicatedVideoMemory) { [uint64]$p.DedicatedVideoMemory } else { $null }
                    VendorId    = $p.VendorId
                }
            }
        })
    } catch { }
    return $list
}

function Get-DiagGpu {
    param($Ctx)

    $dx = Get-DiagDxAdapters
    $adapters = @(Get-DiagVideoControllers | ForEach-Object {
        $vc = $_
        $match = $dx | Where-Object { $_.Description -eq $vc.Name } | Select-Object -First 1
        [ordered]@{
            name          = $vc.Name
            vendor        = Get-DiagGpuVendor $vc.PNPDeviceID
            driverVersion = $vc.DriverVersion
            driverDate    = if ($vc.DriverDate) { $vc.DriverDate.ToString('yyyy-MM-dd') } else { $null }
            vramGB        = if ($match -and $match.VramBytes) { (Get-DiagRound ($match.VramBytes / 1GB) 1) } else { $null }
            status        = $vc.Status
            isPhysical    = $vc.PNPDeviceID -match '^PCI\\'
        }
    })

    # Several GPUs (integrated + discrete). On a laptop this means hybrid graphics (Optimus / MX / AMD
    # switchable); on a desktop it only means the iGPU is enabled. Cross with system.isLaptop and
    # display.primaryDisplayAdapter.
    $vendors = @($adapters | Where-Object { $_.isPhysical } | ForEach-Object { $_.vendor } | Sort-Object -Unique)
    $hybrid = ($vendors -contains 'Intel' -and ($vendors -contains 'NVIDIA' -or $vendors -contains 'AMD')) -or
              (@($adapters | Where-Object { $_.isPhysical -and $_.vendor -eq 'AMD' }).Count -ge 2) -or
              ($vendors -contains 'AMD' -and $vendors -contains 'NVIDIA')

    $hags = $null
    try {
        $v = (Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\GraphicsDrivers' -ErrorAction Stop).HwSchMode
        $hags = switch ($v) { 2 { 'on' } 1 { 'off' } default { $null } }
    } catch { }

    $gameMode = $null
    try {
        $v = (Get-ItemProperty 'HKCU:\Software\Microsoft\GameBar' -ErrorAction Stop).AutoGameModeEnabled
        $gameMode = if ($null -eq $v -or $v -eq 1) { 'on' } else { 'off' }
    } catch { $gameMode = 'on' }   # key absent = Windows default = on

    # Windows per-app GPU preference (Settings > Display > Graphics).
    # Only the apps of interest + the global default: other entries are none of our business.
    $prefs = @(); $global = $null
    try {
        $key = Get-Item 'HKCU:\Software\Microsoft\DirectX\UserGpuPreferences' -ErrorAction Stop
        $wanted = @($Ctx.Apps | ForEach-Object { [regex]::Escape($_) }) -join '|'
        foreach ($name in $key.GetValueNames()) {
            $value = "$($key.GetValue($name))"
            if ($name -eq 'DirectXUserGlobalSettings') { $global = $value; continue }
            if ($wanted -and $name -match "(^|\\)($wanted)$") {
                $pref = if ($value -match 'GpuPreference=(\d+)') { [int]$Matches[1] } else { $null }
                $prefs += [ordered]@{
                    app        = Split-Path $name -Leaf          # never the full user path
                    preference = switch ($pref) { 0 { 'auto' } 1 { 'powerSaving' } 2 { 'highPerformance' } default { 'unknown' } }
                    raw        = $value
                }
            }
        }
    } catch { }

    [ordered]@{
        adapters                 = $adapters
        multipleGpus             = $hybrid
        hardwareGpuScheduling    = $hags
        gameMode                 = $gameMode
        windowsGpuPreferences    = $prefs
        windowsGlobalGraphicsSettings = $global     # e.g. "SwapEffectUpgradeEnable=1;VRROptimizeEnable=0;"
    }
}
