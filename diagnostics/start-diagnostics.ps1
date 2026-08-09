[CmdletBinding()]
param(
  [ValidateRange(1024, 65535)]
  [int]$Port = 5173,
  [switch]$InstallDependencies,
  [switch]$SkipAssets,
  [switch]$AllowSparseCheckoutMutation,
  [switch]$SmokeTest
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$expectedPnpm = '10.34.5'
$gameMarker = 'World of ClaudeCraft: Classic-Style Web MMO'
Set-Location -LiteralPath $repoRoot

$existingListener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($existingListener) {
  $pids = ($existingListener | Select-Object -ExpandProperty OwningProcess -Unique) -join ', '
  throw "Port $Port is already in use by process $pids. Close that program or run this script with -Port 5174."
}

$requiredAssetFiles = @(
  'public\audio\dungeon-boss-fight.mp3',
  'public\basis\basis_transcoder.js',
  'public\env\amber_sunset_1k.hdr',
  'public\fonts\alegreya-400-cyrillic.woff2',
  'public\loading-screen.jpg',
  'public\map_art\amberfall.png',
  'public\map_bg\amberfall.webp',
  'public\models\battleground\rune_damage.glb',
  'public\textures\eastbrook_surface_atlas.webp',
  'public\ui\chrome\arena.webp',
  'public\vfx\circle_05.png'
)
$assetsMissing = $requiredAssetFiles | Where-Object {
  -not (Test-Path -LiteralPath (Join-Path $repoRoot $_) -PathType Leaf)
}
if (-not $SkipAssets -and $assetsMissing) {
  if (-not $AllowSparseCheckoutMutation) {
    throw 'Required game assets are missing. The launcher will not change this checkout automatically. Rerun with -AllowSparseCheckoutMutation to permit git sparse-checkout add public, or use -SkipAssets only when you intentionally do not need the full game.'
  }
  Write-Host 'Downloading the game media assets. This repository contains several gigabytes of models, textures, and audio.'
  Write-Host "Missing asset sentinels: $($assetsMissing -join ', ')"
  & git sparse-checkout add public
  if ($LASTEXITCODE -ne 0) {
    throw 'The complete public asset checkout failed. Check the Git connection and sparse-checkout state, then run this launcher again.'
  }
  $assetsMissing = $requiredAssetFiles | Where-Object {
    -not (Test-Path -LiteralPath (Join-Path $repoRoot $_) -PathType Leaf)
  }
  if ($assetsMissing) {
    throw "The public checkout completed but required game assets are still missing: $($assetsMissing -join ', ')"
  }
}

$npx = Get-Command npx.cmd -ErrorAction SilentlyContinue
if (-not $npx) {
  $npx = Get-Command npx -ErrorAction SilentlyContinue
}
$node = Get-Command node.exe -ErrorAction SilentlyContinue
if (-not $node) {
  $node = Get-Command node -ErrorAction SilentlyContinue
}
if (-not $npx -or -not $node) {
  throw 'Node.js and npm are required. Install the current Node.js LTS release, then run this launcher again.'
}

if ($InstallDependencies) {
  Write-Host "Synchronizing the pinned game dependencies with pnpm $expectedPnpm..."
  & $npx.Source --yes "pnpm@$expectedPnpm" install --frozen-lockfile
  if ($LASTEXITCODE -ne 0) {
    throw 'Dependency installation failed. Fix the error above and run this launcher again.'
  }
}

$viteEntry = Join-Path $repoRoot 'node_modules\vite\bin\vite.js'
if (-not (Test-Path -LiteralPath $viteEntry)) {
  throw 'The local Vite dependency is missing. Install the pinned dependencies yourself, or rerun with -InstallDependencies to authorize the launcher to do it.'
}

$url = "http://127.0.0.1:$Port/?diagnostics=1&perfTrace=1&diagnosticsAuto=1&diagnosticsCapture=1"
$logRoot = Join-Path ([IO.Path]::GetTempPath()) 'world-of-claudecraft-diagnostics'
[IO.Directory]::CreateDirectory($logRoot) | Out-Null
$runId = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
$stdoutLog = Join-Path $logRoot "vite-$Port-$runId.stdout.log"
$stderrLog = Join-Path $logRoot "vite-$Port-$runId.stderr.log"

function Write-ServerLogTail {
  param(
    [string]$Path,
    [string]$Label
  )
  if (-not (Test-Path -LiteralPath $Path)) { return }
  $tail = Get-Content -LiteralPath $Path -Tail 40 -ErrorAction SilentlyContinue
  if (-not $tail) { return }
  Write-Host ''
  Write-Host "$Label ($Path)"
  $tail | ForEach-Object { Write-Host $_ }
}

$env:WOC_DIAGNOSTICS_CAPTURE = '1'
$server = Start-Process `
  -FilePath $node.Source `
  -ArgumentList @("`"$viteEntry`"", '--host', '127.0.0.1', '--port', "$Port", '--strictPort') `
  -WorkingDirectory $repoRoot `
  -WindowStyle Hidden `
  -RedirectStandardOutput $stdoutLog `
  -RedirectStandardError $stderrLog `
  -PassThru

try {
  Write-Host "Starting World of ClaudeCraft diagnostics on $url"
  $ready = $false
  $deadline = (Get-Date).AddSeconds(90)
  while ((Get-Date) -lt $deadline -and -not $server.HasExited) {
    try {
      $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 2
      if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500 -and $response.Content.Contains($gameMarker)) {
        $ready = $true
        break
      }
    } catch {
      Start-Sleep -Milliseconds 500
    }
  }

  if (-not $ready) {
    Write-ServerLogTail -Path $stderrLog -Label 'Server error log'
    Write-ServerLogTail -Path $stdoutLog -Label 'Server output log'
    if ($server.HasExited) {
      throw "The local game server exited with code $($server.ExitCode) before it became ready."
    }
    throw 'The local game server did not become ready within 90 seconds.'
  }

  if ($SmokeTest) {
    Write-Host 'Launcher smoke test passed.'
    return
  }

  Start-Process $url
  Write-Host ''
  Write-Host 'The browser is open and enters Play Offline automatically. Keep the game tab visible during the 15-second scan.'
  Write-Host 'Keep this window open. Press Ctrl+C here when you are finished.'
  Write-Host "If the server fails, its logs are $stdoutLog and $stderrLog"
  Wait-Process -Id $server.Id
  $server.Refresh()
  if ($server.ExitCode -ne 0) {
    Write-ServerLogTail -Path $stderrLog -Label 'Server error log'
    Write-ServerLogTail -Path $stdoutLog -Label 'Server output log'
    throw "The local game server stopped with code $($server.ExitCode)."
  }
} finally {
  $server.Refresh()
  if (-not $server.HasExited) {
    Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue
  }
}
