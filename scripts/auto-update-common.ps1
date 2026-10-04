# Shared helpers for the opt-in Windows updater. No task or network side effects.
$script:GhostFillUpdateStateName = 'ghostfill-update-state.json'

function Resolve-GhostFillInstallDirectory([string]$Directory) {
    $resolved = (Resolve-Path -LiteralPath $Directory).Path
    if (Test-Path -LiteralPath (Join-Path $resolved 'dist/manifest.json')) {
        $resolved = Join-Path $resolved 'dist'
    }
    $resolved = [IO.Path]::GetFullPath($resolved).TrimEnd('\', '/')
    if (-not (Split-Path -Parent $resolved)) { throw 'Choose the built GhostFill folder, not a drive root.' }
    $ancestor = Get-Item -LiteralPath $resolved
    if (-not $ancestor.PSIsContainer) { throw 'Choose a built GhostFill folder.' }
    while ($ancestor) {
        if ($ancestor.Attributes -band [IO.FileAttributes]::ReparsePoint) {
            throw 'Use a real installed folder, rather than a folder link.'
        }
        $ancestor = $ancestor.Parent
    }
    return $resolved
}

function Get-GhostFillAutomaticTaskName([string]$Directory) {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $text = $Directory.ToUpperInvariant() + "`n" + $identity.User.Value
    $hasher = [Security.Cryptography.SHA256]::Create()
    try { $digest = [BitConverter]::ToString($hasher.ComputeHash([Text.Encoding]::UTF8.GetBytes($text))).Replace('-', '').ToLowerInvariant() }
    finally { $hasher.Dispose(); $identity.Dispose() }
    return 'GhostFill-AutoUpdate-' + $digest.Substring(0, 16)
}

function New-GhostFillUpdateState([string]$Version) {
    return [pscustomobject][ordered]@{
        schemaVersion = 1
        autoUpdateEnabled = $false
        taskName = $null
        installedVersion = $Version
        updatedAt = $null
        lastCheckedAt = $null
        updateId = $null
        source = 'windows-helper'
    }
}

function Read-GhostFillUpdateState([string]$Directory, [string]$Version) {
    $path = Join-Path $Directory $script:GhostFillUpdateStateName
    if (-not (Test-Path -LiteralPath $path)) { return New-GhostFillUpdateState $Version }
    $file = Get-Item -LiteralPath $path
    if ($file.PSIsContainer -or $file.Length -gt 4096 -or ($file.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
        throw 'The automatic update status file is invalid.'
    }
    $state = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
    if ($state.schemaVersion -ne 1 -or $state.source -ne 'windows-helper' -or
        $state.autoUpdateEnabled -isnot [bool] -or
        ($state.taskName -and $state.taskName -notmatch '^GhostFill-AutoUpdate-[a-f0-9]{16}$')) {
        throw 'The automatic update status file is invalid.'
    }
    $result = New-GhostFillUpdateState $Version
    $result.autoUpdateEnabled = $state.autoUpdateEnabled
    $result.taskName = $state.taskName
    foreach ($field in @('updatedAt', 'lastCheckedAt')) {
        if ($state.$field) {
            $timestamp = [DateTimeOffset]::Parse([string]$state.$field)
            $result.$field = $timestamp.ToUniversalTime().ToString('o')
        }
    }
    if ($state.updateId) {
        if ([string]$state.updateId -notmatch '^[a-f0-9]{32}$') { throw 'The automatic update status file is invalid.' }
        $result.updateId = [string]$state.updateId
    }
    return $result
}

function Write-GhostFillUpdateState([string]$Directory, $State) {
    $target = Join-Path $Directory $script:GhostFillUpdateStateName
    if (Test-Path -LiteralPath $target) {
        $existing = Get-Item -LiteralPath $target
        if ($existing.PSIsContainer -or ($existing.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
            throw 'The automatic update status path is unsafe.'
        }
    }
    $writeId = [guid]::NewGuid().ToString('N')
    $temporary = Join-Path $Directory ('.ghostfill-state-' + $writeId + '.tmp')
    $previous = Join-Path $Directory ('.ghostfill-state-' + $writeId + '.bak')
    try {
        [IO.File]::WriteAllText($temporary, ($State | ConvertTo-Json -Depth 4), [Text.UTF8Encoding]::new($false))
        # Windows PowerShell 5.1 converts a null backup argument to an empty
        # path. Use a real sibling backup so the replacement stays atomic.
        if (Test-Path -LiteralPath $target) { [IO.File]::Replace($temporary, $target, $previous) }
        else { [IO.File]::Move($temporary, $target) }
    } finally {
        if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force }
        if (Test-Path -LiteralPath $previous) {
            if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $previous -Force }
            else { [IO.File]::Move($previous, $target) }
        }
    }
}

function Open-GhostFillUpdateLock([string]$Directory) {
    $parent = Split-Path -Parent $Directory
    $path = Join-Path $parent ('.ghostfill-' + (Split-Path -Leaf $Directory) + '-update.lock')
    if ((Test-Path -LiteralPath $path) -and ((Get-Item -LiteralPath $path).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
        throw 'The update lock path is unsafe.'
    }
    try { return [IO.File]::Open($path, [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None) }
    catch { throw 'Another update is running, or this folder is not writable. Close the other updater and try again.' }
}

function Write-GhostFillAutomaticLog([string]$Directory, [string]$Message) {
    $parent = Split-Path -Parent $Directory
    $target = Join-Path $parent ('.ghostfill-auto-' + (Get-GhostFillAutomaticTaskName $Directory) + '.log')
    $lines = @()
    if (Test-Path -LiteralPath $target) {
        $file = Get-Item -LiteralPath $target
        if ($file.PSIsContainer -or ($file.Attributes -band [IO.FileAttributes]::ReparsePoint)) { return }
        if ($file.Length -le 64KB) { $lines = @(Get-Content -LiteralPath $target -Tail 79) }
    }
    $entry = [DateTimeOffset]::UtcNow.ToString('o') + ' ' + ($Message -replace '[\r\n]', ' ')
    if ($entry.Length -gt 400) { $entry = $entry.Substring(0, 400) }
    $lines = @($lines | ForEach-Object { ([string]$_).Substring(0, [Math]::Min(400, ([string]$_).Length)) }) + $entry
    [IO.File]::WriteAllLines($target, [string[]]$lines, [Text.UTF8Encoding]::new($false))
}
