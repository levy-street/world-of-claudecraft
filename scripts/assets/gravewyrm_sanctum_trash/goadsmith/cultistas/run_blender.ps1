param(
    [Parameter(Mandatory=$true)][ValidateSet('thawcaller','goadsmith','pyre_tender')][string]$Creature,
    [Parameter(Mandatory=$true)][ValidateSet('build','validate','poses','motion_review','stills','media','final')][string]$Mode,
    [ValidateSet('r1','r2','r3')][string]$Round='r3'
)
$ErrorActionPreference='Stop'
$workspace='E:/woc/wt/codex-cultistas'
$delivery="E:/woc/entregas/santuario/trash/$Creature"
$active=Get-CimInstance Win32_Process -Filter "Name='blender.exe'" | Where-Object {
    $_.CommandLine -match 'cultistas|trash[/\\](thawcaller|goadsmith|pyre_tender)'
}
if ($active) { throw 'A cultist Blender job is already active.' }
$arguments='-b --factory-startup -t 2 --python-exit-code 1 '
if ($Mode -ne 'build') { $arguments+="$delivery/$Creature.blend " }
if ($Mode -eq 'build') { $arguments+="--python scripts/anim/cultistas/build.py -- $Creature $Round" }
elseif ($Mode -eq 'validate') { $arguments+="--python scripts/anim/cultistas/validate_native.py -- $Creature" }
else { $arguments+="--python scripts/anim/cultistas/render.py -- $Creature $Mode" }
$label="$($Creature)_$($Mode)"
$process=Start-Process -FilePath 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe' `
    -ArgumentList $arguments -WorkingDirectory $workspace -WindowStyle Hidden `
    -RedirectStandardOutput "$workspace/tmp/cultistas/$label.log" `
    -RedirectStandardError "$workspace/tmp/cultistas/$label.err" -PassThru
$process.PriorityClass='Normal'
$handle=$process.Handle
$process.WaitForExit()
if ($process.ExitCode -ne 0) { throw "Blender failed: $($process.ExitCode). See tmp/cultistas/$label.err" }
if ($Mode -eq 'build') {
    Copy-Item -LiteralPath "$delivery/$Creature.blend" -Destination "$delivery/reviews/$Round/source.blend"
}
Write-Output "BLENDER PASS $Creature $Mode $Round"
