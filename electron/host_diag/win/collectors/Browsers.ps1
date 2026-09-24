function Get-DiagBrowsers {
    param($Ctx)

    $local = $env:LOCALAPPDATA; $roaming = $env:APPDATA
    $defs = @(
        @{ name = 'chrome';  exe = 'chrome.exe';  kind = 'chromium'; state = "$local\Google\Chrome\User Data\Local State" }
        @{ name = 'edge';    exe = 'msedge.exe';  kind = 'chromium'; state = "$local\Microsoft\Edge\User Data\Local State" }
        @{ name = 'brave';   exe = 'brave.exe';   kind = 'chromium'; state = "$local\BraveSoftware\Brave-Browser\User Data\Local State" }
        @{ name = 'opera';   exe = 'opera.exe';   kind = 'chromium'; state = "$roaming\Opera Software\Opera Stable\Local State" }
        @{ name = 'firefox'; exe = 'firefox.exe'; kind = 'firefox';  state = "$roaming\Mozilla\Firefox\Profiles" }
    )

    function Find-Exe([string]$exe) {
        foreach ($hive in 'HKCU:', 'HKLM:') {
            foreach ($node in 'SOFTWARE', 'SOFTWARE\WOW6432Node') {
                try {
                    $p = (Get-ItemProperty "$hive\$node\Microsoft\Windows\CurrentVersion\App Paths\$exe" -ErrorAction Stop).'(default)'
                    if ($p) { $p = $p.Trim('"'); if (Test-Path $p) { return $p } }
                } catch { }
            }
        }
        return $null
    }

    $running = @{}
    try { Get-Process | ForEach-Object { $running["$($_.ProcessName).exe".ToLower()] = $true } } catch { }

    $browsers = @(foreach ($d in $defs) {
        $path = Find-Exe $d.exe
        $version = $null
        if ($path) { try { $version = (Get-Item $path).VersionInfo.ProductVersion } catch { } }

        # Targeted read: only the hardware-acceleration flag is extracted, nothing else is parsed or kept.
        # Local State is single-line JSON, so the read is whole-file by necessity (docs/desktop-release.md, antivirus checklist).
        $disabled = $null; $note = $null
        try {
            if ($d.kind -eq 'chromium' -and (Test-Path $d.state)) {
                $raw = Get-Content -LiteralPath $d.state -Raw
                if ($raw -match '"hardware_acceleration_mode"\s*:\s*\{[^}]*"enabled"\s*:\s*(true|false)') { $disabled = $Matches[1] -ne 'true' }
                else { $disabled = $false; $note = 'flag absent = browser default (enabled)' }
            }
            elseif ($d.kind -eq 'firefox' -and (Test-Path $d.state)) {
                $prefs = Get-ChildItem $d.state -Filter prefs.js -Recurse -Depth 1 -ErrorAction SilentlyContinue |
                         Sort-Object LastWriteTime -Descending | Select-Object -First 1
                if ($prefs) {
                    $hits = @(Select-String -Path $prefs.FullName -Pattern 'user_pref\("(layers\.acceleration\.disabled|gfx\.webrender\.software|webgl\.disabled)",\s*true\)')
                    $disabled = $hits.Count -gt 0
                    if ($hits.Count) { $note = ($hits | ForEach-Object { $_.Matches[0].Groups[1].Value }) -join ', ' }
                    else { $note = 'no disabling pref found = browser default (enabled)' }
                }
            }
        } catch { $note = "read error: $($_.Exception.GetType().Name)" }

        [ordered]@{
            name                 = $d.name
            exe                  = $d.exe
            installed            = [bool]$path
            version              = $version
            running              = [bool]$running[$d.exe]
            # true = the USER turned hardware acceleration off. false does NOT prove the GPU is used
            # (command-line flags, driver blocklist): sampling.gpuApps is the ground truth. null = unknown.
            hardwareAccelerationDisabledByUser = $disabled
            note                 = $note
        }
    })

    # The ProgId is FOLDED to a browser name, never emitted: Firefox's is 'FirefoxURL-<16 hex>', a
    # hash of the install path, and it has no backslash so the scrubber would not touch it.
    # null = unreadable, 'other' = a browser outside the table above.
    $default = $null
    try {
        $progId = "$((Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\Shell\Associations\UrlAssociations\https\UserChoice' -ErrorAction Stop).ProgId)"
        $default = switch -Regex ($progId) {
            '^ChromeHTML'  { 'chrome'; break }
            '^MSEdge'      { 'edge'; break }
            '^Brave'       { 'brave'; break }
            '^Opera'       { 'opera'; break }
            '^Firefox'     { 'firefox'; break }
            default        { 'other' }
        }
    } catch { }

    [ordered]@{
        defaultBrowser = $default
        browsers             = $browsers
    }
}
