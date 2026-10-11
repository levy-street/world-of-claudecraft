function Get-DiagPower {
    param($Ctx)

    # Windows 10/11 "power mode" slider (overlay on top of the classic power plan).
    $overlayNames = @{
        '961cc777-2547-4f9d-8174-7d86181b8a7a' = 'BestPowerEfficiency'
        '00000000-0000-0000-0000-000000000000' = 'Balanced'
        '3af9b8d9-7c97-431d-ad78-34a8bfea439f' = 'BetterPerformance'
        'ded574b5-45a0-4f42-8737-46345c09c238' = 'BestPerformance'
    }
    function Resolve-Overlay($guid) {
        if (-not $guid) { return $null }
        $n = $overlayNames[$guid.ToLower()]
        [ordered]@{ guid = $guid; name = if ($n) { $n } else { 'Unknown' } }
    }

    $nativeError = $null
    try { Initialize-DiagNative } catch { $nativeError = "$($_.Exception.Message)" }

    if (-not $nativeError) {
        $p = [HostDiag.Sys.Power]::Get()
        $hasBattery = $p.StatusOk -and $p.BatteryFlag -ne 255 -and -not ($p.BatteryFlag -band 128)
        return [ordered]@{
            source       = 'native'
            acLine       = switch ($p.AcLineStatus) { 0 { 'battery' } 1 { 'plugged' } default { 'unknown' } }
            hasBattery   = $hasBattery
            batteryPercent     = if ($hasBattery -and $p.BatteryPercent -le 100) { $p.BatteryPercent } else { $null }
            batteryCharging    = if ($hasBattery) { [bool]($p.BatteryFlag -band 8) } else { $null }
            batteryMinutesLeft = if ($hasBattery -and $p.BatterySecondsLeft -ge 0) { [int]($p.BatterySecondsLeft / 60) } else { $null }
            batterySaverOn     = $p.BatterySaverOn
            powerPlan          = [ordered]@{ guid = $p.ActiveSchemeGuid; name = $p.ActiveSchemeName }
            powerModeEffective = Resolve-Overlay $p.EffectiveOverlayGuid
            powerModeSelected  = Resolve-Overlay $p.ActualOverlayGuid
            warnings           = @($p.Warnings)
        }
    }

    # Fallback without Add-Type: no power-mode slider, but battery and plan are still available.
    $bat = @(Get-CimInstance Win32_Battery)
    $plan = $null
    try {
        $active = Get-CimInstance -Namespace root\cimv2\power -ClassName Win32_PowerPlan -Filter 'IsActive=true'
        $plan = [ordered]@{ guid = ($active.InstanceID -replace '.*\{(.+)\}.*', '$1'); name = $active.ElementName }
    } catch { }
    [ordered]@{
        source       = 'cim-fallback'
        acLine       = if ($bat.Count -eq 0) { 'plugged' } elseif ($bat[0].BatteryStatus -eq 1) { 'battery' } else { 'plugged' }
        hasBattery   = $bat.Count -gt 0
        batteryPercent     = if ($bat.Count) { [int]$bat[0].EstimatedChargeRemaining } else { $null }
        batteryCharging    = $null
        batteryMinutesLeft = $null
        batterySaverOn     = $null
        powerPlan          = $plan
        powerModeEffective = $null
        powerModeSelected  = $null
        warnings           = @($nativeError)
    }
}
