# Friendly names for a few values. Cosmetic only: the raw hex value is always kept,
# and settings/values missing from this table are dumped anyway (nothing is filtered by it).
$script:NvValueHints = @{
    '0x1057EB71' = @{ '0x00000000'='Adaptive'; '0x00000001'='Prefer max performance'; '0x00000002'='Driver controlled'
                      '0x00000003'='Consistent performance'; '0x00000004'='Prefer min performance'; '0x00000005'='Optimal power' }
    '0x00A879CF' = @{ '0x60925292'='Use 3D application setting'; '0x08416747'='Force off'; '0x47814940'='Force on'
                      '0x32610244'='Half refresh rate'; '0x18888888'='Fast sync' }
    '0x00198FFF' = @{ '0x00000000'='Off'; '0x00000001'='On' }
    '0x00CE2691' = @{ '0xFFFFFFF6'='High quality'; '0x00000000'='Quality'; '0x0000000A'='Performance'; '0x00000014'='High performance' }
    '0x007BA09E' = @{ '0x00000000'='Use 3D application setting' }
    '0x10835002' = @{ '0x00000000'='Off' }
}

function Get-DiagNvidia {
    param($Ctx)

    Initialize-DiagNative
    $r = [HostDiag.Nv.Dumper]::Run([string[]]$Ctx.Apps, [string[]]@())
    if (-not $r.Success) { throw "NVAPI failed at [$($r.FailedStep)] status=$($r.Status): $($r.Error)" }

    function Label([string]$IdHex, [string]$Value) {
        if ($null -eq $Value -or $Value -eq '') { return $null }
        $map = $script:NvValueHints[$IdHex]
        if ($map -and $map.ContainsKey($Value)) { return $map[$Value] }
        return $null
    }

    # ---- Base profile = "Global settings" of the NVIDIA Control Panel ----
    # Every setting the driver knows is listed. overridden = effective value != NVIDIA default.
    $base = $r.Profiles | Where-Object { $_.Target -eq 'base' } | Select-Object -First 1
    $baseValues = @{}
    foreach ($s in $base.Settings) { $baseValues[$s.IdHex] = $s.CurrentValue }

    $baseRows = @($base.Settings | Sort-Object @{e={-not $_.Overridden}}, Name, Id | ForEach-Object {
        [ordered]@{
            id            = $_.IdHex
            name          = $_.Name
            type          = $_.Type
            overridden    = $_.Overridden
            default       = $_.DefaultValue
            defaultLabel  = Label $_.IdHex $_.DefaultValue
            current       = $_.CurrentValue
            currentLabel  = Label $_.IdHex $_.CurrentValue
            allowedValues = $_.AllowedValues
            note          = $_.Note
        }
    })

    # ---- App profiles: ONLY what makes the app behave differently from the base profile ----
    #   differsFromBase: effective value for this app != effective value of the base profile
    #                    (e.g. NVIDIA ships Firefox with "Adaptive" power mode whatever the global setting is)
    #   userModified   : the user changed this setting in the app's own profile
    # A global override inherited by the app is NOT repeated here: it is in the base profile.
    # Undocumented internal driver flags (no known base value) are left out unless user-modified.
    $apps = @(foreach ($p in ($r.Profiles | Where-Object { $_.Target -ne 'base' })) {
        $rows = @()
        foreach ($s in ($p.Settings | Sort-Object Name, Id)) {
            $hasBase = $baseValues.ContainsKey($s.IdHex) -and $null -ne $baseValues[$s.IdHex]
            $differs = $hasBase -and $s.CurrentValue -ne $baseValues[$s.IdHex]
            $userModified = $s.InProfile -and $s.Overridden
            if (-not ($differs -or $userModified)) { continue }
            $rows += [ordered]@{
                id              = $s.IdHex
                name            = $s.Name
                type            = $s.Type
                current         = $s.CurrentValue
                currentLabel    = Label $s.IdHex $s.CurrentValue
                baseValue       = if ($hasBase) { $baseValues[$s.IdHex] } else { $null }
                baseLabel       = if ($hasBase) { Label $s.IdHex $baseValues[$s.IdHex] } else { $null }
                differsFromBase = $differs
                userModified    = $userModified
                nvidiaDefaultForApp = $s.DefaultValue
                internal        = $s.Internal
            }
        }
        [ordered]@{
            app             = $p.Target -replace '^app:', ''
            # found | noProfile (only the base profile applies) | unknown (lookup failed, see nvapiStatus)
            lookup          = if ($p.Found) { 'found' } elseif ($p.Status -eq -166) { 'noProfile' } else { 'unknown' }
            nvapiStatus     = $p.Status
            profileName     = $p.ProfileName
            isPredefined    = $p.IsPredefined
            settingsStored  = $p.NumSettingsInProfile
            warnings        = @($p.Warnings)
            differences     = $rows
        }
    })

    [ordered]@{
        driverVersion       = $r.DriverVersion
        driverBranch        = $r.DriverBranch
        nvapiInterface      = $r.InterfaceVersion
        baseIsCurrentGlobal = $r.BaseIsCurrentGlobal
        warnings            = @($r.Warnings)
        base = [ordered]@{
            profileName     = $base.ProfileName
            settingsStored  = $base.NumSettingsInProfile
            overriddenCount = @($baseRows | Where-Object { $_.overridden }).Count
            warnings        = @($base.Warnings)
            settings        = $baseRows
        }
        apps = $apps
    }
}
