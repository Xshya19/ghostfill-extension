param([string]$InstallDirectory = (Split-Path -Parent $PSScriptRoot))

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'auto-update-common.ps1')
$exitCode = 1
$resolved = $false
try {
    $InstallDirectory = Resolve-GhostFillInstallDirectory $InstallDirectory
    $resolved = $true
    $updater = Join-Path $InstallDirectory 'scripts/update-extension.ps1'
    $file = Get-Item -LiteralPath $updater
    if ($file.PSIsContainer -or ($file.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'The installed update helper is unsafe.' }
    $global:LASTEXITCODE = 0
    & $updater -InstallDirectory $InstallDirectory -Automatic *> $null
    $exitCode = $LASTEXITCODE
    Write-GhostFillAutomaticLog $InstallDirectory "Automatic update check finished with status $exitCode."
} catch {
    if ($resolved -and (Test-Path -LiteralPath $InstallDirectory)) {
        try { Write-GhostFillAutomaticLog $InstallDirectory 'Automatic update check could not complete. The existing installation is retained.' } catch {}
    }
}
exit $exitCode
