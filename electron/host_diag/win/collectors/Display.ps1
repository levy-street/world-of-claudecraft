function Get-DiagDisplay {
    param($Ctx)

    Initialize-DiagNative
    $displays = @([HostDiag.Sys.Display]::Get() | ForEach-Object {
        [ordered]@{
            device        = $_.Device
            adapter       = $_.Adapter
            primary       = $_.Primary
            width         = $_.Width
            height        = $_.Height
            refreshHz     = $_.RefreshHz
            # > refreshHz means the monitor can do better at this resolution (144 Hz panel left at 60 Hz).
            maxRefreshHzAtThisResolution = $_.MaxRefreshHzAtThisResolution
            scalePercent  = if ($_.ScalePercent -gt 0) { $_.ScalePercent } else { $null }
            bitsPerPixel  = $_.BitsPerPixel
        }
    })

    # 59 (59.94) and 60 are the same rate: bucket to the nearest multiple of 5 before comparing.
    $rates = @($displays | ForEach-Object { [int]([math]::Round($_.refreshHz / 5.0) * 5) } | Sort-Object -Unique)
    $primary = $displays | Where-Object { $_.primary } | Select-Object -First 1
    [ordered]@{
        count              = $displays.Count
        # Which GPU drives the main screen (on hybrid laptops: usually the integrated one).
        primaryDisplayAdapter = if ($primary) { $primary.adapter } else { $null }
        # Mixed refresh rates across monitors is a classic source of stutter in windowed/browser rendering.
        mixedRefreshRates  = $rates.Count -gt 1
        displays           = $displays
    }
}
