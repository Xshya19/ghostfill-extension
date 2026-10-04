param(
    [string]$InstallDirectory = (Split-Path -Parent $PSScriptRoot),
    [switch]$Disable
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'auto-update-common.ps1')
$updateLock = $null

try {
    $InstallDirectory = Resolve-GhostFillInstallDirectory $InstallDirectory
    $manifest = Get-Content -LiteralPath (Join-Path $InstallDirectory 'manifest.json') -Raw | ConvertFrom-Json
    if ($manifest.manifest_version -ne 3 -or $manifest.name -ne '__MSG_extensionName__' -or
        $manifest.background.service_worker -ne 'background.js' -or $manifest.action.default_popup -ne 'popup.html' -or
        -not $manifest.oauth2.client_id) { throw 'Automatic Windows updates support the built Gmail-enabled GhostFill package.' }
    $null = [version]$manifest.version
    $runner = Join-Path $InstallDirectory 'scripts/auto-update-extension.ps1'
    $updater = Join-Path $InstallDirectory 'scripts/update-extension.ps1'
    foreach ($path in @($runner, $updater, (Join-Path $InstallDirectory 'scripts/auto-update-common.ps1'), (Join-Path $InstallDirectory 'background.js'))) {
        $file = Get-Item -LiteralPath $path
        if ($file.PSIsContainer -or $file.Length -eq 0 -or ($file.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
            throw 'The built automatic update helper is missing or unsafe.'
        }
    }
    if ($InstallDirectory -match '["\r\n]' -or $runner -match '["\r\n]') { throw 'The installation path cannot be safely passed to the Windows scheduler.' }
    $updateLock = Open-GhostFillUpdateLock $InstallDirectory
    $state = Read-GhostFillUpdateState $InstallDirectory $manifest.version
    $taskName = Get-GhostFillAutomaticTaskName $InstallDirectory
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    try { $sid = $identity.User.Value; $userName = $identity.Name }
    finally { $identity.Dispose() }
    $description = "GhostFill automatic updates for $InstallDirectory"
    $existing = Get-ScheduledTask -TaskName $taskName -TaskPath '\' -ErrorAction SilentlyContinue
    if ($existing -and ($existing.Description -cne $description -or
        ($existing.Principal.UserId -ine $sid -and $existing.Principal.UserId -ine $userName))) {
        throw 'The matching scheduled task does not belong to this installation and user.'
    }

    if ($Disable) {
        if ($existing) { Unregister-ScheduledTask -TaskName $taskName -TaskPath '\' -Confirm:$false }
        $state.autoUpdateEnabled = $false
        $state.taskName = $null
        Write-GhostFillUpdateState $InstallDirectory $state
        Write-Host 'Automatic GhostFill updates are disabled.' -ForegroundColor Green
        exit 0
    }

    $powershell = Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/powershell.exe'
    $arguments = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $runner + '" -InstallDirectory "' + $InstallDirectory + '"'
    $action = New-ScheduledTaskAction -Execute $powershell -Argument $arguments -WorkingDirectory (Split-Path -Parent $InstallDirectory)
    $trigger = New-ScheduledTaskTrigger -Once -At ((Get-Date).AddMinutes(2)) -RepetitionInterval (New-TimeSpan -Hours 6)
    $principal = New-ScheduledTaskPrincipal -UserId $sid -LogonType Interactive -RunLevel Limited
    $settings = New-ScheduledTaskSettingsSet -Hidden -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 4) -StartWhenAvailable -RunOnlyIfNetworkAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
    $task = New-ScheduledTask -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description $description
    $null = Register-ScheduledTask -TaskName $taskName -TaskPath '\' -InputObject $task -Force
    try {
        $state.autoUpdateEnabled = $true
        $state.taskName = $taskName
        Write-GhostFillUpdateState $InstallDirectory $state
    } catch {
        if (-not $existing) { Unregister-ScheduledTask -TaskName $taskName -TaskPath '\' -Confirm:$false -ErrorAction SilentlyContinue }
        throw
    }
    Write-Host 'Automatic GhostFill updates are enabled for your Windows account.' -ForegroundColor Green
    Write-Host 'The first check is in about two minutes, then every six hours while you are signed in. No administrator or password is required.'
    exit 0
} catch {
    Write-Host "Automatic update setup failed: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host 'The manual updater remains available. Windows policy may prevent current-user scheduled tasks.'
    exit 1
} finally {
    if ($updateLock) { $updateLock.Dispose() }
}
